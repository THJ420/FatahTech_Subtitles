/**
 * Budgeted storage for pre-computed alpha mattes.
 *
 * The previous implementation kept every mask in a plain array that was never
 * evicted. At 640x360 and 8fps that is 225KB per mask — 1.1GB for a ten-minute
 * clip. On a 4GB device the run died partway through with an ONNX allocation
 * failure, which then discarded every mask already computed.
 *
 * Two things fix that here:
 *
 * 1. **A byte budget.** `planMaskStore` solves for mask resolution *and* sample
 *    rate together, because reducing only the rate still overruns on long
 *    clips: at a fixed resolution a ten-minute video falls to 4fps and is still
 *    over budget.
 * 2. **A single preallocated slab.** One `ArrayBuffer` with computed offsets,
 *    not thousands of separate `Uint8Array`s — fewer objects for the GC to
 *    trace, and a predictable ceiling.
 *
 * Masks are stored at a lower resolution than the frame they composite onto;
 * the compositor upscales them. That is intentional and was already the case.
 */

/** Mask short-side candidates, largest first. */
const SHORT_SIDE_CANDIDATES = [320, 288, 256, 240] as const;

/** Floor for the sample rate; below this motion reads as stepped. */
export const MIN_SAMPLE_FPS = 4;

/** Ceiling for the sample rate, to keep processing time bounded. */
export const MAX_SAMPLE_FPS = 12;

/** Sample rate for clips long enough that the budget, not quality, decides. */
const DEFAULT_SAMPLE_FPS = 8;

/** Short clips get a denser sample because the budget easily affords it. */
const SHORT_CLIP_SECONDS = 90;
const SHORT_CLIP_SAMPLE_FPS = 10;

/** Default ceiling for mask storage, in bytes. */
export const DEFAULT_MASK_BUDGET_BYTES = 256 * 1024 * 1024;

/** Mean absolute signature difference below which two mattes may cross-fade. */
const LINKABLE_DISTANCE = 32;

export interface MaskStorePlan {
  width: number;
  height: number;
  sampleFps: number;
  totalFrames: number;
  bytesPerFrame: number;
  bytes: number;
  /** True when the budget forced a lower resolution or sample rate. */
  degraded: boolean;
}

export interface MaskMeta {
  /** Fraction of the frame covered by the subject, 0–1. */
  coverage: number;
  centroidX: number;
  centroidY: number;
  /** Estimated chin line, 0–1. Null when no subject was found. */
  chinY: number | null;
  /** The matte failed the plausibility guard and was passed through. */
  lowConfidence: boolean;
  /** This slot reuses an earlier mask because inference failed. */
  synthetic: boolean;
  /** Consecutive mattes are similar enough to cross-fade. */
  linkable: boolean;
}

export interface MaskFrame {
  data: Uint8Array;
  width: number;
  height: number;
  index: number;
  time: number;
  meta: MaskMeta;
}

export interface FallbackMask {
  alpha: Uint8Array;
  meta: Omit<MaskMeta, "linkable">;
}

/**
 * A serializable copy of a completed mask store.
 *
 * `slab` is shared with the store rather than copied: a budgeted store can be
 * hundreds of megabytes, and IndexedDB structured-clones the buffer when the
 * record is written. Take the snapshot after the run has finished and do not
 * mutate the store afterwards.
 */
export interface MaskStoreSnapshot {
  plan: MaskStorePlan;
  slab: ArrayBuffer;
  occupied: Uint8Array;
  metas: (MaskMeta | null)[];
  storedCount: number;
}

/**
 * Safe matte for a frame whose inference failed.
 *
 * Carrying the previous matte forward keeps motion coherent. Before the first
 * success there is nothing to carry, so the frame stays fully opaque: the
 * compositor shows the original frame instead of punching a hole in it. The
 * placeholder is marked synthetic so callers do not report it as a detected
 * subject.
 */
export function createFallbackMask(
  plan: MaskStorePlan,
  previous: MaskFrame | null,
): FallbackMask {
  if (previous) {
    return {
      alpha: new Uint8Array(previous.data),
      meta: {
        coverage: previous.meta.coverage,
        centroidX: previous.meta.centroidX,
        centroidY: previous.meta.centroidY,
        chinY: previous.meta.chinY,
        lowConfidence: true,
        synthetic: true,
      },
    };
  }

  const alpha = new Uint8Array(plan.bytesPerFrame);
  alpha.fill(255);
  return {
    alpha,
    meta: {
      coverage: 1,
      centroidX: 0.5,
      centroidY: 0.5,
      chinY: null,
      lowConfidence: true,
      synthetic: true,
    },
  };
}

function evenFloor(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/** Mask dimensions for a source aspect ratio and a target short side. */
export function fitMaskAspect(
  sourceWidth: number,
  sourceHeight: number,
  shortSide: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: evenFloor(shortSide), height: evenFloor(shortSide) };
  }
  if (sourceWidth >= sourceHeight) {
    const height = evenFloor(shortSide);
    const width = evenFloor((sourceWidth / sourceHeight) * height);
    return { width, height };
  }
  const width = evenFloor(shortSide);
  const height = evenFloor((sourceHeight / sourceWidth) * width);
  return { width, height };
}

/**
 * Choose mask resolution and sample rate to fit `budgetBytes`.
 *
 * Resolution is stepped down only when the smallest viable sample rate would
 * otherwise be exceeded, so short clips keep full detail and long clips trade
 * resolution for temporal coverage rather than silently blowing the budget.
 */
export function planMaskStore(
  durationSeconds: number,
  sourceWidth: number,
  sourceHeight: number,
  budgetBytes: number = DEFAULT_MASK_BUDGET_BYTES,
): MaskStorePlan {
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (duration <= 0) {
    // Degenerate input: describe an empty store rather than throwing, so the
    // caller can surface a real error from the duration check instead.
    const { width, height } = fitMaskAspect(sourceWidth, sourceHeight, 320);
    return {
      width,
      height,
      sampleFps: DEFAULT_SAMPLE_FPS,
      totalFrames: 0,
      bytesPerFrame: width * height,
      bytes: 0,
      degraded: false,
    };
  }

  const preferredFps =
    duration <= SHORT_CLIP_SECONDS ? SHORT_CLIP_SAMPLE_FPS : DEFAULT_SAMPLE_FPS;

  for (const shortSide of SHORT_SIDE_CANDIDATES) {
    const { width, height } = fitMaskAspect(
      sourceWidth,
      sourceHeight,
      shortSide,
    );
    const bytesPerFrame = width * height;
    const affordableFrames = Math.floor(budgetBytes / bytesPerFrame);
    const affordableFps = Math.floor(affordableFrames / duration);
    const sampleFps = Math.min(preferredFps, MAX_SAMPLE_FPS, affordableFps);

    if (sampleFps < MIN_SAMPLE_FPS) continue;

    const totalFrames = Math.ceil(duration * sampleFps);
    if (totalFrames * bytesPerFrame > budgetBytes) continue;

    return {
      width,
      height,
      sampleFps,
      totalFrames,
      bytesPerFrame,
      bytes: totalFrames * bytesPerFrame,
      degraded:
        shortSide !== SHORT_SIDE_CANDIDATES[0] || sampleFps < preferredFps,
    };
  }

  // Even the smallest resolution cannot hold MIN_SAMPLE_FPS. Take the smallest
  // mask and a fractional rate that covers the whole timeline. Truncating the
  // frame count instead would silently leave the tail of the video with no
  // mask of its own, which is a correctness bug rather than a quality one.
  const { width, height } = fitMaskAspect(
    sourceWidth,
    sourceHeight,
    SHORT_SIDE_CANDIDATES[SHORT_SIDE_CANDIDATES.length - 1],
  );
  const bytesPerFrame = width * height;
  const maxFrames = Math.floor(budgetBytes / bytesPerFrame);
  if (maxFrames < 1) {
    return {
      width,
      height,
      sampleFps: 0,
      totalFrames: 0,
      bytesPerFrame,
      bytes: 0,
      degraded: true,
    };
  }

  const sampleFps = Math.min(preferredFps, maxFrames / duration);
  const totalFrames = Math.min(
    maxFrames,
    Math.max(1, Math.ceil(duration * sampleFps)),
  );
  return {
    width,
    height,
    sampleFps,
    totalFrames,
    bytesPerFrame,
    bytes: totalFrames * bytesPerFrame,
    degraded: true,
  };
}

/** Resolution steps the manual quality tiers may degrade through. */
const QUALITY_SHORT_SIDE_STEPS = [
  1024, 896, 768, 640, 512, 448, 384, 320, 288, 256, 240,
] as const;

/** Never downscale a mask below this short side. */
export const MIN_MASK_SHORT_SIDE = 240;

export interface QualityMaskRequest {
  /** Requested matte short side, before budget clamping. */
  shortSide: number;
  /** Requested samples per second, before budget clamping. */
  sampleFps: number;
  budgetBytes?: number;
}

/**
 * Plan a store for a manually selected quality tier.
 *
 * Unlike the automatic planner, this honours the requested short side and
 * sample rate exactly when they fit the tier's budget. When they do not, it
 * keeps the largest resolution it can afford and sheds sample rate first, so
 * a long clip degrades predictably instead of exhausting device memory.
 *
 * The mask is never larger than the source's short side: upsampling a matte
 * beyond the pixels it was derived from costs memory and adds no detail.
 */
export function planMaskStoreForQuality(
  durationSeconds: number,
  sourceWidth: number,
  sourceHeight: number,
  request: QualityMaskRequest,
): MaskStorePlan {
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  const budgetBytes = request.budgetBytes ?? DEFAULT_MASK_BUDGET_BYTES;
  const sourceShortSide = Math.min(sourceWidth, sourceHeight);
  const requestedShortSide = Math.max(
    2,
    Math.round(
      sourceShortSide > 0
        ? Math.min(request.shortSide, sourceShortSide)
        : request.shortSide,
    ),
  );
  const requestedFpsRaw = Math.max(1, Math.round(request.sampleFps));
  const requestedFps = Math.min(MAX_SAMPLE_FPS, requestedFpsRaw);

  if (duration <= 0) {
    const { width, height } = fitMaskAspect(
      sourceWidth,
      sourceHeight,
      requestedShortSide,
    );
    return {
      width,
      height,
      sampleFps: requestedFps,
      totalFrames: 0,
      bytesPerFrame: width * height,
      bytes: 0,
      degraded: false,
    };
  }

  const candidates = [
    requestedShortSide,
    ...QUALITY_SHORT_SIDE_STEPS.filter((side) => side < requestedShortSide),
  ];

  for (const candidate of candidates) {
    const { width, height } = fitMaskAspect(
      sourceWidth,
      sourceHeight,
      candidate,
    );
    const bytesPerFrame = width * height;

    for (
      let sampleFps = requestedFps;
      sampleFps >= MIN_SAMPLE_FPS;
      sampleFps--
    ) {
      const totalFrames = Math.max(1, Math.ceil(duration * sampleFps));
      const bytes = totalFrames * bytesPerFrame;
      if (bytes <= budgetBytes) {
        return {
          width,
          height,
          sampleFps,
          totalFrames,
          bytesPerFrame,
          bytes,
          degraded:
            candidate !== requestedShortSide ||
            sampleFps !== requestedFps ||
            requestedFpsRaw !== requestedFps,
        };
      }
    }
  }

  // Even the smallest resolution cannot afford MIN_SAMPLE_FPS. Take a
  // fractional rate covering the whole timeline rather than truncating frames,
  // which would silently leave the tail of the video unmasked.
  const floorShortSide = Math.min(MIN_MASK_SHORT_SIDE, requestedShortSide);
  const { width, height } = fitMaskAspect(
    sourceWidth,
    sourceHeight,
    floorShortSide,
  );
  const bytesPerFrame = width * height;
  const maxFrames = Math.floor(budgetBytes / bytesPerFrame);
  if (maxFrames < 1) {
    return {
      width,
      height,
      sampleFps: 0,
      totalFrames: 0,
      bytesPerFrame,
      bytes: 0,
      degraded: true,
    };
  }

  const sampleFps = Math.min(requestedFps, maxFrames / duration);
  const totalFrames = Math.min(
    maxFrames,
    Math.max(1, Math.ceil(duration * sampleFps)),
  );
  return {
    width,
    height,
    sampleFps,
    totalFrames,
    bytesPerFrame,
    bytes: totalFrames * bytesPerFrame,
    degraded: true,
  };
}

/**
 * Every Nth sample is computed in the coarse pass.
 *
 * A quarter of the frames is enough to composite a usable preview, and the
 * compositor resolves the gaps to the nearest earlier sample until the refine
 * pass fills them in.
 */
export const COARSE_PASS_STRIDE = 4;

export interface MaskPassPlan {
  coarse: number[];
  refine: number[];
}

/**
 * Split sample indices into a coarse preview pass and a refine pass.
 *
 * Indices stay in ascending order within each pass so mediabunny can use its
 * monotonically-sorted decode path. Index 0 is always coarse, so even a clip
 * shorter than the stride unlocks a preview.
 */
export function planMaskPasses(
  totalFrames: number,
  stride: number = COARSE_PASS_STRIDE,
): MaskPassPlan {
  const frames = Math.max(0, Math.floor(totalFrames));
  const step = Math.max(1, Math.floor(stride));
  const coarse: number[] = [];
  const refine: number[] = [];

  for (let index = 0; index < frames; index++) {
    if (index % step === 0) coarse.push(index);
    else refine.push(index);
  }

  return { coarse, refine };
}

const SIGNATURE_COLUMNS = 8;
const SIGNATURE_ROWS = 8;
const SAMPLES_PER_CELL = 4;

/**
 * Coarse 8x8 signature of a matte, used to decide whether two consecutive
 * samples describe the same silhouette.
 *
 * At 8fps a 30fps source has four-frame gaps. Cross-fading two unrelated
 * silhouettes is a visible morph, so the compositor only blends when the
 * signatures agree.
 */
export function computeMaskSignature(
  alpha: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const signature = new Uint8Array(SIGNATURE_COLUMNS * SIGNATURE_ROWS);
  const cellWidth = width / SIGNATURE_COLUMNS;
  const cellHeight = height / SIGNATURE_ROWS;
  const stride = Math.max(1, Math.floor(cellWidth / SAMPLES_PER_CELL));

  for (let row = 0; row < SIGNATURE_ROWS; row++) {
    for (let column = 0; column < SIGNATURE_COLUMNS; column++) {
      let sum = 0;
      let count = 0;
      const x0 = Math.floor(column * cellWidth);
      const y0 = Math.floor(row * cellHeight);
      const x1 = Math.min(width, Math.floor((column + 1) * cellWidth));
      const y1 = Math.min(height, Math.floor((row + 1) * cellHeight));

      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          sum += alpha[y * width + x];
          count++;
        }
      }
      signature[row * SIGNATURE_COLUMNS + column] = count
        ? Math.round(sum / count)
        : 0;
    }
  }
  return signature;
}

export function signatureDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Slab-backed mask store. Not thread-safe — it lives on the main thread and is
 * written from worker messages, one frame at a time.
 */
export class MaskStore {
  readonly plan: MaskStorePlan;

  private slab: Uint8Array;
  private occupied: Uint8Array;
  private metas: (MaskMeta | undefined)[];
  /**
   * One stable view per slot.
   *
   * `subarray` allocates a new object every call, which would defeat any
   * identity-based cache downstream (the compositor skips re-uploading a mask
   * that has not changed). Caching the view makes `frame.data` a stable
   * reference for a given slot.
   */
  private views: (Uint8Array | null)[];
  private storedCount = 0;
  private lastSignature: Uint8Array | null = null;
  private lastSignatureIndex = -1;

  constructor(plan: MaskStorePlan, slab?: Uint8Array) {
    this.plan = plan;
    const expected = plan.totalFrames * plan.bytesPerFrame;
    this.slab =
      slab && slab.byteLength === expected ? slab : new Uint8Array(expected);
    this.occupied = new Uint8Array(plan.totalFrames);
    this.metas = new Array<MaskMeta | undefined>(plan.totalFrames);
    this.views = new Array<Uint8Array | null>(plan.totalFrames).fill(null);
  }

  get bytesUsed(): number {
    return this.storedCount * this.plan.bytesPerFrame;
  }

  get framesStored(): number {
    return this.storedCount;
  }

  get isFull(): boolean {
    return this.storedCount >= this.plan.totalFrames;
  }

  /** True when at least one slot holds a measured matte, not a fallback. */
  get hasRealMasks(): boolean {
    return this.metas.some((meta) => meta !== undefined && !meta.synthetic);
  }

  /** Number of stored slots that carry a carried/placeholder matte. */
  get syntheticFrames(): number {
    return this.metas.reduce(
      (count, meta) => (meta?.synthetic ? count + 1 : count),
      0,
    );
  }

  /**
   * Serializable view of the store for IndexedDB.
   *
   * The slab buffer is shared, not copied — see `MaskStoreSnapshot`.
   */
  snapshot(): MaskStoreSnapshot {
    const slab =
      this.slab.byteOffset === 0 &&
      this.slab.byteLength === this.slab.buffer.byteLength
        ? (this.slab.buffer as ArrayBuffer)
        : this.slab.slice().buffer;
    return {
      plan: { ...this.plan },
      slab,
      occupied: this.occupied.slice(),
      metas: this.metas.map((meta) => meta ?? null),
      storedCount: this.storedCount,
    };
  }

  /**
   * Rebuild a store from `snapshot()` without reallocating the slab.
   *
   * Returns null for a snapshot whose plan, slab length, bitmap, or metadata
   * shape does not agree, so a corrupt cache entry can never be composited.
   */
  static fromSnapshot(snapshot: MaskStoreSnapshot): MaskStore | null {
    const plan = snapshot?.plan;
    if (
      !plan ||
      plan.totalFrames <= 0 ||
      plan.bytesPerFrame <= 0 ||
      plan.width <= 0 ||
      plan.height <= 0 ||
      plan.sampleFps <= 0
    ) {
      return null;
    }

    const expected = plan.totalFrames * plan.bytesPerFrame;
    if (!(snapshot.slab instanceof ArrayBuffer)) return null;
    if (snapshot.slab.byteLength !== expected) return null;
    if (!(snapshot.occupied instanceof Uint8Array)) return null;
    if (snapshot.occupied.length !== plan.totalFrames) return null;
    if (!Array.isArray(snapshot.metas)) return null;
    if (snapshot.metas.length !== plan.totalFrames) return null;

    const store = new MaskStore(plan, new Uint8Array(snapshot.slab));
    let storedCount = 0;
    for (let index = 0; index < plan.totalFrames; index++) {
      if (snapshot.occupied[index]) {
        if (!snapshot.metas[index]) return null;
        store.occupied[index] = 1;
        storedCount += 1;
      }
    }
    store.metas = snapshot.metas.map((meta) => meta ?? undefined);
    store.storedCount = storedCount;
    return store;
  }

  /** Copy `alpha` into slot `index`. Silently ignores out-of-range indices. */
  put(
    index: number,
    alpha: Uint8Array,
    meta: Omit<MaskMeta, "linkable">,
  ): void {
    if (index < 0 || index >= this.plan.totalFrames) return;
    if (alpha.length !== this.plan.bytesPerFrame) return;

    const offset = index * this.plan.bytesPerFrame;
    this.slab.set(alpha, offset);

    // Linkability compares against the previous *stored* slot, so a gap caused
    // by a failed frame does not accidentally link across the hole.
    let linkable = false;
    if (this.lastSignature && index === this.lastSignatureIndex + 1) {
      const signature = computeMaskSignature(
        alpha,
        this.plan.width,
        this.plan.height,
      );
      linkable =
        signatureDistance(signature, this.lastSignature) <= LINKABLE_DISTANCE;
      this.lastSignature = signature;
    } else {
      this.lastSignature = computeMaskSignature(
        alpha,
        this.plan.width,
        this.plan.height,
      );
    }
    // A carried/placeholder matte is not a measurement of this frame, so it
    // must never be a cross-fade target.
    if (meta.synthetic) linkable = false;
    this.lastSignatureIndex = index;

    if (!this.occupied[index]) this.storedCount++;
    this.occupied[index] = 1;
    this.metas[index] = { ...meta, linkable };
  }

  /** Nearest stored frame at or before `index`, or null. */
  get(index: number): MaskFrame | null {
    if (this.plan.totalFrames === 0) return null;
    let cursor = Math.max(0, Math.min(index, this.plan.totalFrames - 1));
    while (cursor >= 0 && !this.occupied[cursor]) cursor--;
    if (cursor < 0) return null;

    const offset = cursor * this.plan.bytesPerFrame;
    const meta = this.metas[cursor];
    if (!meta) return null;

    let view = this.views[cursor];
    if (!view) {
      view = this.slab.subarray(offset, offset + this.plan.bytesPerFrame);
      this.views[cursor] = view;
    }

    return {
      data: view,
      width: this.plan.width,
      height: this.plan.height,
      index: cursor,
      time: cursor / this.plan.sampleFps,
      meta,
    };
  }

  /** Nearest stored frame for `time` (seconds), or null. */
  getAt(time: number): MaskFrame | null {
    if (this.plan.totalFrames === 0 || this.plan.sampleFps <= 0) return null;
    return this.get(Math.round(time * this.plan.sampleFps));
  }

  has(index: number): boolean {
    return (
      index >= 0 && index < this.plan.totalFrames && this.occupied[index] === 1
    );
  }

  /**
   * Resolve the pair of frames to blend for `time`.
   *
   * Returns a single frame when the next sample is missing, not linkable, or
   * the playhead is close enough that blending would do nothing.
   */
  getNeighbours(time: number): {
    a: MaskFrame;
    b: MaskFrame | null;
    k: number;
  } | null {
    if (this.plan.totalFrames === 0 || this.plan.sampleFps <= 0) return null;
    const exact = time * this.plan.sampleFps;
    const index = Math.floor(exact);
    const k = exact - index;

    const a = this.get(index);
    if (!a) return null;
    // A carried/placeholder matte is not a measurement of this frame; blending
    // from it would smear the previous silhouette across motion.
    if (a.meta.synthetic) return { a, b: null, k: 0 };
    if (k < 0.02) return { a, b: null, k: 0 };

    const nextIndex = index + 1;
    if (!this.has(nextIndex)) return { a, b: null, k: 0 };
    const b = this.get(nextIndex);
    if (!b || !b.meta.linkable) return { a, b: null, k: 0 };

    return { a, b, k };
  }

  clear(): void {
    this.occupied.fill(0);
    this.metas = new Array<MaskMeta | undefined>(this.plan.totalFrames);
    this.views = new Array<Uint8Array | null>(this.plan.totalFrames).fill(null);
    this.storedCount = 0;
    this.lastSignature = null;
    this.lastSignatureIndex = -1;
  }

  /** Drop the backing slab so the browser can reclaim it immediately. */
  release(): void {
    this.clear();
    this.slab = new Uint8Array(0);
  }
}
