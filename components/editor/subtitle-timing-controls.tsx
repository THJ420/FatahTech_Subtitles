"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseSubtitleTime } from "@/lib/subtitle-timing";
import styles from "./editor.module.css";

function TimingField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => boolean | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseSubtitleTime(draft);
    if (parsed === null || onCommit(parsed) === false) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
  };
  return (
    <label className={styles.timingField}>
      <span>{label}</span>
      <Input
        aria-label={`Subtitle ${label.toLowerCase()} time`}
        aria-invalid={invalid}
        title="Seconds or HH:MM:SS.mmm"
        inputMode="decimal"
        value={draft ?? value.toFixed(3)}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            setInvalid(false);
          }
        }}
      />
      {invalid ? (
        <span role="alert">Enter a valid time within the word’s limits.</span>
      ) : null}
    </label>
  );
}

export function SubtitleTimingControls({
  text,
  start,
  end,
  disabled,
  canUndo,
  canReset,
  onChange,
  onUndo,
  onReset,
  error,
}: {
  text: string;
  start: number;
  end: number;
  disabled: boolean;
  canUndo: boolean;
  canReset: boolean;
  onChange: (edge: "start" | "end", value: number) => boolean | undefined;
  onUndo: () => void;
  onReset: () => void;
  error: string;
}) {
  return (
    <div
      className={styles.timingControls}
      role="group"
      aria-label="Subtitle timing"
    >
      <strong className={styles.timingText} title={text}>
        {text}
      </strong>
      <TimingField
        key={`start-${start}`}
        label="Start"
        value={start}
        disabled={disabled}
        onCommit={(value) => onChange("start", value)}
      />
      <TimingField
        key={`end-${end}`}
        label="End"
        value={end}
        disabled={disabled}
        onCommit={(value) => onChange("end", value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !canUndo}
        onClick={onUndo}
      >
        Undo timing
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !canReset}
        onClick={onReset}
      >
        Reset timing
      </Button>
      {error ? (
        <p className={styles.timingError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
