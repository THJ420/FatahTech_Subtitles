import assert from "node:assert/strict";
import test from "node:test";
import { getExportDimensions } from "../lib/export-settings";
import { ExportBuffer } from "../lib/export-buffer";
import { getPortraitCrops } from "../lib/portrait-layout";

test("stacked exports use portrait geometry for landscape, square, and portrait sources", () => {
  for (const [w, h] of [
    [1920, 1080],
    [640, 360],
    [640, 640],
    [900, 1200],
    [1080, 1920],
  ]) {
    for (const mobile of [false, true]) {
      const size = getExportDimensions(w, h, "9:16", true, mobile);
      assert.ok(Math.abs(size.width / size.height - 9 / 16) < 0.002);
      assert.equal(size.width % 2, 0);
      assert.equal(size.height % 2, 0);
      if (mobile) assert.ok(Math.max(size.width, size.height) <= 1280);
      const faces = [
        { x: 0.25, y: 0.3 },
        { x: 0.75, y: 0.3 },
      ];
      const preview = getPortraitCrops(w, h, 360, 640, faces);
      const output = getPortraitCrops(w, h, size.width, size.height, faces);
      output.forEach((c, i) => assert.ok(Math.abs(c.sh - preview[i].sh) < 2));
    }
  }
});
test("normal landscape export retains source resolution on desktop", () => {
  assert.deepEqual(getExportDimensions(3840, 2160, "16:9", false, false), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(getExportDimensions(3840, 2160, "16:9", false, true), {
    width: 1280,
    height: 720,
  });
});
test("encoded output supports cross-page writes and muxer header rewrites", async () => {
  const buffer = new ExportBuffer(4);
  buffer.write(0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  buffer.write(3, new Uint8Array([20, 21, 22]));
  const blob = buffer.toBlob("video/mp4");
  buffer.clear();
  assert.equal(buffer.size, 0);
  assert.deepEqual(
    [...new Uint8Array(await blob.arrayBuffer())],
    [1, 2, 3, 20, 21, 22, 7, 8, 9],
  );
  assert.equal(blob.type, "video/mp4");
  buffer.write(5, new Uint8Array([10]));
  assert.deepEqual(
    [...new Uint8Array(await buffer.toBlob("").arrayBuffer())],
    [0, 0, 0, 0, 0, 10],
  );
});
