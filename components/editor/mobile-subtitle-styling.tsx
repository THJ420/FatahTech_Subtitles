"use client";
import { useState, type ComponentProps } from "react";
import { SubtitleStyling, FONT_FAMILIES } from "../subtitle-styling";
import { Slider } from "../ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export function MobileSubtitleStyling({
  style,
  onChange,
  mode,
  onModeChange,
  personEffects,
}: ComponentProps<typeof SubtitleStyling>) {
  const [tab, setTab] = useState("Font");
  return (
    <div className="space-y-3 pb-2">
      <div
        className="flex rounded-lg bg-neutral-100 p-1"
        role="group"
        aria-label="Style category"
      >
        {["Font", "Color", "Effects", "More"].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
            className={`flex-1 rounded-md py-2 text-xs font-semibold ${tab === name ? "bg-yellow-300 text-neutral-950" : ""}`}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "Font" && (
        <>
          <div
            role="group"
            aria-label="Subtitle display mode"
            className="flex gap-2"
          >
            {(["word", "phrase"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onModeChange?.(value)}
                className={`flex-1 rounded-md border py-2 text-xs ${mode === value ? "bg-yellow-100 border-yellow-400" : ""}`}
              >
                {value === "word" ? "Word" : "Line"}
              </button>
            ))}
          </div>
          <Select
            value={style.fontFamily}
            onValueChange={(fontFamily) => onChange({ ...style, fontFamily })}
          >
            <SelectTrigger aria-label="Subtitle font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(FONT_FAMILIES).map((font) => (
                <SelectItem key={font.value} value={font.value}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-3 text-xs">
            <span>Size</span>
            <Slider
              aria-label="Subtitle size"
              min={8}
              max={80}
              step={1}
              value={[style.fontSize]}
              onValueChange={([fontSize]) => onChange({ ...style, fontSize })}
            />
            <span>{style.fontSize}</span>
          </div>
        </>
      )}
      {tab === "Color" && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="flex items-center justify-between gap-2">
            Text
            <input
              aria-label="Subtitle text color"
              type="color"
              value={style.color}
              onChange={(e) => onChange({ ...style, color: e.target.value })}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Outline
            <input
              aria-label="Subtitle outline color"
              type="color"
              value={style.borderColor}
              onChange={(e) =>
                onChange({ ...style, borderColor: e.target.value })
              }
            />
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={style.uppercase}
              onChange={(e) =>
                onChange({ ...style, uppercase: e.target.checked })
              }
            />
            Uppercase
          </label>
        </div>
      )}
      {tab === "Effects" && personEffects}
      {tab === "More" && (
        <SubtitleStyling
          style={style}
          onChange={onChange}
          mode={mode}
          onModeChange={onModeChange}
          personEffects={personEffects}
        />
      )}
    </div>
  );
}
