import {
  orderFaces,
  createFaceSmoother,
  type TrackedFace,
} from "@/lib/portrait-layout";
import { useRef, useCallback, useState, useEffect } from "react";
import { seekVideo, withAbortSignal } from "@/lib/media-lifecycle";
import {
  type PositionKeyframe,
  type PositionTimeline,
  smoothCenterX,
  smoothTimeline,
} from "@/lib/person-tracking";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";

export interface UseFaceTrackingReturn {
  isLoading: boolean;
  faceCount: number;
  getFaces: () => TrackedFace[];
  startTracking: (videoElement: HTMLVideoElement) => void;
  stopTracking: () => void;
  getCenterX: () => number;
  buildExportTimeline: (
    videoElement: HTMLVideoElement,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
    knownDuration?: number,
  ) => Promise<PositionTimeline>;
}

type FaceDetector = import("@mediapipe/tasks-vision").FaceDetector;

export function useFaceTracking(): UseFaceTrackingReturn {
  const [faceCount, setFaceCount] = useState(0);
  const smoothFacesRef = useRef(createFaceSmoother());
  const facesRef = useRef<TrackedFace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const detectorRef = useRef<FaceDetector | null>(null);
  const initPromiseRef = useRef<Promise<FaceDetector> | null>(null);
  const rafRef = useRef<number>(0);
  const smoothedCenterXRef = useRef<number>(0.5);
  const lastTimeRef = useRef<number>(-1);
  const timelineRef = useRef(new Map<number, PositionKeyframe>());
  const trackingActiveRef = useRef(false);
  const trackedSrcRef = useRef<string>("");
  const trackingIdRef = useRef(0);
  const lifecycleIdRef = useRef(0);
  const exportControllerRef = useRef<AbortController | null>(null);

  const ensureDetector = useCallback(async (): Promise<FaceDetector> => {
    if (detectorRef.current) return detectorRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    setIsLoading(true);
    const lifecycleId = lifecycleIdRef.current;
    initPromiseRef.current = (async () => {
      const { FaceDetector, FilesetResolver } =
        await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      // Suppress TFLite WASM INFO log ("Created TensorFlow Lite XNNPACK delegate for CPU")
      // that emscripten routes through console.error
      const origError = console.error;
      console.error = (...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("Created TensorFlow Lite XNNPACK delegate")
        )
          return;
        origError.apply(console, args);
      };
      let detector: FaceDetector;
      try {
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
      } finally {
        console.error = origError;
      }
      if (lifecycleId !== lifecycleIdRef.current) {
        detector.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      detectorRef.current = detector;
      setIsLoading(false);
      return detector;
    })();

    initPromiseRef.current.catch(() => {
      if (lifecycleId !== lifecycleIdRef.current) return;
      initPromiseRef.current = null;
      setIsLoading(false);
    });

    return initPromiseRef.current;
  }, []);

  const suppressedRef = useRef(false);

  const extractCenterX = useCallback(
    (detector: FaceDetector, video: HTMLVideoElement, timestamp: number) => {
      let result;
      try {
        // The first detectForVideo call triggers a TFLite INFO log via console.error.
        // Suppress it once so it doesn't trip the Next.js dev error overlay.
        if (!suppressedRef.current) {
          suppressedRef.current = true;
          const origError = console.error;
          console.error = (...args: unknown[]) => {
            if (
              typeof args[0] === "string" &&
              args[0].includes("Created TensorFlow Lite XNNPACK delegate")
            )
              return;
            origError.apply(console, args);
          };
          try {
            result = detector.detectForVideo(video, timestamp);
          } finally {
            console.error = origError;
          }
        } else {
          result = detector.detectForVideo(video, timestamp);
        }
      } catch {
        return null;
      }

      const boxes = result.detections
        .map((d) => d.boundingBox)
        .filter((b): b is NonNullable<typeof b> => !!b)
        .sort((a, b) => b.width * b.height - a.width * a.height);
      const faces = boxes.slice(0, 2).map((b) => ({
        x: (b.originX + b.width / 2) / video.videoWidth,
        y: (b.originY + b.height / 2) / video.videoHeight,
      }));
      return {
        centerX: faces[0]?.x ?? null,
        faces: orderFaces(faces),
        count: boxes.length,
      };
    },
    [],
  );

  const startTracking = useCallback(
    (videoElement: HTMLVideoElement) => {
      if (trackingActiveRef.current) return;
      trackingActiveRef.current = true;
      const trackingId = ++trackingIdRef.current;
      // Only reset timeline when the video source changes (not on ratio/setting changes)
      if (videoElement.src !== trackedSrcRef.current) {
        trackedSrcRef.current = videoElement.src;
        smoothedCenterXRef.current = 0.5;
        lastTimeRef.current = -1;
        facesRef.current = [];
        smoothFacesRef.current = createFaceSmoother();
        setFaceCount(0);
        timelineRef.current.clear();
      }

      ensureDetector()
        .then((detector) => {
          if (
            !trackingActiveRef.current ||
            trackingId !== trackingIdRef.current
          )
            return;

          const render = () => {
            if (
              !trackingActiveRef.current ||
              trackingId !== trackingIdRef.current
            )
              return;

            const time = videoElement.currentTime;
            // Skip if video doesn't have frame data yet or time hasn't changed
            if (
              videoElement.readyState >= 2 &&
              !videoElement.seeking &&
              time !== lastTimeRef.current &&
              !exportControllerRef.current
            ) {
              lastTimeRef.current = time;
              // MediaPipe needs a monotonically increasing timestamp in ms
              const tsMs = performance.now();
              const detection = extractCenterX(detector, videoElement, tsMs);
              const rawCx = detection?.centerX ?? null;
              facesRef.current = smoothFacesRef.current(
                detection?.faces ?? [],
                time,
              );
              setFaceCount(detection?.count ?? 0);

              if (rawCx !== null) {
                smoothedCenterXRef.current = smoothCenterX(
                  smoothedCenterXRef.current,
                  rawCx,
                );
              }
              // Record missed detections too, so export does not reuse stale faces.
              timelineRef.current.set(Math.floor(time * 8), {
                time,
                faces: facesRef.current,
                centerX: smoothedCenterXRef.current,
              });
              // On no face: hold last position (smoothedCenterXRef stays)
            }

            rafRef.current = requestAnimationFrame(render);
          };

          rafRef.current = requestAnimationFrame(render);
        })
        .catch(() => {
          if (trackingId === trackingIdRef.current)
            trackingActiveRef.current = false;
        });
    },
    [ensureDetector, extractCenterX],
  );

  const stopTracking = useCallback(() => {
    trackingIdRef.current++;
    trackingActiveRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const timeline = timelineRef.current;
    return () => {
      lifecycleIdRef.current = lifecycleIdRef.current + 1;
      stopTracking();
      exportControllerRef.current?.abort();
      exportControllerRef.current = null;
      detectorRef.current?.close();
      detectorRef.current = null;
      initPromiseRef.current = null;
      timeline.clear();
    };
  }, [stopTracking]);

  const getFaces = useCallback(() => facesRef.current, []);

  const getCenterX = useCallback((): number => {
    return smoothedCenterXRef.current;
  }, []);

  const buildExportTimeline = useCallback(
    async (
      videoElement: HTMLVideoElement,
      onProgress?: (percent: number) => void,
      signal?: AbortSignal,
      knownDuration?: number,
    ): Promise<PositionTimeline> => {
      const duration =
        Number.isFinite(videoElement.duration) && videoElement.duration > 0
          ? videoElement.duration
          : knownDuration;
      signal?.throwIfAborted();
      if (!duration || !Number.isFinite(duration) || duration <= 0) return [];

      // Use preview timeline only if it covers at least 90% of the video.
      // Partial data (e.g. user watched first 5s of a 30s video) would cause
      // the export crop to lock at the last tracked position for the rest.
      const preview = Array.from(timelineRef.current.values()).sort(
        (a, b) => a.time - b.time,
      );
      if (
        videoElement.src === trackedSrcRef.current &&
        preview.length >= duration * 8 * 0.9 &&
        preview[preview.length - 1].time >= duration * 0.9
      ) {
        return preview;
      }

      // Scan the video at 2fps — face positions change slowly and the
      // timeline is interpolated/smoothed, so 2fps is plenty while being
      // 2.5× faster than the previous 5fps scan.
      exportControllerRef.current?.abort();
      const controller = new AbortController();
      exportControllerRef.current = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const exportSignal = controller.signal;
      const step = 1 / 2; // 2fps
      const totalSteps = Math.ceil(duration / step);
      const timeline: PositionTimeline = [];

      // Save and pause
      const wasPlaying = !videoElement.paused;
      if (wasPlaying) videoElement.pause();
      const savedTime = videoElement.currentTime;
      const savedSrc = videoElement.src;

      try {
        const detector = await withAbortSignal(ensureDetector(), exportSignal);
        exportSignal.throwIfAborted();
        const smoothFaces = createFaceSmoother();
        let stepIndex = 0;
        for (let t = 0; t < duration; t += step) {
          // Report progress
          if (onProgress && stepIndex % 4 === 0) {
            onProgress(Math.min(100, (stepIndex / totalSteps) * 100));
          }
          stepIndex++;

          // Add the seeked listener BEFORE setting currentTime so we never miss
          // the event. Skip the seek entirely if already at the target time.
          await seekVideo(videoElement, t, exportSignal);

          const tsMs = performance.now();
          const detection = extractCenterX(detector, videoElement, tsMs);
          const rawCx = detection?.centerX ?? null;
          const faces = smoothFaces(detection?.faces ?? [], t);
          if (rawCx !== null) {
            timeline.push({ time: t, centerX: rawCx, faces });
          } else if (timeline.length > 0) {
            // Hold last known position
            timeline.push({
              time: t,
              faces,
              centerX: timeline[timeline.length - 1].centerX,
            });
          } else {
            timeline.push({ time: t, centerX: 0.5, faces });
          }
        }

        return smoothTimeline(timeline);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (exportControllerRef.current === controller) {
          exportControllerRef.current = null;
          if (videoElement.src === savedSrc) {
            videoElement.currentTime = savedTime;
            if (wasPlaying) void videoElement.play().catch(() => {});
          }
        }
      }
    },
    [ensureDetector, extractCenterX],
  );

  return {
    isLoading,
    faceCount,
    getFaces,
    startTracking,
    stopTracking,
    getCenterX,
    buildExportTimeline,
  };
}
