import { withAbortSignal } from "./media-lifecycle";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class NoAudioDetectedError extends Error {
  constructor(reason: "missing-track" | "silent") {
    super(
      reason === "missing-track"
        ? "No audio detected. This video has no audio track. Choose a video with speech to add subtitles."
        : "No audio detected. The audio track is silent. Choose a video with speech to add subtitles.",
    );
    this.name = "NoAudioDetectedError";
  }
}

async function checkAudioTrack(videoFile: File, signal?: AbortSignal) {
  // Read container metadata before decoding or loading a speech model. A failed
  // decoder cannot tell us whether audio is absent or its codec is unsupported.
  const loading = import("mediabunny");
  const { Input, BlobSource, ALL_FORMATS } = await (signal
    ? withAbortSignal(loading, signal)
    : loading);
  signal?.throwIfAborted();
  const input = new Input({
    source: new BlobSource(videoFile),
    formats: ALL_FORMATS,
  });
  const disposeInput = () => input.dispose();
  signal?.addEventListener("abort", disposeInput, { once: true });
  try {
    const reading = input.getAudioTracks();
    const tracks = await (signal ? withAbortSignal(reading, signal) : reading);
    signal?.throwIfAborted();
    if (tracks.length === 0) throw new NoAudioDetectedError("missing-track");
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof NoAudioDetectedError) throw error;
    throw new Error(
      "The audio in this video could not be read. The file may be damaged or use an unsupported format. Try another video.",
      { cause: error },
    );
  } finally {
    signal?.removeEventListener("abort", disposeInput);
    input.dispose();
  }
}

export async function extractAudioFromVideo(
  videoFile: File,
  signal?: AbortSignal,
): Promise<Float32Array> {
  signal?.throwIfAborted();
  await checkAudioTrack(videoFile, signal);
  let buffer: ArrayBuffer;
  try {
    const reading = videoFile.arrayBuffer();
    buffer = await (signal ? withAbortSignal(reading, signal) : reading);
  } catch (error) {
    signal?.throwIfAborted();
    const message =
      error instanceof DOMException && error.name === "NotReadableError"
        ? "The video file could not be read. Please try recording again or choose a saved video file."
        : `The video file could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`;
    throw new Error(message);
  }

  // Create audio context with specific sample rate
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 16000,
  });
  const closeContext = () => {
    if (audioContext.state !== "closed")
      void audioContext.close().catch(() => {});
  };
  signal?.addEventListener("abort", closeContext, { once: true });

  try {
    // Decode audio data
    const decoding = audioContext.decodeAudioData(buffer);
    const audioBuffer = await (signal
      ? withAbortSignal(decoding, signal)
      : decoding);
    signal?.throwIfAborted();

    if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
      throw new Error("The audio track has no readable samples.");
    }

    // Check the source channels, not the mono mix: opposite stereo channels can
    // cancel during mixing even though the source is not silent. Only exact
    // digital silence qualifies; quiet speech must still reach the model.
    let hasSignal = false;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const samples = audioBuffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(samples[i])) {
          throw new Error("The audio track contains invalid samples.");
        }
        if (samples[i] !== 0) hasSignal = true;
      }
    }
    if (!hasSignal) throw new NoAudioDetectedError("silent");

    // Handle stereo vs mono
    if (audioBuffer.numberOfChannels === 2) {
      // Merge channels for stereo
      const SCALING_FACTOR = Math.sqrt(2);
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      const audio = new Float32Array(left.length);

      for (let i = 0; i < audioBuffer.length; ++i) {
        audio[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2;
      }

      return audio;
    } else {
      // Use the first channel for mono
      const audio = audioBuffer.getChannelData(0).slice();
      return audio;
    }
  } catch (e) {
    signal?.throwIfAborted();
    if (e instanceof NoAudioDetectedError) throw e;
    throw new Error(
      "The audio in this video could not be decoded. Its audio format may not be supported, or the file may be damaged. Try another video.",
      { cause: e },
    );
  } finally {
    signal?.removeEventListener("abort", closeContext);
    if (audioContext.state !== "closed")
      await audioContext.close().catch(() => {});
  }
}
