import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getModelLoadingErrorMessage,
  isModelNetworkError,
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
