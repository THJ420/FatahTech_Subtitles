import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampProgressPercent,
  ModelDownloadTracker,
} from "../lib/transcription-progress";

const encoder = "onnx/encoder_model.onnx";
const decoder = "onnx/decoder_model_merged_q4.onnx";

test("one percent remains one percent rather than completing the progress bar", () => {
  assert.equal(clampProgressPercent(1), 1);
  assert.equal(clampProgressPercent(0.5), 1);
  assert.equal(clampProgressPercent(NaN), 0);
  assert.equal(clampProgressPercent(150), 100);
});

test("a completed config file does not imply that model weights have loaded", () => {
  const tracker = new ModelDownloadTracker();
  tracker.update({
    status: "progress",
    file: "config.json",
    loaded: 1000,
    total: 1000,
    progress: 100,
  });
  const state = tracker.update({ status: "done", file: "config.json" });
  assert.equal(state.phase, "checking");
  assert.equal(state.progress, null);
  assert.equal(state.loadedBytes, 0);
});

test("download progress is weighted by file bytes, not the furthest file percentage", () => {
  const tracker = new ModelDownloadTracker();
  tracker.update({
    status: "progress",
    file: encoder,
    loaded: 100,
    total: 100,
  });
  assert.equal(
    tracker.update({ status: "done", file: encoder }).progress,
    null,
  );
  const state = tracker.update({
    status: "progress",
    file: decoder,
    loaded: 9,
    total: 900,
    progress: 1,
  });
  assert.equal(state.progress, 11);
  assert.equal(state.loadedBytes, 109);
  assert.equal(state.totalBytes, 1000);
  assert.equal(state.phase, "downloading");
});

test("unknown content lengths do not create false 100 percent downloads", () => {
  const tracker = new ModelDownloadTracker();
  tracker.update({
    status: "progress",
    file: encoder,
    loaded: 100,
    total: 100,
    progress: 100,
  });
  tracker.update({
    status: "progress",
    file: decoder,
    loaded: 100,
    total: 100,
    progress: 100,
  });
  let state = tracker.snapshot();
  assert.equal(state.phase, "downloading");
  assert.equal(state.progress, null);
  assert.equal(state.totalBytes, null);
  state = tracker.update({
    status: "progress",
    file: decoder,
    loaded: 200,
    total: 200,
    progress: 100,
  });
  assert.equal(state.progress, null);
  assert.equal(state.loadedBytes, 300);
});

test("download completion transitions to indeterminate initialization, not readiness", () => {
  const tracker = new ModelDownloadTracker();
  tracker.update({
    status: "progress",
    file: encoder,
    loaded: 100,
    total: 100,
  });
  tracker.update({ status: "done", file: encoder });
  tracker.update({
    status: "progress",
    file: decoder,
    loaded: 900,
    total: 900,
  });
  const state = tracker.update({ status: "done", file: decoder });
  assert.equal(state.phase, "initializing");
  assert.equal(state.progress, null);
  assert.equal(state.loadedBytes, 1000);
  assert.equal(state.completedFiles, 2);
  assert.equal(tracker.update({ status: "ready" }).phase, "initializing");
  assert.equal(tracker.setPhase("warming").progress, null);
  assert.equal(tracker.setPhase("ready").phase, "ready");
});

test("a fallback starts fresh file accounting for its different model files", () => {
  const gpu = new ModelDownloadTracker();
  gpu.update({ status: "done", file: encoder });
  gpu.update({ status: "done", file: decoder });
  const cpu = new ModelDownloadTracker();
  assert.equal(cpu.snapshot().phase, "checking");
  assert.equal(cpu.snapshot().loadedBytes, 0);
  assert.equal(cpu.snapshot().progress, null);
  cpu.update({
    status: "progress",
    file: "onnx/encoder_model_quantized.onnx",
    loaded: 10,
    total: 100,
  });
  const state = cpu.update({
    status: "progress",
    file: "onnx/decoder_model_merged_quantized.onnx",
    loaded: 10,
    total: 100,
  });
  assert.equal(state.progress, 10);
});
