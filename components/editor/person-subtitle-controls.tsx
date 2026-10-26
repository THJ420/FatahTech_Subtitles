import { Layers, Loader2, ScanFace } from "lucide-react";
import type { SubtitleStyle } from "@/components/subtitle-styling";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import styles from "@/components/editor-panels.module.css";

const PLACEMENTS = [
  { value: "none", label: "Off" },
  { value: "above-below", label: "Top / Bottom" },
  { value: "left-right", label: "Left / Right" },
] as const;

interface PersonSubtitleControlsProps {
  placement: SubtitleStyle["splitSubtitleMode"];
  onPlacementChange: (placement: SubtitleStyle["splitSubtitleMode"]) => void;
  portrait: boolean;
  depthEnabled: boolean;
  onDepthChange: (enabled: boolean) => void;
  modelLoading: boolean;
  processing: boolean;
  progress: number;
  onCancel: () => void;
  disabled: boolean;
}

export function PersonSubtitleControls({
  placement,
  onPlacementChange,
  portrait,
  depthEnabled,
  onDepthChange,
  modelLoading,
  processing,
  progress,
  onCancel,
  disabled,
}: PersonSubtitleControlsProps) {
  const busy = modelLoading || processing;
  return (
    <section className={styles.personEffects} aria-labelledby="person-effects">
      <h3 id="person-effects">
        <ScanFace size={16} /> Person effects
      </h3>
      <fieldset disabled={disabled}>
        <legend>Subtitles around the head</legend>
        <div className={styles.placementOptions}>
          {PLACEMENTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={placement === value}
              disabled={portrait && value === "left-right"}
              onClick={() => onPlacementChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          {portrait
            ? "Use 16:9 for left and right subtitles that follow the person."
            : "Left / Right follows the person. Top / Bottom places text above and below."}
        </p>
      </fieldset>
      <div className={styles.depthToggle}>
        <label htmlFor="text-behind-person">
          <Layers size={16} /> Text behind person
        </label>
        <Switch
          id="text-behind-person"
          checked={depthEnabled}
          onCheckedChange={onDepthChange}
          disabled={disabled || busy}
          aria-describedby="text-behind-help"
        />
      </div>
      <p id="text-behind-help">
        Place words behind or in front of the person. Use Line mode, then choose
        each word&apos;s layer in Subtitles.
      </p>
      {busy ? (
        <div className={styles.personEffectProgress}>
          <p role="status">
            <Loader2
              size={15}
              className="animate-spin motion-reduce:animate-none"
            />
            {modelLoading
              ? "Loading person model…"
              : `Processing video… ${Math.round(progress)}%`}
          </p>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel processing
          </Button>
        </div>
      ) : null}
    </section>
  );
}
