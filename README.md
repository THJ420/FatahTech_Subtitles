# FatahTech Subtitles

AI-powered subtitle generator that processes video and audio in your browser. No media uploads or accounts are required.

- Transcribes video audio using [Whisper.js](https://huggingface.co/docs/transformers.js) (WebGPU/WASM)
- Exports MP4 with subtitles baked in using [Mediabunny](https://mediabunny.dev/)
- Add subtitles manually at any time range, with the same styling as transcribed words
- Optional `subtitle.fatahtech.com` watermark, toggleable in the editor
- Caches downloaded models in the browser for reuse. Model files and other app assets require network access when they are not cached.

Repository: <https://github.com/THJ420/FatahTech_Subtitles.git>
Setup and maintenance guide: [instructions.md](./instructions.md)

Current release: **2.7.0**. See [CHANGELOG.md](./CHANGELOG.md) for release details.

## AI Models

All model inference runs locally in the browser. Video and audio are processed on your device; the app downloads model files as needed.

| Model                             | Task                                            | Library                                   |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| **Whisper** (tiny / base / small) | Speech-to-text transcription, 100+ languages    | `@huggingface/transformers` (WebGPU/WASM) |
| **Whisper Large-v3-Turbo**        | Fastest high-accuracy transcription, GPU only   | `@huggingface/transformers` (WebGPU)      |
| **Whisper Medium**                | Highest accuracy, GPU only                      | `@huggingface/transformers` (WebGPU)      |
| **MODNet** (`Xenova/modnet`)      | Background removal — person segmentation        | `@huggingface/transformers` (Web Worker)  |
| **MediaPipe Blaze Face**          | Real-time face detection for subtitle placement | `@mediapipe/tasks-vision`                 |

### Hardware capability check

Model sizes range from ~75 MB to ~1.5 GB. Loading a model larger than the device
can hold fails deep inside ONNX Runtime — after a long download, with an opaque
error. So the modal probes the browser **before any download starts** and greys
out models this machine cannot load:

| Probe                       | Source                                       |
| --------------------------- | -------------------------------------------- |
| WebGPU adapter              | `navigator.gpu.requestAdapter()`             |
| 16-bit float (fp16) support | `adapter.features.has("shader-f16")`         |
| GPU buffer ceiling          | `adapter.limits.maxBufferSize`               |
| GPU storage binding ceiling | `adapter.limits.maxStorageBufferBindingSize` |
| Logical CPU cores           | `navigator.hardwareConcurrency`              |
| System memory               | `navigator.deviceMemory` (Chromium only)     |

### fp16 fallback

`shader-f16` is an optional WebGPU feature. GTX 10-series GPUs and several
Intel/AMD integrated GPUs do not implement it, and ONNX Runtime refuses an fp16
graph at session creation with _"The device (webgpu) does not support fp16."_
Because dtype is fixed when the session is created, the encoder dtype is chosen
from the adapter at load time rather than hardcoded:

| Adapter reports      | Turbo / Medium encoder     |
| -------------------- | -------------------------- |
| `shader-f16` present | `fp16` (1,215 MB / 586 MB) |
| `shader-f16` absent  | `q4` (405 MB / 200 MB)     |

The non-fp16 path deliberately uses **q4, not fp32**. 4-bit weights dequantize
to fp32 on load, so no f16 arithmetic is involved — and fp32 is _larger_ than
fp16 (2,430 MB for the Turbo encoder alone), so falling back to fp32 would trade
a clear error for an out-of-memory crash on exactly the 2–4 GB cards this
fallback targets. `q4f16` is never used, since that dtype itself requires
`shader-f16`.

`lib/hardware-check.ts` keeps the thresholds in one table
(`MODEL_REQUIREMENTS`), so the UI and the runtime agree:

| Model  | Requirement                                          |
| ------ | ---------------------------------------------------- |
| Tiny   | Any device                                           |
| Base   | Any device                                           |
| Small  | WebGPU recommended; otherwise 4+ cores / 4 GB        |
| Turbo  | WebGPU; `maxBufferSize` ≥ 2 GB (fp16) or ≥ 1 GB (q4) |
| Medium | Same, plus ≥ 8 GB RAM when reported                  |

Buffer thresholds are the models' real ONNX footprints and therefore depend on
the fp16 path the device will take — the q4 encoder is roughly a third of fp16,
so a non-fp16 adapter is held to a **lower**, not higher, bar.

Unavailable models stay visible but non-interactive, with the reason shown
("WebGPU required", "Needs 1024 MB GPU buffer (have 256 MB)"). An **unknown**
value never blocks a user: `deviceMemory` is absent on Firefox and Safari, so
that constraint is only enforced when the browser actually reports it. An
unknown `shader-f16` result is treated as _unsupported_, since assuming fp16 is
safe is what produces the original error.

## Features

- **100% local** — audio never leaves your device
- **100+ languages** — Whisper multilingual models (tiny/base/small)
- **5 model sizes** — Tiny, Base, Small, Large-v3-Turbo, and Medium, auto-gated to what your hardware can run
- **25+ Google Fonts** — Bangers, Bebas Neue, Permanent Marker, Montserrat, and more
- **Manual subtitles** — add your own subtitle chunks at any time range; word timings are generated so all styles apply
- **Custom watermark** — optional `subtitle.fatahtech.com` mark, toggleable in the editor, burned into exports when on
- **Color & Light grading** — exposure, contrast, gamma, saturation, vibrance, temperature, tint, highlights and shadows, with footage-analyzed presets and saved looks
- **Per-word styling** — override font, size, color, and effects on individual words
- **Caption placement** — drag and resize captions, with local or global placement
- **Subtitle timing** — edit word or phrase start/end times, move subtitles on the timeline, and use Undo or Reset
- **Playback speed** — preview at 1×, 1.1×, 1.25×, or 1.5× with pitch preservation; export speed is unchanged
- **Emoji replace / overlay** — swap a word for an emoji or float one above it
- **Background removal** — AI person segmentation, runs locally via Web Worker
- **3D depth effect** — subtitles render behind or in front of the detected person
- **Face tracking** — MediaPipe Blaze Face, real-time EMA-smoothed position
- **Split subtitle mode** — phrase words placed above/below or left/right of the face
- **Display on Spoken** — words light up as each one is spoken (karaoke style)
- **Portrait / landscape** — 9:16 and 16:9 export with portrait zoom/crop
- **Stacked portrait** — two-person layouts with face tracking, swap, and face zoom
- **Silence removal** — detect and skip silent sections in playback and video export
- **Camera recording** — record up to five minutes, select a camera, and review before editing; audio capture runs on the audio thread with buffered AAC encoding
- **MP4 export** — baked subtitles, H.264 + AAC; desktop defaults to 30 fps, while mobile uses up to 24 fps and a 1280-pixel long edge
- **Transcript export** — download JSON, SRT, and WebVTT

### Edit subtitle timing

Select a subtitle on the timeline. Drag either edge to change its start or end, or drag the middle to move it. Arrow keys adjust timing by 0.01 seconds; Shift + Arrow adjusts it by 0.1 seconds. Exact-time fields accept seconds or `HH:MM:SS.mmm`.

Timing uses source-video seconds. Changes stay within the video and adjacent word limits. Edge edits enforce a minimum word duration of 0.02 seconds. In phrase mode, an edge edit changes the first or last word; moving a phrase preserves its word durations and gaps.

**Undo timing** restores the previous timing edit without changing text or styles. **Reset timing** restores original times if they do not overlap adjacent words. Timing changes do not move the original media ranges used to remove video sections.

### Manual subtitle insertion

Open the **Subtitles** tab and choose **Add Subtitle**. The form takes a start
time, an end time, and the subtitle text. Both time fields accept plain seconds
(`12.5`) or a timecode (`HH:MM:SS.mmm`); start time is pre-filled from the
playhead.

The new chunk is inserted and the transcript is re-sorted by start time, so
timeline markers and preview scrubbing stay in sync.

**Word timestamps.** Whisper emits one `{ text, timestamp: [start, end] }` entry
per spoken word (`return_timestamps: "word"`), and the renderers rely on that
`words` array to draw active-word highlighting, emphasis boxes, depth layers,
and per-word styles. A manually added chunk originally stored text only, which
forced the canvas and DOM renderers into an unstyled plain-text fallback.

`buildWordTimings` in `lib/subtitle-timing.ts` now splits the text into trimmed
words and interpolates each word's window across the chunk span:

- Windows are **adjacent** — no gaps and no overlaps between words.
- The **last word ends exactly at the chunk end**, so scrubbing stays glued to
  the timeline.
- Whitespace is normalized, so extra spaces never produce empty words.
- Invalid or inverted spans cannot produce `NaN` or backwards windows.

The result is that manually added lines receive the same treatment as
transcribed text. Chunks that carry explicit word timings also form their own
phrase during grouping, so a manual line never merges into neighbouring
transcribed words.

Editing a manual subtitle rebuilds its word timings across the chunk span while
preserving per-word styles and depth positions by index. Word timings are also
kept in sync through timeline moves, Undo, and silence-removal cut remapping.

Renderers call `resolveChunkWords`, which returns the stored words or
synthesizes them on the fly. A chunk without stored word timings can therefore
never render as unstyled plain text.

### Watermark

The watermark reads **`subtitle.fatahtech.com`** and is drawn from a single
`WATERMARK_TEXT` constant in `lib/export-renderer.ts`, so preview and export can
never drift apart.

It is **on by default** and controlled by a single `showWatermark` state, wired
into three render paths:

| Path                            | Behavior                           |
| ------------------------------- | ---------------------------------- |
| Live preview canvas loop        | Drawn each frame when enabled      |
| Live preview DOM overlay        | Shown when compositing is inactive |
| Export frame context (MP4/WebM) | Burned into the encoded file       |

Toggle it with **Show Watermark (subtitle.fatahtech.com)** in the **Video** tab, or from
the watermark switch in the **Style** tab. Turning it off omits the mark from
the preview _and_ the exported video — it is not a preview-only setting.

### ASR merge preservation

Transcription streams partial results, and each new snapshot is merged into
editor state by `mergeTranscriptionUpdate` in `lib/transcription-state.ts`.

Manually added subtitles are user-authored and never appear in a worker
snapshot, so the merge used to **drop them** on the next update — manual lines
silently disappeared while transcription was still running. They are now carried
forward and merged back into chronological order by start time. If an incoming
snapshot covers the same times, the ASR result wins.

## Getting Started

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To use a different port:

```bash
npm run dev -- -p 3001
```

```bash
npm run build   # production build
npm start       # serve the production build
npm test        # regression tests
npm run lint    # ESLint
npm run format:check # Prettier check
```

Requires **Node.js 20.9+**. See [instructions.md](./instructions.md) for
prerequisites, background server execution, and troubleshooting.

## Architecture

### Subtitle Generation

Whisper models run in a dedicated Web Worker (`app/worker.ts`) via `@huggingface/transformers`. Audio is extracted from the video file client-side and passed as a `Float32Array`. Cached model files can be reused; additional models and uncached assets still require downloads.

```
Video File → audio-utils → Float32Array → Whisper Worker → TranscriptChunks[]
```

Models available:
| Name | Size | Notes |
|------|------|-------|
| Tiny | ~75 MB | Fastest |
| Base | ~150 MB | Default |
| Small | ~500 MB | Most accurate on CPU |
| Turbo | ~800 MB | Large-v3-Turbo, WebGPU only, fp16 encoder |
| Medium | ~1.5 GB | Highest accuracy, WebGPU only, fp16 encoder |

Turbo and Medium use an **fp16 encoder** rather than the fp32 encoder used by the
smaller sizes. Their encoders are several times larger, and fp32 would exceed
typical GPU buffer limits. They also never fall back to the WASM/CPU path —
retrying a 1.5 GB model on CPU trades a clear error for an out-of-memory crash or
a stall that outlasts the download.

Model download progress is throttled before it crosses the worker boundary. A
1.5 GB download emits thousands of network-chunk events, and posting each one
floods the main thread with progress-bar renders.

#### Streaming transcription — how it works

The `@huggingface/transformers` ASR pipeline processes the whole audio then merges at the end, with no built-in way to get partial results per chunk. To support long videos and live previews, `app/worker.ts` replicates the pipeline's internal `_call_whisper` loop directly:

1. **Plan audio windows** using the same 30s window / 5s stride / 20s jump that the pipeline uses internally. Prepare features for one window immediately before generation, rather than preparing and retaining features for the whole video.
2. **Call `model.generate()`** on each chunk with:
   - `return_timestamps: true` — embeds timestamp tokens in the output sequence. `_decode_asr` requires these to detect where each chunk's usable region starts and ends (stride filtering via `first_timestamp` / `last_timestamp`). Without them, multi-chunk merging silently skips content.
   - `return_token_timestamps: true` — uses DTW cross-attention alignment to produce per-token timestamps, enabling word-level output from `_decode_asr`.
3. **Call `tokenizer._decode_asr(processedSoFar, { return_timestamps: "word" })`** after each chunk. This does stride-aware merging of all chunks processed so far and posts a partial `update` result to the main thread.
4. After all chunks are processed, reuse the last merged result as the complete transcript.

This approach gives accuracy identical to the single full pipeline call (same chunking math, same merge logic) while streaming word-level results chunk by chunk.

#### Why not use the high-level pipeline call?

`transcriber(audio, { chunk_length_s: 30, stride_length_s: 5 })` processes all chunks, then merges once at the end. The old `@xenova/transformers` library exposed a `chunk_callback` fired after each internal chunk; `@huggingface/transformers` does not. Replicating the internal loop is the only way to stream results.

### Background Removal

A dedicated background worker runs either **BiRefNet_lite** (`onnx-community/BiRefNet_lite-ONNX`, universal salient-object matting; default on WebGPU) or **MODNet** (`Xenova/modnet`, fast person matting; the CPU/WASM tier or explicit Person mode). Model and processing quality can be overridden in Video settings. On CPU, BiRefNet's published graph is fixed at 1024²; the worker detects that at load time and falls back to the Person model with a visible compatibility notice.

Masks are generated in a progressive two-pass run: a sparse coarse pass unlocks the preview, then the remaining samples refine. The budgeted `MaskStore` keeps mask memory bounded, and every matte is refined in the worker — percentile levelling, smoothstep thresholding, morphology, connected-component filtering, feathering and motion-gated temporal blending. Completed slabs are persisted in IndexedDB, keyed by file size, duration, model, sample rate and mask resolution, so reopening a clip can skip inference. **Re-analyze video** in the settings panel clears the cache and reruns the analysis.

Preview and export composite through the same `lib/bg-composite.ts` path and the same solid/blur/image/transparent fill resolver. Export never runs live inference; frames without a stored mask render the original frame and are reported in the export status.

```
Video Frames → BG Worker (BiRefNet / MODNet) → MaskStore → Compositor → Preview / Export
```

### Face Tracking

**MediaPipe Blaze Face** runs in the main thread, scanning frames at ~5fps. Position is smoothed with an EMA filter (α = 0.15). During export, a 150ms lookahead compensates for EMA phase lag.

### Rendering Pipeline

| Mode                          | How                                                            |
| ----------------------------- | -------------------------------------------------------------- |
| Plain preview                 | DOM `VideoCaption` component (CSS + HTML)                      |
| Compositing (BG removal / 3D) | Canvas loop → `lib/render-subtitle.ts`                         |
| Export                        | `hooks/useVideoDownloadMediaBunny.ts` internal canvas renderer |

The preview and export renderers share font resolution logic via `lib/font-config.ts`, and both draw the watermark from the same `WATERMARK_TEXT` constant, so preview and export stay visually identical.

### Color & Light

The Video tab exposes nine grading controls: exposure, contrast, gamma, saturation, vibrance, temperature, tint, highlights, and shadows. Grades are applied in linear light by a WebGL2 shader in `lib/color-grade-renderer.ts`; `lib/color-grade.ts` holds the same math as a pure CPU function so presets, swatches, and tests share one definition. Browsers without WebGL2 fall back to a Canvas 2D filter approximation for exposure, contrast, saturation, and temperature, and the UI disables the controls that cannot be represented.

Preview and export grade the composed footage exactly once, before any background or text, so subtitles and the watermark are never tinted. `solid` and `image` backgrounds are not graded; the blurred backdrop is, because it is derived from the footage. Stacked portrait composes both tiles first, then grades the result.

On import, `useFootageColorAnalysis` decodes five sampled frames with mediabunny and measures luminance, contrast, saturation, warmth, and tint. Those stats tune four looks — Vibrant Product Pop, Cinematic Teal & Orange, Warm Cinematic, and Clean Studio — shown as cards. The default stays Neutral. Custom looks are saved in `localStorage` under `fatahtech-subtitles:color-grade-presets:v1`.

### Video Export

Mediabunny renders each frame to an offscreen canvas, composites subtitles (and optionally masks), then encodes to MP4. Mobile exports use a maximum 1280-pixel long edge to reduce memory and encoding load.

```
Video + Subtitles + Masks → frame-by-frame canvas render → Mediabunny → MP4 download
```

### Camera audio

`public/audio/recording-processor.js` captures microphone samples in an AudioWorklet. `lib/recording-audio.ts` queues these samples for AAC encoding and flushes the final block when recording stops. Audio capture shutdown and encoder drain share a 15-second deadline. Failure or cancellation releases capture resources and reports an error.

Camera and microphone access require a secure browser context, such as HTTPS or localhost, and user permission. See [recording validation](./tests/RECORDING-AUDIO-VALIDATION.md) and [subtitle timing validation](./tests/SUBTITLE-TIMING-VALIDATION.md) for test scope and remaining device checks.

## Project Structure

```
app/
  page.tsx                    # Home page
  layout.tsx                  # Root layout (Google Fonts, analytics)
  worker.ts                   # Transcription Web Worker (Whisper)
  bg-removal-worker.ts        # Background removal Web Worker
  changelog/page.tsx          # Changelog page

components/
  main-app.tsx                # Main editor — all state lives here
  editor/                    # Timeline, playback speed, and timing controls
  video-upload.tsx            # Video player + compositing canvas
  video-caption.tsx           # DOM subtitle renderer
  subtitle-styling.tsx        # Style controls panel
  transcript-sidebar.tsx      # Editable transcript list
  word-style-popover.tsx      # Per-word style overrides
  landing-page/               # Landing page components
  ui/                         # shadcn/ui primitives

hooks/
  useTranscription.ts         # Whisper via Web Worker
  useBackgroundRemoval.ts     # BG removal via Web Worker
  useFootageColorAnalysis.ts  # Sampled-frame color stats + generated looks
  useCustomColorPresets.ts    # Saved color looks (localStorage)
  useFaceTracking.ts          # MediaPipe face detection
  useVideoDownloadMediaBunny.ts # Video export
  useCameraRecording.ts       # Camera input
  useSubtitleTiming.ts        # Timing transactions, Undo, and Reset

lib/
  color-grade.ts              # Grade model, presets, linear-light CPU math
  color-grade-renderer.ts     # WebGL2 grade pass + Canvas 2D fallback
  color-grade-analysis.ts     # Footage stats + preset synthesis
  color-grade-presets.ts      # Saved-look parsing and storage
  font-config.ts              # Shared font map (CSS vars → canvas names)
  render-subtitle.ts          # Canvas subtitle rendering (preview)
  export-renderer.ts          # Canvas subtitle rendering + watermark (export)
  person-tracking.ts          # Face position interpolation
  audio-utils.ts              # Audio extraction
  recording-audio.ts          # AudioWorklet capture and AAC queue
  subtitle-timing.ts          # Timing bounds, edits, reset, and word timings
  transcript-utils.ts         # Phrase grouping and subtitle exports
  silence-removal.ts          # Silence detection and output-time remapping
  transcription-state.ts      # ASR snapshot merge reducer
  utils.ts                    # Shared UI utilities
  changelog.ts                # Version history data
```

## Adding a Font

1. Add the Google Font import to `app/layout.tsx`
2. Add the CSS variable → font name entry to `lib/font-config.ts`
3. Add the font as an option in `components/subtitle-styling.tsx`

## Contributing

Pull requests are welcome. For larger changes, open an issue first to discuss
the approach. Repository: <https://github.com/THJ420/FatahTech_Subtitles.git>

```bash
npm run lint         # check for lint errors
npm test             # run regression tests
npm run build        # check the production build and TypeScript
npm run format:check # check formatting
npm run format       # auto-fix formatting
```

## Dependencies

| Package                     | Purpose                          |
| --------------------------- | -------------------------------- |
| `@huggingface/transformers` | Whisper AI transcription (local) |
| `@mediapipe/tasks-vision`   | Face detection                   |
| `mediabunny`                | MP4 video encoding               |
| `next`                      | React framework (v16)            |
| `react` / `react-dom`       | React v19                        |
| `@radix-ui/*`               | Accessible UI primitives         |
| `emoji-picker-react`        | Emoji picker                     |
| `lucide-react`              | Icons                            |
| `sonner`                    | Toast notifications              |
| `tailwindcss`               | Utility CSS (v4)                 |

## License

MIT — see [LICENSE](./LICENSE).
