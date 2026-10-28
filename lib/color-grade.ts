/**
 * Color & Light grading model shared by the preview, the export renderer and
 * the preset UI.
 *
 * Everything in this module is pure and DOM-free. `gradeRgb` is the reference
 * implementation of the grade; the WebGL fragment shader in
 * `lib/color-grade-renderer.ts` is a line-by-line translation of it, so the
 * two must be changed together.
 *
 * Controls are expressed as -100..100 sliders (0 = neutral). The grade works in
 * linear light: sRGB is decoded once, the operations run in linear space, and
 * the result is encoded back. The neutral grade is an exact identity.
 */

export interface ColorGrade {
  /** Overall brightness in stops (-1.5..+1.5 EV at the extremes). */
  exposure: number;
  contrast: number;
  gamma: number;
  saturation: number;
  vibrance: number;
  /** Negative = cool, positive = warm. */
  temperature: number;
  /** Negative = green, positive = magenta. */
  tint: number;
  highlights: number;
  shadows: number;
}

export type ColorGradeKey = keyof ColorGrade;

export const COLOR_GRADE_LIMIT = 100;

export const NEUTRAL_COLOR_GRADE: ColorGrade = Object.freeze({
  exposure: 0,
  contrast: 0,
  gamma: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
});

const COLOR_GRADE_KEYS: readonly ColorGradeKey[] = [
  "exposure",
  "contrast",
  "gamma",
  "saturation",
  "vibrance",
  "temperature",
  "tint",
  "highlights",
  "shadows",
];

export interface ColorGradeControl {
  key: ColorGradeKey;
  label: string;
  group: string;
  hint: string;
  /** Gamma, highlights and shadows need the WebGL grade engine. */
  requiresWebGL?: boolean;
}

/**
 * Slider metadata in render order. The UI groups rows by `group`; the order of
 * first appearance defines the group order.
 */
export const COLOR_GRADE_CONTROLS: readonly ColorGradeControl[] = [
  {
    key: "exposure",
    label: "Exposure",
    group: "Exposure",
    hint: "Overall brightness, in stops.",
  },
  {
    key: "contrast",
    label: "Contrast",
    group: "Contrast & Gamma",
    hint: "Separates shadows and highlights around mid-grey.",
  },
  {
    key: "gamma",
    label: "Gamma",
    group: "Contrast & Gamma",
    hint: "Brightens or darkens the midtones.",
    requiresWebGL: true,
  },
  {
    key: "saturation",
    label: "Saturation",
    group: "Saturation & Vibrance",
    hint: "Uniform color intensity.",
  },
  {
    key: "vibrance",
    label: "Vibrance",
    group: "Saturation & Vibrance",
    hint: "Boosts muted colors more than already-saturated ones.",
  },
  {
    key: "temperature",
    label: "Temperature",
    group: "Temperature & Tint",
    hint: "Shifts the white balance between cool and warm.",
  },
  {
    key: "tint",
    label: "Tint",
    group: "Temperature & Tint",
    hint: "Shifts the white balance between green and magenta.",
  },
  {
    key: "highlights",
    label: "Highlights",
    group: "Highlights & Shadows",
    hint: "Lifts or recovers the brightest tones.",
    requiresWebGL: true,
  },
  {
    key: "shadows",
    label: "Shadows",
    group: "Highlights & Shadows",
    hint: "Lifts or deepens the darkest tones.",
    requiresWebGL: true,
  },
];

export interface ColorGradePreset {
  id: string;
  label: string;
  description: string;
  grade: ColorGrade;
}

export const COLOR_GRADE_PRESETS: readonly ColorGradePreset[] = [
  {
    id: "vibrant-pop",
    label: "Vibrant Product Pop",
    description: "Punchy color and clean contrast for products and demos.",
    grade: {
      exposure: 2,
      contrast: 10,
      gamma: 0,
      saturation: 14,
      vibrance: 24,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 4,
    },
  },
  {
    id: "teal-orange",
    label: "Cinematic Teal & Orange",
    description: "Deep shadows, crisp highlights, and a warm skin-tone bias.",
    grade: {
      exposure: 0,
      contrast: 22,
      gamma: -2,
      saturation: 6,
      vibrance: 4,
      temperature: 8,
      tint: -4,
      highlights: 4,
      shadows: -10,
    },
  },
  {
    id: "warm-cinematic",
    label: "Warm Cinematic",
    description: "Golden highlights and softened blacks for a filmic feel.",
    grade: {
      exposure: 1,
      contrast: 12,
      gamma: -3,
      saturation: 8,
      vibrance: 6,
      temperature: 16,
      tint: 0,
      highlights: -4,
      shadows: -6,
    },
  },
  {
    id: "clean-studio",
    label: "Clean Studio",
    description:
      "Neutral cast, open shadows, and gentle contrast for talking heads.",
    grade: {
      exposure: 2,
      contrast: 5,
      gamma: 2,
      saturation: 3,
      vibrance: 4,
      temperature: 0,
      tint: 0,
      highlights: -4,
      shadows: 10,
    },
  },
];

function clampLimit(value: number): number {
  return Math.min(COLOR_GRADE_LIMIT, Math.max(-COLOR_GRADE_LIMIT, value));
}

function sliderValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(clampLimit(value) * 10) / 10;
}

/**
 * Normalize anything that may have come from state, storage, or an old build
 * into a complete, in-range grade. Unknown fields are dropped.
 */
export function sanitizeColorGrade(value: unknown): ColorGrade {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<ColorGradeKey, unknown>>)
      : {};
  const grade = {} as ColorGrade;
  for (const key of COLOR_GRADE_KEYS) {
    grade[key] = sliderValue(source[key]);
  }
  return grade;
}

/** Copy that is safe to hand to React state. */
export function copyColorGrade(grade: unknown): ColorGrade {
  return sanitizeColorGrade(grade);
}

export function isNeutralColorGrade(value: unknown): boolean {
  const grade = sanitizeColorGrade(value);
  return COLOR_GRADE_KEYS.every((key) => grade[key] === 0);
}

export function colorGradesEqual(a: unknown, b: unknown): boolean {
  const left = sanitizeColorGrade(a);
  const right = sanitizeColorGrade(b);
  return COLOR_GRADE_KEYS.every((key) => left[key] === right[key]);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function srgbToLinear(channel: number): number {
  const value = clamp01(channel);
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(channel: number): number {
  const value = Math.max(0, channel);
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Canonical grade implementation (CPU mirror of the GLSL shader).
 *
 * Takes and returns 0–255 sRGB channels. Neutral input round-trips within
 * floating-point error.
 */
export function gradeRgb(
  grade: ColorGrade,
  rgb: readonly [number, number, number],
): [number, number, number] {
  const safe = sanitizeColorGrade(grade);
  let r = srgbToLinear(rgb[0] / 255);
  let g = srgbToLinear(rgb[1] / 255);
  let b = srgbToLinear(rgb[2] / 255);

  // 1. White balance. Gains are normalized so a neutral grey keeps its luma.
  const temperature = safe.temperature / 100;
  const tint = safe.tint / 100;
  let rGain = 1 + 0.2 * temperature;
  let bGain = 1 - 0.2 * temperature;
  const gGain = 1 - 0.2 * tint;
  rGain *= 1 + 0.1 * tint;
  bGain *= 1 + 0.1 * tint;
  const gainLuma = Math.max(1e-6, luminance(rGain, gGain, bGain));
  r = (r * rGain) / gainLuma;
  g = (g * gGain) / gainLuma;
  b = (b * bGain) / gainLuma;

  // 2. Exposure.
  const exposureGain = Math.pow(2, 1.5 * (safe.exposure / 100));
  r *= exposureGain;
  g *= exposureGain;
  b *= exposureGain;

  // 3. Shadow and highlight range gains, masked by luma.
  let luma = luminance(r, g, b);
  const shadowGain =
    1 + 0.6 * (safe.shadows / 100) * (1 - smoothstep(0, 0.2, luma));
  const highlightGain =
    1 + 0.6 * (safe.highlights / 100) * smoothstep(0.2, 0.9, luma);
  r *= shadowGain * highlightGain;
  g *= shadowGain * highlightGain;
  b *= shadowGain * highlightGain;

  // 4. Gamma.
  const gammaExponent = Math.pow(2, -(safe.gamma / 100));
  r = Math.pow(Math.max(0, r), gammaExponent);
  g = Math.pow(Math.max(0, g), gammaExponent);
  b = Math.pow(Math.max(0, b), gammaExponent);

  // 5. Contrast around 18% linear grey.
  const contrastGain = 1 + 0.75 * (safe.contrast / 100);
  r = 0.18 + (r - 0.18) * contrastGain;
  g = 0.18 + (g - 0.18) * contrastGain;
  b = 0.18 + (b - 0.18) * contrastGain;

  // 6. Saturation.
  luma = luminance(r, g, b);
  const saturationGain = 1 + safe.saturation / 100;
  r = luma + (r - luma) * saturationGain;
  g = luma + (g - luma) * saturationGain;
  b = luma + (b - luma) * saturationGain;

  // 7. Vibrance: weight the boost toward low-chroma pixels.
  luma = luminance(r, g, b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max > 1e-6 ? (max - min) / max : 0;
  const vibranceGain =
    1 + 0.8 * (safe.vibrance / 100) * (1 - smoothstep(0, 0.6, chroma));
  r = luma + (r - luma) * vibranceGain;
  g = luma + (g - luma) * vibranceGain;
  b = luma + (b - luma) * vibranceGain;

  return [
    Math.round(linearToSrgb(r) * 255),
    Math.round(linearToSrgb(g) * 255),
    Math.round(linearToSrgb(b) * 255),
  ];
}

/**
 * Approximate CSS filter for browsers without WebGL2.
 *
 * Gamma, highlights, shadows and true vibrance have no CSS equivalent, so the
 * UI disables those controls when this string is in use. Preview and export
 * share the same capability check, so both fall back together.
 */
export function colorGradeFilter(grade: ColorGrade): string {
  const safe = sanitizeColorGrade(grade);
  if (isNeutralColorGrade(safe)) return "none";

  const parts: string[] = [];
  const exposure = safe.exposure / 100;
  const contrast = safe.contrast / 100;
  const saturation = safe.saturation / 100;
  const vibrance = safe.vibrance / 100;
  const temperature = safe.temperature / 100;
  const tint = safe.tint / 100;

  if (exposure !== 0) {
    parts.push(`brightness(${Math.pow(2, 0.5 * exposure).toFixed(3)})`);
  }
  if (contrast !== 0) {
    parts.push(`contrast(${(1 + 0.4 * contrast).toFixed(3)})`);
  }
  const saturate = Math.max(0, 1 + saturation + 0.5 * vibrance);
  if (saturate !== 1) {
    parts.push(`saturate(${saturate.toFixed(3)})`);
  }
  if (temperature > 0) {
    parts.push(`sepia(${(0.3 * temperature).toFixed(3)})`);
  }
  const hueShift = 10 * -temperature - 12 * tint;
  if (hueShift !== 0) {
    parts.push(`hue-rotate(${hueShift.toFixed(1)}deg)`);
  }
  return parts.length ? parts.join(" ") : "none";
}

/** Apply a grade to a `#rrggbb` color, for preset swatches. */
export function gradeHexColor(grade: ColorGrade, hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const result = gradeRgb(grade, [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
  return `#${result
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}
