import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CUSTOM_COLOR_PRESETS,
  parseCustomColorPresets,
  serializeCustomColorPresets,
  upsertCustomColorPreset,
  validateColorPresetName,
  type CustomColorPreset,
} from "../lib/color-grade-presets";
import { NEUTRAL_COLOR_GRADE } from "../lib/color-grade";

test("malformed storage reads as an empty list", () => {
  assert.deepEqual(parseCustomColorPresets(null), []);
  assert.deepEqual(parseCustomColorPresets("not json"), []);
  assert.deepEqual(parseCustomColorPresets("{}"), []);
  assert.deepEqual(parseCustomColorPresets("[]"), []);
});

test("invalid and neutral entries are dropped", () => {
  const raw = JSON.stringify([
    { id: "a", name: "Warm", grade: { exposure: 10 }, createdAt: 1 },
    { id: "", name: "No id", grade: { exposure: 10 }, createdAt: 2 },
    { id: "b", name: "", grade: { exposure: 10 }, createdAt: 3 },
    { id: "c", name: "Neutral", grade: {}, createdAt: 4 },
    "nope",
    null,
  ]);
  const parsed = parseCustomColorPresets(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Warm");
  assert.deepEqual(parsed[0].grade, { ...NEUTRAL_COLOR_GRADE, exposure: 10 });
});

test("duplicate names are collapsed case-insensitively", () => {
  const raw = JSON.stringify([
    { id: "1", name: "Warm", grade: { exposure: 10 }, createdAt: 1 },
    { id: "2", name: "  warm ", grade: { exposure: 20 }, createdAt: 2 },
  ]);
  const parsed = parseCustomColorPresets(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "1");
});

test("stored lists are capped", () => {
  const raw = JSON.stringify(
    Array.from({ length: MAX_CUSTOM_COLOR_PRESETS + 8 }, (_, index) => ({
      id: `id-${index}`,
      name: `Look ${index}`,
      grade: { exposure: index + 1 },
      createdAt: index,
    })),
  );
  assert.equal(parseCustomColorPresets(raw).length, MAX_CUSTOM_COLOR_PRESETS);
});

test("serialize and parse round-trip a look", () => {
  const presets: CustomColorPreset[] = [
    {
      id: "a",
      name: "  Look  ",
      grade: { ...NEUTRAL_COLOR_GRADE, contrast: 12 },
      createdAt: 5,
    },
  ];
  const roundTripped = parseCustomColorPresets(
    serializeCustomColorPresets(presets),
  );
  assert.equal(roundTripped.length, 1);
  assert.equal(roundTripped[0].name, "Look");
  assert.deepEqual(roundTripped[0].grade, {
    ...NEUTRAL_COLOR_GRADE,
    contrast: 12,
  });
});

test("upsert replaces a look with the same name", () => {
  const existing: CustomColorPreset[] = [
    {
      id: "a",
      name: "Warm",
      grade: { ...NEUTRAL_COLOR_GRADE, exposure: 10 },
      createdAt: 1,
    },
  ];
  const next = upsertCustomColorPreset(existing, {
    id: "b",
    name: "warm",
    grade: { ...NEUTRAL_COLOR_GRADE, exposure: 20 },
    createdAt: 2,
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "b");
  assert.equal(next[0].name, "warm");
  assert.equal(next[0].grade.exposure, 20);
});

test("preset names are validated", () => {
  assert.equal(validateColorPresetName(""), "Give this look a name.");
  assert.equal(validateColorPresetName("   "), "Give this look a name.");
  assert.match(validateColorPresetName("x".repeat(33)) ?? "", /32 characters/);
  assert.equal(validateColorPresetName("Golden hour"), null);
});
