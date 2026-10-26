"use client";

import { useCallback, useRef, useState } from "react";
import type { DragEvent, ChangeEvent } from "react";
import dynamic from "next/dynamic";
import { CloudUpload, FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import styles from "./landing.module.css";

const CameraRecorder = dynamic(
  () => import("./camera-recorder").then((module) => module.CameraRecorder),
  {
    loading: () => (
      <div
        className="p-8 text-center text-sm text-muted-foreground"
        role="status"
      >
        Opening camera…
      </div>
    ),
  },
);

interface LandingDropzoneProps {
  onVideoSelect?: (file: File) => void;
}

export function LandingDropzone({ onVideoSelect }: LandingDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const dragCounterRef = useRef(0);

  const handleFile = useCallback(
    (file: File | null) => {
      if (file?.type.startsWith("video/")) onVideoSelect?.(file);
    },
    [onVideoSelect],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleFile(event.target.files?.[0] ?? null);
      event.target.value = "";
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      handleFile(event.dataTransfer.files?.[0] ?? null);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleRecordedVideo = useCallback(
    (file: File) => {
      setIsRecorderOpen(false);
      onVideoSelect?.(file);
    },
    [onVideoSelect],
  );

  return (
    <>
      <div
        className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        <span className={styles.uploadIcon}>
          <CloudUpload size={39} strokeWidth={1.6} />
        </span>
        <h2>{isDragOver ? "Drop your video to start" : "Drop your video here to begin"}</h2>
        <p>MP4, MOV, WebM — processed locally in your browser</p>
        <div className={styles.dropzoneActions}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={styles.primaryButton}
          >
            <FolderOpen size={18} /> Browse files
          </button>
          <button
            type="button"
            onClick={() => setIsRecorderOpen(true)}
            className={styles.secondaryButton}
          >
            <span className={styles.recordDot} /> Record
          </button>
        </div>
        <span className={styles.dropHint}>or drag &amp; drop</span>
        <div className={styles.dropTrust}>
          <span>No cloud upload</span>
          <span aria-hidden="true">•</span>
          <span>Runs on your device</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Select a video"
          onChange={handleInputChange}
        />
      </div>
      <Dialog open={isRecorderOpen} onOpenChange={setIsRecorderOpen}>
        <DialogContent
          className="overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Record a video</DialogTitle>
          <DialogDescription className="sr-only">
            Record a video with an available camera and use it for subtitles.
          </DialogDescription>
          <CameraRecorder
            onVideoReady={handleRecordedVideo}
            onCancel={() => setIsRecorderOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
