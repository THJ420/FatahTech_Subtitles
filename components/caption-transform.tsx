"use client";

import { useRef, useEffect, type ReactNode, type PointerEvent } from "react";
import type { SubtitleStyle } from "./subtitle-styling";
import {
  clampCaptionPosition,
  resizeCaptionFont,
} from "@/lib/caption-placement";
import styles from "./caption-transform.module.css";

type Change = (change: Partial<SubtitleStyle>) => void;

export function CaptionTransform({
  children,
  fontSize,
  onChange,
  onPreview,
  onInteractionStart,
  onApplyGlobal,
  actionsAbove = false,
}: {
  children: ReactNode;
  fontSize: number;
  onChange?: Change;
  onPreview?: (change: Partial<SubtitleStyle> | null) => void;
  onInteractionStart?: () => void;
  onApplyGlobal?: () => void;
  actionsAbove?: boolean;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    id: number;
    resizing: boolean;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    frame: DOMRect;
    fontSize: number;
  } | null>(null);

  const pendingRef = useRef<Partial<SubtitleStyle> | null>(null);
  const frameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const preview = (change: Partial<SubtitleStyle>) => {
    pendingRef.current = { ...pendingRef.current, ...change };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) {
        if (onPreview) onPreview(pendingRef.current);
        else onChange?.(pendingRef.current);
      }
    });
  };

  const commit = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const change = pendingRef.current;
    pendingRef.current = null;
    gestureRef.current = null;
    if (change) onChange?.(change);
    onPreview?.(null);
  };

  const start = (event: PointerEvent<HTMLElement>, resizing: boolean) => {
    if (!onChange || event.button !== 0) return;
    const element = elementRef.current;
    const frame = element
      ?.closest("[data-video-frame]")
      ?.getBoundingClientRect();
    if (!element || !frame?.width || !frame.height) return;
    event.preventDefault();
    event.stopPropagation();
    onInteractionStart?.();
    const bounds = element.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    gestureRef.current = {
      id: event.pointerId,
      resizing,
      startX: event.clientX,
      startY: event.clientY,
      centerX,
      centerY,
      width: bounds.width,
      height: bounds.height,
      frame,
      fontSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    preview({
      customPosition: {
        x: (centerX - frame.left) / frame.width,
        y: (centerY - frame.top) / frame.height,
      },
      verticalOffset: 0,
    });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId || !onChange) return;
    event.stopPropagation();
    const { frame, centerX, centerY } = gesture;
    if (gesture.resizing) {
      const nextSize = resizeCaptionFont(
        gesture.fontSize,
        { x: gesture.startX - centerX, y: gesture.startY - centerY },
        { x: event.clientX - centerX, y: event.clientY - centerY },
      );
      const scale = nextSize / gesture.fontSize;
      preview({
        fontSize: nextSize,
        customPosition: clampCaptionPosition(
          {
            x: (centerX - frame.left) / frame.width,
            y: (centerY - frame.top) / frame.height,
          },
          (gesture.width * scale) / frame.width,
          (gesture.height * scale) / frame.height,
        ),
      });
    } else {
      preview({
        customPosition: clampCaptionPosition(
          {
            x:
              (centerX - frame.left + event.clientX - gesture.startX) /
              frame.width,
            y:
              (centerY - frame.top + event.clientY - gesture.startY) /
              frame.height,
          },
          gesture.width / frame.width,
          gesture.height / frame.height,
        ),
      });
    }
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    if (gestureRef.current?.id !== event.pointerId) return;
    commit();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={elementRef}
      className={styles.box}
      data-editable={!!onChange}
      onPointerDown={(event) => start(event, false)}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        if (gestureRef.current) commit();
      }}
      onClick={(event) => event.stopPropagation()}
      tabIndex={onChange ? 0 : undefined}
      role={onChange ? "group" : undefined}
      aria-label={
        onChange
          ? "Subtitle placement. Drag to move; drag a corner to resize. Arrow keys move; plus and minus resize. Applies only to this caption."
          : undefined
      }
      onKeyDown={(event) => {
        if (!onChange) return;
        const bounds = elementRef.current?.getBoundingClientRect();
        const frame = elementRef.current
          ?.closest("[data-video-frame]")
          ?.getBoundingClientRect();
        if (!bounds || !frame?.width || !frame.height) return;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction && !["+", "=", "-"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onInteractionStart?.();
        const step = event.shiftKey ? 10 : 1;
        const center = {
          x:
            (bounds.left +
              bounds.width / 2 -
              frame.left +
              (direction?.[0] ?? 0) * step) /
            frame.width,
          y:
            (bounds.top +
              bounds.height / 2 -
              frame.top +
              (direction?.[1] ?? 0) * step) /
            frame.height,
        };
        onChange({
          customPosition: clampCaptionPosition(
            center,
            bounds.width / frame.width,
            bounds.height / frame.height,
          ),
          verticalOffset: 0,
          ...(!direction
            ? {
                fontSize: Math.max(
                  8,
                  Math.min(160, fontSize + (event.key === "-" ? -1 : 1)),
                ),
              }
            : {}),
        });
      }}
    >
      {children}
      {onChange ? (
        <>
          <span
            className={styles.hint}
            style={
              onApplyGlobal && actionsAbove
                ? { bottom: "calc(100% + 46px)" }
                : undefined
            }
          >
            Drag to move · Corners resize · This caption only
          </span>
          {onApplyGlobal ? (
            <button
              type="button"
              className={styles.applyGlobal}
              style={
                actionsAbove
                  ? { top: "auto", bottom: "calc(100% + 10px)" }
                  : undefined
              }
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onApplyGlobal();
              }}
              title="Use this position and size for all subtitles"
            >
              Apply globally
            </button>
          ) : null}
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <span
              key={corner}
              aria-hidden="true"
              data-corner={corner}
              className={styles.handle}
              onPointerDown={(event) => start(event, true)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
