# How to Start and Close FatahTech Subtitles

This guide details how to control the server in both **Foreground (Standard Terminal)** mode and **Background (Detached)** mode.

---

## Method 1: Standard Terminal Mode (Quickest)

Use this method when working directly inside VS Code or a terminal session where you don't mind keeping a tab open.

### 1. Start the App
Run either of the following commands in your project root terminal:

* **Default port (3000):**
  ```bash
  npm run dev
  ```
* **Custom port (3001) — Recommended if 3000 is occupied:**
  ```bash
  npm run dev -- -p 3001
  ```

Once started, open your browser and navigate to `http://localhost:3000` (or `http://localhost:3001`).

### 2. Stop/Close the App
* In the terminal running the dev server, press **`Ctrl + C`**.
* Type `y` if prompted to terminate the batch job, then hit **Enter**.

---

## Method 2: Background / Detached Mode (Keeps Terminal Free)

Use this method if you want the app running in the background without locking up your terminal window.

### Windows (PowerShell)

#### Start in Background:
```powershell
$p = Start-Process -FilePath "npm.cmd" `
  -ArgumentList 'run','dev','--','-p','3001' `
  -WorkingDirectory $PSScriptRoot `
  -RedirectStandardOutput "dev-server.log" `
  -RedirectStandardError  "dev-server.err.log" `
  -PassThru -WindowStyle Hidden

$p.Id | Out-File ".dev-server.pid"
Write-Host "Server running on http://localhost:3001 (PID: $($p.Id))"
```

#### Stop/Close Background Process:
```powershell
$pid0 = Get-Content .dev-server.pid
taskkill /PID $pid0 /T /F
```

---

### Linux / macOS (Bash)

#### Start in Background:
```bash
nohup npm run dev -- -p 3001 > dev-server.log 2>&1 &
echo $! > .dev-server.pid
echo "Server running on http://localhost:3001 (PID: $(cat .dev-server.pid))"
```

#### Stop/Close Background Process:
```bash
kill "$(cat .dev-server.pid)"
```

---

## Troubleshooting Quick Ref

* **Check if port 3001 is active (Windows):**
  ```powershell
  netstat -ano | Select-String ':3001\s+.*LISTENING'
  ```
* **Page throws HTTP 500 or font error on start:**
  Stop the server, clear the Next.js cache, and restart:
  ```bash
  rm -rf .next
  npm run dev -- -p 3001
  ```