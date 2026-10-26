# Recording audio validation

Verified locally on 2026-09-10 with the app running in Chromium.

- Replaced microphone/camera input in the isolated browser session with a canvas
  video stream and a 440 Hz test tone at amplitude 0.25. No physical microphone
  was used.
- Recorded through the actual Record, Start recording, Stop recording, and review
  flow. Blocked the main thread for 100 ms every 250 ms during recording.
- A 48 kHz input produced a 24.405-second MP4 (615,446 bytes). The decoded tone's
  maximum adjacent-sample change was 0.014475, with no changes above 0.1.
- A 44.1 kHz input produced a 23.424-second MP4 (586,009 bytes). The decoded tone's
  maximum adjacent-sample change was 0.014526, with no changes above 0.1.
- Measurements exclude the first and last second to omit codec startup/tail
  effects. Both results match the expected smooth 440 Hz waveform after AAC
  encoding and conversion to 48 kHz.
- Automated tests check exact stereo sample order across block boundaries,
  partial-block flush on stop, silence, and exclusion of preview/after-stop audio.
- All 109 tests, TypeScript, lint for changed recording files, and the production
  build passed. Next.js reported no runtime errors.

These checks cover the capture and encoding path. Real microphone speech on the
reported PC and Mac still needs a listening check; this test does not prove the
cause of the original report or cover Safari's audio implementation.

## Release 2.7.0 follow-up

- Added controller tests for a normal final-block drain, stalled encoding,
  queue overflow, cancellation, a missing stop acknowledgement, and an encoder
  error while Stop is pending. Tests also check resource release, timer cleanup,
  and handling of a late encoder error.
- Capture shutdown and encoder drain share a 15-second deadline. The output
  object owns encoder finalization and cancellation; capture cleanup does not
  start another encoder flush. The failure UI does not wait for encoder cleanup.
- Rechecked Record → Start → Stop → review in Chromium with synthetic video and
  a 440 Hz tone. The resulting MP4 was 2,316,467 bytes. Browser decoding confirmed
  two audio channels, 36.907 seconds of audio, and a nonzero peak of 0.1154.
  This check confirms the normal recording path after the cleanup change; it is
  not a microphone quality or audio/video synchronization measurement.
- Confirmed that the running changelog page contains the 2.7.0 release entry.
