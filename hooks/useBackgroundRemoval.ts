import { useState, useCallback, useRef, useEffect } from "react";
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import {
  MaskStore,
  createFallbackMask,
  planMaskPasses,
  planMaskStoreForQuality,
  type MaskMeta,
  type MaskStorePlan,
} from "@/lib/mask-store";
import {
  BgRemovalError,
  shouldAbortForFailures,
  workerErrorMessage,
} from "@/lib/bg-errors";
import { getBgQualityPreset, type BgQualityTier } from "@/lib/bg-quality";
import { detectHardwareCapabilities } from "@/lib/hardware-check";
import {
  getBgModel,
  selectBgModel,
  shouldReuseLoadedModel,
  type BgDevice,
  type BgModelId,
  type BgModelSelection,
} from "@/lib/bg-models";
import {
  deleteMaskCacheKeys,
  maskCacheKey,
  readMaskCache,
  writeMaskCache,
  closeMaskCacheConnection,
} from "@/lib/mask-cache";
import {
  BG_WORKER_REQUEST,
  BG_WORKER_STATUS,
  parseWorkerDeviceChange,
  parseWorkerFatal,
  parseWorkerReady,
  type BgPass,
} from "@/lib/bg-worker-protocol";

export interface MaskData {
  data: Uint8Array;
  width: number;
  height: number;
  /**
   * Present on masks that came from the store. Carries the cached chin line and
   * the confidence flags so callers never need a second full-frame scan.
   */
  meta?: MaskMeta;
}

/**
 * Where a run is in the progressive pipeline.
 *
 * `coarse` builds a sparse preview; `refine` fills the remaining samples
 * while the preview is already usable.
 */
export type BgProcessingPhase =
  | "idle"
  | "loading"
  | "coarse"
  | "refine"
  | "ready";

interface UseBackgroundRemovalReturn {
  isModelLoading: boolean;
  isProcessing: boolean;
  phase: BgProcessingPhase;
  progress: number;
  isReady: boolean;
  /** Execution provider actually in use, once the model has loaded. */
  device: "webgpu" | "wasm" | null;
  /** Frames that failed inference and fall back to the previous mask. */
  carriedFrames: number;
  /** Resolved mask plan for the current video, null before processing. */
  maskPlan: MaskStorePlan | null;
  /** Model actually in use, once the worker has reported ready. */
  activeModelId: BgModelId | null;
  /** Why the quality model was not used, if it was not. */
  fallbackReason: string | null;
  /** Non-blocking warning about a forced model's hardware fit. */
  hardwareWarning: string | null;
  /** Subject coverage of the most recent mask, 0–1. */
  subjectCoverage: number | null;
  /** Coverage says the matte contains a plausible subject. */
  subjectDetected: boolean;
  /** The current masks came from IndexedDB instead of inference. */
  restoredFromCache: boolean;
  processVideo: (
    videoElement: HTMLVideoElement,
    knownDuration?: number,
    selection?: BgModelSelection,
    qualityTier?: BgQualityTier,
  ) => Promise<void>;
  getMaskAtTime: (time: number) => MaskData | null;
  /** Drop cached masks but keep the loaded model for the next run. */
  clearMasks: () => void;
  /** Delete cached slabs for the current video and clear in-memory masks. */
  clearMaskCache: () => Promise<void>;
  reset: () => void;
}

/**
 * Below this coverage the refined matte is treated as "no subject". Mirrors
 * `MIN_PLAUSIBLE_COVERAGE` in `lib/bg-alpha.ts`, kept local so the main-thread
 * bundle does not pull in the whole refinement chain for one constant.
 */
const SUBJECT_COVERAGE_FLOOR = 0.004;

export function useBackgroundRemoval(): UseBackgroundRemovalReturn {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [phase, setPhase] = useState<BgProcessingPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [device, setDevice] = useState<"webgpu" | "wasm" | null>(null);
  const [carriedFrames, setCarriedFrames] = useState(0);
  const [maskPlan, setMaskPlan] = useState<MaskStorePlan | null>(null);
  const [activeModelId, setActiveModelId] = useState<BgModelId | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [hardwareWarning, setHardwareWarning] = useState<string | null>(null);
  const [subjectCoverage, setSubjectCoverage] = useState<number | null>(null);
  const [restoredFromCache, setRestoredFromCache] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const modelReadyRef = useRef(false);
  /** Which model the worker actually has loaded, for reload detection. */
  const loadedModelIdRef = useRef<BgModelId | null>(null);
  const loadedDeviceRef = useRef<BgDevice | null>(null);
  /** The explicit override that produced the current session, if any. */
  const loadedFromOverrideRef = useRef<BgModelId | null>(null);
  /** Cache keys used for this video, so the UI can delete them. */
  const cacheKeysRef = useRef<Set<string>>(new Set());
  /** In-flight cache writes. A clear must wait for all of them. */
  const cacheWritesRef = useRef<Set<Promise<void>>>(new Set());
  const storeRef = useRef<MaskStore | null>(null);
  const processingRef = useRef<AbortController | null>(null);
  /** Set when the worker died; stops the run even between frame requests. */
  const fatalRunRef = useRef<BgRemovalError | null>(null);
  const modelLoadRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const requestIdRef = useRef(0);
  const generationRef = useRef(0);
  const pendingFramesRef = useRef<
    Map<
      number,
      { resolve: (mask: MaskData) => void; reject: (err: Error) => void }
    >
  >(new Map());

  /**
   * Abandon in-flight work without tearing the worker down.
   *
   * The model is expensive to load, so cancelling a run (or starting a new one)
   * must not dispose the session. Only `reset()` and unmount do that.
   */
  const abandonInFlight = useCallback(
    (error: Error = new DOMException("Cancelled", "AbortError")) => {
      generationRef.current++;
      modelLoadRef.current?.reject(error);
      modelLoadRef.current = null;
      for (const pending of pendingFramesRef.current.values())
        pending.reject(error);
      pendingFramesRef.current.clear();
    },
    [],
  );

  const disposeWorker = useCallback(
    (error: Error = new DOMException("Cancelled", "AbortError")) => {
      abandonInFlight(error);
      workerRef.current?.terminate();
      workerRef.current = null;
      modelReadyRef.current = false;
      loadedModelIdRef.current = null;
      loadedDeviceRef.current = null;
      loadedFromOverrideRef.current = null;
      setDevice(null);
    },
    [abandonInFlight],
  );

  // Initialize worker
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL("../app/bg-removal-worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.addEventListener("message", (e: MessageEvent) => {
        if (worker !== workerRef.current) return;
        const { status, data, requestId, mask, width, height, meta } = e.data;

        switch (status) {
          case BG_WORKER_STATUS.loading:
            setIsModelLoading(true);
            break;

          case BG_WORKER_STATUS.ready: {
            const info = parseWorkerReady(e.data);
            if (!info) break;
            setIsModelLoading(false);
            modelReadyRef.current = true;
            loadedModelIdRef.current = info.modelId;
            loadedDeviceRef.current = info.device;
            setDevice(info.device);
            setActiveModelId(info.modelId);
            modelLoadRef.current?.resolve();
            modelLoadRef.current = null;
            break;
          }

          case BG_WORKER_STATUS.deviceChanged: {
            const change = parseWorkerDeviceChange(e.data);
            if (!change) break;
            console.warn(
              `[useBackgroundRemoval] Switched execution provider: ${change.from} → ${change.to}`,
            );
            // The structured fields are authoritative. Comparing the display
            // string "modnet/wasm" against the literal "wasm" would report a
            // WASM downgrade as webGPU.
            setDevice(change.device);
            // A downgrade changes the model as well as the device, so the
            // reported model must follow it.
            const previousModel = loadedModelIdRef.current;
            loadedModelIdRef.current = change.modelId;
            loadedDeviceRef.current = change.device;
            setActiveModelId(change.modelId);
            if (previousModel !== change.modelId) {
              setFallbackReason(
                `Switched to ${getBgModel(change.modelId).label} after the preferred model became unavailable.`,
              );
              // The forced model's CPU-profile notice no longer describes what
              // is running.
              setHardwareWarning(null);
            }
            break;
          }

          // The worker cannot continue. `load` failures are the only ones the
          // UI may describe as a hardware limitation; `runtime` failures mean
          // the model had already loaded successfully.
          case BG_WORKER_STATUS.fatal: {
            setIsModelLoading(false);
            const fatal = parseWorkerFatal(e.data);
            const message = fatal?.message ?? workerErrorMessage(data);
            const kind = fatal?.kind ?? "load";
            console.error(
              "[useBackgroundRemoval] Fatal worker error:",
              message,
            );
            const error = new BgRemovalError(kind, message);
            fatalRunRef.current = error;
            disposeWorker(error);
            break;
          }

          // One frame failed. Report it to that frame's caller only — the run
          // itself continues, and the store fills the gap with the prior mask
          // (or an opaque placeholder before the first success).
          case BG_WORKER_STATUS.frameError: {
            if (requestId !== undefined) {
              const pending = pendingFramesRef.current.get(requestId);
              if (pending) {
                pending.reject(new Error(workerErrorMessage(data)));
                pendingFramesRef.current.delete(requestId);
              }
            }
            break;
          }

          case BG_WORKER_STATUS.maskReady: {
            const maskData: MaskData = {
              data: mask instanceof Uint8Array ? mask : new Uint8Array(mask),
              width,
              height,
              meta,
            };

            const pending = pendingFramesRef.current.get(requestId);
            if (pending) {
              pending.resolve(maskData);
              pendingFramesRef.current.delete(requestId);
            }
            break;
          }
        }
      });
      worker.addEventListener("error", (event) => {
        if (worker !== workerRef.current) return;
        setIsModelLoading(false);
        const error = new BgRemovalError(
          "runtime",
          event.message || "The background worker stopped unexpectedly.",
        );
        fatalRunRef.current = error;
        disposeWorker(error);
      });
    }
    return workerRef.current;
  }, [disposeWorker]);

  const selectionRef = useRef<BgModelSelection | null>(null);

  // Ensure model is loaded. The caller may supply a device-appropriate
  // selection; otherwise one is probed here so the export fallback is
  // self-sufficient.
  const ensureModelLoaded = useCallback(
    async (selection?: BgModelSelection): Promise<void> => {
      if (selection) {
        selectionRef.current = selection;
      }

      if (modelLoadRef.current) return modelLoadRef.current.promise;

      // The session is expensive, but reusing it across an explicit model swap
      // would silently ignore the user's choice.
      const reuse = shouldReuseLoadedModel(
        {
          ready: modelReadyRef.current,
          loadedModelId: loadedModelIdRef.current,
          loadedFromOverride: loadedFromOverrideRef.current,
        },
        selection ?? null,
      );
      if (reuse) {
        // A forced selection that resolved to a fallback must keep the reason
        // reported when the worker switched models. Only refresh the notices
        // when the loaded model actually matches this selection.
        if (selection && loadedModelIdRef.current === selection.model.id) {
          setFallbackReason(selection.fallbackReason);
          setHardwareWarning(selection.hardwareWarning);
        }
        return;
      }

      if (selection) {
        setFallbackReason(selection.fallbackReason);
        setHardwareWarning(selection.hardwareWarning);
      }

      if (!selectionRef.current) {
        selectionRef.current = selectBgModel(
          await detectHardwareCapabilities(),
        );
        setFallbackReason(selectionRef.current.fallbackReason);
        setHardwareWarning(selectionRef.current.hardwareWarning);
      }

      const worker = getWorker();
      const chosen = selectionRef.current;
      // A new session is about to replace the old one; frames wait for `ready`.
      loadedFromOverrideRef.current = chosen.override;
      modelReadyRef.current = false;

      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      modelLoadRef.current = { promise, resolve, reject };
      worker.postMessage({
        type: BG_WORKER_REQUEST.load,
        data: {
          modelId: chosen.model.id,
          device: chosen.device,
          userModelOverride: chosen.override,
        },
      });
      return promise;
    },
    [getWorker],
  );

  // Process a single frame and return a promise for the mask
  const processFrame = useCallback(
    async (
      imageData: Uint8ClampedArray,
      width: number,
      height: number,
      frameIndex: number,
      pass: BgPass = "refine",
    ): Promise<MaskData> => {
      const generation = generationRef.current;
      await ensureModelLoaded();
      if (generation !== generationRef.current)
        throw new DOMException("Cancelled", "AbortError");
      const worker = getWorker();
      const requestId = ++requestIdRef.current;

      return new Promise((resolve, reject) => {
        pendingFramesRef.current.set(requestId, { resolve, reject });
        worker.postMessage({
          type: BG_WORKER_REQUEST.processFrame,
          data: {
            imageData,
            width,
            height,
            frameIndex,
            requestId,
            pass,
            generation,
          },
        });
      });
    },
    [getWorker, ensureModelLoaded],
  );

  // Process entire video for preview masks
  const processVideo = useCallback(
    async (
      videoElement: HTMLVideoElement,
      knownDuration?: number,
      selection?: BgModelSelection,
      qualityTier: BgQualityTier = "balanced",
    ) => {
      processingRef.current?.abort();
      // Cancel any in-flight run but keep the loaded model alive.
      abandonInFlight();
      fatalRunRef.current = null;
      const generation = generationRef.current;
      const controller = new AbortController();
      processingRef.current = controller;
      const { signal } = controller;
      let input: Input | null = null;
      setIsProcessing(true);
      setPhase("loading");
      setProgress(0);
      setIsReady(false);
      setCarriedFrames(0);
      setSubjectCoverage(null);
      setRestoredFromCache(false);
      storeRef.current?.release();
      storeRef.current = null;
      setMaskPlan(null);

      try {
        const duration =
          Number.isFinite(videoElement.duration) && videoElement.duration > 0
            ? videoElement.duration
            : knownDuration;
        if (!duration || !Number.isFinite(duration) || duration <= 0) {
          throw new Error("Invalid video duration");
        }

        // Read the local file once: its size is part of the cache key, and the
        // same blob feeds the decoder below.
        const videoBlob = await fetch(videoElement.src, { signal }).then(
          (response) => {
            if (!response.ok) throw new Error("Could not read the video file.");
            return response.blob();
          },
        );
        signal.throwIfAborted();

        // The tier supplies the requested resolution and sample rate; the
        // planner only sheds them when this clip cannot fit the tier's budget.
        const preset = getBgQualityPreset(qualityTier);
        const plan = planMaskStoreForQuality(
          duration,
          videoElement.videoWidth || 1920,
          videoElement.videoHeight || 1080,
          {
            shortSide: preset.maskShortSide,
            sampleFps: preset.sampleFps,
            budgetBytes: preset.maskBudgetBytes,
          },
        );
        if (plan.totalFrames === 0) {
          throw new Error("This video is too long to analyse.");
        }

        if (selection) selectionRef.current = selection;

        const restoreCachedMasks = async (
          modelId: BgModelId,
        ): Promise<boolean> => {
          if (videoBlob.size <= 0) return false;

          const identity = {
            fileSize: videoBlob.size,
            durationSeconds: duration,
            modelId,
            sampleFps: plan.sampleFps,
            maskWidth: plan.width,
            maskHeight: plan.height,
          };
          cacheKeysRef.current.add(maskCacheKey(identity));

          const record = await readMaskCache(identity);
          signal.throwIfAborted();
          if (!record || record.plan.totalFrames !== plan.totalFrames) {
            return false;
          }

          const restored = MaskStore.fromSnapshot({
            plan: record.plan,
            slab: record.slab,
            occupied: record.occupied,
            metas: record.metas,
            storedCount: record.storedCount,
          });
          if (!restored) return false;

          storeRef.current?.release();
          storeRef.current = restored;
          setMaskPlan(restored.plan);
          setIsReady(true);
          setPhase("ready");
          setProgress(100);
          setCarriedFrames(restored.syntheticFrames);
          const lastReal = [...record.metas]
            .reverse()
            .find((meta) => meta && !meta.synthetic);
          setSubjectCoverage(lastReal?.coverage ?? null);
          setActiveModelId(record.modelId);
          setDevice(record.device);
          setFallbackReason(null);
          setHardwareWarning(null);
          setRestoredFromCache(true);
          return true;
        };

        // Try the model that will actually run before loading anything: a hit
        // skips both the model download and inference. A loaded fallback is
        // reused only when it can still serve this selection; an explicit
        // model change must look up the newly selected model instead.
        const reusableLoadedModel =
          shouldReuseLoadedModel(
            {
              ready: modelReadyRef.current,
              loadedModelId: loadedModelIdRef.current,
              loadedFromOverride: loadedFromOverrideRef.current,
            },
            selection ?? null,
          ) && loadedModelIdRef.current
            ? loadedModelIdRef.current
            : null;
        const initialModelId =
          reusableLoadedModel ?? selection?.model.id ?? null;
        if (initialModelId && (await restoreCachedMasks(initialModelId))) {
          return;
        }

        if (selection) {
          // Show the requested model while it loads; a downgrade reports the
          // model that actually ran once the worker is ready.
          setActiveModelId(selection.model.id);
          setDevice(selection.device);
        }
        await ensureModelLoaded(selection);
        signal.throwIfAborted();

        // A fallback model may have produced the cached masks on a previous
        // run, so try the resolved model as well.
        const actualModelId =
          loadedModelIdRef.current ?? selectionRef.current?.model.id ?? null;
        if (
          actualModelId &&
          actualModelId !== initialModelId &&
          (await restoreCachedMasks(actualModelId))
        ) {
          return;
        }

        const store = new MaskStore(plan);
        storeRef.current = store;
        setMaskPlan(plan);

        const worker = getWorker();
        worker.postMessage({
          type: BG_WORKER_REQUEST.configure,
          data: {
            width: plan.width,
            height: plan.height,
            qualityTier,
            userModelOverride: selectionRef.current?.override ?? null,
          },
        });

        // The model works at a fixed resolution; the matte is resampled to the
        // store's resolution inside the worker.
        const MAX_PROCESS_DIM = preset.processMaxDim;
        const srcW = videoElement.videoWidth;
        const srcH = videoElement.videoHeight;
        const scale = Math.min(1, MAX_PROCESS_DIM / Math.max(srcW, srcH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(srcW * scale);
        canvas.height = Math.round(srcH * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        if (!ctx) {
          throw new Error("Failed to create canvas context");
        }

        // Decode sequentially with mediabunny rather than seeking a second
        // <video>. `samplesAtTimestamps` decodes each packet at most once and
        // hands back the exact frame for the requested timestamp, which both
        // removes the seek cost and eliminates the "captured the pre-seek
        // frame" failure mode that a `seeked` event cannot guard against.
        input = new Input({
          source: new BlobSource(videoBlob),
          formats: ALL_FORMATS,
        });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error("No video track found in this file.");
        if (!(await track.canDecode())) {
          throw new Error("This browser cannot decode this video.");
        }

        const sink = new VideoSampleSink(track);
        const { totalFrames, sampleFps } = plan;
        const passes = planMaskPasses(totalFrames);

        let failures = 0;
        let consecutiveFailures = 0;
        let processed = 0;

        const runPass = async (indices: number[], pass: BgPass) => {
          if (indices.length === 0) return;

          // Monotonically increasing, so mediabunny takes its optimised
          // single-decode-pass path for this pass.
          const timestamps = indices.map((index) => index / sampleFps);
          let cursor = 0;

          for await (const sample of sink.samplesAtTimestamps(timestamps)) {
            try {
              signal.throwIfAborted();
              if (fatalRunRef.current) throw fatalRunRef.current;
              const index = indices[cursor];
              cursor += 1;

              if (!sample) {
                // No decodable frame at this timestamp. The store resolves the
                // gap to the nearest earlier mask.
                processed++;
                setProgress(Math.round((processed / totalFrames) * 100));
                continue;
              }

              try {
                sample.draw(ctx, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                );

                const mask = await processFrame(
                  imageData.data,
                  canvas.width,
                  canvas.height,
                  index,
                  pass,
                );
                if (generation !== generationRef.current) {
                  throw new DOMException("Cancelled", "AbortError");
                }
                store.put(index, mask.data, {
                  coverage: mask.meta?.coverage ?? 0,
                  centroidX: mask.meta?.centroidX ?? 0.5,
                  centroidY: mask.meta?.centroidY ?? 0.5,
                  chinY: mask.meta?.chinY ?? null,
                  lowConfidence: mask.meta?.lowConfidence ?? false,
                  synthetic: mask.meta?.synthetic ?? false,
                });
                consecutiveFailures = 0;
                if (mask.meta) setSubjectCoverage(mask.meta.coverage);
              } catch (error) {
                if (signal.aborted || generation !== generationRef.current) {
                  throw error;
                }
                // A fatal worker error is not a frame hiccup. Aborting with its
                // classification keeps the UI from reporting it as a frame
                // budget problem.
                if (
                  error instanceof BgRemovalError &&
                  error.kind !== "frames"
                ) {
                  throw error;
                }

                failures += 1;
                consecutiveFailures += 1;
                console.warn(
                  `[useBackgroundRemoval] Frame ${index} failed, using a fallback mask:`,
                  error,
                );

                // Fill the slot so frame 0 has a defined matte too. Before the
                // first success the placeholder is fully opaque, which leaves
                // the original frame visible instead of a hole.
                const fallback = createFallbackMask(plan, store.get(index));
                store.put(index, fallback.alpha, fallback.meta);
                setCarriedFrames(failures);

                if (
                  shouldAbortForFailures({
                    failures,
                    consecutiveFailures,
                    totalFrames,
                  })
                ) {
                  throw new BgRemovalError(
                    "frames",
                    `Too many frames failed (${failures} of ${totalFrames}).`,
                    { failedFrames: failures, totalFrames },
                  );
                }
              }
            } finally {
              // VideoSample owns a VideoFrame; leaking it exhausts GPU memory
              // partway through a long clip and would look like an OOM. This
              // covers cancellation and fatal-error exits too.
              sample?.close();
            }

            processed++;
            signal.throwIfAborted();
            setProgress(Math.round((processed / totalFrames) * 100));
          }
        };

        setPhase("coarse");
        await runPass(passes.coarse, "coarse");
        signal.throwIfAborted();
        if (generation !== generationRef.current) {
          throw new DOMException("Cancelled", "AbortError");
        }

        // A sparse pass is enough to composite: from here the preview is live
        // while the remaining samples are filled in at full quality.
        setIsReady(true);
        setPhase("refine");
        await runPass(passes.refine, "refine");

        const cacheModelId =
          loadedModelIdRef.current ?? selectionRef.current?.model.id ?? null;
        if (
          cacheModelId &&
          store.hasRealMasks &&
          videoBlob.size > 0 &&
          !signal.aborted &&
          generation === generationRef.current
        ) {
          const identity = {
            fileSize: videoBlob.size,
            durationSeconds: duration,
            modelId: cacheModelId,
            sampleFps: plan.sampleFps,
            maskWidth: plan.width,
            maskHeight: plan.height,
          };
          cacheKeysRef.current.add(maskCacheKey(identity));
          const write = writeMaskCache({
            identity,
            device: loadedDeviceRef.current,
            snapshot: store.snapshot(),
          })
            .then((saved) => {
              if (!saved) {
                console.warn(
                  "[useBackgroundRemoval] Mask cache was not saved.",
                );
              }
            })
            .catch((error) => {
              console.warn(
                "[useBackgroundRemoval] Mask cache write failed:",
                error,
              );
            });
          cacheWritesRef.current.add(write);
          void write.finally(() => {
            cacheWritesRef.current.delete(write);
          });
        }

        setIsReady(true);
        setPhase("ready");
        setProgress(100);
      } catch (error) {
        if (signal.aborted) return;
        // `disposeWorker` bumps the generation, so a fatal worker error looks
        // like a superseded run. It is not: the worker is gone and the caller
        // must be told rather than left with stale "ready" state.
        if (generation !== generationRef.current && !fatalRunRef.current) {
          return;
        }
        storeRef.current = null;
        setMaskPlan(null);
        setPhase("idle");
        console.error("[useBackgroundRemoval] Processing failed:", error);
        setIsReady(false);
        throw error;
      } finally {
        input?.dispose();
        if (processingRef.current === controller) {
          processingRef.current = null;
          // The worker and its ONNX session stay alive: the next run, and the
          // export fallback, would otherwise pay the full model load again.
          setIsModelLoading(false);
          setIsProcessing(false);
        }
      }
    },
    [abandonInFlight, ensureModelLoaded, getWorker, processFrame],
  );

  /** Nearest cached mask for a video time, in seconds. */
  const getMaskAtTime = useCallback((time: number): MaskData | null => {
    return storeRef.current?.getAt(time) ?? null;
  }, []);

  /**
   * Drop cached masks without touching the loaded model.
   *
   * Used when a setting that shapes the masks changes while no run is active:
   * the cache is no longer valid, but reloading the model would be wasted work.
   */
  const clearMasks = useCallback(() => {
    if (processingRef.current) return;
    storeRef.current?.release();
    storeRef.current = null;
    setMaskPlan(null);
    setIsReady(false);
    setPhase("idle");
    setProgress(0);
    setCarriedFrames(0);
    setSubjectCoverage(null);
    setRestoredFromCache(false);
  }, []);

  /**
   * Delete the cached slabs used for this video and drop in-memory masks.
   *
   * Waits for an in-flight cache save first: deleting while the save is still
   * running would let it re-add the entry and defeat a forced re-analysis.
   */
  const clearMaskCache = useCallback(async () => {
    if (processingRef.current) return;
    const keys = Array.from(cacheKeysRef.current);
    cacheKeysRef.current.clear();
    await Promise.all(Array.from(cacheWritesRef.current));
    cacheWritesRef.current.clear();
    await deleteMaskCacheKeys(keys);
    clearMasks();
  }, [clearMasks]);

  // Reset all state
  const reset = useCallback(() => {
    processingRef.current?.abort();
    processingRef.current = null;
    disposeWorker();
    storeRef.current?.release();
    storeRef.current = null;
    setMaskPlan(null);
    setIsModelLoading(false);
    setIsReady(false);
    setIsProcessing(false);
    setPhase("idle");
    setProgress(0);
    setCarriedFrames(0);
    setSubjectCoverage(null);
    setActiveModelId(null);
    setFallbackReason(null);
    setHardwareWarning(null);
    setRestoredFromCache(false);
    fatalRunRef.current = null;
    cacheKeysRef.current.clear();
    cacheWritesRef.current.clear();
  }, [disposeWorker]);

  // Cleanup on unmount
  useEffect(() => {
    const cacheKeys = cacheKeysRef.current;
    return () => {
      processingRef.current?.abort();
      processingRef.current = null;
      disposeWorker();
      storeRef.current?.release();
      storeRef.current = null;
      cacheKeys.clear();
      void closeMaskCacheConnection();
    };
  }, [disposeWorker]);

  return {
    isModelLoading,
    isProcessing,
    phase,
    progress,
    isReady,
    device,
    carriedFrames,
    maskPlan,
    activeModelId,
    fallbackReason,
    hardwareWarning,
    subjectCoverage,
    subjectDetected:
      subjectCoverage !== null && subjectCoverage >= SUBJECT_COVERAGE_FLOOR,
    restoredFromCache,
    processVideo,
    getMaskAtTime,
    clearMasks,
    clearMaskCache,
    reset,
  };
}
