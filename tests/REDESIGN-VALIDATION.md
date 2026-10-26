# Redesign validation — 2026-09-08

Environment: Windows, Node.js 24.19, Chrome 152, Next.js 16.3.4.

## Automated checks

- All 45 regression tests pass, including model download accounting, audio detection, phase changes, crop tracking, and removed-section timing.
- ESLint passes with zero warnings.
- Formatting, TypeScript, and the production build pass.

## Landing page and editor

- The landing page was checked at 1536 × 1024, 768 × 1024, and 390 × 844. No horizontal overflow or broken images were found.
- File selection, file drop, recording, and section links work.
- The production home and changelog routes load. Upload, language selection, Tiny transcription with WebGPU, and the subtitle panel pass in the production build with no browser console errors.
- The editor was checked at desktop width 1536 and mobile width 390. No horizontal overflow was found.
- Axe reports zero violations on the landing page and editor. The final editor scan has 37 passes and 3 incomplete checks that require manual review.

## Subtitles and export

- The speech fixture transcribes with the Tiny model and WebGPU.
- The edit “Hello redesigned world” appears in JSON, SRT, WebVTT, and the exported MP4 frame.
- Hide, remove, and restore work. Range merging no longer changes source timestamps. Hidden words no longer suppress adjacent visible words.
- Subtitle downloads omit removed sections and adjust the remaining timestamps.
- Landscape export with a removed phrase produces H.264 video at 1080 × 608 with 48,000 Hz AAC audio. Its duration is 8.866667 seconds, compared with the 9.6-second source.
- Portrait export with split subtitles, auto zoom, and silence removal produces 608 × 1080 video with a duration of 7.633333 seconds.
- Three exported MP4 files decode fully without errors. Exported frames were inspected.
- Export cancellation and retry pass, including export with background removal. The background model loads, and the original video background can be restored.

## Resource cleanup and recording

- Reset leaves no dedicated workers. Garbage collection produces no resource leak errors.
- Camera checks used simulated devices. Five camera acquisitions created ten tracks; all ten tracks ended. All four recording object URLs were revoked.
- Start, stop, review, use recording, record again, cancel, and Escape pass without exceptions.

## Loading and editor layout follow-up

- Fixed the progress conversion that treated 1% as 100%. Download progress now uses the combined file sizes when known. Model setup and GPU warmup have separate status messages and an indeterminate progress bar.
- Loading has a spinner. GPU warmup is limited to two generated tokens. Canceling model loading and starting again produces a complete transcription.
- The updated production build completes a real Tiny transcription. Loading animations run normally and stop when reduced motion is enabled. The loading accessibility scan reports zero violations after a text contrast fix.
- At 1440 × 900, the sidebar and editor column both run from y=92 to y=884. At 1280 × 720, both end at y=704. The sidebar scrolls internally; the desktop page has no overflow.
- Across five video positions with and without active captions, the desktop timeline stays at y=632 and the mobile timeline stays at y=520. The word-edit row stays 32 pixels high.
- A production playback check recorded 25 samples across six phrases and subtitle gaps. Timeline movement was zero pixels.
- Portrait preview, paused seek, aspect-ratio changes, window resize, and new-video reload show valid canvas pixels. The source video remains visible while the canvas starts.
- The editor accessibility scan still reports zero violations. The development server reports no compilation or runtime errors.

## Cached models, silent video, and camera controls

- Transformers.js uses browser caching by default. A fresh Tiny WebGPU worker became ready in 3.3 seconds with all Hugging Face model fetches blocked. It reused 119,699,015 bytes of model files. Model files are cached per app origin, browser profile, model size, and device variant. Cleared or unavailable storage can require another download. The separate ONNX runtime file uses normal HTTP caching.
- Model initialization and GPU warmup still run in each new worker. Termination releases model memory without deleting cached files. Loading copy now says "Loading model files" because the library emits download progress for cached reads too.
- Audio is checked before the speech worker starts. Missing audio and digital silence produce a normal notice; quiet speech remains valid. Damaged or unsupported audio has a separate format error.
- The in-app browser showed the normal no-audio notice for a 3-second WebM with no audio and no stored duration. The player displayed 0:03, remained usable, and a later speech MP4 transcribed correctly.
- The final production build shows the same no-audio notice and duration. Choose another video returns directly to file selection. The camera panel has no horizontal overflow at a 390-pixel viewport.
- Packet timestamps provide the missing WebM duration. End seeking no longer changes the precise duration to the final frame timestamp; nonfinite values never appear in the controls.
- Video → Camera contains the visible Track person switch and background removal. Tracking is available for a landscape video cropped to 9:16. Both switch states pass; background removal starts, cancels, retries, completes, and restores from the sidebar.
- The preview has no background-removal button or overlapping handwritten note. Soft blue and yellow oval backgrounds were checked in the desktop layout.

## Original editor options

- Audited every original style, word, transcript, video, and export control against `HEAD`. The mapping and original conditions are recorded in [editor-feature-parity.md](../docs/editor-feature-parity.md).
- Style now shows Person effects directly after presets: Off, Top / Bottom, Left / Right, and Text behind person. Depth can prepare its masks directly. Behind/front size and position controls remain available, and the transcript labels each word Front or Behind.
- The first automatic Behind word now changes to Front with one click and back with one more click. This was checked in the browser. Original text editing, removal, word styles, emoji, and download handlers remain intact.
- Video → Camera contains independent crop tracking, background removal, solid color, color selection, and blur. Turning crop tracking off no longer clears split subtitles or permits subtitle tracking to move the crop. Both crop states were visually checked on a moving-person video with Top / Bottom and background compositing enabled.
- Left / Right resets to Off when switching to 9:16. The portrait control is disabled with an explanation. Top / Bottom retains its original fixed placement; no vertical head tracking was added.
- Person-effect preparation disables both export buttons. Cancel, retry, completion, and return to enabled export were checked in the production build.
- A 9.603-second moving-person WebM with speech and no stored duration transcribed and completed background/depth processing. Native video duration was still Infinity before a portrait export; face analysis and export completed using the known packet duration. The H.264/AAC MP4 is 608 × 1080 and 9.633333 seconds, and fully decodes without errors. Depth text was inspected in an exported frame.
- Normal captions use the same DOM overlay with or without background replacement. Both measured 12px in the small preview; depth text still uses its canvas layers. Export font sizes remain unchanged.
- The new controls and expanded panel were checked at a 390-pixel viewport with no horizontal overflow.
- Left / Right was checked during playback on the moving-person fixture. Text appears on both sides of the tracked face. Seeking while paused can retain the previous phrase's face position until playback advances, as in the original editor.
- Export face detection found the person in all 20 sample frames. Sparse export samples previously applied the live-preview smoothing factor per sample and caused excessive delay. Smoothing now uses elapsed time. At 4.8 seconds, the calculated crop center moved from 0.504 to 0.676 for a detected face at 0.693. Regression tests cover movement in both directions and disabled crop tracking.
- The rebuilt production app completed a second portrait depth export with the timing fix. The MP4 fully decodes, and the 4.8-second frame now keeps the face centered. The final browser session reports no errors.
- One initial model fetch on the production origin failed. Manual retry succeeded without reselecting the video. Recognized model network failures now have connection and retry guidance; they do not trigger an unrelated CPU fallback. Completed model files stay cached.
- The development server reports no compilation or runtime errors. React inspection confirms the landing view and lazy editor mount correctly. The hero image produces a non-blocking eager-loading warning.

## Subtitle size and silence playback follow-up

- Added Extra small at a 12px base size. Existing 16/22/28 stops and preset values remain. Browser selection confirmed 12px.
- Advanced options is a permanent section without a disclosure. The loading progress bar was checked as yellow in the browser.
- Silence removal reports detection, active preview/export cuts and time saved, no matches, and Off. A new selection clears previous cuts while computing; a failed change returns to Off.
- Playback uses the current seek state instead of an 80ms timer. Paused editing and export seeks are not intercepted. Preview uses the export cut boundaries without early skipping or an extra 30ms trim. Regression coverage includes speech gaps and cut ends.
- The speech fixture produced three cuts and saved 2.0 seconds. Playback advanced across a cut from 3.12 to 4.63 seconds and remained playing. This checks continuation, not zero decode latency for all codecs.
- Export with Extra small and Default silence removal completed. The H.264/AAC output is 1080 × 608 and 7.633333 seconds, reduced from the 9.6-second source. The complete file decodes without errors.
- All 45 tests, TypeScript, ESLint, and the production build pass.

## Limits and artifacts

- Physical devices, Safari, and long 4K videos were not tested.
- Background removal and depth were checked on a moving test video made from the existing generated creator image. This does not establish quality across natural footage or different lighting conditions.
- MediaPipe capability warnings and harmless already-canceled warnings remain in the browser logs.
- These checks do not guarantee that every browser and codec combination works or that no memory leak can occur.
- Asset sources are recorded in [design-assets.md](../docs/design-assets.md).
- Test artifacts remain in ignored output directories. They are not part of the source changes.
