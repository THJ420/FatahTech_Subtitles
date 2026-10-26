import { computeCropX, type PositionTimeline } from "./person-tracking";

export interface TrackedFace {
  x: number;
  y: number;
}
export type PortraitLayout = "single" | "stacked";

/** Keep left/right ordering independent of detector confidence ordering. */
export function orderFaces(faces: TrackedFace[]): TrackedFace[] {
  return [...faces].sort((a, b) => a.x - b.x);
}

/** Interpolate within a shot, never across a change in the number of faces. */
export function interpolateFaces(
  timeline: PositionTimeline,
  time: number,
): TrackedFace[] {
  if (!timeline.length) return [];
  let lo = 0,
    hi = timeline.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (timeline[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = timeline[lo],
    b = timeline[lo + 1];
  const faces = a.faces ?? [];
  if (!b || !b.faces || b.faces.length !== faces.length || time <= a.time)
    return faces;
  const t = Math.min(1, (time - a.time) / (b.time - a.time));
  return faces.map((face, i) => {
    const next = b.faces![i];
    if (Math.hypot(next.x - face.x, next.y - face.y) > 0.3) return face;
    return {
      x: face.x + (next.x - face.x) * t,
      y: face.y + (next.y - face.y) * t,
    };
  });
}

export function getPortraitCrops(
  srcW: number,
  srcH: number,
  width: number,
  height: number,
  faces: TrackedFace[],
  swapped = false,
  zoom = 1,
) {
  // With no detection, keep a useful left/right split that the user can swap.
  const ordered = orderFaces(
    faces.length
      ? faces.slice(0, 2)
      : [
          { x: 0.25, y: 0.35 },
          { x: 0.75, y: 0.35 },
        ],
  );
  if (swapped) ordered.reverse();
  const tileHeight = height / ordered.length;
  const scale = Number.isFinite(zoom) ? Math.max(1, Math.min(2.5, zoom)) : 1;
  return ordered.map((face, i) => {
    const aspect = width / tileHeight;
    // Two close crops, each covering at most half of a widescreen source.
    const sw =
      Math.min(srcW / (ordered.length === 2 ? 2 : 1), srcH * aspect) / scale;
    const sh = sw / aspect;
    return {
      sx: computeCropX(face.x, srcW, sw),
      sy: Math.max(0, Math.min(srcH - sh, face.y * srcH - sh * 0.35)),
      sw,
      sh,
      dx: 0,
      dy: i * tileHeight,
      dw: width,
      dh: tileHeight,
    };
  });
}

export function drawPortraitLayout(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  width: number,
  height: number,
  faces: TrackedFace[],
  swapped = false,
  zoom = 1,
) {
  for (const c of getPortraitCrops(
    srcW,
    srcH,
    width,
    height,
    faces,
    swapped,
    zoom,
  )) {
    ctx.drawImage(source, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh);
  }
}

/** Smooth small movements; tolerate a brief occlusion, but reset on seeks/cuts. */
export function createFaceSmoother() {
  let previous: TrackedFace[] = [];
  let lastTime = -1;
  let missingSince: number | null = null;
  return (raw: TrackedFace[], time: number): TrackedFace[] => {
    const elapsed = time - lastTime;
    if (elapsed < 0 || elapsed > 1) {
      previous = [];
      missingSince = null;
    }
    lastTime = time;
    if (raw.length < previous.length) {
      missingSince ??= time;
      if (time - missingSince < 0.75) return previous;
    } else {
      missingSince = null;
    }
    const alpha = 1 - Math.pow(0.85, Math.max(0, elapsed) / 0.1);
    previous = raw.map((face, i) => {
      const old = previous[i];
      if (
        !old ||
        raw.length !== previous.length ||
        Math.hypot(face.x - old.x, face.y - old.y) > 0.3
      )
        return face;
      return {
        x: old.x + alpha * (face.x - old.x),
        y: old.y + alpha * (face.y - old.y),
      };
    });
    return previous;
  };
}
