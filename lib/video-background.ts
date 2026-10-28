/**
 * Background modes for the "Remove background" effect, plus the one mapping
 * from style settings to a compositor `BackgroundFill`.
 *
 * This lives in `lib/` rather than beside `SubtitleStyle` (which is declared in
 * a `.tsx` module) so both the preview and the export path — and anything
 * running off the main thread — can use the same union and rules.
 *
 * `transparent` is a preview-only mode: the encoders this app uses (MP4/WebM)
 * cannot carry an alpha channel. Preview shows a checkerboard; export
 * substitutes `solidBackgroundColor` so a transparent choice never silently
 * becomes a black frame.
 */

import type { BackgroundFill } from "@/lib/bg-composite";

export const BACKGROUND_TYPES = [
  "solid",
  "blur",
  "transparent",
  "image",
] as const;

export type BackgroundType = (typeof BACKGROUND_TYPES)[number];

export function isBackgroundType(value: unknown): value is BackgroundType {
  return (
    typeof value === "string" &&
    (BACKGROUND_TYPES as readonly string[]).includes(value)
  );
}

/** Slider value 50 maps to the 20px radius the app used before the slider. */
export const DEFAULT_BLUR_INTENSITY = 50;

export const MIN_BLUR_PX = 2;
export const MAX_BLUR_PX = 38;

/** Map a 0–100 intensity to a `ctx.filter` blur radius in pixels. */
export function blurRadiusFor(intensity: number): number {
  const value = Number.isFinite(intensity) ? intensity : DEFAULT_BLUR_INTENSITY;
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(
    MIN_BLUR_PX + (clamped / 100) * (MAX_BLUR_PX - MIN_BLUR_PX),
  );
}

/** The style fields the background compositor cares about. */
export interface BackgroundSettings {
  backgroundType: BackgroundType;
  solidBackgroundColor: string;
  blurIntensity?: number;
  customBackgroundImage?: string;
}

export interface BackgroundImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface ResolvedBackground {
  fill: BackgroundFill;
  /** Transparency was requested but the target cannot store alpha. */
  transparentSubstituted: boolean;
  /** An image was requested but none is loaded (yet, or it failed). */
  imageMissing: boolean;
}

const FALLBACK_COLOR = "#000000";

/**
 * Resolve a style into a compositor fill.
 *
 * `allowTransparent` is false on the export path, where a checkerboard is not
 * an option. Unknown runtime values fall back to a solid colour rather than
 * throwing, because style state can outlive a code change.
 */
export function resolveBackgroundFill(
  settings: BackgroundSettings,
  options: {
    image?: BackgroundImageSource | null;
    allowTransparent?: boolean;
  } = {},
): ResolvedBackground {
  const type = isBackgroundType(settings.backgroundType)
    ? settings.backgroundType
    : "solid";
  const color = settings.solidBackgroundColor || FALLBACK_COLOR;
  const solid = (): ResolvedBackground => ({
    fill: { kind: "solid", color },
    transparentSubstituted: false,
    imageMissing: false,
  });

  switch (type) {
    case "blur": {
      const radius = blurRadiusFor(
        settings.blurIntensity ?? DEFAULT_BLUR_INTENSITY,
      );
      return {
        fill: { kind: "blur", radius },
        transparentSubstituted: false,
        imageMissing: false,
      };
    }

    case "transparent":
      if (options.allowTransparent !== false) {
        return {
          fill: { kind: "transparent" },
          transparentSubstituted: false,
          imageMissing: false,
        };
      }
      return { ...solid(), transparentSubstituted: true };

    case "image": {
      const image = options.image;
      if (image) {
        return {
          fill: {
            kind: "image",
            source: image.source,
            width: image.width,
            height: image.height,
          },
          transparentSubstituted: false,
          imageMissing: false,
        };
      }
      return { ...solid(), imageMissing: true };
    }

    case "solid":
    default:
      return solid();
  }
}

/**
 * Decode a data URL (or blob URL) into something `drawImage` accepts.
 *
 * Resolves `null` on failure so callers can fall back to a solid colour
 * instead of failing the preview or the export.
 */
export function loadBackgroundImage(
  source: string,
): Promise<BackgroundImageSource | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } else {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}
