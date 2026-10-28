/**
 * Background-removal model registry and device tiering.
 *
 * The pipeline used to hard-code `Xenova/modnet`, a portrait-matting network.
 * It does not segment "the salient object", it segments "the person" — so a
 * product, a pet or a vehicle produced a near-empty matte and the frame
 * composited to pure background fill.
 *
 * The replacement is a salient-object model. Two facts constrain the choice:
 *
 * - **Licence.** `briaai/RMBG-1.4` is the obvious pick on quality and size, but
 *   its weights are licensed for non-commercial use only. `ISNet-ONNX` is
 *   AGPL-3.0, which is worse for a web app. BiRefNet is MIT.
 * - **Size.** The full `BiRefNet-ONNX` is 467MB fp16 — too heavy to ship to a
 *   browser. `BiRefNet_lite-ONNX` is 109MB.
 *
 * `BiRefNet_lite-ONNX` declares `"model_type": "swin"` in its config, which
 * transformers.js would resolve to a Swin encoder with no segmentation head.
 * `configModelType` carries the override that makes it load as the generic
 * ONNX session wrapper. Verified against `@huggingface/transformers` 3.7.3:
 * the graph's input is `input_image` (not `pixel_values`) and its output is
 * `output_image`, emitting raw logits in roughly [-28, 20].
 *
 * The quality model is ~4x the compute of MODNet (1024² vs a 512 shortest
 * edge). On a CPU-only device that is minutes per clip, so the tiering below is
 * a correctness requirement rather than an optimisation.
 */

import type { HardwareCapabilities } from "@/lib/hardware-check";

export type BgModelId = "birefnet-lite" | "modnet";

export type BgDevice = "webgpu" | "wasm";

export type BgDtype = "fp32" | "fp16" | "q8";

export interface BgModel {
  id: BgModelId;
  label: string;
  hfId: string;
  /** Overrides `config.json`'s `model_type` when the repo declares it wrongly. */
  configModelType?: string;
  /** Square input the processor resizes to. */
  inputSize: number;
  /**
   * `logits` means the graph output must be sigmoided before use.
   * `alpha` means the graph already emits 0–1 opacity.
   */
  outputKind: "logits" | "alpha";
  dtypeByDevice: Record<BgDevice, BgDtype>;
  /** Cannot run on the CPU path in any usable time. */
  requiresWebGPU: boolean;
  approxDownloadMB: number;
  license: string;
}

export const BG_MODELS: readonly BgModel[] = [
  {
    id: "birefnet-lite",
    label: "Any subject",
    hfId: "onnx-community/BiRefNet_lite-ONNX",
    configModelType: "birefnet",
    inputSize: 1024,
    outputKind: "logits",
    dtypeByDevice: { webgpu: "fp16", wasm: "fp32" },
    requiresWebGPU: true,
    approxDownloadMB: 109,
    license: "MIT",
  },
  {
    id: "modnet",
    label: "Person (fast)",
    hfId: "Xenova/modnet",
    inputSize: 512,
    outputKind: "alpha",
    // onnxruntime-web's CPU execution provider does not support fp16 at all.
    dtypeByDevice: { webgpu: "fp32", wasm: "fp32" },
    requiresWebGPU: false,
    approxDownloadMB: 25,
    license: "Apache-2.0",
  },
];

/** Minimum GPU buffer headroom for the 109MB fp16 graph plus activations. */
const MIN_BUFFER_BYTES = 256 * 1024 * 1024;

/** Below this, a 1024² model plus the rest of the editor is a memory risk. */
const MIN_DEVICE_MEMORY_GB = 4;

export interface BgModelSelection {
  model: BgModel;
  device: BgDevice;
  /**
   * Human-readable reason the quality model was not used. Null when it was.
   * Shown in the settings panel so the downgrade is never silent.
   */
  fallbackReason: string | null;
  /**
   * The model the user explicitly chose, or null when the automatic tiering
   * picked it. The worker must never silently swap a forced model.
   */
  override: BgModelId | null;
  /**
   * Non-blocking warning about running a forced model on this hardware. The
   * choice is honoured regardless; this only sets expectations.
   */
  hardwareWarning: string | null;
}

export function getBgModel(id: BgModelId): BgModel {
  const model = BG_MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`Unknown background model: ${id}`);
  return model;
}

/**
 * Choose the best model this device can actually run.
 *
 * Unknown capability values never block — `null` means "no signal", matching
 * the convention in `lib/hardware-check.ts`.
 *
 * `modelOverride` is an explicit user choice. It bypasses every hardware gate:
 * the requested model always comes back, on the best device that can host it.
 * A warning is attached when that device is a poor fit so the UI can say so.
 */
export function selectBgModel(
  capabilities: HardwareCapabilities,
  modelOverride: BgModelId | null = null,
): BgModelSelection {
  if (modelOverride) {
    return selectForcedModel(capabilities, getBgModel(modelOverride));
  }

  const quality = getBgModel("birefnet-lite");
  const fallback = getBgModel("modnet");

  const downgrade = (reason: string): BgModelSelection => ({
    model: fallback,
    device: "wasm",
    fallbackReason: reason,
    override: null,
    hardwareWarning: null,
  });

  if (!capabilities.webgpu) {
    return downgrade("WebGPU unavailable — using the fast person model.");
  }
  if (capabilities.supportsFp16 === false) {
    return downgrade("GPU lacks fp16 support — using the fast person model.");
  }
  if (
    capabilities.maxBufferSize !== null &&
    capabilities.maxBufferSize < MIN_BUFFER_BYTES
  ) {
    return downgrade("GPU buffer too small — using the fast person model.");
  }
  if (
    capabilities.deviceMemoryGB !== null &&
    capabilities.deviceMemoryGB < MIN_DEVICE_MEMORY_GB
  ) {
    return downgrade("Device memory too low — using the fast person model.");
  }

  return {
    model: quality,
    device: "webgpu",
    fallbackReason: null,
    override: null,
    hardwareWarning: null,
  };
}

function selectForcedModel(
  capabilities: HardwareCapabilities,
  model: BgModel,
): BgModelSelection {
  // BiRefNet's fp16 weights need shader-f16; without it the WebGPU EP cannot
  // run them, so a forced universal model falls back to the CPU provider.
  const webgpuUsable =
    capabilities.webgpu &&
    (model.id !== "birefnet-lite" || capabilities.supportsFp16 !== false);
  const device: BgDevice = webgpuUsable ? "webgpu" : "wasm";

  let hardwareWarning: string | null = null;
  if (model.id === "birefnet-lite") {
    if (!capabilities.webgpu) {
      hardwareWarning =
        "The universal model will try the CPU compatibility profile (512px). If this model cannot run it, the Person model will be used instead.";
    } else if (!webgpuUsable) {
      hardwareWarning =
        "This GPU cannot run fp16 weights. The universal model will try the CPU compatibility profile (512px), falling back to the Person model if needed.";
    } else if (
      (capabilities.maxBufferSize !== null &&
        capabilities.maxBufferSize < MIN_BUFFER_BYTES) ||
      (capabilities.deviceMemoryGB !== null &&
        capabilities.deviceMemoryGB < MIN_DEVICE_MEMORY_GB)
    ) {
      hardwareWarning =
        "This device is below the recommended memory for the universal model. Long clips may fail.";
    }
  }

  return {
    model,
    device,
    fallbackReason: null,
    override: model.id,
    hardwareWarning,
  };
}

export interface LoadedModelState {
  ready: boolean;
  loadedModelId: BgModelId | null;
  /** The explicit override that produced the session, if any. */
  loadedFromOverride: BgModelId | null;
}

/**
 * Whether the worker's existing session can serve `selection`.
 *
 * A different model must reload — reusing the session would silently ignore
 * the user's choice. The one exception is an automatic selection whose
 * preferred model already fell back during load: re-attempting it on every run
 * would reload a model this device has rejected.
 */
export function shouldReuseLoadedModel(
  state: LoadedModelState,
  selection: BgModelSelection | null,
): boolean {
  if (!state.ready) return false;
  if (!selection) return true;
  if (state.loadedModelId === selection.model.id) return true;
  // The explicit choice already resolved to this session (possibly through a
  // compatibility fallback). Retrying it every run would reload a model this
  // device has already rejected.
  if (
    selection.override !== null &&
    state.loadedFromOverride === selection.override
  ) {
    return true;
  }
  return selection.override === null && state.loadedFromOverride === null;
}

/** dtype to request for a model on a given device. */
export function dtypeFor(model: BgModel, device: BgDevice): BgDtype {
  // The app always requests "webgpu" or "wasm"; a stray value would otherwise
  // produce `undefined`, which onnxruntime-web rejects. Default to fp32, the
  // only dtype the CPU/WASM path can run.
  return model.dtypeByDevice[device] ?? "fp32";
}
