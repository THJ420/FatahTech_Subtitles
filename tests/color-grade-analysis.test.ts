import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFootageSamples,
  footageSampleTimestamps,
  synthesizeColorGradePresets,
  type FootageSample,
  type FootageStats,
} from "../lib/color-grade-analysis";
import {
  COLOR_GRADE_PRESETS,
  isNeutralColorGrade,
  sanitizeColorGrade,
} from "../lib/color-grade";

function solidSample(
  r: number,
  g: number,
  b: number,
  pixels = 100,
): FootageSample {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
  return { data, width: pixels, height: 1 };
}

test("sample timestamps sit inside the clip and avoid the edges", () => {
  assert.deepEqual(footageSampleTimestamps(10, 5), [1, 3, 5, 7, 9]);
  assert.deepEqual(footageSampleTimestamps(0), []);
  assert.deepEqual(footageSampleTimestamps(-5), []);
  assert.deepEqual(footageSampleTimestamps(Number.NaN), []);
  assert.deepEqual(footageSampleTimestamps(10, 0), []);
});

test("analysis ignores missing or fully transparent pixels", () => {
  assert.equal(analyzeFootageSamples([]), null);
  const transparent = solidSample(255, 0, 0);
  transparent.data.fill(0);
  assert.equal(analyzeFootageSamples([transparent]), null);
});

test("analysis measures luma, saturation, warmth, and tint", () => {
  const black = analyzeFootageSamples([solidSample(0, 0, 0)]);
  assert.ok(black);
  assert.ok(Math.abs(black.lumaMean) < 0.001);
  assert.ok(Math.abs(black.saturationMean) < 0.001);

  const white = analyzeFootageSamples([solidSample(255, 255, 255)]);
  assert.ok(white);
  assert.ok(Math.abs(white.lumaMean - 1) < 0.001);

  const red = analyzeFootageSamples([solidSample(255, 0, 0)]);
  assert.ok(red);
  assert.ok(Math.abs(red.saturationMean - 1) < 1e-6);
  assert.ok(Math.abs(red.warmth - 1) < 1e-6);
  assert.ok(Math.abs(red.tint + 0.5) < 1e-6);

  const grey = analyzeFootageSamples([solidSample(128, 128, 128)]);
  assert.ok(grey);
  assert.ok(Math.abs(grey.saturationMean) < 1e-6);
  assert.ok(Math.abs(grey.warmth) < 1e-6);
});

test("synthesis is deterministic and always returns four valid looks", () => {
  const stats: FootageStats = {
    lumaMean: 0.2,
    lumaP5: 0.05,
    lumaP95: 0.35,
    contrast: 0.3,
    saturationMean: 0.15,
    warmth: -0.1,
    tint: 0.02,
  };
  const presets = synthesizeColorGradePresets(stats);
  assert.deepEqual(
    presets.map((preset) => preset.id),
    ["vibrant-pop", "teal-orange", "warm-cinematic", "clean-studio"],
  );
  for (const preset of presets) {
    assert.equal(isNeutralColorGrade(preset.grade), false, preset.id);
    assert.deepEqual(sanitizeColorGrade(preset.grade), preset.grade);
  }
  assert.deepEqual(synthesizeColorGradePresets(stats), presets);
});

test("tuned looks respond to dark and muted footage", () => {
  const darkStats: FootageStats = {
    lumaMean: 0.18,
    lumaP5: 0.03,
    lumaP95: 0.3,
    contrast: 0.27,
    saturationMean: 0.12,
    warmth: -0.1,
    tint: 0.02,
  };
  const brightStats: FootageStats = {
    ...darkStats,
    lumaMean: 0.8,
    lumaP5: 0.6,
    lumaP95: 0.95,
    contrast: 0.35,
    saturationMean: 0.6,
    warmth: 0.25,
  };

  const dark = synthesizeColorGradePresets(darkStats);
  const bright = synthesizeColorGradePresets(brightStats);
  const darkVibrant = dark.find((preset) => preset.id === "vibrant-pop");
  const brightVibrant = bright.find((preset) => preset.id === "vibrant-pop");
  assert.ok(darkVibrant && brightVibrant);
  assert.ok(darkVibrant.grade.exposure > 0);
  assert.ok(darkVibrant.grade.exposure > brightVibrant.grade.exposure);
  assert.ok(
    darkVibrant.grade.vibrance >
      COLOR_GRADE_PRESETS.find((preset) => preset.id === "vibrant-pop")!.grade
        .vibrance,
  );

  const clean = dark.find((preset) => preset.id === "clean-studio");
  assert.ok(clean);
  assert.ok(clean.grade.temperature > 0);
  assert.ok(clean.grade.exposure > 0);
});

test("null stats fall back to the built-in looks", () => {
  const presets = synthesizeColorGradePresets(null);
  assert.deepEqual(
    presets.map((preset) => preset.grade),
    COLOR_GRADE_PRESETS.map((preset) => sanitizeColorGrade(preset.grade)),
  );
});
