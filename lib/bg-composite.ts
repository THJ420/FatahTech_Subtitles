/**
 * The single compositor used by both the live preview and the export renderer.
 *
 * Previously these were two hand-mirrored copies of the same five-step
 * composite, and they had already drifted apart: the preview blurred the
 * uncropped frame while its foreground used the cropped rect, so in any cropped
 * layout the person sat against a different framing than the export produced.
 *
 * Everything geometry-related is expressed as a `sourceRect` in *intrinsic*
 * video pixels, so a caller cannot accidentally apply a different crop to the
 * background and the foreground.
 *
 * ## Compositing order
 *
 *   1. background layer (`drawBackgroundLayer`)
 *   2. caller-specific content (e.g. "text behind person")
 *   3. masked foreground (`drawMaskedForeground`)
 *   4. caller-specific content (e.g. "text in front of person")
 *
 * Steps 2 and 4 stay with the caller because only the dynamic-depth mode needs
 * them, and they depend on subtitle state this module should not know about.
 */

import { drawBlurredBackdrop, BACKGROUND_BLUR_PX } from "@/lib/blur-backdrop";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IntrinsicSize {
  width: number;
  height: number;
}

export type BackgroundFill =
  /** Keep the original frame — used by the "text behind person" depth mode. */
  | { kind: "original" }
  | { kind: "solid"; color: string }
  | { kind: "blur"; radius?: number }
  | {
      kind: "image";
      source: CanvasImageSource;
      /** Intrinsic dimensions of `source`, for cover-fitting. */
      width: number;
      height: number;
    }
  /** Preview only: checkerboard. Export substitutes a solid colour. */
  | { kind: "transparent" };

export type Any2DContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface CompositeScratch {
  useOffscreen: boolean;
  foreground: HTMLCanvasElement | OffscreenCanvas | null;
  foregroundCtx: Any2DContext | null;
  mask: HTMLCanvasElement | OffscreenCanvas | null;
  maskCtx: Any2DContext | null;
  maskImageData: ImageData | null;
  /**
   * The mask currently uploaded to `mask`. `MaskStore` returns a stable view
   * per slot, so identity comparison skips the per-pixel upload on the ~55 of
   * 60 frames per second that reuse the same sample.
   */
  lastMaskRef: Uint8Array | null;
  /** Must stay a DOM canvas: `ctx.filter` is missing on OffscreenCanvas. */
  blur: HTMLCanvasElement | null;
  checkerPattern: CanvasPattern | null;
}

export function createCompositeScratch(useOffscreen = false): CompositeScratch {
  return {
    useOffscreen,
    foreground: null,
    foregroundCtx: null,
    mask: null,
    maskCtx: null,
    maskImageData: null,
    lastMaskRef: null,
    blur: null,
    checkerPattern: null,
  };
}

/** Zero every backing store so the GPU can reclaim it before GC runs. */
export function releaseCompositeScratch(scratch: CompositeScratch): void {
  for (const surface of [scratch.foreground, scratch.mask, scratch.blur]) {
    if (surface) {
      surface.width = 0;
      surface.height = 0;
    }
  }
  scratch.foreground = null;
  scratch.foregroundCtx = null;
  scratch.mask = null;
  scratch.maskCtx = null;
  scratch.maskImageData = null;
  scratch.lastMaskRef = null;
  scratch.blur = null;
  scratch.checkerPattern = null;
}

function createCanvas(
  width: number,
  height: number,
  useOffscreen: boolean,
): HTMLCanvasElement | OffscreenCanvas {
  if (useOffscreen && typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The sub-rectangle of the mask that corresponds to `sourceRect`.
 *
 * The mask covers the whole video frame, so compositing a cropped region means
 * cropping the mask by the same fraction. Pure and DOM-free — this is the
 * function the preview/export drift bug lived in, and it is unit-tested.
 */
export function maskRectFor(
  intrinsic: IntrinsicSize,
  sourceRect: Rect,
  maskWidth: number,
  maskHeight: number,
): Rect {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { x: 0, y: 0, width: maskWidth, height: maskHeight };
  }
  return {
    x: (sourceRect.x / intrinsic.width) * maskWidth,
    y: (sourceRect.y / intrinsic.height) * maskHeight,
    width: (sourceRect.width / intrinsic.width) * maskWidth,
    height: (sourceRect.height / intrinsic.height) * maskHeight,
  };
}

function ensureForeground(
  scratch: CompositeScratch,
  width: number,
  height: number,
): Any2DContext | null {
  if (!scratch.foreground) {
    scratch.foreground = createCanvas(width, height, scratch.useOffscreen);
    scratch.foregroundCtx = scratch.foreground.getContext("2d") as
      | Any2DContext
      | null;
  }
  if (scratch.foreground.width !== width || scratch.foreground.height !== height) {
    scratch.foreground.width = width;
    scratch.foreground.height = height;
  }
  return scratch.foregroundCtx;
}

function ensureMask(
  scratch: CompositeScratch,
  width: number,
  height: number,
): Any2DContext | null {
  if (!scratch.mask) {
    scratch.mask = createCanvas(width, height, scratch.useOffscreen);
    scratch.maskCtx = scratch.mask.getContext("2d") as Any2DContext | null;
  }
  if (scratch.mask.width !== width || scratch.mask.height !== height) {
    scratch.mask.width = width;
    scratch.mask.height = height;
    // Resizing resets the backing store; the cached ImageData still fits.
  }
  return scratch.maskCtx;
}

/** `object-fit: cover` for an arbitrary image source. */
function drawCover(
  ctx: Any2DContext,
  source: CanvasImageSource,
  intrinsic: IntrinsicSize,
  width: number,
  height: number,
): void {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) return;
  const scale = Math.max(width / intrinsic.width, height / intrinsic.height);
  const drawWidth = intrinsic.width * scale;
  const drawHeight = intrinsic.height * scale;
  ctx.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

const CHECKER_TILE = 12;

function drawCheckerboard(
  ctx: Any2DContext,
  scratch: CompositeScratch,
  width: number,
  height: number,
): void {
  if (!scratch.checkerPattern) {
    const tile = createCanvas(CHECKER_TILE * 2, CHECKER_TILE * 2, false);
    const tileCtx = tile.getContext("2d") as CanvasRenderingContext2D | null;
    if (!tileCtx) return;
    tileCtx.fillStyle = "#1c1c1c";
    tileCtx.fillRect(0, 0, CHECKER_TILE * 2, CHECKER_TILE * 2);
    tileCtx.fillStyle = "#2e2e2e";
    tileCtx.fillRect(0, 0, CHECKER_TILE, CHECKER_TILE);
    tileCtx.fillRect(CHECKER_TILE, CHECKER_TILE, CHECKER_TILE, CHECKER_TILE);
    scratch.checkerPattern = ctx.createPattern(tile, "repeat");
  }
  if (!scratch.checkerPattern) return;

  ctx.save();
  ctx.fillStyle = scratch.checkerPattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export interface BackgroundLayerOptions {
  ctx: Any2DContext;
  frame: CanvasImageSource;
  sourceRect: Rect;
  destWidth: number;
  destHeight: number;
  fill: BackgroundFill;
  scratch: CompositeScratch;
}

/**
 * Paint the replacement background.
 *
 * Every branch uses `sourceRect`, so the backdrop is always framed identically
 * to the foreground that will be composited over it.
 */
export function drawBackgroundLayer({
  ctx,
  frame,
  sourceRect,
  destWidth,
  destHeight,
  fill,
  scratch,
}: BackgroundLayerOptions): void {
  switch (fill.kind) {
    case "original":
      ctx.drawImage(
        frame,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        0,
        0,
        destWidth,
        destHeight,
      );
      return;

    case "solid":
      ctx.fillStyle = fill.color;
      ctx.fillRect(0, 0, destWidth, destHeight);
      return;

    case "blur":
      if (!scratch.blur) {
        scratch.blur = document.createElement("canvas");
      }
      drawBlurredBackdrop(
        ctx,
        frame,
        sourceRect,
        scratch.blur,
        destWidth,
        destHeight,
        fill.radius ?? BACKGROUND_BLUR_PX,
      );
      return;

    case "image":
      drawCover(
        ctx,
        fill.source,
        { width: fill.width, height: fill.height },
        destWidth,
        destHeight,
      );
      return;

    case "transparent":
      drawCheckerboard(ctx, scratch, destWidth, destHeight);
      return;
  }
}

export interface MaskedForegroundOptions {
  ctx: Any2DContext;
  frame: CanvasImageSource;
  /** Region of `frame` to draw, in `frame`'s own pixels. */
  sourceRect: Rect;
  destWidth: number;
  destHeight: number;
  /** Refined alpha, 0–255, one byte per pixel. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  /**
   * Sub-rectangle of the mask to composite, from `maskRectFor`.
   *
   * Passed in rather than derived from `sourceRect` because the two live in
   * different coordinate spaces on the export path: the frame there is already
   * cropped, while the mask still covers the whole video frame.
   */
  maskRect: Rect;
  scratch: CompositeScratch;
}

/**
 * Draw `frame` clipped to `mask` onto `ctx`.
 *
 * Returns false when the scratch contexts are unavailable, in which case
 * nothing was drawn and the caller should fall back to an unmasked frame.
 */
export function drawMaskedForeground({
  ctx,
  frame,
  sourceRect,
  destWidth,
  destHeight,
  mask,
  maskWidth,
  maskHeight,
  maskRect,
  scratch,
}: MaskedForegroundOptions): boolean {
  const foregroundCtx = ensureForeground(scratch, destWidth, destHeight);
  const maskCtx = ensureMask(scratch, maskWidth, maskHeight);
  if (!foregroundCtx || !maskCtx || !scratch.foreground || !scratch.mask) {
    return false;
  }

  foregroundCtx.clearRect(0, 0, destWidth, destHeight);
  foregroundCtx.drawImage(
    frame,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    destWidth,
    destHeight,
  );

  const needsUpload =
    scratch.lastMaskRef !== mask ||
    !scratch.maskImageData ||
    scratch.maskImageData.width !== maskWidth ||
    scratch.maskImageData.height !== maskHeight;

  if (needsUpload) {
    if (
      !scratch.maskImageData ||
      scratch.maskImageData.width !== maskWidth ||
      scratch.maskImageData.height !== maskHeight
    ) {
      scratch.maskImageData = maskCtx.createImageData(maskWidth, maskHeight);
    }
    const pixels = scratch.maskImageData.data;
    for (let i = 0; i < mask.length; i++) {
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = mask[i];
    }
    maskCtx.putImageData(scratch.maskImageData, 0, 0);
    scratch.lastMaskRef = mask;
  }

  foregroundCtx.globalCompositeOperation = "destination-in";
  foregroundCtx.drawImage(
    scratch.mask,
    maskRect.x,
    maskRect.y,
    maskRect.width,
    maskRect.height,
    0,
    0,
    destWidth,
    destHeight,
  );
  foregroundCtx.globalCompositeOperation = "source-over";

  ctx.drawImage(scratch.foreground, 0, 0);
  return true;
}
