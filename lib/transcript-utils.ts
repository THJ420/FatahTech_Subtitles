import {
  adjustTranscriptChunksForSilenceRemoval,
  createSilenceRemovalPlan,
} from "./silence-removal";
import type { SubtitleWordTiming } from "./subtitle-timing";
import { applyChunkFlagsToWords } from "./subtitle-timing";

// Word-timing helpers live in ./subtitle-timing alongside the timeline edit
// logic that rescales them; re-exported here so transcript consumers keep a
// single import site.
export {
  applyChunkFlagsToWords,
  buildWordTimings,
  resolveChunkWords,
  rescaleWordTimings,
  splitSubtitleWords,
  updateChunkText,
  type SubtitleWordTiming,
  type WordTimedChunk,
} from "./subtitle-timing";

/**
 * Format seconds into a readable time format (MM:SS)
 */
export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/** Merge preview cuts without changing subtitle timestamps used for editing. */
export function mergeTimestampRanges(
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const sorted = ranges
    .map(([start, end]): [number, number] => [start, end])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || previous[1] < range[0]) merged.push(range);
    else previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

/**
 * Format seconds into SRT timestamp format (HH:MM:SS,MS)
 */
export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

/**
 * Format seconds into WebVTT timestamp format (HH:MM:SS.MS)
 */
export function formatVttTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

export interface WordStyleOverride {
  wordPlacement?: import("./caption-placement").CaptionPlacement;
  phrasePlacement?: import("./caption-placement").CaptionPlacement;
  fontFamily?: string;
  fontSize?: number; // multiplier (e.g. 1.5 = 150% of global)
  color?: string;
  effect?: "knockout";
  emoji?: string; // replaces word text with this emoji
  emojiOverlay?: string; // renders this emoji above the word
  emojiScale?: number; // per-word emoji size multiplier (default 1.0)
}

/**
 * Word-level timing inside a transcript chunk. Aliased to the canonical
 * definition in ./subtitle-timing, which documents the Whisper /
 * transformers.js engine schema (`return_timestamps: "word"` produces one
 * `{ text, timestamp: [start, end] }` entry per spoken word, each with a
 * leading space that this app trims).
 */
export type SubtitleWord = SubtitleWordTiming;

export interface ProcessedWord extends SubtitleWord {
  /** Index of the source transcript chunk this word was derived from. */
  sourceIndex?: number;
}

export interface ProcessedChunk {
  text: string;
  timestamp: [number, number];
  sourceTimestamp?: [number, number];
  sourceIndex?: number;
  disabled?: boolean;
  subtitleHidden?: boolean;
  dynamicPosition?: "behind" | "front";
  styleOverride?: WordStyleOverride;
  words?: ProcessedWord[];
}

interface SourceTranscript {
  chunks: Array<{
    text: string;
    timestamp: [number, number];
    sourceTimestamp?: [number, number];
    sourceIndex?: number;
    disabled?: boolean;
    subtitleHidden?: boolean;
    dynamicPosition?: "behind" | "front";
    styleOverride?: WordStyleOverride;
    /** Explicit word timings (e.g. manual subtitles) - honored as-is. */
    words?: SubtitleWord[];
  }>;
}

/**
 * Process transcript chunks according to the mode (word/phrase).
 * When dynamicEnabled is true and mode is "phrase", auto-assigns
 * dynamicPosition (first word = "behind", rest = "front") to words
 * that don't already have a position set.
 */
// WeakMap cache: transcript object -> param string -> result
// Invalidates automatically when React replaces the transcript object on edits.
const _chunksCache = new WeakMap<
  SourceTranscript,
  Map<string, ProcessedChunk[]>
>();

export function binarySearchActiveChunk<
  T extends { timestamp: [number, number] },
>(chunks: T[], currentTime: number): T | undefined {
  let lo = 0,
    hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = chunks[mid].timestamp;
    if (currentTime < start) hi = mid - 1;
    else if (currentTime > end) lo = mid + 1;
    else return chunks[mid];
  }
  return undefined;
}

export function processTranscriptChunks(
  transcript: SourceTranscript,
  mode: "word" | "phrase" = "word",
  maxWordsPerLine?: number,
  dynamicEnabled?: boolean,
): ProcessedChunk[] {
  const cacheKey = `${mode}-${maxWordsPerLine ?? "d"}-${dynamicEnabled ?? 0}`;
  let transcriptMap = _chunksCache.get(transcript);
  if (!transcriptMap) {
    transcriptMap = new Map();
    _chunksCache.set(transcript, transcriptMap);
  }
  const cached = transcriptMap.get(cacheKey);
  if (cached) return cached;

  const result = _processTranscriptChunks(
    transcript,
    mode,
    maxWordsPerLine,
    dynamicEnabled,
  );
  transcriptMap.set(cacheKey, result);
  return result;
}

function _processTranscriptChunks(
  transcript: SourceTranscript,
  mode: "word" | "phrase" = "word",
  maxWordsPerLine?: number,
  dynamicEnabled?: boolean,
): ProcessedChunk[] {
  if (mode === "word") {
    return transcript.chunks.map((chunk, sourceIndex) => ({
      text: chunk.text,
      timestamp: chunk.timestamp,
      sourceTimestamp: chunk.sourceTimestamp,
      sourceIndex,
      disabled: chunk.disabled,
      subtitleHidden: chunk.subtitleHidden,
      dynamicPosition: chunk.dynamicPosition,
      styleOverride: chunk.styleOverride,
    }));
  }

  const processedChunks: ProcessedChunk[] = [];

  type PhraseAccumulator = {
    texts: string[];
    words: ProcessedWord[];
    start: number;
    end: number;
    sourceStart: number;
    sourceEnd: number;
    disabled: boolean;
    subtitleHidden: boolean;
  } | null;

  let currentGroup: PhraseAccumulator = null;

  const MAX_PHRASE_WORDS = maxWordsPerLine ?? 6;
  const MAX_PHRASE_DURATION = 3.0;
  const MAX_GAP = 0.5;

  const flushGroup = () => {
    if (!currentGroup) {
      return;
    }

    // When dynamic is enabled, auto-assign dynamicPosition if not already set
    if (dynamicEnabled) {
      currentGroup.words = currentGroup.words.map((word, i) => {
        if (word.dynamicPosition) return word; // preserve user toggle
        return {
          ...word,
          dynamicPosition: i === 0 ? ("behind" as const) : ("front" as const),
        };
      });
    }

    processedChunks.push({
      text: currentGroup.texts.join(" "),
      timestamp: [currentGroup.start, currentGroup.end],
      disabled: currentGroup.disabled,
      subtitleHidden: currentGroup.subtitleHidden,
      words: currentGroup.words,
    });

    currentGroup = null;
  };

  transcript.chunks.forEach((chunk, index) => {
    const [start, end] = chunk.timestamp;
    const [sourceStart, sourceEnd] = chunk.sourceTimestamp ?? chunk.timestamp;
    const trimmedText = chunk.text.trim();

    if (!trimmedText) {
      return;
    }

    const chunkDisabled = Boolean(chunk.disabled);
    const chunkHidden = Boolean(chunk.subtitleHidden);

    // Chunks that already carry explicit word timings (e.g. manual
    // subtitles) form their own phrase - never merge them into
    // neighboring transcription words.
    const explicitWordTimings = Array.isArray(chunk.words)
      ? chunk.words.filter((word) => word.text.trim().length > 0)
      : [];
    if (explicitWordTimings.length > 0) {
      flushGroup();
      const flaggedWords = applyChunkFlagsToWords({
        disabled: chunkDisabled,
        subtitleHidden: chunkHidden,
        words: explicitWordTimings,
      });
      const manualWords: ProcessedWord[] = flaggedWords.map((word) => ({
        text: word.text.trim(),
        timestamp: [word.timestamp[0], word.timestamp[1]] as [number, number],
        ...(word.sourceTimestamp
          ? {
              sourceTimestamp: [
                word.sourceTimestamp[0],
                word.sourceTimestamp[1],
              ] as [number, number],
            }
          : {}),
        sourceIndex: index,
        ...(word.disabled !== undefined ? { disabled: word.disabled } : {}),
        ...(word.subtitleHidden !== undefined
          ? { subtitleHidden: word.subtitleHidden }
          : {}),
        ...(word.dynamicPosition
          ? { dynamicPosition: word.dynamicPosition }
          : {}),
        ...(word.styleOverride ? { styleOverride: word.styleOverride } : {}),
      }));
      // Match group behavior so depth layers keep working for manual text.
      const positionedWords: ProcessedWord[] =
        dynamicEnabled && manualWords.every((word) => !word.dynamicPosition)
          ? manualWords.map((word, wordIndex) => ({
              ...word,
              dynamicPosition: wordIndex === 0 ? "behind" : "front",
            }))
          : manualWords;
      processedChunks.push({
        text:
          trimmedText || positionedWords.map((word) => word.text).join(" "),
        timestamp: [start, end],
        sourceIndex: index,
        disabled: chunkDisabled,
        subtitleHidden: chunkHidden,
        words: positionedWords,
      });
      return;
    }

    const wordData: ProcessedWord = {
      text: trimmedText,
      timestamp: [start, end],
      sourceTimestamp: chunk.sourceTimestamp,
      sourceIndex: index,
      disabled: chunk.disabled,
      subtitleHidden: chunk.subtitleHidden,
      dynamicPosition: chunk.dynamicPosition,
      styleOverride: chunk.styleOverride,
    };

    if (!currentGroup) {
      currentGroup = {
        texts: [trimmedText],
        words: [wordData],
        start,
        end,
        sourceStart,
        sourceEnd,
        disabled: chunkDisabled,
        subtitleHidden: chunkHidden,
      };
      return;
    }

    const timeSinceLastWord = sourceStart - currentGroup.sourceEnd;
    const wouldExceedWordLimit = currentGroup.texts.length >= MAX_PHRASE_WORDS;
    const wouldExceedDuration =
      sourceEnd - currentGroup.sourceStart > MAX_PHRASE_DURATION;
    const crossesDisabledBoundary = chunkDisabled !== currentGroup.disabled;
    const crossesHiddenBoundary = chunkHidden !== currentGroup.subtitleHidden;
    const endsWithPunctuation = /[.!?]$/.test(
      currentGroup.texts[currentGroup.texts.length - 1],
    );
    const endsWithCommaLike = /[,;:]$/.test(
      currentGroup.texts[currentGroup.texts.length - 1],
    );

    const shouldEndPhrase =
      crossesDisabledBoundary ||
      crossesHiddenBoundary ||
      timeSinceLastWord > MAX_GAP ||
      wouldExceedWordLimit ||
      wouldExceedDuration ||
      endsWithPunctuation ||
      (endsWithCommaLike && currentGroup.texts.length >= 3);

    if (shouldEndPhrase) {
      flushGroup();
      currentGroup = {
        texts: [trimmedText],
        words: [wordData],
        start,
        end,
        sourceStart,
        sourceEnd,
        disabled: chunkDisabled,
        subtitleHidden: chunkHidden,
      };
    } else {
      currentGroup.texts.push(trimmedText);
      currentGroup.words.push(wordData);
      currentGroup.end = end;
      currentGroup.sourceEnd = sourceEnd;
    }

    if (index === transcript.chunks.length - 1) {
      flushGroup();
    }
  });

  flushGroup();

  return processedChunks;
}

/**
 * Convert transcript data to SRT format
 */
function getSubtitleFileChunks(
  transcript: SourceTranscript,
  mode: "word" | "phrase",
): ProcessedChunk[] {
  const disabledRanges = transcript.chunks
    .filter((chunk) => chunk.disabled)
    .map((chunk) => ({
      startTime: (chunk.sourceTimestamp ?? chunk.timestamp)[0],
      endTime: (chunk.sourceTimestamp ?? chunk.timestamp)[1],
    }));
  const duration = transcript.chunks.reduce(
    (end, chunk) =>
      Math.max(end, chunk.timestamp[1], chunk.sourceTimestamp?.[1] ?? 0),
    0,
  );
  const chunks =
    disabledRanges.length > 0
      ? adjustTranscriptChunksForSilenceRemoval(
          transcript.chunks,
          createSilenceRemovalPlan(duration, disabledRanges),
        )
      : transcript.chunks;
  return processTranscriptChunks({ chunks }, mode).filter(
    (chunk) => !chunk.disabled && !chunk.subtitleHidden && chunk.text.trim(),
  );
}

export function transcriptToSrt(
  transcript: SourceTranscript,
  mode: "word" | "phrase" = "word",
): string {
  const processedChunks = getSubtitleFileChunks(transcript, mode);
  return processedChunks
    .map((chunk, index) => {
      const [start, end] = chunk.timestamp;
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(
        end,
      )}\n${chunk.text}\n`;
    })
    .join("\n");
}

/**
 * Convert transcript data to WebVTT format
 */
export function transcriptToVtt(
  transcript: SourceTranscript,
  mode: "word" | "phrase" = "word",
): string {
  const header = "WEBVTT\n\n";
  const processedChunks = getSubtitleFileChunks(transcript, mode);
  const cues = processedChunks
    .map((chunk, index) => {
      const [start, end] = chunk.timestamp;
      return `${index + 1}\n${formatVttTime(start)} --> ${formatVttTime(
        end,
      )}\n${chunk.text}\n`;
    })
    .join("\n");

  return header + cues;
}
