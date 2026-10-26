"use client";

import { useMemo, useState, useRef, useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FONT_FAMILIES } from "@/components/subtitle-styling";
import {
  X,
  GripHorizontal,
  RotateCcw,
  Type,
  Palette,
  Zap,
  Smile,
  ALargeSmall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type WordStyleOverride } from "@/lib/transcript-utils";
import { DebouncedColorInput } from "@/components/ui/debounced-color-input";
import { Switch } from "@/components/ui/switch";
import { WordEmojiPicker } from "./word-emoji-picker";
import panelStyles from "@/components/editor-panels.module.css";

const fontOptions = Object.values(FONT_FAMILIES);

type Section = "font" | "size" | "color" | "effect" | "emoji";

interface WordStylePopoverProps {
  wordText: string;
  override: WordStyleOverride;
  onChange: (override: WordStyleOverride) => void;
  onReset: () => void;
  onClose: () => void;
  className?: string;
  compact?: boolean;
}

export function WordStylePopover({
  wordText,
  override,
  onChange,
  onReset,
  onClose,
  className,
  compact = false,
}: WordStylePopoverProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState<
    "replace" | "overlay" | null
  >(null);
  const [activeSection, setActiveSection] = useState<Section | null>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const effectId = useId();
  const closeEmojiPicker = () => {
    setShowEmojiPicker(null);
    emojiTriggerRef.current?.focus({ preventScroll: true });
  };
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);

  // The panel is a direct child of the preview. Keep it inside the visible
  // portion, including when the emoji picker, browser, or preview changes size.
  const constrainPanel = () => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const bounds = parent.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const left = Math.max(8, viewportLeft - bounds.left + 8);
    const top = Math.max(8, viewportTop - bounds.top + 8);
    const right = Math.min(
      parent.clientWidth - 8,
      viewportLeft + (viewport?.width ?? window.innerWidth) - bounds.left - 8,
    );
    const bottom = Math.min(
      parent.clientHeight - 8,
      viewportTop + (viewport?.height ?? window.innerHeight) - bounds.top - 8,
    );
    panel.style.width = `${Math.max(0, Math.min(330, right - left))}px`;
    panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const position = positionRef.current ?? {
      x: right - panel.offsetWidth,
      y: top,
    };
    position.x = Math.max(
      left,
      Math.min(position.x, right - panel.offsetWidth),
    );
    position.y = Math.max(
      top,
      Math.min(position.y, bottom - panel.offsetHeight),
    );
    positionRef.current = position;
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  };

  useEffect(() => {
    if (compact) return;
    const panel = panelRef.current;
    if (!panel?.parentElement) return;
    constrainPanel();
    const observer = new ResizeObserver(constrainPanel);
    observer.observe(panel);
    observer.observe(panel.parentElement);
    window.addEventListener("resize", constrainPanel);
    window.addEventListener("scroll", constrainPanel, true);
    window.visualViewport?.addEventListener("resize", constrainPanel);
    window.visualViewport?.addEventListener("scroll", constrainPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", constrainPanel);
      window.removeEventListener("scroll", constrainPanel, true);
      window.visualViewport?.removeEventListener("resize", constrainPanel);
      window.visualViewport?.removeEventListener("scroll", constrainPanel);
    };
  }, [compact]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (showEmojiPicker) closeEmojiPicker();
      else onClose();
    }
  };

  const currentFontCss = useMemo(() => {
    if (!override.fontFamily) return undefined;
    const match = fontOptions.find((f) => f.value === override.fontFamily);
    return match?.cssFont ?? override.fontFamily;
  }, [override.fontFamily]);

  const handleFontFamilyChange = (value: string) => {
    if (value === "__none__") {
      const next = { ...override };
      delete next.fontFamily;
      onChange(next);
    } else {
      onChange({ ...override, fontFamily: value });
    }
  };

  const handleColorChange = (color: string) => {
    onChange({ ...override, color });
  };

  const handleClearColor = () => {
    const next = { ...override };
    delete next.color;
    onChange(next);
  };

  const handleSizeChange = (values: number[]) => {
    const val = values[0] / 100;
    if (val === 1) {
      const next = { ...override };
      delete next.fontSize;
      onChange(next);
    } else {
      onChange({ ...override, fontSize: val });
    }
  };

  const sizePercent = Math.round((override.fontSize ?? 1) * 100);

  const handleToggleKnockout = () => {
    if (override.effect === "knockout") {
      const next = { ...override };
      delete next.effect;
      onChange(next);
    } else {
      onChange({ ...override, effect: "knockout" });
    }
  };

  const handleEmojiSelect = (emojiData: { emoji: string }) => {
    if (showEmojiPicker === "replace") {
      onChange({ ...override, emoji: emojiData.emoji });
    } else if (showEmojiPicker === "overlay") {
      onChange({ ...override, emojiOverlay: emojiData.emoji });
    }
    closeEmojiPicker();
  };

  const handleClearEmoji = () => {
    const next = { ...override };
    delete next.emoji;
    onChange(next);
  };

  const handleClearEmojiOverlay = () => {
    const next = { ...override };
    delete next.emojiOverlay;
    onChange(next);
  };

  const handleEmojiScaleChange = (values: number[]) => {
    const val = values[0] / 100;
    if (val === 1) {
      const next = { ...override };
      delete next.emojiScale;
      onChange(next);
    } else {
      onChange({ ...override, emojiScale: val });
    }
  };

  const emojiScalePercent = Math.round((override.emojiScale ?? 1) * 100);
  const hasEmoji = override.emoji || override.emojiOverlay;

  const hasOverrides =
    override.fontFamily !== undefined ||
    override.fontSize !== undefined ||
    override.color !== undefined ||
    override.effect !== undefined ||
    override.emoji !== undefined ||
    override.emojiOverlay !== undefined ||
    override.emojiScale !== undefined;

  // --- Section content renderers ---

  const renderFontSection = () => (
    <div className="space-y-1.5">
      {!compact && (
        <p className="text-xs font-medium text-muted-foreground">Font</p>
      )}
      <Select
        value={override.fontFamily ?? "__none__"}
        onValueChange={handleFontFamilyChange}
      >
        <SelectTrigger
          aria-label="Word font"
          className="w-full rounded-md border-border bg-background px-3 py-1.5 text-xs shadow-sm"
          style={currentFontCss ? { fontFamily: currentFontCss } : undefined}
        >
          <SelectValue placeholder="Same as global" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__none__" className="text-xs">
              Same as global
            </SelectItem>
            {fontOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-xs"
                style={{ fontFamily: option.cssFont }}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );

  const renderSizeSection = () => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {!compact && (
          <p className="text-xs font-medium text-muted-foreground">Size</p>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {sizePercent}%
        </span>
      </div>
      <Slider
        aria-label="Word size"
        value={[sizePercent]}
        onValueChange={handleSizeChange}
        min={50}
        max={200}
        step={10}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>50%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
    </div>
  );

  const renderColorSection = () => (
    <div className="space-y-1.5">
      {!compact && (
        <p className="text-xs font-medium text-muted-foreground">Color</p>
      )}
      <div className="flex items-center gap-2">
        <DebouncedColorInput
          aria-label="Word color"
          value={override.color ?? "#FFFFFF"}
          onChange={handleColorChange}
          className="w-8 h-8 rounded cursor-pointer border border-border"
        />
        {override.color ? (
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-xs uppercase text-muted-foreground">
              {override.color}
            </span>
            <button
              onClick={handleClearColor}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              reset
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Same as global</span>
        )}
      </div>
    </div>
  );

  const renderEffectSection = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={effectId} className="text-xs font-medium">
          Knockout effect
        </label>
        <Switch
          id={effectId}
          checked={override.effect === "knockout"}
          onCheckedChange={handleToggleKnockout}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Other text effects are in the Style panel.
      </p>
    </div>
  );

  const renderEmojiSection = () => (
    <div className="space-y-2">
      {/* Emoji Replace */}
      <div className="space-y-1.5">
        {!compact && (
          <p className="text-xs font-medium text-muted-foreground">
            Emoji Replace
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showEmojiPicker === "replace"}
            onClick={(event) => {
              emojiTriggerRef.current = event.currentTarget;
              setShowEmojiPicker(
                showEmojiPicker === "replace" ? null : "replace",
              );
            }}
            className={cn(
              "flex-1 text-xs px-3 py-1.5 rounded-md border transition-colors text-left",
              override.emoji
                ? "bg-muted border-border"
                : "bg-background text-foreground border-border hover:bg-muted",
            )}
          >
            {override.emoji ? (
              <span className="text-base">
                {override.emoji}{" "}
                <span className="text-xs text-muted-foreground">
                  replacing text
                </span>
              </span>
            ) : (
              "Replace with emoji..."
            )}
          </button>
          {override.emoji && (
            <button
              onClick={handleClearEmoji}
              className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* Emoji Overlay */}
      <div className="space-y-1.5">
        {!compact && (
          <label className="text-xs font-medium text-muted-foreground block">
            Emoji Overlay
          </label>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={showEmojiPicker === "overlay"}
            onClick={(event) => {
              emojiTriggerRef.current = event.currentTarget;
              setShowEmojiPicker(
                showEmojiPicker === "overlay" ? null : "overlay",
              );
            }}
            className={cn(
              "flex-1 text-xs px-3 py-1.5 rounded-md border transition-colors text-left",
              override.emojiOverlay
                ? "bg-muted border-border"
                : "bg-background text-foreground border-border hover:bg-muted",
            )}
          >
            {override.emojiOverlay ? (
              <span className="text-base">
                {override.emojiOverlay}{" "}
                <span className="text-xs text-muted-foreground">
                  above word
                </span>
              </span>
            ) : (
              "Add emoji above..."
            )}
          </button>
          {override.emojiOverlay && (
            <button
              onClick={handleClearEmojiOverlay}
              className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* Emoji Size */}
      {hasEmoji && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Emoji Size
            </label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {emojiScalePercent}%
            </span>
          </div>
          <Slider
            aria-label="Emoji size"
            value={[emojiScalePercent]}
            onValueChange={handleEmojiScaleChange}
            min={50}
            max={200}
            step={10}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>50%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>
      )}

      {showEmojiPicker && (
        <WordEmojiPicker
          anchorRef={panelRef}
          mode={showEmojiPicker}
          onSelect={handleEmojiSelect}
          onClose={closeEmojiPicker}
        />
      )}
    </div>
  );

  // --- Compact (mobile) layout ---

  if (compact && showEmojiPicker) {
    return (
      <WordEmojiPicker
        docked
        anchorRef={panelRef}
        mode={showEmojiPicker}
        onSelect={handleEmojiSelect}
        onClose={closeEmojiPicker}
      />
    );
  }

  if (compact) {
    const sections: {
      key: Section;
      icon: React.ReactNode;
      label: string;
      hasValue: boolean;
    }[] = [
      {
        key: "font",
        icon: <Type className="h-3.5 w-3.5" />,
        label: "Font",
        hasValue: !!override.fontFamily,
      },
      {
        key: "size",
        icon: <ALargeSmall className="h-3.5 w-3.5" />,
        label: "Size",
        hasValue: !!override.fontSize,
      },
      {
        key: "color",
        icon: <Palette className="h-3.5 w-3.5" />,
        label: "Color",
        hasValue: !!override.color,
      },
      {
        key: "effect",
        icon: <Zap className="h-3.5 w-3.5" />,
        label: "FX",
        hasValue: !!override.effect,
      },
      {
        key: "emoji",
        icon: <Smile className="h-3.5 w-3.5" />,
        label: "Emoji",
        hasValue: !!(override.emoji || override.emojiOverlay),
      },
    ];

    const toggleSection = (key: Section) => {
      setActiveSection((prev) => (prev === key ? null : key));
      if (key !== "emoji") setShowEmojiPicker(null);
    };

    return (
      <div
        ref={panelRef}
        className={cn(panelStyles.wordPopover, "p-3", className)}
        role="dialog"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h4
            id={titleId}
            className="text-xs font-semibold text-foreground truncate flex-1 mr-2"
          >
            &ldquo;{wordText}&rdquo;
          </h4>
          <div className="flex items-center gap-1">
            {hasOverrides && (
              <button
                onClick={onReset}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Reset to global"
                aria-label="Reset word style"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close word style"
              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 mb-2">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-expanded={activeSection === s.key}
              onClick={() => toggleSection(s.key)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg border text-[10px] font-medium transition-colors",
                activeSection === s.key
                  ? "bg-yellow-50 text-foreground border-yellow-400"
                  : s.hasValue
                    ? "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>

        {/* Expanded section */}
        {activeSection === "font" && renderFontSection()}
        {activeSection === "size" && renderSizeSection()}
        {activeSection === "color" && renderColorSection()}
        {activeSection === "effect" && renderEffectSection()}
        {activeSection === "emoji" && renderEmojiSection()}
      </div>
    );
  }

  // --- Full (desktop) layout ---

  return (
    <div
      ref={panelRef}
      className={cn(
        panelStyles.wordPopover,
        "flex flex-col overflow-hidden",
        className,
      )}
      role="dialog"
      aria-labelledby={titleId}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
        <button
          type="button"
          data-word-editor-drag
          aria-label="Move word editor; use arrow keys to reposition"
          title="Drag to move · Arrow keys to reposition"
          className="touch-none cursor-grab rounded-md p-1.5 text-foreground hover:bg-muted focus-visible:outline-2 active:cursor-grabbing"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            constrainPanel();
            const position = positionRef.current!;
            dragRef.current = {
              id: event.pointerId,
              x: event.clientX - position.x,
              y: event.clientY - position.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.id !== event.pointerId) return;
            positionRef.current = {
              x: event.clientX - drag.x,
              y: event.clientY - drag.y,
            };
            constrainPanel();
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
          onKeyDown={(event) => {
            const directions: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            const position = positionRef.current;
            if (!position) return;
            const step = event.shiftKey ? 1 : 10;
            positionRef.current = {
              x: position.x + direction[0] * step,
              y: position.y + direction[1] * step,
            };
            constrainPanel();
          }}
        >
          <GripHorizontal className="h-4 w-4" />
        </button>
        <h4
          id={titleId}
          className="text-sm font-semibold text-foreground truncate flex-1 mr-2"
        >
          Edit word: &ldquo;{wordText}&rdquo;
        </h4>
        <button
          onClick={onClose}
          aria-label="Close word style"
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain space-y-3 p-4">
        {renderFontSection()}
        {renderSizeSection()}
        {renderColorSection()}
        {renderEffectSection()}
        {renderEmojiSection()}

        {/* Reset All */}
        {hasOverrides && (
          <Button
            onClick={onReset}
            variant="outline"
            size="sm"
            className="w-full text-xs flex items-center gap-1.5"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to Global Style
          </Button>
        )}
      </div>
    </div>
  );
}
