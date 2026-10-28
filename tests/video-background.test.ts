import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BLUR_INTENSITY,
  blurRadiusFor,
  isBackgroundType,
  resolveBackgroundFill,
  type BackgroundSettings,
} from "../lib/video-background";

const base: BackgroundSettings = {
  backgroundType: "solid",
  solidBackgroundColor: "#123456",
};

test("blur intensity maps 0-100 onto 2-38px with 50 at the old default", () => {
  assert.equal(blurRadiusFor(DEFAULT_BLUR_INTENSITY), 20);
  assert.equal(blurRadiusFor(0), 2);
  assert.equal(blurRadiusFor(100), 38);
  assert.equal(blurRadiusFor(-25), 2);
  assert.equal(blurRadiusFor(250), 38);
});

test("an unusable blur intensity falls back to the default radius", () => {
  assert.equal(blurRadiusFor(Number.NaN), 20);
  assert.equal(blurRadiusFor(Number.POSITIVE_INFINITY), 20);
});

test("solid backgrounds use the configured colour and never substitute", () => {
  const resolved = resolveBackgroundFill(base);
  assert.deepEqual(resolved.fill, { kind: "solid", color: "#123456" });
  assert.equal(resolved.transparentSubstituted, false);
  assert.equal(resolved.imageMissing, false);

  assert.deepEqual(
    resolveBackgroundFill({ ...base, solidBackgroundColor: "" }).fill,
    { kind: "solid", color: "#000000" },
  );
});

test("unknown background types degrade to a solid colour", () => {
  const resolved = resolveBackgroundFill({
    ...base,
    backgroundType: "sepia" as BackgroundSettings["backgroundType"],
  });
  assert.deepEqual(resolved.fill, { kind: "solid", color: "#123456" });
});

test("blur backgrounds carry the radius derived from the intensity", () => {
  assert.deepEqual(
    resolveBackgroundFill({
      ...base,
      backgroundType: "blur",
      blurIntensity: 100,
    }).fill,
    { kind: "blur", radius: 38 },
  );

  assert.deepEqual(
    resolveBackgroundFill({ ...base, backgroundType: "blur" }).fill,
    { kind: "blur", radius: 20 },
  );
});

test("transparent is a checkerboard in preview and a solid fallback in export", () => {
  const settings = { ...base, backgroundType: "transparent" as const };

  const preview = resolveBackgroundFill(settings, { allowTransparent: true });
  assert.deepEqual(preview.fill, { kind: "transparent" });
  assert.equal(preview.transparentSubstituted, false);

  const exported = resolveBackgroundFill(settings, { allowTransparent: false });
  assert.deepEqual(exported.fill, { kind: "solid", color: "#123456" });
  assert.equal(exported.transparentSubstituted, true);
});

test("image backgrounds use the loaded source and fall back when missing", () => {
  const source = {} as CanvasImageSource;
  const settings = {
    ...base,
    backgroundType: "image" as const,
    customBackgroundImage: "data:image/png;base64,AAAA",
  };

  const loaded = resolveBackgroundFill(settings, {
    image: { source, width: 640, height: 480 },
  });
  assert.deepEqual(loaded.fill, {
    kind: "image",
    source,
    width: 640,
    height: 480,
  });
  assert.equal(loaded.imageMissing, false);

  const missing = resolveBackgroundFill(settings);
  assert.deepEqual(missing.fill, { kind: "solid", color: "#123456" });
  assert.equal(missing.imageMissing, true);
  assert.equal(missing.transparentSubstituted, false);
});

test("export never resolves a transparent fill for any mode", () => {
  const source = {} as CanvasImageSource;
  const modes: BackgroundSettings[] = [
    { ...base, backgroundType: "solid" },
    { ...base, backgroundType: "blur", blurIntensity: 70 },
    { ...base, backgroundType: "transparent" },
    { ...base, backgroundType: "image", customBackgroundImage: "data:x" },
  ];

  for (const settings of modes) {
    const resolved = resolveBackgroundFill(settings, {
      image: { source, width: 10, height: 10 },
      allowTransparent: false,
    });
    assert.notEqual(
      resolved.fill.kind,
      "transparent",
      `${settings.backgroundType} must export a concrete fill`,
    );
  }
});

test("background type guard accepts only the supported modes", () => {
  for (const type of ["solid", "blur", "transparent", "image"]) {
    assert.equal(isBackgroundType(type), true);
  }
  for (const value of ["", "solid ", "checkerboard", null, 4, undefined]) {
    assert.equal(isBackgroundType(value), false);
  }
});
