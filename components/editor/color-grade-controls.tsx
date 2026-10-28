"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useCustomColorPresets } from "@/hooks/useCustomColorPresets";
import {
  COLOR_GRADE_CONTROLS,
  NEUTRAL_COLOR_GRADE,
  colorGradesEqual,
  copyColorGrade,
  gradeHexColor,
  isNeutralColorGrade,
  type ColorGrade,
  type ColorGradeControl,
  type ColorGradeKey,
  type ColorGradePreset,
} from "@/lib/color-grade";
import type { ColorAnalysisStatus } from "@/lib/color-grade-analysis";
import {
  detectColorGradeEngine,
  type ColorGradeEngine,
} from "@/lib/color-grade-renderer";
import styles from "./editor.module.css";

const SWATCH_RAMP = [
  "#0b1020",
  "#2f4b7c",
  "#8fb4ff",
  "#e8c39e",
  "#f7f3ea",
] as const;

const CONTROL_GROUPS: { label: string; controls: ColorGradeControl[] }[] =
  COLOR_GRADE_CONTROLS.reduce<
    { label: string; controls: ColorGradeControl[] }[]
  >((groups, control) => {
    const existing = groups.find((group) => group.label === control.group);
    if (existing) existing.controls.push(control);
    else groups.push({ label: control.group, controls: [control] });
    return groups;
  }, []);

function formatValue(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function GradeSwatches({ grade }: { grade: ColorGrade }) {
  return (
    <span className={styles.gradeSwatches} aria-hidden="true">
      {SWATCH_RAMP.map((color) => (
        <span key={color} style={{ background: gradeHexColor(grade, color) }} />
      ))}
    </span>
  );
}

interface ColorGradeControlsProps {
  grade: ColorGrade;
  onChange: (grade: ColorGrade) => void;
  presets: readonly ColorGradePreset[];
  analysisStatus: ColorAnalysisStatus;
  disabled: boolean;
}

export function ColorGradeControls({
  grade,
  onChange,
  presets,
  analysisStatus,
  disabled,
}: ColorGradeControlsProps) {
  const {
    presets: customPresets,
    save,
    remove,
    nameError,
  } = useCustomColorPresets();
  const [name, setName] = useState("");
  const [engine] = useState<ColorGradeEngine>(() => detectColorGradeEngine());

  const neutral = isNeutralColorGrade(grade);
  const simplified = engine === "filter";

  const update = (key: ColorGradeKey, value: number) => {
    onChange({ ...grade, [key]: value });
  };

  const handleSave = () => {
    if (save(name, grade)) setName("");
  };

  const handlePreset = (preset: ColorGradePreset) => {
    onChange(copyColorGrade(preset.grade));
  };

  return (
    <section
      className={styles.cameraSettings}
      aria-labelledby="color-light-settings"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="color-light-settings">Color &amp; Light</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || neutral}
          onClick={() => onChange(copyColorGrade(NEUTRAL_COLOR_GRADE))}
        >
          <RotateCcw size={13} />
          Reset
        </Button>
      </div>

      <p className={styles.effectStatus} role="status">
        {analysisStatus === "sampling" ? (
          <>
            <Loader2 size={13} className="animate-spin" />
            Analyzing footage for tailored looks…
          </>
        ) : analysisStatus === "ready" ? (
          "Looks tuned to this clip."
        ) : analysisStatus === "unavailable" ? (
          "Footage analysis unavailable — using standard looks."
        ) : (
          "Import a clip to tailor the looks."
        )}
      </p>
      {simplified ? (
        <p role="status">
          This browser uses a simplified grade: gamma, highlights, and shadows
          need WebGL2.
        </p>
      ) : null}

      <div className={styles.settingGroup}>
        <span className="text-sm font-medium">Looks</span>
        <div className={styles.gradePresetGrid}>
          <button
            type="button"
            className={styles.gradePreset}
            data-active={neutral}
            style={
              neutral
                ? { borderColor: "#93b4ff", background: "#e7ecff" }
                : undefined
            }
            disabled={disabled}
            onClick={() => onChange(copyColorGrade(NEUTRAL_COLOR_GRADE))}
          >
            <span className={styles.gradePresetLabel}>Neutral</span>
            <span className={styles.gradePresetDescription}>
              Original footage, no corrections.
            </span>
            <GradeSwatches grade={NEUTRAL_COLOR_GRADE} />
          </button>
          {presets.map((preset) => {
            const active = colorGradesEqual(grade, preset.grade);
            return (
              <button
                key={preset.id}
                type="button"
                className={styles.gradePreset}
                data-active={active}
                style={
                  active
                    ? { borderColor: "#93b4ff", background: "#e7ecff" }
                    : undefined
                }
                disabled={disabled}
                onClick={() => handlePreset(preset)}
              >
                <span className={styles.gradePresetLabel}>{preset.label}</span>
                <span className={styles.gradePresetDescription}>
                  {preset.description}
                </span>
                <GradeSwatches grade={preset.grade} />
              </button>
            );
          })}
        </div>

        {customPresets.length ? (
          <div className={styles.savedLookList}>
            {customPresets.map((preset) => {
              const active = colorGradesEqual(grade, preset.grade);
              return (
                <span
                  key={preset.id}
                  className="inline-flex items-center gap-0.5"
                >
                  <button
                    type="button"
                    className={styles.savedLookApply}
                    data-active={active}
                    style={
                      active
                        ? { borderColor: "#93b4ff", background: "#e7ecff" }
                        : undefined
                    }
                    disabled={disabled}
                    onClick={() => onChange(copyColorGrade(preset.grade))}
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    className={styles.savedLookDelete}
                    aria-label={`Delete ${preset.name}`}
                    disabled={disabled}
                    onClick={() => remove(preset.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="flex gap-1.5">
          <Input
            value={name}
            maxLength={32}
            placeholder="Name this look"
            aria-label="Look name"
            disabled={disabled}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
            }}
          />
          <Button
            variant="outline"
            disabled={disabled || neutral}
            onClick={handleSave}
          >
            <Save size={15} />
            Save
          </Button>
        </div>
        {nameError ? <p role="alert">{nameError}</p> : null}
      </div>

      {CONTROL_GROUPS.map((group) => (
        <div key={group.label} className={styles.settingGroup}>
          <span className="text-sm font-medium">{group.label}</span>
          {group.controls.map((control) => {
            const sliderDisabled =
              disabled || (simplified && control.requiresWebGL);
            return (
              <div key={control.key} className={styles.gradeSliderRow}>
                <div className={styles.gradeSliderLabel}>
                  <label id={`color-grade-${control.key}-label`}>
                    {control.label}
                  </label>
                  <output>{formatValue(grade[control.key])}</output>
                </div>
                <Slider
                  min={-100}
                  max={100}
                  step={1}
                  value={[grade[control.key]]}
                  onValueChange={(values) =>
                    update(control.key, values[0] ?? 0)
                  }
                  disabled={sliderDisabled}
                  aria-labelledby={`color-grade-${control.key}-label`}
                  aria-valuetext={`${control.label} ${formatValue(
                    grade[control.key],
                  )}`}
                />
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
