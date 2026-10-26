# Timeline validation — 2026-09-09

## Scope

- One draggable playhead runs across the ruler, subtitles, and video track.
- The separate bottom seek slider is removed. The horizontal scrollbar pans the tracks.
- Zoom controls and Fit keep source timestamps aligned. Fit also works after a resize.
- Subtitle clips wrap text. Only clips near the visible range are rendered.
- Dragging near an edge scrolls the timeline. Playback follows the playhead.
- The seek queue allows one decode at a time and keeps the latest pointer position.
- Native video playback and the existing silence/removed-word cut plan remain in use.
- Real thumbnails come from a separate Mediabunny input. Their generation does not seek the preview video.

## Automated checks

- `npm run lint`: no errors or warnings.
- `npm test`: 51 tests pass, including six new timeline tests.
- `npm run format:check`: passes.
- `npm run build`: production build and TypeScript checks pass.
- Next.js runtime and compilation checks: no errors.

The new tests cover pointer coordinates after scrolling, timeline boundaries, zoom anchoring, rapid seek coalescing, an idle/microtask race, cancellation, and decode failure. Existing tests cover silence cuts, removed words, subtitle exports, and media cleanup.

## Browser checks

Tested with Chrome on Windows, using agent-browser and the Next.js runtime endpoint. The source was a 77.092-second MP4 made by looping `tests/fixtures/speech.mp4`. Subtitles were generated with the real Tiny model. No transcription or media responses were mocked.

- Ruler seek past one minute: requested 65 seconds; reached 64.999 seconds.
- Paused dragging stayed paused. Dragging during playback resumed playback on release.
- Zoom preserved the current time and screen anchor. Fit showed the whole video.
- Home, End, frame stepping, and Shift+ArrowLeft worked. End reached 77.092 seconds.
- Playback showed 57 distinct playhead positions in 57 sampled display frames over one second. This is a local observation, not a guarantee for all hardware or codecs.
- Edge dragging scrolled 178 pixels and decoded the released position.
- Sixteen real thumbnails loaded without seeking the preview.
- Subtitle text edits appeared in the timeline. Hide, remove, and restore worked. Removing a subtitle section added it to the cut plan; restoring it removed that cut.
- Default silence removal produced 24 cuts and a planned output duration of 59.830 seconds. Paused scrubbing reached 1.205 seconds inside a cut. Resuming playback skipped to 1.700 seconds, past the cut end at 1.680 seconds.
- Desktop: 1586 × 992. Mobile: 390 × 844. No horizontal page overflow. Fit remained active after resizing. Zoomed subtitle text was visible without vertical clipping.
- Timeline accessibility check: no automatic violations after correcting text contrast. Ruler contrast also received a manual check because its tick background needs manual review.
- Browser console: no application errors.

## Export check

A real browser download completed after subtitle editing and silence removal. The H.264/AAC MP4 was 9,971,340 bytes, with a video duration of 59.867 seconds at 30 fps. The export is 37 ms longer than the cut plan (less than two frames). FFmpeg decoded the entire file without errors. The source has a shorter audio track than video; the export retains that difference.

Screenshots and the exported test video are in the ignored `test-results/` directory.

## References

The thumbnail input uses [Mediabunny's media reading API](https://mediabunny.dev/guide/reading-media-files). Sparse thumbnail extraction follows [CanvasSink and canvasesAtTimestamps](https://mediabunny.dev/guide/media-sinks), with a bounded image count and a one-canvas pool.
