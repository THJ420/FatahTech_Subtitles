import { test } from "node:test";
import assert from "node:assert/strict";
import { getBackgroundRemovalWarningDuration } from "../lib/background-removal-warning";
import { formatTime } from "../lib/transcript-utils";

test("a 1:37 video does not show the long-video warning", () => {
  assert.equal(getBackgroundRemovalWarningDuration(97, 97), null);
  assert.equal(getBackgroundRemovalWarningDuration(97, 180), null);
});

test("the warning starts only above two minutes and keeps seconds", () => {
  assert.equal(getBackgroundRemovalWarningDuration(60, 60), null);
  assert.equal(getBackgroundRemovalWarningDuration(119.9, 119.9), null);
  assert.equal(getBackgroundRemovalWarningDuration(120, 120), null);
  assert.equal(getBackgroundRemovalWarningDuration(120.1, 120.1), 120.1);
  const duration = getBackgroundRemovalWarningDuration(157, 180);
  assert.equal(duration, 157);
  assert.equal(formatTime(duration!), "2:37");
});

test("unavailable metadata uses a valid fallback without inventing a duration", () => {
  for (const native of [NaN, Infinity, 0, -1]) {
    assert.equal(getBackgroundRemovalWarningDuration(native, 97), null);
    assert.equal(getBackgroundRemovalWarningDuration(native, 157), 157);
    for (const fallback of [NaN, Infinity, 0, -1]) {
      assert.equal(getBackgroundRemovalWarningDuration(native, fallback), null);
    }
  }
});
