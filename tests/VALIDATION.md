# Upgrade validation — 2026-09-08

Environment: Windows, Node.js 24.19.0, Chrome, Next.js 16.3.4, Mediabunny 1.56.0.

## Automated checks

- ESLint: zero errors and zero warnings. The lint command now fails on warnings.
- TypeScript and production build: pass.
- Repository formatting check: pass.
- Media regression suite: 11 tests pass.
- npm audit: zero known vulnerabilities at the time of the check.
- Sharp: PNG encoding passes with the patched 0.35.4 package. The override also removes the vulnerable Sharp version required by Transformers 3.x.

## Browser and media checks

- Real English transcription with the Tiny model: passes with the generated speech fixture.
- Production transcription cancellation and restart: passes.
- Phrase editing: the saved text appears in downloaded SRT and WebVTT files.
- Landscape MP4 export: H.264, 1080 × 608, 48,000 Hz AAC. Video duration matches the source at 9.6 seconds.
- Portrait export with Left / Right subtitles, auto zoom, and default silence removal: H.264, 608 × 1080, 48,000 Hz AAC. Three silence ranges are removed; video duration falls to 7.63 seconds.
- Both exported MP4 files decode fully without errors. Extracted frames show baked-in subtitles.
- Export cancellation returns control to the editor. A subsequent export completes.
- After the cleanup fix, cancellation followed by forced browser garbage collection produces no audio sample leak warning. Next.js reports no runtime errors.
- Camera recording, stop, review, and acceptance: pass with Chrome's simulated camera and microphone. The recorded video loads with no media error.
- Mobile viewport at 390 × 844: no horizontal overflow; the video, export controls, and style controls render.
- Production home and changelog routes load.

## Fixes found through browser testing

- Resample export audio to 48,000 Hz. Windows Chrome rejects AAC encoding of the fixture's original 22,050 Hz audio.
- Keep a download blob alive after the link click so the browser can read it asynchronously.
- Close the current audio sample even when export cancellation stops the audio loop.

## Limits

Camera testing used simulated devices. Physical phones, Safari, long 4K files, and background-removal output quality were not tested. MediaPipe emits internal capability warnings in Chrome; these are separate from the clean project lint result. These checks do not establish a speed improvement or guarantee every browser and codec combination.

The app was tested locally and was not deployed.
