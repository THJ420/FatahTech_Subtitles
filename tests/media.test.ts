import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import {
  createSilenceRemovalPlan,
  createVideoCutPlan,
  getPlaybackSkipTarget,
  detectSilenceRanges,
  sourceTimeToOutputTime,
  outputTimeToSourceTime,
  adjustTranscriptChunksForSilenceRemoval,
} from "../lib/silence-removal";
import {
  processTranscriptChunks,
  binarySearchActiveChunk,
  transcriptToSrt,
  transcriptToVtt,
  mergeTimestampRanges,
} from "../lib/transcript-utils";
import {
  computeCropX,
  interpolateCenterX,
  smoothTimeline,
} from "../lib/person-tracking";
import {
  createAutoZoomCutSchedule,
  getAutoZoomTransform,
} from "../lib/auto-zoom";

test("playback cuts preserve speech edges and do not seek again at the cut end", () => {
  const ranges = [
    [1, 2],
    [2.1, 3],
  ];
  assert.equal(getPlaybackSkipTarget(0.95, ranges, 5), null);
  assert.equal(getPlaybackSkipTarget(1, ranges, 5), 2);
  assert.equal(getPlaybackSkipTarget(1.9, ranges, 5), 2);
  assert.equal(getPlaybackSkipTarget(2, ranges, 5), null);
  assert.equal(getPlaybackSkipTarget(2.05, ranges, 5), null);
  assert.equal(getPlaybackSkipTarget(2.1, ranges, 5), 3);
  assert.equal(getPlaybackSkipTarget(4, [[4, 6]], 5), 5);
  assert.deepEqual(ranges, [
    [1, 2],
    [2.1, 3],
  ]);
});

test("Mediabunny reads a real MP4 with video and audio", async () => {
  const input = new Input({
    source: new BufferSource(
      await readFile(new URL("./fixtures/speech.mp4", import.meta.url)),
    ),
    formats: ALL_FORMATS,
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    assert.ok(video);
    assert.ok(audio);
    assert.equal(video.codec, "avc");
    assert.equal(audio.codec, "aac");
    assert.ok((await input.computeDuration()) > 3);
  } finally {
    input.dispose();
  }
});

test("silence cuts merge overlaps and clamp to the video", () => {
  const plan = createSilenceRemovalPlan(10, [
    { startTime: 3, endTime: 5 },
    { startTime: 2, endTime: 4 },
    { startTime: 9, endTime: 12 },
  ]);
  assert.equal(plan.outputDuration, 6);
  assert.deepEqual(plan.removedRanges, [
    { startTime: 2, endTime: 5 },
    { startTime: 9, endTime: 10 },
  ]);
});

test("retained timestamps round-trip across silence cuts", () => {
  const plan = createSilenceRemovalPlan(10, [{ startTime: 2, endTime: 4 }]);
  for (const time of [0, 1, 4.1, 5, 9, 10]) {
    assert.ok(
      Math.abs(
        outputTimeToSourceTime(sourceTimeToOutputTime(time, plan), plan) - time,
      ) < 1e-8,
    );
  }
});

test("silence detection protects speech edges", () => {
  const audio = new Float32Array(16000 * 3).fill(0.5);
  audio.fill(0, 16000, 32000);
  const ranges = detectSilenceRanges(audio, 0.5);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].startTime > 1);
  assert.ok(ranges[0].endTime < 2);
  assert.deepEqual(detectSilenceRanges(new Float32Array(), 0.5), []);
});

test("removed words disappear and retained subtitle timing shifts", () => {
  const plan = createSilenceRemovalPlan(8, [{ startTime: 2, endTime: 4 }]);
  const chunks = [
    { text: "cut", timestamp: [2.5, 3] as [number, number] },
    {
      text: "keep",
      timestamp: [5, 6] as [number, number],
      subtitleHidden: true,
    },
  ];
  assert.deepEqual(adjustTranscriptChunksForSilenceRemoval(chunks, plan), [
    { text: "keep", timestamp: [3, 4], subtitleHidden: true },
  ]);
  assert.deepEqual(chunks[1].timestamp, [5, 6]);
});

test("full silence and empty cuts produce valid durations", () => {
  assert.equal(createSilenceRemovalPlan(5, []).outputDuration, 5);
  const plan = createSilenceRemovalPlan(5, [{ startTime: 0, endTime: 5 }]);
  assert.equal(plan.outputDuration, 0);
  assert.equal(outputTimeToSourceTime(0, plan), 0);
});

test("the exact cut boundary maps to the next kept frame", () => {
  const plan = createSilenceRemovalPlan(6, [{ startTime: 2, endTime: 4 }]);
  assert.equal(outputTimeToSourceTime(2, plan), 4);
  assert.equal(outputTimeToSourceTime(4, plan), 6);
});

test("merging removed phrase ranges preserves every word timestamp for restore", () => {
  const timestamps = Object.freeze([
    Object.freeze([1.62, 2.04] as const),
    Object.freeze([2.04, 2.2] as const),
    Object.freeze([2.2, 2.36] as const),
  ]);
  const merged = mergeTimestampRanges(timestamps);
  assert.deepEqual(merged, [[1.62, 2.36]]);
  assert.deepEqual(timestamps, [
    [1.62, 2.04],
    [2.04, 2.2],
    [2.2, 2.36],
  ]);
  merged[0][1] = 4;
  assert.equal(timestamps[0][1], 2.04);
});

test("preview cuts merge unsorted silence and word ranges without changing inputs", () => {
  const ranges: Array<[number, number]> = [
    [5, 6],
    [2, 4],
    [3, 5],
    [8, 9],
  ];
  const before = structuredClone(ranges);
  assert.deepEqual(mergeTimestampRanges(ranges), [
    [2, 6],
    [8, 9],
  ]);
  assert.deepEqual(ranges, before);
});

test("video cuts combine removed words and silence while keeping hidden subtitles in the video", () => {
  const chunks = [
    { timestamp: [2, 4] as [number, number], disabled: true },
    { timestamp: [6, 7] as [number, number], subtitleHidden: true },
  ];
  const silence = [
    { startTime: 3, endTime: 5 },
    { startTime: 12, endTime: 13 },
  ];
  const before = structuredClone({ chunks, silence });
  const plan = createVideoCutPlan(20, silence, chunks);
  assert.ok(plan);
  assert.deepEqual(plan.removedRanges, [
    { startTime: 2, endTime: 5 },
    { startTime: 12, endTime: 13 },
  ]);
  assert.equal(plan.outputDuration, 16);
  assert.equal(sourceTimeToOutputTime(6, plan), 3);
  assert.equal(outputTimeToSourceTime(9, plan), 13);
  assert.deepEqual({ chunks, silence }, before);
  assert.equal(createVideoCutPlan(20, [], [chunks[1]]), null);
});

test("auto zoom uses retained video time after a leading section is removed", () => {
  const chunks = [
    { text: "cut", timestamp: [0, 6.4] as [number, number], disabled: true },
    { text: "first", timestamp: [8, 9] as [number, number] },
    { text: "later", timestamp: [14, 15] as [number, number] },
  ];
  const plan = createVideoCutPlan(18, [], chunks);
  assert.ok(plan);
  const retained = adjustTranscriptChunksForSilenceRemoval(chunks, plan);
  const schedule = createAutoZoomCutSchedule(
    retained
      .filter((chunk) => !chunk.disabled)
      .map((chunk) => chunk.timestamp[0]),
    plan.outputDuration,
  );
  const previewTime = sourceTimeToOutputTime(8, plan);
  const exportTime = retained.find((chunk) => chunk.text === "first")!
    .timestamp[0];
  assert.equal(previewTime, exportTime);
  assert.equal(
    getAutoZoomTransform(previewTime, plan.outputDuration, 0.5, schedule).scale,
    1.02,
  );
  assert.notEqual(
    getAutoZoomTransform(8, 18, 0.5, createAutoZoomCutSchedule([8, 14], 18))
      .scale,
    1.02,
  );
});

const transcript = {
  chunks: [
    { text: "Hello", timestamp: [0, 0.5] as [number, number] },
    { text: "world", timestamp: [0.5, 1] as [number, number] },
    { text: "Again", timestamp: [3, 4] as [number, number] },
  ],
};

test("phrase grouping breaks at long gaps and word limits", () => {
  assert.deepEqual(
    processTranscriptChunks(transcript, "phrase", 2).map((c) => c.text),
    ["Hello world", "Again"],
  );
  assert.equal(processTranscriptChunks(transcript, "phrase", 1).length, 3);
});

test("subtitle lookup handles gaps and empty input", () => {
  assert.equal(binarySearchActiveChunk(transcript.chunks, 0.2)?.text, "Hello");
  assert.equal(binarySearchActiveChunk(transcript.chunks, 2), undefined);
  assert.equal(binarySearchActiveChunk([], 0), undefined);
});

test("subtitle file exports preserve timing and text", () => {
  assert.match(
    transcriptToSrt(transcript),
    /00:00:00,000 --> 00:00:00,500\nHello/,
  );
  assert.match(
    transcriptToVtt(transcript),
    /^WEBVTT\n\n1\n00:00:00.000 --> 00:00:00.500\nHello/,
  );
});

test("a hidden word does not hide visible words in the same phrase", () => {
  const edited = {
    chunks: [
      { text: "Keep", timestamp: [0, 0.5] as [number, number] },
      {
        text: "hidden",
        timestamp: [0.5, 1] as [number, number],
        subtitleHidden: true,
      },
      { text: "visible", timestamp: [1, 1.5] as [number, number] },
    ],
  };
  const phrases = processTranscriptChunks(edited, "phrase");
  const visiblePhrases = phrases.filter(
    (chunk) =>
      !chunk.words?.some((word) => word.disabled || word.subtitleHidden),
  );
  assert.deepEqual(
    visiblePhrases.map((chunk) => chunk.text),
    ["Keep", "visible"],
  );
  for (const output of [
    transcriptToSrt(edited, "phrase"),
    transcriptToVtt(edited, "phrase"),
  ]) {
    assert.match(output, /Keep/);
    assert.match(output, /visible/);
    assert.doesNotMatch(output, /hidden/);
  }
});

test("subtitle exports omit skipped sections and shift retained timing", () => {
  const edited = {
    chunks: [
      { text: "cut", timestamp: [0, 1] as [number, number], disabled: true },
      { text: "keep", timestamp: [2, 3] as [number, number] },
      { text: "", timestamp: [3, 4] as [number, number] },
    ],
  };
  assert.equal(
    transcriptToSrt(edited),
    "1\n00:00:01,000 --> 00:00:02,000\nkeep\n",
  );
  assert.equal(
    transcriptToVtt(edited),
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nkeep\n",
  );
  assert.deepEqual(edited.chunks[1].timestamp, [2, 3]);
});

test("subtitle edits produce fresh cached phrases and preserve word styles", () => {
  const source = {
    chunks: [
      {
        text: "Original",
        timestamp: [0, 1] as [number, number],
        styleOverride: { color: "#ff0000" },
      },
    ],
  };
  const original = processTranscriptChunks(source, "phrase");
  const edited = {
    ...source,
    chunks: [{ ...source.chunks[0], text: "Edited" }],
  };
  assert.equal(processTranscriptChunks(edited, "phrase")[0].text, "Edited");
  assert.equal(original[0].text, "Original");
  assert.equal(
    processTranscriptChunks(edited, "word")[0].styleOverride?.color,
    "#ff0000",
  );
});

test("face tracking interpolation and portrait crop stay in bounds", () => {
  assert.equal(interpolateCenterX([], 1), 0.5);
  assert.equal(
    interpolateCenterX(
      [
        { time: 0, centerX: 0.2 },
        { time: 2, centerX: 0.8 },
      ],
      1,
    ),
    0.5,
  );
  assert.equal(computeCropX(0, 1920, 608), 0);
  assert.equal(computeCropX(1, 1920, 608), 1312);
});

test("turning crop tracking off keeps the crop still while face data changes", () => {
  const timeline = [
    { time: 0, centerX: 0.2 },
    { time: 2, centerX: 0.8 },
  ];
  const leftFace = interpolateCenterX(timeline, 0);
  const rightFace = interpolateCenterX(timeline, 2);
  assert.notEqual(leftFace, rightFace);
  assert.equal(computeCropX(leftFace, 1920, 608, false), 656);
  assert.equal(computeCropX(rightFace, 1920, 608, false), 656);
  assert.notEqual(
    computeCropX(leftFace, 1920, 608, true),
    computeCropX(rightFace, 1920, 608, true),
  );
  assert.notEqual(
    getAutoZoomTransform(0, 10, leftFace).x,
    getAutoZoomTransform(0, 10, rightFace).x,
  );
});

test("export face smoothing responds to elapsed time, not sample count", () => {
  const sparse = [
    { time: 0, centerX: 0.2 },
    { time: 0.5, centerX: 0.8 },
  ];
  const dense = [
    sparse[0],
    ...Array.from({ length: 5 }, (_, i) => ({
      time: (i + 1) / 10,
      centerX: 0.8,
    })),
  ];
  const original = structuredClone(sparse);
  assert.ok(
    Math.abs(
      smoothTimeline(sparse).at(-1)!.centerX -
        smoothTimeline(dense).at(-1)!.centerX,
    ) < 1e-10,
  );
  assert.deepEqual(sparse, original);
  assert.deepEqual(smoothTimeline([]), []);
});

test("sparse export scan keeps a moving face inside the portrait crop", () => {
  // Measured detector positions from the 640x360 moving-person WebM fixture.
  // A fixed 0.15 per sample left the face beyond the right crop edge at 4.8s.
  const centers = [
    0.26015625, 0.2640625, 0.2921875, 0.35234375, 0.40859375, 0.4796875,
    0.546875, 0.615625, 0.659375, 0.68828125, 0.69609375, 0.671875, 0.63046875,
    0.57421875, 0.50703125, 0.43515625, 0.37265625, 0.31484375, 0.2765625,
    0.25546875,
  ];
  const raw = centers.map((centerX, i) => ({ time: i / 2, centerX }));
  const smoothed = smoothTimeline(raw);
  const cropWidth = (360 * 9) / 16;
  for (let time = 0; time <= 9.5; time += 0.1) {
    const facePixel = interpolateCenterX(raw, time) * 640;
    const cropX = computeCropX(
      interpolateCenterX(smoothed, time + 0.15),
      640,
      cropWidth,
    );
    // Keep space on both sides of the face center throughout both directions.
    assert.ok(facePixel - cropX > 55, `Face too far left at ${time}`);
    assert.ok(
      facePixel - cropX < cropWidth - 55,
      `Face too far right at ${time}`,
    );
  }
});

test("auto zoom handles invalid inputs and keeps cuts ordered", () => {
  assert.deepEqual(getAutoZoomTransform(NaN, 10), { scale: 1, x: 0, y: 0 });
  const schedule = createAutoZoomCutSchedule([NaN, 12, 6, 19], 25);
  assert.equal(schedule[0], 0);
  assert.ok(
    schedule.every(
      (time, i) => time < 25 && (i === 0 || time > schedule[i - 1]),
    ),
  );
  assert.ok(Number.isFinite(getAutoZoomTransform(8, 25, NaN, schedule).x));
});
