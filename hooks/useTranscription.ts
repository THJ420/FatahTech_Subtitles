import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useReducer,
  type SetStateAction,
} from "react";
import {
  initialTranscriptionState,
  transcriptionReducer,
} from "@/lib/transcription-state";
import { extractAudioFromVideo, NoAudioDetectedError } from "@/lib/audio-utils";
import {
  detectHardwareCapabilities,
  type ModelSize,
} from "@/lib/hardware-check";
import type { SubtitleWord, WordStyleOverride } from "@/lib/transcript-utils";
import { getModelLoadingErrorMessage } from "@/lib/transcription-errors";
import {
  clampProgressPercent,
  type ModelLoadingState,
} from "@/lib/transcription-progress";
export type { ModelLoadingState } from "@/lib/transcription-progress";
/** Model identifiers are canonical in lib/hardware-check; re-exported here so
 * existing imports of `ModelSize` from this hook keep working. */
export type { ModelSize } from "@/lib/hardware-check";

type DeviceType = "webgpu" | "wasm";

export type TranscriptionStatus =
  | "idle"
  | "loading"
  | "extracting"
  | "uploading"
  | "transcribing"
  | "processing"
  | "ready";

export interface TranscriptionResult {
  text: string;
  chunks: Array<{
    text: string;
    timestamp: [number, number];
    sourceTimestamp?: [number, number];
    disabled?: boolean;
    subtitleHidden?: boolean;
    dynamicPosition?: "behind" | "front";
    styleOverride?: WordStyleOverride;
    /** Explicit word timings (manual subtitles) — honored as-is. */
    words?: SubtitleWord[];
  }>;
  generationTime?: number;
}

export const STATUS_MESSAGES: Record<TranscriptionStatus, string> = {
  idle: "Ready to start",
  loading: "Loading speech model...",
  extracting: "Extracting audio...",
  uploading: "Uploading video...",
  transcribing: "Transcribing speech...",
  processing: "Starting transcription...",
  ready: "Ready",
};

/**
 * Reuse the shared hardware probe so device selection and model gating always
 * agree on whether WebGPU is actually usable. `detectHardwareCapabilities`
 * already treats a missing or failed adapter as unavailable.
 */
async function detectPreferredDevice(): Promise<DeviceType> {
  const capabilities = await detectHardwareCapabilities();
  return capabilities.webgpu ? "webgpu" : "wasm";
}

export function useTranscription() {
  const [status, setStatusState] = useState<TranscriptionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [{ result }, dispatchResult] = useReducer(
    transcriptionReducer,
    initialTranscriptionState,
  );
  const setResult = useCallback(
    (value: SetStateAction<TranscriptionResult | null>) => {
      dispatchResult({ type: "edit", value });
    },
    [],
  );
  const [liveText, setLiveText] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [modelLoading, setModelLoading] = useState<ModelLoadingState | null>(
    null,
  );
  const [device, setDevice] = useState<DeviceType>("wasm");
  const worker = useRef<Worker | null>(null);
  const deviceRef = useRef<DeviceType>("wasm");
  const modelSizeRef = useRef<ModelSize>("base");
  const modelReadyRef = useRef(false);
  const modelLoadingPromiseRef = useRef<Promise<void> | null>(null);
  const modelLoadResolveRef = useRef<(() => void) | null>(null);
  const modelLoadRejectRef = useRef<((error: Error) => void) | null>(null);
  const loadIdRef = useRef(0);
  const activeLoadIdRef = useRef(0);
  const statusRef = useRef<TranscriptionStatus>("idle");
  const transcribingRef = useRef(false);
  const operationIdRef = useRef(0);
  const audioControllerRef = useRef<AbortController | null>(null);

  const updateStatus = useCallback((nextStatus: TranscriptionStatus) => {
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;

    detectPreferredDevice().then((preferredDevice) => {
      if (cancelled) {
        return;
      }
      setDevice(preferredDevice);
      deviceRef.current = preferredDevice;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const workerMessageHandler = useCallback(
    function handleWorkerMessage(e: MessageEvent) {
      if (e.currentTarget !== worker.current) return;
      switch (e.data.status) {
        case "model-loading":
          updateStatus("loading");
          modelReadyRef.current = false;
          setModelLoading(e.data.loading);
          if (e.data.device === "webgpu" || e.data.device === "wasm") {
            setDevice(e.data.device);
            deviceRef.current = e.data.device;
          }
          setProgress(0);
          break;

        case "fallback":
          setDevice("wasm");
          deviceRef.current = "wasm";
          modelReadyRef.current = false;
          setError(null);
          updateStatus("loading");
          setModelLoading(null);
          setProgress(0);
          break;

        case "transcribing":
          if (e.data.device === "webgpu" || e.data.device === "wasm") {
            setDevice(e.data.device);
            deviceRef.current = e.data.device;
          }
          updateStatus("transcribing");
          setProgress(0);
          break;

        case "model-ready":
          // Only resolve if this "ready" matches the most recent load request
          if (activeLoadIdRef.current === loadIdRef.current) {
            modelReadyRef.current = true;
            if (statusRef.current === "loading" && !transcribingRef.current) {
              updateStatus("ready");
            }
            if (modelLoadResolveRef.current) {
              modelLoadResolveRef.current();
            }
            modelLoadingPromiseRef.current = null;
            modelLoadResolveRef.current = null;
            modelLoadRejectRef.current = null;
          }
          break;

        case "update": {
          // Per-chunk partial result — update sidebar and progress in real time
          if (e.data.result) {
            dispatchResult({ type: "worker", result: e.data.result });
            setLiveText(e.data.result.text || "");
          } else if (typeof e.data.text === "string") {
            setLiveText(e.data.text);
          }
          if (typeof e.data.progress === "number") {
            const nextProgress = clampProgressPercent(e.data.progress);
            setProgress((prev) => Math.max(prev, nextProgress));
          }
          break;
        }

        case "complete": {
          // Add generation time from worker
          const resultWithTime = {
            ...e.data.result,
            generationTime: e.data.time,
          };
          dispatchResult({ type: "worker", result: resultWithTime });
          updateStatus("ready");
          setProgress(100);
          setModelLoading(null);
          transcribingRef.current = false;

          // Terminate worker to free model memory (~800MB-1.2GB for Whisper)
          // Worker will be re-created if user transcribes again
          if (worker.current) {
            worker.current.removeEventListener("message", handleWorkerMessage);
            worker.current.terminate();
            worker.current = null;
          }
          modelReadyRef.current = false;
          modelLoadingPromiseRef.current = null;
          modelLoadResolveRef.current = null;
          modelLoadRejectRef.current = null;
          break;
        }

        case "error":
          setError(e.data.data);
          updateStatus("idle");
          setProgress(0);
          setModelLoading(null);
          transcribingRef.current = false;
          modelReadyRef.current = false;
          if (modelLoadRejectRef.current) {
            modelLoadRejectRef.current(new Error(e.data.data));
          }
          modelLoadingPromiseRef.current = null;
          modelLoadResolveRef.current = null;
          modelLoadRejectRef.current = null;
          break;
      }
    },
    [updateStatus],
  );

  const initializeWorker = useCallback(() => {
    if (worker.current || typeof window === "undefined") {
      return;
    }

    const newWorker = new Worker(new URL("../app/worker.ts", import.meta.url), {
      type: "module",
    });

    newWorker.addEventListener("message", workerMessageHandler);
    newWorker.addEventListener("error", (event) => {
      if (worker.current !== newWorker) return;
      const message =
        event.message || "The speech worker stopped unexpectedly.";
      const error = new Error(
        statusRef.current === "loading"
          ? getModelLoadingErrorMessage(message)
          : message,
      );
      modelLoadRejectRef.current?.(error);
      modelLoadingPromiseRef.current = null;
      modelLoadResolveRef.current = null;
      modelLoadRejectRef.current = null;
      modelReadyRef.current = false;
      transcribingRef.current = false;
      setError(error.message);
      updateStatus("idle");
      setProgress(0);
      setModelLoading(null);
      newWorker.terminate();
      worker.current = null;
    });
    worker.current = newWorker;
  }, [workerMessageHandler, updateStatus]);

  const disposeWorker = useCallback(() => {
    operationIdRef.current++;
    audioControllerRef.current?.abort();
    audioControllerRef.current = null;
    modelLoadRejectRef.current?.(new DOMException("Cancelled", "AbortError"));
    modelLoadResolveRef.current = null;
    modelLoadRejectRef.current = null;
    modelLoadingPromiseRef.current = null;
    modelReadyRef.current = false;
    transcribingRef.current = false;
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => {
    return () => {
      disposeWorker();
    };
  }, [disposeWorker]);

  const ensureModelLoaded = useCallback(
    async (modelSize: ModelSize = "base") => {
      initializeWorker();

      if (modelReadyRef.current && modelSizeRef.current === modelSize) {
        return;
      }

      if (!worker.current) {
        throw new Error("Worker not initialized properly");
      }

      // If model size changed, need to reload
      if (modelSizeRef.current !== modelSize) {
        modelReadyRef.current = false;
        modelLoadingPromiseRef.current = null;
      }

      modelSizeRef.current = modelSize;

      if (!modelLoadingPromiseRef.current) {
        // Increment load ID so stale "ready" messages from previous loads are ignored
        loadIdRef.current++;
        activeLoadIdRef.current = loadIdRef.current;

        modelLoadingPromiseRef.current = new Promise<void>(
          (resolve, reject) => {
            modelLoadResolveRef.current = resolve;
            modelLoadRejectRef.current = reject;
          },
        );

        worker.current.postMessage({
          type: "load",
          data: { device: deviceRef.current, modelSize },
        });
      }

      await modelLoadingPromiseRef.current;
    },
    [initializeWorker],
  );

  // Initialize worker
  useEffect(() => {
    modelReadyRef.current = false;
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleVideoSelect = async (_file: File) => {
    disposeWorker();
    // Reset states — don't preload any model here; let the user pick model size first
    setError(null);
    setNotice(null);
    setResult(null);
    setProgress(0);
    setModelLoading(null);
    transcribingRef.current = false;
    updateStatus("ready");
  };

  const startTranscription = useCallback(
    async (
      file: File,
      language: string = "en",
      modelSize: ModelSize = "base",
    ) => {
      // Guard against double calls (React Strict Mode, double-clicks, etc.)
      if (transcribingRef.current) return;
      transcribingRef.current = true;
      const operationId = ++operationIdRef.current;
      const controller = new AbortController();
      audioControllerRef.current = controller;

      try {
        // Reset states
        setError(null);
        setNotice(null);
        setResult(null);
        setLiveText("");
        setProgress(0);
        setModelLoading(null);

        // Confirm readable, non-silent audio before loading the large model.
        updateStatus("extracting");
        const audioData = await extractAudioFromVideo(file, controller.signal);
        if (operationId !== operationIdRef.current) return;

        if (!modelReadyRef.current || modelSizeRef.current !== modelSize) {
          updateStatus("loading");
          await ensureModelLoaded(modelSize);
        }
        if (operationId !== operationIdRef.current) return;

        if (!worker.current) {
          throw new Error("Worker not initialized properly");
        }

        updateStatus("transcribing");
        setProgress(0);
        worker.current.postMessage(
          {
            type: "run",
            data: {
              audio: audioData,
              language,
              device: deviceRef.current,
              modelSize,
            },
          },
          [audioData.buffer],
        );
      } catch (err) {
        if (operationId !== operationIdRef.current) return;
        if (err instanceof NoAudioDetectedError) {
          disposeWorker();
          setNotice(err.message);
          setError(null);
          updateStatus("ready");
          setProgress(0);
          setModelLoading(null);
          return;
        }
        console.error("Error in startTranscription:", err);
        if (err instanceof Error) {
          console.error("Error stack:", err.stack);
        }
        setError(err instanceof Error ? err.message : String(err));
        updateStatus("idle");
        setProgress(0);
        setModelLoading(null);
        modelReadyRef.current = false;
        modelLoadingPromiseRef.current = null;
        modelLoadResolveRef.current = null;
        modelLoadRejectRef.current = null;
        transcribingRef.current = false;

        // Reset worker on error
        if (worker.current) {
          worker.current.terminate();
          worker.current = null;
        }
      }
    },
    [ensureModelLoaded, updateStatus, disposeWorker, setResult],
  );

  const resetTranscription = () => {
    disposeWorker();
    // Reset states
    setError(null);
    setNotice(null);
    setResult(null);
    setLiveText("");
    transcribingRef.current = false;
    updateStatus(modelReadyRef.current ? "ready" : "idle");
    setProgress(0);
    setModelLoading(null);
  };

  const cancelTranscription = useCallback(() => {
    disposeWorker();
    setError(null);
    setNotice(null);
    setResult(null);
    setLiveText("");
    transcribingRef.current = false;
    updateStatus("idle");
    setProgress(0);
    setModelLoading(null);
    modelReadyRef.current = false;
    modelLoadingPromiseRef.current = null;
    modelLoadResolveRef.current = null;
    modelLoadRejectRef.current = null;
  }, [disposeWorker, updateStatus, setResult]);

  return {
    status,
    error,
    notice,
    result,
    liveText,
    progress,
    modelLoading,
    device,
    setResult,
    setStatus: updateStatus,
    handleVideoSelect,
    startTranscription,
    resetTranscription,
    cancelTranscription,
  };
}
