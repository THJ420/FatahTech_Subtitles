import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

test("transcription prepares one window per update and preserves overlap and word timing", async () => {
  const events: string[] = [];
  const windows: number[] = [];
  const strides: number[][] = [];
  const messages: Array<{
    status: string;
    progress?: number;
    result?: unknown;
  }> = [];
  let handleMessage: (event: unknown) => Promise<void> = async () => {};
  let decoded = 0;
  const processor = Object.assign(
    async (audio: Float32Array) => {
      events.push("prepare");
      windows.push(audio.length);
      return { input_features: { firstSample: audio[0] } };
    },
    {
      feature_extractor: {
        config: { sampling_rate: 16000, hop_length: 160, chunk_length: 30 },
      },
    },
  );
  const transcriber = {
    processor,
    model: {
      config: { max_source_positions: 1500 },
      async generate(config: {
        inputs: { firstSample: number };
        num_frames: number;
        return_token_timestamps: boolean;
        return_timestamps: boolean;
      }) {
        events.push("generate");
        assert.equal(config.inputs.firstSample, (windows.length - 1) * 20);
        assert.equal(config.num_frames, Math.floor(windows.at(-1)! / 160));
        assert.equal(config.return_token_timestamps, true);
        assert.equal(config.return_timestamps, true);
        return {
          sequences: { tolist: () => [[BigInt(windows.length)]] },
          token_timestamps: { tolist: () => [[0.126, 0.987]] },
        };
      },
    },
    tokenizer: {
      _decode_asr(
        chunks: Array<{ stride: number[]; token_timestamps: number[] }>,
      ) {
        decoded++;
        for (const chunk of chunks)
          assert.equal("input_features" in chunk, false);
        strides.push([...chunks.at(-1)!.stride]);
        assert.deepEqual([...chunks.at(-1)!.token_timestamps], [0.13, 0.99]);
        return [
          "speech",
          { chunks: [{ text: "speech", timestamp: [0.13, 0.99] }] },
        ];
      },
    },
  };
  const source = ts.transpileModule(readFileSync("app/worker.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  runInNewContext(source, {
    exports: {},
    require: (name: string) => {
      if (name === "@huggingface/transformers")
        return { pipeline: async () => transcriber };
      if (name.endsWith("transcription-progress"))
        return { ModelDownloadTracker: class {} };
      return { isModelNetworkError: () => false };
    },
    self: {
      addEventListener(_name: string, handler: typeof handleMessage) {
        handleMessage = handler;
      },
      postMessage(message: (typeof messages)[number]) {
        messages.push(message);
        if (message.status === "update") events.push("update");
      },
    },
    performance,
    console,
  });
  const audio = new Float32Array(65 * 16000);
  audio[20 * 16000] = 20;
  audio[40 * 16000] = 40;
  await handleMessage({
    data: {
      type: "run",
      data: { audio, language: "en", device: "wasm", modelSize: "base" },
    },
  });
  assert.deepEqual(events, [
    "prepare",
    "generate",
    "update",
    "prepare",
    "generate",
    "update",
    "prepare",
    "generate",
    "update",
  ]);
  assert.deepEqual(windows, [480000, 480000, 400000]);
  assert.deepEqual(strides, [
    [30, 0, 5],
    [30, 5, 5],
    [25, 5, 0],
  ]);
  assert.deepEqual(
    messages.filter((m) => m.status === "update").map((m) => m.progress),
    [33, 67, 100],
  );
  assert.equal(decoded, 3);
  assert.equal(messages.at(-1)?.status, "complete");
  assert.deepEqual(messages.at(-1)?.result, messages.at(-2)?.result);
});
