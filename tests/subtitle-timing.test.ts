import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editSubtitleTiming,
  resetSubtitleTiming,
  restoreSubtitleTiming,
  parseSubtitleTime,
  buildWordTimings,
  resolveChunkWords,
  rescaleWordTimings,
  splitSubtitleWords,
  updateChunkText,
  type SubtitleWordTiming,
} from "../lib/subtitle-timing";
import {
  processTranscriptChunks,
  transcriptToSrt,
  transcriptToVtt,
  binarySearchActiveChunk,
  formatSrtTime,
  formatVttTime,
} from "../lib/transcript-utils";
import {
  createVideoCutPlan,
  adjustTranscriptChunksForSilenceRemoval,
} from "../lib/silence-removal";
import {
  initialTranscriptionState,
  transcriptionReducer,
} from "../lib/transcription-state";
import {
  MODEL_REQUIREMENTS,
  evaluateModelCapability,
  getEncoderDtype,
  getModelRequirement,
  pickDefaultModelSize,
  requiresWebGPU,
  type HardwareCapabilities,
  type ModelCapability,
  type ModelSize,
} from "../lib/hardware-check";
import type { TranscriptionResult } from "../hooks/useTranscription";

const words = (): TranscriptionResult["chunks"] => [
  { text: "One", timestamp: [1, 1.4] },
  { text: "two", timestamp: [1.6, 2] },
  { text: "three.", timestamp: [2.2, 2.6] },
  { text: "Next.", timestamp: [4, 4.5] },
];

test("word edge edits clamp to adjacent words, video bounds, and minimum duration", () => {
  const chunks = words();
  const selection = { first: 1, last: 1 };
  assert.deepEqual(
    editSubtitleTiming(chunks, selection, "start", -10, 6)[1].timestamp,
    [1.4, 2],
  );
  assert.deepEqual(
    editSubtitleTiming(chunks, selection, "end", 8, 6)[1].timestamp,
    [1.6, 2.2],
  );
  assert.deepEqual(
    editSubtitleTiming(chunks, selection, "start", 9, 6)[1].timestamp,
    [1.98, 2],
  );
  assert.deepEqual(
    editSubtitleTiming(chunks, { first: 0, last: 0 }, "start", -1, 6)[0]
      .timestamp,
    [0, 1.4],
  );
  assert.deepEqual(
    editSubtitleTiming(chunks, { first: 3, last: 3 }, "end", 9, 6)[3].timestamp,
    [4, 6],
  );
  assert.deepEqual(
    editSubtitleTiming(chunks, selection, "end", NaN, 6),
    chunks,
  );
  assert.deepEqual(chunks, words());
});

test("line edges change only the first or last word and keep line grouping stable", () => {
  const chunks = words();
  const selection = { first: 0, last: 2 };
  const earlier = editSubtitleTiming(chunks, selection, "start", 0, 6);
  assert.deepEqual(earlier.slice(1), chunks.slice(1));
  const later = editSubtitleTiming(earlier, selection, "end", 3.9, 6);
  assert.deepEqual(later[1], chunks[1]);
  assert.deepEqual(later[2].timestamp, [2.2, 3.9]);
  const phrases = processTranscriptChunks({ chunks: later }, "phrase", 3);
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[0].timestamp, [0, 3.9]);
  assert.deepEqual(
    phrases[0].words?.map((word) => word.sourceIndex),
    [0, 1, 2],
  );
});

test("whole-line moves preserve word durations and gaps and stop at neighbors", () => {
  const chunks = words();
  const moved = editSubtitleTiming(chunks, { first: 0, last: 2 }, "move", 8, 6);
  assert.equal(moved[2].timestamp[1], 4);
  for (let i = 0; i < 3; i++) {
    const delta = moved[i].timestamp[0] - chunks[i].timestamp[0];
    assert.ok(Math.abs(delta - 1.4) < 1e-8);
    assert.ok(
      Math.abs(moved[i].timestamp[1] - chunks[i].timestamp[1] - delta) < 1e-8,
    );
  }
  assert.equal(moved[3], chunks[3]);
  assert.equal(
    editSubtitleTiming(chunks, { first: 0, last: 2 }, "move", -8, 6)[0]
      .timestamp[0],
    0,
  );
});

test("timing edits and Undo never change video cuts or unrelated text and style edits", () => {
  const original = words();
  original[1].disabled = true;
  const edited = editSubtitleTiming(
    original,
    { first: 1, last: 1 },
    "end",
    2.15,
    6,
  );
  assert.deepEqual(
    createVideoCutPlan(6, [], edited),
    createVideoCutPlan(6, [], original),
  );
  const changedText = edited.map((chunk, i) =>
    i === 1
      ? { ...chunk, text: "TWO", styleOverride: { color: "red" } }
      : chunk,
  );
  const undone = restoreSubtitleTiming(changedText, original);
  assert.equal(undone[1].text, "TWO");
  assert.equal(undone[1].styleOverride?.color, "red");
  assert.equal(undone[1].disabled, true);
  assert.deepEqual(undone[1].timestamp, original[1].timestamp);
  assert.equal(undone[0].sourceTimestamp, undefined);
  const disabledAfterEdit = edited.map((chunk, i) => ({
    ...chunk,
    disabled: i === 1,
  }));
  assert.deepEqual(
    createVideoCutPlan(6, [], disabledAfterEdit)?.removedRanges,
    [{ startTime: 1.6, endTime: 2 }],
  );
});

test("Reset restores original timing and refuses new overlaps", () => {
  const original = words();
  const moved = editSubtitleTiming(
    original,
    { first: 1, last: 1 },
    "move",
    0.1,
    6,
  );
  assert.deepEqual(
    resetSubtitleTiming(moved, { first: 1, last: 1 }, 6)?.[1].timestamp,
    original[1].timestamp,
  );
  const extendedPrevious = editSubtitleTiming(
    moved,
    { first: 0, last: 0 },
    "end",
    1.7,
    6,
  );
  assert.equal(
    resetSubtitleTiming(extendedPrevious, { first: 1, last: 1 }, 6),
    null,
  );
});

test("preview and subtitle exports use edited times while cuts retain original positions", () => {
  let chunks = editSubtitleTiming(
    words(),
    { first: 0, last: 0 },
    "start",
    0.5,
    6,
  );
  assert.equal(
    binarySearchActiveChunk(processTranscriptChunks({ chunks }), 0.6)?.text,
    "One",
  );
  assert.match(transcriptToSrt({ chunks }), /00:00:00,500 --> 00:00:01,400/);
  assert.match(transcriptToVtt({ chunks }), /00:00:00.500/);
  assert.deepEqual(
    JSON.parse(JSON.stringify({ chunks })).chunks[0].timestamp,
    [0.5, 1.4],
  );
  chunks[1] = { ...chunks[1], disabled: true };
  chunks = editSubtitleTiming(chunks, { first: 1, last: 1 }, "end", 2.15, 6);
  const plan = createVideoCutPlan(6, [], chunks)!;
  const exported = adjustTranscriptChunksForSilenceRemoval(chunks, plan);
  assert.ok(
    Math.abs(
      exported.find((chunk) => chunk.text === "Next.")!.timestamp[0] - 3.6,
    ) < 1e-8,
  );
  assert.match(transcriptToSrt({ chunks }), /00:00:03,600/);
});

test("timing and style edits survive repeated worker timestamp revisions", () => {
  let state = transcriptionReducer(initialTranscriptionState, {
    type: "worker",
    result: { text: "One", chunks: words() },
  });
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => ({
      ...previous!,
      chunks: editSubtitleTiming(
        previous!.chunks,
        { first: 0, last: 0 },
        "start",
        0.5,
        6,
      ),
    }),
  });
  for (const offset of [0.05, 0.1]) {
    const incoming = words();
    incoming[0].timestamp = [1 + offset, 1.4 + offset];
    state = transcriptionReducer(state, {
      type: "worker",
      result: { text: "One", chunks: incoming },
    });
    assert.deepEqual(state.result!.chunks[0].timestamp, [0.5, 1.4]);
    assert.deepEqual(state.result!.chunks[0].sourceTimestamp, [1, 1.4]);
  }
});

test("precise time input accepts seconds and timecodes but rejects malformed values", () => {
  assert.equal(parseSubtitleTime("1:02.350"), 62.35);
  assert.equal(parseSubtitleTime("01:02:03.456"), 3723.456);
  assert.equal(parseSubtitleTime("0.020"), 0.02);
  for (const value of ["", "-1", "NaN", "1:99", "Infinity", "1.1234", "1e3"])
    assert.equal(parseSubtitleTime(value), null);
});

test("time formatting rounds exact milliseconds and carries into the next minute", () => {
  assert.equal(formatSrtTime(1.4), "00:00:01,400");
  assert.equal(formatVttTime(59.9996), "00:01:00.000");
});

test("cut exports keep edited and unedited words in a consistent grouping time base", () => {
  const chunks: TranscriptionResult["chunks"] = [
    { text: "Cut.", timestamp: [0, 3], disabled: true },
    { text: "Hello", timestamp: [4, 4.2] },
    { text: "world.", timestamp: [4.3, 4.5] },
  ];
  const edited = editSubtitleTiming(
    chunks,
    { first: 2, last: 2 },
    "end",
    4.6,
    6,
  );
  const plan = createVideoCutPlan(6, [], edited)!;
  const output = adjustTranscriptChunksForSilenceRemoval(edited, plan);
  const phrases = processTranscriptChunks({ chunks: output }, "phrase", 3);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].text, "Hello world.");
  assert.deepEqual(edited[2].sourceTimestamp, [4.3, 4.5]);
});

// Interpolated word boundaries are compared with a tolerance because
// start + (span * index) / count rounds differently than start + span/count.
function assertClose(
  actual: readonly number[],
  expected: readonly number[],
  message: string,
) {
  assert.equal(actual.length, expected.length, message);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-9,
      `${message}: [${actual}] vs [${expected}]`,
    );
  }
}

test("manual subtitle words interpolate across the chunk span without gaps", () => {
  const words = buildWordTimings("  Ship   it now ", [1, 3]);
  assert.deepEqual(
    words.map((word) => word.text),
    ["Ship", "it", "now"],
  );
  assertClose(words[0].timestamp, [1, 5 / 3], "first word span");
  assertClose(words[1].timestamp, [5 / 3, 7 / 3], "second word span");
  // The last word ends exactly at the chunk end so scrubbing stays in sync.
  assertClose(words[2].timestamp, [7 / 3, 3], "last word span");
  // Adjacent windows: no gaps and no overlaps between words.
  for (let i = 1; i < words.length; i += 1) {
    assert.equal(words[i].timestamp[0], words[i - 1].timestamp[1]);
  }
  assert.deepEqual(splitSubtitleWords("   "), []);
  assert.deepEqual(buildWordTimings("one", [2, 5]), [
    { text: "one", timestamp: [2, 5] },
  ]);
  // A degenerate span must not produce inverted or NaN windows.
  for (const word of buildWordTimings("a b", [3, 1])) {
    assert.ok(Number.isFinite(word.timestamp[0]));
    assert.ok(word.timestamp[1] >= word.timestamp[0]);
  }
});

test("a chunk without words resolves synthetic timings instead of plain text", () => {
  const chunk = { text: "hello world", timestamp: [0, 4] as [number, number] };
  const resolved = resolveChunkWords(chunk);
  assert.deepEqual(
    resolved.map((word) => word.text),
    ["hello", "world"],
  );
  assert.deepEqual(resolved[0].timestamp, [0, 2]);
  assert.deepEqual(resolved[1].timestamp, [2, 4]);
  // Stored words win over synthesis, and are returned unchanged.
  const stored = resolveChunkWords({
    ...chunk,
    words: [{ text: "hello", timestamp: [0.1, 0.5] }],
  });
  assert.deepEqual(stored[0].timestamp, [0.1, 0.5]);
  // Depth layers assign a leading "behind" word so dynamic mode still works.
  const dynamic = resolveChunkWords(chunk, true);
  assert.equal(dynamic[0].dynamicPosition, "behind");
  assert.equal(dynamic[1].dynamicPosition, "front");
});

test("manual subtitle chunks stay out of neighboring phrase grouping", () => {
  const chunks: TranscriptionResult["chunks"] = [
    { text: "Before", timestamp: [0, 0.5] },
    {
      text: "Manual line here",
      timestamp: [0.6, 1.6],
      words: buildWordTimings("Manual line here", [0.6, 1.6]),
    },
    { text: "After", timestamp: [1.7, 2] },
  ];
  const phrases = processTranscriptChunks({ chunks }, "phrase", 3);
  assert.deepEqual(
    phrases.map((phrase) => phrase.text),
    ["Before", "Manual line here", "After"],
  );
  // The manual phrase keeps per-word timings, all owned by its own chunk.
  const manual = phrases[1];
  assert.equal(manual.words?.length, 3);
  assert.deepEqual(
    manual.words?.map((word) => word.text),
    ["Manual", "line", "here"],
  );
  assert.equal(
    manual.words?.every((word) => word.sourceIndex === 1),
    true,
  );
});

test("editing a manual subtitle rebuilds its word timings and keeps word styles", () => {
  const words = buildWordTimings("One two", [0, 2]);
  const wordsWithStyle = words.map((word, index) =>
    index === 1 ? { ...word, styleOverride: { color: "#FF0000" } } : word,
  );
  const chunk = {
    text: "One two",
    timestamp: [0, 2] as [number, number],
    words: wordsWithStyle,
  };
  const edited = updateChunkText(chunk, "Alpha beta gamma");
  assert.equal(edited.text, "Alpha beta gamma");
  assert.deepEqual(
    edited.words?.map((word) => word.text),
    ["Alpha", "beta", "gamma"],
  );
  // Word spans are re-interpolated over the same chunk window.
  assert.deepEqual(edited.words?.[0].timestamp, [0, 2 / 3]);
  assert.deepEqual(edited.words?.[2].timestamp, [4 / 3, 2]);
  // Per-word styles are preserved by index.
  assert.equal(edited.words?.[1].styleOverride?.color, "#FF0000");
  // Chunks without stored words only change their text.
  const plain: { text: string; words?: SubtitleWordTiming[] } = updateChunkText(
    { text: "old", timestamp: [0, 1] },
    " new text ",
  );
  assert.equal(plain.text, "new text");
  assert.equal(plain.words, undefined);
});

test("moving or undoing a subtitle keeps its word timings in sync", () => {
  const chunk = {
    text: "a b",
    timestamp: [1, 3] as [number, number],
    words: buildWordTimings("a b", [1, 3]),
  };
  const moved = editSubtitleTiming(
    [chunk],
    { first: 0, last: 0 },
    "move",
    2,
    10,
  );
  assert.deepEqual(moved[0].timestamp, [3, 5]);
  assert.deepEqual(
    moved[0].words?.map((word) => word.timestamp),
    [
      [3, 4],
      [4, 5],
    ],
  );
  const undone = restoreSubtitleTiming(moved, [chunk]);
  assert.deepEqual(undone[0].timestamp, [1, 3]);
  assert.deepEqual(
    undone[0].words?.map((word) => word.timestamp),
    [
      [1, 2],
      [2, 3],
    ],
  );
  // A zero-length target span collapses words without producing NaN.
  for (const word of rescaleWordTimings(
    buildWordTimings("a b c", [0, 3]),
    [0, 3],
    [5, 5],
  )) {
    assert.ok(Number.isFinite(word.timestamp[0]));
    assert.ok(Number.isFinite(word.timestamp[1]));
  }
});

test("cut exports remap manual word timings into the output time base", () => {
  const chunks: TranscriptionResult["chunks"] = [
    { text: "Cut.", timestamp: [0, 3], disabled: true },
    {
      text: "Manual words here",
      timestamp: [4, 6],
      words: buildWordTimings("Manual words here", [4, 6]),
    },
  ];
  // Disabling the first chunk cuts [0, 3], shifting the manual chunk from
  // [4, 6] in source time to [1, 3] in the output time base. The word windows
  // are remapped through the same plan, so the relative 2/2/2 thirds survive.
  const plan = createVideoCutPlan(6, [], chunks)!;
  const output = adjustTranscriptChunksForSilenceRemoval(chunks, plan);
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].timestamp, [1, 3]);
  assertClose(
    output[0].words!.flatMap((word) => word.timestamp),
    [1, 5 / 3, 5 / 3, 7 / 3, 7 / 3, 3],
    "remapped word spans",
  );
});

const MB = 1024 * 1024;

function caps(
  overrides: Partial<HardwareCapabilities> = {},
): HardwareCapabilities {
  return {
    webgpu: false,
    maxBufferSize: null,
    maxStorageBufferBindingSize: null,
    hardwareConcurrency: 8,
    deviceMemoryGB: 8,
    supportsFp16: null,
    ...overrides,
  };
}

function evaluate(
  model: ModelSize,
  capabilities: HardwareCapabilities,
): ModelCapability {
  const requirement = getModelRequirement(model);
  assert.ok(requirement, `missing requirement for ${model}`);
  return evaluateModelCapability(requirement, capabilities);
}

test("tiny and base stay available on CPU-only devices", () => {
  for (const model of ["tiny", "base"] as ModelSize[]) {
    assert.equal(evaluate(model, caps()).supported, true, model);
  }
});

test("turbo and medium require WebGPU and are blocked without it", () => {
  const cpuOnly = caps({ webgpu: false });
  for (const model of ["turbo", "medium"] as ModelSize[]) {
    const result = evaluate(model, cpuOnly);
    assert.equal(result.supported, false, model);
    assert.equal(result.reason, "WebGPU required", model);
  }
  assert.equal(requiresWebGPU("turbo"), true);
  assert.equal(requiresWebGPU("medium"), true);
  assert.equal(requiresWebGPU("small"), false);
});

test("large models are blocked when the GPU buffer limit is too small", () => {
  // WebGPU present but a 256 MB ceiling (the classic Chrome default).
  const smallBuffer = caps({
    webgpu: true,
    maxBufferSize: 256 * MB,
    maxStorageBufferBindingSize: 128 * MB,
  });
  const turbo = evaluate("turbo", smallBuffer);
  assert.equal(turbo.supported, false);
  assert.match(String(turbo.reason), /Needs 1024 MB GPU buffer/);

  const medium = evaluate("medium", smallBuffer);
  assert.equal(medium.supported, false);

  // A large enough buffer passes the VRAM gate.
  const bigBuffer = caps({
    webgpu: true,
    maxBufferSize: 2048 * MB,
    maxStorageBufferBindingSize: 2048 * MB,
  });
  assert.equal(evaluate("turbo", bigBuffer).supported, true);
  assert.equal(evaluate("medium", bigBuffer).supported, true);
});

// The core of the fp16 fix: an fp16 graph on a device without `shader-f16`
// makes ORT throw "The device (webgpu) does not support fp16." The encoder
// dtype must therefore depend on the adapter, not be hardcoded.
test("encoder dtype follows shader-f16 support", () => {
  assert.equal(getEncoderDtype("turbo", true), "fp16");
  assert.equal(getEncoderDtype("medium", true), "fp16");
  // Without fp16 we drop to 4-bit, never fp32: fp32 is 2,430 MB for turbo and
  // would OOM the low-VRAM GPUs this path exists for.
  assert.equal(getEncoderDtype("turbo", false), "q4");
  assert.equal(getEncoderDtype("medium", false), "q4");
  // Small models are unaffected and keep their validated fp32 encoder.
  assert.equal(getEncoderDtype("small", true), "fp32");
  assert.equal(getEncoderDtype("small", false), "fp32");
  assert.equal(getEncoderDtype("tiny", false), "fp32");
  assert.equal(getEncoderDtype("base", false), "fp32");
});

test("missing fp16 support lowers the required GPU buffer for large models", () => {
  // A 1024 MB adapter can run Turbo on the q4 path but not the fp16 path,
  // whose encoder alone is 1,215 MB.
  const oneGig = caps({
    webgpu: true,
    maxBufferSize: 1024 * MB,
    maxStorageBufferBindingSize: 1024 * MB,
    deviceMemoryGB: 8,
  });
  const withFp16 = evaluate("turbo", { ...oneGig, supportsFp16: true });
  const withoutFp16 = evaluate("turbo", { ...oneGig, supportsFp16: false });
  assert.equal(withFp16.supported, false);
  assert.match(String(withFp16.reason), /Needs 2048 MB GPU buffer/);
  assert.equal(withoutFp16.supported, true);

  // Medium's q4 footprint (200 MB encoder + 448 MB decoder) also fits.
  assert.equal(
    evaluate("medium", { ...oneGig, supportsFp16: false }).supported,
    true,
  );
  // Unknown fp16 support must not be read as "fp16 is safe": it takes the
  // conservative q4 requirement.
  assert.equal(
    evaluate("turbo", { ...oneGig, supportsFp16: null }).supported,
    true,
  );
});

test("an unreported GPU buffer limit blocks GPU-only models", () => {
  const unknownLimit = caps({ webgpu: true, maxBufferSize: null });
  const result = evaluate("turbo", unknownLimit);
  assert.equal(result.supported, false);
  assert.equal(result.reason, "GPU buffer limit unknown");
});

test("medium needs 8 GB RAM when RAM is reported but not when it is not", () => {
  const lowRam = caps({
    webgpu: true,
    maxBufferSize: 2048 * MB,
    maxStorageBufferBindingSize: 2048 * MB,
    deviceMemoryGB: 4,
  });
  const blocked = evaluate("medium", lowRam);
  assert.equal(blocked.supported, false);
  assert.match(String(blocked.reason), /Needs 8 GB system memory/);

  // Firefox/Safari do not implement deviceMemory. Unknown must not block.
  const unknownRam = caps({
    webgpu: true,
    maxBufferSize: 2048 * MB,
    maxStorageBufferBindingSize: 2048 * MB,
    deviceMemoryGB: null,
  });
  assert.equal(evaluate("medium", unknownRam).supported, true);
});

test("small is gated on CPU cores and RAM but never blocked on unknowns", () => {
  const weak = caps({ hardwareConcurrency: 2, deviceMemoryGB: 2 });
  assert.equal(evaluate("small", weak).supported, false);
  assert.match(
    String(evaluate("small", weak).reason),
    /CPU cores|system memory/,
  );

  const unknownCpu = caps({ hardwareConcurrency: null, deviceMemoryGB: null });
  assert.equal(evaluate("small", unknownCpu).supported, true);
});

test("every model size is described and the default picks the largest usable", () => {
  assert.deepEqual(
    MODEL_REQUIREMENTS.map((entry) => entry.value),
    ["tiny", "base", "small", "turbo", "medium"],
  );
  for (const entry of MODEL_REQUIREMENTS) {
    assert.ok(entry.label.length > 0);
    assert.ok(entry.approxSizeMB > 0);
  }
  // Sizes should increase monotonically for a sensible UI ordering.
  const sizes = MODEL_REQUIREMENTS.map((entry) => entry.approxSizeMB);
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i] > sizes[i - 1], `size order at index ${i}`);
  }

  const all: Record<ModelSize, ModelCapability> = {
    tiny: { supported: true },
    base: { supported: true },
    small: { supported: true },
    turbo: { supported: false, reason: "WebGPU required" },
    medium: { supported: false, reason: "WebGPU required" },
  };
  assert.equal(pickDefaultModelSize(all), "small");

  const gpuOnly: Record<ModelSize, ModelCapability> = {
    ...all,
    turbo: { supported: true },
  };
  assert.equal(pickDefaultModelSize(gpuOnly), "turbo");

  const nothing: Record<ModelSize, ModelCapability> = {
    tiny: { supported: false, reason: "no" },
    base: { supported: false, reason: "no" },
    small: { supported: false, reason: "no" },
    turbo: { supported: false, reason: "no" },
    medium: { supported: false, reason: "no" },
  };
  assert.equal(pickDefaultModelSize(nothing), "tiny");
});

test("word timings survive streaming ASR merges", () => {
  const initial: TranscriptionResult = {
    text: "One two",
    chunks: [
      { text: "One", timestamp: [0, 0.5] },
      { text: "two", timestamp: [0.5, 1] },
    ],
  };
  let state = transcriptionReducer(initialTranscriptionState, {
    type: "worker",
    result: initial,
  });
  // Simulate the user adding a manual subtitle.
  state = transcriptionReducer(state, {
    type: "edit",
    value: (previous) => {
      const chunk = {
        text: "Manual line",
        timestamp: [2, 4] as [number, number],
        words: buildWordTimings("Manual line", [2, 4]),
      };
      return previous
        ? { ...previous, chunks: [...previous.chunks, chunk] }
        : previous;
    },
  });
  assert.equal(state.result?.chunks.length, 3);
  // A later worker snapshot must not drop the manual word timings.
  state = transcriptionReducer(state, { type: "worker", result: initial });
  const manual = state.result?.chunks.find((chunk) => chunk.timestamp[0] === 2);
  assert.deepEqual(
    manual?.words?.map((word) => word.text),
    ["Manual", "line"],
  );
});
