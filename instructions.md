# FatahTech Subtitles — Setup, Run & Maintain

Operational guide for this repository: local AI subtitle generation with
Next.js 16, Transformers.js, and Mediabunny. Everything runs in the browser;
no media is uploaded to a server.

- [1. Prerequisites](#1-prerequisites)
- [2. Installation](#2-installation)
- [3. Running the application](#3-running-the-application)
- [4. Production build, tests, and lint](#4-production-build-tests-and-lint)
- [5. Running the dev server in the background](#5-running-the-dev-server-in-the-background)
- [6. Troubleshooting](#6-troubleshooting)
- [7. Repository map](#7-repository-map)

## 1. Prerequisites

### Node.js

| Requirement     | Value                       |
| --------------- | --------------------------- |
| **Minimum**     | **Node.js 20.9.0 or newer** |
| **Recommended** | Node.js 20 LTS or 22 LTS    |

Next.js 16 declares `"engines": { "node": ">=20.9.0" }`. Node 18 is **not**
supported and fails during install or build with engine/version errors. Check
your version with:

```bash
node --version
```

> Do not follow older Next.js guidance that says Node 18 is sufficient. That
> applied to Next.js 14/15; this project runs Next.js 16, which requires 20.9+.

### Package manager

Use **npm**. The repository ships a committed `package-lock.json` (lockfile v3),
and every command below assumes npm. `pnpm` and `yarn` will ignore the lockfile
resolution and are not supported here.

```bash
npm --version   # ships with Node
```

### Browser requirements

| Capability                           | Why it is needed                                 | Fallback                               |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------- |
| **WebGPU**                           | Fast Whisper inference (GPU)                     | Falls back to WASM/CPU automatically   |
| **WebCodecs**                        | Media decode/encode in the export path           | Mediabunny reports an error if missing |
| **WebGL / Canvas 2D**                | Video compositing, background removal, subtitles | —                                      |
| **Web Workers**                      | Whisper and MODNet run off the main thread       | —                                      |
| **Secure context** (HTTPS/localhost) | Camera and microphone capture                    | Required by browsers for media devices |

Recommended: **Chrome or Edge 113+** (full WebGPU). Firefox and Safari work
with the WASM/CPU inference path, which is noticeably slower on long videos.

### Network and disk

Model weights are downloaded on first use and then cached by the browser.
Budget roughly 75 MB (tiny), 150 MB (base, default), or 500 MB (small), plus
audio extraction and video decode buffers in memory. Nothing else is required
at runtime once models are cached.

## 2. Installation

Install exactly what the lockfile pins:

```bash
npm ci
```

`npm ci` deletes any existing `node_modules` and installs from the lockfile. It
is the correct command for both a fresh clone and repairing a broken tree.

### Repairing a corrupted `node_modules`

An interrupted or concurrently-run install can leave a **truncated tree** —
packages present but their `.d.ts` type files missing. The symptom is a wall of
spurious errors such as:

```
error TS7016: Could not find a declaration file for module 'mediabunny'.
```

TypeScript reports this for packages that are clearly installed. Fix it with a
clean reinstall:

```bash
rm -rf node_modules        # PowerShell: Remove-Item -Recurse -Force node_modules
npm ci
```

Verify the tree is sound before continuing:

```bash
npx tsc --noEmit
```

A healthy tree produces **no output**.

## 3. Running the application

### Standard development mode

```bash
npm run dev
```

Next.js (Turbopack) starts on **http://localhost:3000** by default. The server
hot-reloads on save.

### Custom or free port

If 3000 is already in use, choose any free port:

```bash
npm run dev -- -p 3001     # PowerShell and Bash
npm run dev -- --port 3001 # equivalent long form
```

To find a free port on Windows before starting:

```powershell
netstat -ano | Select-String ':3001\s+.*LISTENING'
```

### Turbopack cache issues — read this if you get 500s

`npm run build` and `npm run dev` share the `.next` directory. If you run a
production build and then start the dev server **without clearing `.next`**, the
dev server can reuse incompatible cached modules and fail while compiling
Google Fonts. The page returns **HTTP 500** with an error like:

```
Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
Import trace:
  [next]/internal/font/google/outfit_….module.css
  ./app/layout.tsx
```

**Fix:** stop the dev server and clear the cache, then restart.

```bash
# stop the dev server (Ctrl+C, or kill the PID — see section 5)
rm -rf .next
npm run dev -- -p 3001
```

Only `.next/dev` needs removing if you want to keep a production build intact:

```bash
rm -rf .next/dev
```

The same symptom can appear after pulling changes that alter `app/layout.tsx`
fonts. Clearing `.next` is always safe — it is a build cache, not source.

> Never commit `.next/`. It is already in `.gitignore`.

## 4. Production build, tests, and lint

Run these before every push. All must pass cleanly.

```bash
npm run build        # production build (also runs the TypeScript check)
npm test             # regression tests (node:test via tsx)
npm run lint         # ESLint, fails on any warning
npm run format:check # Prettier formatting check
```

Supporting commands:

```bash
npm start                    # serve the production build (run after npm run build)
npx tsc --noEmit             # types only, no emit
npm run format               # auto-fix formatting
```

### What each one covers

| Command                | Checks                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run build`        | Compiles with Turbopack, then type-checks; generates all 10 routes |
| `npm test`             | 123 tests across `tests/*.test.ts` (timing, rendering, media, ASR) |
| `npm run lint`         | `eslint --max-warnings=0` — zero tolerance for warnings            |
| `npm run format:check` | Prettier style, including Markdown files                           |

A few commands run for more than 30 seconds. If you are scripting them, run
them in the background and poll the log rather than assuming a timeout means
failure.

```bash
npm run build > build.log 2>&1; tail -n 20 build.log
```

## 5. Running the dev server in the background

Use a **detached** process so the terminal stays free, and record the PID so the
server can be stopped later.

### PowerShell (Windows)

```powershell
$p = Start-Process -FilePath "npm.cmd" `
  -ArgumentList 'run','dev','--','-p','3001' `
  -WorkingDirectory "I:\FatahTech Sub_Titles" `
  -RedirectStandardOutput "dev-server.log" `
  -RedirectStandardError  "dev-server.err.log" `
  -PassThru -WindowStyle Hidden

$p.Id | Out-File ".dev-server.pid"
Write-Host "Dev server PID: $($p.Id)"
```

### Bash (macOS / Linux)

```bash
nohup npm run dev -- -p 3001 > dev-server.log 2>&1 &
echo $! > .dev-server.pid
```

### Follow the log

```bash
tail -f dev-server.log          # Bash
Get-Content dev-server.log -Wait -Tail 20   # PowerShell
```

### Stop the server

Kill the whole process tree, not just the wrapper — `npm` spawns a child Node
process that keeps the port bound otherwise.

```powershell
$pid0 = Get-Content .dev-server.pid
taskkill /PID $pid0 /T /F
```

```bash
kill "$(cat .dev-server.pid)"
```

### Guidelines

- **Never block the terminal.** A foreground `npm run dev` ties up the session
  until interrupted.
- **Never kill ports you do not own.** Pick a free port (section 3) rather than
  terminating another process.
- **One server per port.** A second `npm run dev` on the same port fails to
  bind.
- **The log and PID files are disposable.** `dev-server.log`,
  `dev-server.err.log`, and `.dev-server.pid` are in `.gitignore`; delete them
  any time.

> **Windows caveat — verify results, not exit codes.** Windows PowerShell
> reports ordinary `git`/`npm` progress written to stderr as
> `NativeCommandError` and returns exit code 1 **even when the command
> succeeded**. A successful `git push` can look like a failure. Confirm the real
> outcome from the command's output or by inspecting state:
>
> ```powershell
> git rev-parse main; git rev-parse origin/main   # compare SHAs
> Get-Content dev-server.log -Tail 10
> ```

## 6. Troubleshooting

| Symptom                                                                         | Cause and fix                                                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 500 on `/` after a production build, `next/font/google` errors                  | Turbopack cache conflict — `rm -rf .next`, restart dev (section 3)                                        |
| Many `TS7016` "Could not find a declaration file" errors for installed packages | Truncated `node_modules` — `rm -rf node_modules && npm ci` (section 2)                                    |
| `EADDRINUSE` / server will not start                                            | Port taken — pick a free port or stop the owning process you own                                          |
| Manual subtitles render without highlights or effects                           | Ensure word timings exist; see `buildWordTimings` in `lib/subtitle-timing.ts`                             |
| Transcribed text disappears while ASR is still streaming                        | User-authored chunks must survive merges — see `mergeTranscriptionUpdate` in `lib/transcription-state.ts` |
| Camera or microphone blocked                                                    | Requires HTTPS or `localhost` plus explicit user permission                                               |
| "Slow filesystem detected" warning                                              | Benign on network/virtual drives; slows compilation only                                                  |
| `next dev` needs Google Fonts to compile                                        | First compile requires network access to `fonts.googleapis.com`                                           |

### Adding a Google Font

1. Add the import and instance in `app/layout.tsx`.
2. Add the CSS variable → canvas font name mapping in `lib/font-config.ts`.
3. Add the option in `components/subtitle-styling.tsx` (`FONT_FAMILIES`).

Keeping steps 2 and 3 in sync matters: the preview and export renderers resolve
font names through `lib/font-config.ts`, so a missing entry means the font is
correct on screen but wrong in the exported video.

## 7. Repository map

```
app/
  layout.tsx                  # Root layout: fonts, metadata, analytics
  page.tsx                    # Landing + editor entry
  worker.ts                   # Whisper transcription Web Worker
  bg-removal-worker.ts        # MODNet background removal Web Worker

components/
  main-app.tsx                # Editor shell; owns all app state
  transcript-sidebar.tsx      # Transcript list + "Add Subtitle" insertion
  video-upload.tsx            # Player + WebGL/canvas compositing preview
  video-caption.tsx           # DOM subtitle renderer (per-word effects)
  subtitle-styling.tsx        # Style panel, watermark toggle
  editor/                     # Timeline, timing controls, playback speed

lib/
  subtitle-timing.ts          # Timing edits + word-timing helpers
  transcript-utils.ts         # Phrase grouping, exports, re-exports
  render-subtitle.ts          # Canvas subtitle rendering (preview)
  export-renderer.ts          # Canvas subtitle rendering (export)
  silence-removal.ts          # Silence detection and output-time remapping
  transcription-state.ts      # ASR snapshot merge reducer
  font-config.ts              # CSS var -> canvas font name mapping

hooks/
  useTranscription.ts         # Whisper lifecycle and result state
  useVideoDownloadMediaBunny.ts  # Export pipeline
  useSubtitleTiming.ts        # Timing transactions, Undo, Reset

tests/                        # node:test suites, run by `npm test`
```

### Where subtitle effects live

Word-level effects (active-word highlighting, emphasis boxes, depth layering,
per-word styles) all read the `words` array on a transcript chunk. Three
helpers in `lib/subtitle-timing.ts` own that behavior:

| Helper              | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `buildWordTimings`  | Interpolate word windows across a chunk's `[start, end]` span |
| `resolveChunkWords` | Stored words, or synthetic ones when a chunk has none         |
| `updateChunkText`   | Rebuild words after an edit, preserving per-word styles       |

When adding a new render path, call `resolveChunkWords(chunk)` rather than
reading `chunk.words` directly. That keeps the "never render as unstyled plain
text" guarantee in one place.

## License

MIT — see [LICENSE](./LICENSE). Repository:
<https://github.com/THJ420/FatahTech_Subtitles.git>
