export function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Wait for media without leaving event listeners behind after cancel or failure. */
export function waitForMediaEvent(
  media: HTMLMediaElement,
  event: "loadedmetadata" | "loadeddata" | "seeked",
  options: {
    signal?: AbortSignal;
    start?: () => void;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const { signal, start, timeoutMs = 30_000 } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      return;
    }

    const cleanup = () => {
      clearTimeout(timeout);
      media.removeEventListener(event, onReady);
      media.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The video could not be loaded or decoded."));
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The video took too long to load or seek."));
    }, timeoutMs);

    media.addEventListener(event, onReady);
    media.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      start?.();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Wait until the element has actually presented a decoded frame for painting.
 *
 * `seeked` fires when the seek *operation* completes. On Chromium and Safari
 * that can happen before the compositor picks up the new frame, so a
 * `drawImage` issued straight after `seeked` captures the *pre-seek* frame.
 * Every downstream consumer of that capture is then shifted by one sample.
 *
 * `requestVideoFrameCallback` fires on the next presented frame, so awaiting it
 * guarantees `drawImage` sees the frame we asked for.
 *
 * A seek that lands on the frame already on screen presents nothing, so the
 * callback would never fire. Racing it against a short timeout keeps this a
 * best-effort improvement rather than a new way to hang.
 */
export function waitForVideoFrame(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  timeoutMs = 300,
): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== "function") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      return;
    }

    let settled = false;
    let handle = 0;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (handle) video.cancelVideoFrameCallback(handle);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () =>
      finish(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(), timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    handle = video.requestVideoFrameCallback(() => finish());
  });
}

export async function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (
    !video.seeking &&
    video.readyState >= 2 &&
    Math.abs(video.currentTime - time) < 0.001
  ) {
    return;
  }
  await waitForMediaEvent(video, "seeked", {
    signal,
    start: () => {
      video.currentTime = time;
    },
  });
  // The seek completed, but the new frame may not be paintable yet.
  await waitForVideoFrame(video, signal);
}

export function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
}
