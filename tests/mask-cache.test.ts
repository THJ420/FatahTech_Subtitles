import "fake-indexeddb/auto";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMaskCache,
  closeMaskCacheConnection,
  isValidMaskCacheRecord,
  maskCacheKey,
  readMaskCache,
  writeMaskCache,
  type MaskCacheIdentity,
} from "../lib/mask-cache";
import {
  MaskStore,
  createFallbackMask,
  type MaskMeta,
  type MaskStorePlan,
} from "../lib/mask-store";

const META: Omit<MaskMeta, "linkable"> = {
  coverage: 0.25,
  centroidX: 0.5,
  centroidY: 0.5,
  chinY: 0.3,
  lowConfidence: false,
  synthetic: false,
};

const PLAN: MaskStorePlan = {
  width: 8,
  height: 8,
  sampleFps: 8,
  totalFrames: 20,
  bytesPerFrame: 64,
  bytes: 20 * 64,
  degraded: false,
};

const IDENTITY: MaskCacheIdentity = {
  fileSize: 1_234_567,
  durationSeconds: 2.5,
  modelId: "modnet",
  sampleFps: 8,
  maskWidth: 8,
  maskHeight: 8,
};

function makeSnapshot() {
  const store = new MaskStore(PLAN);
  store.put(0, new Uint8Array(PLAN.bytesPerFrame).fill(40), META);
  store.put(4, new Uint8Array(PLAN.bytesPerFrame).fill(200), META);
  const fallback = createFallbackMask(PLAN, null);
  store.put(2, fallback.alpha, fallback.meta);
  return store.snapshot();
}

beforeEach(async () => {
  await clearMaskCache();
});

after(async () => {
  await closeMaskCacheConnection();
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

test("the cache key is a composite of all five identity fields", () => {
  assert.equal(maskCacheKey(IDENTITY), "1234567:2500:modnet:8:8x8");

  const variants: MaskCacheIdentity[] = [
    { ...IDENTITY, fileSize: IDENTITY.fileSize + 1 },
    { ...IDENTITY, durationSeconds: 3 },
    { ...IDENTITY, modelId: "birefnet-lite" },
    { ...IDENTITY, sampleFps: 6 },
    { ...IDENTITY, maskWidth: 16 },
    { ...IDENTITY, maskHeight: 16 },
  ];
  for (const variant of variants) {
    assert.notEqual(
      maskCacheKey(variant),
      maskCacheKey(IDENTITY),
      `${JSON.stringify(variant)} must miss`,
    );
  }
});

test("sub-millisecond and sub-fps noise does not split the cache", () => {
  assert.equal(
    maskCacheKey({ ...IDENTITY, durationSeconds: 2.5004 }),
    maskCacheKey(IDENTITY),
  );
  assert.equal(
    maskCacheKey({ ...IDENTITY, sampleFps: 8.0004 }),
    maskCacheKey(IDENTITY),
  );
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test("a written snapshot is readable and restores mask lookups", async () => {
  const snapshot = makeSnapshot();
  const written = await writeMaskCache({
    identity: IDENTITY,
    device: "wasm",
    snapshot,
  });
  assert.equal(written, true);

  const record = await readMaskCache(IDENTITY);
  assert.ok(record);
  assert.equal(record.key, maskCacheKey(IDENTITY));
  assert.equal(record.device, "wasm");
  assert.equal(record.plan.totalFrames, PLAN.totalFrames);
  assert.equal(record.storedCount, 3);

  const restored = MaskStore.fromSnapshot({
    plan: record.plan,
    slab: record.slab,
    occupied: record.occupied,
    metas: record.metas,
    storedCount: record.storedCount,
  });
  assert.ok(restored);
  assert.deepEqual(restored.getAt(0)?.data, new Uint8Array(64).fill(40));
  assert.deepEqual(restored.getAt(0.5)?.data, new Uint8Array(64).fill(200));
  assert.equal(restored.getAt(0.25)?.meta.synthetic, true);
});

test("a fractional sample rate round-trips through the cache", async () => {
  const plan: MaskStorePlan = {
    ...PLAN,
    sampleFps: 3.333333,
    totalFrames: 9,
    bytes: 9 * 64,
  };
  const store = new MaskStore(plan);
  store.put(0, new Uint8Array(64).fill(77), META);
  const identity = { ...IDENTITY, sampleFps: plan.sampleFps };

  assert.equal(
    await writeMaskCache({
      identity,
      device: "wasm",
      snapshot: store.snapshot(),
    }),
    true,
  );
  const record = await readMaskCache(identity);
  assert.ok(record);
  assert.equal(record.sampleFps, plan.sampleFps);
  assert.equal(record.plan.sampleFps, plan.sampleFps);
});

test("a different identity misses every time", async () => {
  await writeMaskCache({
    identity: IDENTITY,
    device: "webgpu",
    snapshot: makeSnapshot(),
  });

  const misses: MaskCacheIdentity[] = [
    { ...IDENTITY, fileSize: IDENTITY.fileSize + 1 },
    { ...IDENTITY, durationSeconds: 3 },
    { ...IDENTITY, modelId: "birefnet-lite" },
    { ...IDENTITY, sampleFps: 6 },
    { ...IDENTITY, maskWidth: 16 },
  ];
  for (const identity of misses) {
    assert.equal(await readMaskCache(identity), null);
  }
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test("one entry per file: a new model setting replaces the old slab", async () => {
  const first = { ...IDENTITY };
  const second = { ...IDENTITY, modelId: "birefnet-lite" as const };

  await writeMaskCache({
    identity: first,
    device: "wasm",
    snapshot: makeSnapshot(),
  });
  assert.ok(await readMaskCache(first));

  await writeMaskCache({
    identity: second,
    device: "wasm",
    snapshot: makeSnapshot(),
  });
  assert.equal(await readMaskCache(first), null);
  assert.ok(await readMaskCache(second));
});

test("a different file is not evicted", async () => {
  const other = {
    ...IDENTITY,
    fileSize: IDENTITY.fileSize + 10,
    durationSeconds: 4,
  };

  await writeMaskCache({
    identity: IDENTITY,
    device: "wasm",
    snapshot: makeSnapshot(),
  });
  await writeMaskCache({
    identity: other,
    device: "wasm",
    snapshot: makeSnapshot(),
  });

  assert.ok(await readMaskCache(IDENTITY));
  assert.ok(await readMaskCache(other));
});

test("clearing the cache removes every entry", async () => {
  await writeMaskCache({
    identity: IDENTITY,
    device: "wasm",
    snapshot: makeSnapshot(),
  });
  await clearMaskCache();
  assert.equal(await readMaskCache(IDENTITY), null);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a corrupt record is rejected", async () => {
  await writeMaskCache({
    identity: IDENTITY,
    device: "wasm",
    snapshot: makeSnapshot(),
  });
  const record = await readMaskCache(IDENTITY);
  assert.ok(record);
  assert.equal(isValidMaskCacheRecord(record, IDENTITY), true);

  const invalid = [
    { ...record, version: 0 },
    { ...record, key: "wrong" },
    { ...record, fileSize: 1 },
    { ...record, sampleFps: 6 },
    { ...record, device: "cuda" },
    { ...record, slab: new ArrayBuffer(4) },
    { ...record, occupied: new Uint8Array(1) },
    { ...record, metas: [] },
    { ...record, plan: { ...record.plan, totalFrames: 0 } },
    { ...record, plan: { ...record.plan, bytes: 1 } },
  ];
  for (const value of invalid) {
    assert.equal(isValidMaskCacheRecord(value, IDENTITY), false);
  }
});
