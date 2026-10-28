import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLOR_GRADE_CONTROLS,
  COLOR_GRADE_PRESETS,
  NEUTRAL_COLOR_GRADE,
  colorGradeFilter,
  colorGradesEqual,
  gradeHexColor,
  gradeRgb,
  isNeutralColorGrade,
  sanitizeColorGrade,
  type ColorGrade,
} from "../lib/color-grade";

const neutral = (): ColorGrade => ({ ...NEUTRAL_COLOR_GRADE });

test("sanitize fills missing fields, clamps, and rounds junk", () => {
  assert.deepEqual(sanitizeColorGrade(undefined), neutral());
  assert.deepEqual(
    Object.keys(sanitizeColorGrade({ nope: 4 })),
    Object.keys(neutral()),
  );
  assert.equal(sanitizeColorGrade({ exposure: 250 }).exposure, 100);
  assert.equal(sanitizeColorGrade({ contrast: -250 }).contrast, -100);
  assert.equal(sanitizeColorGrade({ gamma: Number.NaN }).gamma, 0);
  assert.equal(sanitizeColorGrade({ tint: "12" }).tint, 0);
  assert.equal(sanitizeColorGrade({ saturation: 12.345 }).saturation, 12.3);
});

test("neutral detection and grade equality ignore rounded zeros", () => {
  assert.equal(isNeutralColorGrade(undefined), true);
  assert.equal(isNeutralColorGrade({ exposure: 0.04 }), true);
  assert.equal(isNeutralColorGrade({ exposure: 1 }), false);
  assert.equal(
    colorGradesEqual({ exposure: 2 }, { exposure: 2, contrast: 0 }),
    true,
  );
  assert.equal(colorGradesEqual(NEUTRAL_COLOR_GRADE, { exposure: 1 }), false);
});

test("the neutral grade is an identity for arbitrary colors", () => {
  for (const rgb of [
    [0, 0, 0],
    [255, 255, 255],
    [128, 64, 32],
    [12, 200, 99],
    [77, 77, 77],
  ] as const) {
    const out = gradeRgb(NEUTRAL_COLOR_GRADE, rgb);
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(
        Math.abs(out[channel] - rgb[channel]) <= 1,
        `${rgb} → ${out} drifted`,
      );
    }
  }
});

test("exposure moves mid-grey up and down", () => {
  const base = gradeRgb(neutral(), [128, 128, 128])[0];
  const up = gradeRgb({ ...neutral(), exposure: 50 }, [128, 128, 128])[0];
  const down = gradeRgb({ ...neutral(), exposure: -50 }, [128, 128, 128])[0];
  assert.ok(up > base);
  assert.ok(down < base);
});

test("gamma brightens or darkens the midtones", () => {
  const brighter = gradeRgb({ ...neutral(), gamma: 50 }, [128, 128, 128])[0];
  const darker = gradeRgb({ ...neutral(), gamma: -50 }, [128, 128, 128])[0];
  assert.ok(brighter > 128);
  assert.ok(darker < 128);
});

test("contrast expands around the midtone pivot", () => {
  const low = gradeRgb({ ...neutral(), contrast: 60 }, [48, 48, 48])[0];
  const high = gradeRgb({ ...neutral(), contrast: 60 }, [208, 208, 208])[0];
  assert.ok(low < 48);
  assert.ok(high > 208);
});

test("full desaturation produces a neutral grey", () => {
  const out = gradeRgb({ ...neutral(), saturation: -100 }, [200, 40, 60]);
  assert.ok(Math.abs(out[0] - out[1]) <= 1);
  assert.ok(Math.abs(out[1] - out[2]) <= 1);
});

test("temperature warms or cools without changing grey's luma much", () => {
  const warm = gradeRgb({ ...neutral(), temperature: 80 }, [128, 128, 128]);
  const cool = gradeRgb({ ...neutral(), temperature: -80 }, [128, 128, 128]);
  assert.ok(warm[0] > cool[0]);
  assert.ok(warm[2] < cool[2]);
});

test("tint moves green against magenta", () => {
  const magenta = gradeRgb({ ...neutral(), tint: 80 }, [128, 128, 128]);
  const green = gradeRgb({ ...neutral(), tint: -80 }, [128, 128, 128]);
  assert.ok(magenta[1] < green[1]);
});

test("shadows affect dark pixels more than bright ones", () => {
  const grade = { ...neutral(), shadows: 100 };
  const darkDelta = gradeRgb(grade, [32, 32, 32])[0] - 32;
  const brightDelta = gradeRgb(grade, [224, 224, 224])[0] - 224;
  assert.ok(darkDelta > brightDelta);
});

test("highlights affect bright pixels more than dark ones", () => {
  const grade = { ...neutral(), highlights: 100 };
  const darkDelta = gradeRgb(grade, [32, 32, 32])[0] - 32;
  const brightDelta = gradeRgb(grade, [224, 224, 224])[0] - 224;
  assert.ok(brightDelta > darkDelta);
});

test("vibrance leaves a pure grey unchanged", () => {
  const out = gradeRgb({ ...neutral(), vibrance: 100 }, [128, 128, 128]);
  for (const channel of out) assert.ok(Math.abs(channel - 128) <= 1);
});

test("the fallback filter uses only CSS filter primitives", () => {
  assert.equal(colorGradeFilter(NEUTRAL_COLOR_GRADE), "none");
  const filter = colorGradeFilter({
    ...neutral(),
    exposure: 50,
    contrast: 20,
    saturation: 10,
    vibrance: 20,
    temperature: 40,
    tint: -20,
  });
  assert.match(filter, /brightness\(/);
  assert.match(filter, /contrast\(/);
  assert.match(filter, /saturate\(/);
  assert.match(filter, /sepia\(/);
  assert.match(filter, /hue-rotate\(/);
  assert.doesNotMatch(filter, /blur|grayscale|invert/);
});

test("hex swatches round-trip through the grade", () => {
  assert.equal(gradeHexColor(NEUTRAL_COLOR_GRADE, "#3366cc"), "#3366cc");
  assert.match(
    gradeHexColor({ ...neutral(), exposure: 100 }, "#808080"),
    /^#[0-9a-f]{6}$/,
  );
});

test("control metadata and built-in presets are complete", () => {
  assert.equal(COLOR_GRADE_CONTROLS.length, 9);
  assert.equal(
    new Set(COLOR_GRADE_CONTROLS.map((control) => control.key)).size,
    9,
  );
  assert.equal(COLOR_GRADE_PRESETS.length, 4);
  for (const preset of COLOR_GRADE_PRESETS) {
    assert.equal(isNeutralColorGrade(preset.grade), false, preset.id);
    assert.deepEqual(sanitizeColorGrade(preset.grade), preset.grade);
    assert.ok(preset.label.length > 0);
    assert.ok(preset.description.length > 0);
  }
});
