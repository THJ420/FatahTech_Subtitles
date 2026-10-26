"use client";
import { drawPortraitLayout, type TrackedFace } from "@/lib/portrait-layout";

import {
  useCallback,
  useState,
  forwardRef,
  useEffect,
  memo,
  useRef,
  useMemo,
} from "react";
import { cn } from "@/lib/utils";
import {
  releaseVideo,
  waitForMediaEvent,
  withAbortSignal,
} from "@/lib/media-lifecycle";
import { formatTime, type WordStyleOverride } from "@/lib/transcript-utils";
import { VideoCaption } from "./video-caption";
import { SubtitleStyle } from "./subtitle-styling";
import {
  Camera,
  UploadIcon,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CameraRecorder } from "@/components/landing-page/camera-recorder";
import {
  SAMPLE_FPS as SAMPLE_MASK_FPS,
  type MaskData,
} from "@/hooks/useBackgroundRemoval";
import {
  renderDynamicBehindText,
  renderDynamicFrontText,
  estimateFaceFromMask,
} from "@/lib/render-subtitle";
import {
  drawBrandingWatermark,
  getBrandingWatermarkMetrics,
  WATERMARK_FONT_FAMILY,
  WATERMARK_TEXT,
} from "@/lib/export-renderer";
import { computeCropX } from "@/lib/person-tracking";
import {
  adjustTranscriptChunksForSilenceRemoval,
  createVideoCutPlan,
  getPlaybackSkipTarget,
  sourceTimeToOutputTime,
  type TimeRange,
} from "@/lib/silence-removal";
import {
  createAutoZoomCutSchedule,
  getAutoZoomCutIndex,
  getAutoZoomCssTransform,
} from "@/lib/auto-zoom";

async function readRecordedVideoDuration(file: File, signal: AbortSignal) {
  // Recorders can omit WebM duration metadata. Read packet timestamps from the
  // local file instead of seeking to an arbitrary time to force a duration.
  const { Input, BlobSource, ALL_FORMATS } = await withAbortSignal(
    import("mediabunny"),
    signal,
  );
  signal.throwIfAborted();
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const disposeInput = () => input.dispose();
  signal.addEventListener("abort", disposeInput, { once: true });
  try {
    const duration = await withAbortSignal(
      input.computeDuration(undefined, { skipLiveWait: true }),
      signal,
    );
    signal.throwIfAborted();
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } finally {
    signal.removeEventListener("abort", disposeInput);
    input.dispose();
  }
}

interface VideoUploadProps {
  onVideoSelect: (file: File) => void;
  onTimeUpdate?: (time: number) => void;
  onAspectRatioDetected?: (ratio: "16:9" | "9:16") => void;
  onDurationChange?: (duration: number) => void;
  className?: string;
  transcript?: {
    text: string;
    chunks: Array<{
      text: string;
      timestamp: [number, number];
      sourceTimestamp?: [number, number];
      disabled?: boolean;
      subtitleHidden?: boolean;
      styleOverride?: WordStyleOverride;
    }>;
  } | null;
  currentTime?: number;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyleChange?: (
    change: Partial<SubtitleStyle>,
    timestamp: [number, number],
    globally?: boolean,
  ) => void;
  mode: "word" | "phrase";
  ratio: "16:9" | "9:16";
  zoomPortrait: boolean;
  initialFile?: File | null;
  bgRemovalReady?: boolean;
  getMaskAtTime?: (time: number, fps?: number) => MaskData | null;
  getCenterX?: () => number;
  getFaces?: () => TrackedFace[];
  stackedPortrait?: boolean;
  portraitSwapped?: boolean;
  portraitZoom?: number;
  isFaceTrackingActive?: boolean;
  cropTrackingEnabled?: boolean;
  silenceRemovalRanges?: TimeRange[];
  autoZoomEnabled?: boolean;
}

const VideoUploadComponent = forwardRef<HTMLVideoElement, VideoUploadProps>(
  (
    {
      onVideoSelect,
      onTimeUpdate,
      onAspectRatioDetected,
      onDurationChange,
      className,
      transcript,
      currentTime = 0,
      subtitleStyle,
      onSubtitleStyleChange,
      mode,
      ratio,
      zoomPortrait,
      initialFile,
      bgRemovalReady = false,
      getMaskAtTime,
      getCenterX,
      getFaces,
      stackedPortrait = false,
      portraitSwapped = false,
      portraitZoom = 1,
      isFaceTrackingActive = false,
      cropTrackingEnabled = false,
      silenceRemovalRanges = [],
      autoZoomEnabled = false,
    },
    ref,
  ) => {
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Track the current blob URL so we can revoke it when it's no longer needed
    const videoObjectUrlRef = useRef<string | null>(null);
    const fileLoadRef = useRef<AbortController | null>(null);
    const skipWatchFrameRef = useRef<number>(0);
    const lastAutoZoomSyncRef = useRef(0);
    const autoZoomCutIndexRef = useRef(-1);
    const autoZoomFaceXRef = useRef(0.5);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const recordedDurationRef = useRef(0);
    const [isMuted, setIsMuted] = useState(false);
    const [isRecorderOpen, setIsRecorderOpen] = useState(false);
    // Local time state: updated directly from video's timeupdate without going through main-app
    const [localTime, setLocalTime] = useState(0);
    const processedFileRef = useRef<File | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceTrackCanvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const faceTrackAnimFrameRef = useRef<number>(0);
    const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const seekBarFillRef = useRef<HTMLDivElement>(null);
    const timeDisplayRef = useRef<HTMLSpanElement>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    // Transient seeking state in refs — avoids re-renders during drag
    const seekingRef = useRef(false);
    const seekValueRef = useRef(0);

    // Revoke the current blob URL and clear the ref
    const revokeVideoObjectUrl = useCallback(() => {
      if (videoObjectUrlRef.current) {
        URL.revokeObjectURL(videoObjectUrlRef.current);
        videoObjectUrlRef.current = null;
      }
    }, []);

    // Release pending file reads and the video URL on unmount.
    useEffect(() => {
      return () => {
        fileLoadRef.current?.abort();
        fileLoadRef.current = null;
        processedFileRef.current = null;
        revokeVideoObjectUrl();
      };
    }, [revokeVideoObjectUrl]);

    // Track video container width for responsive subtitle sizing
    useEffect(() => {
      const el = videoContainerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        setContainerWidth(entry.contentRect.width);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [videoSrc]);

    // Sync progress bar fill + time display from currentTime prop, skip while dragging.
    // Also syncs localTime so VideoCaption reflects external seeks (sidebar clicks, reset).
    useEffect(() => {
      if (seekingRef.current) return;
      setLocalTime(currentTime);
      if (seekBarFillRef.current && duration > 0) {
        seekBarFillRef.current.style.width = `${(currentTime / duration) * 100}%`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(currentTime);
      }
    }, [currentTime, duration]);

    // Whether compositing mode is active
    const isDynamicMode =
      subtitleStyle.dynamicEnabled && bgRemovalReady && getMaskAtTime;
    const isBgRemovalMode =
      bgRemovalReady && subtitleStyle.backgroundRemovalEnabled && getMaskAtTime;
    const compositingActive = isDynamicMode || isBgRemovalMode;
    const needsFaceTrackCanvas =
      (stackedPortrait || (cropTrackingEnabled && isFaceTrackingActive)) &&
      !compositingActive &&
      ratio === "9:16";
    const silenceRemovalPlan = useMemo(
      () =>
        createVideoCutPlan(
          duration,
          silenceRemovalRanges,
          transcript?.chunks ?? [],
        ),
      [duration, silenceRemovalRanges, transcript],
    );
    // Auto zoom uses the exported timeline, including both quiet sections and
    // sections removed by the user. With no cuts, use the source timeline.
    const autoZoomDuration = silenceRemovalPlan
      ? silenceRemovalPlan.outputDuration
      : duration;
    const autoZoomCutSchedule = useMemo(() => {
      const chunks = transcript?.chunks ?? [];
      const outputChunks = silenceRemovalPlan
        ? adjustTranscriptChunksForSilenceRemoval(chunks, silenceRemovalPlan)
        : chunks;
      return createAutoZoomCutSchedule(
        outputChunks
          .filter((chunk) => !chunk.disabled)
          .map((chunk) => chunk.timestamp[0]),
        autoZoomDuration,
      );
    }, [autoZoomDuration, silenceRemovalPlan, transcript]);
    const autoZoomEvalTime = silenceRemovalPlan
      ? sourceTimeToOutputTime(localTime, silenceRemovalPlan)
      : localTime;
    const autoZoomCutIndex = autoZoomEnabled
      ? getAutoZoomCutIndex(autoZoomEvalTime, autoZoomCutSchedule)
      : -1;
    if (autoZoomEnabled && autoZoomCutIndexRef.current !== autoZoomCutIndex) {
      autoZoomCutIndexRef.current = autoZoomCutIndex;
      autoZoomFaceXRef.current = needsFaceTrackCanvas
        ? 0.5
        : (getCenterX?.() ?? 0.5);
    }
    const autoZoomTransform = autoZoomEnabled
      ? getAutoZoomCssTransform(
          autoZoomEvalTime,
          autoZoomDuration,
          autoZoomFaceXRef.current,
          autoZoomCutSchedule,
        )
      : "translate(0, 0) scale(1)";
    const autoZoomStyle = autoZoomEnabled
      ? {
          transform: autoZoomTransform,
          transformOrigin: "center center",
          transition: "none",
        }
      : undefined;

    // Reset video source when ref.current.src is empty
    useEffect(() => {
      if (ref && typeof ref !== "function" && ref.current) {
        // Check if the video element has no source
        if (!ref.current.src || ref.current.src === window.location.href) {
          revokeVideoObjectUrl();
          setVideoSrc(null);
        }
      }
    }, [ref, revokeVideoObjectUrl]);

    // Reset state when component is mounted
    useEffect(() => {
      setVideoSrc(null);
      setError(null);
    }, []);

    const handleFile = useCallback(
      async (file: File) => {
        fileLoadRef.current?.abort();
        const controller = new AbortController();
        fileLoadRef.current = controller;
        recordedDurationRef.current = 0;
        setDuration(0);
        onDurationChange?.(0);
        let video: HTMLVideoElement | null = null;
        try {
          if (!file.type.startsWith("video/")) {
            throw new Error("Please select a video file");
          }

          const maxBytes = 1 * 1024 * 1024 * 1024; // 1 GB
          if (file.size > maxBytes) {
            throw new Error(
              `File is too large (${(file.size / 1024 / 1024 / 1024).toFixed(1)} GB). Please use a video under 1 GB to avoid running out of memory.`,
            );
          }

          // Create video element to check duration
          video = document.createElement("video");
          video.preload = "metadata";

          // Revoke previous blob URL before creating a new one
          revokeVideoObjectUrl();
          const objectUrl = URL.createObjectURL(file);
          videoObjectUrlRef.current = objectUrl;

          await waitForMediaEvent(video, "loadedmetadata", {
            signal: controller.signal,
            start: () => {
              video!.src = objectUrl;
            },
          });
          controller.signal.throwIfAborted();

          let nextDuration = video.duration;
          if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
            try {
              nextDuration = await readRecordedVideoDuration(
                file,
                controller.signal,
              );
              recordedDurationRef.current = nextDuration;
            } catch (durationError) {
              controller.signal.throwIfAborted();
              // A playable format may not be readable by the metadata parser.
              // Keep playback available while waiting for a finite native value.
              console.warn("Could not read the video duration", durationError);
              nextDuration = 0;
            }
          }
          controller.signal.throwIfAborted();

          // Detect aspect ratio from video dimensions
          const detectedRatio: "16:9" | "9:16" =
            video.videoHeight > video.videoWidth ? "9:16" : "16:9";

          setVideoSrc(objectUrl);
          setError(null);
          setDuration(nextDuration);
          onDurationChange?.(nextDuration);
          onVideoSelect(file);

          // Notify parent of detected aspect ratio
          if (onAspectRatioDetected) {
            onAspectRatioDetected(detectedRatio);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error ? err.message : "Error loading video";
          setError(message);
          toast.error(message);
          revokeVideoObjectUrl();
          setVideoSrc(null);
        } finally {
          if (video) releaseVideo(video);
          if (fileLoadRef.current === controller) fileLoadRef.current = null;
        }
      },
      [
        onVideoSelect,
        onAspectRatioDetected,
        onDurationChange,
        revokeVideoObjectUrl,
      ],
    );

    const handleDurationChange = useCallback(
      (event: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        if (
          video.src !== videoObjectUrlRef.current ||
          // After seeking, a recording may report only its last frame timestamp.
          // The packet-derived value also includes that frame's duration.
          recordedDurationRef.current > 0 ||
          !Number.isFinite(video.duration) ||
          video.duration <= 0
        ) {
          return;
        }
        setDuration(video.duration);
        onDurationChange?.(video.duration);
      },
      [onDurationChange],
    );

    const handleRecordedVideo = useCallback(
      async (file: File) => {
        setIsRecorderOpen(false);
        await handleFile(file);
      },
      [handleFile],
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();

        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      },
      [handleFile],
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);

        // Reset the input value to allow selecting the same file again
        e.target.value = "";
      },
      [handleFile],
    );

    useEffect(() => {
      if (!initialFile) {
        return;
      }

      if (processedFileRef.current === initialFile) {
        return;
      }

      processedFileRef.current = initialFile;
      void handleFile(initialFile);
    }, [initialFile, handleFile]);

    // Keep source timestamps unchanged: editing and restoring words use them as IDs.
    const disabledRanges = useMemo(() => {
      return silenceRemovalPlan
        ? silenceRemovalPlan.removedRanges.map((range) => [
            range.startTime,
            range.endTime,
          ])
        : [];
    }, [silenceRemovalPlan]);

    const syncPreviewTime = useCallback(
      (time: number) => {
        setLocalTime(time);
        if (seekBarFillRef.current && duration > 0) {
          seekBarFillRef.current.style.width = `${(time / duration) * 100}%`;
        }
        if (timeDisplayRef.current) {
          timeDisplayRef.current.textContent = formatTime(time);
        }
        onTimeUpdate?.(time);
      },
      [duration, onTimeUpdate],
    );

    const maybeSkipDisabledRange = useCallback(
      (video: HTMLVideoElement) => {
        // A seek keeps playback running. Wait for its decoded frame before
        // checking another cut, and leave paused editing/export seeks alone.
        if (video.paused || video.seeking || seekingRef.current) return false;
        const target = getPlaybackSkipTarget(
          video.currentTime,
          disabledRanges,
          duration,
        );
        if (target === null) return false;
        video.currentTime = target;
        syncPreviewTime(target);
        return true;
      },
      [duration, disabledRanges, syncPreviewTime],
    );

    // Function to handle time updates and skip disabled segments
    const handleTimeUpdate = useCallback(
      (e: React.SyntheticEvent<HTMLVideoElement>) => {
        // During seeking the progress bar drives time — ignore video timeupdate
        if (seekingRef.current) return;

        const video = e.currentTarget;
        syncPreviewTime(video.currentTime);
        maybeSkipDisabledRange(video);
      },
      [maybeSkipDisabledRange, syncPreviewTime],
    );

    useEffect(() => {
      const videoEl = ref && typeof ref !== "function" ? ref.current : null;
      if (!videoEl || !isPlaying) return;

      const watch = () => {
        if (!videoEl.paused) {
          if (autoZoomEnabled) {
            const now = performance.now();
            if (now - lastAutoZoomSyncRef.current > 90) {
              lastAutoZoomSyncRef.current = now;
              syncPreviewTime(videoEl.currentTime);
            }
          }
          maybeSkipDisabledRange(videoEl);
          skipWatchFrameRef.current = requestAnimationFrame(watch);
        }
      };

      skipWatchFrameRef.current = requestAnimationFrame(watch);
      return () => {
        if (skipWatchFrameRef.current) {
          cancelAnimationFrame(skipWatchFrameRef.current);
          skipWatchFrameRef.current = 0;
        }
      };
    }, [
      autoZoomEnabled,
      isPlaying,
      maybeSkipDisabledRange,
      ref,
      syncPreviewTime,
    ]);
    // Canvas compositing loop for background removal preview
    useEffect(() => {
      if (!compositingActive || !canvasRef.current) {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = 0;
        }
        return;
      }

      const videoEl = ref && typeof ref !== "function" ? ref.current : null;
      if (!videoEl) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Create reusable temp canvases
      if (!blurCanvasRef.current) {
        blurCanvasRef.current = document.createElement("canvas");
      }
      const fgCanvas = document.createElement("canvas");
      const fgCtx = fgCanvas.getContext("2d");
      const maskCanvas = document.createElement("canvas");
      const maskCtx = maskCanvas.getContext("2d");

      // Reusable ImageData for mask — avoids allocating ~8MB per frame
      let cachedMaskImageData: ImageData | null = null;
      let lastMaskW = 0;
      let lastMaskH = 0;
      // Track last mask reference — skip expensive pixel conversion when mask hasn't changed (5fps cache)
      let lastMask: ReturnType<typeof getMaskAtTime> = null;

      // Track last rendered time to skip redundant draws when paused
      let lastRenderedTime = -1;

      const render = () => {
        const displayWidth = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        if (
          videoEl.readyState < 2 ||
          videoEl.seeking ||
          displayWidth === 0 ||
          displayHeight === 0
        ) {
          animFrameRef.current = requestAnimationFrame(render);
          return;
        }

        const time = videoEl.currentTime;
        const sizeChanged =
          canvas.width !== displayWidth || canvas.height !== displayHeight;

        // Skip rendering when paused and we already drew this frame
        if (videoEl.paused && time === lastRenderedTime && !sizeChanged) {
          animFrameRef.current = requestAnimationFrame(render);
          return;
        }
        lastRenderedTime = time;

        // Match canvas to displayed size
        if (sizeChanged) {
          canvas.width = displayWidth;
          canvas.height = displayHeight;
        }

        // Look ahead by half a frame interval so the mask is centered around the
        // current time rather than always lagging behind (reduces perceived lag by ~50%).
        const mask = getMaskAtTime!(time + 0.5 / SAMPLE_MASK_FPS);

        // Compute center-crop region when canvas AR differs from video AR
        // (e.g. landscape video shown in a 9:16 container with object-cover)
        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;
        const w = canvas.width;
        const h = canvas.height;
        const canvasAR = w / h;
        const videoAR = vw / vh;
        let sx = 0,
          sy = 0,
          sw = vw,
          sh = vh;
        if (Math.abs(canvasAR - videoAR) > 0.01) {
          if (videoAR > canvasAR) {
            // Video is wider — crop sides
            sw = Math.round(vh * canvasAR);
            sx = computeCropX(
              getCenterX?.() ?? 0.5,
              vw,
              sw,
              cropTrackingEnabled && isFaceTrackingActive,
            );
          } else {
            // Video is taller — crop top/bottom
            sh = Math.round(vw / canvasAR);
            sy = Math.round((vh - sh) / 2);
          }
        }

        if (!mask) {
          ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);
          animFrameRef.current = requestAnimationFrame(render);
          return;
        }

        const isDynamic = subtitleStyle.dynamicEnabled;

        // Step 1: Draw background layer
        if (isDynamic) {
          // Dynamic mode: keep original video as background
          ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);
        } else if (subtitleStyle.backgroundType === "blur") {
          const blurCanvas = blurCanvasRef.current!;
          if (blurCanvas.width !== w || blurCanvas.height !== h) {
            blurCanvas.width = w;
            blurCanvas.height = h;
          }
          const blurCtx = blurCanvas.getContext("2d");
          if (blurCtx) {
            blurCtx.filter = "blur(20px)";
            blurCtx.drawImage(videoEl, 0, 0, w, h);
            blurCtx.filter = "none";
            ctx.drawImage(blurCanvas, 0, 0);
          }
        } else {
          ctx.fillStyle = subtitleStyle.solidBackgroundColor;
          ctx.fillRect(0, 0, w, h);
        }

        // Step 2: Render subtitle behind person (dynamic mode only)
        if (isDynamic && transcript) {
          renderDynamicBehindText(ctx, transcript, time, subtitleStyle, w, h);
        }

        // Step 3: Draw masked foreground using canvas compositing
        if (fgCtx && maskCtx) {
          if (fgCanvas.width !== w || fgCanvas.height !== h) {
            fgCanvas.width = w;
            fgCanvas.height = h;
          }

          // Draw video frame onto foreground canvas (with crop)
          fgCtx.clearRect(0, 0, w, h);
          fgCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);

          // Resize mask canvas only when mask dimensions change
          if (
            maskCanvas.width !== mask.width ||
            maskCanvas.height !== mask.height
          ) {
            maskCanvas.width = mask.width;
            maskCanvas.height = mask.height;
          }

          // Only re-process mask pixels when the mask reference changes (5fps cache → skip ~55/60 frames)
          if (mask !== lastMask) {
            lastMask = mask;

            if (lastMaskW !== mask.width || lastMaskH !== mask.height) {
              cachedMaskImageData = maskCtx.createImageData(
                mask.width,
                mask.height,
              );
              lastMaskW = mask.width;
              lastMaskH = mask.height;
            }

            const maskImageData = cachedMaskImageData!;
            const pixels = maskImageData.data;
            for (let i = 0; i < mask.data.length; i++) {
              const idx = i * 4;
              pixels[idx] = 255; // R
              pixels[idx + 1] = 255; // G
              pixels[idx + 2] = 255; // B
              pixels[idx + 3] = mask.data[i]; // A = mask alpha
            }
            maskCtx.putImageData(maskImageData, 0, 0);
          }

          // Use destination-in to clip the video frame to the mask shape.
          // Apply the same crop as the video so the mask aligns with the
          // visible region (e.g. landscape → portrait center/face-track crop).
          fgCtx.globalCompositeOperation = "destination-in";
          const msx = (sx / vw) * maskCanvas.width;
          const msy = (sy / vh) * maskCanvas.height;
          const msw = (sw / vw) * maskCanvas.width;
          const msh = (sh / vh) * maskCanvas.height;
          fgCtx.drawImage(maskCanvas, msx, msy, msw, msh, 0, 0, w, h);
          fgCtx.globalCompositeOperation = "source-over";

          // Draw masked foreground onto main canvas
          ctx.drawImage(fgCanvas, 0, 0);
        }

        // Step 4: Render front depth text. Normal captions use VideoCaption.
        if (isDynamic && transcript) {
          const faceBounds = estimateFaceFromMask(
            mask.data,
            mask.width,
            mask.height,
            w,
            h,
          );
          renderDynamicFrontText(
            ctx,
            transcript,
            time,
            subtitleStyle,
            w,
            h,
            faceBounds,
          );
        }

        // Step 5: Watermark (fatahtech.com)
        drawBrandingWatermark(ctx, w, h, subtitleStyle.showWatermark);

        animFrameRef.current = requestAnimationFrame(render);
      };

      animFrameRef.current = requestAnimationFrame(render);

      return () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = 0;
        }
      };
    }, [
      compositingActive,
      ref,
      subtitleStyle,
      transcript,
      getMaskAtTime,
      isFaceTrackingActive,
      cropTrackingEnabled,
      getCenterX,
      videoSrc,
    ]);

    // Non-compositing face tracking canvas loop:
    // When face tracking is active but compositing is NOT active,
    // render a canvas that mirrors the video with dynamic crop.
    useEffect(() => {
      if (!needsFaceTrackCanvas || !faceTrackCanvasRef.current) {
        if (faceTrackAnimFrameRef.current) {
          cancelAnimationFrame(faceTrackAnimFrameRef.current);
          faceTrackAnimFrameRef.current = 0;
        }
        return;
      }

      const videoEl = ref && typeof ref !== "function" ? ref.current : null;
      if (!videoEl) return;

      const canvas = faceTrackCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let lastRenderedTime = -1;
      let lastFaces: TrackedFace[] | undefined;

      const render = () => {
        const displayWidth = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        if (
          videoEl.readyState < 2 ||
          videoEl.seeking ||
          displayWidth === 0 ||
          displayHeight === 0
        ) {
          faceTrackAnimFrameRef.current = requestAnimationFrame(render);
          return;
        }

        const time = videoEl.currentTime;
        const sizeChanged =
          canvas.width !== displayWidth || canvas.height !== displayHeight;
        const faces = getFaces?.();
        if (
          (!stackedPortrait || faces === lastFaces) &&
          videoEl.paused &&
          time === lastRenderedTime &&
          !sizeChanged
        ) {
          faceTrackAnimFrameRef.current = requestAnimationFrame(render);
          return;
        }
        lastRenderedTime = time;
        lastFaces = faces;

        if (sizeChanged) {
          canvas.width = displayWidth;
          canvas.height = displayHeight;
        }

        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;
        const w = canvas.width;
        const h = canvas.height;
        const canvasAR = w / h;
        const videoAR = vw / vh;

        let sx = 0,
          sy = 0,
          sw = vw,
          sh = vh;
        if (videoAR > canvasAR) {
          sw = Math.round(vh * canvasAR);
          sx = getCenterX
            ? computeCropX(getCenterX(), vw, sw)
            : Math.round((vw - sw) / 2);
        } else if (videoAR < canvasAR) {
          sh = Math.round(vw / canvasAR);
          sy = Math.round((vh - sh) / 2);
        }

        if (stackedPortrait) {
          drawPortraitLayout(
            ctx,
            videoEl,
            vw,
            vh,
            w,
            h,
            faces ?? [],
            portraitSwapped,
            portraitZoom,
          );
        } else {
          ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);
        }
        faceTrackAnimFrameRef.current = requestAnimationFrame(render);
      };

      faceTrackAnimFrameRef.current = requestAnimationFrame(render);

      return () => {
        if (faceTrackAnimFrameRef.current) {
          cancelAnimationFrame(faceTrackAnimFrameRef.current);
          faceTrackAnimFrameRef.current = 0;
        }
      };
    }, [
      needsFaceTrackCanvas,
      ref,
      ratio,
      getCenterX,
      videoSrc,
      stackedPortrait,
      portraitSwapped,
      portraitZoom,
      getFaces,
    ]);

    const watermark = getBrandingWatermarkMetrics(
      containerWidth,
      containerWidth * (ratio === "16:9" ? 9 / 16 : 16 / 9),
    );

    return (
      <div
        className={cn(
          "relative border-0 lg:border-2 lg:border-dashed rounded-lg transition-colors overflow-hidden",
          videoSrc ? "" : "min-h-[300px]",
          className,
        )}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={handleDrop}
      >
        {videoSrc ? (
          <div className="relative flex flex-col items-center justify-center w-full">
            <div data-player className="relative mx-auto flex w-full flex-col">
              <div
                ref={videoContainerRef}
                data-video-frame
                className="relative flex w-full justify-center overflow-hidden bg-black"
                style={{
                  aspectRatio: ratio === "16:9" ? "16/9" : "9/16",
                }}
              >
                {/* Keep the source frame visible until an overlay has drawn. */}
                <video
                  ref={ref}
                  src={videoSrc}
                  playsInline
                  preload="auto"
                  className={cn(
                    "absolute inset-0 block h-full w-full",
                    ratio === "9:16" && !zoomPortrait
                      ? "object-cover"
                      : "object-contain",
                  )}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onLoadedMetadata={handleDurationChange}
                  onDurationChange={handleDurationChange}
                  onClick={() => {
                    if (!compositingActive && !needsFaceTrackCanvas) {
                      const videoEl =
                        ref && typeof ref !== "function" ? ref.current : null;
                      if (videoEl) {
                        if (videoEl.paused) videoEl.play().catch(() => {});
                        else videoEl.pause();
                      }
                    }
                  }}
                  style={{
                    aspectRatio: ratio === "16:9" ? "16/9" : "9/16",
                    ...autoZoomStyle,
                  }}
                />
                {/* Canvas overlay for background removal compositing */}
                {compositingActive && (
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 h-full w-full cursor-pointer"
                    style={{
                      aspectRatio: ratio === "16:9" ? "16/9" : "9/16",
                      ...autoZoomStyle,
                    }}
                    onClick={() => {
                      const videoEl =
                        ref && typeof ref !== "function" ? ref.current : null;
                      if (videoEl) {
                        if (videoEl.paused) videoEl.play().catch(() => {});
                        else videoEl.pause();
                      }
                    }}
                  />
                )}
                {/* Canvas overlay for face-tracking crop (non-compositing mode) */}
                {needsFaceTrackCanvas && (
                  <canvas
                    ref={faceTrackCanvasRef}
                    className="absolute inset-0 h-full w-full cursor-pointer"
                    style={{
                      aspectRatio: "9/16",
                      ...autoZoomStyle,
                    }}
                    onClick={() => {
                      const videoEl =
                        ref && typeof ref !== "function" ? ref.current : null;
                      if (videoEl) {
                        if (videoEl.paused) videoEl.play().catch(() => {});
                        else videoEl.pause();
                      }
                    }}
                  />
                )}
                {/* Watermark DOM overlay (non-compositing mode) */}
                {subtitleStyle.showWatermark !== false &&
                  !compositingActive && (
                    <div
                      className="absolute bottom-[1.8%] right-[2.5%] pointer-events-none z-20"
                      style={{
                        fontSize: watermark.fontSize,
                        fontWeight: 700,
                        fontFamily: WATERMARK_FONT_FAMILY,
                        color: "rgba(255, 255, 255, 0.42)",
                        textShadow: `0 ${watermark.shadowOffsetY}px ${watermark.shadowBlur}px rgba(0, 0, 0, 0.5)`,
                      }}
                    >
                      {WATERMARK_TEXT}
                    </div>
                  )}
                {/* Only depth text needs canvas layers; all other previews share
                    the same caption sizing, effects, and face placement. */}
                {transcript && !isDynamicMode && (
                  <VideoCaption
                    transcript={transcript}
                    currentTime={localTime}
                    style={subtitleStyle}
                    mode={mode}
                    ratio={ratio}
                    getFaceX={getCenterX}
                    containerWidth={containerWidth}
                    onStyleChange={
                      isPlaying ? undefined : onSubtitleStyleChange
                    }
                    onInteractionStart={() => {
                      if (ref && typeof ref !== "function")
                        ref.current?.pause();
                    }}
                  />
                )}
              </div>
              {/* Custom player controls — always visible */}
              <div
                data-player-controls
                className="flex w-full shrink-0 items-center gap-2 rounded-b-lg bg-black/90 px-3 py-2"
              >
                {/* Play/Pause */}
                <button
                  type="button"
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                  onClick={() => {
                    const videoEl =
                      ref && typeof ref !== "function" ? ref.current : null;
                    if (videoEl) {
                      if (videoEl.paused) videoEl.play().catch(() => {});
                      else videoEl.pause();
                    }
                  }}
                  className="text-white hover:text-white/80 transition-colors shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>

                {/* Time — updated via ref during drag to avoid re-renders */}
                <span
                  ref={timeDisplayRef}
                  className="text-white text-xs tabular-nums shrink-0"
                >
                  {formatTime(currentTime)}
                </span>

                {/* Custom progress bar — div-based with pointer capture for reliable mobile touch.
                    No pause/resume during drag (avoids mobile autoplay restrictions).
                    Seeks video only on release (avoids overwhelming mobile decoder).
                    Calls onTimeUpdate during drag so subtitles stay in sync. */}
                <div
                  role="slider"
                  tabIndex={duration > 0 ? 0 : -1}
                  aria-disabled={duration <= 0}
                  aria-valuemin={0}
                  aria-valuemax={duration || 1}
                  aria-valuenow={currentTime}
                  aria-label="Seek"
                  className="flex-1 h-8 flex items-center cursor-pointer touch-none select-none"
                  onPointerDown={(e) => {
                    if (duration <= 0) return;
                    seekingRef.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);

                    const rect = e.currentTarget.getBoundingClientRect();
                    const fraction = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width),
                    );
                    const time = fraction * (duration || 1);
                    seekValueRef.current = time;

                    if (seekBarFillRef.current)
                      seekBarFillRef.current.style.width = `${fraction * 100}%`;
                    if (timeDisplayRef.current)
                      timeDisplayRef.current.textContent = formatTime(time);
                    setLocalTime(time);
                    onTimeUpdate?.(time);
                  }}
                  onPointerMove={(e) => {
                    if (!seekingRef.current) return;

                    const rect = e.currentTarget.getBoundingClientRect();
                    const fraction = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width),
                    );
                    const time = fraction * (duration || 1);
                    seekValueRef.current = time;

                    if (seekBarFillRef.current)
                      seekBarFillRef.current.style.width = `${fraction * 100}%`;
                    if (timeDisplayRef.current)
                      timeDisplayRef.current.textContent = formatTime(time);
                    setLocalTime(time);
                    onTimeUpdate?.(time);
                  }}
                  onPointerUp={() => {
                    if (!seekingRef.current) return;
                    seekingRef.current = false;
                    const videoEl =
                      ref && typeof ref !== "function" ? ref.current : null;
                    if (videoEl) {
                      videoEl.currentTime = seekValueRef.current;
                    }
                  }}
                  onLostPointerCapture={() => {
                    // Fallback if pointer capture is lost (e.g. browser tab switch)
                    if (seekingRef.current) {
                      seekingRef.current = false;
                      const videoEl =
                        ref && typeof ref !== "function" ? ref.current : null;
                      if (videoEl) {
                        videoEl.currentTime = seekValueRef.current;
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (duration <= 0) return;
                    const videoEl =
                      ref && typeof ref !== "function" ? ref.current : null;
                    if (!videoEl) return;
                    if (e.key === "ArrowLeft") {
                      videoEl.currentTime = Math.max(
                        0,
                        videoEl.currentTime - 5,
                      );
                      e.preventDefault();
                    } else if (e.key === "ArrowRight") {
                      videoEl.currentTime = Math.min(
                        duration,
                        videoEl.currentTime + 5,
                      );
                      e.preventDefault();
                    }
                  }}
                >
                  <div className="relative w-full h-1 bg-white/30 rounded-full overflow-hidden">
                    <div
                      ref={seekBarFillRef}
                      className="absolute inset-y-0 left-0 bg-white rounded-full"
                    />
                  </div>
                </div>

                {/* Duration */}
                <span className="text-white text-xs tabular-nums shrink-0">
                  {duration > 0 ? formatTime(duration) : "--:--"}
                </span>

                {/* Mute toggle */}
                <button
                  type="button"
                  aria-label={isMuted ? "Unmute video" : "Mute video"}
                  onClick={() => {
                    const videoEl =
                      ref && typeof ref !== "function" ? ref.current : null;
                    if (videoEl) {
                      videoEl.muted = !videoEl.muted;
                      setIsMuted(!isMuted);
                    }
                  }}
                  className="text-white hover:text-white/80 transition-colors shrink-0"
                >
                  {isMuted ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <input
              type="file"
              accept="video/*"
              onChange={handleChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <p className="mb-2">
              Drag and drop a video file here, or click to select{" "}
              <UploadIcon className="mx-auto mt-8" />
            </p>
            <p className="text-xs text-muted-foreground">
              Supports MP4, WebM, and MOV formats, max 1 GB
            </p>
            <button
              type="button"
              onClick={() => setIsRecorderOpen(true)}
              className="relative z-20 mt-4 inline-flex items-center gap-2 rounded-md border border-red-500 bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <span className="pointer-events-none absolute -inset-1 -z-10 rounded-lg bg-red-500/30 animate-ping" />
              <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
              <Camera className="h-4 w-4" strokeWidth={1.5} />
              Record with camera
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive text-center mt-2">{error}</p>
        )}

        <Dialog open={isRecorderOpen} onOpenChange={setIsRecorderOpen}>
          <DialogContent
            className="overflow-hidden p-0 sm:max-w-2xl"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">Record a video</DialogTitle>
            <DialogDescription className="sr-only">
              Record a video with an available camera and use it for subtitles.
            </DialogDescription>
            <CameraRecorder
              onVideoReady={(file) => void handleRecordedVideo(file)}
              onCancel={() => setIsRecorderOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  },
);

VideoUploadComponent.displayName = "VideoUpload";

// Memoized export for better performance
export const VideoUpload = memo(VideoUploadComponent);
