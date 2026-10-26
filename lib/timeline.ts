import { seekVideo } from "./media-lifecycle";

export function clampTimelineTime(time: number, duration: number): number {
  return Math.max(
    0,
    Math.min(Number.isFinite(time) ? time : 0, Math.max(0, duration)),
  );
}

export function timelineTimeAtPointer(
  clientX: number,
  left: number,
  scrollLeft: number,
  pixelsPerSecond: number,
  duration: number,
): number {
  return clampTimelineTime(
    (clientX - left + scrollLeft) / pixelsPerSecond,
    duration,
  );
}

export function timelineTickStep(pixelsPerSecond: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((step) => step * pixelsPerSecond >= 72) ?? 300;
}

export function timelineZoomScroll(
  anchorTime: number,
  anchorOffset: number,
  pixelsPerSecond: number,
  contentWidth: number,
  viewportWidth: number,
): number {
  return Math.max(
    0,
    Math.min(
      anchorTime * pixelsPerSecond - anchorOffset,
      Math.max(0, contentWidth - viewportWidth),
    ),
  );
}

/** At most one decode in flight. Intermediate pointer positions are discarded. */
export function createTimelineSeekQueue(
  video: HTMLVideoElement,
  signal: AbortSignal,
) {
  let pending: number | null = null;
  let running: Promise<void> | null = null;
  let failure: unknown;
  const pump = async () => {
    while (pending !== null && !signal.aborted) {
      const target = pending;
      pending = null;
      await seekVideo(video, target, signal);
    }
  };
  const request = (time: number) => {
    if (signal.aborted || failure) return;
    pending = time;
    if (!running) {
      running = pump()
        .catch((error) => {
          failure = error;
          pending = null;
        })
        .finally(() => {
          running = null;
          if (pending !== null) request(pending);
        });
    }
  };
  return {
    request,
    async finish(time: number) {
      request(time);
      while (running) await running;
      signal.throwIfAborted();
      if (failure) throw failure;
    },
  };
}
