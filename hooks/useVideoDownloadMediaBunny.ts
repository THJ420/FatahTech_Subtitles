import { ExportBuffer } from "@/lib/export-buffer";
import { ensureAacEncoder } from "@/lib/aac-encoder";
import { getExportDimensions } from "@/lib/export-settings";
import {
  drawPortraitLayout,
  interpolateFaces,
  type TrackedFace,
} from "@/lib/portrait-layout";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type RefObject,
} from "react";
import {
  Input,
  Output,
  CanvasSource,
  AudioSampleSink,
  AudioSampleSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  StreamTarget,
  BlobSource,
  VideoSampleSink,
  VideoSample,
  ALL_FORMATS,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW,
  QUALITY_VERY_HIGH,
} from "mediabunny";
import type { StreamTargetChunk } from "mediabunny";
import { seekVideo } from "@/lib/media-lifecycle";
import { SubtitleStyle } from "@/components/subtitle-styling";
import { processTranscriptChunks } from "@/lib/transcript-utils";
import { estimateFaceFromMask, type FaceBounds } from "@/lib/render-subtitle";
import type { MaskData } from "@/hooks/useBackgroundRemoval";
import {
  type PositionTimeline,
  interpolateCenterX,
  computeCropX,
} from "@/lib/person-tracking";
import {
  type TranscriptChunk,
  isPhraseChunk,
  drawBrandingWatermark,
  renderSubtitle,
  renderDynamicBehindInExport,
  renderDynamicFrontInExport,
} from "@/lib/export-renderer";
import {
  adjustTranscriptChunksForSilenceRemoval,
  createVideoCutPlan,
  isSourceTimeRemoved,
  outputTimeToSourceTime,
  sourceTimeToOutputTime,
  type TimeRange,
} from "@/lib/silence-removal";
import {
  createAutoZoomCutSchedule,
  drawImageWithAutoZoom,
  getAutoZoomCutIndex,
} from "@/lib/auto-zoom";

interface UseVideoDownloadMediaBunnyProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoDuration?: number;
  transcriptChunks: TranscriptChunk[];
  subtitleStyle: SubtitleStyle;
  mode: "word" | "phrase";
  ratio?: "16:9" | "9:16";
  format?: "mp4" | "webm";
  quality?: "low" | "medium" | "high" | "very_high";
  fps?: number;
  bgRemovalReady?: boolean;
  processFrame?: (
    imageData: Uint8ClampedArray,
    width: number,
    height: number,
    frameIndex: number,
  ) => Promise<MaskData>;
  getMaskAtTime?: (time: number, fps?: number) => MaskData | null;
  buildExportTimeline?: (
    videoElement: HTMLVideoElement,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
    knownDuration?: number,
  ) => Promise<PositionTimeline>;
  silenceRemovalRanges?: TimeRange[];
  autoZoomEnabled?: boolean;
  cropTrackingEnabled?: boolean;
  stackedPortrait?: boolean;
  portraitSwapped?: boolean;
  portraitZoom?: number;
}

interface ExportDiagnostics {
  bitrate: number | string;
  bitrateMode?: string;
  encoderCodec?: string;
  format: "mp4" | "webm";
  frameRate: number;
  height: number;
  isMobile: boolean;
  latencyMode?: string;
  mimeType?: string;
  quality: "low" | "medium" | "high" | "very_high";
  ratio: "16:9" | "9:16";
  requestedCodec?: string;
  resolvedCodecString?: string;
  sourceCanDecode?: boolean;
  sourceCodec?: string;
  sourceIsHevc?: boolean;
  width: number;
}

// Quality mapping
const qualityMap = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  very_high: QUALITY_VERY_HIGH,
} as const;

/** Binary search for the subtitle chunk active at `time`. Assumes chunks are sorted by start time. */
function findChunkAtTime(
  chunks: TranscriptChunk[],
  time: number,
): TranscriptChunk | undefined {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const [start, end] = chunks[mid].timestamp;
    if (time < start) {
      hi = mid - 1;
    } else if (time > end) {
      lo = mid + 1;
    } else {
      return chunks[mid];
    }
  }
  return undefined;
}

export function useVideoDownloadMediaBunny({
  videoRef,
  videoDuration,
  transcriptChunks,
  subtitleStyle,
  mode,
  ratio = "16:9",
  format = "mp4",
  quality = "very_high",
  fps = 30,
  bgRemovalReady = false,
  processFrame: bgProcessFrame,
  getMaskAtTime,
  buildExportTimeline,
  silenceRemovalRanges = [],
  autoZoomEnabled = false,
  cropTrackingEnabled = false,
  stackedPortrait = false,
  portraitSwapped = false,
  portraitZoom = 1,
}: UseVideoDownloadMediaBunnyProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [exportDiagnostics, setExportDiagnostics] =
    useState<ExportDiagnostics | null>(null);
  const cancelContextRef = useRef<{
    cancelRequested: boolean;
    output: Output | null;
    videoSource: CanvasSource | null;
  }>({ cancelRequested: false, output: null, videoSource: null });
  const progressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const downloadVideo = useCallback(async () => {
    if (exportControllerRef.current) return;
    const video = videoRef.current;
    if (!video?.src || transcriptChunks.length === 0) {
      console.error("Missing video or transcript data");
      return;
    }
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const { signal } = controller;
    const savedVideoTime = video.currentTime;
    const savedVideoSrc = video.src;
    const wasPlaying = !video.paused;
    video.pause();
    if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current);

    setIsProcessing(true);
    setProgress(0);
    setStatus("Initializing MediaBunny...");
    setExportDiagnostics(null);
    cancelContextRef.current.cancelRequested = false;
    cancelContextRef.current.output = null;
    cancelContextRef.current.videoSource = null;

    let cancelled = false;

    // Declare reusable buffers outside try so finally can null them for GC
    let reusableBlurCanvas: HTMLCanvasElement | null = null;
    let reusableBlurCtx: CanvasRenderingContext2D | null = null;
    let reusableFgCanvas: OffscreenCanvas | null = null;
    let reusableFgCtx: OffscreenCanvasRenderingContext2D | null = null;
    let reusableMaskCanvas: OffscreenCanvas | null = null;
    let reusableMaskImageData: ImageData | null = null;
    let lastMaskW = 0;
    let lastMaskH = 0;
    let reusableFrameCanvas: OffscreenCanvas | null = null;
    let reusableFrameCtx: OffscreenCanvasRenderingContext2D | null = null;
    let decodeCanvas: OffscreenCanvas | null = null;
    let decodeCtx: OffscreenCanvasRenderingContext2D | null = null;
    let sampleIterator: AsyncIterator<VideoSample | null> | null = null;
    let sequentialSampleIterator: AsyncIterator<VideoSample> | null = null;
    let activeSequentialSample: VideoSample | null = null;
    let queuedSequentialSample: VideoSample | null = null;
    let audioSource: AudioSampleSource | null = null;
    let audioPumpPromise: Promise<void> | null = null;
    let outputFinalized = false;
    let abortInput: (() => void) | undefined;
    const encodedBuffer = new ExportBuffer();
    let outputCanvas: HTMLCanvasElement | null = null;

    try {
      // Create canvas matching video dimensions, capped on mobile to prevent
      // canvas memory overflow. Mobile browsers limit total canvas memory;
      // the export pipeline creates multiple full-res offscreen canvases
      // (main + frame + blur + fg + mask) which can silently degrade quality
      // when exceeding the budget (e.g. 5× 4K canvases ≈ 165 MB).
      // Main canvas stays as DOM canvas — CanvasSource reads from it to
      // encode frames, and OffscreenCanvas causes playback stutters on some
      // mobile browsers. Intermediate canvases use OffscreenCanvas for speed.
      const canvas = document.createElement("canvas");
      outputCanvas = canvas;
      let exportWidth = video.videoWidth;
      let exportHeight = video.videoHeight;
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const isLandscape = srcW > srcH;

      // When the user chose 9:16 on a landscape video, center-crop to portrait
      let cropX = 0;
      const cropY = 0;
      let cropW = srcW;
      const cropH = srcH;
      if (ratio === "9:16" && isLandscape) {
        // Target aspect ratio 9:16 — crop width to match, keep full height
        const targetW = Math.round(srcH * (9 / 16));
        cropX = Math.round((srcW - targetW) / 2);
        cropW = targetW;
        exportWidth = cropW;
        exportHeight = cropH;
      }
      const isMobile =
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
      ({ width: exportWidth, height: exportHeight } = getExportDimensions(
        srcW,
        srcH,
        ratio,
        stackedPortrait,
        isMobile,
      ));
      const exportFps = isMobile ? Math.min(fps, 24) : fps;

      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const needsCrop = ratio === "9:16" && isLandscape;

      // Build face tracking timeline for dynamic crop or left-right split during export
      const needsFaceTimeline =
        stackedPortrait ||
        (needsCrop && cropTrackingEnabled) ||
        autoZoomEnabled ||
        (subtitleStyle.splitSubtitleMode === "left-right" && !needsCrop);
      let faceTimeline: PositionTimeline | null = null;
      if (needsFaceTimeline && buildExportTimeline) {
        setStatus("Analyzing face positions...");
        faceTimeline = await buildExportTimeline(
          video,
          (percent) => {
            if (signal.aborted) return;
            setProgress(percent);
            setStatus(`Analyzing face positions... ${Math.round(percent)}%`);
          },
          signal,
          videoDuration,
        );
      }
      signal.throwIfAborted();

      // For crop mode, sample.draw() doesn't support source crop, so decode
      // to a full-resolution canvas first, then blit the cropped region.
      if (stackedPortrait || needsCrop || autoZoomEnabled) {
        decodeCanvas = new OffscreenCanvas(srcW, srcH);
        decodeCtx = decodeCanvas.getContext("2d", {
          alpha: false,
        }) as OffscreenCanvasRenderingContext2D;
      }

      const ctx = canvas.getContext("2d", { alpha: false });

      if (!ctx) {
        throw new Error("Failed to create canvas context");
      }

      // Setup MediaBunny input
      setStatus("Reading original video...");
      const videoBlob = await fetch(video.src, { signal }).then((r) =>
        r.blob(),
      );
      signal.throwIfAborted();
      using input = new Input({
        source: new BlobSource(videoBlob),
        formats: ALL_FORMATS,
      });

      abortInput = () => input.dispose();
      signal.addEventListener("abort", abortInput, { once: true });
      signal.throwIfAborted();

      // Get video metadata
      const duration = await input.computeDuration();
      const silenceRemovalPlan = createVideoCutPlan(
        duration,
        silenceRemovalRanges,
        transcriptChunks,
      );
      const outputDuration = silenceRemovalPlan?.outputDuration ?? duration;
      if (outputDuration <= 0)
        throw new Error(
          "All video sections are removed. Restore a section before export.",
        );
      const sourceTimeForOutput = (outputTime: number) =>
        silenceRemovalPlan
          ? outputTimeToSourceTime(outputTime, silenceRemovalPlan)
          : outputTime;
      const transcriptChunksForExport = silenceRemovalPlan
        ? adjustTranscriptChunksForSilenceRemoval(
            transcriptChunks,
            silenceRemovalPlan,
          )
        : transcriptChunks;
      const autoZoomCutSchedule = createAutoZoomCutSchedule(
        transcriptChunksForExport
          .filter((chunk) => !chunk.disabled)
          .map((chunk) => chunk.timestamp[0]),
        outputDuration,
      );
      const originalVideoTrack = await input.getPrimaryVideoTrack();
      const originalAudioTrack = await input.getPrimaryAudioTrack();
      const originalVideoDecoderConfig = originalVideoTrack
        ? await originalVideoTrack.getDecoderConfig()
        : null;
      const originalVideoCodecString =
        (originalVideoTrack &&
          (await originalVideoTrack.getCodecParameterString())) ||
        undefined;
      const sourceCodec =
        originalVideoDecoderConfig?.codec ?? originalVideoCodecString;
      const sourceCanDecode = originalVideoTrack
        ? await originalVideoTrack.canDecode()
        : false;
      const sourceIsHevc = /^(hvc1|hev1|hevc)/i.test(sourceCodec ?? "");
      signal.throwIfAborted();

      // The muxer can rewrite headers without copying the entire encoded video.
      const streamTarget = new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write(chunk) {
            encodedBuffer.write(chunk.position, chunk.data);
          },
        }),
        { chunked: true },
      );

      const outputFormat =
        format === "webm"
          ? new WebMOutputFormat()
          : new Mp4OutputFormat({ fastStart: false });
      const output = new Output({
        format: outputFormat,
        target: streamTarget,
      });
      cancelContextRef.current.output = output;

      // Add video track
      const videoCodec = format === "webm" ? "vp9" : "avc";
      const mobileAvcBitrateMap = {
        low: 1_500_000,
        medium: 2_500_000,
        high: 4_000_000,
        very_high: 6_000_000,
      } as const;
      const encoderLatencyMode =
        quality === "very_high" ? "quality" : "realtime";
      const selectedVideoBitrate =
        isMobile && videoCodec === "avc"
          ? mobileAvcBitrateMap[quality]
          : qualityMap[quality];
      const baseExportDiagnostics: ExportDiagnostics = {
        bitrate:
          typeof selectedVideoBitrate === "number"
            ? selectedVideoBitrate
            : quality,
        format,
        frameRate: exportFps,
        height: exportHeight,
        isMobile,
        quality,
        ratio,
        requestedCodec: videoCodec,
        sourceCanDecode,
        sourceCodec,
        sourceIsHevc,
        width: exportWidth,
      };
      const videoSource = new CanvasSource(canvas, {
        codec: videoCodec,
        bitrate: selectedVideoBitrate,
        ...(videoCodec === "avc"
          ? {
              bitrateMode: "constant",
              fullCodecString: isMobile ? "avc1.42001f" : undefined,
              latencyMode: encoderLatencyMode,
              onEncoderConfig: (config) => {
                if (signal.aborted || !mountedRef.current) return;
                setExportDiagnostics((previous) => ({
                  ...(previous ?? baseExportDiagnostics),
                  bitrateMode: "constant",
                  encoderCodec: config.codec,
                  latencyMode: encoderLatencyMode,
                  resolvedCodecString: config.codec,
                }));
                console.info("[MediaBunny export] Video encoder config", {
                  config,
                  exportFps,
                  exportHeight,
                  exportWidth,
                  format,
                  isMobile,
                  quality,
                  ratio,
                  selectedVideoBitrate,
                  sourceCanDecode,
                  sourceCodec,
                  sourceIsHevc,
                  videoCodec,
                });
              },
            }
          : {}),
      });
      setExportDiagnostics(
        videoCodec === "avc"
          ? {
              ...baseExportDiagnostics,
              bitrateMode: "constant",
              latencyMode: encoderLatencyMode,
            }
          : baseExportDiagnostics,
      );
      output.addVideoTrack(videoSource, { frameRate: exportFps });
      cancelContextRef.current.videoSource = videoSource;
      let outputStarted = false;
      const ensureOutputStarted = async () => {
        if (outputStarted) return;
        await output.start();
        outputStarted = true;
      };
      let audioPumpError: Error | null = null;

      // Handle audio if present
      if (originalAudioTrack) {
        const audioBitrate = quality === "very_high" ? 256_000 : 128_000;
        if (format !== "webm") {
          await ensureAacEncoder({
            bitrate: audioBitrate,
            numberOfChannels: await originalAudioTrack.getNumberOfChannels(),
            sampleRate: 48_000,
          });
          signal.throwIfAborted();
        }
        audioSource = new AudioSampleSource({
          codec: format === "webm" ? "opus" : "aac",
          bitrate: audioBitrate,
          // Windows AAC encoders reject low-rate input such as 22,050 Hz.
          // Resample in Mediabunny so all source rates use a supported output rate.
          transform: { sampleRate: 48_000 },
        });
        output.addAudioTrack(audioSource);
      }
      await ensureOutputStarted();
      signal.throwIfAborted();

      console.info("[MediaBunny export] Output started", {
        exportFps,
        exportHeight,
        exportWidth,
        format,
        isMobile,
        mimeType: "pending",
        quality,
        ratio,
        selectedVideoBitrate,
        sourceCanDecode,
        sourceCodec,
        sourceIsHevc,
        videoCodec,
      });
      void output
        .getMimeType()
        .then((outputMimeType) => {
          if (signal.aborted || !mountedRef.current) return;
          console.info("[MediaBunny export] MIME resolved", {
            mimeType: outputMimeType,
          });
          setExportDiagnostics((previous) => ({
            ...(previous ?? baseExportDiagnostics),
            mimeType: outputMimeType,
          }));
        })
        .catch(() => {});

      let videoSampleSink: VideoSampleSink | null = null;
      if (originalVideoTrack && sourceCanDecode) {
        videoSampleSink = new VideoSampleSink(originalVideoTrack);
      }

      // Process chunks according to mode (word/phrase) and filter enabled ones
      // When dynamic is enabled, use phrase mode with dynamicEnabled flag
      const isDynamic = subtitleStyle.dynamicEnabled;
      const processedChunks = processTranscriptChunks(
        { chunks: transcriptChunksForExport },
        isDynamic ? "phrase" : mode,
        subtitleStyle.maxWordsPerLine,
        isDynamic,
      );
      const enabledChunks = processedChunks.filter((chunk) => {
        if ((mode === "phrase" || isDynamic) && isPhraseChunk(chunk)) {
          return !chunk.words.some((word) => {
            // A word that owns its chunk (manual subtitle) carries its flags
            // directly; transcribed words resolve back to the source chunk.
            if (word.disabled || word.subtitleHidden) return true;
            if (
              Array.isArray(chunk.words) &&
              chunk.words.every((w) => w.sourceIndex === word.sourceIndex)
            ) {
              return false;
            }
            const originalChunk = transcriptChunksForExport.find(
              (candidate) =>
                candidate.timestamp[0] === word.timestamp[0] &&
                candidate.timestamp[1] === word.timestamp[1],
            );
            return originalChunk?.disabled || originalChunk?.subtitleHidden;
          });
        }
        return !chunk.disabled && !chunk.subtitleHidden;
      });

      // Lookahead constant to compensate for EMA smoothing lag in face tracking export
      const FACE_TRACK_LOOKAHEAD = 0.15; // seconds

      // Pre-compute a fixed face X position for each subtitle phrase.
      // Left-right split text stays at the face position from phrase start — it doesn't
      // move mid-phrase, which avoids distracting text drift and is easier to read.
      const phraseFaceXMap = new Map<number, number>();
      if (
        subtitleStyle.splitSubtitleMode === "left-right" &&
        faceTimeline &&
        !needsCrop
      ) {
        for (const chunk of enabledChunks) {
          const startTime = chunk.timestamp[0];
          phraseFaceXMap.set(
            startTime,
            interpolateCenterX(
              faceTimeline,
              sourceTimeForOutput(startTime) + FACE_TRACK_LOOKAHEAD,
            ),
          );
        }
      }

      const totalFrames = Math.ceil(outputDuration * exportFps);
      setStatus("Rendering video frames...");

      if (originalAudioTrack && audioSource) {
        const exportAudioSource = audioSource;
        const audioSampleSink = new AudioSampleSink(originalAudioTrack);
        audioPumpPromise = (async () => {
          try {
            for await (const audioSample of audioSampleSink.samples(
              0,
              duration,
            )) {
              try {
                if (cancelContextRef.current.cancelRequested) break;
                if (silenceRemovalPlan) {
                  const sampleMidpoint =
                    audioSample.timestamp + audioSample.duration / 2;
                  if (
                    isSourceTimeRemoved(
                      sampleMidpoint,
                      silenceRemovalPlan.removedRanges,
                    )
                  ) {
                    continue;
                  }
                  audioSample.setTimestamp(
                    sourceTimeToOutputTime(
                      audioSample.timestamp,
                      silenceRemovalPlan,
                    ),
                  );
                }
                await exportAudioSource.add(audioSample);
              } finally {
                audioSample.close();
              }
            }
            exportAudioSource.close();
          } catch (error) {
            audioPumpError =
              error instanceof Error
                ? error
                : new Error("Failed to process audio samples");
            try {
              exportAudioSource.close();
            } catch {}
          }
        })();
      }

      const timestampIterator = (async function* () {
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
          yield sourceTimeForOutput(frameIndex / exportFps);
        }
      })();

      sampleIterator = videoSampleSink
        ? videoSampleSink.samplesAtTimestamps(timestampIterator)
        : null;
      const useSequentialSourceSamples = sourceIsHevc && !!videoSampleSink;
      const sourceFrameTolerance = 1 / (exportFps * 2);
      sequentialSampleIterator =
        useSequentialSourceSamples && videoSampleSink
          ? videoSampleSink.samples()
          : null;
      if (sequentialSampleIterator) {
        const initialSequentialResult = await sequentialSampleIterator.next();
        queuedSequentialSample = initialSequentialResult.value ?? null;
      }
      let iteratorResult: IteratorResult<VideoSample | null> | undefined;
      let currentPortraitFaces: TrackedFace[] = [];
      let currentAutoZoomCutIndex = -1;
      let currentAutoZoomFaceX = 0.5;

      const drawFrameFromVideoElement = async (
        time: number,
        frameCropX: number,
        outputTime: number,
        autoZoomFaceX: number,
      ) => {
        await seekVideo(video, time, signal);
        if (stackedPortrait) {
          drawPortraitLayout(
            ctx,
            video,
            srcW,
            srcH,
            canvas.width,
            canvas.height,
            currentPortraitFaces,
            portraitSwapped,
            portraitZoom,
          );
        } else if (autoZoomEnabled) {
          drawImageWithAutoZoom(
            ctx,
            video,
            frameCropX,
            cropY,
            cropW,
            cropH,
            0,
            0,
            canvas.width,
            canvas.height,
            outputTime,
            outputDuration,
            autoZoomFaceX,
            autoZoomCutSchedule,
          );
        } else if (needsCrop) {
          ctx.drawImage(
            video,
            frameCropX,
            cropY,
            cropW,
            cropH,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        } else {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      };
      const drawSampleToCanvas = (
        sample: VideoSample,
        frameCropX: number,
        outputTime: number,
        autoZoomFaceX: number,
      ) => {
        if (
          (stackedPortrait || needsCrop || autoZoomEnabled) &&
          decodeCanvas &&
          decodeCtx
        ) {
          sample.draw(decodeCtx, 0, 0, srcW, srcH);
          if (stackedPortrait) {
            drawPortraitLayout(
              ctx,
              decodeCanvas,
              srcW,
              srcH,
              canvas.width,
              canvas.height,
              currentPortraitFaces,
              portraitSwapped,
              portraitZoom,
            );
          } else if (autoZoomEnabled) {
            drawImageWithAutoZoom(
              ctx,
              decodeCanvas,
              frameCropX,
              cropY,
              cropW,
              cropH,
              0,
              0,
              canvas.width,
              canvas.height,
              outputTime,
              outputDuration,
              autoZoomFaceX,
              autoZoomCutSchedule,
            );
          } else {
            ctx.drawImage(
              decodeCanvas,
              frameCropX,
              cropY,
              cropW,
              cropH,
              0,
              0,
              canvas.width,
              canvas.height,
            );
          }
        } else {
          sample.draw(ctx, 0, 0, canvas.width, canvas.height);
        }
      };

      // Reusable canvases/buffers are declared before try block for cleanup in finally

      // Render each frame
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (cancelContextRef.current.cancelRequested) {
          cancelled = true;
          setStatus("Cancelling download...");
          break;
        }

        const time = frameIndex / exportFps;
        const sourceTime = sourceTimeForOutput(time);
        currentPortraitFaces = interpolateFaces(faceTimeline ?? [], sourceTime);

        // Update progress ~once per second (every fps frames) to avoid
        // excessive React re-renders which freeze mobile devices.
        const progressPercent = Math.min(100, (frameIndex / totalFrames) * 100);
        if (frameIndex % exportFps === 0 || frameIndex === totalFrames - 1) {
          setProgress(progressPercent);
          setStatus(
            `Rendering: ${Math.round(time)}s / ${Math.round(outputDuration)}s (${Math.round(progressPercent)}%)`,
          );
        }

        // Compute per-frame crop X (face tracking or static center).
        // Look ahead slightly to compensate for EMA smoothing lag — during
        // preview the crop and detection run in the same rAF tick so the
        // lag is imperceptible, but in export it manifests as a visible delay.
        const sourceFaceX = faceTimeline
          ? interpolateCenterX(faceTimeline, sourceTime + FACE_TRACK_LOOKAHEAD)
          : 0.5;
        const frameCropX = needsCrop
          ? computeCropX(sourceFaceX, srcW, cropW, cropTrackingEnabled)
          : cropX;
        const autoZoomFaceX =
          needsCrop && cropW > 0
            ? Math.max(
                0,
                Math.min(1, (sourceFaceX * srcW - frameCropX) / cropW),
              )
            : sourceFaceX;
        if (autoZoomEnabled) {
          const nextAutoZoomCutIndex = getAutoZoomCutIndex(
            time,
            autoZoomCutSchedule,
          );
          if (nextAutoZoomCutIndex !== currentAutoZoomCutIndex) {
            currentAutoZoomCutIndex = nextAutoZoomCutIndex;
            currentAutoZoomFaceX = autoZoomFaceX;
          }
        }

        // Clear canvas every frame — skipping this causes duplicate-frame
        // stutters when a decode silently fails (catch block below skips the
        // draw but the encoder still reads the stale canvas content).
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw video frame using iterator to avoid repeated decoder setup
        let drewSourceFrame = false;
        if (sequentialSampleIterator) {
          try {
            while (
              queuedSequentialSample &&
              queuedSequentialSample.timestamp <=
                sourceTime + sourceFrameTolerance
            ) {
              if (
                activeSequentialSample &&
                activeSequentialSample !== queuedSequentialSample
              ) {
                activeSequentialSample.close();
              }
              activeSequentialSample = queuedSequentialSample;
              const nextSequentialResult =
                await sequentialSampleIterator.next();
              queuedSequentialSample = nextSequentialResult.value ?? null;
            }
            const sequentialSample =
              activeSequentialSample ?? queuedSequentialSample;
            if (sequentialSample) {
              drawSampleToCanvas(
                sequentialSample,
                frameCropX,
                time,
                currentAutoZoomFaceX,
              );
              drewSourceFrame = true;
            }
          } catch {}
          if (!drewSourceFrame) {
            await drawFrameFromVideoElement(
              sourceTime,
              frameCropX,
              time,
              currentAutoZoomFaceX,
            );
            drewSourceFrame = true;
          }
        } else if (videoSampleSink && sampleIterator) {
          try {
            iteratorResult = await sampleIterator.next();
            const sample = iteratorResult.value ?? null;
            if (sample) {
              try {
                drawSampleToCanvas(
                  sample,
                  frameCropX,
                  time,
                  currentAutoZoomFaceX,
                );
                drewSourceFrame = true;
              } finally {
                sample.close();
              }
            }
          } catch {}
          if (!drewSourceFrame) {
            await drawFrameFromVideoElement(
              sourceTime,
              frameCropX,
              time,
              currentAutoZoomFaceX,
            );
            drewSourceFrame = true;
          }
        } else {
          await drawFrameFromVideoElement(
            sourceTime,
            frameCropX,
            time,
            currentAutoZoomFaceX,
          );
          drewSourceFrame = true;
        }

        // Find current subtitle chunk (binary search — O(log n) vs O(n) per frame)
        const currentChunk = findChunkAtTime(enabledChunks, time);

        // Face X for left-right split: frozen per-phrase, not interpolated per-frame.
        // This keeps text stationary for the phrase duration so it's easy to read.
        const frameFaceX = currentChunk
          ? (phraseFaceXMap.get(currentChunk.timestamp[0]) ?? 0.5)
          : 0.5;

        const isDynamicMode =
          subtitleStyle.dynamicEnabled && bgRemovalReady && bgProcessFrame;
        const bgActive =
          bgRemovalReady &&
          subtitleStyle.backgroundRemovalEnabled &&
          bgProcessFrame;
        const needsCompositing = isDynamicMode || bgActive;

        if (needsCompositing) {
          // Compositing at full resolution (bg removal or dynamic mode)
          // Save current frame to offscreen canvas via GPU blit (fast, no ImageData needed for restore)
          if (!reusableFrameCanvas) {
            reusableFrameCanvas = new OffscreenCanvas(
              canvas.width,
              canvas.height,
            );
            reusableFrameCtx = reusableFrameCanvas.getContext("2d", {
              alpha: false,
            }) as OffscreenCanvasRenderingContext2D;
          }
          reusableFrameCtx!.drawImage(canvas, 0, 0);

          // Use pre-computed masks (5fps cache) when available — avoids costly per-frame AI inference
          // Falls back to live inference only if cached masks aren't available
          let mask: MaskData;
          const cachedMask = getMaskAtTime?.(sourceTime);
          if (cachedMask) {
            mask = cachedMask;
          } else if (bgProcessFrame) {
            const framePixels = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            );
            mask = await bgProcessFrame(
              framePixels.data,
              canvas.width,
              canvas.height,
              frameIndex,
            );
          } else {
            // No mask available — skip compositing for this frame
            if (currentChunk) {
              renderSubtitle(
                ctx,
                currentChunk,
                subtitleStyle,
                canvas,
                mode,
                time,
                frameFaceX,
              );
            }
            drawBrandingWatermark(
              ctx,
              canvas.width,
              canvas.height,
              subtitleStyle.showWatermark,
            );
            try {
              await videoSource.add(time, 1 / exportFps);
            } catch {}
            continue;
          }

          // Step 1: Draw background
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (isDynamicMode) {
            // Dynamic mode: keep original video as background (GPU blit)
            ctx.drawImage(reusableFrameCanvas!, 0, 0);
          } else if (subtitleStyle.backgroundType === "blur") {
            // Reuse blurCanvas across frames — stays as DOM canvas because
            // ctx.filter is not supported on OffscreenCanvas in all browsers.
            if (!reusableBlurCanvas) {
              reusableBlurCanvas = document.createElement("canvas");
              reusableBlurCanvas.width = canvas.width;
              reusableBlurCanvas.height = canvas.height;
              reusableBlurCtx = reusableBlurCanvas.getContext("2d", {
                alpha: false,
              });
            }
            if (reusableBlurCtx) {
              // Apply blur on the DOM canvas context (OffscreenCanvas may not
              // support ctx.filter in all browsers), then blit to main canvas.
              reusableBlurCtx.filter = "blur(20px)";
              reusableBlurCtx.drawImage(reusableFrameCanvas!, 0, 0);
              reusableBlurCtx.filter = "none";
              ctx.drawImage(reusableBlurCanvas!, 0, 0);
            }
          } else {
            ctx.fillStyle = subtitleStyle.solidBackgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // Step 2: Render subtitle behind person
          if (isDynamicMode && currentChunk) {
            // Dynamic mode: render only "behind" words as big text
            renderDynamicBehindInExport(
              ctx,
              currentChunk,
              subtitleStyle,
              canvas,
              time,
            );
          }

          // Step 3: Draw masked foreground (reuse canvases across frames)
          if (!reusableFgCanvas) {
            reusableFgCanvas = new OffscreenCanvas(canvas.width, canvas.height);
            reusableFgCtx = reusableFgCanvas.getContext(
              "2d",
            ) as OffscreenCanvasRenderingContext2D;
          }
          if (!reusableMaskCanvas) {
            reusableMaskCanvas = new OffscreenCanvas(mask.width, mask.height);
            lastMaskW = mask.width;
            lastMaskH = mask.height;
          }
          // Clear fg canvas instead of resetting dimensions (avoids context state reset)
          reusableFgCtx!.clearRect(0, 0, canvas.width, canvas.height);
          if (reusableFgCtx) {
            reusableFgCtx.drawImage(reusableFrameCanvas!, 0, 0);

            // Only resize mask canvas when dimensions actually change
            if (lastMaskW !== mask.width || lastMaskH !== mask.height) {
              reusableMaskCanvas.width = mask.width;
              reusableMaskCanvas.height = mask.height;
              lastMaskW = mask.width;
              lastMaskH = mask.height;
            }
            const maskCtx = reusableMaskCanvas.getContext("2d");
            if (maskCtx) {
              // Reuse ImageData if mask dimensions haven't changed
              if (
                !reusableMaskImageData ||
                reusableMaskImageData.width !== mask.width ||
                reusableMaskImageData.height !== mask.height
              ) {
                reusableMaskImageData = maskCtx.createImageData(
                  mask.width,
                  mask.height,
                );
              }
              const pixels = reusableMaskImageData.data;
              for (let i = 0; i < mask.data.length; i++) {
                const idx = i * 4;
                pixels[idx] = 255;
                pixels[idx + 1] = 255;
                pixels[idx + 2] = 255;
                pixels[idx + 3] = mask.data[i];
              }
              maskCtx.putImageData(reusableMaskImageData, 0, 0);

              reusableFgCtx.globalCompositeOperation = "destination-in";
              if (needsCrop && cachedMask) {
                // Cached masks cover the full video frame — crop to match
                const msx = (frameCropX / srcW) * mask.width;
                const msy = (cropY / srcH) * mask.height;
                const msw = (cropW / srcW) * mask.width;
                const msh = (cropH / srcH) * mask.height;
                reusableFgCtx.drawImage(
                  reusableMaskCanvas,
                  msx,
                  msy,
                  msw,
                  msh,
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                );
              } else {
                reusableFgCtx.drawImage(
                  reusableMaskCanvas,
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                );
              }
              reusableFgCtx.globalCompositeOperation = "source-over";
            }

            ctx.drawImage(reusableFgCanvas, 0, 0);
          }

          // Step 4: Render front text (dynamic) or on-top text (non-dynamic)
          if (isDynamicMode && currentChunk) {
            let faceBounds: FaceBounds | null;
            if (needsCrop && cachedMask) {
              // Cached mask covers full frame — compute chin in full-frame coords then translate
              const fullFace = estimateFaceFromMask(
                mask.data,
                mask.width,
                mask.height,
                srcW,
                srcH,
              );
              faceBounds = fullFace
                ? { chinY: (fullFace.chinY - cropY) * (canvas.height / cropH) }
                : null;
            } else {
              faceBounds = estimateFaceFromMask(
                mask.data,
                mask.width,
                mask.height,
                canvas.width,
                canvas.height,
              );
            }
            renderDynamicFrontInExport(
              ctx,
              currentChunk,
              subtitleStyle,
              canvas,
              faceBounds,
              time,
            );
          } else if (currentChunk) {
            renderSubtitle(
              ctx,
              currentChunk,
              subtitleStyle,
              canvas,
              mode,
              time,
              frameFaceX,
            );
          }
        } else {
          // Normal rendering (no compositing)
          if (currentChunk) {
            renderSubtitle(
              ctx,
              currentChunk,
              subtitleStyle,
              canvas,
              mode,
              time,
              frameFaceX,
            );
          }
        }

        // Branding watermark — drawn on top of everything
        drawBrandingWatermark(
          ctx,
          canvas.width,
          canvas.height,
          subtitleStyle.showWatermark,
        );

        if (cancelContextRef.current.cancelRequested) {
          cancelled = true;
          setStatus("Cancelling download...");
          break;
        }

        try {
          await videoSource.add(time, 1 / exportFps);
        } catch (error) {
          if (cancelContextRef.current.cancelRequested) {
            cancelled = true;
            setStatus("Cancelling download...");
            break;
          }
          throw error;
        }
      }

      // Clean up iterator
      if (sampleIterator) {
        try {
          await sampleIterator.return?.();
        } catch {
          // Cleanup error - safe to ignore
        }
      }

      // Finalize export
      try {
        videoSource.close();
      } catch {
        // Close error - safe to ignore
      }

      if (cancelled) {
        if (audioPumpPromise) {
          await audioPumpPromise.catch(() => {});
        }
        await output.cancel();
        setProgress(0);
        setStatus("Download cancelled");
      } else {
        setStatus("Finalizing video...");
        if (audioPumpPromise) {
          await audioPumpPromise;
        }
        if (audioPumpError) {
          throw audioPumpError;
        }
        await output.finalize();
        signal.throwIfAborted();
        outputFinalized = true;

        // Build download blob from StreamTarget buffer
        if (encodedBuffer.size === 0) {
          throw new Error("Failed to generate video buffer");
        }

        const mimeType = format === "webm" ? "video/webm" : "video/mp4";
        const blob = encodedBuffer.toBlob(mimeType);
        encodedBuffer.clear();
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `video_with_subtitles_${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // The browser starts reading the blob asynchronously after the click.
        // Keep it alive long enough for the download to acquire the data.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);

        setStatus("Export complete!");
        setProgress(100);
      }
    } catch (error) {
      cancelled = signal.aborted || cancelContextRef.current.cancelRequested;
      if (mountedRef.current) {
        if (cancelled) {
          setStatus("Download cancelled");
          setProgress(0);
        } else {
          console.error("MediaBunny video processing failed:", error);
          setStatus(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    } finally {
      if (abortInput) signal.removeEventListener("abort", abortInput);
      cancelContextRef.current.cancelRequested = true;
      try {
        cancelContextRef.current.videoSource?.close();
      } catch {}
      try {
        audioSource?.close();
      } catch {}
      if (!outputFinalized) {
        await cancelContextRef.current.output?.cancel().catch(() => {});
      }
      await audioPumpPromise?.catch(() => {});
      // Explicitly release backing stores; null references alone defer GPU memory reclamation.
      for (const surface of [
        outputCanvas,
        reusableBlurCanvas,
        reusableFgCanvas,
        reusableMaskCanvas,
        reusableFrameCanvas,
        decodeCanvas,
      ]) {
        if (surface) {
          surface.width = 0;
          surface.height = 0;
        }
      }
      encodedBuffer.clear();
      // Release all reusable canvases and buffers to free memory
      reusableBlurCanvas = null;
      reusableBlurCtx = null;
      reusableFgCanvas = null;
      reusableFgCtx = null;
      reusableMaskCanvas = null;
      reusableMaskImageData = null;
      reusableFrameCanvas = null;
      reusableFrameCtx = null;
      decodeCanvas = null;
      decodeCtx = null;
      if (sampleIterator) {
        try {
          await sampleIterator.return?.();
        } catch {}
      }
      if (sequentialSampleIterator) {
        try {
          await sequentialSampleIterator.return?.();
        } catch {}
      }
      if (activeSequentialSample) {
        try {
          activeSequentialSample.close();
        } catch {}
      }
      if (
        queuedSequentialSample &&
        queuedSequentialSample !== activeSequentialSample
      ) {
        try {
          queuedSequentialSample.close();
        } catch {}
      }

      cancelContextRef.current.output = null;
      cancelContextRef.current.videoSource = null;
      const wasCancelled = cancelled;
      if (mountedRef.current) {
        setIsProcessing(false);
        if (video.src === savedVideoSrc) {
          video.currentTime = savedVideoTime;
          if (wasPlaying) void video.play().catch(() => {});
        }
        if (progressTimeoutRef.current)
          clearTimeout(progressTimeoutRef.current);
        progressTimeoutRef.current = setTimeout(
          () => setProgress(0),
          wasCancelled ? 500 : 3000,
        );
      }
      cancelContextRef.current.cancelRequested = false;
      if (exportControllerRef.current === controller)
        exportControllerRef.current = null;
    }
  }, [
    videoRef,
    videoDuration,
    transcriptChunks,
    subtitleStyle,
    mode,
    ratio,
    format,
    quality,
    fps,
    bgRemovalReady,
    bgProcessFrame,
    getMaskAtTime,
    buildExportTimeline,
    silenceRemovalRanges,
    autoZoomEnabled,
    cropTrackingEnabled,
    stackedPortrait,
    portraitSwapped,
    portraitZoom,
  ]);

  const cancelDownload = useCallback(() => {
    if (!exportControllerRef.current) {
      return;
    }
    cancelContextRef.current.cancelRequested = true;
    exportControllerRef.current.abort();
    setStatus("Cancelling download...");

    if (cancelContextRef.current.videoSource) {
      try {
        cancelContextRef.current.videoSource.close();
      } catch {
        // Close error during cancel - safe to ignore
      } finally {
        cancelContextRef.current.videoSource = null;
      }
    }
    void cancelContextRef.current.output?.cancel().catch(() => {});
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const cancelContext = cancelContextRef.current;
    return () => {
      mountedRef.current = false;
      if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current);
      exportControllerRef.current?.abort();
      cancelContext.cancelRequested = true;
      try {
        cancelContext.videoSource?.close();
      } catch {}
      void cancelContext.output?.cancel().catch(() => {});
    };
  }, []);

  return {
    downloadVideo,
    cancelDownload,
    exportDiagnostics,
    isProcessing,
    progress,
    status,
  };
}
