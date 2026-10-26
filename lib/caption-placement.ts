/** Caption centers are fractions of the output frame, independent of preview size. */
export interface CaptionPosition {
  x: number;
  y: number;
}

export function clampCaptionPosition(
  position: CaptionPosition,
  widthFraction: number,
  heightFraction: number,
): CaptionPosition {
  const halfWidth = Math.min(0.5, Math.max(0, widthFraction / 2));
  const halfHeight = Math.min(0.5, Math.max(0, heightFraction / 2));
  return {
    x: Math.max(halfWidth, Math.min(1 - halfWidth, position.x)),
    y: Math.max(halfHeight, Math.min(1 - halfHeight, position.y)),
  };
}

export function resizeCaptionFont(
  fontSize: number,
  initialVector: { x: number; y: number },
  currentVector: { x: number; y: number },
): number {
  const lengthSquared = initialVector.x ** 2 + initialVector.y ** 2;
  if (lengthSquared === 0) return fontSize;
  // Project onto the original diagonal: crossing the center shrinks rather
  // than flipping the text, and moving perpendicular to it doesn't resize.
  const scale =
    (initialVector.x * currentVector.x + initialVector.y * currentVector.y) /
    lengthSquared;
  return Math.max(8, Math.min(160, Math.round(fontSize * scale)));
}

export interface CaptionPlacement {
  customPosition?: CaptionPosition;
  fontSize?: number;
}

type CaptionSource = {
  timestamp: [number, number];
  styleOverride?: import("./transcript-utils").WordStyleOverride;
};

export function getCaptionPlacement(
  chunk:
    | {
        styleOverride?: CaptionSource["styleOverride"];
        words?: CaptionSource[];
      }
    | undefined,
  mode: "word" | "phrase",
): CaptionPlacement | undefined {
  return mode === "phrase"
    ? chunk?.words?.[0]?.styleOverride?.phrasePlacement
    : chunk?.styleOverride?.wordPlacement;
}

export function resolveCaptionStyle(
  style: import("../components/subtitle-styling").SubtitleStyle,
  chunk: Parameters<typeof getCaptionPlacement>[0],
  mode: "word" | "phrase",
): import("../components/subtitle-styling").SubtitleStyle {
  const placement = getCaptionPlacement(chunk, mode);
  return placement ? { ...style, ...placement, verticalOffset: 0 } : style;
}

export function updateCaptionPlacement<T extends CaptionSource>(
  chunks: T[],
  timestamp: [number, number],
  mode: "word" | "phrase",
  change: CaptionPlacement,
): T[] {
  const key = mode === "phrase" ? "phrasePlacement" : "wordPlacement";
  return chunks.map((chunk) => {
    const matches =
      mode === "phrase"
        ? chunk.timestamp[0] >= timestamp[0] &&
          chunk.timestamp[1] <= timestamp[1]
        : chunk.timestamp[0] === timestamp[0] &&
          chunk.timestamp[1] === timestamp[1];
    if (!matches) return chunk;
    return {
      ...chunk,
      styleOverride: {
        ...chunk.styleOverride,
        [key]: { ...chunk.styleOverride?.[key], ...change },
      },
    };
  });
}

/** Explicit global placement replaces local placement, preserving word styling. */
export function clearCaptionPlacements<T extends CaptionSource>(
  chunks: T[],
): T[] {
  return chunks.map((chunk) => {
    if (
      !chunk.styleOverride?.wordPlacement &&
      !chunk.styleOverride?.phrasePlacement
    )
      return chunk;
    const override = { ...chunk.styleOverride };
    delete override.wordPlacement;
    delete override.phrasePlacement;
    return {
      ...chunk,
      styleOverride: Object.keys(override).length ? override : undefined,
    };
  });
}
