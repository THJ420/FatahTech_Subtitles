# Long-video transcription check

Checked locally on 2026-09-10 with a 1,284.949-second video containing 48 kHz
stereo AAC audio. The file was 30,296,647 bytes. The isolated Chromium session
reported an NVIDIA Ampere adapter and the worker confirmed WebGPU execution.

## Observations

- The video requires 64 windows with the existing 30-second window and
  5-second left/right overlap settings.
- Before the change, Base took 26.9 seconds from the transcribing event to the
  first update. The next six windows took 11.4, 8.5, 8.0, 7.6, 7.5, and
  10.1 seconds. Model loading and warmup were separate from these timings.
- A separate Node benchmark of the installed feature extractor took 16.7
  seconds to prepare 64 windows from the video's first 30 seconds. Retaining
  those feature tensors required 58.6 MiB. This measures preparation work,
  not full transcription time, and is not a browser timing measurement.
- After the change, Tiny produced its first update in 5.6 seconds. The next
  four windows took 8.1, 6.4, 4.9, and 8.3 seconds. Both the model and the code
  differ from the Base run, so this is not a controlled before/after benchmark.
- Both runs were stopped after collecting initial-window timings. No full-video
  completion time or accuracy score was measured. Speeds can change with speech,
  browser state, and competing GPU work.

## Change and validation

The worker now prepares features immediately before each generation call and
does not retain them with completed windows. It also reuses the last merged
transcript for completion. Model settings, overlap, and word timestamps are
unchanged. This reduces preparation before the first result and retained feature
memory; it does not remove the model's inference cost.

`transcription-streaming.test.ts` checks preparation/generation/update order,
window lengths, overlap boundaries, timestamp rounding, progress, and reuse of
the final result. All 116 tests, lint, and the production build passed. Next.js
reported no runtime or compilation errors during the browser checks.
