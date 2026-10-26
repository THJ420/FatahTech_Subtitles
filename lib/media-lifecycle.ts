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
}

export function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
}
