import type { SetStateAction } from "react";
import type { TranscriptionResult } from "../hooks/useTranscription";
import {
  rescaleWordTimings,
  type SubtitleWord,
} from "../lib/transcript-utils";

type Chunk = TranscriptionResult["chunks"][number];

export interface TranscriptionState {
  result: TranscriptionResult | null;
  /** Last unedited worker snapshot, used to distinguish edits from ASR revisions. */
  source: TranscriptionResult | null;
}

export type TranscriptionAction =
  | { type: "edit"; value: SetStateAction<TranscriptionResult | null> }
  | { type: "worker"; result: TranscriptionResult };

export const initialTranscriptionState: TranscriptionState = {
  result: null,
  source: null,
};

const key = (chunk: Chunk) => `${chunk.timestamp[0]}:${chunk.timestamp[1]}`;
const normalize = (text: string) => text.trim().toLocaleLowerCase();
const editableFields = [
  "text",
  "disabled",
  "subtitleHidden",
  "dynamicPosition",
  "styleOverride",
] as const;

/**
 * Stretch or compress explicit word timings with the chunk they belong to.
 * Keeps word-level effects glued to manual subtitles across merges.
 */
function syncChunkWords(
  chunk: Chunk,
  previousTimestamp: [number, number],
): Chunk {
  const words = Array.isArray(chunk.words) ? chunk.words : [];
  if (words.length === 0) return chunk;
  const rescaledWords = rescaleWordTimings(
    words as SubtitleWord[],
    previousTimestamp,
    chunk.timestamp,
  );
  let unchanged = true;
  for (let index = 0; index < rescaledWords.length; index += 1) {
    const before = words[index];
    const after = rescaledWords[index];
    if (
      before.text !== after.text ||
      before.timestamp[0] !== after.timestamp[0] ||
      before.timestamp[1] !== after.timestamp[1]
    ) {
      unchanged = false;
      break;
    }
  }
  return unchanged ? chunk : { ...chunk, words: rescaledWords };
}

/** Merge cumulative ASR snapshots without treating unedited ASR text as a user edit. */
export function mergeTranscriptionUpdate(
  previous: TranscriptionState,
  incoming: TranscriptionResult,
): TranscriptionResult {
  if (!previous.result || !previous.source) return incoming;
  const oldChunks = previous.source.chunks;
  const byTime = new Map(oldChunks.map((chunk) => [key(chunk), chunk]));
  const byStart = new Map(
    oldChunks.map((chunk) => [chunk.timestamp[0], chunk]),
  );
  const editedByTime = new Map(
    previous.result.chunks.map((chunk, index) => [
      key(oldChunks[index] ?? chunk),
      chunk,
    ]),
  );
  let cursor = 0;
  let hasTextEdit = false;
  const chunks = incoming.chunks.map((chunk) => {
    let source = byTime.get(key(chunk)) ?? byStart.get(chunk.timestamp[0]);
    if (!source) {
      // Whisper can adjust the trailing word's timestamps as more audio arrives.
      // Only transfer across changed starts for the same overlapping source word.
      while (
        cursor + 1 < oldChunks.length &&
        oldChunks[cursor + 1].timestamp[0] <= chunk.timestamp[0]
      )
        cursor++;
      source = oldChunks
        .slice(Math.max(0, cursor - 1), cursor + 3)
        .find((candidate) => {
          const overlap =
            Math.min(candidate.timestamp[1], chunk.timestamp[1]) -
            Math.max(candidate.timestamp[0], chunk.timestamp[0]);
          const shorter = Math.min(
            candidate.timestamp[1] - candidate.timestamp[0],
            chunk.timestamp[1] - chunk.timestamp[0],
          );
          return (
            overlap > 0 &&
            overlap >= shorter * 0.5 &&
            normalize(candidate.text) === normalize(chunk.text)
          );
        });
    }
    if (!source) return chunk;
    const edited = editedByTime.get(key(source));
    if (!edited) return chunk;
    const changes = Object.fromEntries(
      editableFields
        .filter((field) => !Object.is(edited[field], source[field]))
        .map((field) => [field, edited[field]]),
    );
    if (edited.sourceTimestamp) {
      Object.assign(changes, {
        timestamp: edited.timestamp,
        sourceTimestamp: edited.sourceTimestamp,
      });
    }
    // Keep manual word timings (and their per-word flags/styles) across ASR
    // merges; otherwise an incoming worker snapshot would drop them and the
    // subtitle would fall back to unstyled plain text.
    if (Array.isArray(edited.words) && edited.words.length > 0) {
      Object.assign(changes, { words: edited.words });
    }
    if ("text" in changes) hasTextEdit = true;
    return Object.keys(changes).length
      ? syncChunkWords({ ...chunk, ...changes }, chunk.timestamp)
      : chunk;
  });

  // Manual subtitles are user-authored and never appear in a worker snapshot,
  // so carry them forward instead of deleting them mid-stream. A chunk that
  // stores its own word timings identifies itself; if a snapshot chunk covers
  // the same times, the ASR result wins.
  const incomingKeys = new Set(incoming.chunks.map(key));
  const manualChunks = previous.result.chunks.filter(
    (chunk) =>
      Array.isArray(chunk.words) &&
      chunk.words.length > 0 &&
      !incomingKeys.has(key(chunk)),
  );
  const mergedChunks =
    manualChunks.length > 0
      ? [...chunks, ...manualChunks].sort(
          (a, b) => a.timestamp[0] - b.timestamp[0],
        )
      : chunks;

  return {
    ...incoming,
    chunks: mergedChunks,
    ...(hasTextEdit
      ? { text: mergedChunks.map((chunk) => chunk.text.trim()).join(" ") }
      : {}),
  };
}

/** Keep worker snapshots and UI edits in one ordered React update queue. */
export function transcriptionReducer(
  state: TranscriptionState,
  action: TranscriptionAction,
): TranscriptionState {
  if (action.type === "worker") {
    return {
      result: mergeTranscriptionUpdate(state, action.result),
      source: action.result,
    };
  }
  const result =
    typeof action.value === "function"
      ? action.value(state.result)
      : action.value;
  // New video, regenerate, and cancel all clear both the result and merge baseline.
  return result === null ? initialTranscriptionState : { ...state, result };
}
