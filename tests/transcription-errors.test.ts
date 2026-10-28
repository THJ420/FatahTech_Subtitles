import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getModelLoadingErrorMessage,
  isModelNetworkError,
  serializeTranscriptionError,
  type TranscriptionErrorDetails,
} from "../lib/transcription-errors";

test("model network errors explain manual retry without discarding the local video", () => {
  for (const error of [
    new TypeError("network error"),
    new TypeError("Failed to fetch"),
    new Error("NetworkError when attempting to fetch resource."),
    new Error("Network request failed"),
    new TypeError("Load failed"),
    "Uncaught TypeError: Load failed",
    new DOMException("", "NetworkError"),
  ]) {
    assert.equal(isModelNetworkError(error), true);
    const message = getModelLoadingErrorMessage(error);
    assert.match(message, /speech model files could not be loaded/);
    assert.match(message, /Generate subtitles to try again/);
    assert.match(message, /video stays on your device/);
  }
});

test("a network failure mentioning a WebGPU module is still a network error", () => {
  const error = new Error(
    "no available backend found. [webgpu] TypeError: Failed to fetch dynamically imported module: ort-wasm-simd-threaded.webgpu.mjs",
  );
  assert.equal(isModelNetworkError(error), true);
  assert.match(getModelLoadingErrorMessage(error), /internet connection/);
});

test("GPU, model, and audio failures are not mislabeled as network errors", () => {
  for (const error of [
    new Error("GPUDevice createBuffer failed: out of memory"),
    new Error("WebGPU backend load failed"),
    new Error("Could not locate model file"),
    new DOMException("Unable to decode audio data", "EncodingError"),
  ]) {
    assert.equal(isModelNetworkError(error), false);
    assert.equal(getModelLoadingErrorMessage(error), error.message);
  }
});

test("offline guidance requires reconnecting unless the complete model and runtime are cached", () => {
  const error = new Error("Speech asset request failed", {
    cause: new TypeError("Failed to fetch"),
  });
  const message = getModelLoadingErrorMessage(error, { online: false });

  assert.match(message, /appear to be offline/);
  assert.match(message, /Reconnect to download missing files/);
  assert.match(message, /complete model and runtime to have been cached/);
  assert.match(message, /Generate subtitles to try again/);
  assert.match(message, /video stays on your device/);

  for (const online of [true, undefined]) {
    const onlineMessage = getModelLoadingErrorMessage(error, { online });
    assert.doesNotMatch(onlineMessage, /appear to be offline/);
    assert.match(onlineMessage, /internet connection/);
    assert.match(onlineMessage, /Hugging Face downloads.*proxy or firewall/);
  }
});

test("nested runtime asset failures include deployment guidance, unlike model downloads", () => {
  for (const asset of [
    "ort-wasm-simd-threaded.webgpu.mjs",
    "/runtime/encoder.wasm",
    "dynamically imported module: /runtime/backend.mjs",
  ]) {
    const error = new Error("Speech asset request failed", {
      cause: new TypeError(`Failed to fetch ${asset}`),
    });
    const message = getModelLoadingErrorMessage(error);

    assert.match(message, /speech runtime could not load/);
    assert.match(message, /Reload the page/);
    assert.match(
      message,
      /deployed runtime assets return JavaScript\/WASM, not a 404 page/,
    );
  }

  assert.doesNotMatch(
    getModelLoadingErrorMessage(new TypeError("Failed to fetch model.onnx")),
    /speech runtime could not load/,
  );
});

test("HTTP and timeout causes are network failures even inside WebGPU backend errors", () => {
  for (const cause of [
    new Error("HTTP 401 Unauthorized"),
    new Error("HTTP 404 Not Found"),
    new Error("HTTP 503 Service Unavailable"),
    new Error("Model download timeout"),
    new Error("The request timed out"),
  ]) {
    const error = new Error("no available backend found. [webgpu]", {
      cause: new Error("Speech asset request failed", { cause }),
    });

    assert.equal(isModelNetworkError(cause), true, cause.message);
    assert.equal(isModelNetworkError(error), true, cause.message);
    const message = getModelLoadingErrorMessage(error);
    assert.match(message, /speech model files could not be loaded/);
    assert.match(message, /internet connection/);
    assert.doesNotMatch(message, /no available backend|webgpu/i);
  }
});

test("nested parser failures explain proxy HTML and inspecting errors before clearing cache", () => {
  for (const cause of [
    new SyntaxError("Unexpected token '<' in model config"),
    new Error("invalid JSON in model config"),
    new Error("invalid protobuf in model weights"),
    new Error("Received HTML instead of a speech model/runtime asset"),
    new WebAssembly.CompileError("WebAssembly.compile(): expected magic word"),
  ]) {
    const error = new Error("Speech asset request failed", { cause });
    const message = getModelLoadingErrorMessage(error);

    assert.equal(isModelNetworkError(error), false, cause.message);
    assert.match(message, /model or runtime file could not be parsed/);
    assert.match(message, /proxy may have returned an HTML page/);
    assert.match(message, /cached file may be damaged/);
    assert.match(
      message,
      /console for the original error before clearing the affected model cache/,
    );
    assert.match(message, /Generate subtitles to try again/);
  }
});

test("nested storage failures take precedence over network guidance", () => {
  for (const cause of [
    new DOMException("Storage quota exhausted", "QuotaExceededError"),
    new Error("CacheStorage access denied"),
    new Error("The browser cache could not be read"),
  ]) {
    const error = new Error("Failed to fetch the speech model", { cause });
    const message = getModelLoadingErrorMessage(error, { online: false });

    assert.match(
      message,
      /Browser storage could not read or save the speech model/,
    );
    assert.match(message, /Allow site storage or free some disk space/);
    assert.match(message, /retry while online/);
    assert.doesNotMatch(message, /appear to be offline|proxy or firewall/);
  }
});

test("serialization preserves error names, messages, stacks, and non-Error causes", () => {
  const cause = new TypeError("Failed to fetch", {
    cause: "connection closed",
  });
  const error = new Error("Speech asset request failed", { cause });
  const details = serializeTranscriptionError(error);

  assert.ok(error.stack);
  assert.ok(cause.stack);
  assert.deepEqual(details, {
    name: "Error",
    message: error.message,
    stack: error.stack,
    cause: {
      name: "TypeError",
      message: cause.message,
      stack: cause.stack,
      cause: { name: "Error", message: "connection closed" },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(details)), details);
  assert.strictEqual(error.cause, cause);
});

test("serialization bounds long causal chains to the root and four causes", () => {
  const errors = Array.from(
    { length: 7 },
    (_, index) => new Error(`Cause ${index}`),
  );
  for (let index = 0; index < errors.length - 1; index++) {
    errors[index].cause = errors[index + 1];
  }

  let details: TranscriptionErrorDetails | undefined =
    serializeTranscriptionError(errors[0]);
  for (let depth = 0; depth < 5; depth++) {
    assert.ok(details);
    assert.equal(details.name, errors[depth].name);
    assert.equal(details.message, errors[depth].message);
    assert.equal(details.stack, errors[depth].stack);
    details = details.cause;
  }
  assert.equal(details, undefined);
  assert.strictEqual(errors[4].cause, errors[5]);
});

test("self-referencing and mutual causes serialize safely without changing the original cycle", () => {
  for (const errors of [
    [new Error("Speech model load failed")],
    [new Error("Speech model load failed"), new TypeError("Failed to fetch")],
  ]) {
    for (let index = 0; index < errors.length; index++) {
      errors[index].cause = errors[(index + 1) % errors.length];
    }

    const serialized = serializeTranscriptionError(errors[0]);
    assert.doesNotThrow(() => JSON.stringify(serialized));
    let details: TranscriptionErrorDetails | undefined = serialized;
    for (let depth = 0; depth < 5; depth++) {
      assert.ok(details);
      assert.equal(details.message, errors[depth % errors.length].message);
      details = details.cause;
    }
    assert.equal(details, undefined);
    assert.strictEqual(errors[errors.length - 1].cause, errors[0]);
    assert.equal(isModelNetworkError(errors[0]), errors.length === 2);
    if (errors.length === 2) {
      assert.match(
        getModelLoadingErrorMessage(errors[0]),
        /speech model files could not be loaded/,
      );
    } else {
      assert.equal(getModelLoadingErrorMessage(errors[0]), errors[0].message);
    }
  }
});
