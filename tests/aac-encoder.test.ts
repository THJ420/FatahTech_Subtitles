import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureAacEncoder } from "../lib/aac-encoder";

test("native AAC stays available; unsupported stereo AAC exports through software", async () => {
  const {
    ALL_FORMATS,
    AudioSample,
    AudioSampleSource,
    BufferSource,
    BufferTarget,
    Input,
    Mp4OutputFormat,
    Output,
  } = await import("mediabunny");
  const original = Object.getOwnPropertyDescriptor(globalThis, "AudioEncoder");
  const configs: AudioEncoderConfig[] = [];
  Object.defineProperty(globalThis, "AudioEncoder", {
    configurable: true,
    value: class {
      static async isConfigSupported(config: AudioEncoderConfig) {
        configs.push(config);
        return { supported: config.bitrate === 128_000 };
      }
    },
  });
  try {
    const settings = { numberOfChannels: 2, sampleRate: 48_000 };
    await ensureAacEncoder({ ...settings, bitrate: 128_000 });
    assert.equal(configs.length, 1);
    // A different, unsupported configuration must still reach the native check.
    await Promise.all([
      ensureAacEncoder({ ...settings, bitrate: 256_000 }),
      ensureAacEncoder({ ...settings, bitrate: 256_000 }),
    ]);
    assert.equal(configs.at(-1)?.codec, "mp4a.40.2");
    assert.equal(configs.at(-1)?.bitrate, 256_000);

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new AudioSampleSource({ codec: "aac", bitrate: 256_000 });
    output.addAudioTrack(source);
    await output.start();
    const data = Float32Array.from(
      { length: 48_000 * 2 },
      (_, i) =>
        0.1 * Math.sin((2 * Math.PI * 440 * Math.floor(i / 2)) / 48_000),
    );
    const sample = new AudioSample({
      ...settings,
      data,
      format: "f32",
      timestamp: 0,
    });
    try {
      await source.add(sample);
      source.close();
      await output.finalize();
    } finally {
      sample.close();
    }
    assert.ok(target.buffer && target.buffer.byteLength > 1000);
    const input = new Input({
      source: new BufferSource(target.buffer),
      formats: ALL_FORMATS,
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      assert.ok(track);
      assert.equal(track.codec, "aac");
      assert.equal(await track.getNumberOfChannels(), 2);
      assert.equal(await track.getSampleRate(), 48_000);
      assert.ok((await track.computeDuration()) >= 0.9);
    } finally {
      input.dispose();
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "AudioEncoder", original);
    else Reflect.deleteProperty(globalThis, "AudioEncoder");
  }
});
