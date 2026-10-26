import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialTranscriptionState,
  transcriptionReducer,
} from "../lib/transcription-state";
import {
  updateCaptionPlacement,
  clearCaptionPlacements,
  getCaptionPlacement,
} from "../lib/caption-placement";
import { processTranscriptChunks } from "../lib/transcript-utils";
import type { TranscriptionResult } from "../hooks/useTranscription";

const first: TranscriptionResult = {
  text: "Hello world",
  chunks: [
    { text: "Hello", timestamp: [0, 1] },
    { text: "world", timestamp: [1, 2] },
  ],
};
const next: TranscriptionResult = {
  text: "Hello world next",
  chunks: [
    ...structuredClone(first.chunks),
    { text: "next", timestamp: [4, 5] },
  ],
};
const placement = { customPosition: { x: 0.25, y: 0.3 }, fontSize: 48 };
const start = () =>
  transcriptionReducer(initialTranscriptionState, {
    type: "worker",
    result: structuredClone(first),
  });

for (const mode of ["word", "phrase"] as const) {
  test(`${mode} drag survives partial updates and completion while new captions stay unedited`, () => {
    let state = start();
    state = transcriptionReducer(state, {
      type: "edit",
      value: (previous) => ({
        ...previous!,
        chunks: updateCaptionPlacement(
          previous!.chunks,
          mode === "phrase" ? [0, 2] : [0, 1],
          mode,
          placement,
        ),
      }),
    });
    for (const snapshot of [
      next,
      { ...structuredClone(next), generationTime: 12 },
    ]) {
      state = transcriptionReducer(state, { type: "worker", result: snapshot });
      const chunks = processTranscriptChunks(state.result!, mode);
      assert.deepEqual(getCaptionPlacement(chunks[0], mode), placement);
      assert.equal(
        getCaptionPlacement(chunks[chunks.length - 1], mode),
        undefined,
      );
      assert.equal(state.result!.chunks.length, 3);
    }
    assert.equal(state.result!.generationTime, 12);
    assert.equal(first.chunks[0].styleOverride, undefined);
  });
}

test("text, emoji, hidden/removal, and depth edits survive worker updates", () => {
  let state = start();
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: previous!.chunks.map((chunk, i) =>
        i === 0
          ? {
              ...chunk,
              text: "Hi",
              subtitleHidden: true,
              disabled: true,
              dynamicPosition: "front",
              styleOverride: { emojiOverlay: "❤️", color: "#ff0000" },
            }
          : chunk,
      ),
    }),
  });
  state = transcriptionReducer(state, { type: "worker", result: next });
  assert.deepEqual(state.result!.chunks[0], {
    text: "Hi",
    timestamp: [0, 1],
    subtitleHidden: true,
    disabled: true,
    dynamicPosition: "front",
    styleOverride: { emojiOverlay: "❤️", color: "#ff0000" },
  });
  assert.equal(state.result!.text, "Hi world next");
});

test("unedited ASR text and timing can still be corrected", () => {
  const corrected: TranscriptionResult = {
    text: "Hello there",
    chunks: [
      { text: "Hello", timestamp: [0, 1.1] },
      { text: "there", timestamp: [1.1, 2.2] },
    ],
  };
  const state = transcriptionReducer(start(), {
    type: "worker",
    result: corrected,
  });
  assert.deepEqual(state.result, corrected);
});

test("placement follows an overlapping word when ASR adjusts its start and end", () => {
  let state = start();
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: updateCaptionPlacement(
        previous!.chunks,
        [1, 2],
        "word",
        placement,
      ),
    }),
  });
  state = transcriptionReducer(state, {
    type: "worker",
    result: {
      text: "Hello world",
      chunks: [
        { text: "Hello", timestamp: [0, 1.05] },
        { text: " world", timestamp: [1.05, 2.1] },
      ],
    },
  });
  assert.deepEqual(
    state.result!.chunks[1].styleOverride?.wordPlacement,
    placement,
  );
  assert.deepEqual(state.result!.chunks[1].timestamp, [1.05, 2.1]);
});

test("applying globally or clearing a word style is not undone by the next snapshot", () => {
  let state = start();
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: updateCaptionPlacement(
        previous!.chunks,
        [0, 2],
        "phrase",
        placement,
      ),
    }),
  });
  state = transcriptionReducer(state, {
    type: "worker",
    result: structuredClone(next),
  });
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: clearCaptionPlacements(previous!.chunks),
    }),
  });
  state = transcriptionReducer(state, {
    type: "worker",
    result: structuredClone(next),
  });
  assert.equal(state.result!.chunks[0].styleOverride, undefined);
});

test("regenerate or new video clears edits even when timestamps match", () => {
  let state = start();
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: updateCaptionPlacement(
        previous!.chunks,
        [0, 1],
        "word",
        placement,
      ),
    }),
  });
  state = transcriptionReducer(state, { type: "edit", value: null });
  state = transcriptionReducer(state, {
    type: "worker",
    result: structuredClone(first),
  });
  assert.deepEqual(state.result, first);
});

test("an unrelated replacement at a different start does not inherit edits", () => {
  let state = start();
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: updateCaptionPlacement(
        previous!.chunks,
        [1, 2],
        "word",
        placement,
      ),
    }),
  });
  state = transcriptionReducer(state, {
    type: "worker",
    result: {
      text: "different",
      chunks: [{ text: "different", timestamp: [1.1, 2.1] }],
    },
  });
  assert.equal(state.result!.chunks[0].styleOverride, undefined);
});
