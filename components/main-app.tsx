"use client";

import type { JSX } from "react";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { MobileSubtitleStyling } from "@/components/editor/mobile-subtitle-styling";
import { VideoUpload } from "@/components/video-upload";
import { BrandLockup } from "@/components/brand-lockup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Video,
  SlidersHorizontal,
  Captions,
  Info,
  ZoomIn,
  ZoomOut,
  Loader2,
  RefreshCw,
  RectangleHorizontal,
  RectangleVertical,
  Clapperboard,
} from "lucide-react";
import { TranscriptSidebar } from "@/components/transcript-sidebar";
import {
  FONT_FAMILIES,
  SubtitleStyling,
  SubtitleStyle,
} from "@/components/subtitle-styling";
import { WordStylePopover } from "@/components/word-style-popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  restoreSubtitleTiming,
  type TimedSubtitle,
} from "@/lib/subtitle-timing";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  processTranscriptChunks,
  binarySearchActiveChunk,
  formatTime,
  type WordStyleOverride,
} from "@/lib/transcript-utils";
import {
  useTranscription,
  STATUS_MESSAGES,
  type TranscriptionResult,
  type ModelSize,
} from "@/hooks/useTranscription";
import { useVideoDownloadMediaBunny } from "@/hooks/useVideoDownloadMediaBunny";
import { useBackgroundRemoval } from "@/hooks/useBackgroundRemoval";
import { getBackgroundRemovalWarningDuration } from "@/lib/background-removal-warning";
import { detectHardwareCapabilities } from "@/lib/hardware-check";
import { selectBgModel, type BgModelId } from "@/lib/bg-models";
import { describeBgRemovalError, isAbortError } from "@/lib/bg-errors";
import { DEFAULT_QUALITY_TIER, type BgQualityTier } from "@/lib/bg-quality";
import { DEFAULT_BLUR_INTENSITY } from "@/lib/video-background";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useFootageColorAnalysis } from "@/hooks/useFootageColorAnalysis";
import { NEUTRAL_COLOR_GRADE } from "@/lib/color-grade";
import { type LanguageCode } from "@/components/language-selector";
import { LanguageSelectionModal } from "@/components/language-selection-modal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { APP_VERSION } from "@/lib/changelog";
import { extractAudioFromVideo, NoAudioDetectedError } from "@/lib/audio-utils";
import {
  createSilenceRemovalPlan,
  detectSilenceRanges,
  SILENCE_REMOVAL_LEVELS,
  type SilenceRemovalLevel,
  type TimeRange,
} from "@/lib/silence-removal";
import { toast } from "sonner";
import { EditorTimeline } from "@/components/editor/editor-timeline";
import { ExportMenu } from "@/components/editor/export-menu";
import { TranscriptionProgress } from "@/components/editor/transcription-progress";
import { VideoEffectsControls } from "@/components/editor/video-effects-controls";
import { PersonSubtitleControls } from "@/components/editor/person-subtitle-controls";
import styles from "@/components/editor/editor.module.css";
import {
  updateCaptionPlacement,
  clearCaptionPlacements,
} from "@/lib/caption-placement";

interface MainAppProps {
  initialFile?: File | null;
  onReturnToLanding?: () => void;
}

// Default subtitle style - Gold preset
const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  uppercase: false,
  wordEmphasisBackgroundColor: "#000000",
  fontFamily: FONT_FAMILIES.playfairDisplay.value,
  fontSize: 18,
  fontWeight: "600",
  color: "#FFFFFF",
  backgroundColor: "transparent",
  backgroundStyle: "solid",
  borderWidth: 1,
  borderColor: "#1A1A1A",
  dropShadowIntensity: 0.55,
  wordEmphasisEnabled: false,
  wordEmphasisColorEnabled: false,
  wordEmphasisColor: "#F2D21B",
  windEnabled: false,
  position: "bottom",
  maxWordsPerLine: 3,
  backgroundRemovalEnabled: false,
  backgroundType: "solid",
  solidBackgroundColor: "#000000",
  blurIntensity: DEFAULT_BLUR_INTENSITY,
  colorGrade: { ...NEUTRAL_COLOR_GRADE },
  dynamicEnabled: false,
  dynamicFontSize: 80,
  dynamicYPosition: 35,
  dynamicFrontFontSize: 40,
  dynamicFrontYPosition: 75,
  dynamicFollowWord: false,
  textFadeIn: false,
  showWatermark: true,
  splitSubtitleMode: "none",
  verticalOffset: -10,
};

type BgModelPreference = BgModelId | "auto";
type PersonEffect = "depth" | "background";

interface PendingPersonEffect {
  effect: PersonEffect;
  model: BgModelPreference;
  tier: BgQualityTier;
}

const mobileQuery = "(max-width: 767px)";
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getMobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const getServerMobileSnapshot = () => false;

export function MainApp({
  initialFile = null,
  onReturnToLanding,
}: MainAppProps): JSX.Element {
  const [currentTime, setCurrentTime] = useState(0);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(
    DEFAULT_SUBTITLE_STYLE,
  );
  const [uploadKey, setUploadKey] = useState(0);
  const [mode, setMode] = useState<"word" | "phrase">("phrase");
  const [ratio, setRatio] = useState<"16:9" | "9:16">("16:9");
  const [zoomPortrait, setZoomPortrait] = useState(false);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [modelSize, setModelSize] = useState<ModelSize>("base");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const footageColor = useFootageColorAnalysis(uploadedFile, videoDuration);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [editorTab, setEditorTab] = useState<"style" | "subtitles" | "video">(
    "style",
  );
  const [showAboutSheet, setShowAboutSheet] = useState(false);
  const isMobileEditor = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getServerMobileSnapshot,
  );
  const StyleControls = isMobileEditor
    ? MobileSubtitleStyling
    : SubtitleStyling;
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const editorElementRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isMobileEditor) return;
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      editorElementRef.current?.style.setProperty(
        "--mobile-height",
        `${height}px`,
      );
      if (editorElementRef.current)
        editorElementRef.current.dataset.short = String(height < 550);
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, [isMobileEditor]);
  const [bgConfirmationDuration, setBgConfirmationDuration] = useState<
    number | null
  >(null);
  const [bgModelPreference, setBgModelPreference] =
    useState<BgModelPreference>("auto");
  const [bgQualityTier, setBgQualityTier] =
    useState<BgQualityTier>(DEFAULT_QUALITY_TIER);
  const pendingPersonEffectRef = useRef<PendingPersonEffect>({
    effect: "background",
    model: "auto",
    tier: DEFAULT_QUALITY_TIER,
  });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [selectedWordTimestamp, setSelectedWordTimestamp] = useState<
    [number, number] | null
  >(null);
  const previousResultRef = useRef<TranscriptionResult | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastChunkKeyRef = useRef<string | null>(null);

  const {
    status,
    error,
    notice,
    result,
    progress,
    modelLoading,
    device,
    setResult,
    handleVideoSelect: handleVideoSelectBase,
    startTranscription,
    resetTranscription,
    cancelTranscription,
    setStatus: setTranscriptionStatus,
  } = useTranscription();

  const {
    isModelLoading: isBgModelLoading,
    isProcessing: isBgProcessing,
    phase: bgPhase,
    progress: bgProgress,
    isReady: bgRemovalReady,
    device: bgDevice,
    carriedFrames: bgCarriedFrames,
    activeModelId: bgActiveModelId,
    fallbackReason: bgFallbackReason,
    hardwareWarning: bgHardwareWarning,
    subjectCoverage: bgSubjectCoverage,
    subjectDetected: bgSubjectDetected,
    maskPlan: bgMaskPlan,
    restoredFromCache: bgRestoredFromCache,
    processVideo: processBgRemoval,
    getMaskAtTime,
    clearMasks: clearBgMasks,
    clearMaskCache: clearBgMaskCache,
    reset: resetBgRemoval,
  } = useBackgroundRemoval();

  const {
    startTracking,
    stopTracking,
    getCenterX,
    getFaces,
    faceCount,
    isLoading: isFaceLoading,
    buildExportTimeline,
  } = useFaceTracking();

  const [portraitLayout, setPortraitLayout] = useState<"single" | "stacked">(
    "single",
  );
  const [portraitZoom, setPortraitZoom] = useState(1);
  const [portraitSwapped, setPortraitSwapped] = useState(false);
  const stackedPortrait = portraitLayout === "stacked" && ratio === "9:16";
  const effectiveSubtitleStyle = stackedPortrait
    ? {
        ...subtitleStyle,
        dynamicEnabled: false,
        backgroundRemovalEnabled: false,
        splitSubtitleMode: "none" as const,
      }
    : subtitleStyle;

  // User toggle for face tracking + whether it's actively running
  const [faceTrackingEnabled, setFaceTrackingEnabled] = useState(true);
  const [isFaceTrackingActive, setIsFaceTrackingActive] = useState(false);
  const [isVideoLandscape, setIsVideoLandscape] = useState(false);

  // Start/stop face tracking: runs when split subtitles, auto zoom, or manual tracking is on
  const splitActive = subtitleStyle.splitSubtitleMode !== "none";
  const hasTranscript = result !== null;
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoEl.src || videoEl.src === window.location.href) {
      return;
    }

    const tryStart = () => {
      if (!videoEl.videoWidth) return; // metadata not loaded yet
      const isLandscape = videoEl.videoWidth > videoEl.videoHeight;
      setIsVideoLandscape(isLandscape);
      if (
        hasTranscript &&
        (stackedPortrait ||
          (faceTrackingEnabled && ratio === "9:16" && isLandscape) ||
          splitActive ||
          autoZoomEnabled)
      ) {
        startTracking(videoEl);
        setIsFaceTrackingActive(true);
      } else {
        stopTracking();
        setIsFaceTrackingActive(false);
      }
    };

    // If metadata is already loaded, start immediately
    if (videoEl.readyState >= 1) {
      tryStart();
    } else {
      videoEl.addEventListener("loadedmetadata", tryStart, { once: true });
    }

    return () => {
      videoEl.removeEventListener("loadedmetadata", tryStart);
      stopTracking();
      setIsFaceTrackingActive(false);
    };
  }, [
    ratio,
    faceTrackingEnabled,
    stackedPortrait,
    videoDuration,
    hasTranscript,
    splitActive,
    autoZoomEnabled,
    startTracking,
    stopTracking,
  ]);

  const [silenceRemovalLevel, setSilenceRemovalLevel] =
    useState<SilenceRemovalLevel>("off");
  const [silenceRemovedRanges, setSilenceRemovedRanges] = useState<TimeRange[]>(
    [],
  );
  const [isDetectingSilence, setIsDetectingSilence] = useState(false);
  const silenceDetectionRunIdRef = useRef(0);
  const silenceDetectionAbortRef = useRef<AbortController | null>(null);

  const handleVideoSelect = useCallback(
    (file: File) => {
      setUploadedFile(file);
      silenceDetectionAbortRef.current?.abort();
      silenceDetectionRunIdRef.current += 1;
      setSilenceRemovalLevel("off");
      setSilenceRemovedRanges([]);
      setIsDetectingSilence(false);
      handleVideoSelectBase(file);
      // Show language selection modal after video loads
      setShowLanguageModal(true);
    },
    [handleVideoSelectBase],
  );

  const handleAspectRatioDetected = useCallback(
    (detectedRatio: "16:9" | "9:16") => {
      setRatio(detectedRatio);
      // Reset zoom when aspect ratio changes
      if (detectedRatio === "16:9") {
        setZoomPortrait(false);
      }
    },
    [],
  );

  const handleLanguageConfirm = useCallback(
    (selectedLanguage: LanguageCode, selectedModelSize: ModelSize) => {
      videoRef.current?.pause();
      setLanguage(selectedLanguage);
      setModelSize(selectedModelSize);
      setResult(null);
      setShowLanguageModal(false);
      previousResultRef.current = null;
      // Set status synchronously so the processing overlay appears in the same
      // render batch as the modal close — no idle gap.
      setTranscriptionStatus("processing");
      if (uploadedFile) {
        startTranscription(uploadedFile, selectedLanguage, selectedModelSize);
      }
    },
    [uploadedFile, startTranscription, setResult, setTranscriptionStatus],
  );

  const handleChangeLanguage = useCallback(() => {
    previousResultRef.current = result;
    setShowLanguageModal(true);
  }, [result]);

  const [exportQuality, setExportQuality] = useState<
    "medium" | "high" | "very_high"
  >("very_high");
  const sourceDuration = videoDuration;
  const silenceRemovalPlan = useMemo(
    () =>
      sourceDuration > 0 &&
      silenceRemovalLevel !== "off" &&
      silenceRemovedRanges.length > 0
        ? createSilenceRemovalPlan(sourceDuration, silenceRemovedRanges)
        : null,
    [sourceDuration, silenceRemovalLevel, silenceRemovedRanges],
  );
  const silenceDurationLabel =
    silenceRemovalLevel !== "off" && sourceDuration > 0
      ? `${Math.max(0, sourceDuration - (silenceRemovalPlan?.outputDuration ?? sourceDuration)).toFixed(1)}s shorter`
      : null;

  const handleSilenceRemovalLevelChange = useCallback(
    async (value: string) => {
      const nextLevel = value as SilenceRemovalLevel;
      silenceDetectionAbortRef.current?.abort();
      const runId = silenceDetectionRunIdRef.current + 1;
      silenceDetectionRunIdRef.current = runId;
      setSilenceRemovalLevel(nextLevel);
      setSilenceRemovedRanges([]);

      if (nextLevel === "off") {
        setSilenceRemovedRanges([]);
        setIsDetectingSilence(false);
        return;
      }

      if (!uploadedFile) {
        setSilenceRemovedRanges([]);
        toast.error("Upload a video before enabling silence removal.");
        return;
      }

      const levelConfig = SILENCE_REMOVAL_LEVELS[nextLevel];
      const controller = new AbortController();
      silenceDetectionAbortRef.current = controller;
      setIsDetectingSilence(true);
      try {
        const audioData = await extractAudioFromVideo(
          uploadedFile,
          controller.signal,
        );
        if (silenceDetectionRunIdRef.current !== runId) return;
        const ranges = detectSilenceRanges(audioData, levelConfig.minDuration);
        if (silenceDetectionRunIdRef.current !== runId) return;
        setSilenceRemovedRanges(ranges);
        if (ranges.length === 0) {
          toast.info("No matching silent sections found.");
        }
      } catch (error) {
        if (silenceDetectionRunIdRef.current !== runId) return;
        setSilenceRemovalLevel("off");
        setSilenceRemovedRanges([]);
        if (error instanceof NoAudioDetectedError) {
          toast.info(error.message);
          return;
        }
        setSilenceRemovedRanges([]);
        toast.error(
          `Silence detection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (silenceDetectionRunIdRef.current === runId) {
          setIsDetectingSilence(false);
        }
      }
    },
    [uploadedFile],
  );

  const {
    downloadVideo,
    cancelDownload,
    isProcessing: isDownloadProcessing,
    progress: downloadProgress,
    status: downloadStatus,
  } = useVideoDownloadMediaBunny({
    videoRef,
    transcriptChunks: result?.chunks || [],
    subtitleStyle: effectiveSubtitleStyle,
    stackedPortrait,
    portraitSwapped,
    portraitZoom,
    mode,
    ratio,
    format: "mp4",
    quality: exportQuality,
    fps: 30,
    bgRemovalReady,
    videoDuration,
    cropTrackingEnabled:
      faceTrackingEnabled && ratio === "9:16" && isVideoLandscape,
    getMaskAtTime,
    buildExportTimeline:
      stackedPortrait ||
      (faceTrackingEnabled && ratio === "9:16" && isVideoLandscape) ||
      splitActive ||
      autoZoomEnabled
        ? buildExportTimeline
        : undefined,
    silenceRemovalRanges:
      silenceRemovalLevel === "off" ? [] : silenceRemovedRanges,
    autoZoomEnabled: autoZoomEnabled && !stackedPortrait,
  });

  const handleExport = useCallback(() => {
    if (
      bgRemovalReady &&
      subtitleStyle.backgroundRemovalEnabled &&
      subtitleStyle.backgroundType === "transparent"
    ) {
      toast.info(
        `Transparent preview exports with ${subtitleStyle.solidBackgroundColor} because MP4/WebM cannot store alpha.`,
      );
    }
    void downloadVideo();
  }, [
    bgRemovalReady,
    downloadVideo,
    subtitleStyle.backgroundRemovalEnabled,
    subtitleStyle.backgroundType,
    subtitleStyle.solidBackgroundColor,
  ]);

  const startBgRemoval = useCallback(
    async (
      effect: PersonEffect,
      options: {
        model?: BgModelPreference;
        tier?: BgQualityTier;
        fast?: boolean;
      } = {},
    ) => {
      if (!videoRef.current) return;
      const model = options.fast
        ? "modnet"
        : (options.model ?? bgModelPreference);
      const tier = options.fast ? "fast" : (options.tier ?? bgQualityTier);
      if (options.fast) {
        setBgModelPreference("modnet");
        setBgQualityTier("fast");
      }
      setSubtitleStyle((prev) => ({
        ...prev,
        backgroundRemovalEnabled: effect === "background",
        dynamicEnabled: effect === "depth",
      }));
      try {
        // An explicit choice wins over the hardware gates. Automatic mode keeps
        // the tiering so weak devices get the person model by default.
        const capabilities = await detectHardwareCapabilities();
        const selection = selectBgModel(
          capabilities,
          model === "auto" ? null : model,
        );
        if (selection.fallbackReason) {
          toast.info(selection.fallbackReason);
        }
        if (selection.hardwareWarning) {
          toast.warning(selection.hardwareWarning);
        }
        await processBgRemoval(
          videoRef.current,
          videoDuration,
          selection,
          tier,
        );
      } catch (error) {
        if (isAbortError(error)) return;
        setSubtitleStyle((previous) => ({
          ...previous,
          backgroundRemovalEnabled: false,
          dynamicEnabled: false,
        }));
        // Load-time hardware failures and runtime frame failures have very
        // different causes; only the former may mention device support.
        toast.error(describeBgRemovalError(error));
      }
    },
    [bgModelPreference, bgQualityTier, processBgRemoval, videoDuration],
  );

  /**
   * Ask before starting a long analysis, then honour the chosen settings.
   * Setting changes go through here too, so a model swap on a long clip still
   * asks before spending minutes of compute.
   */
  const requestBgRemoval = useCallback(
    (
      effect: PersonEffect,
      settings: { model: BgModelPreference; tier: BgQualityTier },
    ) => {
      if (!videoRef.current) return;
      pendingPersonEffectRef.current = { effect, ...settings };
      const warningDuration = getBackgroundRemovalWarningDuration(
        videoRef.current.duration,
        videoDuration,
      );
      if (warningDuration !== null) {
        setBgConfirmationDuration(warningDuration);
        return;
      }
      void startBgRemoval(effect, settings);
    },
    [startBgRemoval, videoDuration],
  );

  const handlePersonEffect = useCallback(
    (effect: PersonEffect) => {
      if (!videoRef.current) return;
      if (bgRemovalReady) {
        setSubtitleStyle((previous) => ({
          ...previous,
          backgroundRemovalEnabled: effect === "background",
          dynamicEnabled: effect === "depth",
        }));
        return;
      }
      requestBgRemoval(effect, {
        model: bgModelPreference,
        tier: bgQualityTier,
      });
    },
    [bgModelPreference, bgQualityTier, bgRemovalReady, requestBgRemoval],
  );

  /**
   * A setting that shapes the masks invalidates the cache. If the effect is
   * live, re-analyse immediately with the new settings; otherwise drop the
   * cache and let the next "Remove background" run pick them up.
   */
  const handleBgSettingsChange = useCallback(
    (model: BgModelPreference, tier: BgQualityTier) => {
      const effect: PersonEffect = subtitleStyle.dynamicEnabled
        ? "depth"
        : "background";
      const active =
        subtitleStyle.backgroundRemovalEnabled || subtitleStyle.dynamicEnabled;
      // The cached masks belong to the previous settings. Drop them even when
      // the confirmation dialog is cancelled, otherwise a later toggle would
      // composite with stale masks.
      clearBgMasks();
      if (bgRemovalReady && active) {
        requestBgRemoval(effect, { model, tier });
      }
    },
    [
      bgRemovalReady,
      clearBgMasks,
      requestBgRemoval,
      subtitleStyle.backgroundRemovalEnabled,
      subtitleStyle.dynamicEnabled,
    ],
  );

  const handleBgModelPreferenceChange = useCallback(
    (model: BgModelPreference) => {
      if (model === bgModelPreference) return;
      setBgModelPreference(model);
      handleBgSettingsChange(model, bgQualityTier);
    },
    [bgModelPreference, bgQualityTier, handleBgSettingsChange],
  );

  const handleBgQualityTierChange = useCallback(
    (tier: BgQualityTier) => {
      if (tier === bgQualityTier) return;
      setBgQualityTier(tier);
      handleBgSettingsChange(bgModelPreference, tier);
    },
    [bgModelPreference, bgQualityTier, handleBgSettingsChange],
  );

  /** Drop the persisted masks and force a fresh inference pass. */
  const handleReanalyzeBg = useCallback(() => {
    void (async () => {
      await clearBgMaskCache();
      const effect: PersonEffect = subtitleStyle.dynamicEnabled
        ? "depth"
        : "background";
      const active =
        subtitleStyle.backgroundRemovalEnabled || subtitleStyle.dynamicEnabled;
      if (active) {
        requestBgRemoval(effect, {
          model: bgModelPreference,
          tier: bgQualityTier,
        });
      }
    })();
  }, [
    bgModelPreference,
    bgQualityTier,
    clearBgMaskCache,
    requestBgRemoval,
    subtitleStyle.backgroundRemovalEnabled,
    subtitleStyle.dynamicEnabled,
  ]);

  const handleCancelBgRemoval = useCallback(() => {
    resetBgRemoval();
    setSubtitleStyle((prev) => ({
      ...prev,
      backgroundRemovalEnabled: false,
      dynamicEnabled: false,
    }));
  }, [resetBgRemoval]);

  // Memoized handlers for better performance
  const handleResetVideo = useCallback(() => {
    cancelDownload();
    // Reset transcription state
    resetTranscription();
    setMobilePanelOpen(false);
    setPortraitLayout("single");
    setPortraitSwapped(false);
    setPortraitZoom(1);

    // Reset face tracking
    stopTracking();
    setIsFaceTrackingActive(false);
    setIsVideoLandscape(false);

    // Reset background removal
    resetBgRemoval();
    setBgModelPreference("auto");
    setBgQualityTier(DEFAULT_QUALITY_TIER);
    silenceDetectionRunIdRef.current += 1;
    silenceDetectionAbortRef.current?.abort();
    setSilenceRemovalLevel("off");
    setSilenceRemovedRanges([]);
    setIsDetectingSilence(false);
    setSubtitleStyle((prev) => ({
      ...prev,
      backgroundRemovalEnabled: false,
      dynamicEnabled: false,
    }));

    // Clear uploaded file
    setUploadedFile(null);
    setVideoDuration(0);
    setAutoZoomEnabled(false);

    // Reset current time
    setCurrentTime(0);

    // Increment key to force VideoUpload component to remount
    setUploadKey((prev) => prev + 1);

    // Reset video element
    if (videoRef.current) {
      // First pause the video to prevent any issues
      videoRef.current.pause();
      // Clear the source
      videoRef.current.removeAttribute("src");
      // Force the browser to release any object URLs
      videoRef.current.load();
    }

    onReturnToLanding?.();
  }, [
    resetTranscription,
    resetBgRemoval,
    stopTracking,
    cancelDownload,
    onReturnToLanding,
  ]);

  const handleModalClose = useCallback(() => {
    if (previousResultRef.current && !result) {
      // User cancelled "Change Language" — restore previous result
      setResult(previousResultRef.current);
      setShowLanguageModal(false);
      previousResultRef.current = null;
    } else if (!result) {
      // No transcription yet — go back to landing page
      setShowLanguageModal(false);
      previousResultRef.current = null;
      handleResetVideo();
    } else {
      setShowLanguageModal(false);
      previousResultRef.current = null;
    }
  }, [result, setResult, handleResetVideo]);

  const handleModeChange = useCallback((value: "word" | "phrase") => {
    setMode(value);
  }, []);

  const handleRatioChange = useCallback((value: string) => {
    const newRatio = value as "16:9" | "9:16";
    setRatio(newRatio);
    if (newRatio === "16:9") {
      setZoomPortrait(false);
    } else {
      setSubtitleStyle((previous) =>
        previous.splitSubtitleMode === "left-right"
          ? { ...previous, splitSubtitleMode: "none" }
          : previous,
      );
    }
  }, []);

  const handleZoomPortraitChange = useCallback((zoom: boolean) => {
    setZoomPortrait(zoom);
  }, []);

  const handleWordSelect = useCallback((timestamp: [number, number]) => {
    setSelectedWordTimestamp((prev) =>
      prev && prev[0] === timestamp[0] && prev[1] === timestamp[1]
        ? null // deselect if clicking the same word
        : timestamp,
    );
  }, []);

  const handleWordStyleChange = useCallback(
    (override: WordStyleOverride) => {
      if (!result || !selectedWordTimestamp) return;
      setResult((prev) => {
        if (!prev) return prev;
        const updatedChunks = prev.chunks.map((chunk) => {
          if (
            chunk.timestamp[0] === selectedWordTimestamp[0] &&
            chunk.timestamp[1] === selectedWordTimestamp[1]
          ) {
            return {
              ...chunk,
              styleOverride:
                Object.keys(override).length > 0 ? override : undefined,
            };
          }
          return chunk;
        });
        return { ...prev, chunks: updatedChunks };
      });
    },
    [result, selectedWordTimestamp, setResult],
  );

  const handleWordStyleReset = useCallback(() => {
    handleWordStyleChange({});
  }, [handleWordStyleChange]);

  const handleWordStyleClose = useCallback(() => {
    setSelectedWordTimestamp(null);
  }, []);

  // Get the selected word's text and current override
  const selectedWordInfo = useMemo(() => {
    if (!result || !selectedWordTimestamp) return null;
    const chunk = result.chunks.find(
      (c) =>
        c.timestamp[0] === selectedWordTimestamp[0] &&
        c.timestamp[1] === selectedWordTimestamp[1],
    );
    if (!chunk) return null;
    return { text: chunk.text, override: chunk.styleOverride ?? {} };
  }, [result, selectedWordTimestamp]);

  // Get current phrase words for the word chip bar
  // Pre-compute phrase chunks once per transcript/mode change (not per frame)
  const processedPhraseChunks = useMemo(() => {
    if (!result || mode !== "phrase") return [];
    return processTranscriptChunks(
      result,
      "phrase",
      subtitleStyle.maxWordsPerLine,
      subtitleStyle.dynamicEnabled,
    );
  }, [
    result,
    mode,
    subtitleStyle.maxWordsPerLine,
    subtitleStyle.dynamicEnabled,
  ]);

  const handleTimeUpdate = useCallback(
    (time: number) => {
      // Only call setCurrentTime when the active phrase chunk changes.
      // This prevents main-app (and all its children) from re-rendering every
      // 250ms during playback. VideoCaption uses localTime inside VideoUpload
      // and doesn't need main-app re-renders for subtitle display.
      if (processedPhraseChunks.length > 0) {
        const newChunk = binarySearchActiveChunk(processedPhraseChunks, time);
        const newKey = newChunk
          ? `${newChunk.timestamp[0]}-${newChunk.timestamp[1]}`
          : null;
        if (newKey !== lastChunkKeyRef.current) {
          lastChunkKeyRef.current = newKey;
          setCurrentTime(time);
        }
      } else {
        // Word mode or no transcript: update normally (sidebar highlighting)
        setCurrentTime(time);
      }
    },
    [processedPhraseChunks],
  );

  // Keep word editing available in both caption display modes.
  const currentEditableWords = useMemo(() => {
    if (!result) return [];
    if (mode === "word") {
      const word = binarySearchActiveChunk(result.chunks, currentTime);
      return word && !word.disabled && !word.subtitleHidden ? [word] : [];
    }
    const activeChunk = binarySearchActiveChunk(
      processedPhraseChunks,
      currentTime,
    );
    return (activeChunk?.words ?? []).filter(
      (word) => !word.disabled && !word.subtitleHidden,
    );
  }, [result, mode, processedPhraseChunks, currentTime]);

  const isProcessing = status !== "idle" && status !== "ready";
  const isPreparingTranscription = isProcessing && result === null;
  const isTranscribingBanner = isProcessing && result !== null;
  const statusMessage = STATUS_MESSAGES[status] ?? "Processing video...";
  const latestTranscribedTime = result?.chunks?.at(-1)?.timestamp?.[1] ?? null;
  const visibleProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const deviceLabel = device === "webgpu" ? "WebGPU" : "CPU";

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      if (Math.abs(videoRef.current.currentTime - time) > 0.001) {
        videoRef.current.currentTime = time;
      }
      setCurrentTime(time);
    }
  }, []);
  const handleTranscriptUpdate = useCallback(
    (updated: TranscriptionResult) => {
      setResult((previous) =>
        previous ? { ...previous, ...updated } : updated,
      );
    },
    [setResult],
  );
  const showTranscript = useCallback(() => {
    setEditorTab("subtitles");
    setMobilePanelOpen(true);
    setSelectedWordTimestamp(null);
  }, []);
  const handleTimingChange = useCallback(
    (snapshot: TimedSubtitle[]) => {
      if (selectedWordTimestamp && result) {
        const index = result.chunks.findIndex(
          (chunk) =>
            chunk.timestamp[0] === selectedWordTimestamp[0] &&
            chunk.timestamp[1] === selectedWordTimestamp[1],
        );
        if (snapshot[index])
          setSelectedWordTimestamp(snapshot[index].timestamp);
      }
      setResult((previous) =>
        previous && previous.chunks.length === snapshot.length
          ? {
              ...previous,
              chunks: restoreSubtitleTiming(previous.chunks, snapshot),
            }
          : previous,
      );
    },
    [result, selectedWordTimestamp, setResult],
  );
  useEffect(
    () => () => {
      silenceDetectionRunIdRef.current += 1;
      silenceDetectionAbortRef.current?.abort();
    },
    [],
  );

  return (
    <main
      ref={editorElementRef}
      className={styles.editor}
      data-editing={result !== null}
    >
      {!isPreparingTranscription ? (
        <h1 className="sr-only">FatahTech Subtitles video editor</h1>
      ) : null}
      <header className={styles.header}>
        <BrandLockup />
        <span className={styles.projectName} title={uploadedFile?.name}>
          {uploadedFile?.name || "Untitled Project"}
        </span>
        {isTranscribingBanner ? (
          <div
            className={styles.headerProgress}
            role="status"
            title={`${statusMessage} ${visibleProgress}%`}
          >
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span className={styles.headerProgressLabel}>{statusMessage}</span>
            {latestTranscribedTime !== null ? (
              <span className={styles.headerProgressTime}>
                {formatTime(latestTranscribedTime)}
              </span>
            ) : null}
            <strong>{visibleProgress}%</strong>
            <progress
              value={visibleProgress}
              max={100}
              aria-label="Transcription progress"
            />
          </div>
        ) : null}
        <div className={styles.headerActions}>
          <span className={styles.localBadge}>
            <span />
            100% Local
          </span>
          {isProcessing ? (
            <Button variant="outline" onClick={cancelTranscription}>
              Cancel
            </Button>
          ) : result ? (
            <>
              <Button
                variant="outline"
                aria-label="New video"
                onClick={() => setShowResetConfirm(true)}
                disabled={isDownloadProcessing}
              >
                <Upload />
                <span>New video</span>
              </Button>
              <Button
                variant="outline"
                aria-label="Generate subtitles"
                title="Generate subtitles"
                onClick={handleChangeLanguage}
                disabled={isProcessing || isDownloadProcessing}
              >
                <RefreshCw />
                <span>Generate subtitles</span>
              </Button>
              <ExportMenu
                quality={exportQuality}
                onQualityChange={setExportQuality}
                onExport={handleExport}
                processing={isDownloadProcessing}
                longVideo={videoDuration > 30 * 60}
                disabled={
                  isDownloadProcessing ||
                  isBgModelLoading ||
                  isBgProcessing ||
                  isDetectingSilence
                }
                title={
                  isBgModelLoading || isBgProcessing
                    ? "Wait for the person effect to finish."
                    : undefined
                }
              />
            </>
          ) : (
            <Button variant="outline" onClick={() => setShowResetConfirm(true)}>
              Cancel
            </Button>
          )}
        </div>
      </header>
      {error ? (
        <Alert
          variant="destructive"
          className="mx-auto my-3 w-[calc(100%-2rem)]"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!isDownloadProcessing && downloadStatus.startsWith("Error:") ? (
        <Alert
          variant="destructive"
          className="mx-auto my-3 w-[calc(100%-2rem)]"
        >
          <AlertDescription>{downloadStatus}</AlertDescription>
        </Alert>
      ) : null}
      {showLanguageModal ? (
        <LanguageSelectionModal
          open={showLanguageModal}
          onClose={handleModalClose}
          onConfirm={handleLanguageConfirm}
          defaultLanguage={language}
          defaultModelSize={modelSize}
        />
      ) : null}
      {isPreparingTranscription ? (
        <TranscriptionProgress
          status={status}
          progress={visibleProgress}
          modelLoading={modelLoading}
          device={device}
        />
      ) : null}
      <div
        className={`${styles.workspace} ${!result ? styles.emptyWorkspace : ""}`}
        hidden={isPreparingTranscription}
      >
        {result ? (
          <>
            <nav className={styles.rail} aria-label="Editor tools">
              <button
                type="button"
                data-active={
                  editorTab === "style" && (!isMobileEditor || mobilePanelOpen)
                }
                aria-pressed={
                  editorTab === "style" && (!isMobileEditor || mobilePanelOpen)
                }
                onClick={() => {
                  setMobilePanelOpen(
                    !(mobilePanelOpen && editorTab === "style"),
                  );
                  setSelectedWordTimestamp(null);
                  setEditorTab("style");
                }}
              >
                <SlidersHorizontal />
                <span>Style</span>
              </button>
              <button
                type="button"
                data-active={
                  editorTab === "subtitles" &&
                  (!isMobileEditor || mobilePanelOpen)
                }
                aria-pressed={
                  editorTab === "subtitles" &&
                  (!isMobileEditor || mobilePanelOpen)
                }
                onClick={() => {
                  setMobilePanelOpen(
                    !(mobilePanelOpen && editorTab === "subtitles"),
                  );
                  setSelectedWordTimestamp(null);
                  setEditorTab("subtitles");
                }}
              >
                <Captions />
                <span>Subtitles</span>
              </button>
              <button
                type="button"
                data-active={
                  editorTab === "video" && (!isMobileEditor || mobilePanelOpen)
                }
                aria-pressed={
                  editorTab === "video" && (!isMobileEditor || mobilePanelOpen)
                }
                onClick={() => {
                  setMobilePanelOpen(
                    !(mobilePanelOpen && editorTab === "video"),
                  );
                  setSelectedWordTimestamp(null);
                  setEditorTab("video");
                }}
              >
                <Video />
                <span>Video</span>
              </button>
              <button
                type="button"
                className={styles.aboutButton}
                aria-label="About"
                onClick={() => setShowAboutSheet(true)}
              >
                <Info />
                <span>About</span>
              </button>
            </nav>
            <aside
              className={styles.sidebar}
              data-mobile-open={mobilePanelOpen && !selectedWordTimestamp}
              aria-label={
                editorTab === "style"
                  ? "Subtitle style"
                  : editorTab === "subtitles"
                    ? "Edit subtitles"
                    : "Video settings"
              }
            >
              <div className={styles.panelTools}>
                <strong>
                  {editorTab === "style"
                    ? "Subtitle style"
                    : editorTab === "subtitles"
                      ? "Subtitles"
                      : "Video settings"}
                </strong>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMobilePanelOpen(false)}
                >
                  Done
                </Button>
              </div>
              <ScrollArea
                key={editorTab}
                className={styles.sidebarScroll}
                data-panel={editorTab}
                type="scroll"
              >
                {editorTab === "style" ? (
                  <StyleControls
                    style={effectiveSubtitleStyle}
                    onChange={(next) =>
                      setSubtitleStyle(
                        stackedPortrait
                          ? {
                              ...next,
                              dynamicEnabled: subtitleStyle.dynamicEnabled,
                              backgroundRemovalEnabled:
                                subtitleStyle.backgroundRemovalEnabled,
                              splitSubtitleMode:
                                subtitleStyle.splitSubtitleMode,
                            }
                          : next,
                      )
                    }
                    mode={mode}
                    onModeChange={handleModeChange}
                    personEffects={
                      <PersonSubtitleControls
                        placement={subtitleStyle.splitSubtitleMode}
                        onPlacementChange={(placement) =>
                          setSubtitleStyle((previous) => ({
                            ...previous,
                            splitSubtitleMode: placement,
                          }))
                        }
                        portrait={ratio === "9:16"}
                        depthEnabled={subtitleStyle.dynamicEnabled}
                        onDepthChange={(enabled) => {
                          if (enabled) handlePersonEffect("depth");
                          else
                            setSubtitleStyle((previous) => ({
                              ...previous,
                              dynamicEnabled: false,
                            }));
                        }}
                        modelLoading={isBgModelLoading}
                        processing={isBgProcessing}
                        progress={bgProgress}
                        onCancel={handleCancelBgRemoval}
                        disabled={isDownloadProcessing || stackedPortrait}
                      />
                    }
                  />
                ) : null}
                {editorTab === "subtitles" ? (
                  <>
                    <TranscriptSidebar
                      className={styles.transcriptPanel}
                      transcript={result}
                      currentTime={currentTime}
                      setCurrentTime={handleSeek}
                      onTranscriptUpdate={handleTranscriptUpdate}
                      mode={mode}
                      maxWordsPerLine={subtitleStyle.maxWordsPerLine}
                      dynamicEnabled={subtitleStyle.dynamicEnabled}
                      videoFileName={uploadedFile?.name}
                    />
                    {result.generationTime ? (
                      <p className={styles.panelFootnote}>
                        Generated in {Math.round(result.generationTime / 1000)}s
                        · {deviceLabel}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {editorTab === "video" ? (
                  <div className={styles.videoSettings}>
                    <div className={styles.panelHeading}>
                      <h2>Video settings</h2>
                      <p>Frame your video and refine the pace.</p>
                    </div>
                    <div className={styles.settingGroup}>
                      <label htmlFor="video-ratio">Aspect ratio</label>
                      <Select value={ratio} onValueChange={handleRatioChange}>
                        <SelectTrigger id="video-ratio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16:9">Landscape · 16:9</SelectItem>
                          <SelectItem value="9:16">Portrait · 9:16</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {ratio === "9:16" ? (
                      <Button
                        variant={zoomPortrait ? "default" : "outline"}
                        disabled={stackedPortrait}
                        onClick={() => handleZoomPortraitChange(!zoomPortrait)}
                      >
                        <ZoomIn />
                        {zoomPortrait ? "Zoom to fill" : "Fit video"}
                      </Button>
                    ) : null}
                    {ratio === "9:16" && (
                      <div className={styles.settingGroup}>
                        <label htmlFor="portrait-layout">Portrait layout</label>
                        <Select
                          value={portraitLayout}
                          disabled={isDownloadProcessing}
                          onValueChange={(value) =>
                            setPortraitLayout(value as "single" | "stacked")
                          }
                        >
                          <SelectTrigger id="portrait-layout">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="single">
                              Single person
                            </SelectItem>
                            <SelectItem value="stacked">
                              Two people · top / bottom
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p role="status">
                          {isFaceLoading
                            ? "Finding faces…"
                            : faceCount >= 2
                              ? `${faceCount} faces detected · try a stacked layout.`
                              : "Use a stacked layout for a two-person conversation."}
                        </p>
                        {stackedPortrait && (
                          <>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label htmlFor="portrait-zoom">Face zoom</label>
                                <output htmlFor="portrait-zoom">
                                  {Math.round(portraitZoom * 100)}%
                                </output>
                              </div>
                              <input
                                id="portrait-zoom"
                                type="range"
                                min={1}
                                max={2.5}
                                step={0.05}
                                value={portraitZoom}
                                disabled={isDownloadProcessing}
                                aria-valuetext={`${Math.round(portraitZoom * 100)} percent`}
                                onChange={(event) =>
                                  setPortraitZoom(Number(event.target.value))
                                }
                                className="w-full accent-primary"
                              />
                              <p>
                                Zoom both views closer to the faces. 100%
                                restores the original framing.
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              disabled={isDownloadProcessing}
                              onClick={() =>
                                setPortraitSwapped((value) => !value)
                              }
                            >
                              Swap top / bottom
                            </Button>
                            <p>
                              {faceCount > 2
                                ? "Frames the two largest faces, ordered left to right. "
                                : "Left/right order can be swapped. "}
                              A single detected face fills the frame. Without
                              detections, uses a left/right split. Person
                              effects and auto zoom resume in Single person
                              layout.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <VideoEffectsControls
                      trackingEnabled={faceTrackingEnabled}
                      canTrackPerson={ratio === "9:16" && isVideoLandscape}
                      onTrackingChange={setFaceTrackingEnabled}
                      backgroundEnabled={subtitleStyle.backgroundRemovalEnabled}
                      backgroundReady={bgRemovalReady}
                      modelPreference={bgModelPreference}
                      qualityTier={bgQualityTier}
                      onModelPreferenceChange={handleBgModelPreferenceChange}
                      onQualityTierChange={handleBgQualityTierChange}
                      backgroundType={subtitleStyle.backgroundType}
                      backgroundColor={subtitleStyle.solidBackgroundColor}
                      blurIntensity={subtitleStyle.blurIntensity}
                      customBackgroundImage={
                        subtitleStyle.customBackgroundImage
                      }
                      onBackgroundTypeChange={(backgroundType) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          backgroundType,
                        }))
                      }
                      onBackgroundColorChange={(solidBackgroundColor) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          solidBackgroundColor,
                        }))
                      }
                      onBlurIntensityChange={(blurIntensity) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          blurIntensity,
                        }))
                      }
                      onCustomBackgroundImageChange={(customBackgroundImage) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          customBackgroundImage:
                            customBackgroundImage ?? undefined,
                        }))
                      }
                      modelLoading={isBgModelLoading}
                      processing={isBgProcessing}
                      phase={bgPhase}
                      progress={bgProgress}
                      activeModelId={bgActiveModelId}
                      device={bgDevice}
                      fallbackReason={bgFallbackReason}
                      hardwareWarning={bgHardwareWarning}
                      subjectCoverage={bgSubjectCoverage}
                      subjectDetected={bgSubjectDetected}
                      carriedFrames={bgCarriedFrames}
                      maskPlan={bgMaskPlan}
                      restoredFromCache={bgRestoredFromCache}
                      onReanalyze={handleReanalyzeBg}
                      disabled={isDownloadProcessing || stackedPortrait}
                      showWatermark={subtitleStyle.showWatermark !== false}
                      onShowWatermarkChange={(showWatermark) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          showWatermark,
                        }))
                      }
                      colorGrade={
                        subtitleStyle.colorGrade ?? NEUTRAL_COLOR_GRADE
                      }
                      onColorGradeChange={(colorGrade) =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          colorGrade,
                        }))
                      }
                      colorPresets={footageColor.presets}
                      colorAnalysisStatus={footageColor.status}
                      colorGradeDisabled={isDownloadProcessing}
                      onRemoveBackground={() =>
                        handlePersonEffect("background")
                      }
                      onToggleBackground={() =>
                        setSubtitleStyle((previous) => ({
                          ...previous,
                          dynamicEnabled: false,
                          backgroundRemovalEnabled:
                            !previous.backgroundRemovalEnabled,
                        }))
                      }
                      onCancelBackground={handleCancelBgRemoval}
                    />
                    <div className={styles.settingGroup}>
                      <label htmlFor="silence-removal">Silence removal</label>
                      <p role="status" aria-live="polite">
                        {isDetectingSilence
                          ? "Finding quiet sections… Changes apply when this finishes."
                          : silenceRemovalLevel === "off"
                            ? "Off — play and export the original pauses."
                            : silenceRemovedRanges.length === 0
                              ? "No matching pauses found. The video is unchanged."
                              : `Active in preview and export · ${silenceRemovedRanges.length} cuts · ${silenceDurationLabel}`}
                      </p>
                      {silenceRemovalLevel !== "off" &&
                      !isDetectingSilence &&
                      silenceRemovedRanges.length > 0 ? (
                        <p>
                          The playhead skips the cut sections. Timeline times
                          refer to the original video.
                        </p>
                      ) : null}
                      <Select
                        value={silenceRemovalLevel}
                        onValueChange={handleSilenceRemovalLevelChange}
                        disabled={isDetectingSilence || isDownloadProcessing}
                      >
                        <SelectTrigger id="silence-removal">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="aggressive">
                            {SILENCE_REMOVAL_LEVELS.aggressive.label}
                          </SelectItem>
                          <SelectItem value="default">
                            {SILENCE_REMOVAL_LEVELS.default.label}
                          </SelectItem>
                          <SelectItem value="conservative">
                            {SILENCE_REMOVAL_LEVELS.conservative.label}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant={autoZoomEnabled ? "default" : "outline"}
                      disabled={stackedPortrait}
                      onClick={() => setAutoZoomEnabled((value) => !value)}
                    >
                      <Clapperboard />
                      Auto zoom cuts {autoZoomEnabled ? "on" : "off"}
                    </Button>
                    <p className={styles.settingHint}>
                      Automatically alternates between wider and closer framing
                      every few seconds, using detected faces to center the
                      crop.
                    </p>
                    <Button
                      variant="outline"
                      onClick={handleChangeLanguage}
                      disabled={isProcessing || isDownloadProcessing}
                    >
                      <RefreshCw />
                      Regenerate subtitles
                    </Button>
                  </div>
                ) : null}
              </ScrollArea>
            </aside>
          </>
        ) : null}
        <div className={styles.canvasColumn}>
          {isMobileEditor && selectedWordInfo && selectedWordTimestamp ? (
            <div className={styles.mobileWordPanel}>
              <WordStylePopover
                key={`${selectedWordTimestamp[0]}-${selectedWordTimestamp[1]}`}
                compact
                wordText={selectedWordInfo.text}
                override={selectedWordInfo.override}
                onChange={handleWordStyleChange}
                onReset={handleWordStyleReset}
                onClose={handleWordStyleClose}
              />
            </div>
          ) : null}
          <section
            className={styles.preview}
            data-ratio={ratio}
            aria-label="Video preview"
          >
            <div className={styles.videoStage}>
              <VideoUpload
                key={uploadKey}
                className={styles.videoUpload}
                onVideoSelect={handleVideoSelect}
                onAspectRatioDetected={handleAspectRatioDetected}
                onDurationChange={setVideoDuration}
                ref={videoRef}
                onTimeUpdate={handleTimeUpdate}
                transcript={result}
                currentTime={currentTime}
                subtitleStyle={effectiveSubtitleStyle}
                stackedPortrait={stackedPortrait}
                portraitSwapped={portraitSwapped}
                portraitZoom={portraitZoom}
                getFaces={getFaces}
                onSubtitleStyleChange={(change, timestamp, globally) => {
                  if (globally) {
                    setSubtitleStyle((previous) => ({
                      ...previous,
                      ...change,
                    }));
                    setResult((previous) =>
                      previous
                        ? {
                            ...previous,
                            chunks: clearCaptionPlacements(previous.chunks),
                          }
                        : previous,
                    );
                  } else {
                    const placement = {
                      ...(change.customPosition
                        ? { customPosition: change.customPosition }
                        : {}),
                      ...(change.fontSize !== undefined
                        ? { fontSize: change.fontSize }
                        : {}),
                    };
                    setResult((previous) =>
                      previous
                        ? {
                            ...previous,
                            chunks: updateCaptionPlacement(
                              previous.chunks,
                              timestamp,
                              mode,
                              placement,
                            ),
                          }
                        : previous,
                    );
                  }
                }}
                mode={mode}
                ratio={ratio}
                zoomPortrait={zoomPortrait}
                initialFile={initialFile}
                bgRemovalReady={bgRemovalReady}
                getMaskAtTime={getMaskAtTime}
                getCenterX={getCenterX}
                isFaceTrackingActive={isFaceTrackingActive}
                cropTrackingEnabled={
                  faceTrackingEnabled && ratio === "9:16" && isVideoLandscape
                }
                silenceRemovalRanges={
                  silenceRemovalLevel === "off" ? [] : silenceRemovedRanges
                }
                autoZoomEnabled={autoZoomEnabled && !stackedPortrait}
              />
            </div>
            {!isMobileEditor && selectedWordInfo && selectedWordTimestamp ? (
              <WordStylePopover
                key={`${selectedWordTimestamp[0]}-${selectedWordTimestamp[1]}`}
                wordText={selectedWordInfo.text}
                override={selectedWordInfo.override}
                onChange={handleWordStyleChange}
                onReset={handleWordStyleReset}
                onClose={handleWordStyleClose}
                className={styles.wordPopover}
              />
            ) : null}
            {result ? (
              <div className={styles.wordChips}>
                <span>
                  <SlidersHorizontal size={14} aria-hidden="true" /> Edit words
                  · click a word
                </span>
                {currentEditableWords.length === 0 ? (
                  <p className={styles.wordChipsHint}>
                    Select a subtitle or seek to speech to edit words.
                  </p>
                ) : null}
                {currentEditableWords.map((word, index) => (
                  <Button
                    key={`${word.timestamp[0]}-${index}`}
                    size="xs"
                    variant="outline"
                    data-selected={
                      selectedWordTimestamp?.[0] === word.timestamp[0] &&
                      selectedWordTimestamp?.[1] === word.timestamp[1]
                    }
                    aria-label={`Edit word: ${word.text}`}
                    aria-pressed={
                      selectedWordTimestamp?.[0] === word.timestamp[0] &&
                      selectedWordTimestamp?.[1] === word.timestamp[1]
                    }
                    onClick={() => handleWordSelect(word.timestamp)}
                  >
                    {word.text}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
          {!result && !isProcessing ? (
            <div
              className={styles.emptyPrompt}
              role={notice ? "status" : undefined}
            >
              <h2>
                {notice ? "No audio detected" : "Your video. Your words."}
              </h2>
              <p>
                {notice?.replace(/^No audio detected\. /, "") ??
                  "Choose the spoken language to start. All video processing stays on this device."}
              </p>
              <Button
                onClick={() =>
                  notice ? handleResetVideo() : setShowLanguageModal(true)
                }
              >
                {notice ? "Choose another video" : "Generate subtitles"}
              </Button>
            </div>
          ) : null}
          {result ? (
            <>
              <EditorTimeline
                key={uploadKey}
                videoRef={videoRef}
                transcript={result}
                duration={videoDuration}
                file={uploadedFile}
                silenceRemovalRanges={
                  silenceRemovalLevel === "off"
                    ? undefined
                    : silenceRemovedRanges
                }
                fileName={uploadedFile?.name}
                maxWordsPerLine={subtitleStyle.maxWordsPerLine}
                mode={mode}
                timingDisabled={isProcessing || isDownloadProcessing}
                onTimingChange={handleTimingChange}
                onSeek={handleSeek}
                onEdit={showTranscript}
                previewControls={
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleZoomPortraitChange(!zoomPortrait)}
                      disabled={ratio !== "9:16" || stackedPortrait}
                      aria-label={
                        zoomPortrait
                          ? "Fit video in frame"
                          : "Zoom video to fill"
                      }
                    >
                      {zoomPortrait ? <ZoomIn /> : <ZoomOut />}
                      {zoomPortrait ? "Zoom" : "Fit"}
                    </Button>
                    <Select value={ratio} onValueChange={handleRatioChange}>
                      <SelectTrigger
                        aria-label="Preview aspect ratio"
                        className="w-28 bg-white"
                      >
                        {ratio === "9:16" ? (
                          <RectangleVertical size={16} />
                        ) : (
                          <RectangleHorizontal size={16} />
                        )}
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16:9">16:9</SelectItem>
                        <SelectItem value="9:16">9:16</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                }
              />
              {isDownloadProcessing ? (
                <div className={styles.exportProgress} role="status">
                  <div>
                    <strong>{downloadStatus}</strong>
                    <span>{Math.round(downloadProgress)}%</span>
                  </div>
                  <progress
                    value={downloadProgress}
                    max={100}
                    aria-label="Video export progress"
                  />
                  <Button variant="outline" onClick={cancelDownload}>
                    Stop export
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <AlertDialog
        open={bgConfirmationDuration !== null}
        onOpenChange={(open) => {
          if (!open) setBgConfirmationDuration(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Long video</AlertDialogTitle>
            <AlertDialogDescription>
              This video is {formatTime(bgConfirmationDuration ?? 0)} long
              (minutes:seconds). Background analysis processes every sampled
              frame and can take several minutes. Fast mode uses the person
              model at a lower sample rate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() =>
                void startBgRemoval(pendingPersonEffectRef.current.effect, {
                  fast: true,
                })
              }
            >
              Use fast mode
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingPersonEffectRef.current;
                void startBgRemoval(pending.effect, {
                  model: pending.model,
                  tier: pending.tier,
                });
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current subtitles and styling will be lost. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleResetVideo}>
              Upload New
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={showAboutSheet} onOpenChange={setShowAboutSheet}>
        <SheetContent side="right" className="rounded-l-2xl">
          <SheetHeader>
            <SheetTitle>FatahTech Subtitles</SheetTitle>
            <SheetDescription>
              Video subtitles, made on your device.
            </SheetDescription>
          </SheetHeader>
          <div className={styles.aboutContent}>
            <p>
              Built by{" "}
              <a
                href="https://fatahtech.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                FatahTech
              </a>
            </p>
            <a href="/changelog">What is new · v{APP_VERSION}</a>
            <a
              href="https://github.com/THJ420/FatahTech_Subtitles"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source on GitHub
            </a>
            <a
              href="https://huggingface.co/docs/transformers.js"
              target="_blank"
              rel="noopener noreferrer"
            >
              Transformers.js
            </a>
            <a
              href="https://github.com/Vanilagy/mediabunny"
              target="_blank"
              rel="noopener noreferrer"
            >
              MediaBunny
            </a>
            <a href="#">Buy me a coffee</a>
            <a
              href="https://fatahtech.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              More from FatahTech
            </a>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
