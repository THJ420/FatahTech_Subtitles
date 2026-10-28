/**
 * Persistent cache for computed alpha-mask slabs.
 *
 * Inference is the expensive part of background removal; the resulting mask
 * store is device-independent data. IndexedDB lets a re-opened clip restore
 * the same masks without re-running a model.
 *
 * Entries are keyed by `(file size, duration, model, sample fps, mask size)`.
 * That is deliberately narrow: a cache hit is only valid for the exact source
 * and mask plan that produced it. One entry is retained per source file
 * (size + duration); writing a new model/quality combination replaces the
 * older entry so a large slab cannot accumulate indefinitely.
 *
 * The cache is best-effort. Private browsing, quota limits, and missing
 * IndexedDB all degrade to a miss; they must never break a run.
 */

import type { BgDevice, BgModelId } from "@/lib/bg-models";
import type {
  MaskMeta,
  MaskStorePlan,
  MaskStoreSnapshot,
} from "@/lib/mask-store";

export const MASK_CACHE_FORMAT_VERSION = 1;

const DB_NAME = "fatahtech-mask-cache";
const DB_VERSION = 1;
const STORE_NAME = "masks";

export interface MaskCacheIdentity {
  fileSize: number;
  durationSeconds: number;
  modelId: BgModelId;
  sampleFps: number;
  maskWidth: number;
  maskHeight: number;
}

export interface MaskCacheRecord {
  key: string;
  version: number;
  fileSize: number;
  durationMs: number;
  modelId: BgModelId;
  sampleFps: number;
  maskWidth: number;
  maskHeight: number;
  device: BgDevice | null;
  createdAt: number;
  plan: MaskStorePlan;
  slab: ArrayBuffer;
  occupied: Uint8Array;
  metas: (MaskMeta | null)[];
  storedCount: number;
}

export interface MaskCacheWriteInput {
  identity: MaskCacheIdentity;
  device: BgDevice | null;
  snapshot: MaskStoreSnapshot;
}

function durationMsFor(durationSeconds: number): number {
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  return Math.max(0, Math.round(duration * 1000));
}

/** Round fractional sample rates so equivalent plans never split the cache. */
function fpsForKey(sampleFps: number): number {
  const fps = Number.isFinite(sampleFps) ? sampleFps : 0;
  return Math.max(0, Math.round(fps * 1000) / 1000);
}

/** Composite cache key: `fileSize:durationMs:model:fps:widthxheight`. */
export function maskCacheKey(identity: MaskCacheIdentity): string {
  return [
    Math.max(0, Math.round(identity.fileSize)),
    durationMsFor(identity.durationSeconds),
    identity.modelId,
    fpsForKey(identity.sampleFps),
    `${Math.max(0, Math.round(identity.maskWidth))}x${Math.max(
      0,
      Math.round(identity.maskHeight),
    )}`,
  ].join(":");
}

function isDevice(value: unknown): value is BgDevice | null {
  return value === null || value === "webgpu" || value === "wasm";
}

/**
 * Validate a cached record against the identity that produced the lookup.
 *
 * Records can outlive a schema change or be corrupted by an interrupted write;
 * treating any mismatch as a miss keeps a bad record out of the compositor.
 */
export function isValidMaskCacheRecord(
  value: unknown,
  identity: MaskCacheIdentity,
): value is MaskCacheRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MaskCacheRecord>;

  if (record.version !== MASK_CACHE_FORMAT_VERSION) return false;
  if (record.key !== maskCacheKey(identity)) return false;
  if (record.fileSize !== Math.max(0, Math.round(identity.fileSize)))
    return false;
  if (record.durationMs !== durationMsFor(identity.durationSeconds))
    return false;
  if (record.modelId !== identity.modelId) return false;
  if (
    typeof record.sampleFps !== "number" ||
    !Number.isFinite(record.sampleFps) ||
    fpsForKey(record.sampleFps) !== fpsForKey(identity.sampleFps)
  ) {
    return false;
  }
  if (
    record.maskWidth !== Math.max(0, Math.round(identity.maskWidth)) ||
    record.maskHeight !== Math.max(0, Math.round(identity.maskHeight))
  ) {
    return false;
  }
  if (!isDevice(record.device)) return false;

  const plan = record.plan;
  if (!plan || typeof plan !== "object") return false;
  if (
    plan.width !== record.maskWidth ||
    plan.height !== record.maskHeight ||
    plan.sampleFps !== record.sampleFps ||
    plan.totalFrames <= 0 ||
    plan.bytesPerFrame <= 0 ||
    plan.bytesPerFrame !== plan.width * plan.height ||
    plan.totalFrames * plan.bytesPerFrame !== plan.bytes
  ) {
    return false;
  }

  if (!(record.slab instanceof ArrayBuffer)) return false;
  if (record.slab.byteLength !== plan.totalFrames * plan.bytesPerFrame) {
    return false;
  }
  if (
    !(record.occupied instanceof Uint8Array) ||
    record.occupied.length !== plan.totalFrames
  ) {
    return false;
  }
  if (
    !Array.isArray(record.metas) ||
    record.metas.length !== plan.totalFrames
  ) {
    return false;
  }
  if (
    typeof record.storedCount !== "number" ||
    record.storedCount < 0 ||
    record.storedCount > plan.totalFrames
  ) {
    return false;
  }
  for (let index = 0; index < plan.totalFrames; index++) {
    if (record.occupied[index] && !record.metas[index]) return false;
  }

  return true;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function indexedDbFactory(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

function openMaskCacheDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  const factory = indexedDbFactory();
  if (!factory) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      dbPromise = null;
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      resolve(null);
    };
    request.onblocked = () => {
      dbPromise = null;
      resolve(null);
    };
  });

  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("IndexedDB transaction aborted.", "AbortError"),
      );
  });
}

export async function readMaskCache(
  identity: MaskCacheIdentity,
): Promise<MaskCacheRecord | null> {
  const key = maskCacheKey(identity);
  const db = await openMaskCacheDb();
  if (!db) return null;

  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    void done.catch(() => {});
    const value = await requestResult(
      transaction.objectStore(STORE_NAME).get(key),
    );
    await done;
    return isValidMaskCacheRecord(value, identity) ? value : null;
  } catch (error) {
    console.warn("[mask-cache] Could not read cached masks:", error);
    return null;
  }
}

export async function writeMaskCache({
  identity,
  device,
  snapshot,
}: MaskCacheWriteInput): Promise<boolean> {
  const key = maskCacheKey(identity);
  const record: MaskCacheRecord = {
    key,
    version: MASK_CACHE_FORMAT_VERSION,
    fileSize: Math.max(0, Math.round(identity.fileSize)),
    durationMs: durationMsFor(identity.durationSeconds),
    modelId: identity.modelId,
    // Keep the planner's raw rate; the key and comparison normalize it.
    sampleFps: snapshot.plan.sampleFps,
    maskWidth: Math.max(0, Math.round(identity.maskWidth)),
    maskHeight: Math.max(0, Math.round(identity.maskHeight)),
    device,
    createdAt: Date.now(),
    plan: { ...snapshot.plan },
    slab: snapshot.slab,
    occupied: snapshot.occupied,
    metas: snapshot.metas,
    storedCount: snapshot.storedCount,
  };

  if (!isValidMaskCacheRecord(record, identity)) return false;

  const db = await openMaskCacheDb();
  if (!db) return false;

  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => {});
    const store = transaction.objectStore(STORE_NAME);
    const putRequest = store.put(record);
    const keysRequest = store.getAllKeys();
    const [, keys] = await Promise.all([
      requestResult(putRequest),
      requestResult(keysRequest),
    ]);

    // One cached analysis per source file. A new model/quality combination
    // replaces the previous slab instead of doubling storage.
    const prefix = `${record.fileSize}:${record.durationMs}:`;
    for (const existingKey of keys) {
      if (
        typeof existingKey === "string" &&
        existingKey !== record.key &&
        existingKey.startsWith(prefix)
      ) {
        store.delete(existingKey);
      }
    }

    await done;
    return true;
  } catch (error) {
    console.warn("[mask-cache] Could not write cached masks:", error);
    return false;
  }
}

export async function deleteMaskCacheKeys(
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const db = await openMaskCacheDb();
  if (!db) return;

  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => {});
    const store = transaction.objectStore(STORE_NAME);
    for (const key of new Set(keys)) store.delete(key);
    await done;
  } catch (error) {
    console.warn("[mask-cache] Could not delete cached masks:", error);
  }
}

export async function clearMaskCache(): Promise<void> {
  const db = await openMaskCacheDb();
  if (!db) return;

  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => {});
    transaction.objectStore(STORE_NAME).clear();
    await done;
  } catch (error) {
    console.warn("[mask-cache] Could not clear cached masks:", error);
  }
}

/** Close the cached connection. Used by tests and page teardown. */
export async function closeMaskCacheConnection(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    const db = await pending;
    db?.close();
  } catch {
    /* the open already failed */
  }
}
