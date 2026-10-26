import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTimelineSeekQueue,
  timelineTimeAtPointer,
  timelineZoomScroll,
  timelineTickStep,
} from "../lib/timeline";

class SeekableVideo extends EventTarget {
  readyState = 2;
  seeking = false;
  time = 0;
  targets: number[] = [];
  get currentTime() {
    return this.time;
  }
  set currentTime(time: number) {
    this.time = time;
    this.targets.push(time);
    this.seeking = true;
  }
  decoded() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
  asVideo() {
    return this as unknown as HTMLVideoElement;
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("timeline scrubbing accounts for scrolling and clamps both ends", () => {
  assert.equal(timelineTimeAtPointer(450, 200, 1200, 100, 77), 14.5);
  assert.equal(timelineTimeAtPointer(50, 200, 0, 100, 77), 0);
  assert.equal(timelineTimeAtPointer(900, 200, 7600, 100, 77), 77);
});
test("zoom retains the anchor position and bounds the viewport", () => {
  assert.equal(timelineZoomScroll(12, 200, 100, 7700, 900), 1000);
  assert.equal(timelineZoomScroll(0, 200, 100, 7700, 900), 0);
  assert.equal(timelineZoomScroll(77, 0, 100, 7700, 900), 6800);
  assert.equal(timelineZoomScroll(12, 200, 10, 770, 900), 0);
  assert.equal(timelineTickStep(120), 1);
  assert.equal(timelineTickStep(10), 10);
});
test("rapid seeks decode only the current and latest requested frames", async () => {
  const video = new SeekableVideo();
  const queue = createTimelineSeekQueue(
    video.asVideo(),
    new AbortController().signal,
  );
  queue.request(1);
  for (let i = 2; i <= 80; i++) queue.request(i / 10);
  const finished = queue.finish(8.125);
  assert.deepEqual(video.targets, [1]);
  video.decoded();
  await flush();
  assert.deepEqual(video.targets, [1, 8.125]);
  video.decoded();
  await finished;
  assert.equal(video.currentTime, 8.125);
  assert.equal(video.seeking, false);
});
test("seek queue restarts after idle and does not miss microtask requests", async () => {
  const video = new SeekableVideo();
  const queue = createTimelineSeekQueue(
    video.asVideo(),
    new AbortController().signal,
  );
  queue.request(0);
  await Promise.resolve();
  queue.request(2);
  await flush();
  assert.deepEqual(video.targets, [2]);
  video.decoded();
  await queue.finish(2);
  queue.request(3);
  const finished = queue.finish(3);
  video.decoded();
  await finished;
  assert.deepEqual(video.targets, [2, 3]);
});
test("cancelled scrub stops pending seeks and reports cancellation", async () => {
  const video = new SeekableVideo();
  const controller = new AbortController();
  const queue = createTimelineSeekQueue(video.asVideo(), controller.signal);
  queue.request(1);
  queue.request(2);
  controller.abort();
  await assert.rejects(queue.finish(3), { name: "AbortError" });
  video.decoded();
  assert.deepEqual(video.targets, [1]);
});
test("decode failure stops the queue and reports the error", async () => {
  const video = new SeekableVideo();
  const queue = createTimelineSeekQueue(
    video.asVideo(),
    new AbortController().signal,
  );
  queue.request(1);
  const finished = queue.finish(4);
  video.dispatchEvent(new Event("error"));
  await assert.rejects(finished, /could not be loaded or decoded/);
  assert.deepEqual(video.targets, [1]);
});
