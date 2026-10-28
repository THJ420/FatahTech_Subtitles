import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BgRemovalError,
  MAX_CONSECUTIVE_FAILURES,
  MIN_FAILURE_TOLERANCE,
  describeBgRemovalError,
  failureLimitFor,
  isAbortError,
  shouldAbortForFailures,
  workerErrorMessage,
} from "../lib/bg-errors";

// ---------------------------------------------------------------------------
// Worker messages
// ---------------------------------------------------------------------------

test("plain errors keep their message", () => {
  assert.equal(
    workerErrorMessage(new Error("WASM out of memory")),
    "WASM out of memory",
  );
});

test("errors with no message fall back to a useful name", () => {
  assert.equal(
    workerErrorMessage(new Error("")),
    "The model failed without an error message.",
  );
  assert.equal(
    workerErrorMessage(new TypeError("")),
    "TypeError without an error message.",
  );
});

test("string and object rejections are surfaced", () => {
  assert.equal(
    workerErrorMessage("WebGPU buffer allocation failed"),
    "WebGPU buffer allocation failed",
  );
  assert.equal(
    workerErrorMessage({ message: "Compute pass failed" }),
    "Compute pass failed",
  );
});

test("empty or opaque rejections never say Unknown error occurred", () => {
  for (const value of ["", "   ", null, undefined, {}, { message: 42 }]) {
    const message = workerErrorMessage(value);
    assert.ok(message.length > 0);
    assert.doesNotMatch(message, /Unknown error occurred/);
  }
});

test("primitive rejections include the value", () => {
  assert.match(workerErrorMessage(0), /\(0\)/);
  assert.match(workerErrorMessage(false), /\(false\)/);
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test("a load failure is the only message that mentions hardware", () => {
  const message = describeBgRemovalError(
    new BgRemovalError("load", "no WebGPU adapter"),
  );

  assert.match(message, /could not be loaded/);
  assert.match(message, /Person mode|Fast quality/);
  assert.match(message, /no WebGPU adapter/);
});

test("a frame-budget failure reports counts and suggests a faster tier", () => {
  const message = describeBgRemovalError(
    new BgRemovalError("frames", "too many failures", {
      failedFrames: 31,
      totalFrames: 100,
    }),
  );

  assert.match(message, /31 of 100 frames/);
  assert.match(message, /Fast quality/);
  assert.doesNotMatch(message, /requires WebGPU or WASM support/);
});

test("a runtime failure never blames the hardware", () => {
  const message = describeBgRemovalError(
    new BgRemovalError("runtime", "Unknown error occurred"),
  );

  assert.match(message, /stopped unexpectedly/);
  assert.match(message, /Unknown error occurred/);
  assert.doesNotMatch(message, /requires WebGPU or WASM support/);
  assert.doesNotMatch(message, /could not be loaded/);
});

test("unclassified errors are still described without a hardware claim", () => {
  const message = describeBgRemovalError(
    new Error("Could not decode this video"),
  );

  assert.match(message, /Could not decode this video/);
  assert.doesNotMatch(message, /requires WebGPU or WASM support/);
});

test("abort errors are reported as cancellations", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";

  assert.equal(isAbortError(abort), true);
  assert.equal(
    describeBgRemovalError(abort),
    "Background removal was cancelled.",
  );
});

// ---------------------------------------------------------------------------
// Failure budget
// ---------------------------------------------------------------------------

test("short clips tolerate every frame failing", () => {
  assert.equal(failureLimitFor(10), MIN_FAILURE_TOLERANCE);
  assert.equal(
    shouldAbortForFailures({
      failures: 10,
      consecutiveFailures: 10,
      totalFrames: 10,
    }),
    false,
  );
});

test("a long run aborts only past the adaptive limit", () => {
  const totalFrames = 100;
  assert.equal(failureLimitFor(totalFrames), 60);

  assert.equal(
    shouldAbortForFailures({
      failures: 60,
      consecutiveFailures: 5,
      totalFrames,
    }),
    false,
  );
  assert.equal(
    shouldAbortForFailures({
      failures: 61,
      consecutiveFailures: 5,
      totalFrames,
    }),
    true,
  );
});

test("a dead session aborts on the consecutive streak first", () => {
  assert.equal(
    shouldAbortForFailures({
      failures: MAX_CONSECUTIVE_FAILURES,
      consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      totalFrames: 1000,
    }),
    true,
  );
});

test("a run with no frames never aborts", () => {
  assert.equal(
    shouldAbortForFailures({
      failures: 5,
      consecutiveFailures: 5,
      totalFrames: 0,
    }),
    false,
  );
});
