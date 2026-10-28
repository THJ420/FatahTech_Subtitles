/**
 * Lightweight footage analysis used to tune the generated color presets.
 *
 * Everything here is pure so the sampling hook can stay a thin mediabunny
 * wrapper and the synthesis rules can be unit-tested without a browser.
 */

import {
  COLOR_GRADE_PRESETS,
  sanitizeColorGrade,
  type ColorGrade,
  type ColorGradePreset,
} from "@/lib/color-grade";

export type ColorAnalysisStatus = "idle" | "sampling" | "ready" | "unavailable";

export const FOOTAGE_SAMPLE_COUNT = 5;
export const FOOTAGE_SAMPLE_WIDTH = 192;
export const FOOTAGE_SAMPLE_HEIGHT = 108;

export interface FootageSample {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface FootageStats {
  /** Mean Rec.709 luma, 0–1. */
  lumaMean: number;
  lumaP5: number;
  lumaP95: number;
  /** p95 − p5, 0–1. */
  contrast: number;
  /** Mean HSV saturation, 0–1. */
  saturationMean: number;
  /** Mean (r − b), −1–1. Positive is warm. */
  warmth: number;
  /** Mean (g − (r + b) / 2), −1–1. Positive is green. */
  tint: number;
}

const HISTOGRAM_BINS = 64;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Evenly spaced samples, offset away from the very first/last frame. */
export function footageSampleTimestamps(
  duration: number,
  count = FOOTAGE_SAMPLE_COUNT,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return [];
  const total = Math.max(1, Math.floor(count));
  return Array.from(
    { length: total },
    (_, index) => (duration * (index + 0.5)) / total,
  );
}

function percentileFromHistogram(
  histogram: Uint32Array,
  total: number,
  fraction: number,
): number {
  if (total <= 0) return 0;
  const target = Math.max(1, total * fraction);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) return (index + 0.5) / histogram.length;
  }
  return 1;
}

/**
 * Summarize sampled frames. Returns null when no opaque pixels were found, so
 * callers can fall back to the standard looks.
 */
export function analyzeFootageSamples(
  samples: readonly FootageSample[],
): FootageStats | null {
  const histogram = new Uint32Array(HISTOGRAM_BINS);
  let pixels = 0;
  let lumaTotal = 0;
  let saturationTotal = 0;
  let warmthTotal = 0;
  let tintTotal = 0;

  for (const sample of samples) {
    const data = sample.data;
    const pixelsInSample = Math.floor(data.length / 4);
    for (let index = 0; index < pixelsInSample; index += 1) {
      const offset = index * 4;
      if (data[offset + 3] < 16) continue;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max > 1e-6 ? (max - min) / max : 0;

      pixels += 1;
      lumaTotal += luma;
      saturationTotal += saturation;
      warmthTotal += r - b;
      tintTotal += g - (r + b) / 2;

      const bin = Math.min(
        HISTOGRAM_BINS - 1,
        Math.max(0, Math.floor(luma * HISTOGRAM_BINS)),
      );
      histogram[bin] += 1;
    }
  }

  if (pixels === 0) return null;

  const lumaMean = lumaTotal / pixels;
  const lumaP5 = percentileFromHistogram(histogram, pixels, 0.05);
  const lumaP95 = percentileFromHistogram(histogram, pixels, 0.95);
  return {
    lumaMean,
    lumaP5,
    lumaP95,
    contrast: Math.max(0, lumaP95 - lumaP5),
    saturationMean: saturationTotal / pixels,
    warmth: warmthTotal / pixels,
    tint: tintTotal / pixels,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tunePreset(
  base: ColorGradePreset,
  stats: FootageStats,
): ColorGradePreset {
  const grade: ColorGrade = { ...base.grade };
  const exposureNeed = 0.52 - stats.lumaMean;
  const contrastNeed = 0.5 - stats.contrast;
  const saturationNeed = 0.42 - stats.saturationMean;

  switch (base.id) {
    case "vibrant-pop":
      grade.exposure += clamp(exposureNeed * 40, -12, 16);
      grade.saturation += clamp(saturationNeed * 30, -6, 12);
      grade.vibrance += clamp(saturationNeed * 60, 0, 24);
      grade.contrast += clamp(contrastNeed * 20, -6, 10);
      if (stats.lumaMean < 0.35) grade.shadows += 6;
      break;

    case "teal-orange":
      grade.contrast += clamp(contrastNeed * 30, 0, 14);
      if (stats.warmth < 0) grade.temperature += 4;
      if (stats.saturationMean < 0.3) grade.saturation += 4;
      if (stats.lumaMean > 0.6) grade.shadows -= 4;
      break;

    case "warm-cinematic":
      grade.temperature += clamp(-stats.warmth * 40, -6, 10);
      grade.exposure += clamp(exposureNeed * 28, -10, 12);
      if (stats.saturationMean < 0.35) grade.saturation += 6;
      break;

    case "clean-studio":
      grade.temperature += clamp(-stats.warmth * 80, -14, 14);
      grade.tint += clamp(-stats.tint * 80, -12, 12);
      grade.exposure += clamp((0.58 - stats.lumaMean) * 110, -20, 30);
      grade.contrast += clamp(contrastNeed * 15, 0, 8);
      if (stats.lumaMean < 0.4) grade.shadows += 6;
      break;

    default:
      break;
  }

  return { ...base, grade: sanitizeColorGrade(grade) };
}

/**
 * Turn measured stats into the four named looks. Deterministic: the same stats
 * always produce the same grades. `null` returns the built-in presets.
 */
export function synthesizeColorGradePresets(
  stats: FootageStats | null,
): ColorGradePreset[] {
  if (!stats) {
    return COLOR_GRADE_PRESETS.map((preset) => ({
      ...preset,
      grade: sanitizeColorGrade(preset.grade),
    }));
  }
  return COLOR_GRADE_PRESETS.map((preset) => tunePreset(preset, stats));
}
