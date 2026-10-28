/**
 * Error classification and the failure budget for background removal.
 *
 * Two failure modes must never share a message:
 *
 * - **Load failures** mean no model/provider could be initialised. That is the
 *   only case where a hardware hint is accurate.
 * - **Frame failures** are per-frame inference errors. Carry-forward masks make
 *   them survivable, so they must not surface as "unsupported device".
 *
 * Frame failures also have their own budget: a constrained CPU/WASM session can
 * hiccup intermittently without invalidating the run. Only a long consecutive
 * streak (a dead session) or a high overall failure share abandons the job.
 */

export type BgRemovalErrorKind = "load" | "frames" | "runtime";

export interface BgRemovalErrorDetails {
  failedFrames?: number;
  totalFrames?: number;
}

export class BgRemovalError extends Error {
  readonly kind: BgRemovalErrorKind;
  readonly failedFrames: number | null;
  readonly totalFrames: number | null;

  constructor(
    kind: BgRemovalErrorKind,
    message: string,
    details: BgRemovalErrorDetails = {},
  ) {
    super(message || "Background removal failed without an error message.");
    this.name = "BgRemovalError";
    this.kind = kind;
    this.failedFrames = details.failedFrames ?? null;
    this.totalFrames = details.totalFrames ?? null;
  }
}

const EMPTY_MESSAGE = "The model failed without an error message.";

/**
 * Read a useful message out of anything a model runtime might throw.
 *
 * ONNX Runtime and transformers.js do not always throw `Error` instances —
 * WebGPU buffer failures can arrive as strings or plain objects, and some
 * rejections carry an empty message. Returning "Unknown error occurred" for
 * those hides the one detail that makes a bug report actionable.
 */
export function workerErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error.trim() || EMPTY_MESSAGE;
  }
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message) return message;
    const name = error.name?.trim();
    return name && name !== "Error"
      ? `${name} without an error message.`
      : EMPTY_MESSAGE;
  }
  if (typeof error === "object" && error !== null) {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    } catch {
      return EMPTY_MESSAGE;
    }
  }
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return `The model failed (${String(error)}).`;
  }
  return EMPTY_MESSAGE;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const MAX_DETAIL_LENGTH = 180;

function detail(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "";
  const short =
    trimmed.length > MAX_DETAIL_LENGTH
      ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…`
      : trimmed;
  return ` (${short})`;
}

/**
 * Convert a pipeline error into a message the user can act on.
 *
 * Runtime failures deliberately do not suggest a hardware limitation: the
 * model already loaded, so the hardware is demonstrably capable of running it.
 */
export function describeBgRemovalError(error: unknown): string {
  if (isAbortError(error)) {
    return "Background removal was cancelled.";
  }

  if (error instanceof BgRemovalError) {
    switch (error.kind) {
      case "load":
        return `The background model could not be loaded. Try Person mode or Fast quality.${detail(error.message)}`;
      case "frames": {
        const counts =
          error.failedFrames !== null && error.totalFrames !== null
            ? ` (${error.failedFrames} of ${error.totalFrames} frames)`
            : "";
        return `Background analysis could not process enough frames${counts}. Try Fast quality or Person mode.`;
      }
      case "runtime":
        return `Background removal stopped unexpectedly.${detail(error.message)}`;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return `Background removal failed: ${error.message.trim()}`;
  }
  return `Background removal failed: ${workerErrorMessage(error)}`;
}

/** Share of sampled frames that may fall back before a run is abandoned. */
export const MAX_FAILURE_RATIO = 0.6;

/** Short clips are never abandoned for a ratio alone. */
export const MIN_FAILURE_TOLERANCE = 24;

/** A streak this long means the session is unusable, not a hiccup. */
export const MAX_CONSECUTIVE_FAILURES = 30;

export function failureLimitFor(totalFrames: number): number {
  const frames = Math.max(0, Math.floor(totalFrames));
  return Math.max(MIN_FAILURE_TOLERANCE, Math.ceil(frames * MAX_FAILURE_RATIO));
}

export interface FrameFailureState {
  failures: number;
  consecutiveFailures: number;
  totalFrames: number;
}

/**
 * Whether the run is broken enough to stop.
 *
 * Individual failures are always survivable — the store carries the previous
 * matte forward (or uses an opaque placeholder before the first success).
 */
export function shouldAbortForFailures(state: FrameFailureState): boolean {
  if (state.totalFrames <= 0) return false;
  return (
    state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
    state.failures > failureLimitFor(state.totalFrames)
  );
}
