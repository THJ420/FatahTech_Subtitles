/**
 * User-selectable processing tiers for background removal.
 *
 * The tier controls three things that used to be decided silently: how densely
 * the matte is sampled, how large the stored mask is, and how much refinement
 * the alpha chain applies. Storage is still bounded — `maskBudgetBytes` is the
 * ceiling consumed by `planMaskStoreForQuality`, so "High Quality" on a long
 * clip degrades the plan instead of exhausting device memory.
 */

import type { AlphaChainConfig } from "@/lib/bg-alpha";

export type BgQualityTier = "fast" | "balanced" | "quality";

export interface BgQualityPreset {
  id: BgQualityTier;
  label: string;
  summary: string;
  footnote?: string;
  recommended?: boolean;
  /** Short side of the stored matte, before budget clamping. */
  maskShortSide: number;
  /** Samples per second taken from the source. */
  sampleFps: number;
  /** Longest edge of the frame handed to the model. */
  processMaxDim: number;
  /** Ceiling for this tier's mask storage. */
  maskBudgetBytes: number;
  /** Overrides applied on top of `DEFAULT_ALPHA_CONFIG` in the worker. */
  alpha: Partial<AlphaChainConfig>;
}

const MIB = 1024 * 1024;

export const BG_QUALITY_PRESETS: readonly BgQualityPreset[] = [
  {
    id: "fast",
    label: "Fast (Speed Priority)",
    summary: "Downsamples masks to 384px @ 6fps. Minimizes render time.",
    maskShortSide: 384,
    sampleFps: 6,
    processMaxDim: 512,
    maskBudgetBytes: 128 * MIB,
    alpha: {
      openRadius: 0,
      closeRadius: 0,
      featherRadius: 1,
      temporalWeight: 0.15,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    recommended: true,
    summary:
      "Downsamples masks to 512px @ 8fps with standard smoothstep feathering.",
    maskShortSide: 512,
    sampleFps: 8,
    processMaxDim: 640,
    maskBudgetBytes: 256 * MIB,
    // The defaults already are the smoothstep + light-feather chain.
    alpha: {},
  },
  {
    id: "quality",
    label: "High Quality (Accuracy Priority)",
    summary:
      "Uses native 1024px resolution @ 12fps with morphological refinement.",
    footnote: "May take longer on non-WebGPU hardware.",
    maskShortSide: 1024,
    sampleFps: 12,
    processMaxDim: 1024,
    maskBudgetBytes: 512 * MIB,
    alpha: {
      openRadius: 2,
      closeRadius: 3,
      featherRadius: 2,
      temporalWeight: 0.35,
    },
  },
];

export const DEFAULT_QUALITY_TIER: BgQualityTier = "balanced";

export function isBgQualityTier(value: unknown): value is BgQualityTier {
  return value === "fast" || value === "balanced" || value === "quality";
}

export function getBgQualityPreset(tier: BgQualityTier): BgQualityPreset {
  return (
    BG_QUALITY_PRESETS.find((preset) => preset.id === tier) ??
    BG_QUALITY_PRESETS[1]
  );
}
