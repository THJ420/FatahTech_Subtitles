import { test } from "node:test";
import assert from "node:assert/strict";
import type { HardwareCapabilities } from "../lib/hardware-check";
import {
  BG_MODELS,
  dtypeFor,
  getBgModel,
  selectBgModel,
  shouldReuseLoadedModel,
} from "../lib/bg-models";

const CAPABLE: HardwareCapabilities = {
  webgpu: true,
  maxBufferSize: 2 * 1024 * 1024 * 1024,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  hardwareConcurrency: 8,
  deviceMemoryGB: 16,
  supportsFp16: true,
};

test("a capable device gets the salient-object model", () => {
  const selection = selectBgModel(CAPABLE);

  assert.equal(selection.model.id, "birefnet-lite");
  assert.equal(selection.device, "webgpu");
  assert.equal(selection.fallbackReason, null);
  assert.equal(selection.override, null);
  assert.equal(selection.hardwareWarning, null);
});

test("no WebGPU falls back to the fast person model", () => {
  const selection = selectBgModel({
    ...CAPABLE,
    webgpu: false,
    maxBufferSize: null,
    supportsFp16: null,
  });

  assert.equal(selection.model.id, "modnet");
  assert.equal(selection.device, "wasm");
  assert.match(selection.fallbackReason ?? "", /WebGPU/);
});

test("a GPU without fp16 falls back instead of failing at load", () => {
  const selection = selectBgModel({ ...CAPABLE, supportsFp16: false });

  assert.equal(selection.model.id, "modnet");
  assert.match(selection.fallbackReason ?? "", /fp16/);
});

test("a small GPU buffer falls back", () => {
  const selection = selectBgModel({
    ...CAPABLE,
    maxBufferSize: 64 * 1024 * 1024,
  });

  assert.equal(selection.model.id, "modnet");
  assert.match(selection.fallbackReason ?? "", /buffer/);
});

test("low system memory falls back", () => {
  const selection = selectBgModel({ ...CAPABLE, deviceMemoryGB: 2 });

  assert.equal(selection.model.id, "modnet");
  assert.match(selection.fallbackReason ?? "", /memory/);
});

test("unknown capability values never block the quality model", () => {
  // deviceMemory is Chromium-only and maxBufferSize can be unreported; an
  // absent signal must not be read as a failure.
  const selection = selectBgModel({
    ...CAPABLE,
    deviceMemoryGB: null,
    maxBufferSize: null,
    hardwareConcurrency: null,
  });

  assert.equal(selection.model.id, "birefnet-lite");
});

test("a forced universal model ignores every hardware gate", () => {
  const weak = {
    ...CAPABLE,
    webgpu: false,
    maxBufferSize: null,
    supportsFp16: null,
    deviceMemoryGB: 2,
  };
  const selection = selectBgModel(weak, "birefnet-lite");

  assert.equal(selection.model.id, "birefnet-lite");
  assert.equal(selection.device, "wasm");
  assert.equal(selection.override, "birefnet-lite");
  assert.equal(selection.fallbackReason, null);
  assert.match(selection.hardwareWarning ?? "", /CPU|WebGPU/);
});

test("a forced universal model uses the CPU without fp16", () => {
  const selection = selectBgModel(
    { ...CAPABLE, supportsFp16: false },
    "birefnet-lite",
  );

  assert.equal(selection.model.id, "birefnet-lite");
  assert.equal(selection.device, "wasm");
  assert.match(selection.hardwareWarning ?? "", /fp16/);
});

test("a forced universal model still warns about small memory", () => {
  const selection = selectBgModel(
    { ...CAPABLE, maxBufferSize: 64 * 1024 * 1024 },
    "birefnet-lite",
  );

  assert.equal(selection.model.id, "birefnet-lite");
  assert.equal(selection.device, "webgpu");
  assert.equal(selection.override, "birefnet-lite");
  assert.match(selection.hardwareWarning ?? "", /memory/);
});

test("a forced person model overrides the automatic quality pick", () => {
  const selection = selectBgModel(CAPABLE, "modnet");

  assert.equal(selection.model.id, "modnet");
  assert.equal(selection.device, "webgpu");
  assert.equal(selection.override, "modnet");
  assert.equal(selection.hardwareWarning, null);
});

test("a loaded session is reused only when it can serve the selection", () => {
  const quality = selectBgModel(CAPABLE);
  const person = selectBgModel(CAPABLE, "modnet");
  const weak = selectBgModel({
    ...CAPABLE,
    webgpu: false,
    maxBufferSize: null,
    supportsFp16: null,
  });

  assert.equal(
    shouldReuseLoadedModel(
      {
        ready: true,
        loadedModelId: "birefnet-lite",
        loadedFromOverride: null,
      },
      quality,
    ),
    true,
    "the same model is always reusable",
  );

  assert.equal(
    shouldReuseLoadedModel(
      { ready: true, loadedModelId: "modnet", loadedFromOverride: null },
      quality,
    ),
    true,
    "an automatic selection may reuse its load-time fallback",
  );

  assert.equal(
    shouldReuseLoadedModel(
      {
        ready: true,
        loadedModelId: "birefnet-lite",
        loadedFromOverride: "birefnet-lite",
      },
      person,
    ),
    false,
    "an explicit model change must reload",
  );

  assert.equal(
    shouldReuseLoadedModel(
      {
        ready: true,
        loadedModelId: "modnet",
        loadedFromOverride: "birefnet-lite",
      },
      selectBgModel(CAPABLE, "birefnet-lite"),
    ),
    true,
    "a forced model that already resolved to a fallback is reused",
  );

  assert.equal(
    shouldReuseLoadedModel(
      {
        ready: true,
        loadedModelId: "birefnet-lite",
        loadedFromOverride: "birefnet-lite",
      },
      weak,
    ),
    false,
    "switching from a forced model back to automatic re-runs tiering",
  );

  assert.equal(
    shouldReuseLoadedModel(
      { ready: false, loadedModelId: null, loadedFromOverride: null },
      null,
    ),
    false,
    "nothing is reused before the model is ready",
  );

  assert.equal(
    shouldReuseLoadedModel(
      { ready: true, loadedModelId: "modnet", loadedFromOverride: null },
      null,
    ),
    true,
    "a caller without a preference uses the loaded session",
  );
});

test("fp16 is never requested on the CPU path", () => {
  for (const model of BG_MODELS) {
    assert.notEqual(
      dtypeFor(model, "wasm"),
      "fp16",
      `${model.id} must not request fp16 on wasm`,
    );
  }
});

test("the quality model declares the config override it needs", () => {
  const quality = getBgModel("birefnet-lite");

  // Its config.json says model_type "swin", which would resolve to an encoder
  // with no segmentation head.
  assert.equal(quality.configModelType, "birefnet");
  assert.equal(quality.outputKind, "logits");
});

test("every registered model carries a permissive licence", () => {
  for (const model of BG_MODELS) {
    assert.ok(
      ["MIT", "Apache-2.0"].includes(model.license),
      `${model.id} has a licence that needs review: ${model.license}`,
    );
  }
});
