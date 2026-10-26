/* global AudioWorkletProcessor, registerProcessor */

// Capture on the audio thread. Video rendering must not interrupt the samples.
class RecordingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.numberOfChannels;
    this.size = 2048;
    this.buffer = new Float32Array(this.size * this.channels);
    this.length = 0;
    this.frames = 0;
    this.active = false;
    this.port.onmessage = ({ data }) => {
      if (data === "start") this.active = true;
      if (data === "stop") {
        this.active = false;
        this.flush();
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  flush() {
    if (!this.length) return;
    const data = this.buffer.slice(0, this.length * this.channels);
    this.port.postMessage(
      { type: "samples", data, frame: this.frames, frames: this.length },
      [data.buffer],
    );
    this.frames += this.length;
    this.length = 0;
  }

  process(inputs, outputs) {
    // The output stays silent: never play the microphone through the speakers.
    if (!this.active) return true;
    const input = inputs[0] ?? [];
    const frames = input[0]?.length ?? outputs[0]?.[0]?.length ?? 128;
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        this.buffer[this.length * this.channels + channel] =
          input[channel]?.[frame] ?? input[0]?.[frame] ?? 0;
      }
      this.length++;
      if (this.length === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor("recording-processor", RecordingProcessor);
