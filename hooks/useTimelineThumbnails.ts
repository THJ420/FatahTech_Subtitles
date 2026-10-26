import { useEffect, useState } from "react";

/** Small, bounded thumbnail strip; it never seeks the playback element. */
export function useTimelineThumbnails(
  file: File | null | undefined,
  duration: number,
) {
  const [result, setResult] = useState<{ file: File; images: string[] } | null>(
    null,
  );
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
        if (!track || disposed || !(await track.canDecode())) return;
        const count = Math.min(24, Math.max(4, Math.ceil(duration / 5)));
        const sink = new CanvasSink(track, {
          width: 120,
          height: 60,
          fit: "cover",
          poolSize: 1,
        });
        const images: string[] = [];
        for await (const frame of sink.canvasesAtTimestamps(
          Array.from(
            { length: count },
            (_, index) => (duration * index) / count,
          ),
        )) {
          if (disposed) return;
          if (frame) {
            const canvas = document.createElement("canvas");
            canvas.width = 120;
            canvas.height = 60;
            canvas.getContext("2d")?.drawImage(frame.canvas, 0, 0);
            images.push(canvas.toDataURL("image/webp", 0.65));
            canvas.width = canvas.height = 0;
          }
        }
        if (!disposed) setResult({ file, images });
      } catch {
        // Unsupported thumbnail codecs do not block native playback or editing.
      } finally {
        input.dispose();
      }
    })().catch(() => {
      // A failed optional module download must not interrupt the editor.
    });
    return () => {
      disposed = true;
      disposeInput?.();
    };
  }, [file, duration]);
  return result && result.file === file ? result.images : [];
}
