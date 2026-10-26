import { Eraser, Loader2, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DebouncedColorInput } from "@/components/ui/debounced-color-input";
import type { SubtitleStyle } from "@/components/subtitle-styling";
import styles from "./editor.module.css";

interface VideoEffectsControlsProps {
  trackingEnabled: boolean;
  canTrackPerson: boolean;
  onTrackingChange: (enabled: boolean) => void;
  backgroundEnabled: boolean;
  backgroundReady: boolean;
  backgroundType: SubtitleStyle["backgroundType"];
  backgroundColor: string;
  onBackgroundTypeChange: (type: SubtitleStyle["backgroundType"]) => void;
  onBackgroundColorChange: (color: string) => void;
  modelLoading: boolean;
  processing: boolean;
  progress: number;
  disabled: boolean;
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
  onBackgroundTypeChange,
  onBackgroundColorChange,
  modelLoading,
  processing,
  progress,
  disabled,
  onRemoveBackground,
  onToggleBackground,
  onCancelBackground,
}: VideoEffectsControlsProps) {
  const busy = modelLoading || processing;
  return (
    <section
      className={styles.cameraSettings}
      aria-labelledby="camera-settings"
    >
      <h3 id="camera-settings">Camera</h3>
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
        <p>Remove the background around the person in your video.</p>
        {busy ? (
          <>
            <span className={styles.effectStatus} role="status">
              <Loader2
                size={15}
                className="animate-spin motion-reduce:animate-none"
              />
              {modelLoading
                ? "Loading background model…"
                : `Processing video… ${Math.round(progress)}%`}
            </span>
            <Button variant="outline" onClick={onCancelBackground}>
              Cancel background removal
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={backgroundReady ? onToggleBackground : onRemoveBackground}
          >
            <Eraser size={16} />
            {backgroundReady && backgroundEnabled
              ? "Restore background"
              : "Remove background"}
          </Button>
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
            {(["solid", "blur"] as const).map((type) => (
              <Button
                key={type}
                variant={backgroundType === type ? "default" : "outline"}
                aria-pressed={backgroundType === type}
                disabled={disabled}
                onClick={() => onBackgroundTypeChange(type)}
              >
                {type === "solid" ? "Solid color" : "Blurred"}
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
        </div>
      ) : null}
    </section>
  );
}
