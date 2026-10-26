export interface ModelLoadingState {
  phase: "checking" | "downloading" | "initializing" | "warming" | "ready";
  /** Byte-weighted download progress. Initialization has no measurable percent. */
  progress: number | null;
  loadedBytes: number;
  totalBytes: number | null;
  completedFiles: number;
  totalFiles: number;
}

export interface ModelFileProgress {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

interface FileDownload {
  loaded: number;
  total: number | null;
  done: boolean;
  sizeKnown: boolean;
}

/** Whisper loads separate encoder and decoder files. Small config files are not
 * a useful measure of download completion and must not finish the progress bar. */
export class ModelDownloadTracker {
  private files = new Map<string, FileDownload>();
  private phase: ModelLoadingState["phase"] = "checking";

  update(event: ModelFileProgress): ModelLoadingState {
    if (event.status === "ready") return this.setPhase("initializing");
    if (!event.file || !/\.onnx(?:_data)?$/.test(event.file))
      return this.snapshot();
    const previous = this.files.get(event.file) ?? {
      loaded: 0,
      total: null,
      done: false,
      sizeKnown: false,
    };
    const total =
      typeof event.total === "number" &&
      Number.isFinite(event.total) &&
      event.total > 0
        ? event.total
        : previous.total;
    const loaded =
      typeof event.loaded === "number" && Number.isFinite(event.loaded)
        ? Math.max(0, event.loaded)
        : previous.loaded;
    const done = event.status === "done" || previous.done;
    // With no Content-Length, Transformers grows `total` to match each chunk.
    // Such events cannot provide a reliable percentage until the file is done.
    const sizeKnown =
      total !== null &&
      (done ||
        loaded < total ||
        (previous.sizeKnown && total === previous.total));
    this.files.set(event.file, {
      loaded:
        done && total !== null
          ? total
          : total === null
            ? loaded
            : Math.min(loaded, total),
      total,
      done,
      sizeKnown,
    });
    this.phase = "downloading";
    return this.snapshot();
  }

  setPhase(phase: ModelLoadingState["phase"]): ModelLoadingState {
    this.phase = phase;
    return this.snapshot();
  }

  snapshot(): ModelLoadingState {
    const files = Array.from(this.files.entries());
    const hasEncoder = files.some(([name]) =>
      /(?:^|\/)encoder_model[^/]*\.onnx$/.test(name),
    );
    const hasDecoder = files.some(([name]) =>
      /(?:^|\/)decoder_model_merged[^/]*\.onnx$/.test(name),
    );
    const hasAllSizes =
      hasEncoder && hasDecoder && files.every(([, file]) => file.sizeKnown);
    const loadedBytes = files.reduce((sum, [, file]) => sum + file.loaded, 0);
    const totalBytes = hasAllSizes
      ? files.reduce((sum, [, file]) => sum + (file.total ?? 0), 0)
      : null;
    const filesAvailable =
      hasEncoder &&
      hasDecoder &&
      files.every(
        ([, file]) =>
          file.done ||
          (file.sizeKnown && file.total !== null && file.loaded >= file.total),
      );
    // Download completion is not model readiness: ONNX sessions and GPU shaders
    // can still be preparing after all file bytes have arrived.
    const phase =
      this.phase === "downloading" && filesAvailable
        ? "initializing"
        : this.phase;
    return {
      phase,
      progress:
        phase === "downloading" && totalBytes !== null && totalBytes > 0
          ? Math.max(
              0,
              Math.min(100, Math.round((loadedBytes / totalBytes) * 100)),
            )
          : null,
      loadedBytes,
      totalBytes,
      completedFiles: files.filter(([, file]) => file.done).length,
      totalFiles: Math.max(2, files.length),
    };
  }
}

/** Transformers.js and the speech worker report percentages, never fractions. */
export function clampProgressPercent(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}
