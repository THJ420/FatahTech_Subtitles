import { useEffect, useMemo, useState } from "react";
import {
  analyzeFootageSamples,
  FOOTAGE_SAMPLE_COUNT,
  FOOTAGE_SAMPLE_HEIGHT,
  FOOTAGE_SAMPLE_WIDTH,
  footageSampleTimestamps,
  synthesizeColorGradePresets,
  type ColorAnalysisStatus,
  type FootageSample,
  type FootageStats,
} from "@/lib/color-grade-analysis";
import type { ColorGradePreset } from "@/lib/color-grade";

export interface FootageColorAnalysis {
  status: ColorAnalysisStatus;
  stats: FootageStats | null;
  presets: ColorGradePreset[];
}

interface AnalysisState extends FootageColorAnalysis {
  file: File;
  duration: number;
}

/**
 * Sample a few frames of an imported clip and synthesize tailored looks.
 *
 * The standard presets are always available while sampling or when the codec
 * cannot be decoded; analysis failure must never block editing.
 */
export function useFootageColorAnalysis(
  file: File | null | undefined,
  duration: number,
): FootageColorAnalysis {
  const fallbackPresets = useMemo(() => synthesizeColorGradePresets(null), []);
  const [state, setState] = useState<AnalysisState | null>(null);

  useEffect(() => {
    if (!file || !Number.isFinite(duration) || duration <= 0) return;

    let disposed = false;
    let disposeInput: (() => void) | undefined;

    void (async () => {
      const { Input, BlobSource, ALL_FORMATS, CanvasSink } =
        await import("mediabunny");
      if (disposed) return;
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      });
      disposeInput = () => input.dispose();
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || disposed || !(await track.canDecode())) {
          throw new Error("No decodable video track");
        }
        const sink = new CanvasSink(track, {
          width: FOOTAGE_SAMPLE_WIDTH,
          height: FOOTAGE_SAMPLE_HEIGHT,
          fit: "cover",
          poolSize: 1,
        });
        const canvas = document.createElement("canvas");
        canvas.width = FOOTAGE_SAMPLE_WIDTH;
        canvas.height = FOOTAGE_SAMPLE_HEIGHT;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D is unavailable");

        const samples: FootageSample[] = [];
        for await (const frame of sink.canvasesAtTimestamps(
          footageSampleTimestamps(duration, FOOTAGE_SAMPLE_COUNT),
        )) {
          if (disposed) return;
          if (!frame) continue;
          // The sink reuses pooled canvases, so read the pixels immediately.
          ctx.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          samples.push({
            data: image.data,
            width: image.width,
            height: image.height,
          });
        }
        canvas.width = 0;
        canvas.height = 0;

        const stats = analyzeFootageSamples(samples);
        if (disposed) return;
        setState({
          file,
          duration,
          status: stats ? "ready" : "unavailable",
          stats,
          presets: synthesizeColorGradePresets(stats),
        });
      } catch {
        if (!disposed) {
          setState({
            file,
            duration,
            status: "unavailable",
            stats: null,
            presets: fallbackPresets,
          });
        }
      } finally {
        input.dispose();
      }
    })().catch(() => {
      // A failed optional decode must not interrupt the editor.
    });

    return () => {
      disposed = true;
      disposeInput?.();
    };
  }, [file, duration, fallbackPresets]);

  if (!file || !Number.isFinite(duration) || duration <= 0) {
    return { status: "idle", stats: null, presets: fallbackPresets };
  }
  if (!state || state.file !== file || state.duration !== duration) {
    return { status: "sampling", stats: null, presets: fallbackPresets };
  }
  return {
    status: state.status,
    stats: state.stats,
    presets: state.presets.length ? state.presets : fallbackPresets,
  };
}
