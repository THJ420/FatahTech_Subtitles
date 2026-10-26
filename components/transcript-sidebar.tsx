"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import {
  formatTime,
  transcriptToSrt,
  transcriptToVtt,
  processTranscriptChunks,
  binarySearchActiveChunk,
  type ProcessedChunk,
  type ProcessedWord,
} from "@/lib/transcript-utils";
import {
  buildWordTimings,
  parseSubtitleTime,
  updateChunkText,
  type SubtitleWordTiming,
} from "@/lib/subtitle-timing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Edit,
  Eye,
  EyeOff,
  SkipForward,
  Filter,
  Download,
  Plus,
} from "lucide-react";
import panelStyles from "@/components/editor-panels.module.css";

interface TranscriptChunk {
  text: string;
  timestamp: [number, number];
  sourceTimestamp?: [number, number];
  disabled?: boolean;
  subtitleHidden?: boolean;
  dynamicPosition?: "behind" | "front";
  /** Explicit word timings (manual subtitles). */
  words?: SubtitleWordTiming[];
}

interface TranscriptSidebarProps {
  transcript: {
    text: string;
    chunks: TranscriptChunk[];
  };
  currentTime: number;
  setCurrentTime: (time: number) => void;
  onTranscriptUpdate?: (updatedTranscript: {
    text: string;
    chunks: TranscriptChunk[];
  }) => void;
  className?: string;
  mode: "word" | "phrase";
  maxWordsPerLine?: number;
  dynamicEnabled?: boolean;
  videoFileName?: string;
}

export function TranscriptSidebar({
  transcript,
  currentTime,
  setCurrentTime,
  onTranscriptUpdate,
  className = "",
  mode,
  maxWordsPerLine,
  dynamicEnabled = false,
  videoFileName,
}: TranscriptSidebarProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [hideSkipped, setHideSkipped] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draftStart, setDraftStart] = useState("0.000");
  const [draftEnd, setDraftEnd] = useState("2.000");
  const [draftText, setDraftText] = useState("");
  const [addError, setAddError] = useState("");
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const activeChunkRef = useRef<HTMLDivElement | null>(null);

  const fileBaseName = videoFileName
    ? videoFileName.replace(/\.[^/.]+$/, "")
    : "subtitles";

  // Process transcript chunks based on the current mode
  const displayChunks: ProcessedChunk[] = useMemo(() => {
    const processed = processTranscriptChunks(
      transcript,
      mode,
      maxWordsPerLine,
      dynamicEnabled,
    );

    return processed.map((chunk, index) => {
      if (mode === "phrase" && chunk.words) {
        // ProcessedWord already carries disabled/subtitleHidden from processTranscriptChunks
        // Use these directly instead of re-scanning transcript.chunks (was O(n²))
        const everyWordDisabled = chunk.words.every((word) => word.disabled);
        const everyWordHidden = chunk.words.every(
          (word) => word.subtitleHidden,
        );

        return {
          ...chunk,
          disabled: everyWordDisabled,
          subtitleHidden: everyWordHidden,
        };
      }

      return {
        ...chunk,
        disabled: transcript.chunks[index]?.disabled ?? false,
        subtitleHidden: transcript.chunks[index]?.subtitleHidden ?? false,
      };
    });
  }, [transcript, mode, maxWordsPerLine, dynamicEnabled]);

  const activeChunk = binarySearchActiveChunk(displayChunks, currentTime);
  const { skippedCount, hiddenCount } = useMemo(() => {
    let skippedCount = 0;
    let hiddenCount = 0;
    for (const chunk of displayChunks) {
      if (chunk.disabled) skippedCount++;
      else if (chunk.subtitleHidden) hiddenCount++;
    }
    return { skippedCount, hiddenCount };
  }, [displayChunks]);

  // Only measure when the active chunk changes. Do not move the list while editing.
  useEffect(() => {
    const el = activeChunkRef.current;
    const container = transcriptContainerRef.current;
    if (!el || !container || editingIndex !== null) return;

    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;

    if (elTop < scrollTop || elBottom > scrollTop + clientHeight) {
      container.scrollTo({
        top: Math.max(0, elTop - clientHeight / 2 + el.offsetHeight / 2),
        behavior: "instant",
      });
    }
  }, [activeChunk, editingIndex]);

  const handleDownloadJson = () => {
    const jsonTranscript = JSON.stringify(transcript, null, 2).replace(
      /( {4}"timestamp": )\[\s+(\S+)\s+(\S+)\s+\]/gm,
      "$1[$2 $3]",
    );
    const blob = new Blob([jsonTranscript], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSrt = () => {
    const srtContent = transcriptToSrt(transcript, mode);
    const blob = new Blob([srtContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadVtt = () => {
    const vttContent = transcriptToVtt(transcript, mode);
    const blob = new Blob([vttContent], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openAddSubtitle = () => {
    const start = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    setDraftStart(start.toFixed(3));
    setDraftEnd((start + 2).toFixed(3));
    setDraftText("");
    setAddError("");
    setAddOpen(true);
  };

  const handleAddSubtitle = () => {
    if (!onTranscriptUpdate) return;

    const start = parseSubtitleTime(draftStart);
    const end = parseSubtitleTime(draftEnd);
    if (start === null || end === null) {
      setAddError("Use seconds (12.5) or HH:MM:SS.mmm for both times.");
      return;
    }
    if (end <= start) {
      setAddError("End time must be after the start time.");
      return;
    }
    const text = draftText.trim();
    if (!text) {
      setAddError("Enter the subtitle text.");
      return;
    }

    // Insert the new subtitle with explicit per-word timings so it receives
    // the same word-level effects (active-word highlighting, emphasis boxes,
    // depth layers) as transcribed text. Then sort by start time so the
    // timeline markers and binary-search lookups stay in sync with preview.
    const words = buildWordTimings(text, [start, end] as [number, number]);
    const chunks: TranscriptChunk[] = [
      ...transcript.chunks,
      {
        text: words.map((word) => word.text).join(" "),
        timestamp: [start, end] as [number, number],
        words,
      },
    ].sort((a, b) => a.timestamp[0] - b.timestamp[0]);

    onTranscriptUpdate({
      text: chunks
        .filter((chunk) => !chunk.disabled)
        .map((chunk) => chunk.text)
        .join(" "),
      chunks,
    });
    setAddError("");
    setAddOpen(false);
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditText(displayChunks[index].text);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;

    const updatedChunks = [...transcript.chunks];

    if (mode === "word") {
      // For word mode, direct update - editingIndex maps directly to transcript.chunks.
      // updateChunkText also rebuilds word timings for manual subtitles.
      updatedChunks[editingIndex] = updateChunkText(
        updatedChunks[editingIndex],
        editText,
      );
    } else if (mode === "phrase") {
      // For phrase/dynamic mode, we need to update the original word chunks that make up this phrase
      const phraseToEdit = displayChunks[editingIndex];
      if (phraseToEdit.words && phraseToEdit.words.length > 0) {
        // Split the edited text into words
        const newWords = editText.trim().split(/\s+/);
        const originalWords = phraseToEdit.words;

        // A chunk that owns its word timings (manual subtitle) is edited as a
        // unit: rebuild its words across its span so effects persist.
        const ownedChunkIndex = originalWords.every(
          (word) => word.sourceIndex === originalWords[0].sourceIndex,
        )
          ? originalWords[0].sourceIndex
          : undefined;
        if (ownedChunkIndex !== undefined) {
          updatedChunks[ownedChunkIndex] = updateChunkText(
            updatedChunks[ownedChunkIndex],
            editText,
          );
        } else {
          // Transcribed phrases map back to their own source word chunks.
          // Update each original chunk with the corresponding new word.
          // If there are more new words than original, concatenate extras to the last original word
          // If there are fewer new words, extra original words are cleared (empty text is skipped by processTranscriptChunks)
          originalWords.forEach((originalWord, wordIndex) => {
            const originalChunkIndex = transcript.chunks.findIndex(
              (chunk) =>
                chunk.timestamp[0] === originalWord.timestamp[0] &&
                chunk.timestamp[1] === originalWord.timestamp[1],
            );

            if (originalChunkIndex !== -1) {
              let newText: string;

              if (wordIndex === originalWords.length - 1) {
                // This is the last original word - concatenate all remaining new words
                newText = newWords.slice(wordIndex).join(" ");
              } else if (wordIndex < newWords.length) {
                // Not the last original word, take the corresponding new word
                newText = newWords[wordIndex];
              } else {
                // Fewer new words than original - clear this word
                newText = "";
              }

              updatedChunks[originalChunkIndex] = {
                ...updatedChunks[originalChunkIndex],
                text: newText,
              };
            }
          });
        }
      }
    }

    const updatedTranscript = {
      text: updatedChunks
        .filter((chunk) => !chunk.disabled)
        .map((chunk) => chunk.text)
        .join(" "),
      chunks: updatedChunks,
    };

    // Call the update function if provided
    if (onTranscriptUpdate) {
      onTranscriptUpdate(updatedTranscript);
    }

    // Reset editing state
    setEditingIndex(null);
    setEditText("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditText("");
  };

  // Cycle through 3 states: normal → hidden subs → skip segment → normal
  const cycleChunkState = (index: number) => {
    const chunk = displayChunks[index];
    const isHidden = chunk.subtitleHidden ?? false;
    const isDisabled = chunk.disabled ?? false;

    // Determine next state
    let nextHidden = false;
    let nextDisabled = false;
    if (!isHidden && !isDisabled) {
      // Normal → Hide subs
      nextHidden = true;
    } else if (isHidden && !isDisabled) {
      // Hide subs → Skip segment
      nextDisabled = true;
    }
    // Skip → Normal (both false)

    if (mode === "phrase") {
      const phraseToToggle = displayChunks[index];
      if (phraseToToggle.words) {
        const updatedChunks = transcript.chunks.map((originalChunk) => {
          const isPartOfPhrase = phraseToToggle.words!.some(
            (phraseWord) =>
              phraseWord.timestamp[0] === originalChunk.timestamp[0] &&
              phraseWord.timestamp[1] === originalChunk.timestamp[1],
          );

          if (isPartOfPhrase) {
            return {
              ...originalChunk,
              disabled: nextDisabled,
              subtitleHidden: nextHidden,
            };
          }
          return originalChunk;
        });

        const updatedTranscript = {
          text: updatedChunks
            .filter((c) => !c.disabled)
            .map((c) => c.text)
            .join(" "),
          chunks: updatedChunks,
        };

        if (onTranscriptUpdate) {
          onTranscriptUpdate(updatedTranscript);
        }
      }
    } else {
      const updatedChunks = transcript.chunks.map((c, i) =>
        i === index
          ? { ...c, disabled: nextDisabled, subtitleHidden: nextHidden }
          : c,
      );

      const updatedTranscript = {
        text: updatedChunks
          .filter((c) => !c.disabled)
          .map((c) => c.text)
          .join(" "),
        chunks: updatedChunks,
      };

      if (onTranscriptUpdate) {
        onTranscriptUpdate(updatedTranscript);
      }
    }
  };

  const toggleWordDynamicPosition = (
    wordTimestamp: [number, number],
    displayedPosition: "behind" | "front",
  ) => {
    if (!onTranscriptUpdate) return;

    const updatedChunks = transcript.chunks.map((chunk) => {
      if (
        chunk.timestamp[0] === wordTimestamp[0] &&
        chunk.timestamp[1] === wordTimestamp[1]
      ) {
        return {
          ...chunk,
          dynamicPosition: (displayedPosition === "behind"
            ? "front"
            : "behind") as "behind" | "front",
        };
      }
      return chunk;
    });

    onTranscriptUpdate({
      text: updatedChunks
        .filter((chunk) => !chunk.disabled)
        .map((c) => c.text)
        .join(" "),
      chunks: updatedChunks,
    });
  };

  return (
    <div
      className={`${panelStyles.transcriptPanel} flex flex-col ${className}`}
    >
      <div className={panelStyles.transcriptHeader}>
        <h2>Subtitles</h2>
        <p>
          Select a line to seek. Edit the words, hide subtitles, or remove a
          video section.
        </p>
        {dynamicEnabled ? (
          <p>
            {mode === "phrase"
              ? "Select a word marked Front or Behind to change its layer."
              : "Select Line in Style to choose words behind or in front of the person."}
          </p>
        ) : null}
      </div>
      {/* Toolbar */}
      <div className={panelStyles.transcriptToolbar}>
        <span className="text-xs text-muted-foreground">
          {skippedCount || hiddenCount
            ? `${skippedCount} removed · ${hiddenCount} hidden`
            : `${displayChunks.length} ${mode === "word" ? "words" : "lines"}`}
        </span>
        <div className="flex items-center gap-2">
          {skippedCount + hiddenCount > 0 && (
            <button
              type="button"
              aria-pressed={hideSkipped}
              onClick={() => setHideSkipped((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
                hideSkipped
                  ? "bg-primary text-primary-foreground"
                  : "bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
              }`}
              title={
                hideSkipped
                  ? "Show all segments"
                  : "Hide skipped and hidden segments"
              }
            >
              <Filter className="h-3 w-3" />
              {hideSkipped ? "Show all" : "Hide inactive"}
            </button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={openAddSubtitle}
            disabled={!onTranscriptUpdate}
            className="h-7 gap-1 px-2 text-xs"
            title="Add a subtitle manually"
          >
            <Plus className="h-3 w-3" />
            Add Subtitle
          </Button>
        </div>
      </div>

      <ScrollArea
        className={panelStyles.transcriptScroll}
        viewportRef={transcriptContainerRef}
        type="scroll"
      >
        <div className="pr-1">
          {displayChunks.map((chunk, i) => {
            const [start, end] = chunk.timestamp;
            const isActive = chunk === activeChunk;
            const isEditing = editingIndex === i;

            const isDisabled = chunk.disabled ?? false;
            const isHidden = chunk.subtitleHidden ?? false;

            if (hideSkipped && (isDisabled || isHidden)) return null;

            return (
              <div
                key={`${mode}-${i}-${start}`}
                ref={isActive && !isDisabled ? activeChunkRef : null}
                className={panelStyles.transcriptChunk}
                data-active={isActive && !isEditing}
                data-state={
                  isDisabled ? "skipped" : isHidden ? "hidden" : "normal"
                }
                role="group"
                tabIndex={isEditing ? -1 : 0}
                aria-label={`Subtitle at ${formatTime(start)}. ${chunk.text}`}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || isEditing) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    setCurrentTime(start);
                  }
                }}
                onClick={() => {
                  if (!isEditing) {
                    setCurrentTime(start);
                  }
                }}
              >
                <div className={panelStyles.chunkTime}>
                  <span>{formatTime(start)}</span>
                  <span aria-hidden="true">—</span>
                  <span>{formatTime(end)}</span>
                  {isDisabled || isHidden ? (
                    <span className="ml-auto">
                      {isDisabled ? "Section removed" : "Subtitles hidden"}
                    </span>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      aria-label={`Edit subtitle at ${formatTime(start)}`}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full p-2 border rounded-md text-sm min-h-[60px]"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        }
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          saveEdit();
                        }
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelEdit();
                        }}
                        variant="outline"
                        size="sm"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          saveEdit();
                        }}
                        size="sm"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between items-start">
                      <p
                        className={`${panelStyles.chunkText} ${isActive ? "font-medium" : ""} ${isDisabled ? "line-through text-muted-foreground" : ""} ${isHidden && !isDisabled ? "italic text-yellow-800" : ""}`}
                      >
                        {chunk.text}
                      </p>
                      <div className={panelStyles.chunkActions}>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(i);
                          }}
                          className="p-1"
                          title="Edit text"
                          aria-label={`Edit subtitle at ${formatTime(start)}`}
                          size="icon"
                          variant="ghost"
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleChunkState(i);
                          }}
                          className="p-1"
                          title={
                            isDisabled
                              ? "Restore this video section"
                              : isHidden
                                ? "Remove this video section"
                                : "Hide subtitles (select again to remove this section)"
                          }
                          aria-label={
                            isDisabled
                              ? `Restore section at ${formatTime(start)}`
                              : isHidden
                                ? `Remove section at ${formatTime(start)}`
                                : `Hide subtitles at ${formatTime(start)}`
                          }
                          size="icon"
                          variant="ghost"
                        >
                          {isDisabled ? (
                            <SkipForward className="h-3 w-3 text-red-500" />
                          ) : isHidden ? (
                            <EyeOff className="h-3 w-3 text-yellow-600" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {/* Word pills for dynamic behind/front toggling */}
                    {dynamicEnabled &&
                      chunk.words &&
                      chunk.words.length > 0 &&
                      !isDisabled && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {chunk.words.map(
                            (word: ProcessedWord, wordIdx: number) => {
                              const pos = word.dynamicPosition || "front";
                              const isBehind = pos === "behind";
                              return (
                                <button
                                  key={`${word.timestamp[0]}-${wordIdx}`}
                                  type="button"
                                  aria-label={`${word.text}: ${isBehind ? "behind" : "in front of"} person`}
                                  aria-pressed={isBehind}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWordDynamicPosition(
                                      word.timestamp,
                                      pos,
                                    );
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                    isBehind
                                      ? "bg-purple-100 text-purple-800 hover:bg-purple-200 border border-purple-300"
                                      : "bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300"
                                  }`}
                                  title={
                                    isBehind
                                      ? "Behind person (click to move to front)"
                                      : "In front of person (click to move behind)"
                                  }
                                >
                                  <span
                                    className={`text-[10px] font-bold ${isBehind ? "text-purple-600" : "text-blue-500"}`}
                                  >
                                    {isBehind ? "Behind" : "Front"}
                                  </span>
                                  {word.text}
                                </button>
                              );
                            },
                          )}
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className={panelStyles.transcriptExports}>
        <div className="text-xs font-semibold mb-3">Download subtitles</div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            onClick={handleDownloadJson}
            variant="outline"
            className="h-9 gap-1 px-2 text-xs"
          >
            <Download size={13} />
            JSON
          </Button>

          <Button
            onClick={handleDownloadSrt}
            variant="outline"
            className="h-9 gap-1 px-2 text-xs"
          >
            <Download size={13} />
            SRT
          </Button>

          <Button
            onClick={handleDownloadVtt}
            variant="outline"
            className="h-9 gap-1 px-2 text-xs"
          >
            <Download size={13} />
            WebVTT
          </Button>
        </div>
      </div>

      {/* Manual subtitle insertion */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddError("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add subtitle</DialogTitle>
            <DialogDescription>
              Times accept seconds (12.5) or HH:MM:SS.mmm. The subtitle is
              inserted and sorted by start time.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onKeyDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              handleAddSubtitle();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold">Start time</span>
                <Input
                  aria-label="Subtitle start time"
                  aria-invalid={Boolean(addError)}
                  inputMode="decimal"
                  placeholder="0.000"
                  value={draftStart}
                  onChange={(event) => {
                    setDraftStart(event.target.value);
                    setAddError("");
                  }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold">End time</span>
                <Input
                  aria-label="Subtitle end time"
                  aria-invalid={Boolean(addError)}
                  inputMode="decimal"
                  placeholder="2.000"
                  value={draftEnd}
                  onChange={(event) => {
                    setDraftEnd(event.target.value);
                    setAddError("");
                  }}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">Subtitle text</span>
              <Input
                aria-label="Subtitle text"
                placeholder="Words shown on screen"
                value={draftText}
                onChange={(event) => {
                  setDraftText(event.target.value);
                  setAddError("");
                }}
              />
            </label>
            {addError ? (
              <p role="alert" className="text-xs text-destructive">
                {addError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add subtitle</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
