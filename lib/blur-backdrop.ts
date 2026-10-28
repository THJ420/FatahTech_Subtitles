/**
 * Blurred backdrop for the "Blurred" video background mode.
 *
 * Shared by the live preview (`components/video-upload.tsx`) and the export
 * renderer (`hooks/useVideoDownloadMediaBunny.ts`). It exists because those two
 * paths had hand-mirrored copies of this logic and had already drifted apart.
 *
 * Two artifacts this fixes, both previously visible:
 *
 * 1. **Framing mismatch.** The blur layer must be drawn from the *same* source
 *    rectangle as the masked foreground. The preview used to blur the whole
 *    uncropped frame while the foreground used the cropped rect, so in any
 *    cropped layout (9:16 landscape, face-tracked crop) the person sat against
 *    a horizontally squeezed copy of a different framing.
 *
 * 2. **Dark vignette ring.** `ctx.filter` has no source pixels beyond the
 *    canvas edge, so blurring at exactly the canvas bounds fades the outermost
 *    pixels toward transparent. Over an opaque canvas that reads as a black
 *    border. Drawing the source oversized and blitting the centre back gives
 *    the kernel real pixels to sample.
 */

/** Blur radius in CSS pixels at the composited canvas size. */
export const BACKGROUND_BLUR_PX = 20;

/**
 * Margin drawn beyond each canvas edge, in multiples of the blur radius.
 *
 * A CSS `blur(Npx)` is a Gaussian with standard deviation N, so its visible
 * tail reaches roughly 3N. Drawing the source 3N past every edge means the
 * kernel only ever samples real pixels, which is what removes the falloff to
 * transparent (and therefore the dark border ring).
 */
const MARGIN_IN_SIGMA = 3;

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw `source` blurred and crop-aligned onto `target`.
 *
 * `scratch` is caller-owned so it can be reused across frames; it is resized
 * (and therefore cleared) when the target dimensions change. It must be a DOM
 * canvas, not an `OffscreenCanvas`: `ctx.filter` is not implemented on
 * `OffscreenCanvasRenderingContext2D` in all browsers.
 */
export function drawBlurredBackdrop(
  target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceRect: SourceRect,
  scratch: HTMLCanvasElement,
  width: number,
  height: number,
  blurPx: number = BACKGROUND_BLUR_PX,
): void {
  if (width <= 0 || height <= 0) return;

  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) return;

  // Draw the source scaled so it extends `margin` past every edge, then blit
  // the centre back at 1:1. The extra scale is ~1.03-1.15x at realistic sizes,
  // and a backdrop blurred by `blurPx` has no detail left to compare against,
  // so the crop is not perceptible.
  const margin = MARGIN_IN_SIGMA * blurPx;
  const overscanWidth = width + 2 * margin;
  const overscanHeight = height + 2 * margin;
  const offsetX = -margin;
  const offsetY = -margin;

  scratchCtx.filter = `blur(${blurPx}px)`;
  scratchCtx.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    offsetX,
    offsetY,
    overscanWidth,
    overscanHeight,
  );
  scratchCtx.filter = "none";

  target.drawImage(scratch, 0, 0);
}
