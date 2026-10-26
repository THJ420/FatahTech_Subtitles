import { AudioSample, AudioSampleSource } from "mediabunny";
import { ensureAacEncoder } from "./aac-encoder";

/** Buffered audio capture, independent of the video/UI thread. */
export async function createRecordingAudio(track: MediaStreamTrack) {
  const numberOfChannels = Math.min(2, track.getSettings().channelCount || 1);
  const context = new AudioContext({ sampleRate: 48_000 });
  let node: AudioWorkletNode | undefined;
  let input: MediaStreamAudioSourceNode | undefined;
  let closed = false;
  let failure: unknown;
  let pending = Promise.resolve();
  let queuedFrames = 0;
  let acknowledgeStop: (() => void) | undefined;
  let activeSample: AudioSample | undefined;
  let interrupt: () => void;
  const interrupted = new Promise<void>((resolve) => {
    interrupt = resolve;
  });
  const fail = (error: unknown) => {
    failure = error;
    interrupt();
  };
  const source = new AudioSampleSource({ codec: "aac", bitrate: 192_000 });

  const close = () => {
    if (closed) return;
    closed = true;
    interrupt();
    acknowledgeStop?.();
    input?.disconnect();
    node?.disconnect();
    node?.port.close();
    void context.close().catch(() => {});
    activeSample?.close();
    activeSample = undefined;
    // Output.finalize()/cancel() owns the encoder. Closing the source here
    // starts a graceful flush, which can itself stall and block cancellation.
  };

  try {
    await context.resume();
    await context.audioWorklet.addModule("/audio/recording-processor.js");
    await ensureAacEncoder({
      bitrate: 192_000,
      numberOfChannels,
      sampleRate: context.sampleRate,
    });
    node = new AudioWorkletNode(context, "recording-processor", {
      channelCount: numberOfChannels,
      channelCountMode: "explicit",
      outputChannelCount: [1],
      processorOptions: { numberOfChannels },
    });
    node.onprocessorerror = () => {
      fail(new Error("Audio capture stopped. Please record the video again."));
    };
    node.port.onmessage = ({ data: message }) => {
      if (message.type === "stopped") {
        acknowledgeStop?.();
        return;
      }
      if (closed || failure || message.type !== "samples") return;
      const { data, frame, frames } = message as {
        data: Float32Array;
        frame: number;
        frames: number;
      };
      queuedFrames += frames;
      // Fail explicitly on a stalled encoder instead of silently dropping sound.
      if (queuedFrames > context.sampleRate * 30) {
        fail(
          new Error(
            "Audio encoding could not keep up. Please record a shorter video.",
          ),
        );
        return;
      }
      pending = pending.then(async () => {
        try {
          if (closed || failure) return;
          const sample = new AudioSample({
            data,
            format: "f32",
            numberOfChannels,
            sampleRate: context.sampleRate,
            timestamp: frame / context.sampleRate,
          });
          activeSample = sample;
          try {
            await source.add(sample);
          } finally {
            if (activeSample === sample) {
              sample.close();
              activeSample = undefined;
            }
          }
        } catch (error) {
          fail(error);
        } finally {
          queuedFrames -= frames;
        }
      });
    };
    input = context.createMediaStreamSource(new MediaStream([track]));
    input.connect(node);
    node.connect(context.destination);

    return {
      source,
      start() {
        node!.port.postMessage("start");
      },
      async finish() {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          if (failure) throw failure;
          if (closed)
            throw new DOMException("Recording cancelled.", "AbortError");
          // Bound both the worklet flush and the encoder drain. A stopped
          // worklet does not guarantee that source.add() will settle.
          await Promise.race([
            (async () => {
              await new Promise<void>((resolve) => {
                acknowledgeStop = resolve;
                node!.port.postMessage("stop");
              });
              await pending;
              if (failure) throw failure;
            })(),
            interrupted.then(() => {
              throw (
                failure ??
                new DOMException("Recording cancelled.", "AbortError")
              );
            }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Audio encoding did not finish. Please record a shorter video.",
                    ),
                  ),
                15_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
          close();
        }
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

export type RecordingAudio = Awaited<ReturnType<typeof createRecordingAudio>>;
