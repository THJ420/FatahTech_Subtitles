"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { X } from "lucide-react";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => (
    <p className="p-4 text-sm" role="status">
      Loading emojis…
    </p>
  ),
});

/** Independent of the word editor's scroll container and preview clipping. */
export function WordEmojiPicker({
  anchorRef,
  docked = false,
  mode,
  onSelect,
  onClose,
}: {
  docked?: boolean;
  anchorRef: RefObject<HTMLDivElement | null>;
  mode: "replace" | "overlay";
  onSelect: (emoji: { emoji: string }) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (docked) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const pickerWidth = Math.min(360, width - 16);
      const pickerHeight = Math.min(500, height - 16);
      const leftEdge = viewportLeft + 8;
      const rightEdge = viewportLeft + width - 8;
      const right = rect.right + 12;
      const left = rect.left - 12 - pickerWidth;
      const beside = right + pickerWidth <= rightEdge || left >= leftEdge;
      const x =
        right + pickerWidth <= rightEdge
          ? right
          : left >= leftEdge
            ? left
            : viewportLeft + (width - pickerWidth) / 2;
      const y = beside
        ? Math.max(
            viewportTop + 8,
            Math.min(rect.top, viewportTop + height - pickerHeight - 8),
          )
        : viewportTop + (height - pickerHeight) / 2;
      Object.assign(panel.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${pickerWidth}px`,
        height: `${pickerHeight}px`,
      });
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(anchor);
    // Dragging changes the editor's inline position, without resizing it.
    const movement = new MutationObserver(position);
    movement.observe(anchor, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      resize.disconnect();
      movement.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [anchorRef, docked]);

  useLayoutEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !anchorRef.current?.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [anchorRef, onClose]);

  const picker = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={
        mode === "replace" ? "Replace word with emoji" : "Add emoji above word"
      }
      className={`${docked ? "h-full w-full" : "fixed z-[60] shadow-xl"} flex flex-col overflow-hidden rounded-xl border border-border bg-background`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">
          {mode === "replace" ? "Replace with emoji" : "Emoji above word"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emoji picker"
          className="rounded-md p-2 hover:bg-muted"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <EmojiPicker
          onEmojiClick={onSelect}
          width="100%"
          height="100%"
          autoFocusSearch={!docked}
          skinTonesDisabled
          searchPlaceHolder="Search emoji..."
          previewConfig={{ showPreview: false }}
        />
      </div>
    </div>
  );
  return docked ? picker : createPortal(picker, document.body);
}
