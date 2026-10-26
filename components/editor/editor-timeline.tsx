"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { Captions, Film, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  binarySearchActiveChunk,
  formatTime,
  processTranscriptChunks,
} from "@/lib/transcript-utils";
import { createVideoCutPlan, type TimeRange } from "@/lib/silence-removal";
import {
  clampTimelineTime,
  createTimelineSeekQueue,
  timelineTickStep,
  timelineTimeAtPointer,
  timelineZoomScroll,
} from "@/lib/timeline";
import { useTimelineThumbnails } from "@/hooks/useTimelineThumbnails";
import type { TranscriptionResult } from "@/hooks/useTranscription";
import { useSubtitleTiming } from "@/hooks/useSubtitleTiming";
import { SubtitleTimingControls } from "./subtitle-timing-controls";
import { PlaybackSpeed } from "./playback-speed";
import type {
  TimedSubtitle,
  TimingAction,
  TimingSelection,
} from "@/lib/subtitle-timing";
import styles from "./editor.module.css";

interface EditorTimelineProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  transcript: TranscriptionResult;
  duration: number;
  file?: File | null;
  fileName?: string;
  maxWordsPerLine: number;
  mode: "word" | "phrase";
  timingDisabled?: boolean;
  onTimingChange: (chunks: TimedSubtitle[]) => void;
  silenceRemovalRanges?: TimeRange[];
  onSeek: (time: number) => void;
  onEdit: () => void;
  previewControls?: ReactNode;
}
type Scrub = {
  clientX: number;
  pointerId: number;
  resume: boolean;
  time: number;
  released: boolean;
  controller: AbortController;
  queue: ReturnType<typeof createTimelineSeekQueue>;
};
const EMPTY_RANGES: TimeRange[] = [];

// Playback moves the playhead directly without rendering the editor each frame.
export const EditorTimeline = memo(function EditorTimeline({
  videoRef,
  transcript,
  duration,
  file,
  fileName,
  maxWordsPerLine,
  mode,
  timingDisabled = false,
  onTimingChange,
  silenceRemovalRanges = EMPTY_RANGES,
  onSeek,
  onEdit,
  previewControls,
}: EditorTimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [requestedScale, setRequestedScale] = useState<number | null>(160);
  const [viewport, setViewport] = useState({ width: 1, left: 0 });
  const [scrubError, setScrubError] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLElement>(null);
  const scrubRef = useRef<Scrub | null>(null);
  const scrubFrameRef = useRef(0);
  const followRef = useRef(true);
  const zoomAnchorRef = useRef<{ time: number; offset: number } | null>(null);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const fitScale = viewport.width / safeDuration;
  const maxScale = Math.max(fitScale * 4, 320);
  const scale = Math.min(
    maxScale,
    Math.max(fitScale, requestedScale ?? fitScale),
  );
  const contentWidth = Math.max(viewport.width, safeDuration * scale);
  const thumbnails = useTimelineThumbnails(file, duration);
  const timing = useSubtitleTiming(transcript.chunks, duration, onTimingChange);
  const groupKey = `${mode}-${maxWordsPerLine}`;
  const [selectionMode, setSelectionMode] = useState(groupKey);
  const timingDrag = useRef<{
    pointerId: number;
    x: number;
    scroll: number;
    value: number;
    action: TimingAction;
  } | null>(null);
  const chunks = useMemo(
    () => processTranscriptChunks(transcript, mode, maxWordsPerLine),
    [transcript, mode, maxWordsPerLine],
  );
  const selected = selectionMode === groupKey ? timing.selection : null;
  const selectedFirst = selected
    ? transcript.chunks[selected.first]
    : undefined;
  const selectedLast = selected ? transcript.chunks[selected.last] : undefined;
  const selectionFor = (index: number): TimingSelection => {
    const chunk = chunks[index];
    return {
      first: chunk.words?.[0]?.sourceIndex ?? chunk.sourceIndex ?? index,
      last: chunk.words?.at(-1)?.sourceIndex ?? chunk.sourceIndex ?? index,
    };
  };
  const selectClip = (index: number) => {
    setSelectionMode(groupKey);
    timing.select(selectionFor(index));
    videoRef.current?.pause();
    onSeek(chunks[index].timestamp[0]);
  };
  const beginTiming = (
    event: PointerEvent<HTMLButtonElement>,
    index: number,
    action: TimingAction,
  ) => {
    if (timingDisabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectClip(index);
    timing.begin(selectionFor(index));
    timingDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      scroll: viewportRef.current?.scrollLeft ?? 0,
      value:
        action === "start"
          ? chunks[index].timestamp[0]
          : action === "end"
            ? chunks[index].timestamp[1]
            : 0,
      action,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveTiming = (event: PointerEvent<HTMLDivElement>) => {
    const drag = timingDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const element = viewportRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      if (event.clientX > rect.right - 20) element.scrollLeft += 12;
      else if (event.clientX < rect.left + 20) element.scrollLeft -= 12;
    }
    const delta =
      (event.clientX - drag.x + (element?.scrollLeft ?? 0) - drag.scroll) /
      scale;
    timing.update(drag.action, drag.value + delta);
  };
  const finishTiming = (event: PointerEvent<HTMLDivElement>) => {
    if (timingDrag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.type === "pointerup") moveTiming(event);
    timingDrag.current = null;
    timing.finish(event.type !== "pointerup");
  };
  const keyboardTiming = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    action: TimingAction,
  ) => {
    if (timingDisabled) return;
    if (event.key === "Escape" && timingDrag.current) {
      event.preventDefault();
      timingDrag.current = null;
      timing.finish(true);
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    selectClip(index);
    timing.begin(selectionFor(index));
    const delta =
      (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01);
    timing.update(
      action,
      delta +
        (action === "start"
          ? chunks[index].timestamp[0]
          : action === "end"
            ? chunks[index].timestamp[1]
            : 0),
    );
    timing.finish();
  };
  const cutPlan = useMemo(
    () => createVideoCutPlan(duration, silenceRemovalRanges, transcript.chunks),
    [duration, silenceRemovalRanges, transcript],
  );
  const visibleStart = Math.max(0, (viewport.left - 180) / scale);
  const visibleEnd = (viewport.left + viewport.width + 180) / scale;
  const visibleChunks = useMemo(
    () =>
      chunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(
          ({ chunk }) =>
            chunk.timestamp[1] >= visibleStart &&
            chunk.timestamp[0] <= visibleEnd,
        ),
    [chunks, visibleStart, visibleEnd],
  );
  const tickStep = timelineTickStep(scale);
  const ticks = useMemo(() => {
    const result = [];
    for (
      let value = Math.floor(visibleStart / tickStep) * tickStep;
      value <= Math.min(safeDuration, visibleEnd);
      value += tickStep
    )
      result.push(Math.round(value * 1000) / 1000);
    return result;
  }, [visibleStart, visibleEnd, safeDuration, tickStep]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport({
        width: Math.max(1, element.clientWidth),
        left: element.scrollLeft,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const paintPlayhead = useCallback(
    (value: number) => {
      const time = clampTimelineTime(value, safeDuration);
      const head = playheadRef.current;
      if (head) {
        head.style.transform = `translate3d(${Math.min(contentWidth - 1, time * scale)}px, 0, 0)`;
        head.setAttribute("aria-valuenow", time.toFixed(2));
        head.setAttribute(
          "aria-valuetext",
          `${formatTime(time)} of ${formatTime(safeDuration)}`,
        );
      }
      if (clockRef.current) clockRef.current.textContent = formatTime(time);
      const active = binarySearchActiveChunk(chunks, time);
      const activeIndex = active ? chunks.indexOf(active) : -1;
      const track = tracksRef.current;
      const previous = track?.querySelector<HTMLElement>(
        '[data-active="true"]',
      );
      const next = track?.querySelector<HTMLElement>(
        `[data-clip="${activeIndex}"]`,
      );
      if (previous !== next) {
        if (previous) previous.dataset.active = "false";
        if (next) next.dataset.active = "true";
      }
    },
    [safeDuration, contentWidth, scale, chunks],
  );

  useLayoutEffect(() => {
    const element = viewportRef.current;
    const anchor = zoomAnchorRef.current;
    if (element && anchor) {
      element.scrollLeft = timelineZoomScroll(
        anchor.time,
        anchor.offset,
        scale,
        contentWidth,
        element.clientWidth,
      );
      zoomAnchorRef.current = null;
    }
    paintPlayhead(scrubRef.current?.time ?? videoRef.current?.currentTime ?? 0);
  }, [scale, contentWidth, paintPlayhead, videoRef, viewport.left]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const draw = () => {
      paintPlayhead(scrubRef.current?.time ?? video.currentTime);
      const element = viewportRef.current;
      if (!scrubRef.current && !video.paused && followRef.current && element) {
        const x = video.currentTime * scale;
        if (
          x > element.scrollLeft + element.clientWidth - 24 ||
          x < element.scrollLeft
        )
          element.scrollLeft = Math.max(0, x - element.clientWidth * 0.2);
      }
    };
    const animate = () => {
      draw();
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      setPlaying(!video.paused);
      cancelAnimationFrame(frame);
      draw();
      if (!video.paused) frame = requestAnimationFrame(animate);
    };
    const play = () => {
      followRef.current = true;
      sync();
    };
    sync();
    video.addEventListener("play", play);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    video.addEventListener("timeupdate", draw);
    video.addEventListener("seeked", draw);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", play);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
      video.removeEventListener("timeupdate", draw);
      video.removeEventListener("seeked", draw);
    };
  }, [videoRef, paintPlayhead, scale]);
  useEffect(
    () => () => {
      cancelAnimationFrame(scrubFrameRef.current);
      scrubRef.current?.controller.abort();
      scrubRef.current = null;
    },
    [],
  );

  const zoomTo = (nextScale: number) => {
    const element = viewportRef.current;
    if (!element) return;
    const time = scrubRef.current?.time ?? videoRef.current?.currentTime ?? 0;
    const x = time * scale - element.scrollLeft;
    const offset =
      x >= 0 && x <= element.clientWidth ? x : element.clientWidth / 2;
    zoomAnchorRef.current = {
      time: (element.scrollLeft + offset) / scale,
      offset,
    };
    setRequestedScale(
      nextScale <= fitScale ? null : Math.min(maxScale, nextScale),
    );
  };
  const pointerTime = (clientX: number) => {
    const element = viewportRef.current;
    return element
      ? timelineTimeAtPointer(
          clientX,
          element.getBoundingClientRect().left,
          element.scrollLeft,
          scale,
          safeDuration,
        )
      : 0;
  };
  const beginScrub = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const video = videoRef.current;
    const element = viewportRef.current;
    if (!video || !element) return;
    event.preventDefault();
    const resume = scrubRef.current?.resume ?? !video.paused;
    scrubRef.current?.controller.abort();
    video.pause();
    const controller = new AbortController();
    const time = pointerTime(event.clientX);
    const queue = createTimelineSeekQueue(video, controller.signal);
    scrubRef.current = {
      clientX: event.clientX,
      pointerId: event.pointerId,
      resume,
      time,
      released: false,
      controller,
      queue,
    };
    followRef.current = true;
    setScrubError("");
    element.setPointerCapture(event.pointerId);
    playheadRef.current?.focus({ preventScroll: true });
    paintPlayhead(time);
    queue.request(time);
    cancelAnimationFrame(scrubFrameRef.current);
    let previousFrame = performance.now();
    const panAtEdge = (now: number) => {
      const scrub = scrubRef.current;
      if (!scrub || scrub.released) return;
      const rect = element.getBoundingClientRect();
      const edge = 28;
      const speed =
        scrub.clientX < rect.left + edge
          ? -Math.min(900, (rect.left + edge - scrub.clientX) * 12)
          : scrub.clientX > rect.right - edge
            ? Math.min(900, (scrub.clientX - rect.right + edge) * 12)
            : 0;
      const oldLeft = element.scrollLeft;
      element.scrollLeft += (speed * Math.min(32, now - previousFrame)) / 1000;
      previousFrame = now;
      if (element.scrollLeft !== oldLeft) {
        scrub.time = pointerTime(scrub.clientX);
        paintPlayhead(scrub.time);
        scrub.queue.request(scrub.time);
      }
      scrubFrameRef.current = requestAnimationFrame(panAtEdge);
    };
    scrubFrameRef.current = requestAnimationFrame(panAtEdge);
  };
  const moveScrub = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.released || scrub.pointerId !== event.pointerId) return;
    scrub.clientX = event.clientX;
    scrub.time = pointerTime(event.clientX);
    paintPlayhead(scrub.time);
    scrub.queue.request(scrub.time);
  };
  const finishScrub = async (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.released || scrub.pointerId !== event.pointerId) return;
    scrub.released = true;
    cancelAnimationFrame(scrubFrameRef.current);
    if (event.type === "pointerup") scrub.time = pointerTime(event.clientX);
    const element = viewportRef.current;
    if (element?.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
    try {
      await scrub.queue.finish(scrub.time);
      if (scrubRef.current !== scrub) return;
      scrubRef.current = null;
      onSeek(scrub.time);
      paintPlayhead(scrub.time);
      if (scrub.resume) await videoRef.current?.play();
    } catch {
      if (!scrub.controller.signal.aborted)
        setScrubError("Could not seek this video. Try another position.");
      if (scrubRef.current === scrub) scrubRef.current = null;
    }
  };
  const keyboardSeek = (event: KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const step = event.shiftKey ? 5 : 1 / 30;
    const times: Record<string, number> = {
      ArrowLeft: video.currentTime - step,
      ArrowRight: video.currentTime + step,
      Home: 0,
      End: safeDuration,
      PageUp: video.currentTime + 5,
      PageDown: video.currentTime - 5,
    };
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (video.paused) void video.play().catch(() => setPlaying(false));
      else video.pause();
    } else if (event.key in times) {
      event.preventDefault();
      event.stopPropagation();
      const time = clampTimelineTime(times[event.key], safeDuration);
      followRef.current = true;
      onSeek(time);
      paintPlayhead(time);
      const element = viewportRef.current;
      if (
        element &&
        (time * scale < element.scrollLeft ||
          time * scale > element.scrollLeft + element.clientWidth)
      )
        element.scrollLeft = Math.max(
          0,
          time * scale - element.clientWidth / 2,
        );
    }
  };

  return (
    <section className={styles.timeline} aria-label="Video timeline">
      <div className={styles.timelineTransport}>
        <div className={styles.timelinePlayback}>
          <Button
            variant="outline"
            size="icon"
            aria-label={playing ? "Pause video" : "Play video"}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused)
                void video.play().catch(() => setPlaying(false));
              else video.pause();
            }}
          >
            {playing ? <Pause /> : <Play fill="currentColor" />}
          </Button>
          <PlaybackSpeed videoRef={videoRef} />
          <span className={styles.timelineClock}>
            <strong ref={clockRef}>0:00</strong> / {formatTime(safeDuration)}
          </span>
        </div>
        <div
          className={styles.previewToolbar}
          role="group"
          aria-label="Video framing"
        >
          {previewControls}
        </div>
        <div className={styles.timelineZoom}>
          <button
            type="button"
            aria-label="Zoom out timeline"
            disabled={scale <= fitScale}
            onClick={() => zoomTo(scale / 1.5)}
          >
            <ZoomOut size={16} />
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min={0}
            max={Math.max(0.01, Math.log2(maxScale / fitScale))}
            step={0.01}
            value={Math.log2(scale / fitScale)}
            onChange={(event) =>
              zoomTo(fitScale * 2 ** Number(event.target.value))
            }
          />
          <button
            type="button"
            aria-label="Zoom in timeline"
            disabled={scale >= maxScale}
            onClick={() => zoomTo(scale * 1.5)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className={styles.timelineFit}
            onClick={() => zoomTo(fitScale)}
          >
            Fit
          </button>
        </div>
      </div>
      <div className={styles.timelineTracks}>
        <div className={styles.trackLabels} aria-hidden="true">
          <span />
          <span>
            <Captions size={16} /> Subtitles
          </span>
          <span>
            <Film size={16} /> Video
          </span>
        </div>
        <div
          ref={viewportRef}
          className={styles.timelineViewport}
          onScroll={(event) =>
            setViewport({
              left: event.currentTarget.scrollLeft,
              width: Math.max(1, event.currentTarget.clientWidth),
            })
          }
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) followRef.current = false;
          }}
          onPointerMove={moveScrub}
          onPointerUp={(event) => void finishScrub(event)}
          onPointerCancel={(event) => void finishScrub(event)}
          onLostPointerCapture={(event) => void finishScrub(event)}
        >
          <div
            ref={tracksRef}
            className={styles.tracks}
            style={
              {
                width: contentWidth,
                "--tick-width": `${(tickStep * scale) / 5}px`,
              } as CSSProperties
            }
          >
            <div
              className={styles.ruler}
              onPointerDown={beginScrub}
              aria-hidden="true"
            >
              {ticks.map((tick) => (
                <span key={tick} style={{ left: tick * scale }}>
                  {tickStep < 1
                    ? `${formatTime(tick)}.${Math.round((tick % 1) * 10)}`
                    : formatTime(tick)}
                </span>
              ))}
            </div>
            <div className={styles.captionTrack}>
              {visibleChunks.map(({ chunk, index }) => (
                <div
                  key={selectionFor(index).first}
                  className={styles.captionClip}
                  data-clip={index}
                  data-selected={
                    selected?.first === selectionFor(index).first &&
                    selected?.last === selectionFor(index).last
                  }
                  title={chunk.text}
                  data-disabled={chunk.disabled || chunk.subtitleHidden}
                  style={{
                    left: Math.max(0, chunk.timestamp[0] * scale),
                    width: Math.max(
                      2,
                      (chunk.timestamp[1] - chunk.timestamp[0]) * scale - 2,
                    ),
                  }}
                  onPointerMove={moveTiming}
                  onPointerUp={finishTiming}
                  onPointerCancel={finishTiming}
                  onLostPointerCapture={finishTiming}
                >
                  <button
                    type="button"
                    className={styles.captionBody}
                    aria-label={`Edit subtitle at ${formatTime(chunk.timestamp[0])}: ${chunk.text}`}
                    aria-pressed={
                      selected?.first === selectionFor(index).first &&
                      selected?.last === selectionFor(index).last
                    }
                    disabled={timingDisabled}
                    onPointerDown={(event) => beginTiming(event, index, "move")}
                    onClick={(event) => {
                      if (event.detail === 0) selectClip(index);
                    }}
                    onDoubleClick={onEdit}
                    onKeyDown={(event) => keyboardTiming(event, index, "move")}
                  >
                    {chunk.text}
                  </button>
                  {(["start", "end"] as const).map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className={styles.timingHandle}
                      data-edge={edge}
                      aria-label={`Adjust subtitle ${edge}: ${chunk.text}`}
                      title={`Drag to adjust ${edge}. Arrow keys adjust by 0.01 seconds.`}
                      disabled={timingDisabled}
                      onPointerDown={(event) => beginTiming(event, index, edge)}
                      onClick={(event) => {
                        if (event.detail === 0) selectClip(index);
                      }}
                      onKeyDown={(event) => keyboardTiming(event, index, edge)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className={styles.videoTrack} onPointerDown={beginScrub}>
              <div className={styles.thumbnailStrip} aria-hidden="true">
                {thumbnails.map((src, index) => (
                  <div
                    key={index}
                    style={{
                      backgroundImage: `url(${src})`,
                      width: `${100 / thumbnails.length}%`,
                    }}
                  />
                ))}
              </div>
              <span>{fileName || "Your video"}</span>
              {cutPlan?.removedRanges.map((range) => (
                <i
                  key={range.startTime}
                  className={styles.timelineCut}
                  style={{
                    left: range.startTime * scale,
                    width: (range.endTime - range.startTime) * scale,
                  }}
                  title={`Skipped: ${formatTime(range.startTime)}–${formatTime(range.endTime)}`}
                />
              ))}
            </div>
            <div
              ref={playheadRef}
              className={styles.playhead}
              role="slider"
              tabIndex={0}
              aria-label="Timeline playhead"
              aria-valuemin={0}
              aria-valuemax={safeDuration}
              aria-valuenow={0}
              aria-orientation="horizontal"
              onPointerDown={beginScrub}
              onKeyDown={keyboardSeek}
            />
          </div>
        </div>
      </div>
      {selected && selectedFirst && selectedLast ? (
        <SubtitleTimingControls
          key={`${mode}-${selected.first}-${selected.last}`}
          text={transcript.chunks
            .slice(selected.first, selected.last + 1)
            .map((chunk) => chunk.text.trim())
            .join(" ")}
          start={selectedFirst.timestamp[0]}
          end={selectedLast.timestamp[1]}
          disabled={timingDisabled}
          canUndo={timing.canUndo}
          canReset={transcript.chunks
            .slice(selected.first, selected.last + 1)
            .some(
              (chunk) =>
                chunk.sourceTimestamp &&
                chunk.timestamp.some(
                  (time, edge) => time !== chunk.sourceTimestamp![edge],
                ),
            )}
          onChange={timing.change}
          onUndo={timing.undo}
          onReset={timing.reset}
          error={timing.error}
        />
      ) : null}
      <div className={styles.timelineFooter}>
        <span>
          {scrubError ||
            (cutPlan
              ? "Shaded sections are skipped in playback and export."
              : "Drag subtitle edges to resize · Drag the middle to move · Select for exact times")}
        </span>
        <span>Source timeline</span>
      </div>
    </section>
  );
});
