import {
  AutoConfig,
  AutoModelForImageSegmentation,
  AutoProcessor,
  RawImage,
  pipeline,
} from "@huggingface/transformers";
import {
  dtypeFor,
  getBgModel,
  type BgDevice,
  type BgModel,
  type BgModelId,
} from "../lib/bg-models";
import {
  createAlphaChainState,
  downsampleAlpha,
  refineAlpha,
  DEFAULT_ALPHA_CONFIG,
  type AlphaChainConfig,
  type AlphaChainState,
} from "../lib/bg-alpha";
import {
  BG_WORKER_REQUEST,
  BG_WORKER_STATUS,
  type BgPass,
} from "../lib/bg-worker-protocol";
import { getBgQualityPreset, type BgQualityTier } from "../lib/bg-quality";
import { workerErrorMessage } from "../lib/bg-errors";
import { resolveBirefnetCpuProfile } from "../lib/bg-resolution";

type DeviceType = BgDevice;

/**
 * Segmentation worker.
 *
 * ## Two model paths
 *
 * `Xenova/modnet` is a portrait-matting network, loaded through the high-level
 * `pipeline("background-removal")` helper, which returns an RGBA image whose
 * alpha channel is the person mask.
 *
 * `onnx-community/BiRefNet_lite-ONNX` is a salient-object matting network,
 * loaded *directly* through `AutoModelForImageSegmentation`, because:
 *
 * 1. Its `config.json` declares `"model_type": "swin"`, which transformers.js
 *    would resolve to a Swin encoder with no segmentation head. The loaded
 *    config is mutated to `"birefnet"`, which maps to the generic ONNX session
 *    wrapper.
 * 2. The ONNX graph's input is named `input_image`, not `pixel_values`, so the
 *    feed key must come from the session rather than be assumed.
 * 3. It emits **raw logits** (roughly [-28, 20]) at 1024x1024, so the alpha
 *    must be sigmoided here. The high-level pipeline also quantises to uint8
 *    *before* resizing, which bands the soft edge, and it performs a wasted
 *    RGBA `putAlpha` round-trip.
 *
 * ## Robustness
 *
 * Load failures are `fatal`. Frame failures are `frame-error` and never tear
 * the run down: the caller keeps the previous mask. A failing device triggers
 * one retry on the next provider.
 *
 * When the user explicitly forced a model, recovery never swaps models: a
 * forced BiRefNet retries on WASM and then reports an error, because silently
 * switching to the person model would ignore an explicit choice. Automatic
 * selection keeps the original behaviour of falling back to MODNet/WASM.
 */

interface ProgressCallback {
  (progress: unknown): void;
}

interface RawMatte {
  alpha: Uint8Array;
  width: number;
  height: number;
}

interface Segmenter {
  modelId: BgModelId;
  device: DeviceType;
  run(
    imageData: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<RawMatte>;
  dispose(): Promise<void>;
}

interface ModelAddress {
  modelId: BgModelId;
  device: DeviceType;
}

interface OrtInputMetadata {
  name?: string;
  shape?: readonly number[];
  dimensions?: readonly number[];
}

/** Shape of the bits of transformers.js this worker relies on. */
interface OrtSessionLike {
  inputNames: string[];
  outputNames: string[];
  /**
   * Present on the raw ORT session but not in the public type definitions.
   * Web returns an array keyed by name; Node returns an object keyed by name.
   */
  inputMetadata?:
    | readonly OrtInputMetadata[]
    | Record<string, OrtInputMetadata>;
}

let activeSegmenter: Segmenter | null = null;
let loadPromise: Promise<Segmenter> | null = null;
let activeAddress: ModelAddress | null = null;

/** Set when the user picked a model explicitly; recovery must preserve it. */
let forcedModel: BgModelId | null = null;

/**
 * Set when a forced BiRefNet cannot run the 512px CPU profile. Unlike an
 * ordinary failure, this is a model/provider incompatibility, so the load and
 * recovery paths may fall back to MODNet — with a `device-changed` notice.
 */
let cpuCompatibilityFallback = false;

// Progressive-run bookkeeping. Frames are queued so two generations can never
// refine into the same temporal state.
let activeGeneration = -1;
let activePass: BgPass | null = null;
let frameQueue: Promise<void> = Promise.resolve();

// Matte refinement state. Sized by `configure`; when it has not been sent the
// chain runs at whatever resolution the model emits.
let alphaConfig: AlphaChainConfig = DEFAULT_ALPHA_CONFIG;
let qualityTier: BgQualityTier = "balanced";
let maskWidth = 0;
let maskHeight = 0;
let chainState: AlphaChainState | null = null;
let downsampleBuffer: Uint8Array | null = null;

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case BG_WORKER_REQUEST.load:
      // Serialize the swap behind queued inference. Disposing the session
      // under a running frame would fail that frame for no reason.
      frameQueue = frameQueue
        .then(() => handleLoad(data ?? {}))
        .catch((error) => {
          console.error("[bg-removal-worker] Load queue error:", error);
          // The main thread is waiting for `ready` or `fatal`; without this it
          // would wait forever.
          self.postMessage({
            status: BG_WORKER_STATUS.fatal,
            kind: "load",
            data: workerErrorMessage(error),
          });
        });
      await frameQueue;
      break;

    case BG_WORKER_REQUEST.configure:
      try {
        handleConfigure(data ?? {});
      } catch (error) {
        console.error("[bg-removal-worker] Configuration failed:", error);
        self.postMessage({
          status: BG_WORKER_STATUS.fatal,
          kind: "runtime",
          data: workerErrorMessage(error),
        });
      }
      break;

    case BG_WORKER_REQUEST.processFrame:
      frameQueue = frameQueue
        .then(() => handleProcessFrame(data))
        .catch((error) => {
          console.error("[bg-removal-worker] Frame queue error:", error);
          // Guarantee the caller's promise settles even if the handler throws
          // before reaching its own frame-error path.
          const payload = data as Partial<ProcessFramePayload> | undefined;
          if (payload && typeof payload.requestId === "number") {
            self.postMessage({
              status: BG_WORKER_STATUS.frameError,
              data: workerErrorMessage(error),
              frameIndex: payload.frameIndex,
              requestId: payload.requestId,
            });
          }
        });
      break;

    case BG_WORKER_REQUEST.release:
      await frameQueue;
      await handleRelease();
      break;

    default:
      console.error(`[bg-removal-worker] Unknown message type: ${type}`);
  }
});

/**
 * Announce a provider or model swap.
 *
 * `from`/`to` are human-readable strings for the console, but the structured
 * `modelId`/`device` fields are what a consumer must read: the "modnet/wasm"
 * form is not the literal `"wasm"`, so a string comparison would silently
 * report a WASM downgrade as a webGPU one.
 */
function postDeviceChanged(from: ModelAddress | string, to: ModelAddress) {
  self.postMessage({
    status: BG_WORKER_STATUS.deviceChanged,
    from: typeof from === "string" ? from : `${from.modelId}/${from.device}`,
    to: `${to.modelId}/${to.device}`,
    modelId: to.modelId,
    device: to.device,
  });
}

// ---------------------------------------------------------------------------
// Input profiles and inference isolation
// ---------------------------------------------------------------------------

interface ProcessorLike {
  (image: RawImage): Promise<{ pixel_values?: { dims: number[] } }>;
  image_processor?: {
    size?: unknown;
    crop_size?: unknown;
    pad_size?: unknown;
    do_resize?: boolean;
    do_normalize?: boolean;
  };
}

function readInputShape(
  session: OrtSessionLike,
  inputName: string,
): readonly number[] | null {
  const metadata = session.inputMetadata;
  if (!metadata) return null;

  if (Array.isArray(metadata)) {
    const entry =
      metadata.find((item) => item?.name === inputName) ?? metadata[0];
    return entry && Array.isArray(entry.shape) ? entry.shape : null;
  }

  const entry = (metadata as Record<string, OrtInputMetadata>)[inputName];
  if (!entry) return null;
  if (Array.isArray(entry.dimensions)) return entry.dimensions;
  return Array.isArray(entry.shape) ? entry.shape : null;
}

/**
 * Force the processor to emit a square tensor of `size`.
 *
 * The BiRefNet config declares `size: {height: 1024, width: 1024}` and no
 * crop, so replacing `size` is sufficient. Crop/pad are handled too in case a
 * future processor config adds them.
 */
function setProcessorInputSize(processor: unknown, size: number): void {
  const imageProcessor = (processor as ProcessorLike).image_processor;
  if (!imageProcessor) return;

  imageProcessor.size = { width: size, height: size };
  if (imageProcessor.crop_size) {
    imageProcessor.crop_size = { width: size, height: size };
  }
  if (imageProcessor.pad_size) {
    imageProcessor.pad_size = { width: size, height: size };
  }
  imageProcessor.do_resize = true;
}

/**
 * Run a model call behind a dedicated catch.
 *
 * The outer frame handler already converts failures into `frame-error`, but
 * logging model, device, and input shape here preserves the detail that makes
 * a CPU/WebGPU report actionable.
 */
async function runModelSafely(
  run: () => Promise<unknown>,
  context: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    console.error(
      "[bg-removal-worker] Model inference failed:",
      { ...context, error: workerErrorMessage(error) },
      error,
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Next configuration to try, or null when there is nothing usable left.
 *
 * For automatic selection, MODNet/WASM is the terminal step: it is the only
 * configuration that is both small and fast enough to run on every device this
 * app targets. A forced model only ever changes provider, never identity —
 * except when BiRefNet cannot run the 512px CPU profile at all, where the
 * caller has explicitly allowed a communicated fallback to MODNet.
 */
function nextFallback(current: ModelAddress): ModelAddress | null {
  if (forcedModel) {
    if (current.device === "webgpu") {
      return { modelId: current.modelId, device: "wasm" };
    }
    if (cpuCompatibilityFallback && current.modelId === "birefnet-lite") {
      return { modelId: "modnet", device: "wasm" };
    }
    return null;
  }
  if (current.modelId === "modnet" && current.device === "wasm") return null;
  return { modelId: "modnet", device: "wasm" };
}

async function loadSegmenter(
  address: ModelAddress,
  onProgress: ProgressCallback,
): Promise<Segmenter> {
  const model = getBgModel(address.modelId);
  if (model.id === "modnet") {
    return loadModnetSegmenter(model, address.device, onProgress);
  }
  return loadDirectSegmenter(model, address.device, onProgress);
}

function addressMatches(a: ModelAddress | null, b: ModelAddress): boolean {
  return a?.modelId === b.modelId && a?.device === b.device;
}

async function ensureLoaded(
  address: ModelAddress,
  onProgress: ProgressCallback,
): Promise<Segmenter> {
  if (activeSegmenter && addressMatches(activeAddress, address)) {
    return activeSegmenter;
  }
  if (loadPromise) {
    const segmenter = await loadPromise;
    if (addressMatches(activeAddress, address)) return segmenter;
  }

  const attempt = (async () => {
    // A session is bound to the execution provider it was created for.
    if (activeSegmenter) {
      await activeSegmenter.dispose().catch(() => {});
      activeSegmenter = null;
      activeAddress = null;
    }

    const segmenter = await loadSegmenter(address, onProgress);
    activeSegmenter = segmenter;
    activeAddress = address;
    return segmenter;
  })();

  loadPromise = attempt;
  attempt.catch(() => {
    if (loadPromise === attempt) loadPromise = null;
  });

  return attempt;
}

async function handleLoad({
  modelId = "modnet",
  device = "webgpu",
  userModelOverride = null,
}: {
  modelId?: BgModelId;
  device?: DeviceType;
  userModelOverride?: BgModelId | null;
}) {
  forcedModel = userModelOverride;
  cpuCompatibilityFallback = false;
  const progress: ProgressCallback = (info) => self.postMessage(info);
  let address: ModelAddress | null = { modelId, device };

  self.postMessage({
    status: BG_WORKER_STATUS.loading,
    data: `Loading background model (${getBgModel(modelId).label})…`,
  });

  while (address) {
    try {
      await ensureLoaded(address, progress);
      cpuCompatibilityFallback = false;
      self.postMessage({
        status: BG_WORKER_STATUS.ready,
        modelId: address.modelId,
        device: address.device,
      });
      return;
    } catch (error) {
      console.error(
        `[bg-removal-worker] Load failed for ${address.modelId}/${address.device}:`,
        error,
      );
      const fallback = nextFallback(address);
      if (!fallback) {
        self.postMessage({
          status: BG_WORKER_STATUS.fatal,
          kind: "load",
          data: workerErrorMessage(error),
        });
        return;
      }
      postDeviceChanged(address, fallback);
      address = fallback;
    }
  }
}

async function handleRelease() {
  if (loadPromise) {
    try {
      await loadPromise;
    } catch {
      /* the load already reported its own failure */
    }
  }
  if (activeSegmenter) {
    await activeSegmenter.dispose().catch(() => {});
    activeSegmenter = null;
    activeAddress = null;
  }
  chainState = null;
  downsampleBuffer = null;
  activeGeneration = -1;
  activePass = null;
  forcedModel = null;
  cpuCompatibilityFallback = false;
}

// ---------------------------------------------------------------------------
// Direct model loading (BiRefNet_lite)
// ---------------------------------------------------------------------------

async function loadDirectSegmenter(
  model: BgModel,
  device: DeviceType,
  onProgress: ProgressCallback,
): Promise<Segmenter> {
  const config = await AutoConfig.from_pretrained(model.hfId, {
    progress_callback: onProgress,
  });
  if (model.configModelType) {
    // Mutating the loaded config instance skips the second fetch and preserves
    // the rest of the config. Passing a bare object would discard id2label and
    // transformers.js_config.
    config.model_type = model.configModelType;
  }

  const modelInstance = await AutoModelForImageSegmentation.from_pretrained(
    model.hfId,
    {
      config,
      device,
      dtype: dtypeFor(model, device),
    },
  );
  let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  try {
    processor = await AutoProcessor.from_pretrained(model.hfId, {
      progress_callback: onProgress,
    });
  } catch (error) {
    // The weights are already in memory; do not leak them when configuration
    // cannot be loaded.
    await modelInstance.dispose?.().catch(() => {});
    throw error;
  }

  const sessions = (
    modelInstance as { sessions?: Record<string, OrtSessionLike> }
  ).sessions;
  const session = sessions?.model ?? Object.values(sessions ?? {})[0];
  if (!session) {
    await modelInstance.dispose?.().catch(() => {});
    throw new Error("The segmentation model did not expose an ONNX session.");
  }
  const inputName = session.inputNames[0];
  const outputNames = session.outputNames;
  const outputName =
    outputNames.find((name) => /logit|mask|output/i.test(name)) ??
    outputNames[0];

  // A missing do_normalize means the processor feeds unnormalised pixels and
  // every matte comes back as a uniform sigmoid. Fail loudly instead.
  if (!processor.image_processor?.do_normalize) {
    await modelInstance.dispose?.().catch(() => {});
    throw new Error(
      "The model's preprocessor does not normalise input; refusing to run.",
    );
  }

  // BiRefNet's native 1024² input is unsafe on the CPU/WASM provider. The ONNX
  // graph decides whether 512² is possible: dynamic spatial dimensions (<= 0)
  // accept it, a fixed 512 graph accepts it, and any other fixed shape means
  // this model cannot run the CPU profile on this provider.
  let inputProfile = {
    inputSize: model.inputSize,
    compatibilityMode: false,
  };
  if (device === "wasm" && model.id === "birefnet-lite") {
    const graphShape = readInputShape(session, inputName);
    const cpuProfile = resolveBirefnetCpuProfile(graphShape);
    console.info(
      `[bg-removal-worker] BiRefNet CPU profile: ${cpuProfile.inputSize}x${cpuProfile.inputSize}, graph ${graphShape ? graphShape.join("x") : "unknown"}.`,
    );

    if (cpuProfile.fallbackToPerson) {
      cpuCompatibilityFallback = true;
      await modelInstance.dispose?.().catch(() => {});
      throw new Error(
        `The universal model graph (${graphShape?.join("x") ?? "unknown"}) cannot run the ${cpuProfile.inputSize}px CPU compatibility profile.`,
      );
    }

    inputProfile = {
      inputSize: cpuProfile.inputSize,
      compatibilityMode: true,
    };
    setProcessorInputSize(processor, cpuProfile.inputSize);
    try {
      const probeImage = new RawImage(
        new Uint8ClampedArray(64 * 64 * 4).fill(255),
        64,
        64,
        4,
      );
      const probeInputs = await processor(probeImage);
      const probeTensor = probeInputs.pixel_values;
      if (!probeTensor) {
        throw new Error(
          "The processor produced no pixel_values for the CPU compatibility probe.",
        );
      }
      const probeDims = probeTensor.dims;
      const probeHeight = probeDims[probeDims.length - 2];
      const probeWidth = probeDims[probeDims.length - 1];
      if (
        probeHeight !== cpuProfile.inputSize ||
        probeWidth !== cpuProfile.inputSize
      ) {
        throw new Error(
          `The processor produced ${probeWidth}x${probeHeight}; expected ${cpuProfile.inputSize}x${cpuProfile.inputSize}.`,
        );
      }

      // ONNX Runtime Web exposes input metadata, but Node and some builds do
      // not. When the graph shape is unknown, run one real 512² inference at
      // load time: a graph fixed at 1024 is caught here instead of failing
      // every frame.
      if (!graphShape) {
        await runModelSafely(
          () => modelInstance({ [inputName]: probeTensor }),
          {
            modelId: model.id,
            device,
            inputSize: cpuProfile.inputSize,
            probe: true,
          },
        );
        console.info(
          "[bg-removal-worker] CPU compatibility probe succeeded at 512x512.",
        );
      }
    } catch (error) {
      cpuCompatibilityFallback = true;
      await modelInstance.dispose?.().catch(() => {});
      console.error(
        "[bg-removal-worker] The universal model rejected the CPU input profile:",
        error,
      );
      throw error;
    }
  }

  // Sniff once, not per frame: a full 1M-element scan per frame is waste when
  // the answer never changes within a session.
  let needsSigmoid: boolean | null =
    model.outputKind === "alpha" ? false : null;

  return {
    modelId: model.id,
    device,

    async run(imageData, width, height): Promise<RawMatte> {
      const rawImage = new RawImage(imageData, width, height, 4);
      const inputs = await processor(rawImage);
      const tensor = inputs.pixel_values;
      if (!tensor) {
        throw new Error("The preprocessor did not produce pixel_values.");
      }

      if (inputProfile.compatibilityMode) {
        const inputDims = tensor.dims as number[];
        const inputHeight = inputDims[inputDims.length - 2];
        const inputWidth = inputDims[inputDims.length - 1];
        if (
          inputHeight !== inputProfile.inputSize ||
          inputWidth !== inputProfile.inputSize
        ) {
          throw new Error(
            `The processor produced a ${inputWidth}x${inputHeight} tensor; expected ${inputProfile.inputSize}x${inputProfile.inputSize}.`,
          );
        }
      }

      // Dedicated catch: log the model, provider, and actual input shape, then
      // rethrow so the queue converts it into a clean `frame-error`.
      const outputs = (await runModelSafely(
        () => modelInstance({ [inputName]: tensor }),
        {
          modelId: model.id,
          device,
          inputSize: inputProfile.inputSize,
          inputDims: tensor.dims,
        },
      )) as Record<string, { data: Float32Array; dims: number[] }>;
      const tensorOut = outputs[outputName];
      if (!tensorOut) throw new Error("No segmentation output tensor.");

      const data = tensorOut.data as Float32Array;
      if (!data || data.length === 0) {
        throw new Error("Segmentation produced no readable output.");
      }

      const dims = tensorOut.dims as number[];
      const matteHeight = dims[dims.length - 2];
      const matteWidth = dims[dims.length - 1];
      const channels = dims.length >= 3 ? dims[dims.length - 3] : 1;
      const pixelCount = matteWidth * matteHeight;

      if (needsSigmoid === null) {
        needsSigmoid = sniffLogits(data);
      }

      const applySigmoid = needsSigmoid;
      const alpha = new Uint8Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const value = data[i * channels];
        const a = applySigmoid ? 1 / (1 + Math.exp(-value)) : value;
        alpha[i] = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255);
      }

      return { alpha, width: matteWidth, height: matteHeight };
    },

    async dispose() {
      await modelInstance.dispose?.();
    },
  };
}

/**
 * Decide whether a tensor holds raw logits or an already-sigmoided matte.
 *
 * Sampled rather than exhaustive: any value outside [0, 1] is conclusive, and
 * a matte with all values in range is treated as post-sigmoid — which is also
 * what the high-level pipeline assumes.
 */
function sniffLogits(data: Float32Array): boolean {
  const samples = Math.min(4096, data.length);
  const stride = Math.max(1, Math.floor(data.length / samples));
  for (let i = 0; i < data.length; i += stride) {
    const value = data[i];
    if (value < -1e-5 || value > 1 + 1e-5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MODNet (high-level pipeline)
// ---------------------------------------------------------------------------

class ModnetPipelineSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static instance: Promise<any> | null = null;

  static resetInstance(): void {
    const previous = this.instance;
    this.instance = null;
    void previous?.then((pipe) => pipe.dispose()).catch(() => {});
  }

  static async getInstance(
    hfId: string,
    progress_callback: ProgressCallback,
    device: DeviceType,
  ) {
    if (!this.instance) {
      this.instance = pipeline("background-removal", hfId, {
        device,
        dtype: "fp32" as const,
        progress_callback,
      });
    }
    return this.instance;
  }
}

async function loadModnetSegmenter(
  model: BgModel,
  device: DeviceType,
  onProgress: ProgressCallback,
): Promise<Segmenter> {
  const pipe = await ModnetPipelineSingleton.getInstance(
    model.hfId,
    onProgress,
    device,
  );

  return {
    modelId: model.id,
    device,

    async run(imageData, width, height): Promise<RawMatte> {
      const rawImage = new RawImage(imageData, width, height, 4);
      const output = (await runModelSafely(() => pipe(rawImage), {
        modelId: model.id,
        device,
        inputSize: model.inputSize,
      })) as Array<{
        data: Uint8Array;
        width: number;
        height: number;
        channels: number;
      }>;
      const result = output[0];

      const resultData = result.data as Uint8Array;
      const matteWidth = result.width as number;
      const matteHeight = result.height as number;
      const channels = result.channels as number;
      const pixelCount = matteWidth * matteHeight;

      let alpha: Uint8Array;
      if (channels === 1) {
        alpha = new Uint8Array(resultData);
      } else if (channels === 4) {
        alpha = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          alpha[i] = resultData[i * 4 + 3];
        }
      } else {
        alpha = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          alpha[i] = resultData[i * channels];
        }
      }

      return { alpha, width: matteWidth, height: matteHeight };
    },

    async dispose() {
      ModnetPipelineSingleton.resetInstance();
    },
  };
}

// ---------------------------------------------------------------------------
// Configuration and matte refinement
// ---------------------------------------------------------------------------

function handleConfigure({
  width,
  height,
  alpha,
  qualityTier: nextTier = qualityTier,
  userModelOverride,
}: {
  width?: number;
  height?: number;
  alpha?: Partial<AlphaChainConfig>;
  qualityTier?: BgQualityTier;
  userModelOverride?: BgModelId | null;
}) {
  qualityTier = nextTier;
  if (userModelOverride !== undefined) {
    forcedModel = userModelOverride;
  }

  // The tier supplies a base chain; explicit alpha overrides still win, which
  // keeps the configure message testable in isolation.
  const preset = getBgQualityPreset(qualityTier);
  alphaConfig = {
    ...DEFAULT_ALPHA_CONFIG,
    ...preset.alpha,
    ...(alpha ?? {}),
  };

  const nextWidth = Math.max(0, Math.round(width ?? 0));
  const nextHeight = Math.max(0, Math.round(height ?? 0));
  if (nextWidth !== maskWidth || nextHeight !== maskHeight) {
    maskWidth = nextWidth;
    maskHeight = nextHeight;
    chainState =
      maskWidth > 0 && maskHeight > 0
        ? createAlphaChainState(maskWidth, maskHeight)
        : null;
    downsampleBuffer = null;
  } else if (chainState) {
    // A new run must not inherit the previous run's temporal or level state.
    chainState.levelLo = null;
    chainState.levelHi = null;
    chainState.previous = null;
    chainState.previousHistogram = null;
  }
}

/**
 * Forget the previous frame only.
 *
 * The pass boundary jumps sample indices (0, 4, 8 then 1, 2, 3), which the
 * motion gate would read as a huge motion spike. Auto-level references are
 * kept so coarse and refined mattes share the same contrast mapping.
 */
function resetTemporalState() {
  if (!chainState) return;
  chainState.previous = null;
  chainState.previousHistogram = null;
}

interface RefinedMatte {
  alpha: Uint8Array;
  width: number;
  height: number;
  cut: boolean;
  meta: {
    coverage: number;
    centroidX: number;
    centroidY: number;
    chinY: number | null;
    lowConfidence: boolean;
    synthetic: boolean;
  };
}

/**
 * Resample the model's raw matte to the store's resolution, then refine it.
 *
 * Refinement runs at the *stored* resolution so its cost does not scale with
 * the model's working size, and the chain gets the final say on the edge
 * rather than being undone by a later downsample.
 */
function refineMatte(raw: RawMatte, rgba: Uint8ClampedArray): RefinedMatte {
  const targetWidth = maskWidth || raw.width;
  const targetHeight = maskHeight || raw.height;
  const resampling = targetWidth !== raw.width || targetHeight !== raw.height;

  let working = raw.alpha;
  if (resampling) {
    if (
      !downsampleBuffer ||
      downsampleBuffer.length !== targetWidth * targetHeight
    ) {
      downsampleBuffer = new Uint8Array(targetWidth * targetHeight);
    }
    downsampleAlpha(
      raw.alpha,
      raw.width,
      raw.height,
      targetWidth,
      targetHeight,
      downsampleBuffer,
    );
    working = downsampleBuffer;
  }

  if (
    !chainState ||
    chainState.width !== targetWidth ||
    chainState.height !== targetHeight
  ) {
    chainState = createAlphaChainState(targetWidth, targetHeight);
  }

  const result = refineAlpha(
    working,
    rgba,
    targetWidth,
    targetHeight,
    alphaConfig,
    chainState,
  );

  // The buffer is transferred, which detaches it. A reusable scratch must be
  // copied first; a freshly allocated inference result can be handed over.
  const alpha = resampling ? new Uint8Array(working) : working;

  return {
    alpha,
    width: targetWidth,
    height: targetHeight,
    cut: result.cut,
    meta: {
      coverage: result.stats.coverage,
      centroidX: result.stats.centroidX,
      centroidY: result.stats.centroidY,
      chinY: result.stats.chinY,
      lowConfidence: result.lowConfidence,
      synthetic: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Frame processing
// ---------------------------------------------------------------------------

interface ProcessFramePayload {
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  frameIndex: number;
  requestId: number;
  pass?: BgPass;
  generation?: number;
}

/**
 * Recover from an inference-time failure on the next provider.
 *
 * WebGPU faults often surface only once a particular shape or buffer size is
 * hit, long after a successful load. `nextFallback` decides whether recovery
 * may change the model: automatic selection may, an explicit user choice may
 * not. Recovery resets the refinement's temporal and level state because
 * mattes from different providers are not comparable after auto-levelling.
 */
async function downgradeForRecovery(): Promise<boolean> {
  const fallback = nextFallback(
    activeAddress ?? { modelId: "modnet", device: "wasm" },
  );
  if (!fallback) return false;

  const from = activeAddress
    ? `${activeAddress.modelId}/${activeAddress.device}`
    : "unknown";
  loadPromise = null;
  chainState = null;
  downsampleBuffer = null;

  try {
    await ensureLoaded(fallback, (info) => self.postMessage(info));
    postDeviceChanged(from, fallback);
    return true;
  } catch (error) {
    console.error("[bg-removal-worker] Recovery failed:", error);

    // A WebGPU BiRefNet session that cannot start its 512px CPU replacement is
    // genuinely unusable here. Use the person model rather than failing every
    // frame. `device-changed` tells the user which model actually ran.
    if (cpuCompatibilityFallback && fallback.modelId === "birefnet-lite") {
      const person: ModelAddress = { modelId: "modnet", device: "wasm" };
      try {
        await ensureLoaded(person, (info) => self.postMessage(info));
        postDeviceChanged(from, person);
        return true;
      } catch (personError) {
        console.error(
          "[bg-removal-worker] Person fallback failed:",
          personError,
        );
      }
    }
    return false;
  }
}

async function handleProcessFrame(payload: ProcessFramePayload) {
  const { frameIndex, requestId, pass = "refine", generation } = payload;

  if (typeof generation === "number") {
    // A frame from a run that has already been replaced must not touch the
    // current run's temporal state, even if it reaches the worker late.
    if (generation < activeGeneration) return;
    if (generation !== activeGeneration) {
      activeGeneration = generation;
      activePass = null;
      chainState =
        maskWidth > 0 && maskHeight > 0
          ? createAlphaChainState(maskWidth, maskHeight)
          : null;
    }
  }

  if (pass !== activePass) {
    if (activePass !== null) resetTemporalState();
    activePass = pass;
  }

  // Two attempts: the original, then one on MODNet/WASM.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (loadPromise) await loadPromise;
      if (!activeSegmenter) {
        throw new Error("Background model is not loaded.");
      }

      const raw = await activeSegmenter.run(
        payload.imageData,
        payload.width,
        payload.height,
      );
      const refined = refineMatte(raw, payload.imageData);

      self.postMessage(
        {
          status: BG_WORKER_STATUS.maskReady,
          frameIndex,
          requestId,
          pass,
          generation: typeof generation === "number" ? generation : null,
          mask: refined.alpha,
          width: refined.width,
          height: refined.height,
          meta: refined.meta,
          cut: refined.cut,
          modelId: activeAddress?.modelId,
          device: activeAddress?.device,
        },
        // @ts-expect-error - transferable list
        [refined.alpha.buffer],
      );
      return;
    } catch (error) {
      console.error(
        `[bg-removal-worker] Error processing frame ${frameIndex} (attempt ${attempt + 1}):`,
        error,
      );
      if (attempt === 0 && (await downgradeForRecovery())) continue;
      self.postMessage({
        status: BG_WORKER_STATUS.frameError,
        data: workerErrorMessage(error),
        frameIndex,
        requestId,
      });
      return;
    }
  }
}
