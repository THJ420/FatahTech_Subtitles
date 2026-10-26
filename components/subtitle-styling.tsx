"use client";

import { CSSProperties, type ReactNode, useId, useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DebouncedColorInput } from "@/components/ui/debounced-color-input";
import panelStyles from "@/components/editor-panels.module.css";
import { getWordEmphasisBackground } from "@/lib/subtitle-appearance";

// Helper to check if a color is effectively transparent
function isTransparentColor(color: string): boolean {
  return (
    color === "transparent" || color === "rgba(0, 0, 0, 0)" || color === ""
  );
}

// Helper to convert rgba to hex (for display in color input)
function rgbaToHex(rgba: string): string {
  // If it's already hex, return as-is
  if (rgba.startsWith("#")) return rgba;

  // If it's transparent, return a default color
  if (isTransparentColor(rgba)) return "#000000";

  // Parse rgba(r, g, b, a) format
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  return "#000000";
}

export interface SubtitleStyle {
  /** Center within the output video frame, stored as fractions (0–1). */
  customPosition?: { x: number; y: number };
  uppercase?: boolean;
  wordEmphasisBackgroundColor?: string;
  fontFamily: string; // Note: FFmpeg uses single font file, family switching limited
  fontSize: number;
  fontWeight: string;
  color: string;
  backgroundColor: string;
  backgroundStyle: "solid" | "glass";
  borderWidth: number;
  borderColor: string;
  dropShadowIntensity: number;
  wordEmphasisEnabled: boolean;
  wordEmphasisColorEnabled: boolean;
  wordEmphasisColor: string;
  windEnabled: boolean; // reveal words with a small wind-in motion as they are spoken
  position: "top" | "middle" | "bottom";
  maxWordsPerLine: number;
  backgroundRemovalEnabled: boolean;
  backgroundType: "solid" | "blur";
  solidBackgroundColor: string;
  // Dynamic subtitle controls
  dynamicEnabled: boolean; // toggle for behind/front 3D depth effect
  dynamicFontSize: number; // behind text font size in px at 500px preview height (default 80)
  dynamicYPosition: number; // behind text vertical position 0-100 (0=top, 100=bottom, default 35)
  dynamicFrontFontSize: number; // front text font size at 500px preview height (default 40)
  dynamicFrontYPosition: number; // front text fallback Y position 0-100 (default 75)
  dynamicFollowWord: boolean; // highlight spoken word in front text (phrase mode only)
  textFadeIn: boolean; // letter-by-letter fade-in effect
  showWatermark: boolean; // draw the fatahtech.com watermark on previews and exports
  splitSubtitleMode: "none" | "above-below" | "left-right"; // split subtitle around head
  verticalOffset: number; // fine-tune vertical position in px, range -50..+50 (positive = down)
}

interface SubtitleStylingProps {
  style: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
  mode?: "word" | "phrase";
  onModeChange?: (mode: "word" | "phrase") => void;
  className?: string;
  personEffects?: ReactNode;
}

export const FONT_FAMILIES = {
  plusJakartaSans: {
    label: "Plus Jakarta Sans",
    value: "var(--font-plus-jakarta-sans), 'Plus Jakarta Sans', sans-serif",
    cssFont: "var(--font-plus-jakarta-sans), 'Plus Jakarta Sans', sans-serif",
  },
  outfit: {
    label: "Outfit",
    value: "var(--font-outfit), 'Outfit', sans-serif",
    cssFont: "var(--font-outfit), Outfit, sans-serif",
  },
  inter: {
    label: "Inter",
    value: "var(--font-inter), 'Inter', sans-serif",
    cssFont: "var(--font-inter), Inter, sans-serif",
  },
  roboto: {
    label: "Roboto",
    value: "var(--font-roboto), 'Roboto', sans-serif",
    cssFont: "var(--font-roboto), Roboto, sans-serif",
  },
  openSans: {
    label: "Open Sans",
    value: "var(--font-open-sans), 'Open Sans', sans-serif",
    cssFont: "var(--font-open-sans), 'Open Sans', sans-serif",
  },
  nunito: {
    label: "Nunito",
    value: "var(--font-nunito), 'Nunito', sans-serif",
    cssFont: "var(--font-nunito), Nunito, sans-serif",
  },
  montserrat: {
    label: "Montserrat",
    value: "var(--font-montserrat), 'Montserrat', sans-serif",
    cssFont: "var(--font-montserrat), Montserrat, sans-serif",
  },
  poppins: {
    label: "Poppins",
    value: "var(--font-poppins), 'Poppins', sans-serif",
    cssFont: "var(--font-poppins), Poppins, sans-serif",
  },
  fredoka: {
    label: "Fredoka",
    value: "var(--font-fredoka), 'Fredoka', sans-serif",
    cssFont: "var(--font-fredoka), Fredoka, sans-serif",
  },
  righteous: {
    label: "Righteous",
    value: "var(--font-righteous), 'Righteous', sans-serif",
    cssFont: "var(--font-righteous), Righteous, sans-serif",
  },
  anton: {
    label: "Anton",
    value: "var(--font-anton), 'Anton', sans-serif",
    cssFont: "var(--font-anton), Anton, sans-serif",
  },
  bangers: {
    label: "Bangers",
    value: "var(--font-bangers), 'Bangers', cursive",
    cssFont: "var(--font-bangers), Bangers, cursive",
  },
  oswald: {
    label: "Oswald",
    value: "var(--font-oswald), 'Oswald', sans-serif",
    cssFont: "var(--font-oswald), Oswald, sans-serif",
  },
  bebasNeue: {
    label: "Bebas Neue",
    value: "var(--font-bebas-neue), 'Bebas Neue', sans-serif",
    cssFont: "var(--font-bebas-neue), 'Bebas Neue', sans-serif",
  },
  permanentMarker: {
    label: "Permanent Marker",
    value: "var(--font-permanent-marker), 'Permanent Marker', cursive",
    cssFont: "var(--font-permanent-marker), 'Permanent Marker', cursive",
  },
  pacifico: {
    label: "Pacifico",
    value: "var(--font-pacifico), 'Pacifico', cursive",
    cssFont: "var(--font-pacifico), Pacifico, cursive",
  },
  lobster: {
    label: "Lobster",
    value: "var(--font-lobster), 'Lobster', cursive",
    cssFont: "var(--font-lobster), Lobster, cursive",
  },
  alfaSlabOne: {
    label: "Alfa Slab One",
    value: "var(--font-alfa-slab-one), 'Alfa Slab One', serif",
    cssFont: "var(--font-alfa-slab-one), 'Alfa Slab One', serif",
  },
  staatliches: {
    label: "Staatliches",
    value: "var(--font-staatliches), 'Staatliches', sans-serif",
    cssFont: "var(--font-staatliches), Staatliches, sans-serif",
  },
  fugazOne: {
    label: "Fugaz One",
    value: "var(--font-fugaz-one), 'Fugaz One', cursive",
    cssFont: "var(--font-fugaz-one), 'Fugaz One', cursive",
  },
  chewy: {
    label: "Chewy",
    value: "var(--font-chewy), 'Chewy', cursive",
    cssFont: "var(--font-chewy), Chewy, cursive",
  },
  playfairDisplay: {
    label: "Playfair Display",
    value: "var(--font-playfair-display), 'Playfair Display', serif",
    cssFont: "var(--font-playfair-display), 'Playfair Display', serif",
  },
  lora: {
    label: "Lora",
    value: "var(--font-lora), 'Lora', serif",
    cssFont: "var(--font-lora), Lora, serif",
  },
  lilitaOne: {
    label: "Lilita One",
    value: "var(--font-lilita-one), 'Lilita One', sans-serif",
    cssFont: "var(--font-lilita-one), 'Lilita One', sans-serif",
  },
  arial: {
    label: "Arial",
    value: "Arial, sans-serif",
    cssFont: "Arial, sans-serif",
  },
  verdana: {
    label: "Verdana",
    value: "Verdana, sans-serif",
    cssFont: "Verdana, sans-serif",
  },
  helvetica: {
    label: "Helvetica",
    value: "Helvetica, Arial, sans-serif",
    cssFont: "Helvetica, Arial, sans-serif",
  },
} satisfies Record<string, { label: string; value: string; cssFont: string }>;

const fontOptions = Object.values(FONT_FAMILIES);

const FONT_SIZE_STOPS = [
  { value: 12, label: "Extra small" },
  { value: 16, label: "Small" },
  { value: 22, label: "Medium" },
  { value: 28, label: "Big" },
] as const;

// Map each slider stop to its subtitle size.
function sliderIndexToFontSize(index: number): number {
  return FONT_SIZE_STOPS[index]?.value ?? 22;
}

function fontSizeToSliderIndex(fontSize: number): number {
  // Find closest stop
  let closestIndex = 1;
  let closestDist = Infinity;
  FONT_SIZE_STOPS.forEach((stop, i) => {
    const dist = Math.abs(stop.value - fontSize);
    if (dist < closestDist) {
      closestDist = dist;
      closestIndex = i;
    }
  });
  return closestIndex;
}

const fontWeightOptions = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi Bold" },
  { value: "700", label: "Bold" },
];

type SubtitlePresetName =
  | "green"
  | "gold"
  | "subtitle"
  | "gamer"
  | "formal"
  | "glass";

interface SubtitlePreset {
  name: SubtitlePresetName;
  label: string;
  style: Partial<SubtitleStyle>;
}

const PRESETS: SubtitlePreset[] = [
  {
    name: "glass",
    label: "Glass",
    style: {
      fontFamily: FONT_FAMILIES.outfit.value,
      fontSize: 22,
      fontWeight: "500",
      color: "#FFFFFF",
      backgroundColor: "rgba(255, 255, 255, 0.22)",
      backgroundStyle: "glass",
      borderWidth: 0,
      borderColor: "rgba(255, 255, 255, 0.45)",
      dropShadowIntensity: 0.45,
      position: "bottom",
      maxWordsPerLine: 6,
    },
  },
  {
    name: "formal",
    label: "Formal",
    style: {
      fontFamily: FONT_FAMILIES.playfairDisplay.value,
      fontSize: 22,
      fontWeight: "600",
      color: "#FFFFFF",
      backgroundColor: "transparent",
      backgroundStyle: "solid",
      borderWidth: 1,
      borderColor: "#1A1A1A",
      dropShadowIntensity: 0.55,
      position: "bottom",
      maxWordsPerLine: 3,
    },
  },
  {
    name: "green",
    label: "Green",
    style: {
      fontFamily: FONT_FAMILIES.bangers.value,
      fontSize: 16,
      fontWeight: "600",
      color: "#00FF41",
      backgroundColor: "#0B0B0B",
      backgroundStyle: "solid",
      borderWidth: 0,
      borderColor: "#000000",
      dropShadowIntensity: 0.4,
      position: "bottom",
      maxWordsPerLine: 6,
    },
  },
  {
    name: "gold",
    label: "Gold",
    style: {
      fontFamily: FONT_FAMILIES.inter.value,
      fontSize: 16,
      fontWeight: "700",
      color: "#FFFFFF",
      backgroundColor: "transparent",
      uppercase: false,
      wordEmphasisEnabled: true,
      wordEmphasisColorEnabled: true,
      wordEmphasisColor: "#000000",
      wordEmphasisBackgroundColor: "#FFE600",
      backgroundStyle: "solid",
      borderWidth: 0,
      borderColor: "#000000",
      dropShadowIntensity: 0.4,
      position: "bottom",
      maxWordsPerLine: 3,
    },
  },
  {
    name: "subtitle",
    label: "Subtitle",
    style: {
      fontFamily: FONT_FAMILIES.outfit.value,
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
      backgroundColor: "rgba(0, 0, 0, 0.75)",
      backgroundStyle: "solid",
      borderWidth: 0,
      borderColor: "#000000",
      dropShadowIntensity: 0.3,
      position: "bottom",
      maxWordsPerLine: 6,
    },
  },
  {
    name: "gamer",
    label: "Gamer",
    style: {
      fontFamily: FONT_FAMILIES.bebasNeue.value,
      fontSize: 16,
      fontWeight: "700",
      color: "#94FBAB",
      backgroundColor: "#141414",
      backgroundStyle: "solid",
      borderWidth: 0,
      borderColor: "#FF00FF",
      dropShadowIntensity: 0.6,
      position: "bottom",
      maxWordsPerLine: 6,
    },
  },
];

interface PresetButtonProps {
  preset: SubtitlePreset;
  isActive: boolean;
  onApply: () => void;
}

function getPresetStyle(preset: SubtitlePreset): Partial<SubtitleStyle> {
  return {
    uppercase: false,
    wordEmphasisEnabled: false,
    wordEmphasisColorEnabled: false,
    wordEmphasisColor: "#F2D21B",
    wordEmphasisBackgroundColor: "#000000",
    ...preset.style,
  };
}

function PresetButton({ preset, isActive, onApply }: PresetButtonProps) {
  const presetCssFont =
    fontOptions.find((font) => font.value === preset.style.fontFamily)
      ?.cssFont ?? preset.style.fontFamily;
  const isGlassPreset = preset.style.backgroundStyle === "glass";

  return (
    <button
      type="button"
      onClick={onApply}
      aria-pressed={isActive}
      aria-label={`${preset.label} style preset`}
      className={panelStyles.preset}
    >
      <span
        className={panelStyles.presetFace}
        style={{
          fontFamily: presetCssFont,
          fontWeight: preset.style.fontWeight as CSSProperties["fontWeight"],
          color: preset.style.color,
          background: isGlassPreset
            ? "linear-gradient(130deg, #85817c, #b4ada2 47%, #575751)"
            : isTransparentColor(preset.style.backgroundColor ?? "")
              ? "#44454a"
              : preset.style.backgroundColor,
          textShadow: `1px 2px 3px rgba(0,0,0,${preset.style.dropShadowIntensity ?? 0})`,
        }}
      >
        <span
          style={
            preset.style.wordEmphasisEnabled
              ? {
                  borderRadius: 5,
                  padding: "3px 9px",
                  background: preset.style.wordEmphasisBackgroundColor,
                  color: preset.style.wordEmphasisColor,
                  textShadow: "none",
                }
              : isGlassPreset
                ? {
                    borderRadius: 5,
                    padding: "3px 9px",
                    background: preset.style.backgroundColor,
                  }
                : undefined
          }
        >
          Aa
        </span>
      </span>
      <span className={panelStyles.presetLabel}>{preset.label}</span>
    </button>
  );
}

function isPresetActive(style: SubtitleStyle, preset: SubtitlePreset) {
  return Object.entries(getPresetStyle(preset)).every(([key, value]) => {
    if (key === "fontSize") return true;
    const styleValue = style[key as keyof SubtitleStyle];
    return styleValue === value;
  });
}

function PositionIcon({
  position,
  isActive,
}: {
  position: "top" | "middle" | "bottom";
  isActive: boolean;
}) {
  const lineColor = isActive ? "currentColor" : "currentColor";
  return (
    <svg
      width="20"
      height="24"
      viewBox="0 0 20 24"
      fill="none"
      className="shrink-0"
    >
      <rect
        x="1"
        y="1"
        width="18"
        height="22"
        rx="2"
        stroke={lineColor}
        strokeWidth="1.5"
        fill="none"
        opacity={0.4}
      />
      {position === "top" && (
        <rect x="5" y="4" width="10" height="2.5" rx="1" fill={lineColor} />
      )}
      {position === "middle" && (
        <rect x="5" y="10.75" width="10" height="2.5" rx="1" fill={lineColor} />
      )}
      {position === "bottom" && (
        <rect x="5" y="17.5" width="10" height="2.5" rx="1" fill={lineColor} />
      )}
    </svg>
  );
}

export function SubtitleStyling({
  style,
  onChange,
  mode = "phrase",
  onModeChange,
  className = "",
  personEffects,
}: SubtitleStylingProps) {
  const fontId = useId();
  const textColorId = useId();
  const watermarkId = useId();
  const activePresetName = useMemo<SubtitlePresetName | null>(() => {
    const match = PRESETS.find((preset) => isPresetActive(style, preset));
    return match ? match.name : null;
  }, [style]);

  const handleFontFamilyChange = (value: string) => {
    onChange({ ...style, fontFamily: value });
  };

  const handleFontWeightChange = (value: string) => {
    onChange({ ...style, fontWeight: value });
  };

  const handleColorChange = (color: string) => {
    onChange({ ...style, color });
  };

  const handleBackgroundColorChange = (color: string) => {
    onChange({ ...style, backgroundColor: color, backgroundStyle: "solid" });
  };

  const handleBorderColorChange = (color: string) => {
    onChange({ ...style, borderColor: color });
  };

  const handleDropShadowIntensityChange = (value: number) => {
    onChange({ ...style, dropShadowIntensity: value });
  };

  const handleWordEmphasisToggle = (value: boolean) => {
    onChange({ ...style, wordEmphasisEnabled: value });
  };

  const handleWordEmphasisColorToggle = (value: boolean) => {
    onChange({ ...style, wordEmphasisColorEnabled: value });
  };

  const handleWordEmphasisColorChange = (color: string) => {
    onChange({ ...style, wordEmphasisColor: color });
  };

  const applyPreset = (preset: SubtitlePreset) => {
    // Preserve the user's current font size — presets define visual style, not size
    onChange({ ...style, ...getPresetStyle(preset), fontSize: style.fontSize });
    if (preset.style.wordEmphasisEnabled) onModeChange?.("phrase");
  };

  // Find the current font's cssFont value for the trigger preview
  const currentFontCss = useMemo(() => {
    const match = fontOptions.find((f) => f.value === style.fontFamily);
    return match?.cssFont ?? style.fontFamily;
  }, [style.fontFamily]);

  const previewStyles = useMemo(() => {
    const base: CSSProperties = {
      fontFamily: currentFontCss,
      textTransform: style.uppercase ? "uppercase" : "none",
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      WebkitTextStroke:
        style.borderWidth > 0
          ? `${Math.max(0.5, style.borderWidth)}px ${style.borderColor}`
          : "none",
      paintOrder: "stroke fill",
      letterSpacing: "0.05em",
      filter: `drop-shadow(2px 2px ${Math.max(2, style.dropShadowIntensity * 4)}px rgba(0, 0, 0, ${style.dropShadowIntensity}))`,
      borderRadius: "0.5rem",
    };

    return {
      ...base,
      backgroundColor: style.backgroundColor,
      ...(style.backgroundStyle === "glass"
        ? {
            borderColor: "rgba(255, 255, 255, 0.38)",
            boxShadow:
              "inset 0 0 0 1px rgba(255,255,255,0.32), 0 8px 24px rgba(0,0,0,0.2)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }
        : {}),
    };
  }, [currentFontCss, style]);

  const wordEmphasisEnabled = style.wordEmphasisEnabled ?? false;
  const wordEmphasisColorEnabled = style.wordEmphasisColorEnabled ?? false;
  const wordEmphasisColor = style.wordEmphasisColor ?? "#F2D21B";
  const windEnabled = style.windEnabled ?? false;
  const fontSizeSliderIndex = fontSizeToSliderIndex(style.fontSize);

  return (
    <div className={`${panelStyles.stylePanel} ${className}`}>
      <div className={panelStyles.panelHeader}>
        <h2>Subtitle style</h2>
      </div>
      <div className={panelStyles.preview}>
        <span className={panelStyles.previewText} style={previewStyles}>
          The quick brown{" "}
          <span
            style={{
              color:
                wordEmphasisColorEnabled && mode === "phrase"
                  ? wordEmphasisColor
                  : undefined,
              backgroundColor:
                wordEmphasisEnabled && mode === "phrase"
                  ? getWordEmphasisBackground(style)
                  : undefined,
              borderRadius: 4,
              display: "inline-block",
              padding: "0 0.15em",
              transform:
                wordEmphasisEnabled && mode === "phrase"
                  ? "scale(1.18)"
                  : undefined,
            }}
          >
            fox
          </span>
        </span>
      </div>
      {/* Mode Toggle at top */}
      {onModeChange && (
        <div className={panelStyles.modeTabs}>
          <div role="group" aria-label="Subtitle display mode">
            <button
              type="button"
              aria-pressed={mode === "word"}
              onClick={() => onModeChange("word")}
            >
              Word
            </button>
            <button
              type="button"
              aria-pressed={mode === "phrase"}
              onClick={() => onModeChange("phrase")}
            >
              Line
            </button>
          </div>
        </div>
      )}

      <div className={panelStyles.controls}>
        {/* Style presets */}
        <div className="space-y-2 mb-2">
          <label className="text-sm font-medium block">Style presets</label>
          <div className={panelStyles.presetGrid}>
            {PRESETS.map((preset) => (
              <PresetButton
                key={preset.name}
                preset={preset}
                isActive={activePresetName === preset.name}
                onApply={() => applyPreset(preset)}
              />
            ))}
          </div>
        </div>

        {personEffects}

        {/* Font Family with preview */}
        <div className="space-y-2">
          <label className="text-sm font-medium block" htmlFor={fontId}>
            Font
          </label>
          <Select
            value={style.fontFamily}
            onValueChange={handleFontFamilyChange}
          >
            <SelectTrigger
              id={fontId}
              className="w-full rounded-md border-none bg-background px-3 py-2 text-sm shadow-sm"
              style={{ fontFamily: currentFontCss }}
            >
              <SelectValue placeholder="Select a font" className="text-sm" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {fontOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="text-sm"
                    style={{ fontFamily: option.cssFont }}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Font Size - only when dynamic is off (dynamic has its own size controls) */}
        {!style.dynamicEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium block">Font size</label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {style.fontSize}px
              </span>
            </div>
            <Slider
              aria-label="Subtitle font size"
              value={[fontSizeSliderIndex]}
              onValueChange={([v]) =>
                onChange({ ...style, fontSize: sliderIndexToFontSize(v) })
              }
              min={0}
              max={FONT_SIZE_STOPS.length - 1}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs mt-1">
              {FONT_SIZE_STOPS.map((stop, i) => (
                <span
                  key={stop.value}
                  className={
                    fontSizeSliderIndex === i
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground"
                  }
                >
                  {stop.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium block">Font weight</label>
          <div
            className={panelStyles.weightOptions}
            role="group"
            aria-label="Font weight"
          >
            {fontWeightOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={style.fontWeight === option.value}
                onClick={() => handleFontWeightChange(option.value)}
                style={{ fontWeight: Number(option.value) }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
          <div>
            <p className="text-sm font-medium">All uppercase</p>
            <p className="text-xs text-muted-foreground">
              Off keeps the text as written. Some fonts use capital letter
              shapes.
            </p>
          </div>
          <Switch
            checked={style.uppercase ?? false}
            onCheckedChange={(uppercase) => onChange({ ...style, uppercase })}
            aria-label="All uppercase"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium block" htmlFor={textColorId}>
            Text color
          </label>
          <div className={panelStyles.colorField}>
            <span className="text-xs uppercase">{style.color}</span>
            <DebouncedColorInput
              id={textColorId}
              value={style.color}
              onChange={handleColorChange}
            />
          </div>
        </div>

        {/* Dynamic controls: behind text size + position, front text, follow-word */}
        {style.dynamicEnabled && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Behind Text Size</label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {style.dynamicFontSize}px
                </span>
              </div>
              <Slider
                aria-label="Behind text size"
                value={[style.dynamicFontSize]}
                onValueChange={([v]) =>
                  onChange({ ...style, dynamicFontSize: v })
                }
                min={30}
                max={160}
                step={2}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Small</span>
                <span>Large</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Vertical Position</label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {style.dynamicYPosition}%
                </span>
              </div>
              <Slider
                aria-label="Behind text vertical position"
                value={[style.dynamicYPosition]}
                onValueChange={([v]) =>
                  onChange({ ...style, dynamicYPosition: v })
                }
                min={5}
                max={95}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Top</span>
                <span>Bottom</span>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/40 bg-muted/40 p-3">
              <h3 className="text-sm font-medium">Front Text</h3>
              <p className="text-xs text-muted-foreground">
                Smaller text rendered in front of the person
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Front Text Size</label>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {style.dynamicFrontFontSize}px
                  </span>
                </div>
                <Slider
                  aria-label="Front text size"
                  value={[style.dynamicFrontFontSize]}
                  onValueChange={([v]) =>
                    onChange({ ...style, dynamicFrontFontSize: v })
                  }
                  min={16}
                  max={80}
                  step={2}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Small</span>
                  <span>Large</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Front Text Position
                  </label>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {style.dynamicFrontYPosition}%
                  </span>
                </div>
                <Slider
                  aria-label="Front text vertical position"
                  value={[style.dynamicFrontYPosition]}
                  onValueChange={([v]) =>
                    onChange({ ...style, dynamicFrontYPosition: v })
                  }
                  min={30}
                  max={95}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Top</span>
                  <span>Bottom</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Position selector - hidden when dynamic is active */}
        {!style.dynamicEnabled && (
          <div className="space-y-2">
            <label className="text-sm font-medium block">Position</label>
            <p className="text-xs text-muted-foreground">
              Drag text in the preview to move it. Drag a corner to resize.
              Presets set the default for captions without custom placement.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["top", "middle", "bottom"] as const).map((pos) => {
                const isActive =
                  !style.customPosition && style.position === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() =>
                      onChange({
                        ...style,
                        position: pos,
                        customPosition: undefined,
                        verticalOffset: 0,
                      })
                    }
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-all ${
                      isActive
                        ? "border-yellow-400 bg-yellow-50 text-foreground"
                        : "border-border/50 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <PositionIcon position={pos} isActive={isActive} />
                    <span className="capitalize">{pos}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Vertical offset fine-tune */}
        {!style.dynamicEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Vertical offset</label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {(style.verticalOffset ?? 0) > 0
                  ? `+${style.verticalOffset}`
                  : (style.verticalOffset ?? 0)}
                px
              </span>
            </div>
            <Slider
              aria-label="Subtitle vertical offset"
              value={[style.verticalOffset ?? 0]}
              onValueChange={([v]) => onChange({ ...style, verticalOffset: v })}
              min={-50}
              max={50}
              step={1}
            />
          </div>
        )}
      </div>

      <section
        className={panelStyles.advanced}
        aria-labelledby="advanced-subtitle-options"
      >
        <h3 id="advanced-subtitle-options">Advanced options</h3>
        <div className={panelStyles.advancedContent}>
          {/* Max Words Per Line slider - phrase mode only */}
          {mode === "phrase" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Max Words/Line</label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {style.maxWordsPerLine}
                </span>
              </div>
              <Slider
                aria-label="Maximum words per line"
                value={[style.maxWordsPerLine]}
                onValueChange={([v]) =>
                  onChange({ ...style, maxWordsPerLine: v })
                }
                min={1}
                max={8}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1</span>
                <span>8</span>
              </div>
            </div>
          )}

          {/* Background color - hidden when dynamic is active */}
          {!style.dynamicEnabled && (
            <div className="space-y-2">
              <label className="text-sm font-medium block">
                Background Color
              </label>
              <div className="flex items-center justify-between">
                <span className="text-sm">No background</span>
                <Switch
                  aria-label="No subtitle background"
                  checked={isTransparentColor(style.backgroundColor)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({
                        ...style,
                        backgroundColor: "transparent",
                        backgroundStyle: "solid",
                      });
                    } else {
                      onChange({
                        ...style,
                        backgroundColor: "#000000",
                        backgroundStyle: "solid",
                      });
                    }
                  }}
                />
              </div>
              {!isTransparentColor(style.backgroundColor) && (
                <div className="flex items-center gap-2">
                  <DebouncedColorInput
                    aria-label="Subtitle background color"
                    value={rgbaToHex(style.backgroundColor)}
                    onChange={handleBackgroundColorChange}
                    className="w-10 h-10 rounded cursor-pointer"
                  />
                  <span className="text-sm uppercase">
                    {rgbaToHex(style.backgroundColor)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium block">
              Border Width ({style.borderWidth}px)
            </label>
            <Slider
              aria-label="Subtitle border width"
              value={[style.borderWidth]}
              onValueChange={([v]) => onChange({ ...style, borderWidth: v })}
              min={0}
              max={20}
              step={1}
            />
          </div>

          {style.borderWidth > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium block">Border Color</label>
              <div className="flex items-center gap-2">
                <DebouncedColorInput
                  aria-label="Subtitle border color"
                  value={style.borderColor}
                  onChange={handleBorderColorChange}
                  className="w-10 h-10 rounded cursor-pointer"
                />
                <span className="text-sm uppercase">{style.borderColor}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium block">
              Drop Shadow Intensity
            </label>
            <Slider
              aria-label="Subtitle shadow intensity"
              value={[Math.round(style.dropShadowIntensity * 100)]}
              onValueChange={([v]) => handleDropShadowIntensityChange(v / 100)}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Subtle</span>
              <span>Strong</span>
            </div>
          </div>

          {/* Word emphasis - hidden when dynamic is active */}
          {!style.dynamicEnabled && (
            <div className="space-y-3 rounded-lg border border-border/40 bg-muted/40 p-3">
              <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">
                    Active word emphasis resize
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mode === "word"
                      ? "Only available in phrase mode"
                      : "Scale the spoken word and show its own background color."}
                  </p>
                </div>
                <Switch
                  checked={wordEmphasisEnabled}
                  onCheckedChange={handleWordEmphasisToggle}
                  disabled={mode === "word"}
                  aria-label="Toggle active word emphasis resize"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">
                    Active word emphasis recolor
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mode === "word"
                      ? "Only available in phrase mode"
                      : "Recolor the spoken word with a custom color."}
                  </p>
                </div>
                <Switch
                  checked={wordEmphasisColorEnabled}
                  onCheckedChange={handleWordEmphasisColorToggle}
                  disabled={mode === "word"}
                  aria-label="Toggle active word emphasis recolor"
                />
              </div>

              {wordEmphasisEnabled && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Active word background</p>
                  <p className="text-xs text-muted-foreground">
                    Works even when the full subtitle background is off.
                  </p>
                  <div className="flex items-center gap-2">
                    <DebouncedColorInput
                      aria-label="Active word background color"
                      value={getWordEmphasisBackground(style)}
                      onChange={(wordEmphasisBackgroundColor) =>
                        onChange({ ...style, wordEmphasisBackgroundColor })
                      }
                      className="w-10 h-10 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      aria-label="Active word background color value"
                      value={getWordEmphasisBackground(style)}
                      onChange={(event) =>
                        onChange({
                          ...style,
                          wordEmphasisBackgroundColor: event.target.value,
                        })
                      }
                      className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm bg-background"
                    />
                  </div>
                </div>
              )}

              {wordEmphasisColorEnabled && (
                <div className="space-y-2">
                  <label className="text-sm font-medium block">
                    Active Word Color
                  </label>
                  <div className="flex items-center gap-2">
                    <DebouncedColorInput
                      aria-label="Active word color"
                      value={wordEmphasisColor}
                      onChange={handleWordEmphasisColorChange}
                      className="w-10 h-10 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      aria-label="Active word color value"
                      value={wordEmphasisColor}
                      onChange={(event) =>
                        handleWordEmphasisColorChange(event.target.value)
                      }
                      className="flex-1 rounded-md border border-border px-3 py-2 text-sm bg-background"
                      placeholder="#F2D21B"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Wind</p>
                  <p className="text-xs text-muted-foreground">
                    {mode === "word"
                      ? "Only available in phrase mode"
                      : "Words drift in as they are spoken."}
                  </p>
                </div>
                <Switch
                  checked={windEnabled}
                  onCheckedChange={(checked) =>
                    onChange({ ...style, windEnabled: checked })
                  }
                  disabled={mode === "word"}
                  aria-label="Toggle wind word reveal"
                />
              </div>
            </div>
          )}

          {/* Display on Spoken - hidden when dynamic is active */}
          {!style.dynamicEnabled && (
            <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Display on Spoken</p>
                <p className="text-xs text-muted-foreground">
                  {mode === "word"
                    ? "Only available in phrase mode"
                    : "Reveal words one by one as they are spoken."}
                </p>
              </div>
              <Switch
                checked={style.dynamicFollowWord}
                onCheckedChange={(checked) =>
                  onChange({ ...style, dynamicFollowWord: checked })
                }
                disabled={mode === "word"}
                aria-label="Toggle display on spoken"
              />
            </div>
          )}
        </div>
      </section>

      {/* Watermark toggle */}
      <div className={panelStyles.branding}>
        <div className="flex items-start gap-2.5">
          <Switch
            id={watermarkId}
            checked={style.showWatermark !== false}
            onCheckedChange={(checked) =>
              onChange({ ...style, showWatermark: checked })
            }
            className="mt-0.5 flex-shrink-0"
          />
          <div className="space-y-1 min-w-0">
            <label
              htmlFor={watermarkId}
              className="text-xs font-semibold leading-tight block cursor-pointer"
            >
              Show Watermark (fatahtech.com)
            </label>
            <p className="text-[11px] text-black/60 leading-snug">
              Draw fatahtech.com in the bottom corner of the preview and export
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
