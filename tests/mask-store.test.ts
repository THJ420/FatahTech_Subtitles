import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MASK_BUDGET_BYTES,
  MIN_SAMPLE_FPS,
  MaskStore,
  computeMaskSignature,
  createFallbackMask,
  fitMaskAspect,
  planMaskPasses,
  planMaskStore,
  planMaskStoreForQuality,
  signatureDistance,
} from "../lib/mask-store";

const META = {
  coverage: 0.25,
  centroidX: 0.5,
  centroidY: 0.5,
  chinY: 0.3,
  lowConfidence: false,
  synthetic: false,
};

function makeStore(duration: number) {
  const plan = planMaskStore(duration, 1920, 1080);
  return { plan, store: new MaskStore(plan) };
}

function fill(value: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

test("mask aspect follows the source orientation", () => {
  assert.deepEqual(fitMaskAspect(1920, 1080, 320), { width: 568, height: 320 });
  assert.deepEqual(fitMaskAspect(1080, 1920, 320), { width: 320, height: 568 });
  assert.deepEqual(fitMaskAspect(1000, 1000, 256), { width: 256, height: 256 });
});

test("mask dimensions are always even and at least 2", () => {
  for (const shortSide of [240, 256, 288, 320]) {
    const { width, height } = fitMaskAspect(1919, 1079, shortSide);
    assert.equal(width % 2, 0, `width ${width} must be even`);
    assert.equal(height % 2, 0, `height ${height} must be even`);
  }
});

test("a one-minute clip keeps a dense sample rate", () => {
  const plan = planMaskStore(60, 1920, 1080);

  assert.equal(plan.degraded, false);
  assert.equal(plan.sampleFps, 10);
  assert.equal(plan.totalFrames, 600);
  assert.ok(plan.bytes <= DEFAULT_MASK_BUDGET_BYTES);
});

test("a ten-minute clip steps down resolution instead of overrunning", () => {
  const plan = planMaskStore(600, 1920, 1080);

  assert.ok(plan.bytes <= DEFAULT_MASK_BUDGET_BYTES, "must stay inside budget");
  assert.ok(plan.sampleFps >= MIN_SAMPLE_FPS, "must stay temporally usable");
  assert.equal(plan.degraded, true);
  // Resolution has to give way, because rate alone cannot close the gap.
  assert.ok(plan.width < 568, `expected a smaller mask, got ${plan.width}`);
});

test("a thirty-minute clip still never exceeds the budget", () => {
  const plan = planMaskStore(1800, 1920, 1080);

  assert.ok(plan.bytes <= DEFAULT_MASK_BUDGET_BYTES);
  assert.ok(plan.totalFrames > 0);
  assert.equal(plan.degraded, true);
});

test("the budget is respected across a wide range of durations", () => {
  for (const duration of [1, 5, 30, 90, 91, 120, 300, 600, 1200, 3600]) {
    for (const budget of [
      32 * 1024 * 1024,
      64 * 1024 * 1024,
      DEFAULT_MASK_BUDGET_BYTES,
    ]) {
      const plan = planMaskStore(duration, 1920, 1080, budget);
      assert.ok(
        plan.bytes <= budget,
        `duration=${duration} budget=${budget} used=${plan.bytes}`,
      );
      // A tiny budget may only afford a fractional rate, or nothing at all.
      // What must never happen is a plan that claims frames it cannot store.
      if (plan.totalFrames > 0) {
        assert.ok(plan.sampleFps > 0, "frames require a positive sample rate");
        assert.ok(
          plan.totalFrames * plan.bytesPerFrame <= budget,
          "stored bytes must match the plan",
        );
      }
    }
  }
});

test("an invalid duration produces an empty store rather than throwing", () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const plan = planMaskStore(duration, 1920, 1080);
    if (Number.isFinite(duration) && duration > 0) continue;
    assert.equal(plan.totalFrames, 0);
    assert.equal(plan.bytes, 0);
  }
});

test("a portrait source produces a portrait mask", () => {
  const plan = planMaskStore(30, 1080, 1920);
  assert.ok(plan.height > plan.width, "portrait source must give a tall mask");
});

// ---------------------------------------------------------------------------
// Manual quality tiers
// ---------------------------------------------------------------------------

test("the fast tier honours 384px at 6fps when it fits", () => {
  const plan = planMaskStoreForQuality(30, 1920, 1080, {
    shortSide: 384,
    sampleFps: 6,
    budgetBytes: 128 * 1024 * 1024,
  });

  assert.equal(plan.width, 682);
  assert.equal(plan.height, 384);
  assert.equal(plan.sampleFps, 6);
  assert.equal(plan.degraded, false);
});

test("the balanced tier honours 512px at 8fps when it fits", () => {
  const plan = planMaskStoreForQuality(30, 1920, 1080, {
    shortSide: 512,
    sampleFps: 8,
    budgetBytes: 256 * 1024 * 1024,
  });

  assert.equal(plan.width, 910);
  assert.equal(plan.height, 512);
  assert.equal(plan.sampleFps, 8);
  assert.equal(plan.degraded, false);
});

test("the quality tier honours 1024px at 12fps on a short clip", () => {
  const plan = planMaskStoreForQuality(20, 1920, 1080, {
    shortSide: 1024,
    sampleFps: 12,
    budgetBytes: 512 * 1024 * 1024,
  });

  assert.equal(plan.width, 1820);
  assert.equal(plan.height, 1024);
  assert.equal(plan.sampleFps, 12);
  assert.equal(plan.totalFrames, 240);
  assert.equal(plan.degraded, false);
});

test("a mask is never upsampled past the source short side", () => {
  const plan = planMaskStoreForQuality(20, 640, 360, {
    shortSide: 1024,
    sampleFps: 12,
    budgetBytes: 512 * 1024 * 1024,
  });

  assert.equal(plan.width, 640);
  assert.equal(plan.height, 360);
  assert.equal(plan.degraded, false);
});

test("quality tiers degrade inside their own budget on long clips", () => {
  for (const request of [
    { shortSide: 384, sampleFps: 6, budgetBytes: 128 * 1024 * 1024 },
    { shortSide: 512, sampleFps: 8, budgetBytes: 256 * 1024 * 1024 },
    { shortSide: 1024, sampleFps: 12, budgetBytes: 512 * 1024 * 1024 },
  ]) {
    const plan = planMaskStoreForQuality(600, 1920, 1080, request);

    assert.ok(plan.bytes <= request.budgetBytes, "must stay inside budget");
    assert.ok(plan.totalFrames > 0);
    assert.ok(plan.sampleFps > 0);
    assert.equal(plan.degraded, true);
    assert.ok(Math.min(plan.width, plan.height) < request.shortSide);
  }
});

test("a tiny budget produces a fractional-rate plan, never truncation", () => {
  const budget = 8 * 1024 * 1024;
  const plan = planMaskStoreForQuality(600, 1920, 1080, {
    shortSide: 1024,
    sampleFps: 12,
    budgetBytes: budget,
  });

  assert.ok(plan.bytes <= budget);
  if (plan.totalFrames > 0) {
    assert.ok(plan.sampleFps > 0);
    assert.ok(plan.totalFrames * plan.bytesPerFrame <= budget);
  }
});

test("an invalid duration produces an empty quality plan", () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const plan = planMaskStoreForQuality(duration, 1920, 1080, {
      shortSide: 512,
      sampleFps: 8,
    });
    assert.equal(plan.totalFrames, 0);
    assert.equal(plan.bytes, 0);
  }
});

test("the sample rate is capped even when a caller asks for more", () => {
  const plan = planMaskStoreForQuality(10, 1920, 1080, {
    shortSide: 384,
    sampleFps: 60,
  });

  assert.ok(plan.sampleFps <= 12);
  assert.equal(plan.degraded, true);
});

// ---------------------------------------------------------------------------
// Failure fallbacks
// ---------------------------------------------------------------------------

test("a failed first frame gets an opaque placeholder, not a hole", () => {
  const { plan } = makeStore(10);
  const fallback = createFallbackMask(plan, null);

  assert.equal(fallback.alpha.length, plan.bytesPerFrame);
  assert.ok(fallback.alpha.every((value) => value === 255));
  assert.equal(fallback.meta.synthetic, true);
  assert.equal(fallback.meta.lowConfidence, true);
  assert.equal(fallback.meta.coverage, 1);
  assert.equal(fallback.meta.chinY, null);
});

test("a fallback fills frame zero so mask lookups never return null", () => {
  const { plan, store } = makeStore(10);
  const fallback = createFallbackMask(plan, null);
  store.put(0, fallback.alpha, fallback.meta);

  const frame = store.get(0);
  assert.ok(frame);
  assert.equal(frame.meta.synthetic, true);
  assert.equal(frame.meta.coverage, 1);
});

test("synthetic fallbacks are never offered for cross-fading", () => {
  const { plan, store } = makeStore(10);
  const fallback = createFallbackMask(plan, null);
  store.put(0, fallback.alpha, fallback.meta);
  store.put(1, fallback.alpha, fallback.meta);

  assert.equal(store.get(1)?.meta.linkable, false);
});

test("a synthetic matte is never a cross-fade source", () => {
  const { plan, store } = makeStore(10);
  const fallback = createFallbackMask(plan, null);
  store.put(0, fallback.alpha, fallback.meta);
  store.put(1, fill(180, plan.bytesPerFrame), META);

  const neighbours = store.getNeighbours(0.5 / plan.sampleFps);
  assert.ok(neighbours);
  assert.equal(neighbours.b, null);
  assert.equal(neighbours.k, 0);
});

test("a later failed frame carries the previous matte forward", () => {
  const { plan, store } = makeStore(10);
  store.put(2, fill(180, plan.bytesPerFrame), META);
  const previous = store.get(2);
  assert.ok(previous);

  const fallback = createFallbackMask(plan, previous);

  assert.notEqual(fallback.alpha, previous.data, "must not alias the slab");
  assert.deepEqual(fallback.alpha, previous.data);
  assert.equal(fallback.meta.synthetic, true);
  assert.equal(fallback.meta.lowConfidence, true);
  assert.equal(fallback.meta.coverage, META.coverage);
  assert.equal(fallback.meta.centroidX, META.centroidX);
  assert.equal(fallback.meta.chinY, META.chinY);
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Snapshots (IndexedDB cache round-trip)
// ---------------------------------------------------------------------------

test("a snapshot restores every stored slot and serves time lookups", () => {
  const { plan, store } = makeStore(10);
  const first = fill(40, plan.bytesPerFrame);
  const second = fill(190, plan.bytesPerFrame);
  store.put(0, first, META);
  store.put(2, second, META);

  const snapshot = store.snapshot();
  const restored = MaskStore.fromSnapshot(snapshot);

  assert.ok(restored);
  assert.equal(restored.framesStored, 2);
  assert.equal(restored.plan.totalFrames, plan.totalFrames);
  assert.equal(restored.plan.sampleFps, plan.sampleFps);
  assert.equal(restored.get(0)?.data.buffer, snapshot.slab);
  assert.deepEqual(restored.get(0)?.data, first);
  assert.deepEqual(restored.get(2)?.data, second);
  assert.equal(restored.getAt(2 / plan.sampleFps)?.index, 2);
  assert.equal(
    restored.getAt(1 / plan.sampleFps)?.index,
    0,
    "a gap resolves to the nearest earlier slot",
  );
  assert.equal(restored.get(1)?.meta.synthetic, false);
});

test("snapshots report whether they contain a real matte", () => {
  const { plan, store } = makeStore(4);
  const fallback = createFallbackMask(plan, null);
  store.put(0, fallback.alpha, fallback.meta);

  assert.equal(store.hasRealMasks, false);
  assert.equal(store.syntheticFrames, 1);

  store.put(1, fill(180, plan.bytesPerFrame), META);
  assert.equal(store.hasRealMasks, true);
  assert.equal(store.syntheticFrames, 1);
});

test("corrupt snapshots are rejected rather than composited", () => {
  const { plan, store } = makeStore(4);
  store.put(0, fill(180, plan.bytesPerFrame), META);
  const snapshot = store.snapshot();

  assert.equal(
    MaskStore.fromSnapshot({ ...snapshot, slab: new ArrayBuffer(1) }),
    null,
  );
  assert.equal(
    MaskStore.fromSnapshot({ ...snapshot, occupied: new Uint8Array(1) }),
    null,
  );
  assert.equal(MaskStore.fromSnapshot({ ...snapshot, metas: [] }), null);
  assert.equal(
    MaskStore.fromSnapshot({
      ...snapshot,
      plan: { ...snapshot.plan, totalFrames: 0 },
    }),
    null,
  );

  const missingMeta = snapshot.metas.slice();
  missingMeta[0] = null;
  assert.equal(
    MaskStore.fromSnapshot({ ...snapshot, metas: missingMeta }),
    null,
  );
});

test("put and get round-trip a mask without copying", () => {
  const { plan, store } = makeStore(10);
  const alpha = fill(200, plan.bytesPerFrame);

  store.put(3, alpha, META);
  const frame = store.get(3);

  assert.ok(frame);
  assert.equal(frame.index, 3);
  assert.equal(frame.width, plan.width);
  assert.equal(frame.data[0], 200);
  assert.equal(frame.data.length, plan.bytesPerFrame);
  assert.equal(store.framesStored, 1);
  assert.equal(store.bytesUsed, plan.bytesPerFrame);
});

test("a hole in the timeline resolves to the nearest earlier mask", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(10, plan.bytesPerFrame), META);
  store.put(1, fill(20, plan.bytesPerFrame), META);
  // slot 2 never written
  store.put(3, fill(40, plan.bytesPerFrame), META);

  const frame = store.get(2);
  assert.ok(frame);
  assert.equal(frame.index, 1, "must fall back to the previous stored slot");
  assert.equal(frame.data[0], 20);
});

test("get returns null before any mask exists", () => {
  const { store } = makeStore(10);
  assert.equal(store.get(0), null);
  assert.equal(store.getNeighbours(0), null);
});

test("out-of-range writes are ignored instead of corrupting the slab", () => {
  const { plan, store } = makeStore(10);
  store.put(-1, fill(255, plan.bytesPerFrame), META);
  store.put(plan.totalFrames, fill(255, plan.bytesPerFrame), META);
  store.put(0, fill(255, plan.bytesPerFrame + 1), META);

  assert.equal(store.framesStored, 0);
  assert.equal(store.bytesUsed, 0);
});

test("re-writing a slot does not double-count it", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(10, plan.bytesPerFrame), META);
  store.put(0, fill(90, plan.bytesPerFrame), META);

  assert.equal(store.framesStored, 1);
  assert.equal(store.get(0)!.data[0], 90);
});

test("clear releases every slot and its accounting", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(10, plan.bytesPerFrame), META);
  store.put(1, fill(10, plan.bytesPerFrame), META);
  store.clear();

  assert.equal(store.framesStored, 0);
  assert.equal(store.bytesUsed, 0);
  assert.equal(store.get(1), null);
});

// ---------------------------------------------------------------------------
// Linkability and interpolation
// ---------------------------------------------------------------------------

test("identical consecutive mattes are linkable", () => {
  const { plan, store } = makeStore(10);
  const alpha = fill(180, plan.bytesPerFrame);
  store.put(0, alpha, META);
  store.put(1, alpha, META);

  assert.equal(store.get(0)!.meta.linkable, false, "first frame has no prior");
  assert.equal(store.get(1)!.meta.linkable, true);
});

test("dissimilar consecutive mattes are not linkable", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(0, plan.bytesPerFrame), META);
  store.put(1, fill(255, plan.bytesPerFrame), META);

  assert.equal(store.get(1)!.meta.linkable, false);
});

test("getNeighbours returns a blend pair only for linkable samples", () => {
  const { plan, store } = makeStore(10);
  const alpha = fill(180, plan.bytesPerFrame);
  store.put(0, alpha, META);
  store.put(1, alpha, META);

  const neighbours = store.getNeighbours(0.5 / plan.sampleFps);
  assert.ok(neighbours);
  assert.ok(neighbours.b, "a linkable neighbour must be offered for blending");
  assert.ok(neighbours.k > 0 && neighbours.k < 1);
});

test("getNeighbours declines to blend when the next sample is missing", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(180, plan.bytesPerFrame), META);

  const neighbours = store.getNeighbours(0.5 / plan.sampleFps);
  assert.ok(neighbours);
  assert.equal(neighbours.b, null);
  assert.equal(neighbours.k, 0);
});

test("getNeighbours declines to blend when the mattes differ", () => {
  const { plan, store } = makeStore(10);
  store.put(0, fill(0, plan.bytesPerFrame), META);
  store.put(1, fill(255, plan.bytesPerFrame), META);

  const neighbours = store.getNeighbours(0.5 / plan.sampleFps);
  assert.ok(neighbours);
  assert.equal(neighbours.b, null, "cross-fading unrelated silhouettes morphs");
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Progressive passes
// ---------------------------------------------------------------------------

test("the coarse pass takes every fourth frame and keeps both passes ordered", () => {
  const { coarse, refine } = planMaskPasses(12);

  assert.deepEqual(coarse, [0, 4, 8]);
  assert.deepEqual(refine, [1, 2, 3, 5, 6, 7, 9, 10, 11]);
  assert.deepEqual(
    [...coarse, ...refine].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test("a clip shorter than the stride still unlocks a preview", () => {
  const { coarse, refine } = planMaskPasses(3);

  assert.deepEqual(coarse, [0]);
  assert.deepEqual(refine, [1, 2]);
});

test("a stride of one produces a single full pass", () => {
  const { coarse, refine } = planMaskPasses(4, 1);

  assert.deepEqual(coarse, [0, 1, 2, 3]);
  assert.deepEqual(refine, []);
});

test("degenerate pass inputs produce no frames rather than throwing", () => {
  assert.deepEqual(planMaskPasses(0), { coarse: [], refine: [] });
  assert.deepEqual(planMaskPasses(-5), { coarse: [], refine: [] });
  assert.deepEqual(planMaskPasses(2, 0), {
    coarse: [0, 1],
    refine: [],
  });
});

test("signatures separate a uniform matte from a half-covered one", () => {
  const width = 32;
  const height = 32;
  const empty = new Uint8Array(width * height);
  const half = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) half[y * width + x] = 255;
  }

  const emptySignature = computeMaskSignature(empty, width, height);
  const halfSignature = computeMaskSignature(half, width, height);

  assert.equal(emptySignature.length, 64);
  assert.ok(signatureDistance(emptySignature, emptySignature) === 0);
  assert.ok(signatureDistance(emptySignature, halfSignature) > 32);
});
