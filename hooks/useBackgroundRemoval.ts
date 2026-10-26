import { useState, useCallback, useRef, useEffect } from "react";
import {
  releaseVideo,
  seekVideo,
  waitForMediaEvent,
} from "@/lib/media-lifecycle";

export interface MaskData {
  data: Uint8Array;
  width: number;
  height: number;
}

interface UseBackgroundRemovalReturn {
  isModelLoading: boolean;
  isProcessing: boolean;
  progress: number;
  isReady: boolean;
  processVideo: (
    videoElement: HTMLVideoElement,
    knownDuration?: number,
  ) => Promise<void>;
  getMaskAtTime: (time: number, fps?: number) => MaskData | null;
  reset: () => void;
  processFrame: (
    imageData: Uint8ClampedArray,
    width: number,
    height: number,
    frameIndex: number,
  ) => Promise<MaskData>;
}

export const SAMPLE_FPS = 8;

export function useBackgroundRemoval(): UseBackgroundRemovalReturn {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const modelReadyRef = useRef(false);
  const masksRef = useRef<MaskData[]>([]);
  const processingRef = useRef<AbortController | null>(null);
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

  const disposeWorker = useCallback(
    (error: Error = new DOMException("Cancelled", "AbortError")) => {
      generationRef.current++;
      workerRef.current?.terminate();
      workerRef.current = null;
      modelReadyRef.current = false;
      modelLoadRef.current?.reject(error);
      modelLoadRef.current = null;
      for (const pending of pendingFramesRef.current.values())
        pending.reject(error);
      pendingFramesRef.current.clear();
    },
    [],
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
        const { status, data, frameIndex, requestId, mask, width, height } =
          e.data;

        switch (status) {
          case "loading":
            setIsModelLoading(true);
            break;

          case "ready":
            setIsModelLoading(false);
            modelReadyRef.current = true;
            modelLoadRef.current?.resolve();
            modelLoadRef.current = null;
            break;

          case "error": {
            setIsModelLoading(false);
            console.error("[useBackgroundRemoval] Worker error:", data);
            // Reject any pending frame promise for this frameIndex
            if (requestId !== undefined) {
              const pending = pendingFramesRef.current.get(requestId);
              if (pending) {
                pending.reject(new Error(data));
                pendingFramesRef.current.delete(requestId);
              }
            } else {
              disposeWorker(new Error(data));
            }
            break;
          }

          case "mask-ready": {
            const maskData: MaskData = {
              data: mask instanceof Uint8Array ? mask : new Uint8Array(mask),
              width,
              height,
            };

            // Store in ref for immediate access
            // Resolve pending promise
            const pending = pendingFramesRef.current.get(requestId);
            if (pending) {
              masksRef.current[frameIndex] = maskData;
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
        disposeWorker(
          new Error(
            event.message || "The background worker stopped unexpectedly.",
          ),
        );
      });
    }
    return workerRef.current;
  }, [disposeWorker]);

  // Ensure model is loaded
  const ensureModelLoaded = useCallback(async (): Promise<void> => {
    if (modelReadyRef.current) return;
    if (modelLoadRef.current) return modelLoadRef.current.promise;

    const worker = getWorker();

    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    modelLoadRef.current = { promise, resolve, reject };
    const device =
      typeof navigator !== "undefined" && "gpu" in navigator
        ? "webgpu"
        : "wasm";
    worker.postMessage({ type: "load", data: { device } });
    return promise;
  }, [getWorker]);

  // Process a single frame and return a promise for the mask
  const processFrame = useCallback(
    async (
      imageData: Uint8ClampedArray,
      width: number,
      height: number,
      frameIndex: number,
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
          type: "process-frame",
          data: { imageData, width, height, frameIndex, requestId },
        });
      });
    },
    [getWorker, ensureModelLoaded],
  );

  // Process entire video for preview masks
  const processVideo = useCallback(
    async (videoElement: HTMLVideoElement, knownDuration?: number) => {
      processingRef.current?.abort();
      disposeWorker();
      const controller = new AbortController();
      processingRef.current = controller;
      const { signal } = controller;
      let processingVideo: HTMLVideoElement | null = null;
      setIsProcessing(true);
      setProgress(0);
      setIsReady(false);
      masksRef.current = [];

      try {
        const duration =
          Number.isFinite(videoElement.duration) && videoElement.duration > 0
            ? videoElement.duration
            : knownDuration;
        if (!duration || !Number.isFinite(duration) || duration <= 0) {
          throw new Error("Invalid video duration");
        }
        await ensureModelLoaded();
        signal.throwIfAborted();

        const totalFrames = Math.ceil(duration * SAMPLE_FPS);

        // Cap processing resolution to reduce RAM usage.
        // Masks don't need to be full HD — 640px max dimension is plenty for compositing.
        const MAX_PROCESS_DIM = 640;
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

        // Create a cloned video to avoid interfering with playback
        processingVideo = document.createElement("video");
        processingVideo.muted = true;
        processingVideo.preload = "auto";

        await waitForMediaEvent(processingVideo, "loadeddata", {
          signal,
          start: () => {
            processingVideo!.src = videoElement.src;
          },
        });

        // Process frames sequentially using seek
        for (let i = 0; i < totalFrames; i++) {
          const time = i / SAMPLE_FPS;

          // Seek to target time
          await seekVideo(
            processingVideo,
            Math.max(0, Math.min(time, duration - 0.01)),
            signal,
          );

          // Draw frame to canvas
          ctx.drawImage(processingVideo, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Send to worker and wait for result
          await processFrame(imageData.data, canvas.width, canvas.height, i);
          signal.throwIfAborted();

          // Update progress
          const pct = Math.round(((i + 1) / totalFrames) * 100);
          setProgress(pct);
        }

        setIsReady(true);
      } catch (error) {
        if (signal.aborted) return;
        masksRef.current = [];
        console.error("[useBackgroundRemoval] Processing failed:", error);
        setIsReady(false);
        throw error;
      } finally {
        if (processingVideo) releaseVideo(processingVideo);
        if (processingRef.current === controller) {
          processingRef.current = null;
          disposeWorker();
          setIsModelLoading(false);
          setIsProcessing(false);
        }
      }
    },
    [disposeWorker, ensureModelLoaded, processFrame],
  );

  // Get the nearest cached mask for a given video time
  const getMaskAtTime = useCallback(
    (time: number, fps: number = SAMPLE_FPS): MaskData | null => {
      const currentMasks = masksRef.current;
      if (currentMasks.length === 0) return null;

      // Clamp to valid range — frames are dense so direct indexing always works
      const frameIndex = Math.max(
        0,
        Math.min(Math.round(time * fps), currentMasks.length - 1),
      );
      return currentMasks[frameIndex] ?? null;
    },
    [],
  );

  // Reset all state
  const reset = useCallback(() => {
    processingRef.current?.abort();
    processingRef.current = null;
    disposeWorker();
    masksRef.current = [];
    setIsModelLoading(false);
    setIsReady(false);
    setIsProcessing(false);
    setProgress(0);
  }, [disposeWorker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      processingRef.current?.abort();
      processingRef.current = null;
      disposeWorker();
      masksRef.current = [];
    };
  }, [disposeWorker]);

  return {
    isModelLoading,
    isProcessing,
    progress,
    isReady,
    processVideo,
    getMaskAtTime,
    reset,
    processFrame,
  };
}
