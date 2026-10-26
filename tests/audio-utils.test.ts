import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  extractAudioFromVideo,
  NoAudioDetectedError,
} from "../lib/audio-utils";

async function fixture(name: string) {
  return new File(
    [
      new Uint8Array(
        await readFile(new URL(`./fixtures/${name}`, import.meta.url)),
      ),
    ],
    name,
  );
}

async function withAudioContext(
  decode: () => Promise<AudioBuffer>,
  check: (getCloseCount: () => number) => Promise<void>,
) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let closeCount = 0;
  class FakeAudioContext {
    state = "suspended";
    decodeAudioData = decode;
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
    await check(() => closeCount);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function decodedAudio(...channels: Float32Array[]): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (channel: number) => channels[channel],
  } as AudioBuffer;
}

test("a WebM without an audio track returns a no-audio outcome before decoding", async () => {
  let decodeCount = 0;
  await withAudioContext(
    async () => {
      decodeCount++;
      throw new Error("Decoder must not start for missing audio");
    },
    async (getCloseCount) => {
      await assert.rejects(
        extractAudioFromVideo(await fixture("no-audio.webm")),
        (error) =>
          error instanceof NoAudioDetectedError &&
          error.message.includes("no audio track"),
      );
      assert.equal(decodeCount, 0);
      assert.equal(getCloseCount(), 0);
    },
  );
});

test("a corrupt container is not classified as missing audio", async () => {
  await assert.rejects(
    extractAudioFromVideo(new File([new Uint8Array(8)], "broken.mp4")),
    (error) =>
      error instanceof Error &&
      !(error instanceof NoAudioDetectedError) &&
      error.message.includes("damaged or use an unsupported format"),
  );
});

test("digital silence is a no-audio outcome and releases the audio context", async () => {
  await withAudioContext(
    async () => decodedAudio(new Float32Array(160)),
    async (getCloseCount) => {
      await assert.rejects(
        extractAudioFromVideo(await fixture("speech.mp4")),
        (error) =>
          error instanceof NoAudioDetectedError &&
          error.message.includes("audio track is silent"),
      );
      assert.equal(getCloseCount(), 1);
    },
  );
});

test("quiet audio is preserved without a silence threshold", async () => {
  const samples = new Float32Array([0, 0.00000001, -0.00000001]);
  await withAudioContext(
    async () => decodedAudio(samples),
    async (getCloseCount) => {
      const result = await extractAudioFromVideo(await fixture("speech.mp4"));
      assert.deepEqual(result, samples);
      assert.notEqual(result, samples);
      assert.equal(getCloseCount(), 1);
    },
  );
});

test("opposite stereo channels are not classified as source silence", async () => {
  await withAudioContext(
    async () => decodedAudio(new Float32Array([0.5]), new Float32Array([-0.5])),
    async (getCloseCount) => {
      const result = await extractAudioFromVideo(await fixture("speech.mp4"));
      assert.equal(result.length, 1);
      assert.equal(getCloseCount(), 1);
    },
  );
});

test("a present but undecodable audio track gets a format error, not a silence notice", async () => {
  await withAudioContext(
    async () => {
      throw new DOMException("Unable to decode audio data", "EncodingError");
    },
    async (getCloseCount) => {
      await assert.rejects(
        extractAudioFromVideo(await fixture("speech.mp4")),
        (error) =>
          error instanceof Error &&
          !(error instanceof NoAudioDetectedError) &&
          error.message.includes("audio format may not be supported"),
      );
      assert.equal(getCloseCount(), 1);
    },
  );
});
