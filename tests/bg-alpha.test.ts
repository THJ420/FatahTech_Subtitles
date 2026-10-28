import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoLevel,
  binarize,
  cleanBinary,
  combineSupport,
  computeAlphaStats,
  computeLumaHistogram,
  createAlphaChainState,
  detectSceneCut,
  feather,
  histogramDistance,
  isFlatMask,
  isImplausibleMask,
  keepComponents,
  refineAlpha,
  smoothstepRamp,
  temporalBlend,
  DEFAULT_ALPHA_CONFIG,
  MIN_PLAUSIBLE_COVERAGE,
} from "../lib/bg-alpha";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function solid(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

function fillRect(
  buffer: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) buffer[y * width + x] = value;
  }
}

function fillDisc(
  buffer: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  value: number,
): void {
  for (let y = 0; y < Math.floor(buffer.length / width); y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        buffer[y * width + x] = value;
      }
    }
  }
}

function countNonZero(buffer: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < buffer.length; i++) if (buffer[i] !== 0) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

test("a flat mask reports a degenerate spread and is flagged", () => {
  const stats = computeAlphaStats(solid(40, 30, 128), 40, 30);

  assert.equal(stats.mean, 128);
  assert.equal(stats.p1, 128);
  assert.equal(stats.p99, 128);
  assert.equal(stats.coverage, 1);
  assert.equal(isFlatMask(stats), true);
  // Full coverage is also implausible: the model almost certainly failed.
  assert.equal(isImplausibleMask(stats), true);
});

test("a half-plane mask reports half coverage and a centred boundary", () => {
  const width = 40;
  const height = 30;
  const mask = solid(width, height, 0);
  fillRect(mask, width, 0, 0, 20, height, 255);

  const stats = computeAlphaStats(mask, width, height);

  assert.equal(stats.coverage, 0.5);
  assert.equal(stats.p1, 0);
  assert.equal(stats.p99, 255);
  assert.equal(isFlatMask(stats), false);
  assert.equal(isImplausibleMask(stats), false);
});

test("the chin line is derived in the same pass as the rest of the stats", () => {
  const width = 40;
  const height = 100;
  const mask = solid(width, height, 0);
  // Subject occupies rows 20..79 — 60 rows, so the chin sits at row 38.
  fillRect(mask, width, 0, 20, width, 60, 255);

  const stats = computeAlphaStats(mask, width, height);

  assert.equal(stats.topY, 0.2);
  assert.equal(stats.bottomY, 0.79);
  assert.ok(Math.abs(stats.chinY! - 0.38) < 0.011);
});

test("an empty mask has no chin line and is below the plausibility floor", () => {
  const stats = computeAlphaStats(solid(20, 20, 0), 20, 20);

  assert.equal(stats.chinY, null);
  assert.equal(stats.coverage, 0);
  assert.ok(stats.coverage < MIN_PLAUSIBLE_COVERAGE);
  assert.equal(isImplausibleMask(stats), true);
});

// ---------------------------------------------------------------------------
// Level and threshold
// ---------------------------------------------------------------------------

test("auto-levelling refuses to stretch a degenerate range", () => {
  const mask = solid(10, 10, 100);
  autoLevel(mask, 100, 102); // spread 2 < MIN_LEVEL_SPREAD
  for (let i = 0; i < mask.length; i++) assert.equal(mask[i], 100);
});

test("auto-levelling maps the requested window onto the full range", () => {
  const mask = new Uint8Array([40, 90, 140, 190, 240]);
  autoLevel(mask, 40, 240);
  assert.deepEqual(Array.from(mask), [0, 64, 128, 191, 255]);
});

test("the smoothstep ramp collapses outside the band and keeps the midpoint", () => {
  const mask = new Uint8Array([0, 88, 89, 127, 128, 166, 167, 255]);
  smoothstepRamp(mask, 89, 166);

  assert.equal(mask[0], 0);
  assert.equal(mask[1], 0);
  assert.equal(mask[2], 0);
  // 127 sits just under halfway through 89..166; smoothstep(0.4935) ~= 0.490,
  // so the S-curve returns ~125 rather than the linear 128.
  assert.ok(
    Math.abs(mask[3] - 127) <= 4,
    `expected a mid-band value near 127, got ${mask[3]}`,
  );
  assert.ok(mask[4] > mask[3], "the ramp must be monotonic");
  assert.equal(mask[5], 255);
  assert.equal(mask[6], 255);
  assert.equal(mask[7], 255);
});

test("binarize splits at the threshold without mutating the source", () => {
  const alpha = new Uint8Array([0, 127, 128, 255]);
  const out = new Uint8Array(4);
  binarize(alpha, 128, out);

  assert.deepEqual(Array.from(out), [0, 0, 1, 1]);
  assert.deepEqual(Array.from(alpha), [0, 127, 128, 255]);
});

// ---------------------------------------------------------------------------
// Morphology
// ---------------------------------------------------------------------------

test("opening removes an isolated speck but keeps a solid block", () => {
  const size = 21;
  const binary = new Uint8Array(size * size);
  fillRect(binary, size, 2, 2, 5, 5, 1); // subject
  binary[10 * size + 10] = 1; // isolated speck

  const a = new Uint8Array(size * size);
  const b = new Uint8Array(size * size);
  const c = new Uint8Array(size * size);
  cleanBinary(binary, size, size, 1, 0, a, b, c);

  assert.equal(binary[10 * size + 10], 0, "the speck must be eroded away");
  assert.equal(binary[4 * size + 4], 1, "the block interior must survive");
});

test("closing fills a pinhole inside the subject", () => {
  const size = 21;
  const binary = new Uint8Array(size * size);
  fillRect(binary, size, 4, 4, 11, 11, 1);
  binary[9 * size + 9] = 0; // pinhole

  const a = new Uint8Array(size * size);
  const b = new Uint8Array(size * size);
  const c = new Uint8Array(size * size);
  cleanBinary(binary, size, size, 0, 1, a, b, c);

  assert.equal(binary[9 * size + 9], 1, "the pinhole must be closed");
});

test("opening followed by closing leaves a clean solid region unchanged", () => {
  const size = 21;
  const binary = new Uint8Array(size * size);
  fillRect(binary, size, 3, 3, 15, 15, 1);
  const before = Uint8Array.from(binary);

  const a = new Uint8Array(size * size);
  const b = new Uint8Array(size * size);
  const c = new Uint8Array(size * size);
  cleanBinary(binary, size, size, 1, 1, a, b, c);

  assert.deepEqual(Array.from(binary), Array.from(before));
});

// ---------------------------------------------------------------------------
// Connected components
// ---------------------------------------------------------------------------

test("component filtering drops specks and keeps large secondary blobs", () => {
  const size = 40;
  const total = size * size;
  const binary = new Uint8Array(total);
  fillRect(binary, size, 2, 2, 10, 10, 1); // largest: 100px
  fillRect(binary, size, 20, 20, 4, 4, 1); // secondary: 16px, below the floor
  fillRect(binary, size, 30, 2, 8, 8, 1); // large secondary: 64px, at the floor
  binary[39 * size + 39] = 1; // speck

  const stats = keepComponents(
    binary,
    size,
    size,
    0.0005,
    new Int32Array(total),
    new Uint8Array(total),
    new Int32Array(total),
  );

  assert.equal(stats.count, 4);
  assert.equal(stats.largestArea, 100);
  assert.equal(binary[5 * size + 5], 1, "largest component kept");
  assert.equal(binary[22 * size + 22], 0, "small secondary dropped");
  assert.equal(binary[5 * size + 33], 1, "64px component kept (at the floor)");
  assert.equal(binary[39 * size + 39], 0, "speck dropped");
});

test("a small subject is kept even when it is the only component", () => {
  const size = 40;
  const total = size * size;
  const binary = new Uint8Array(total);
  fillRect(binary, size, 5, 5, 2, 2, 1); // 4px, far below the 64px floor

  keepComponents(
    binary,
    size,
    size,
    0.0005,
    new Int32Array(total),
    new Uint8Array(total),
    new Int32Array(total),
  );

  assert.equal(binary[5 * size + 5], 1, "the largest component is always kept");
});

test("an empty map reports no components", () => {
  const size = 8;
  const total = size * size;
  const stats = keepComponents(
    new Uint8Array(total),
    size,
    size,
    0.0005,
    new Int32Array(total),
    new Uint8Array(total),
    new Int32Array(total),
  );

  assert.equal(stats.count, 0);
  assert.equal(stats.removedPixels, 0);
});

// ---------------------------------------------------------------------------
// Feathering
// ---------------------------------------------------------------------------

test("feathering produces a monotonic ramp across the boundary", () => {
  const size = 21;
  const binary = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < 10; x++) binary[y * size + x] = 1;
  }

  const out = new Uint8Array(size * size);
  feather(binary, size, size, 1, out, new Uint16Array(size * size));

  const row = 10;
  assert.equal(out[row * size + 0], 255, "deep interior is fully opaque");
  assert.equal(out[row * size + 20], 0, "deep exterior is fully transparent");

  const boundary = out[row * size + 10];
  assert.ok(boundary > 0 && boundary < 255, `edge must be soft, got ${boundary}`);

  for (let x = 8; x < 14; x++) {
    assert.ok(
      out[row * size + x] >= out[row * size + x + 1],
      `values must not increase moving outward at x=${x}`,
    );
  }
});

test("a zero-radius feather degenerates to a hard edge", () => {
  const binary = new Uint8Array([0, 1, 1, 0]);
  const out = new Uint8Array(4);
  feather(binary, 4, 1, 0, out, new Uint16Array(4));

  assert.deepEqual(Array.from(out), [0, 255, 255, 0]);
});

test("combining the support map zeroes everything outside the silhouette", () => {
  const ramped = new Uint8Array([255, 255, 255]);
  const feathered = new Uint8Array([0, 128, 255]);
  combineSupport(ramped, feathered);

  assert.equal(ramped[0], 0, "outside the band must be fully removed");
  assert.equal(ramped[1], 128, "inside the band keeps the ramp");
  assert.equal(ramped[2], 255, "interior stays fully opaque");
});

// ---------------------------------------------------------------------------
// Temporal and scene cuts
// ---------------------------------------------------------------------------

test("the temporal blend is skipped when the mattes disagree", () => {
  const current = solid(10, 10, 255);
  const previous = solid(10, 10, 0);

  const result = temporalBlend(current, previous, {
    weight: 0.25,
    maxDelta: 24,
  });

  assert.equal(result.blended, false);
  assert.equal(result.delta, 255);
  assert.equal(current[0], 255, "an ungated blend would smear a halo here");
});

test("the temporal blend averages when the mattes agree", () => {
  const current = solid(10, 10, 100);
  const previous = solid(10, 10, 0);

  const result = temporalBlend(current, previous, {
    weight: 0.25,
    maxDelta: 255,
  });

  assert.equal(result.blended, true);
  assert.equal(current[0], 75);
});

test("the temporal blend is a no-op without a previous frame", () => {
  const current = solid(4, 4, 200);
  const result = temporalBlend(current, null, { weight: 0.25, maxDelta: 24 });

  assert.equal(result.blended, false);
  assert.equal(current[0], 200);
});

test("identical histograms are not a cut and disjoint ones are", () => {
  const dark = computeLumaHistogram(new Uint8Array(400).fill(10));
  const bright = computeLumaHistogram(new Uint8Array(400).fill(250));

  assert.equal(histogramDistance(dark, dark), 0);
  assert.equal(histogramDistance(dark, bright), 1);
  assert.equal(detectSceneCut(dark, null), false);
  assert.equal(detectSceneCut(dark, dark), false);
  assert.equal(detectSceneCut(bright, dark), true);
});

test("a gradual brightness shift is not treated as a cut", () => {
  const a = computeLumaHistogram(new Uint8Array(400).fill(100));
  const b = computeLumaHistogram(new Uint8Array(400).fill(108));

  assert.equal(detectSceneCut(b, a), false);
});

// ---------------------------------------------------------------------------
// Full chain
// ---------------------------------------------------------------------------

test("the full chain removes haze and specks while keeping the subject", () => {
  const size = 64;
  const mask = solid(size, size, 90); // background haze at 90
  fillDisc(mask, size, 32, 32, 14, 220); // subject at 220
  fillRect(mask, size, 2, 2, 3, 3, 255); // speck in the corner

  const state = createAlphaChainState(size, size);
  const result = refineAlpha(
    mask,
    null,
    size,
    size,
    DEFAULT_ALPHA_CONFIG,
    state,
  );

  assert.equal(result.lowConfidence, false);
  assert.ok(mask[32 * size + 32] > 200, "subject interior stays opaque");
  assert.equal(mask[0], 0, "corner haze must be fully removed");
  assert.equal(mask[3 * size + 3], 0, "the speck must be removed");
});

test("a flat matte is passed through untouched rather than stretched", () => {
  const size = 32;
  const mask = solid(size, size, 128);
  const before = Uint8Array.from(mask);

  const state = createAlphaChainState(size, size);
  const result = refineAlpha(
    mask,
    null,
    size,
    size,
    DEFAULT_ALPHA_CONFIG,
    state,
  );

  assert.equal(result.lowConfidence, true);
  assert.deepEqual(
    Array.from(mask),
    Array.from(before),
    "stretching a flat matte would turn noise into a hard blob",
  );
});

test("a hard cut resets the per-shot level reference", () => {
  const size = 32;
  const state = createAlphaChainState(size, size);

  const first = solid(size, size, 0);
  fillDisc(first, size, 16, 16, 10, 200);
  refineAlpha(first, new Uint8Array(size * size * 4).fill(20), size, size, DEFAULT_ALPHA_CONFIG, state);
  assert.notEqual(state.levelLo, null);

  const second = solid(size, size, 0);
  fillDisc(second, size, 16, 16, 10, 200);
  const result = refineAlpha(
    second,
    new Uint8Array(size * size * 4).fill(240),
    size,
    size,
    DEFAULT_ALPHA_CONFIG,
    state,
  );

  assert.equal(result.cut, true);
  assert.notEqual(state.levelLo, null, "the new shot re-seeds the reference");
});

test("the chain rejects a matte whose dimensions do not match its state", () => {
  const state = createAlphaChainState(16, 16);
  assert.throws(() =>
    refineAlpha(
      solid(32, 32, 0),
      null,
      32,
      32,
      DEFAULT_ALPHA_CONFIG,
      state,
    ),
  );
});

test("repeated frames with a static subject stay stable", () => {
  const size = 48;
  const state = createAlphaChainState(size, size);
  const make = () => {
    const mask = solid(size, size, 70);
    fillDisc(mask, size, 24, 24, 12, 210);
    return mask;
  };

  refineAlpha(make(), null, size, size, DEFAULT_ALPHA_CONFIG, state);
  const second = make();
  refineAlpha(second, null, size, size, DEFAULT_ALPHA_CONFIG, state);
  const third = make();
  refineAlpha(third, null, size, size, DEFAULT_ALPHA_CONFIG, state);

  assert.ok(countNonZero(third) > 0);
  assert.equal(third[24 * size + 24], 255);
  assert.equal(third[0], 0);
});
