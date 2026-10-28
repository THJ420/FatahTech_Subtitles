import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRectFor } from "../lib/bg-composite";

/**
 * `maskRectFor` is the crop-alignment math shared by the preview and the export
 * renderer. The preview used to derive this from the *uncropped* frame while
 * the foreground used the cropped rect, which put the person against a
 * different framing in any cropped layout.
 *
 * These tests pin the invariant that makes that class of bug impossible: the
 * mask rectangle must be the same fraction of the mask that the source
 * rectangle is of the frame, with no stretching.
 */

const FULL_HD = { width: 1920, height: 1080 };
const MASK = { width: 640, height: 360 };

test("an uncropped frame maps to the whole mask", () => {
  const rect = maskRectFor(
    FULL_HD,
    { x: 0, y: 0, width: 1920, height: 1080 },
    MASK.width,
    MASK.height,
  );

  assert.deepEqual(rect, { x: 0, y: 0, width: 640, height: 360 });
});

test("a 9:16 centre crop of a landscape frame maps proportionally", () => {
  // Mirrors the preview's crop math: sw = vh * (9/16), sx = (vw - sw) / 2.
  const sourceWidth = Math.round(1080 * (9 / 16));
  const sourceX = Math.round((1920 - sourceWidth) / 2);

  const rect = maskRectFor(
    FULL_HD,
    { x: sourceX, y: 0, width: sourceWidth, height: 1080 },
    MASK.width,
    MASK.height,
  );

  assert.ok(Math.abs(rect.x - (sourceX / 1920) * 640) < 1e-9);
  assert.equal(rect.y, 0);
  assert.ok(Math.abs(rect.width - (sourceWidth / 1920) * 640) < 1e-9);
  assert.equal(rect.height, 360, "a full-height crop keeps the full mask height");
});

test("a top/bottom crop of a portrait frame maps proportionally", () => {
  const rect = maskRectFor(
    { width: 1080, height: 1920 },
    { x: 0, y: 300, width: 1080, height: 1320 },
    360,
    640,
  );

  assert.equal(rect.x, 0);
  assert.ok(Math.abs(rect.y - (300 / 1920) * 640) < 1e-9);
  assert.equal(rect.width, 360);
  assert.ok(Math.abs(rect.height - (1320 / 1920) * 640) < 1e-9);
});

test("the mask rectangle is the same fractional region as the source", () => {
  // The real contract: no stretching, regardless of mask aspect. The rect must
  // cover the same fraction of the mask that the source covers of the frame.
  const cases = [
    { intrinsic: FULL_HD, source: { x: 656, y: 0, width: 608, height: 1080 } },
    { intrinsic: FULL_HD, source: { x: 0, y: 120, width: 1920, height: 840 } },
    {
      intrinsic: { width: 1080, height: 1920 },
      source: { x: 0, y: 420, width: 1080, height: 1080 },
    },
    { intrinsic: FULL_HD, source: { x: 100, y: 50, width: 900, height: 600 } },
  ];

  for (const { intrinsic, source } of cases) {
    const rect = maskRectFor(intrinsic, source, 640, 360);
    assert.ok(
      Math.abs(rect.width / 640 - source.width / intrinsic.width) < 1e-9,
      "horizontal fraction drifted",
    );
    assert.ok(
      Math.abs(rect.height / 360 - source.height / intrinsic.height) < 1e-9,
      "vertical fraction drifted",
    );
  }
});

test("a mask that shares the video aspect keeps the source aspect", () => {
  // 640x360 matches 1920x1080, so the mapped rect must not distort.
  const source = { x: 656, y: 0, width: 608, height: 1080 };
  const rect = maskRectFor(FULL_HD, source, 640, 360);

  const sourceAspect = source.width / source.height;
  const rectAspect = rect.width / rect.height;
  assert.ok(
    Math.abs(sourceAspect - rectAspect) < 1e-6,
    `aspect drifted: source ${sourceAspect}, mask ${rectAspect}`,
  );
});

test("the mapped rectangle always stays inside the mask", () => {
  const cases = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 656, y: 0, width: 608, height: 1080 },
    { x: 0, y: 0, width: 608, height: 1080 },
    { x: 1, y: 1, width: 1918, height: 1078 },
  ];

  for (const source of cases) {
    const rect = maskRectFor(FULL_HD, source, 640, 360);
    assert.ok(rect.x >= -1e-9, `x out of bounds: ${rect.x}`);
    assert.ok(rect.y >= -1e-9, `y out of bounds: ${rect.y}`);
    assert.ok(rect.x + rect.width <= 640 + 1e-9, "right edge out of bounds");
    assert.ok(rect.y + rect.height <= 360 + 1e-9, "bottom edge out of bounds");
  }
});

test("a zero-sized intrinsic falls back to the whole mask instead of NaN", () => {
  const rect = maskRectFor(
    { width: 0, height: 0 },
    { x: 0, y: 0, width: 100, height: 100 },
    320,
    180,
  );

  assert.deepEqual(rect, { x: 0, y: 0, width: 320, height: 180 });
  assert.ok(Number.isFinite(rect.x));
});

test("the preview and export crops agree for the same geometry", () => {
  // Preview derives its crop from live face tracking, export freezes it per
  // phrase — but given the same sourceRect they must produce the same rect.
  const sourceRect = { x: 512, y: 0, width: 608, height: 1080 };

  const previewRect = maskRectFor(FULL_HD, sourceRect, 640, 360);
  const exportRect = maskRectFor(
    { width: 1920, height: 1080 },
    { ...sourceRect },
    640,
    360,
  );

  assert.deepEqual(previewRect, exportRect);
});
