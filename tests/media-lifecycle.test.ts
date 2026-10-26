import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  seekVideo,
  waitForMediaEvent,
  withAbortSignal,
} from "../lib/media-lifecycle";
import { extractAudioFromVideo } from "../lib/audio-utils";

class FakeVideo extends EventTarget {
  readyState = 2;
  seeking = false;
  listeners = new Set<EventListenerOrEventListenerObject>();
  time = 0;
  onSeek: (() => void) | null = null;

  get currentTime() {
    return this.time;
  }
  set currentTime(time: number) {
    this.time = time;
    this.seeking = true;
    this.onSeek?.();
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    if (listener) this.listeners.add(listener);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    if (listener) this.listeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  asVideo() {
    return this as unknown as HTMLVideoElement;
  }
}

test("media seek waits for the decoded frame rather than the new currentTime", async () => {
  const video = new FakeVideo();
  let settled = false;
  const pending = seekVideo(video.asVideo(), 2).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(video.currentTime, 2);
  assert.equal(settled, false);
  video.dispatchEvent(new Event("seeked"));
  await pending;
  assert.equal(video.listeners.size, 0);
});

test("media seek registers its listener before changing the time", async () => {
  const video = new FakeVideo();
  video.onSeek = () => video.dispatchEvent(new Event("seeked"));
  await seekVideo(video.asVideo(), 2);
  assert.equal(video.listeners.size, 0);
});

test("a ready frame at the requested time needs no seek", async () => {
  const video = new FakeVideo();
  await seekVideo(video.asVideo(), 0);
  assert.equal(video.seeking, false);
  assert.equal(video.listeners.size, 0);
});

test("cancel during a media wait rejects and removes all listeners", async () => {
  const video = new FakeVideo();
  const controller = new AbortController();
  const pending = seekVideo(video.asVideo(), 2, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(video.listeners.size, 0);
});

test("media failure and timeout remove all listeners", async () => {
  const failed = new FakeVideo();
  const pending = waitForMediaEvent(failed.asVideo(), "loadeddata");
  failed.dispatchEvent(new Event("error"));
  await assert.rejects(pending, /could not be loaded/);
  assert.equal(failed.listeners.size, 0);

  const timedOut = new FakeVideo();
  await assert.rejects(
    waitForMediaEvent(timedOut.asVideo(), "loadeddata", { timeoutMs: 5 }),
    /too long/,
  );
  assert.equal(timedOut.listeners.size, 0);
});

test("an aborted load does not start and late failures remain handled", async () => {
  const video = new FakeVideo();
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(
    waitForMediaEvent(video.asVideo(), "loadeddata", {
      signal: controller.signal,
      start: () => {
        started = true;
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(started, false);
  await assert.rejects(
    withAbortSignal(
      Promise.reject(new Error("late failure")),
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("audio extraction closes its context on cancellation and ignores late decode results", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let finishDecode!: (value: AudioBuffer) => void;
  let decodeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    decodeStarted = resolve;
  });
  let closeCount = 0;
  class FakeAudioContext {
    state = "suspended";
    decodeAudioData() {
      decodeStarted();
      return new Promise<AudioBuffer>((resolve) => {
        finishDecode = resolve;
      });
    }
    async close() {
      this.state = "closed";
      closeCount++;
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
  });
  try {
    const controller = new AbortController();
    const pending = extractAudioFromVideo(
      new File(
        [
          new Uint8Array(
            await readFile(new URL("./fixtures/speech.mp4", import.meta.url)),
          ),
        ],
        "test.mp4",
      ),
      controller.signal,
    );
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(closeCount, 1);
    finishDecode({} as AudioBuffer);
    await Promise.resolve();
    assert.equal(closeCount, 1);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
