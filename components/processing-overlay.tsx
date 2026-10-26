"use client";

import { AudioLines, Cpu, FileText, LockKeyhole, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import panelStyles from "@/components/editor-panels.module.css";

interface ProcessingOverlayProps {
  isVisible: boolean;
  statusMessage: string;
  progress: number;
  canCancel?: boolean;
  onCancel?: () => void;
  liveText?: string;
}

export function ProcessingOverlay({
  isVisible,
  statusMessage,
  progress,
  canCancel = false,
  onCancel,
  liveText,
}: ProcessingOverlayProps) {
  if (!isVisible) return null;
  const safeProgress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress))
    : 0;
  const activeStage = /load|download|initializ|model/i.test(statusMessage)
    ? "model"
    : /audio|extract/i.test(statusMessage)
      ? "audio"
      : "subtitles";

  return (
    <Dialog
      open={isVisible}
      onOpenChange={(open) => {
        if (!open && canCancel) onCancel?.();
      }}
    >
      <DialogContent
        className={panelStyles.processingModal}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (!canCancel) event.preventDefault();
        }}
      >
        <div className={panelStyles.processingHeading}>
          <Sparkles aria-hidden="true" />
          <div>
            <DialogTitle asChild>
              <h3 aria-live="polite">{statusMessage}</h3>
            </DialogTitle>
            <DialogDescription>
              First use can take a minute while the speech model loads. All
              processing runs in your browser.
            </DialogDescription>
          </div>
        </div>
        <div className={panelStyles.progressRow}>
          <Progress value={safeProgress} aria-label="Processing progress" />
          <span className="text-sm font-semibold tabular-nums">
            {Math.round(safeProgress)}%
          </span>
        </div>
        <div
          className={panelStyles.processingStages}
          aria-label="Processing steps"
        >
          <div
            className={panelStyles.processingStage}
            data-active={activeStage === "model"}
          >
            <Cpu size={21} />
            <span>1. Load speech model</span>
          </div>
          <div
            className={panelStyles.processingStage}
            data-active={activeStage === "audio"}
          >
            <AudioLines size={21} />
            <span>2. Process audio</span>
          </div>
          <div
            className={panelStyles.processingStage}
            data-active={activeStage === "subtitles"}
          >
            <FileText size={21} />
            <span>3. Generate subtitles</span>
          </div>
        </div>
        {/* Live transcription preview — grows token by token while Whisper runs */}
        {liveText && (
          <div className="mt-5 w-full max-h-40 overflow-y-auto rounded-xl bg-muted/40 border border-border p-4">
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {liveText}
            </p>
          </div>
        )}
        {canCancel && onCancel && (
          <Button
            variant="outline"
            onClick={onCancel}
            className="mt-5 h-10 w-full"
          >
            Stop processing
          </Button>
        )}
        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole size={13} aria-hidden="true" /> Your video stays on your
          device.
        </p>
      </DialogContent>
    </Dialog>
  );
}
