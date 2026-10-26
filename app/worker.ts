import {
  pipeline,
  AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import {
  ModelDownloadTracker,
  type ModelFileProgress,
  type ModelLoadingState,
} from "../lib/transcription-progress";
import {
  getModelLoadingErrorMessage,
  isModelNetworkError,
} from "../lib/transcription-errors";
import {
  getEncoderDtype,
  requiresWebGPU,
  type ModelSize,
} from "../lib/hardware-check";

export type { ModelSize };

type DeviceType = "webgpu" | "wasm";

/**
 * `_timestamped` variants are required, not optional: this worker replicates
 * the pipeline's internal `_call_whisper` loop and calls
 * `tokenizer._decode_asr(..., { return_timestamps: "word" })`, which needs the
 * alignment-head token timestamps those repos expose. The plain
 * `onnx-community/whisper-*` repos do not emit `token_timestamps`, so swapping
 * to them would silently drop word-level subtitle timing.
 */
const MODEL_IDS: Record<ModelSize, string> = {
  tiny: "onnx-community/whisper-tiny_timestamped",
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small_timestamped",
  turbo: "onnx-community/whisper-large-v3-turbo_timestamped",
  medium: "onnx-community/whisper-medium_timestamped",
};

/**
 * WebGPU exposes `navigator.gpu` in workers as well as windows, so the dtype
 * decision is made here rather than round-tripped over `postMessage`. Probing
 * in the worker keeps the flag next to the code that consumes it, and the
 * result is cached so a model switch does not re-probe the adapter.
 */
let cachedSupportsFp16: boolean | null = null;

async function detectShaderF16Support(): Promise<boolean> {
  if (cachedSupportsFp16 !== null) return cachedSupportsFp16;
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<unknown> };
      }
    ).gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      cachedSupportsFp16 = false;
      return false;
    }
    const adapter = (await gpu.requestAdapter()) as {
      features?: { has: (feature: string) => boolean };
    } | null;
    // No adapter, or no feature set, means fp16 must not be assumed.
    cachedSupportsFp16 = adapter?.features
      ? adapter.features.has("shader-f16")
      : false;
    return cachedSupportsFp16;
  } catch {
    cachedSupportsFp16 = false;
    return false;
  }
}

/** Drop the cached fp16 flag, e.g. when the GPU pipeline is torn down. */
function resetFp16Cache(): void {
  cachedSupportsFp16 = null;
}

/**
 * Per-model dtype for the WebGPU path.
 *
 * Turbo and Medium use an fp16 encoder only when the adapter reports
 * `shader-f16`. Without it, ONNX Runtime fails session creation with "The
 * device (webgpu) does not support fp16.", so we drop to a 4-bit encoder
 * instead. `getEncoderDtype` owns that rule so the UI's capability gating and
 * this runtime choice cannot drift apart.
 */
function getPipelineOptions(
  modelSize: ModelSize,
  device: DeviceType,
  supportsFp16: boolean,
) {
  if (device === "wasm") {
    return { dtype: "q8" as const, device: "wasm" as const };
  }
  return {
    dtype: {
      encoder_model: getEncoderDtype(modelSize, supportsFp16),
      // 4-bit decoder on every WebGPU path: accuracy loss is negligible here and
      // it roughly halves decoder residency, which matters most without fp16.
      decoder_model_merged: "q4" as const,
    },
    device: "webgpu" as const,
  };
}

/**
 * Simplified singleton pattern like the sample app
 */
class PipelineSingleton {
  static currentModelId: string | null = null;
  static instance: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

  static resetInstance(): void {
    const previous = this.instance;
    this.instance = null;
    this.currentModelId = null;
    // Adapter capabilities are re-probed for the next load.
    resetFp16Cache();
    void previous?.then((pipeline) => pipeline.dispose()).catch(() => {});
  }

  static async getInstance(
    modelSize: ModelSize = "base",
    progress_callback?: (progress: ModelFileProgress) => void,
    device: DeviceType = "webgpu",
  ): Promise<AutomaticSpeechRecognitionPipeline> {
    const modelId = MODEL_IDS[modelSize];

    // If model changed, reset instance
    if (this.currentModelId && this.currentModelId !== modelId) {
      this.resetInstance();
    }

    if (!this.instance) {
      this.currentModelId = modelId;
      // Probe before constructing the pipeline: the dtype is fixed at session
      // creation, and an fp16 graph on a non-fp16 device is a hard failure.
      const supportsFp16 =
        device === "webgpu" ? await detectShaderF16Support() : false;
      // @ts-expect-error - Transformers.js pipeline types produce complex union that TS cannot resolve
      this.instance = pipeline("automatic-speech-recognition", modelId, {
        ...getPipelineOptions(modelSize, device, supportsFp16),
        ...(progress_callback && { progress_callback }),
      });
    }
    return this.instance;
  }
}

let activeDevice: DeviceType | null = null;
let activeModelSize: ModelSize | null = null;
let loadPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldFallbackToWasm(
  error: unknown,
  device: DeviceType,
  fallbackAttempted: boolean,
  modelSize: ModelSize,
): boolean {
  if (device !== "webgpu" || fallbackAttempted || isModelNetworkError(error)) {
    return false;
  }

  // GPU-only models exceed practical WASM memory budgets. Retrying on CPU
  // would trade a clear failure for an out-of-memory crash or a stall that
  // outlasts the download, so report the error instead.
  if (requiresWebGPU(modelSize)) {
    return false;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("gpudevice") ||
    message.includes("createbuffer") ||
    message.includes("mappedatcreation") ||
    message.includes("webgpu") ||
    message.includes("out of memory")
  );
}

/**
 * Model download progress arrives per network chunk. A 1.5 GB model emits
 * thousands of events, and posting each one floods the main thread with
 * layout work. Throttle to a readable rate while always forwarding the final
 * state so the progress bar never stalls short of 100%.
 */
function createThrottledReporter(
  emit: (state: ModelLoadingState) => void,
  intervalMs = 120,
) {
  let lastEmit = 0;
  let pending: ModelLoadingState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const state = pending;
      pending = null;
      lastEmit = Date.now();
      emit(state);
    }
  };

  return (state: ModelLoadingState) => {
    // Terminal phases must land immediately; they are not progress updates.
    const isTerminal = state.phase !== "downloading";
    if (isTerminal) {
      flush();
      emit(state);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastEmit;
    if (elapsed >= intervalMs) {
      flush();
      emit(state);
      return;
    }

    pending = state;
    if (!timer) {
      timer = setTimeout(flush, intervalMs - elapsed);
    }
  };
}

function resetPipelineState(): void {
  PipelineSingleton.resetInstance();
  activeDevice = null;
  activeModelSize = null;
  loadPromise = null;
}

function notifyWasmFallback(): void {
  self.postMessage({
    status: "fallback",
    device: "wasm",
    data: "WebGPU could not continue. Switching to CPU...",
  });
}

// Handle messages from the main thread - simplified like sample app
self.addEventListener("message", async (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case "load":
      await handleLoad(data);
      break;

    case "run":
      await handleRun(data);
      break;

    default:
      console.error(`Unknown message type: ${type}`);
  }
});

// Handle model loading - simplified like sample app
async function handleLoad({
  device = "wasm",
  modelSize = "base" as ModelSize,
  fallbackAttempted = false,
}: {
  device?: DeviceType;
  modelSize?: ModelSize;
  fallbackAttempted?: boolean;
}) {
  if (
    !loadPromise ||
    device !== activeDevice ||
    modelSize !== activeModelSize
  ) {
    if (device !== activeDevice || modelSize !== activeModelSize) {
      PipelineSingleton.resetInstance();
      loadPromise = null;
    }

    const tracker = new ModelDownloadTracker();
    const reportLoading = createThrottledReporter((loading) => {
      self.postMessage({ status: "model-loading", loading, device });
    });
    reportLoading(tracker.snapshot());

    loadPromise = (async () => {
      try {
        const transcriber = await PipelineSingleton.getInstance(
          modelSize,
          (progressInfo) => {
            reportLoading(tracker.update(progressInfo));
          },
          device,
        );

        activeDevice = device;
        activeModelSize = modelSize;

        if (device === "webgpu") {
          reportLoading(tracker.setPhase("warming"));

          await transcriber(new Float32Array(16_000), {
            language: "en",
            // Only compile the encoder and initial/cached decoder paths.
            // Unbounded generation on silence can spend minutes on warmup.
            max_new_tokens: 2,
          });
        }
        reportLoading(tracker.setPhase("ready"));
      } catch (error) {
        resetPipelineState();
        throw error;
      }
    })();
  }

  try {
    await loadPromise;
    self.postMessage({ status: "model-ready", device: activeDevice });
  } catch (error) {
    console.error("Worker: Error loading model:", error);
    if (shouldFallbackToWasm(error, device, fallbackAttempted, modelSize)) {
      resetPipelineState();
      notifyWasmFallback();
      await handleLoad({
        device: "wasm",
        modelSize,
        fallbackAttempted: true,
      });
      return;
    }

    loadPromise = null;
    self.postMessage({
      status: "error",
      data: getModelLoadingErrorMessage(error),
    });
  }
}

// Handle transcription requests.
//
// Instead of calling the high-level pipeline (which processes all chunks then
// merges at the end with no intermediate results), we replicate _call_whisper's
// internal loop from the library source and call _decode_asr after every chunk.
// This gives streaming partial results with accuracy identical to the single
// full pipeline call, because we use the same chunking math and merge logic.
async function handleRun({
  audio,
  language = "en",
  device,
  modelSize,
  fallbackAttempted = false,
}: {
  audio: Float32Array;
  language?: string;
  device?: DeviceType;
  modelSize?: ModelSize;
  fallbackAttempted?: boolean;
}) {
  let loadingModel = true;
  // Resolve before the try block so the catch path can report the same model
  // and device the attempt actually used.
  const targetDevice = device ?? activeDevice ?? "wasm";
  const targetModelSize = modelSize ?? activeModelSize ?? "base";
  try {
    if (loadPromise) {
      await loadPromise;
    }

    const tracker = new ModelDownloadTracker();
    const reportProgress = createThrottledReporter((loading) => {
      self.postMessage({
        status: "model-loading",
        loading,
        device: targetDevice,
      });
    });
    const transcriber = await PipelineSingleton.getInstance(
      targetModelSize,
      (progressInfo) => {
        reportProgress(tracker.update(progressInfo));
      },
      targetDevice,
    );
    activeDevice = targetDevice;
    activeModelSize = targetModelSize;
    loadingModel = false;
    self.postMessage({ status: "transcribing", device: targetDevice });

    // Access the pipeline's internal components (same as _call_whisper uses)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = transcriber as any;
    const proc = p.processor;
    const model = p.model;
    const tokenizer = p.tokenizer;

    const sampling_rate: number = proc.feature_extractor.config.sampling_rate;
    const hop_length: number = proc.feature_extractor.config.hop_length;
    const time_precision: number =
      proc.feature_extractor.config.chunk_length /
      model.config.max_source_positions;

    // Match the library's default chunk/stride settings
    const CHUNK_S = 30;
    const STRIDE_S = 5;
    const window_samples = sampling_rate * CHUNK_S;
    const stride_samples = sampling_rate * STRIDE_S;
    const jump_samples = window_samples - 2 * stride_samples; // 20s step

    // Generation config:
    //   return_timestamps: true  → model generates timestamp tokens in the output,
    //                              which _decode_asr needs for proper stride-aware
    //                              chunk merging (skipping left/right stride regions).
    //   return_token_timestamps: true → model also returns per-token timestamps via
    //                              its alignment head, used by _decode_asr("word")
    //                              to produce word-level output.
    // Combining both matches the sample app's approach while giving word timestamps.
    const generation_config: Record<string, unknown> = {
      language,
      return_timestamps: true,
      return_token_timestamps: true,
      force_full_sequences: false,
    };

    const start = performance.now();

    // Plan windows without preparing the entire recording up front. Extract
    // features only when each window is about to run, then release them.
    type Chunk = {
      stride: number[]; // [length_samples, left_stride_samples, right_stride_samples]
      offset: number;
      is_last: boolean;
      tokens?: bigint[];
      token_timestamps?: number[];
    };
    const chunks: Chunk[] = [];
    let offset = 0;
    while (true) {
      const offset_end = offset + window_samples;
      const subarr = audio.subarray(offset, offset_end);
      const is_first = offset === 0;
      const is_last = offset_end >= audio.length;
      chunks.push({
        stride: [
          subarr.length,
          is_first ? 0 : stride_samples,
          is_last ? 0 : stride_samples,
        ],
        offset,
        is_last,
      });
      if (is_last) break;
      offset += jump_samples;
    }

    // Run model.generate() per chunk, streaming _decode_asr results after each one.
    // This is identical to _call_whisper's loop, just with an intermediate decode.
    const processed: Chunk[] = [];
    let finalResult = {
      text: "",
      chunks: [] as Array<{ text: string; timestamp: [number, number] }>,
    };
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const feature = await proc(
        audio.subarray(chunk.offset, chunk.offset + window_samples),
      );

      const data = await model.generate({
        inputs: feature.input_features,
        ...generation_config,
        num_frames: Math.floor(chunk.stride[0] / hop_length),
      });

      chunk.tokens = data.sequences.tolist()[0] as bigint[];
      chunk.token_timestamps = (
        data.token_timestamps.tolist()[0] as number[]
      ).map((x: number) => Math.round(x * 100) / 100);

      // Convert stride from samples → seconds (required by _decode_asr)
      chunk.stride = chunk.stride.map((x) => x / sampling_rate);

      processed.push(chunk);

      // Merge all chunks processed so far — same call the library makes at the end
      const [partialText, partialOptional] = tokenizer._decode_asr(processed, {
        time_precision,
        return_timestamps: "word",
        force_full_sequences: false,
      }) as [
        string,
        { chunks?: Array<{ text: string; timestamp: [number, number] }> },
      ];

      finalResult = {
        text: partialText,
        chunks: partialOptional.chunks ?? [],
      };
      self.postMessage({
        status: "update",
        result: finalResult,
        progress: Math.round(((i + 1) / chunks.length) * 100),
      });
    }

    const end = performance.now();

    self.postMessage({
      status: "complete",
      result: finalResult,
      time: end - start,
    });
  } catch (error) {
    console.error("Worker: Error in transcription:", error);
    if (
      shouldFallbackToWasm(
        error,
        targetDevice,
        fallbackAttempted,
        targetModelSize,
      )
    ) {
      resetPipelineState();
      notifyWasmFallback();
      await handleRun({
        audio,
        language,
        device: "wasm",
        modelSize: targetModelSize,
        fallbackAttempted: true,
      });
      return;
    }

    resetPipelineState();
    self.postMessage({
      status: "error",
      data: loadingModel
        ? getModelLoadingErrorMessage(error)
        : getErrorMessage(error),
    });
  }
}
