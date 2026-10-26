import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampCaptionPosition,
  resizeCaptionFont,
} from "../lib/caption-placement";

test("dragging keeps caption extents inside the frame", () => {
  assert.deepEqual(clampCaptionPosition({ x: -0.3, y: 1.2 }, 0.4, 0.2), {
    x: 0.2,
    y: 0.9,
  });
  assert.deepEqual(clampCaptionPosition({ x: 0.3, y: 0.4 }, 0.2, 0.1), {
    x: 0.3,
    y: 0.4,
  });
  assert.deepEqual(clampCaptionPosition({ x: 0, y: 1 }, 2, 3), {
    x: 0.5,
    y: 0.5,
  });
});
test("corner resize expands and contracts proportionally without flipping", () => {
  assert.equal(resizeCaptionFont(40, { x: 100, y: 20 }, { x: 150, y: 30 }), 60);
  assert.equal(
    resizeCaptionFont(40, { x: -100, y: -20 }, { x: -50, y: -10 }),
    20,
  );
  assert.equal(
    resizeCaptionFont(40, { x: 100, y: 20 }, { x: -100, y: -20 }),
    8,
  );
  assert.equal(
    resizeCaptionFont(40, { x: 100, y: 20 }, { x: 1000, y: 200 }),
    160,
  );
});

import {
  updateCaptionPlacement,
  clearCaptionPlacements,
  getCaptionPlacement,
} from "../lib/caption-placement";
import {
  processTranscriptChunks,
  type ProcessedWord,
} from "../lib/transcript-utils";

const source: ProcessedWord[] = [
  { text: "Hello", timestamp: [0, 1], styleOverride: { color: "#ff0000" } },
  { text: "world", timestamp: [1, 2] },
  { text: "Another", timestamp: [4, 5] },
  { text: "phrase", timestamp: [5, 6] },
];
const placement = { customPosition: { x: 0.3, y: 0.4 }, fontSize: 48 };

test("moving one phrase leaves the next phrase and word mode unchanged", () => {
  const chunks = updateCaptionPlacement(source, [0, 2], "phrase", placement);
  const phrases = processTranscriptChunks({ chunks }, "phrase");
  assert.deepEqual(getCaptionPlacement(phrases[0], "phrase"), placement);
  assert.equal(getCaptionPlacement(phrases[1], "phrase"), undefined);
  assert.equal(
    getCaptionPlacement(processTranscriptChunks({ chunks }, "word")[0], "word"),
    undefined,
  );
  assert.equal(chunks[2], source[2]);
  assert.equal(source[0].styleOverride?.phrasePlacement, undefined);
});

test("word placement stays local and preserves independent phrase placement", () => {
  const phrases = updateCaptionPlacement(source, [0, 2], "phrase", placement);
  const chunks = updateCaptionPlacement(phrases, [1, 2], "word", {
    fontSize: 32,
  });
  assert.equal(chunks[0].styleOverride?.wordPlacement, undefined);
  assert.deepEqual(chunks[1].styleOverride?.wordPlacement, { fontSize: 32 });
  assert.deepEqual(
    getCaptionPlacement(
      processTranscriptChunks({ chunks }, "phrase")[0],
      "phrase",
    ),
    placement,
  );
});

test("explicit global placement clears local placement without clearing word colors", () => {
  const chunks = updateCaptionPlacement(source, [0, 2], "phrase", placement);
  const globally = clearCaptionPlacements(chunks);
  assert.deepEqual(globally[0].styleOverride, { color: "#ff0000" });
  assert.equal(globally[1].styleOverride, undefined);
  assert.deepEqual(chunks[0].styleOverride?.phrasePlacement, placement);
});
