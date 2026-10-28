import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CPU_COMPAT_INPUT_SIZE,
  graphSupportsSquareInput,
  modelInputSizeFor,
  resolveBirefnetCpuProfile,
} from "../lib/bg-resolution";

test("BiRefNet uses 512 on WASM and native 1024 on WebGPU", () => {
  assert.equal(
    modelInputSizeFor("birefnet-lite", "wasm", 1024),
    CPU_COMPAT_INPUT_SIZE,
  );
  assert.equal(modelInputSizeFor("birefnet-lite", "webgpu", 1024), 1024);
});

test("MODNet keeps its native 512 input on both providers", () => {
  assert.equal(modelInputSizeFor("modnet", "wasm", 512), 512);
  assert.equal(modelInputSizeFor("modnet", "webgpu", 512), 512);
});

test("dynamic spatial dimensions accept the CPU profile", () => {
  assert.equal(graphSupportsSquareInput([1, 3, -1, -1], 512), true);
  assert.equal(graphSupportsSquareInput([1, 3, 0, 0], 512), true);
  assert.equal(graphSupportsSquareInput([1, 3, -1, 1024], 512), false);
});

test("fixed spatial dimensions must match exactly", () => {
  assert.equal(graphSupportsSquareInput([1, 3, 512, 512], 512), true);
  assert.equal(graphSupportsSquareInput([1, 3, 1024, 1024], 512), false);
  assert.equal(graphSupportsSquareInput([1, 3, 256, 256], 512), false);
});

test("missing metadata is treated as unknown, not incompatible", () => {
  assert.equal(graphSupportsSquareInput(null, 512), true);
  assert.equal(graphSupportsSquareInput(undefined, 512), true);
  assert.equal(graphSupportsSquareInput([1, 3], 512), true);
});

test("a dynamic or 512 graph uses the CPU compatibility profile", () => {
  assert.deepEqual(resolveBirefnetCpuProfile([1, 3, -1, -1]), {
    inputSize: 512,
    compatibilityMode: true,
    fallbackToPerson: false,
  });
  assert.deepEqual(resolveBirefnetCpuProfile([1, 3, 512, 512]), {
    inputSize: 512,
    compatibilityMode: true,
    fallbackToPerson: false,
  });
});

test("a fixed 1024 graph requests a person-model fallback", () => {
  assert.deepEqual(resolveBirefnetCpuProfile([1, 3, 1024, 1024]), {
    inputSize: 512,
    compatibilityMode: true,
    fallbackToPerson: true,
  });
});

test("unknown metadata still attempts the 512 profile", () => {
  assert.deepEqual(resolveBirefnetCpuProfile(null), {
    inputSize: 512,
    compatibilityMode: true,
    fallbackToPerson: false,
  });
});
