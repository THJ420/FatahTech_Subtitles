export type Timestamp = [number, number];
export interface TimedSubtitle {
  timestamp: Timestamp;
  /** Original media position. Timing edits never move video cuts. */
  sourceTimestamp?: Timestamp;
  /** Optional word timings for chunks that store their own (manual text). */
  words?: SubtitleWordTiming[];
}
export type TimingAction = "start" | "end" | "move";
export type TimingSelection = { first: number; last: number };
export const MIN_SUBTITLE_DURATION = 0.02;

/**
 * Word-level timings inside subtitle chunks.
 *
 * Mirrors the Whisper / transformers.js engine output (`return_timestamps:
 * "word"` produces one `{ text, timestamp: [start, end] }` entry per spoken
 * word). The engine emits a leading space before each word (" hello"); this
 * app trims input once so every stored word carries clean text.
 */
export interface SubtitleWordTiming {
  text: string;
  timestamp: [number, number];
  sourceTimestamp?: [number, number];
  disabled?: boolean;
  subtitleHidden?: boolean;
  dynamicPosition?: "behind" | "front";
  /** Per-word style override; kept structurally compatible with the
   * renderer's `WordStyleOverride` so both directions stay assignable. */
  styleOverride?: SubtitleWordStyleOverride;
}

/** Mirrors the renderer's WordStyleOverride without importing it (avoids a cycle). */
export interface SubtitleWordStyleOverride {
  wordPlacement?: { customPosition?: { x: number; y: number }; fontSize?: number };
  phrasePlacement?: {
    customPosition?: { x: number; y: number };
    fontSize?: number;
  };
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  effect?: "knockout";
  emoji?: string;
  emojiOverlay?: string;
  emojiScale?: number;
}

/** A chunk (or processed word) that stores explicit word timings. */
export interface WordTimedChunk {
  words?: SubtitleWordTiming[];
}

/**
 * Span guard: never trust callers with NaN or inverted timestamps when
 * interpolating word windows.
 */
function clampSpan(timestamp: [number, number]): [number, number] {
  const [start, end] = timestamp;
  if (!Number.isFinite(start)) return [0, 0];
  if (!Number.isFinite(end) || end < start) return [start, start];
  return [start, end];
}

/**
 * Split subtitle text into trimmed words. Mirrors the engine convention
 * plus its leading-space trimming: one clean token per word, no empties.
 */
export function splitSubtitleWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * Evenly distribute a chunk's time span across its words so every word gets
 * an accurate `[start, end]` window. Word boundaries are adjacent (no gaps,
 * no overlaps) and the last word ends exactly at the chunk end so scrubbing
 * stays glued to the timeline.
 */
export function buildWordTimings<T extends SubtitleWordTiming>(
  text: string,
  timestamp: [number, number],
  template?: {
    dynamicEnabled?: boolean;
    inherit?: readonly Partial<T>[];
  },
): T[] {
  const [start, end] = clampSpan(timestamp);
  const tokens = splitSubtitleWords(text);
  const span = end - start;
  return tokens.map((word, index) => {
    // Linear interpolation across the chunk span, matching per-word scaling
    // so word boundaries stay adjacent with no gaps or overlaps.
    const wordStart =
      start + (tokens.length > 0 ? (span * index) / tokens.length : 0);
    const wordEnd =
      index === tokens.length - 1
        ? end
        : start + (span * (index + 1)) / tokens.length;
    const inherited = template?.inherit?.[index] ?? {};
    return {
      ...inherited,
      text: word,
      timestamp: [wordStart, wordEnd] as [number, number],
      // Match phrase-grouping convention so depth layers keep working.
      ...(template?.dynamicEnabled &&
      (inherited as Partial<T>).dynamicPosition === undefined
        ? {
            dynamicPosition: (index === 0
              ? "behind"
              : "front") as T["dynamicPosition"],
          }
        : {}),
    } as T;
  });
}

/**
 * Return the explicit words of a chunk when present, otherwise synthesize
 * them on the fly so no chunk ever renders as unstyled plain text.
 */
export function resolveChunkWords<T extends SubtitleWordTiming>(
  chunk: { text: string; timestamp: [number, number] } & WordTimedChunk,
  dynamicEnabled = false,
): T[] {
  if (Array.isArray(chunk.words) && chunk.words.length > 0) {
    return chunk.words.map((word) => ({
      text: word.text,
      timestamp: [word.timestamp[0], word.timestamp[1]] as [number, number],
      ...(word.sourceTimestamp
        ? {
            sourceTimestamp: [
              word.sourceTimestamp[0],
              word.sourceTimestamp[1],
            ] as [number, number],
          }
        : {}),
      ...(word.disabled !== undefined ? { disabled: word.disabled } : {}),
      ...(word.subtitleHidden !== undefined
        ? { subtitleHidden: word.subtitleHidden }
        : {}),
      ...(word.dynamicPosition
        ? { dynamicPosition: word.dynamicPosition }
        : {}),
      ...(word.styleOverride ? { styleOverride: word.styleOverride } : {}),
    })) as T[];
  }
  return buildWordTimings<T>(chunk.text, chunk.timestamp, { dynamicEnabled });
}

/**
 * Copy a chunk's flags onto its explicit words so word-aware filters keep
 * working after edits.
 */
export function applyChunkFlagsToWords<T extends SubtitleWordTiming>(chunk: {
  disabled?: boolean;
  subtitleHidden?: boolean;
  words?: T[];
}): T[] {
  if (!Array.isArray(chunk.words)) return [];
  return chunk.words.map((word) => ({
    ...word,
    disabled: word.disabled ?? chunk.disabled,
    subtitleHidden: word.subtitleHidden ?? chunk.subtitleHidden,
  }));
}

/**
 * Proportionally remap stored word windows from one time span to another.
 * Keeps explicit word timings glued to the chunk when its timestamps are
 * moved on the timeline, restored from undo, or shifted by cuts.
 */
export function rescaleWordTimings<T extends { timestamp: [number, number] }>(
  words: readonly T[],
  from: readonly [number, number],
  to: readonly [number, number],
): T[] {
  const [fromStart, fromEnd] = from;
  const [toStart, toEnd] = to;
  const fromSpan = fromEnd - fromStart;
  const toSpan = Math.max(0, toEnd - toStart);
  if (!(fromSpan > 0) || toSpan === 0) {
    return words.map((word, index) =>
      index === words.length - 1
        ? { ...word, timestamp: [toStart, toEnd] as [number, number] }
        : { ...word, timestamp: [toStart, toStart] as [number, number] },
    );
  }
  return words.map((word) => {
    const startOffset = Math.min(
      Math.max(word.timestamp[0] - fromStart, 0),
      fromSpan,
    );
    const endOffset = Math.min(
      Math.max(word.timestamp[1] - fromStart, 0),
      fromSpan,
    );
    return {
      ...word,
      timestamp: [
        toStart + (startOffset / fromSpan) * toSpan,
        toStart + (endOffset / fromSpan) * toSpan,
      ] as [number, number],
    };
  });
}

/**
 * Replace a chunk's text while keeping word timings in sync. Chunks that
 * already carry explicit words get them rebuilt across their span (word
 * styles and dynamic positions are preserved by index); all others are
 * returned with the new text only.
 */
export function updateChunkText<
  T extends {
    text: string;
    timestamp: [number, number];
  } & WordTimedChunk,
>(chunk: T, text: string): T {
  const trimmed = text.trim();
  if (!Array.isArray(chunk.words) || chunk.words.length === 0) {
    return { ...chunk, text: trimmed };
  }
  const previousWords = chunk.words;
  const timings = buildWordTimings<SubtitleWordTiming>(
    trimmed,
    chunk.timestamp,
    { inherit: previousWords },
  );
  return {
    ...chunk,
    text:
      timings.length > 0 ? timings.map((word) => word.text).join(" ") : trimmed,
    words: timings,
  };
}

export function timingBounds(
  chunks: readonly TimedSubtitle[],
  { first, last }: TimingSelection,
  duration: number,
) {
  return {
    min: Math.max(0, chunks[first - 1]?.timestamp[1] ?? 0),
    max: Math.min(duration, chunks[last + 1]?.timestamp[0] ?? duration),
  };
}

/** Edge edits affect one word; a move preserves every word's duration and gaps. */
export function editSubtitleTiming<T extends TimedSubtitle>(
  chunks: readonly T[],
  selection: TimingSelection,
  action: TimingAction,
  value: number,
  duration: number,
): T[] {
  const { first, last } = selection;
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    first < 0 ||
    last < first ||
    !chunks[first] ||
    !chunks[last]
  )
    return [...chunks];
  const { min, max } = timingBounds(chunks, selection, duration);
  const start = chunks[first].timestamp[0];
  const end = chunks[last].timestamp[1];
  let low: number;
  let high: number;
  if (action === "start") {
    low = min;
    high = Math.min(max, chunks[first].timestamp[1] - MIN_SUBTITLE_DURATION);
  } else if (action === "end") {
    low = Math.max(min, chunks[last].timestamp[0] + MIN_SUBTITLE_DURATION);
    high = max;
  } else {
    low = min - start;
    high = max - end;
  }
  if (low > high) return [...chunks];
  const accepted = Math.max(low, Math.min(high, value));
  return chunks.map((chunk, index) => {
    if (index < first || index > last) return chunk;
    const timestamp: Timestamp = [...chunk.timestamp];
    if (action === "start" && index === first) timestamp[0] = accepted;
    if (action === "end" && index === last) timestamp[1] = accepted;
    if (action === "move") {
      timestamp[0] += accepted;
      timestamp[1] += accepted;
    }
    if (timestamp.every((time, edge) => time === chunk.timestamp[edge]))
      return chunk;
    return {
      ...chunk,
      sourceTimestamp: chunk.sourceTimestamp ?? chunk.timestamp,
      timestamp,
      // Keep explicit word timings glued to the moved chunk.
      ...(Array.isArray(chunk.words) && chunk.words.length > 0
        ? {
            words: rescaleWordTimings(
              chunk.words,
              chunk.timestamp,
              timestamp,
            ),
          }
        : {}),
    };
  });
}

/** Apply only timing fields, so Undo does not undo text, styling, or cut edits. */
export function restoreSubtitleTiming<T extends TimedSubtitle>(
  chunks: readonly T[],
  snapshot: readonly TimedSubtitle[],
): T[] {
  return chunks.map((chunk, index) => {
    const saved = snapshot[index];
    if (!saved || (!timingChanged([chunk], [saved]) && !saved.sourceTimestamp))
      return chunk;
    const timestamp = [...saved.timestamp] as Timestamp;
    return {
      ...chunk,
      sourceTimestamp:
        chunk.sourceTimestamp ?? saved.sourceTimestamp ?? chunk.timestamp,
      timestamp,
      // Undo restores the word windows that belong to the restored span.
      ...(Array.isArray(chunk.words) && chunk.words.length > 0
        ? {
            words: rescaleWordTimings(
              chunk.words,
              chunk.timestamp,
              timestamp,
            ),
          }
        : {}),
    };
  });
}

export function resetSubtitleTiming<T extends TimedSubtitle>(
  chunks: readonly T[],
  selection: TimingSelection,
  duration: number,
): T[] | null {
  const next = chunks.map((chunk, index) =>
    index >= selection.first && index <= selection.last && chunk.sourceTimestamp
      ? { ...chunk, timestamp: [...chunk.sourceTimestamp] as Timestamp }
      : chunk,
  );
  for (let i = selection.first; i <= selection.last; i++) {
    const current = next[i];
    if (
      !current ||
      current.timestamp[0] < 0 ||
      current.timestamp[1] > duration ||
      current.timestamp[1] <= current.timestamp[0] ||
      (i > 0 && current.timestamp[0] < next[i - 1].timestamp[1]) ||
      (i + 1 < next.length && current.timestamp[1] > next[i + 1].timestamp[0])
    )
      return null;
  }
  return next;
}

export function timingChanged(
  a: readonly TimedSubtitle[],
  b: readonly TimedSubtitle[],
) {
  return a.some(
    (chunk, i) =>
      !b[i] ||
      chunk.timestamp.some(
        (time, edge) => Math.abs(time - b[i].timestamp[edge]) > 1e-8,
      ),
  );
}

export function parseSubtitleTime(value: string): number | null {
  if (!/^\d+(?::[0-5]\d){0,2}(?:\.\d{1,3})?$/.test(value.trim())) return null;
  const seconds = value
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? seconds : null;
}
