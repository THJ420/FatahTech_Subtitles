/**
 * Client hardware capability detection.
 *
 * Whisper model sizes span ~75 MB to ~1.5 GB of ONNX weights. Loading a model
 * that exceeds the device's WebGPU buffer limit or system memory fails deep
 * inside ONNX Runtime — after a long download and with an opaque error. This
 * module answers "can this device run this model?" *before* any download
 * starts, so the UI can disable the choice up front.
 *
 * Every probe is defensive: WebGPU is absent on Firefox and Safari, and
 * `navigator.deviceMemory` is Chromium-only and absent elsewhere. An unknown
 * value must never be reported as a failure, so missing signals are treated
 * as "no constraint" rather than "unsupported".
 */

export type ModelSize = "tiny" | "base" | "small" | "turbo" | "medium";

const BYTES_PER_MB = 1024 * 1024;

export interface ModelCapability {
  supported: boolean;
  /** Short, user-facing explanation shown on the disabled option. */
  reason?: string;
}

export interface HardwareCapabilities {
  /** `navigator.gpu` exists *and* an adapter could be acquired. */
  webgpu: boolean;
  /** GPUSupportedLimits.maxBufferSize, in bytes. Null when WebGPU is absent. */
  maxBufferSize: number | null;
  /** GPUSupportedLimits.maxStorageBufferBindingSize, in bytes. */
  maxStorageBufferBindingSize: number | null;
  /** navigator.hardwareConcurrency — logical CPU cores. */
  hardwareConcurrency: number | null;
  /** navigator.deviceMemory in GB. `undefined` on Firefox/Safari. */
  deviceMemoryGB: number | null;
  /**
   * WebGPU `shader-f16` feature. `null` when unknown (no adapter, or an
   * adapter that does not expose a feature set).
   */
  supportsFp16: boolean | null;
}

/** dtype values this app may request from Transformers.js. */
export type ModelDtype = "fp32" | "fp16" | "q4";

/**
 * Per-path minimum `maxBufferSize` in MB, derived from real ONNX weight sizes
 * in the published repos (encoder + q4 decoder, plus headroom for
 * activations). Keyed by fp16 support because the fallback encoder is far
 * smaller than the fp16 one.
 */
export interface ModelFootprintMB {
  /** With `shader-f16`: fp16 encoder + q4 decoder. */
  fp16: number;
  /** Without `shader-f16`: q4 encoder + q4 decoder. */
  fallback: number;
}

export interface ModelRequirement {
  value: ModelSize;
  label: string;
  description: string;
  /** Approximate download size, for display only. */
  approxSizeMB: number;
  /** Model cannot run on the WASM/CPU path at all. */
  requiresWebGPU?: boolean;
  /** GPU weight footprint per fp16-support path. */
  footprintMB?: ModelFootprintMB;
  /** Minimum reported deviceMemory, in GB. Not enforced when unreported. */
  minDeviceMemoryGB?: number;
  /** Minimum logical cores for the WASM/CPU path. */
  minCores?: number;
}

/**
 * Eligibility per model size.
 *
 * Sizes below are measured from the `_timestamped` repos, not estimated.
 *
 * A note on the non-fp16 encoder choice: `fp32` looks like the safe default,
 * but it is the worst option available. For Large-v3-Turbo the fp32 encoder is
 * 2,430 MB of external `.onnx_data` plus a q4 decoder — ~2,750 MB of weights.
 * That is precisely the hardware class this fallback exists for (GTX 10-series
 * and older integrated GPUs have 2–4 GB of VRAM shared with the compositor),
 * so fp32 would trade a clear "no fp16" error for an out-of-memory crash after
 * a multi-GB download. `q4` is ~3.4x smaller, needs no f16 arithmetic (weights
 * dequantize to fp32 on load), and fits.
 */
export const MODEL_REQUIREMENTS: readonly ModelRequirement[] = [
  {
    value: "tiny",
    label: "Tiny (~75MB)",
    description: "Fastest, lower accuracy",
    approxSizeMB: 75,
  },
  {
    value: "base",
    label: "Base (~150MB)",
    description: "Balanced speed & accuracy",
    approxSizeMB: 150,
  },
  {
    value: "small",
    label: "Small (~500MB)",
    description: "Most accurate, slower",
    approxSizeMB: 500,
    minCores: 4,
    minDeviceMemoryGB: 4,
  },
  {
    value: "turbo",
    label: "Turbo (~800MB)",
    description: "Best speed/accuracy, GPU only",
    approxSizeMB: 800,
    requiresWebGPU: true,
    // fp16: 1,215 MB encoder + 319 MB decoder. q4: 405 MB + 319 MB.
    footprintMB: { fp16: 2048, fallback: 1024 },
  },
  {
    value: "medium",
    label: "Medium (~1.5GB)",
    description: "Highest accuracy, GPU only",
    approxSizeMB: 1500,
    requiresWebGPU: true,
    // fp16: 586 MB encoder + 448 MB decoder. q4: 200 MB + 448 MB.
    footprintMB: { fp16: 1280, fallback: 896 },
    minDeviceMemoryGB: 8,
  },
];

export const MODEL_SIZES: readonly ModelSize[] = MODEL_REQUIREMENTS.map(
  (requirement) => requirement.value,
);

export function getModelRequirement(
  modelSize: ModelSize,
): ModelRequirement | undefined {
  return MODEL_REQUIREMENTS.find((entry) => entry.value === modelSize);
}

/** Models that cannot run on the WASM/CPU path. */
export function requiresWebGPU(modelSize: ModelSize): boolean {
  return getModelRequirement(modelSize)?.requiresWebGPU ?? false;
}

/**
 * Encoder dtype for a model on the WebGPU path.
 *
 * `shader-f16` is an optional WebGPU feature. GTX 10-series and several
 * Intel/AMD integrated GPUs do not implement it, and ONNX Runtime rejects an
 * fp16 graph up front with "The device (webgpu) does not support fp16." Rather
 * than fail, fall back to a 4-bit encoder — 4-bit weights dequantize to fp32 on
 * load, so no f16 arithmetic is involved. `fp32` is deliberately avoided: it is
 * larger than fp16 (2,430 MB for Turbo) and would OOM the very GPUs this
 * fallback targets.
 *
 * The small models keep their existing fp32 encoder: it is tiny, and fp32 is the
 * best-validated dtype for them on WebGPU.
 *
 * Note `q4f16` is never used here — that dtype itself requires `shader-f16`.
 */
export function getEncoderDtype(
  modelSize: ModelSize,
  supportsFp16: boolean,
): ModelDtype {
  if (modelSize !== "turbo" && modelSize !== "medium") return "fp32";
  return supportsFp16 ? "fp16" : "q4";
}

/**
 * Pure evaluator — no browser access, so this is unit-testable and safe to
 * call during server rendering.
 */
export function evaluateModelCapability(
  requirement: ModelRequirement,
  capabilities: HardwareCapabilities,
): ModelCapability {
  if (requirement.requiresWebGPU && !capabilities.webgpu) {
    return { supported: false, reason: "WebGPU required" };
  }

  if (requirement.footprintMB) {
    // Gate against the footprint of the path this device will actually take.
    // Without fp16 the q4 encoder is used, so the requirement is lower.
    const useFp16 = capabilities.supportsFp16 === true;
    const requiredMB = useFp16
      ? requirement.footprintMB.fp16
      : requirement.footprintMB.fallback;
    const limit = capabilities.maxBufferSize;
    // An unknown limit means the adapter exposed none. Treat it as unmet rather
    // than letting a multi-hundred-MB load fail later with an opaque error.
    if (limit === null) {
      return { supported: false, reason: "GPU buffer limit unknown" };
    }
    if (limit < requiredMB * BYTES_PER_MB) {
      const haveMB = Math.round(limit / BYTES_PER_MB);
      return {
        supported: false,
        reason: `Needs ${requiredMB} MB GPU buffer (have ${haveMB} MB)`,
      };
    }
  }

  // deviceMemory is unreported on Firefox/Safari. Absent means "unknown", and
  // an unknown value must not block the user.
  if (
    requirement.minDeviceMemoryGB !== undefined &&
    capabilities.deviceMemoryGB !== null &&
    capabilities.deviceMemoryGB < requirement.minDeviceMemoryGB
  ) {
    return {
      supported: false,
      reason: `Needs ${requirement.minDeviceMemoryGB} GB system memory`,
    };
  }

  if (
    requirement.minCores !== undefined &&
    capabilities.hardwareConcurrency !== null &&
    capabilities.hardwareConcurrency < requirement.minCores
  ) {
    return {
      supported: false,
      reason: `Needs ${requirement.minCores}+ CPU cores`,
    };
  }

  return { supported: true };
}

/** `navigator.deviceMemory` is Chromium-only and absent from lib.dom types. */
interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

interface GpuLimitsLike {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

interface GpuAdapterLike {
  limits?: GpuLimitsLike;
  /** GPUSupportedFeatures — a Set-like of adapter-supported features. */
  features?: { has: (feature: string) => boolean };
}

interface GpuLike {
  requestAdapter?: () => Promise<GpuAdapterLike | null>;
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Probe the current device. Always resolves — a failed probe reports the
 * lowest common denominator (no WebGPU) rather than throwing.
 */
export async function detectHardwareCapabilities(): Promise<HardwareCapabilities> {
  if (typeof navigator === "undefined") {
    return {
      webgpu: false,
      maxBufferSize: null,
      maxStorageBufferBindingSize: null,
      hardwareConcurrency: null,
      deviceMemoryGB: null,
      supportsFp16: null,
    };
  }

  const nav = navigator as NavigatorWithDeviceMemory;
  const hardwareConcurrency = positiveOrNull(nav.hardwareConcurrency);
  const deviceMemoryGB = positiveOrNull(nav.deviceMemory);

  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      webgpu: false,
      maxBufferSize: null,
      maxStorageBufferBindingSize: null,
      hardwareConcurrency,
      deviceMemoryGB,
      supportsFp16: null,
    };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return {
        webgpu: false,
        maxBufferSize: null,
        maxStorageBufferBindingSize: null,
        hardwareConcurrency,
        deviceMemoryGB,
        supportsFp16: null,
      };
    }
    // Limits are lazily computed; read defensively.
    const limits = adapter.limits ?? {};
    // `shader-f16` gates fp16 WebGPU shaders. Treat a missing feature set as
    // "not supported" rather than assuming fp16 is safe.
    const supportsFp16 = adapter.features
      ? adapter.features.has("shader-f16")
      : false;
    return {
      webgpu: true,
      maxBufferSize: positiveOrNull(limits.maxBufferSize),
      maxStorageBufferBindingSize: positiveOrNull(
        limits.maxStorageBufferBindingSize,
      ),
      hardwareConcurrency,
      deviceMemoryGB,
      supportsFp16,
    };
  } catch {
    // Adapter request can throw when GPU access is blocked or unstable.
    return {
      webgpu: false,
      maxBufferSize: null,
      maxStorageBufferBindingSize: null,
      hardwareConcurrency,
      deviceMemoryGB,
      supportsFp16: null,
    };
  }
}

/**
 * Eligibility for every model size on this device. The record always covers
 * every size so callers can render the full list without missing keys.
 */
export async function checkModelCapabilities(): Promise<
  Record<ModelSize, ModelCapability>
> {
  const capabilities = await detectHardwareCapabilities();
  const result = {} as Record<ModelSize, ModelCapability>;
  for (const requirement of MODEL_REQUIREMENTS) {
    result[requirement.value] = evaluateModelCapability(
      requirement,
      capabilities,
    );
  }
  return result;
}

/** Largest model this device can load, used to cap the default selection. */
export function pickDefaultModelSize(
  capabilities: Record<ModelSize, ModelCapability>,
): ModelSize {
  for (let index = MODEL_REQUIREMENTS.length - 1; index >= 0; index -= 1) {
    const requirement = MODEL_REQUIREMENTS[index];
    if (capabilities[requirement.value]?.supported) return requirement.value;
  }
  return "tiny";
}
