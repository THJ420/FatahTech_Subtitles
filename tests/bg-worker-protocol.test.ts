import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BG_WORKER_REQUEST,
  BG_WORKER_STATUS,
  isBgWorkerStatus,
  parseWorkerDeviceChange,
  parseWorkerFatal,
  parseWorkerReady,
} from "../lib/bg-worker-protocol";

/**
 * The worker and the hook used to hard-code the message shapes independently.
 * A WASM downgrade therefore reported itself as webGPU: one side compared the
 * display string "modnet/wasm" against the literal "wasm", and the other sent
 * a bare device field. These tests pin the shared contract.
 */

test("a downgrade to MODNet on WASM is reported as wasm, not webgpu", () => {
  const change = parseWorkerDeviceChange({
    status: BG_WORKER_STATUS.deviceChanged,
    from: "birefnet-lite/webgpu",
    to: "modnet/wasm",
    modelId: "modnet",
    device: "wasm",
  });

  assert.ok(change);
  assert.equal(change.device, "wasm");
  assert.equal(change.modelId, "modnet");
});

test("the display string alone cannot be mistaken for the device", () => {
  // "modnet/wasm" is a compound label, not a device. A parser that inferred
  // the device from it would get this wrong.
  const change = parseWorkerDeviceChange({
    status: BG_WORKER_STATUS.deviceChanged,
    from: "birefnet-lite/webgpu",
    to: "modnet/wasm",
    modelId: "modnet",
    device: "wasm",
  });

  assert.ok(change);
  assert.notEqual(change.device, change.to);
});

test("a device change without structured fields is rejected", () => {
  const change = parseWorkerDeviceChange({
    status: BG_WORKER_STATUS.deviceChanged,
    from: "birefnet-lite/webgpu",
    to: "modnet/wasm",
  });

  assert.equal(change, null);
});

test("a device change for an unknown device is rejected", () => {
  const change = parseWorkerDeviceChange({
    status: BG_WORKER_STATUS.deviceChanged,
    from: "birefnet-lite/webgpu",
    to: "modnet/wasm",
    modelId: "modnet",
    device: "cuda",
  });

  assert.equal(change, null);
});

test("a device change for an unknown model is rejected", () => {
  const change = parseWorkerDeviceChange({
    status: BG_WORKER_STATUS.deviceChanged,
    modelId: "sam-2",
    device: "wasm",
  });

  assert.equal(change, null);
});

test("a ready message carries the model and device", () => {
  const info = parseWorkerReady({
    status: BG_WORKER_STATUS.ready,
    modelId: "birefnet-lite",
    device: "webgpu",
  });

  assert.deepEqual(info, { modelId: "birefnet-lite", device: "webgpu" });
});

test("a ready message missing its device is rejected", () => {
  const info = parseWorkerReady({
    status: BG_WORKER_STATUS.ready,
    modelId: "birefnet-lite",
  });

  assert.equal(info, null);
});

test("a ready message for an unknown model is rejected", () => {
  const info = parseWorkerReady({
    status: BG_WORKER_STATUS.ready,
    modelId: "rmbg-1-4",
    device: "webgpu",
  });

  assert.equal(info, null);
});

test("a fatal load failure is classified as load-time", () => {
  const fatal = parseWorkerFatal({
    status: BG_WORKER_STATUS.fatal,
    kind: "load",
    data: "no WebGPU adapter and WASM init failed",
  });

  assert.deepEqual(fatal, {
    kind: "load",
    message: "no WebGPU adapter and WASM init failed",
  });
});

test("a fatal runtime failure is classified separately from load", () => {
  const fatal = parseWorkerFatal({
    status: BG_WORKER_STATUS.fatal,
    kind: "runtime",
    data: "worker crashed",
  });

  assert.equal(fatal?.kind, "runtime");
});

test("a fatal message without a kind defaults to load", () => {
  // Every fatal emitted before the kind field existed was a load failure.
  const fatal = parseWorkerFatal({
    status: BG_WORKER_STATUS.fatal,
    data: "",
  });

  assert.equal(fatal?.kind, "load");
  assert.ok(fatal?.message);
});

test("non-fatal messages are not parsed as fatal", () => {
  for (const data of [
    null,
    {},
    { status: BG_WORKER_STATUS.ready },
    { status: BG_WORKER_STATUS.frameError, data: "boom" },
  ]) {
    assert.equal(parseWorkerFatal(data), null);
  }
});

test("transformers.js progress events are not mistaken for worker messages", () => {
  // The worker's progress callback forwards raw transformers.js objects,
  // which also carry a `status` field.
  for (const status of ["initiate", "download", "progress", "done"]) {
    assert.equal(isBgWorkerStatus(status), false);
    assert.equal(parseWorkerReady({ status }), null);
    assert.equal(parseWorkerDeviceChange({ status }), null);
  }
});

test("every worker status is recognised as one", () => {
  for (const status of Object.values(BG_WORKER_STATUS)) {
    assert.equal(isBgWorkerStatus(status), true);
  }
});

test("every worker request type is distinct", () => {
  const values = Object.values(BG_WORKER_REQUEST);
  assert.equal(new Set(values).size, values.length);
  assert.deepEqual(values.sort(), [
    "configure",
    "load",
    "process-frame",
    "release",
  ]);
});

test("a request type is never confused with a status", () => {
  for (const request of Object.values(BG_WORKER_REQUEST)) {
    assert.equal(isBgWorkerStatus(request), false);
  }
});
