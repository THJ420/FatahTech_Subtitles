import assert from "node:assert/strict";
import test from "node:test";
import {
  createFaceSmoother,
  drawPortraitLayout,
  getPortraitCrops,
  interpolateFaces,
  orderFaces,
} from "../lib/portrait-layout";
import { smoothTimeline } from "../lib/person-tracking";

const faces = [
  { x: 0.25, y: 0.3 },
  { x: 0.75, y: 0.3 },
];
test("stacked crops fill two equal tiles without stretching or escaping source", () => {
  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
    [640, 640],
  ]) {
    const crops = getPortraitCrops(w, h, 1080, 1920, faces);
    assert.equal(crops.length, 2);
    assert.equal(crops[0].dy, 0);
    assert.equal(crops[1].dy, 960);
    for (const c of crops) {
      assert.equal(c.dh, 960);
      assert.equal(c.sw / c.sh, c.dw / c.dh);
      assert.ok(c.sx >= 0 && c.sy >= 0);
      assert.ok(c.sx + c.sw <= w && c.sy + c.sh <= h);
    }
  }
});
test("swap reverses source crops while preserving destination tiles", () => {
  const original = getPortraitCrops(1920, 1080, 1080, 1920, faces);
  const swapped = getPortraitCrops(1920, 1080, 1080, 1920, faces, true);
  assert.equal(original[0].sx, swapped[1].sx);
  assert.equal(original[1].sx, swapped[0].sx);
  assert.equal(swapped[0].dy, 0);
});
test("one face fills portrait and missing detections offer a manual left/right split", () => {
  const single = getPortraitCrops(1920, 1080, 1080, 1920, [faces[0]]);
  assert.equal(single.length, 1);
  assert.equal(single[0].dh, 1920);
  assert.equal(getPortraitCrops(1920, 1080, 1080, 1920, []).length, 2);
  assert.deepEqual(orderFaces([...faces].reverse()), faces);
});
test("brief face loss holds layout, sustained loss falls back, seeks reset", () => {
  const smooth = createFaceSmoother();
  assert.deepEqual(smooth(faces, 0), faces);
  assert.equal(smooth([faces[0]], 0.1).length, 2);
  assert.equal(smooth([faces[0]], 0.5).length, 2);
  assert.equal(smooth([faces[0]], 0.9).length, 1);
  assert.equal(smooth(faces, 1).length, 2);
  assert.equal(smooth([faces[0]], 0).length, 1);
});
test("face timeline interpolates within shots but preserves one/two-person cuts", () => {
  const timeline = [
    { time: 0, centerX: 0.25, faces },
    {
      time: 1,
      centerX: 0.3,
      faces: faces.map((f) => ({ ...f, x: f.x + 0.1 })),
    },
    { time: 2, centerX: 0.5, faces: [{ x: 0.5, y: 0.3 }] },
  ];
  assert.equal(interpolateFaces(timeline, 0.5)[0].x, 0.3);
  assert.equal(interpolateFaces(timeline, 1.5).length, 2);
  assert.equal(interpolateFaces(timeline, 2).length, 1);
  assert.deepEqual(smoothTimeline(timeline)[1].faces, timeline[1].faces);
});
test("shared preview/export renderer draws the exact crop geometry", () => {
  const calls: unknown[][] = [];
  const ctx = { drawImage: (...args: unknown[]) => calls.push(args) };
  const source = {} as CanvasImageSource;
  drawPortraitLayout(
    ctx as unknown as CanvasRenderingContext2D,
    source,
    1920,
    1080,
    1080,
    1920,
    faces,
    true,
  );
  const crops = getPortraitCrops(1920, 1080, 1080, 1920, faces, true);
  assert.deepEqual(
    calls,
    crops.map((c) => [source, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh]),
  );
});

test("face zoom tightens both crops while preserving aspect ratio and source bounds", () => {
  const original = getPortraitCrops(1920, 1080, 1080, 1920, faces);
  const zoomed = getPortraitCrops(1920, 1080, 1080, 1920, faces, false, 2);
  for (let i = 0; i < zoomed.length; i++) {
    const crop = zoomed[i];
    assert.equal(crop.sw, original[i].sw / 2);
    assert.equal(crop.sh, original[i].sh / 2);
    assert.equal(crop.sw / crop.sh, crop.dw / crop.dh);
    assert.equal(crop.sx + crop.sw / 2, faces[i].x * 1920);
    assert.equal(crop.sy + crop.sh * 0.35, faces[i].y * 1080);
  }
  for (const face of [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]) {
    for (const c of getPortraitCrops(
      1920,
      1080,
      1080,
      1920,
      [face],
      false,
      2.5,
    )) {
      assert.ok(c.sx >= 0 && c.sy >= 0);
      assert.ok(c.sx + c.sw <= 1920 && c.sy + c.sh <= 1080);
    }
  }
  assert.deepEqual(
    getPortraitCrops(1920, 1080, 1080, 1920, faces, false, NaN),
    original,
  );
});
