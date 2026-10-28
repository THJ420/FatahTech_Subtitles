import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_REMOVAL_WARNING_SECONDS,
  getBackgroundRemovalWarningDuration,
} from "../lib/background-removal-warning";
import { formatTime } from "../lib/transcript-utils";

test("a 1:29 video does not show the long-video warning", () => {
  assert.equal(getBackgroundRemovalWarningDuration(89, 89), null);
  assert.equal(getBackgroundRemovalWarningDuration(89, 180), null);
});

test("the warning starts only above the model-aware threshold", () => {
  const threshold = BACKGROUND_REMOVAL_WARNING_SECONDS;
  assert.equal(getBackgroundRemovalWarningDuration(threshold, threshold), null);
  assert.equal(
    getBackgroundRemovalWarningDuration(threshold + 0.1, threshold + 0.1),
    threshold + 0.1,
  );
  const duration = getBackgroundRemovalWarningDuration(157, 180);
  assert.equal(duration, 157);
  assert.equal(formatTime(duration!), "2:37");
});

test("unavailable metadata uses a valid fallback without inventing a duration", () => {
  for (const native of [NaN, Infinity, 0, -1]) {
    assert.equal(getBackgroundRemovalWarningDuration(native, 89), null);
    assert.equal(getBackgroundRemovalWarningDuration(native, 157), 157);
    for (const fallback of [NaN, Infinity, 0, -1]) {
      assert.equal(getBackgroundRemovalWarningDuration(native, fallback), null);
    }
  }
});
