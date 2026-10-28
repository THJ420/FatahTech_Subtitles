import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BG_QUALITY_PRESETS,
  DEFAULT_QUALITY_TIER,
  getBgQualityPreset,
  isBgQualityTier,
} from "../lib/bg-quality";

test("every quality tier exposes the promised resolution and sample rate", () => {
  const byId = new Map(BG_QUALITY_PRESETS.map((preset) => [preset.id, preset]));

  assert.equal(byId.get("fast")?.maskShortSide, 384);
  assert.equal(byId.get("fast")?.sampleFps, 6);
  assert.equal(byId.get("balanced")?.maskShortSide, 512);
  assert.equal(byId.get("balanced")?.sampleFps, 8);
  assert.equal(byId.get("quality")?.maskShortSide, 1024);
  assert.equal(byId.get("quality")?.sampleFps, 12);
});

test("tiers trade storage budget for accuracy in ascending order", () => {
  const [fast, balanced, quality] = BG_QUALITY_PRESETS;

  assert.ok(fast.maskBudgetBytes < balanced.maskBudgetBytes);
  assert.ok(balanced.maskBudgetBytes < quality.maskBudgetBytes);
  assert.ok(fast.processMaxDim < quality.processMaxDim);
});

test("balanced keeps the default smoothstep chain", () => {
  assert.deepEqual(getBgQualityPreset("balanced").alpha, {});
});

test("fast disables morphology and quality strengthens it", () => {
  const fast = getBgQualityPreset("fast");
  const quality = getBgQualityPreset("quality");

  assert.equal(fast.alpha.openRadius, 0);
  assert.equal(fast.alpha.closeRadius, 0);
  assert.ok((quality.alpha.openRadius ?? 0) > 0);
  assert.ok((quality.alpha.closeRadius ?? 0) > 0);
  assert.ok((quality.alpha.featherRadius ?? 0) > 1);
});

test("the default tier is balanced", () => {
  assert.equal(DEFAULT_QUALITY_TIER, "balanced");
  assert.equal(getBgQualityPreset(DEFAULT_QUALITY_TIER).recommended, true);
});

test("an unknown tier falls back to balanced", () => {
  assert.equal(
    getBgQualityPreset("cinematic" as Parameters<typeof getBgQualityPreset>[0])
      .id,
    "balanced",
  );
});

test("the tier guard accepts only the three supported values", () => {
  for (const value of ["fast", "balanced", "quality"]) {
    assert.equal(isBgQualityTier(value), true);
  }
  for (const value of ["", "auto", null, 6, undefined]) {
    assert.equal(isBgQualityTier(value), false);
  }
});
