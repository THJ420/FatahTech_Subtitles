/**
 * The contract between `app/bg-removal-worker.ts` and
 * `hooks/useBackgroundRemoval.ts`.
 *
 * The worker used to be the only place that knew the message shapes, so a
 * mismatch between the two sides was invisible until runtime — a WASM
 * downgrade reported itself as webGPU because one side compared
 * `"modnet/wasm"` against the literal `"wasm"` and the other did not.
 *
 * Both sides now share these constants and parsers, so the shape is checked
 * by the compiler and by the test suite instead of by luck.
 */

import type { BgDevice, BgModelId } from "@/lib/bg-models";

export const BG_WORKER_STATUS = {
  loading: "loading",
  ready: "ready",
  deviceChanged: "device-changed",
  maskReady: "mask-ready",
  frameError: "frame-error",
  fatal: "fatal",
} as const;

export type BgWorkerStatus =
  (typeof BG_WORKER_STATUS)[keyof typeof BG_WORKER_STATUS];

const WORKER_STATUSES: ReadonlySet<string> = new Set(
  Object.values(BG_WORKER_STATUS),
);

export function isBgWorkerStatus(value: unknown): value is BgWorkerStatus {
  return typeof value === "string" && WORKER_STATUSES.has(value);
}

/**
 * Which half of the progressive run a frame belongs to.
 *
 * `coarse` builds the quick preview; `refine` fills the samples the coarse
 * pass skipped. The worker resets its temporal state at the boundary so the
 * jump in sample indices is not mistaken for motion.
 */
export type BgPass = "coarse" | "refine";

/** Messages the main thread sends to the worker. */
export const BG_WORKER_REQUEST = {
  load: "load",
  configure: "configure",
  processFrame: "process-frame",
  release: "release",
} as const;

export type BgWorkerRequest =
  (typeof BG_WORKER_REQUEST)[keyof typeof BG_WORKER_REQUEST];

/** The model and device actually in use after a load or a downgrade. */
export interface BgWorkerModelInfo {
  modelId: BgModelId;
  device: BgDevice;
}

function readModelInfo(
  record: Record<string, unknown>,
): BgWorkerModelInfo | null {
  const modelId = record.modelId;
  const device = record.device;
  if (modelId !== "birefnet-lite" && modelId !== "modnet") return null;
  if (device !== "webgpu" && device !== "wasm") return null;
  return { modelId, device };
}

/**
 * Read the `ready` message.
 *
 * Returns null when the message is not a well-formed `ready`, so a malformed
 * or foreign message can never mark the model as loaded.
 */
export function parseWorkerReady(data: unknown): BgWorkerModelInfo | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.status !== BG_WORKER_STATUS.ready) return null;
  return readModelInfo(record);
}

export type BgWorkerFatalKind = "load" | "runtime";

export interface BgWorkerFatalInfo {
  message: string;
  kind: BgWorkerFatalKind;
}

/**
 * Read a `fatal` message.
 *
 * `load` means no model/provider could be initialised; `runtime` means the
 * worker died after a successful load. The distinction decides whether the UI
 * may mention hardware at all.
 */
export function parseWorkerFatal(data: unknown): BgWorkerFatalInfo | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.status !== BG_WORKER_STATUS.fatal) return null;

  const rawMessage = record.data;
  return {
    message:
      typeof rawMessage === "string" && rawMessage.trim()
        ? rawMessage.trim()
        : "The background worker failed without a message.",
    // Older workers sent no kind; every fatal they emitted was a load failure.
    kind: record.kind === "runtime" ? "runtime" : "load",
  };
}

/**
 * Read the `device-changed` message.
 *
 * The structured `modelId`/`device` fields are authoritative. The `from`/`to`
 * strings are display-only and are of the form `"modnet/wasm"` — comparing
 * `to` against the literal `"wasm"` is the bug this parser exists to prevent.
 */
export function parseWorkerDeviceChange(
  data: unknown,
): (BgWorkerModelInfo & { from: string; to: string }) | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.status !== BG_WORKER_STATUS.deviceChanged) return null;

  const info = readModelInfo(record);
  if (!info) return null;

  return {
    ...info,
    from: typeof record.from === "string" ? record.from : "",
    to: typeof record.to === "string" ? record.to : "",
  };
}
