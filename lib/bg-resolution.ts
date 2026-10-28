/**
 * Input profile selection for background models on constrained providers.
 *
 * BiRefNet's native input is 1024x1024. On WebGPU that is fine; on the WASM/CPU
 * execution provider it is the difference between a usable frame and an
 * out-of-memory or shape failure. The CPU path therefore runs a 512x512
 * compatibility profile when the graph allows it.
 *
 * The ONNX graph is the source of truth. Runtime metadata reports spatial dims
 * as the actual fixed size, or <= 0 when dynamic. If the graph is fixed at
 * 1024, a 512 tensor cannot work — the only safe answer is to stop trying
 * BiRefNet on this provider and fall back, with a visible notice.
 */

import type { BgDevice, BgModelId } from "@/lib/bg-models";

/** Safe BiRefNet input short side for WASM/CPU. */
export const CPU_COMPAT_INPUT_SIZE = 512;

export function modelInputSizeFor(
  modelId: BgModelId,
  device: BgDevice,
  nativeSize: number,
): number {
  return modelId === "birefnet-lite" && device === "wasm"
    ? CPU_COMPAT_INPUT_SIZE
    : nativeSize;
}

/**
 * Whether an ONNX graph accepts a square input of `size`.
 *
 * Looks at the last two dimensions (height, width). A dimension <= 0 is
 * dynamic, which accepts any size. Missing or short metadata is treated as
 * "unknown" so the caller attempts the profile and lets frame recovery handle
 * a rejection.
 */
export function graphSupportsSquareInput(
  shape: readonly number[] | null | undefined,
  size: number,
): boolean {
  if (!shape || shape.length < 3) return true;
  const height = shape[shape.length - 2];
  const width = shape[shape.length - 1];
  return (height <= 0 || height === size) && (width <= 0 || width === size);
}

export interface BirefnetCpuProfile {
  /** Input size to configure the processor with. */
  inputSize: number;
  /** True when this is the reduced CPU profile rather than native 1024. */
  compatibilityMode: boolean;
  /**
   * The graph cannot accept the CPU profile. The caller should fall back to
   * MODNet rather than run BiRefNet at native 1024 on CPU.
   */
  fallbackToPerson: boolean;
}

/**
 * Pick the BiRefNet input profile for the CPU/WASM path.
 *
 * Dynamic or 512-capable graphs use the compatibility profile. A graph with a
 * fixed non-512 spatial shape is not safe on CPU; the caller must fall back.
 */
export function resolveBirefnetCpuProfile(
  graphShape: readonly number[] | null | undefined,
): BirefnetCpuProfile {
  const compatible = graphSupportsSquareInput(
    graphShape,
    CPU_COMPAT_INPUT_SIZE,
  );
  return {
    inputSize: CPU_COMPAT_INPUT_SIZE,
    compatibilityMode: true,
    fallbackToPerson: !compatible,
  };
}
