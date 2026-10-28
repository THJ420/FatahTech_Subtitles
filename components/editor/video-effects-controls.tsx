import { useState, type ChangeEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  Eraser,
  Loader2,
  RefreshCw,
  ScanFace,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { DebouncedColorInput } from "@/components/ui/debounced-color-input";
import { getBgModel, type BgDevice, type BgModelId } from "@/lib/bg-models";
import { BG_QUALITY_PRESETS, type BgQualityTier } from "@/lib/bg-quality";
import type { MaskStorePlan } from "@/lib/mask-store";
import {
  BACKGROUND_TYPES,
  DEFAULT_BLUR_INTENSITY,
  blurRadiusFor,
  type BackgroundType,
} from "@/lib/video-background";
import type { BgProcessingPhase } from "@/hooks/useBackgroundRemoval";
import type { ColorGrade, ColorGradePreset } from "@/lib/color-grade";
import type { ColorAnalysisStatus } from "@/lib/color-grade-analysis";
import { ColorGradeControls } from "./color-grade-controls";
import styles from "./editor.module.css";

const BACKGROUND_LABELS: Record<BackgroundType, string> = {
  solid: "Solid color",
  blur: "Blurred",
  transparent: "Transparent",
  image: "Image",
};

interface ModelOption {
  id: BgModelId | "auto";
  label: string;
  description: string;
}

const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "modnet",
    label: "Person / Portrait",
    description:
      "Fast matting optimized for people, podcasts, and talking heads.",
  },
  {
    id: "birefnet-lite",
    label: "Universal Object / Scene",
    description:
      "High-precision matting for products, food, animals, and complex scenes.",
  },
  {
    id: "auto",
    label: "Automatic",
    description: "Uses the best model this device can run.",
  },
];

/** Inline data URLs live in React state, so keep them to a sane size. */
const MAX_BACKGROUND_IMAGE_BYTES = 12 * 1024 * 1024;

interface StatusBadgeProps {
  children: ReactNode;
  title?: string;
}

function StatusBadge({ children, title }: StatusBadgeProps) {
  return (
    <span
      title={title}
      className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
    >
      {children}
    </span>
  );
}

interface VideoEffectsControlsProps {
  trackingEnabled: boolean;
  canTrackPerson: boolean;
  onTrackingChange: (enabled: boolean) => void;
  backgroundEnabled: boolean;
  backgroundReady: boolean;
  backgroundType: BackgroundType;
  backgroundColor: string;
  blurIntensity: number;
  customBackgroundImage?: string;
  onBackgroundTypeChange: (type: BackgroundType) => void;
  onBackgroundColorChange: (color: string) => void;
  onBlurIntensityChange: (intensity: number) => void;
  onCustomBackgroundImageChange: (image: string | null) => void;
  modelPreference: BgModelId | "auto";
  qualityTier: BgQualityTier;
  onModelPreferenceChange: (model: BgModelId | "auto") => void;
  onQualityTierChange: (tier: BgQualityTier) => void;
  modelLoading: boolean;
  processing: boolean;
  phase: BgProcessingPhase;
  progress: number;
  activeModelId: BgModelId | null;
  device: BgDevice | null;
  fallbackReason: string | null;
  hardwareWarning: string | null;
  subjectCoverage: number | null;
  subjectDetected: boolean;
  carriedFrames: number;
  maskPlan: MaskStorePlan | null;
  restoredFromCache: boolean;
  onReanalyze: () => void;
  disabled: boolean;
  showWatermark: boolean;
  onShowWatermarkChange: (show: boolean) => void;
  colorGrade: ColorGrade;
  onColorGradeChange: (grade: ColorGrade) => void;
  colorPresets: readonly ColorGradePreset[];
  colorAnalysisStatus: ColorAnalysisStatus;
  colorGradeDisabled: boolean;
  onRemoveBackground: () => void;
  onToggleBackground: () => void;
  onCancelBackground: () => void;
}

export function VideoEffectsControls({
  trackingEnabled,
  canTrackPerson,
  onTrackingChange,
  backgroundEnabled,
  backgroundReady,
  backgroundType,
  backgroundColor,
  blurIntensity,
  customBackgroundImage,
  onBackgroundTypeChange,
  onBackgroundColorChange,
  onBlurIntensityChange,
  onCustomBackgroundImageChange,
  modelPreference,
  qualityTier,
  onModelPreferenceChange,
  onQualityTierChange,
  modelLoading,
  processing,
  phase,
  progress,
  activeModelId,
  device,
  fallbackReason,
  hardwareWarning,
  subjectCoverage,
  subjectDetected,
  carriedFrames,
  maskPlan,
  restoredFromCache,
  onReanalyze,
  disabled,
  showWatermark,
  onShowWatermarkChange,
  colorGrade,
  onColorGradeChange,
  colorPresets,
  colorAnalysisStatus,
  colorGradeDisabled,
  onRemoveBackground,
  onToggleBackground,
  onCancelBackground,
}: VideoEffectsControlsProps) {
  const [imageError, setImageError] = useState<string | null>(null);
  const busy = modelLoading || processing;
  const progressPercent = Math.round(progress);

  const modelLabel = activeModelId ? getBgModel(activeModelId).label : null;
  const deviceLabel =
    device === "webgpu" ? "GPU" : device === "wasm" ? "CPU" : null;
  const deviceTitle =
    device === "webgpu"
      ? "WebGPU"
      : device === "wasm"
        ? "WASM (CPU)"
        : undefined;
  const coverageLabel =
    subjectCoverage === null
      ? null
      : subjectDetected
        ? `Subject ${Math.round(subjectCoverage * 100)}%`
        : "No subject detected";

  const blurValue = Number.isFinite(blurIntensity)
    ? blurIntensity
    : DEFAULT_BLUR_INTENSITY;

  const maskPlanLabel = maskPlan
    ? `${maskPlan.width}×${maskPlan.height} @ ${
        Number.isInteger(maskPlan.sampleFps)
          ? maskPlan.sampleFps
          : maskPlan.sampleFps.toFixed(1)
      } fps`
    : null;
  const allFramesFailed =
    maskPlan !== null &&
    maskPlan.totalFrames > 0 &&
    carriedFrames >= maskPlan.totalFrames;
  const cpuCompatibilityMode =
    activeModelId === "birefnet-lite" && device === "wasm";
  const cpuModelFallback =
    modelPreference === "birefnet-lite" &&
    activeModelId === "modnet" &&
    device === "wasm";

  const handleBackgroundImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset the input so choosing the same file again still fires a change.
    input.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageError("Choose an image file.");
      return;
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setImageError("Choose an image smaller than 12 MB.");
      return;
    }

    setImageError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onCustomBackgroundImageChange(reader.result);
      } else {
        setImageError("That image could not be read.");
      }
    };
    reader.onerror = () => setImageError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  return (
    <>
      <section
        className={styles.cameraSettings}
        aria-labelledby="camera-settings"
      >
        <h3 id="camera-settings">Camera</h3>
        <div className={styles.settingGroup}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="show-watermark">Show Watermark</label>
            <Switch
              id="show-watermark"
              checked={showWatermark}
              onCheckedChange={onShowWatermarkChange}
            />
          </div>
          <p>
            {showWatermark
              ? "subtitle.fatahtech.com is drawn in the bottom corner of the preview and the exported video."
              : "The watermark is omitted from the preview and the exported video."}
          </p>
        </div>
        <div className={styles.settingGroup}>
          <div className={styles.settingToggle}>
            <label htmlFor="track-person">
              <ScanFace size={17} /> Track person in crop
            </label>
            <Switch
              id="track-person"
              checked={trackingEnabled}
              onCheckedChange={onTrackingChange}
              disabled={disabled || !canTrackPerson}
              aria-describedby="track-person-help"
            />
          </div>
          <p id="track-person-help">
            {canTrackPerson
              ? "Keep the person centered in the portrait crop."
              : "Use a landscape video in the 9:16 layout to track the person."}
          </p>
        </div>

        <div className={styles.settingGroup}>
          <label>Background removal</label>
          <p>Remove the background around the subject in your video.</p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Subject model</span>
            <div
              className="flex flex-col gap-2"
              role="group"
              aria-label="Background removal model"
            >
              {MODEL_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant={
                    modelPreference === option.id ? "default" : "outline"
                  }
                  aria-pressed={modelPreference === option.id}
                  disabled={disabled || busy}
                  onClick={() => onModelPreferenceChange(option.id)}
                  className="h-auto w-full justify-start px-3 py-2 text-left whitespace-normal"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      {option.label}
                    </span>
                    <span className="text-xs font-normal opacity-80">
                      {option.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Performance &amp; quality
            </span>
            <div
              className="flex flex-col gap-2"
              role="group"
              aria-label="Processing quality"
            >
              {BG_QUALITY_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant={qualityTier === preset.id ? "default" : "outline"}
                  aria-pressed={qualityTier === preset.id}
                  disabled={disabled || busy}
                  onClick={() => onQualityTierChange(preset.id)}
                  className="h-auto w-full justify-start px-3 py-2 text-left whitespace-normal"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      {preset.label}
                      {preset.recommended ? " (Recommended)" : ""}
                    </span>
                    <span className="text-xs font-normal opacity-80">
                      {preset.summary}
                    </span>
                    {preset.footnote ? (
                      <span className="text-[11px] font-normal opacity-70">
                        {preset.footnote}
                      </span>
                    ) : null}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {busy ? (
            <>
              <span
                className={styles.effectStatus}
                role="status"
                aria-live="polite"
              >
                <Loader2
                  size={15}
                  className="animate-spin motion-reduce:animate-none"
                />
                {modelLoading || phase === "loading"
                  ? "Loading background model…"
                  : restoredFromCache
                    ? "Restored from cache"
                    : phase === "coarse"
                      ? `Building quick preview · ${progressPercent}%`
                      : `Refining edges · ${progressPercent}%`}
              </span>
              {!modelLoading ? (
                <Progress
                  value={progress}
                  aria-label="Background analysis progress"
                />
              ) : null}
              {modelLabel ||
              deviceLabel ||
              coverageLabel ||
              cpuCompatibilityMode ||
              restoredFromCache ? (
                <div className="flex flex-wrap gap-1.5">
                  {modelLabel ? <StatusBadge>{modelLabel}</StatusBadge> : null}
                  {deviceLabel ? (
                    <StatusBadge title={deviceTitle}>{deviceLabel}</StatusBadge>
                  ) : null}
                  {cpuCompatibilityMode ? (
                    <StatusBadge title="512×512 input on WASM">
                      512px CPU
                    </StatusBadge>
                  ) : null}
                  {restoredFromCache ? <StatusBadge>Cached</StatusBadge> : null}
                  {coverageLabel ? (
                    <StatusBadge>{coverageLabel}</StatusBadge>
                  ) : null}
                </div>
              ) : null}
              {phase === "refine" ? (
                <p>
                  Preview is ready. Refining the remaining frames sharpens the
                  edges.
                </p>
              ) : null}
              {maskPlanLabel ? (
                <p>
                  Masks {maskPlanLabel}
                  {maskPlan?.degraded
                    ? " · reduced to fit this clip in memory"
                    : ""}
                </p>
              ) : null}
              {fallbackReason ? <p>{fallbackReason}</p> : null}
              {hardwareWarning ? <p>{hardwareWarning}</p> : null}
              {cpuCompatibilityMode ? (
                <p role="status">
                  Universal model running in CPU compatibility mode (512px) —
                  processing may be slower.
                </p>
              ) : null}
              {cpuModelFallback ? (
                <p role="status">
                  The universal model cannot run safely on this CPU. The Person
                  model is being used instead.
                </p>
              ) : null}
              {carriedFrames > 0 ? (
                <p>
                  {carriedFrames} frame{carriedFrames === 1 ? "" : "s"} used a
                  fallback mask after an inference error.
                </p>
              ) : null}
              <Button variant="outline" onClick={onCancelBackground}>
                Cancel background removal
              </Button>
            </>
          ) : (
            <>
              {backgroundReady ? (
                <span className={styles.effectStatus} role="status">
                  <CheckCircle2 size={15} />
                  Background ready
                  {modelLabel ? ` · ${modelLabel}` : ""}
                  {deviceLabel ? ` · ${deviceLabel}` : ""}
                  {restoredFromCache ? " · Cached" : ""}
                </span>
              ) : null}
              {restoredFromCache ? (
                <p role="status">
                  Masks restored from cache. Re-analyze to refresh them.
                </p>
              ) : null}
              {allFramesFailed ? (
                <p role="status">
                  Every frame fell back to the original video. Try Person mode
                  or Fast quality, and check the browser console for the model
                  error.
                </p>
              ) : null}
              {maskPlanLabel ? (
                <p>
                  Masks {maskPlanLabel}
                  {maskPlan?.degraded
                    ? " · reduced to fit this clip in memory"
                    : ""}
                </p>
              ) : null}
              {fallbackReason ? <p>{fallbackReason}</p> : null}
              {hardwareWarning ? <p>{hardwareWarning}</p> : null}
              {cpuCompatibilityMode ? (
                <p role="status">
                  Universal model running in CPU compatibility mode (512px) —
                  processing may be slower.
                </p>
              ) : null}
              {cpuModelFallback ? (
                <p role="status">
                  The universal model cannot run safely on this CPU. The Person
                  model is being used instead.
                </p>
              ) : null}
              {carriedFrames > 0 ? (
                <p>
                  {carriedFrames} frame{carriedFrames === 1 ? "" : "s"} used a
                  fallback mask after an inference error.
                </p>
              ) : null}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={
                  backgroundReady ? onToggleBackground : onRemoveBackground
                }
              >
                <Eraser size={16} />
                {backgroundReady && backgroundEnabled
                  ? "Restore background"
                  : "Remove background"}
              </Button>
              {backgroundReady && backgroundEnabled ? (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={onReanalyze}
                >
                  <RefreshCw size={16} />
                  Re-analyze video
                </Button>
              ) : null}
            </>
          )}
        </div>

        {backgroundReady && backgroundEnabled && !busy ? (
          <div className={styles.settingGroup}>
            <span className="text-sm font-medium">Video background</span>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="Video background type"
            >
              {BACKGROUND_TYPES.map((type) => (
                <Button
                  key={type}
                  variant={backgroundType === type ? "default" : "outline"}
                  aria-pressed={backgroundType === type}
                  disabled={disabled}
                  onClick={() => onBackgroundTypeChange(type)}
                >
                  {BACKGROUND_LABELS[type]}
                </Button>
              ))}
            </div>

            {backgroundType === "solid" ? (
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="video-background-color">Background color</label>
                <DebouncedColorInput
                  id="video-background-color"
                  aria-label="Video background color"
                  value={backgroundColor}
                  onChange={onBackgroundColorChange}
                  disabled={disabled}
                />
              </div>
            ) : null}

            {backgroundType === "blur" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Blur intensity</span>
                  <output>{Math.round(blurValue)}%</output>
                </div>
                <Slider
                  value={[blurValue]}
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  aria-label="Background blur intensity"
                  aria-valuetext={`${Math.round(blurValue)} percent`}
                  onValueChange={(values) =>
                    onBlurIntensityChange(values[0] ?? DEFAULT_BLUR_INTENSITY)
                  }
                />
                <p>
                  Softens the original background by {blurRadiusFor(blurValue)}{" "}
                  px while keeping the subject sharp.
                </p>
              </div>
            ) : null}

            {backgroundType === "transparent" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="video-background-export-color">
                    Export background color
                  </label>
                  <DebouncedColorInput
                    id="video-background-export-color"
                    aria-label="Export background color"
                    value={backgroundColor}
                    onChange={onBackgroundColorChange}
                    disabled={disabled}
                  />
                </div>
                <p>
                  The checkerboard is preview only. MP4 and WebM exports cannot
                  store transparency, so they use this color instead.
                </p>
              </div>
            ) : null}

            {backgroundType === "image" ? (
              <div className="space-y-2">
                <label htmlFor="video-background-image">Background image</label>
                <input
                  id="video-background-image"
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={handleBackgroundImageFile}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                />
                {customBackgroundImage ? (
                  <div className="flex items-center gap-2">
                    <div
                      role="img"
                      aria-label="Selected background image"
                      className="h-14 flex-1 rounded-md border border-border bg-cover bg-center"
                      style={{
                        backgroundImage: `url("${customBackgroundImage}")`,
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      aria-label="Remove background image"
                      onClick={() => {
                        setImageError(null);
                        onCustomBackgroundImageChange(null);
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : null}
                {imageError ? <p role="alert">{imageError}</p> : null}
                <p>
                  Fills the frame behind the subject. The image stays on your
                  device.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <ColorGradeControls
        grade={colorGrade}
        onChange={onColorGradeChange}
        presets={colorPresets}
        analysisStatus={colorAnalysisStatus}
        disabled={colorGradeDisabled}
      />
    </>
  );
}
