import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

interface Block {
  type: string;
  data: Float32Array;
  frame: number;
  frames: number;
}

interface ProcessorInstance {
  port: { onmessage: (event: { data: string }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}
type ProcessorConstructor = new (options: {
  processorOptions: { numberOfChannels: number };
}) => ProcessorInstance;

function createProcessor(channels: number) {
  const messages: Block[] = [];
  let Processor: ProcessorConstructor | undefined;
  runInNewContext(readFileSync("public/audio/recording-processor.js", "utf8"), {
    AudioWorkletProcessor: class {
      port = {
        postMessage(message: Block) {
          messages.push(message);
        },
        onmessage: undefined,
      };
    },
    registerProcessor(_name: string, constructor: ProcessorConstructor) {
      Processor = constructor;
    },
    Float32Array,
  });
  assert.ok(Processor);
  const processor = new Processor({
    processorOptions: { numberOfChannels: channels },
  });
  return { processor, messages };
}

test("capture keeps stereo samples continuous across blocks and flushes the last partial block", () => {
  const { processor, messages } = createProcessor(2);
  const count = 48_000 + 73;
  const left = Float32Array.from(
    { length: count },
    (_, i) => 0.3 * Math.sin((i * 2 * Math.PI * 440) / 48_000),
  );
  const right = Float32Array.from(left, (value) => -value);
  processor.port.onmessage({ data: "start" });
  for (let offset = 0; offset < count; offset += 128) {
    processor.process(
      [[left.slice(offset, offset + 128), right.slice(offset, offset + 128)]],
      [],
    );
  }
  processor.port.onmessage({ data: "stop" });
  assert.equal(messages.at(-1)?.type, "stopped");
  let frame = 0;
  for (const block of messages.filter(
    (message) => message.type === "samples",
  )) {
    assert.equal(block.frame, frame);
    for (let i = 0; i < block.frames; i++) {
      assert.equal(block.data[i * 2], left[frame + i]);
      assert.equal(block.data[i * 2 + 1], right[frame + i]);
    }
    frame += block.frames;
  }
  assert.equal(frame, count);
});

test("capture excludes preview audio, preserves silence, and stops after the flush", () => {
  const { processor, messages } = createProcessor(1);
  const signal = [[new Float32Array(128).fill(0.5)]];
  processor.process(signal, []);
  processor.port.onmessage({ data: "start" });
  processor.process(signal, []);
  processor.process([], [[new Float32Array(128)]]);
  processor.port.onmessage({ data: "stop" });
  processor.process(signal, []);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].frames, 256);
  assert.deepEqual(
    messages[0].data.slice(0, 128),
    new Float32Array(128).fill(0.5),
  );
  assert.deepEqual(messages[0].data.slice(128), new Float32Array(128));
});

// Run the actual capture controller with browser/encoder substitutes. Timers
// advance explicitly so a stuck encoder never makes the test itself hang.
async function createCapture() {
  let onMessage: (event: { data: Partial<Block> }) => void = () => {};
  let resolveEncoding: () => void = () => {};
  let rejectEncoding: (error: Error) => void = () => {};
  const encoding = new Promise<void>((resolve, reject) => {
    resolveEncoding = resolve;
    rejectEncoding = reject;
  });
  const timers = new Map<number, () => void>();
  const released = {
    context: 0,
    source: 0,
    input: 0,
    node: 0,
    port: 0,
    sample: 0,
  };
  const moduleExports = {} as typeof import("../lib/recording-audio");
  const code = ts.transpileModule(
    readFileSync("lib/recording-audio.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(code, {
    exports: moduleExports,
    require: (name: string) =>
      name === "mediabunny"
        ? {
            AudioSample: class {
              close() {
                released.sample++;
              }
            },
            AudioSampleSource: class {
              add() {
                return encoding;
              }
              close() {
                released.source++;
              }
            },
          }
        : { ensureAacEncoder: async () => {} },
    AudioContext: class {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      async resume() {}
      async close() {
        released.context++;
      }
      createMediaStreamSource() {
        return {
          connect() {},
          disconnect() {
            released.input++;
          },
        };
      }
    },
    AudioWorkletNode: class {
      port = {
        set onmessage(handler: typeof onMessage) {
          onMessage = handler;
        },
        postMessage() {},
        close() {
          released.port++;
        },
      };
      connect() {}
      disconnect() {
        released.node++;
      }
    },
    MediaStream: class {},
    DOMException,
    setTimeout(callback: () => void, delay: number) {
      timers.set(delay, callback);
      return delay;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  });
  const capture = await moduleExports.createRecordingAudio({
    getSettings: () => ({ channelCount: 1 }),
  } as MediaStreamTrack);
  return {
    capture,
    timers,
    released,
    resolveEncoding,
    rejectEncoding,
    samples(frames = 2048) {
      onMessage({
        data: {
          type: "samples",
          data: new Float32Array(frames),
          frame: 0,
          frames,
        },
      });
    },
    stopped() {
      onMessage({ data: { type: "stopped" } });
    },
  };
}

function assertReleased(
  released: Awaited<ReturnType<typeof createCapture>>["released"],
) {
  assert.deepEqual(released, {
    context: 1,
    source: 0,
    input: 1,
    node: 1,
    port: 1,
    sample: 1,
  });
}

test("recording drains the final audio block before releasing resources", async () => {
  const run = await createCapture();
  const finished = run.capture.finish();
  run.samples();
  run.stopped();
  await Promise.resolve();
  assert.equal(run.released.source, 0);
  run.resolveEncoding();
  await finished;
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
});

test("stalled audio encoding times out and releases resources after the worklet stops", async () => {
  const run = await createCapture();
  run.samples();
  await Promise.resolve();
  const finished = run.capture.finish();
  const rejected = assert.rejects(finished, /Audio encoding did not finish/);
  run.stopped();
  await Promise.resolve();
  assert.ok(run.timers.has(15_000));
  run.timers.get(15_000)!();
  await rejected;
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
  // A late encoder error must remain handled and must not close samples twice.
  run.rejectEncoding(new Error("Late encoder error"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assertReleased(run.released);
});

test("queue overflow rejects finish without waiting for a stalled encoder", async () => {
  const run = await createCapture();
  run.samples();
  await Promise.resolve();
  run.samples(48_000 * 30);
  await assert.rejects(
    run.capture.finish(),
    /Audio encoding could not keep up/,
  );
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
});

test("cancelling a recording interrupts a pending finish and clears its deadline", async () => {
  const run = await createCapture();
  run.samples();
  await Promise.resolve();
  const rejected = assert.rejects(run.capture.finish(), { name: "AbortError" });
  run.capture.close();
  await rejected;
  run.capture.close();
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
});

test("missing worklet stop acknowledgement is bounded by the same deadline", async () => {
  const run = await createCapture();
  run.samples();
  await Promise.resolve();
  const rejected = assert.rejects(
    run.capture.finish(),
    /Audio encoding did not finish/,
  );
  run.timers.get(15_000)!();
  await rejected;
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
});

test("encoder failure interrupts finish even before the worklet acknowledges stop", async () => {
  const run = await createCapture();
  run.samples();
  await Promise.resolve();
  const rejected = assert.rejects(run.capture.finish(), /Encoder failed/);
  run.rejectEncoding(new Error("Encoder failed"));
  await rejected;
  assertReleased(run.released);
  assert.equal(run.timers.size, 0);
});
