/**
 * Alpha-matte post-processing for background removal.
 *
 * Every function here is pure: typed arrays in, typed arrays out, no DOM, no
 * canvas, no worker globals. That is deliberate — this is the only part of the
 * mask pipeline that can be unit-tested without a browser, and it is where the
 * visible artifacts are actually fixed.
 *
 * ## Conventions
 *
 * - Alpha buffers are `Uint8Array`, one byte per pixel, **0 = fully background,
 *   255 = fully foreground**, row-major.
 * - Thresholds describing an alpha level are in 0–255 units.
 * - Fractions of the frame (coverage, centroid) are 0–1.
 *
 * ## Why this exists
 *
 * Segmentation networks emit a wide uncertainty band around every edge and
 * across ambiguous regions. Using that output directly as the composite alpha
 * makes the background bleed through as a coloured veil ("floating noise") and
 * leaves isolated false-positive specks at full opacity. The previous pipeline
 * had no threshold, no morphology and no temporal smoothing at all.
 *
 * ## Ordering
 *
 * Thresholding must happen **before** morphology. Running open/close on a
 * continuous alpha is a rank filter, not a morphological operator: it blurs
 * edges and removes nothing. Morphology operates on the binary support map.
 *
 * ## Buffer aliasing
 *
 * Every in-place-capable function documents which arguments must be distinct.
 * The separable filters write an intermediate pass, so `source`, `scratch` and
 * `out` are always three separate buffers.
 */

// ---------------------------------------------------------------------------
// Statistics and guards
// ---------------------------------------------------------------------------

export interface AlphaStats {
  /** Mean alpha, 0–255. */
  mean: number;
  /** 1st percentile, 0–255. */
  p1: number;
  /** 99th percentile, 0–255. */
  p99: number;
  /** Fraction of pixels at or above the midpoint, 0–1. */
  coverage: number;
  /** Alpha-weighted centroid, 0–1. */
  centroidX: number;
  centroidY: number;
  /** Topmost and bottommost row containing foreground, 0–1. */
  topY: number;
  bottomY: number;
  /** Estimated chin line for the "text behind person" effect, 0–1. */
  chinY: number | null;
}

const HISTOGRAM_BINS = 256;

/**
 * Single pass over the matte producing every statistic downstream steps need.
 *
 * The chin line is derived here rather than in a separate full-frame scan,
 * because the previous implementation re-scanned every pixel on every rendered
 * frame (~13.8M comparisons/s at 60fps) just to place a text baseline.
 */
export function computeAlphaStats(
  alpha: Uint8Array,
  width: number,
  height: number,
): AlphaStats {
  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const total = width * height;

  let sum = 0;
  let weightedX = 0;
  let weightedY = 0;
  let foregroundPixels = 0;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const value = alpha[rowOffset + x];
      histogram[value]++;
      sum += value;
      if (value >= 128) {
        foregroundPixels++;
        weightedX += x;
        weightedY += y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const coverage = total > 0 ? foregroundPixels / total : 0;
  const hasForeground = foregroundPixels > 0 && maxY >= 0;

  return {
    mean: total > 0 ? sum / total : 0,
    p1: percentileFromHistogram(histogram, total, 0.01),
    p99: percentileFromHistogram(histogram, total, 0.99),
    coverage,
    centroidX: hasForeground ? weightedX / foregroundPixels / width : 0.5,
    centroidY: hasForeground ? weightedY / foregroundPixels / height : 0.5,
    topY: hasForeground ? minY / height : 0,
    bottomY: hasForeground ? maxY / height : 0,
    // The head occupies roughly the top 30% of a standing person's silhouette.
    chinY: hasForeground ? (minY + (maxY - minY) * 0.3) / height : null,
  };
}

function percentileFromHistogram(
  histogram: Uint32Array,
  total: number,
  fraction: number,
): number {
  if (total === 0) return 0;
  const target = total * fraction;
  let cumulative = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    cumulative += histogram[bin];
    if (cumulative >= target) return bin;
  }
  return HISTOGRAM_BINS - 1;
}

/**
 * Minimum spread between p1 and p99 for auto-levelling to be meaningful.
 *
 * Below this the matte is essentially flat, and stretching it would divide by
 * near-zero — turning uniform noise into a hard-edged binary blob. That failure
 * mode looks exactly like "the model found nothing", which is the artifact this
 * module exists to remove.
 */
export const MIN_LEVEL_SPREAD = 5;

/** True when the matte has no usable dynamic range and must not be stretched. */
export function isFlatMask(stats: AlphaStats): boolean {
  return stats.p99 - stats.p1 < MIN_LEVEL_SPREAD;
}

/**
 * Coverage bounds outside which the matte is almost certainly not a subject.
 *
 * A legitimate close-up routinely exceeds 98% coverage, so these are wide and
 * are a "this frame is unusable" signal for the UI and for carry-forward — not
 * a per-frame gate on compositing.
 */
export const MIN_PLAUSIBLE_COVERAGE = 0.004;
export const MAX_PLAUSIBLE_COVERAGE = 0.995;

export function isImplausibleMask(stats: AlphaStats): boolean {
  return (
    stats.coverage < MIN_PLAUSIBLE_COVERAGE ||
    stats.coverage > MAX_PLAUSIBLE_COVERAGE
  );
}

// ---------------------------------------------------------------------------
// Level and threshold
// ---------------------------------------------------------------------------

/**
 * Stretch `alpha` so `[lo, hi]` maps to `[0, 255]`, in place.
 * A no-op when the range is degenerate — see `MIN_LEVEL_SPREAD`.
 */
export function autoLevel(alpha: Uint8Array, lo: number, hi: number): void {
  const span = hi - lo;
  if (span < MIN_LEVEL_SPREAD) return;
  for (let i = 0; i < alpha.length; i++) {
    const offset = alpha[i] - lo;
    // Multiply before dividing: `offset * (255 / span)` introduces a rounding
    // error that shifts exact .5 midpoints down by one level.
    alpha[i] =
      offset <= 0
        ? 0
        : offset >= span
          ? 255
          : Math.round((offset * 255) / span);
  }
}

/**
 * Apply a smoothstep between `lo` and `hi`, in place.
 *
 * Replaces a hard threshold: values below `lo` collapse to 0, above `hi` to 255,
 * and the band between follows an S-curve. The result is a crisp matte with a
 * short, controlled transition instead of a wide uncertainty plateau.
 */
export function smoothstepRamp(
  alpha: Uint8Array,
  lo: number,
  hi: number,
): void {
  if (hi <= lo) return;
  const span = hi - lo;
  for (let i = 0; i < alpha.length; i++) {
    const value = alpha[i];
    if (value <= lo) {
      alpha[i] = 0;
    } else if (value >= hi) {
      alpha[i] = 255;
    } else {
      const t = (value - lo) / span;
      alpha[i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
}

/** Write a 0/1 support map from `alpha`. `out` must differ from `alpha`. */
export function binarize(
  alpha: Uint8Array,
  threshold: number,
  out: Uint8Array,
): void {
  for (let i = 0; i < alpha.length; i++) {
    out[i] = alpha[i] >= threshold ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------
// Morphology (binary only)
// ---------------------------------------------------------------------------

/**
 * Separable min/max over a 0/1 map with a square window.
 *
 * `source`, `scratch` and `out` must all be distinct buffers: the horizontal
 * pass fills `scratch`, the vertical pass reads it while writing `out`.
 */
function minMaxPass(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  scratch: Uint8Array,
  out: Uint8Array,
  wantMin: boolean,
): void {
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const from = x - radius < 0 ? 0 : x - radius;
      const to = x + radius > width - 1 ? width - 1 : x + radius;
      let best = source[rowOffset + from];
      for (let k = from + 1; k <= to; k++) {
        const value = source[rowOffset + k];
        if (wantMin ? value < best : value > best) best = value;
      }
      scratch[rowOffset + x] = best;
    }
  }

  for (let y = 0; y < height; y++) {
    const from = y - radius < 0 ? 0 : y - radius;
    const to = y + radius > height - 1 ? height - 1 : y + radius;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let best = scratch[from * width + x];
      for (let k = from + 1; k <= to; k++) {
        const value = scratch[k * width + x];
        if (wantMin ? value < best : value > best) best = value;
      }
      out[rowOffset + x] = best;
    }
  }
}

/** Erosion. `source`, `scratch`, `out` must be distinct. */
export function erode(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  out: Uint8Array,
  scratch: Uint8Array,
): void {
  minMaxPass(source, width, height, radius, scratch, out, true);
}

/** Dilation. `source`, `scratch`, `out` must be distinct. */
export function dilate(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  out: Uint8Array,
  scratch: Uint8Array,
): void {
  minMaxPass(source, width, height, radius, scratch, out, false);
}

/**
 * Opening then closing, in place on `binary`.
 *
 * Opening removes specks smaller than the window; closing fills pinholes of the
 * same scale. `bufA`/`bufB`/`bufC` are caller-owned scratch of equal length.
 */
export function cleanBinary(
  binary: Uint8Array,
  width: number,
  height: number,
  openRadius: number,
  closeRadius: number,
  bufA: Uint8Array,
  bufB: Uint8Array,
  bufC: Uint8Array,
): void {
  if (openRadius > 0) {
    // Open = erode → dilate. Result lands in bufA.
    erode(binary, width, height, openRadius, bufB, bufA);
    dilate(bufB, width, height, openRadius, bufA, bufC);
    binary.set(bufA);
  }
  if (closeRadius > 0) {
    // Close = dilate → erode. Result lands in bufB.
    dilate(binary, width, height, closeRadius, bufA, bufC);
    erode(bufA, width, height, closeRadius, bufB, bufC);
    binary.set(bufB);
  }
}

// ---------------------------------------------------------------------------
// Connected components
// ---------------------------------------------------------------------------

export interface ComponentStats {
  count: number;
  largestArea: number;
  removedPixels: number;
}

/**
 * Keep the largest connected component and any component at least
 * `minAreaRatio` of the frame; zero the rest, in place.
 *
 * The largest component is always kept regardless of area, so a legitimately
 * small subject is never erased. Network specks are typically tens of pixels,
 * well under the default ratio — a detached hand entering frame is not.
 *
 * `labels` (Int32Array), `visited` (Uint8Array) and `stack` (Int32Array) are
 * caller-owned scratch of `width * height` entries each.
 */
export function keepComponents(
  binary: Uint8Array,
  width: number,
  height: number,
  minAreaRatio: number,
  labels: Int32Array,
  visited: Uint8Array,
  stack: Int32Array,
): ComponentStats {
  const total = width * height;
  const minArea = Math.max(64, Math.floor(total * minAreaRatio));

  labels.fill(0);
  visited.fill(0);

  let label = 0;
  let largestLabel = 0;
  let largestArea = 0;

  // Component areas, indexed by label. Capped at the worst case (checkerboard).
  const areas = new Uint32Array(Math.max(1, Math.ceil(total / 2) + 1));

  for (let start = 0; start < total; start++) {
    if (binary[start] === 0 || visited[start]) continue;

    label++;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    let area = 0;

    while (top > 0) {
      const index = stack[--top];
      labels[index] = label;
      area++;

      const x = index % width;
      const y = (index - x) / width;

      if (x > 0) {
        const next = index - 1;
        if (binary[next] === 1 && !visited[next]) {
          visited[next] = 1;
          stack[top++] = next;
        }
      }
      if (x < width - 1) {
        const next = index + 1;
        if (binary[next] === 1 && !visited[next]) {
          visited[next] = 1;
          stack[top++] = next;
        }
      }
      if (y > 0) {
        const next = index - width;
        if (binary[next] === 1 && !visited[next]) {
          visited[next] = 1;
          stack[top++] = next;
        }
      }
      if (y < height - 1) {
        const next = index + width;
        if (binary[next] === 1 && !visited[next]) {
          visited[next] = 1;
          stack[top++] = next;
        }
      }
    }

    areas[label] = area;
    if (area > largestArea) {
      largestArea = area;
      largestLabel = label;
    }
  }

  if (label === 0) {
    return { count: 0, largestArea: 0, removedPixels: 0 };
  }

  // Anything below the absolute floor is a speck. The largest component is
  // exempt so a genuinely small subject still survives.
  const keep = new Uint8Array(label + 1);
  keep[largestLabel] = 1;
  let removedPixels = 0;
  for (let l = 1; l <= label; l++) {
    if (l === largestLabel) continue;
    if (areas[l] >= minArea) keep[l] = 1;
    else removedPixels += areas[l];
  }

  for (let i = 0; i < total; i++) {
    const value = labels[i];
    binary[i] = value !== 0 && keep[value] ? 1 : 0;
  }

  return { count: label, largestArea, removedPixels };
}

// ---------------------------------------------------------------------------
// Feathering
// ---------------------------------------------------------------------------

/**
 * Box-blur a 0/1 map into a soft 0–255 edge.
 *
 * Applied to the cleaned support map, this is what produces the final soft
 * silhouette. A separable box of radius `radius` gives a transition roughly
 * `2 * radius + 1` pixels wide, which upscales to a natural edge at display
 * resolution without the wide haze of a raw network output.
 *
 * `hsum` is caller-owned scratch of `width * height` entries; `out` must differ
 * from `binary`.
 */
export function feather(
  binary: Uint8Array,
  width: number,
  height: number,
  radius: number,
  out: Uint8Array,
  hsum: Uint16Array,
): void {
  if (radius <= 0) {
    for (let i = 0; i < binary.length; i++) out[i] = binary[i] * 255;
    return;
  }

  const window = 2 * radius + 1;
  const divisor = window * window;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const clamped = k < 0 ? 0 : k > width - 1 ? width - 1 : k;
      sum += binary[rowOffset + clamped];
    }
    for (let x = 0; x < width; x++) {
      hsum[rowOffset + x] = sum;
      const dropX = x - radius < 0 ? 0 : x - radius;
      const addX =
        x + radius + 1 > width - 1 ? width - 1 : x + radius + 1;
      sum += binary[rowOffset + addX] - binary[rowOffset + dropX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const clamped = k < 0 ? 0 : k > height - 1 ? height - 1 : k;
      sum += hsum[clamped * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round((sum / divisor) * 255);
      const dropY = y - radius < 0 ? 0 : y - radius;
      const addY =
        y + radius + 1 > height - 1 ? height - 1 : y + radius + 1;
      sum += hsum[addY * width + x] - hsum[dropY * width + x];
    }
  }
}

// ---------------------------------------------------------------------------
// Combination and temporal smoothing
// ---------------------------------------------------------------------------

/**
 * `ramped = ramped * feathered / 255`, in place.
 *
 * The geometric edge from `feathered` bounds the silhouette; the network's own
 * gradient inside that band (`ramped`) restores edge character the box blur
 * would otherwise flatten. Outside the band `ramped` is already 0, so haze and
 * specks cannot survive.
 */
export function combineSupport(
  ramped: Uint8Array,
  feathered: Uint8Array,
): void {
  for (let i = 0; i < ramped.length; i++) {
    ramped[i] = (ramped[i] * feathered[i] + 127) / 255;
  }
}

export interface TemporalBlendOptions {
  /** Weight of the previous frame, 0–1. */
  weight: number;
  /** Mean absolute difference (0–255) above which blending is skipped. */
  maxDelta: number;
}

export interface TemporalBlendResult {
  blended: boolean;
  /** Mean absolute difference between the two mattes, 0–255. */
  delta: number;
}

/**
 * Blend `current` toward `previous`, in place on `current`.
 *
 * Gated on the measured difference between the mattes: an ungated EMA smears a
 * halo onto the previous silhouette during motion, which reads as ghosting.
 * Blending only helps when consecutive mattes agree.
 */
export function temporalBlend(
  current: Uint8Array,
  previous: Uint8Array | null,
  options: TemporalBlendOptions,
): TemporalBlendResult {
  if (!previous || previous.length !== current.length) {
    return { blended: false, delta: 0 };
  }

  let sum = 0;
  for (let i = 0; i < current.length; i++) {
    sum += Math.abs(current[i] - previous[i]);
  }
  const delta = sum / current.length;

  if (delta > options.maxDelta) return { blended: false, delta };

  const keep = options.weight;
  const take = 1 - keep;
  for (let i = 0; i < current.length; i++) {
    current[i] = Math.round(current[i] * take + previous[i] * keep);
  }
  return { blended: true, delta };
}

/**
 * Box-downsample `source` into `out`.
 *
 * The model emits a matte at its own working resolution, which can be larger
 * than what the mask store can afford for a long clip. Downsampling here (after
 * refinement) keeps the refinement working on the full-detail matte while the
 * stored mask fits the budget.
 */
export function downsampleAlpha(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  out: Uint8Array,
): void {
  if (targetWidth === sourceWidth && targetHeight === sourceHeight) {
    out.set(source.subarray(0, targetWidth * targetHeight));
    return;
  }

  for (let ty = 0; ty < targetHeight; ty++) {
    const sy0 = Math.floor((ty * sourceHeight) / targetHeight);
    const sy1 = Math.max(
      sy0 + 1,
      Math.floor(((ty + 1) * sourceHeight) / targetHeight),
    );
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx0 = Math.floor((tx * sourceWidth) / targetWidth);
      const sx1 = Math.max(
        sx0 + 1,
        Math.floor(((tx + 1) * sourceWidth) / targetWidth),
      );
      let sum = 0;
      let count = 0;
      for (let y = sy0; y < sy1; y++) {
        const rowOffset = y * sourceWidth;
        for (let x = sx0; x < sx1; x++) {
          sum += source[rowOffset + x];
          count++;
        }
      }
      out[ty * targetWidth + tx] = count ? Math.round(sum / count) : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene-cut detection
// ---------------------------------------------------------------------------

const CUT_HISTOGRAM_BINS = 16;

/** Coarse luma histogram (16 bins) of an RGBA frame. */
export function computeLumaHistogram(
  rgba: Uint8ClampedArray | Uint8Array,
): Float32Array {
  const histogram = new Float32Array(CUT_HISTOGRAM_BINS);
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return histogram;

  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    // Integer luma approximation — precision is irrelevant for a 16-bin cut
    // detector and this avoids a float multiply per channel.
    const luma =
      (rgba[offset] * 77 + rgba[offset + 1] * 150 + rgba[offset + 2] * 29) >>
      8;
    histogram[Math.min(CUT_HISTOGRAM_BINS - 1, luma >> 4)] += 1;
  }
  for (let bin = 0; bin < CUT_HISTOGRAM_BINS; bin++) {
    histogram[bin] /= pixels;
  }
  return histogram;
}

/** Histogram intersection distance in 0–1; 0 = identical, 1 = disjoint. */
export function histogramDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 1;
  let intersection = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += Math.min(a[i], b[i]);
  }
  return 1 - intersection;
}

/**
 * Distance above which consecutive samples are treated as a hard cut.
 *
 * A cut resets the temporal blend and the per-shot level reference; without it
 * the matte morphs between two unrelated silhouettes for one sample.
 */
export const SCENE_CUT_DISTANCE = 0.45;

export function detectSceneCut(
  histogram: Float32Array,
  previous: Float32Array | null,
): boolean {
  if (!previous) return false;
  return histogramDistance(histogram, previous) > SCENE_CUT_DISTANCE;
}

// ---------------------------------------------------------------------------
// Guided filter (optional, default off)
// ---------------------------------------------------------------------------

/**
 * Preallocated integral images for `guidedFilter`.
 *
 * A naive box filter at radius 8 costs roughly 300M operations per frame at
 * 640x360 and is not viable. Integral images make each box query O(1)
 * regardless of radius, bringing the whole filter to ~10-15ms.
 */
export interface GuidedFilterScratch {
  width: number;
  height: number;
  meanI: Float64Array;
  meanP: Float64Array;
  corrI: Float64Array;
  corrIP: Float64Array;
  a: Float32Array;
  b: Float32Array;
  integral: Float64Array;
}

export function createGuidedFilterScratch(
  width: number,
  height: number,
): GuidedFilterScratch {
  const integralLength = (width + 1) * (height + 1);
  return {
    width,
    height,
    meanI: new Float64Array(integralLength),
    meanP: new Float64Array(integralLength),
    corrI: new Float64Array(integralLength),
    corrIP: new Float64Array(integralLength),
    a: new Float32Array(width * height),
    b: new Float32Array(width * height),
    integral: new Float64Array(integralLength),
  };
}

/**
 * Edge-aware refinement: snap the matte onto edges present in `luma`.
 *
 * `luma` is 0–255, one value per pixel. `eps` is in normalized units (0–1);
 * 2e-3 is a reasonable starting point for an 8-bit matte.
 *
 * Caveat worth stating plainly: this is an edge-*snapping* filter, not a
 * matting solver. It cannot recover hair, and on a high-contrast background
 * edge it will drag the matte outward. It is off by default for that reason.
 */
export function guidedFilter(
  alpha: Uint8Array,
  luma: Uint8Array,
  width: number,
  height: number,
  radius: number,
  eps: number,
  scratch: GuidedFilterScratch,
): void {
  if (scratch.width !== width || scratch.height !== height) {
    throw new Error("GuidedFilterScratch dimensions do not match the image.");
  }
  const { meanI, meanP, corrI, corrIP, a, b, integral } = scratch;
  const pixelCount = width * height;

  buildIntegralOf(width, height, integral, (i) => luma[i] / 255);
  boxFromIntegral(integral, width, height, radius, meanI);

  buildIntegralOf(width, height, integral, (i) => alpha[i] / 255);
  boxFromIntegral(integral, width, height, radius, meanP);

  buildIntegralOf(width, height, integral, (i) => {
    const value = luma[i] / 255;
    return value * value;
  });
  boxFromIntegral(integral, width, height, radius, corrI);

  buildIntegralOf(
    width,
    height,
    integral,
    (i) => (luma[i] / 255) * (alpha[i] / 255),
  );
  boxFromIntegral(integral, width, height, radius, corrIP);

  for (let i = 0; i < pixelCount; i++) {
    const mi = meanI[i];
    const mp = meanP[i];
    const varI = corrI[i] - mi * mi;
    const covIP = corrIP[i] - mi * mp;
    const ai = covIP / (varI + eps);
    a[i] = ai;
    b[i] = mp - ai * mi;
  }

  buildIntegralOf(width, height, integral, (i) => a[i]);
  boxFromIntegral(integral, width, height, radius, meanI);

  buildIntegralOf(width, height, integral, (i) => b[i]);
  boxFromIntegral(integral, width, height, radius, meanP);

  for (let i = 0; i < pixelCount; i++) {
    const q = meanI[i] * (luma[i] / 255) + meanP[i];
    alpha[i] = q <= 0 ? 0 : q >= 1 ? 255 : Math.round(q * 255);
  }
}

/** Summed-area table of `valueAt`, written into `integral` ((w+1)·(h+1)). */
function buildIntegralOf(
  width: number,
  height: number,
  integral: Float64Array,
  valueAt: (index: number) => number,
): void {
  const stride = width + 1;
  integral.fill(0);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += valueAt(y * width + x);
      integral[(y + 1) * stride + (x + 1)] =
        integral[y * stride + (x + 1)] + rowSum;
    }
  }
}

/** Mean over a (2r+1)² window, read from a summed-area table. */
function boxFromIntegral(
  integral: Float64Array,
  width: number,
  height: number,
  radius: number,
  out: Float64Array,
): void {
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    const y0 = y - radius < 0 ? 0 : y - radius;
    const y1 = y + radius > height - 1 ? height - 1 : y + radius;
    for (let x = 0; x < width; x++) {
      const x0 = x - radius < 0 ? 0 : x - radius;
      const x1 = x + radius > width - 1 ? width - 1 : x + radius;
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      out[y * width + x] = sum / area;
    }
  }
}

// ---------------------------------------------------------------------------
// Full chain
// ---------------------------------------------------------------------------

export interface AlphaChainConfig {
  /** Skip the percentile stretch. */
  level: boolean;
  /** Smoothstep ramp bounds, 0–255. */
  rampLo: number;
  rampHi: number;
  /** Binarisation threshold for the support map, 0–255. */
  binaryThreshold: number;
  /** Morphological opening radius in pixels (0 disables). */
  openRadius: number;
  /** Morphological closing radius in pixels (0 disables). */
  closeRadius: number;
  /** Minimum component area as a fraction of the frame. */
  minComponentRatio: number;
  /** Feather radius in pixels for the final edge (0 = hard edge). */
  featherRadius: number;
  /** Temporal blend weight, 0 disables. */
  temporalWeight: number;
  /** Motion gate for the temporal blend, 0–255 mean absolute difference. */
  temporalMaxDelta: number;
  /** Edge-snapping pass. Off by default — see `guidedFilter`. */
  guidedFilter: boolean;
  guidedRadius: number;
  guidedEps: number;
}

export const DEFAULT_ALPHA_CONFIG: AlphaChainConfig = {
  level: true,
  rampLo: 89,
  rampHi: 166,
  binaryThreshold: 128,
  openRadius: 1,
  closeRadius: 2,
  minComponentRatio: 0.0005,
  featherRadius: 1,
  temporalWeight: 0.25,
  temporalMaxDelta: 24,
  guidedFilter: false,
  guidedRadius: 8,
  guidedEps: 2e-3,
};

/** All buffers the chain needs, sized to one mask resolution. */
export interface AlphaChainState {
  width: number;
  height: number;
  /** EMA of the per-shot percentile floor/ceiling, 0–255. */
  levelLo: number | null;
  levelHi: number | null;
  previous: Uint8Array | null;
  previousHistogram: Float32Array | null;
  binary: Uint8Array;
  feathered: Uint8Array;
  featherSum: Uint16Array;
  morphA: Uint8Array;
  morphB: Uint8Array;
  morphC: Uint8Array;
  labels: Int32Array;
  visited: Uint8Array;
  stack: Int32Array;
  luma: Uint8Array;
  guided: GuidedFilterScratch | null;
}

export function createAlphaChainState(
  width: number,
  height: number,
): AlphaChainState {
  const pixelCount = width * height;
  return {
    width,
    height,
    levelLo: null,
    levelHi: null,
    previous: null,
    previousHistogram: null,
    binary: new Uint8Array(pixelCount),
    feathered: new Uint8Array(pixelCount),
    featherSum: new Uint16Array(pixelCount),
    morphA: new Uint8Array(pixelCount),
    morphB: new Uint8Array(pixelCount),
    morphC: new Uint8Array(pixelCount),
    labels: new Int32Array(pixelCount),
    visited: new Uint8Array(pixelCount),
    stack: new Int32Array(pixelCount),
    luma: new Uint8Array(pixelCount),
    guided: null,
  };
}

export function resetAlphaChainState(state: AlphaChainState): void {
  state.levelLo = null;
  state.levelHi = null;
  state.previous = null;
  state.previousHistogram = null;
}

export interface AlphaChainResult {
  stats: AlphaStats;
  /** True when the matte was flat or implausible and was passed through. */
  lowConfidence: boolean;
  /** True when a hard cut was detected before this frame. */
  cut: boolean;
  /** True when the temporal blend was applied. */
  blended: boolean;
}

/**
 * Run the full refinement chain on `alpha`, in place.
 *
 * `rgba` is the frame the matte was produced from; it drives scene-cut
 * detection and, when enabled, the guided filter's edge guide. Pass `null` to
 * skip both.
 */
export function refineAlpha(
  alpha: Uint8Array,
  rgba: Uint8ClampedArray | Uint8Array | null,
  width: number,
  height: number,
  config: AlphaChainConfig,
  state: AlphaChainState,
): AlphaChainResult {
  if (state.width !== width || state.height !== height) {
    throw new Error("AlphaChainState dimensions do not match the matte.");
  }
  const pixelCount = width * height;
  const stats = computeAlphaStats(alpha, width, height);

  const histogram = rgba ? computeLumaHistogram(rgba) : null;
  const cut = histogram ? detectSceneCut(histogram, state.previousHistogram) : false;
  if (cut) {
    // A new shot invalidates both the temporal reference and the level EMA.
    state.previous = null;
    state.levelLo = null;
    state.levelHi = null;
  }
  if (histogram) state.previousHistogram = histogram;

  if (isFlatMask(stats) || isImplausibleMask(stats)) {
    // Pass the model's output through untouched. Stretching a flat matte would
    // amplify noise into a hard blob, which is worse than leaving it alone.
    state.previous = null;
    return { stats, lowConfidence: true, cut, blended: false };
  }

  // Per-shot level reference, EMA'd so one odd frame cannot retune it.
  if (state.levelLo === null || state.levelHi === null) {
    state.levelLo = stats.p1;
    state.levelHi = stats.p99;
  } else {
    state.levelLo = state.levelLo * 0.9 + stats.p1 * 0.1;
    state.levelHi = state.levelHi * 0.9 + stats.p99 * 0.1;
  }

  if (config.level) {
    autoLevel(alpha, state.levelLo, state.levelHi);
  }
  smoothstepRamp(alpha, config.rampLo, config.rampHi);

  const { binary, feathered, featherSum } = state;

  binarize(alpha, config.binaryThreshold, binary);
  if (config.openRadius > 0 || config.closeRadius > 0) {
    cleanBinary(
      binary,
      width,
      height,
      config.openRadius,
      config.closeRadius,
      state.morphA,
      state.morphB,
      state.morphC,
    );
  }
  keepComponents(
    binary,
    width,
    height,
    config.minComponentRatio,
    state.labels,
    state.visited,
    state.stack,
  );

  feather(binary, width, height, config.featherRadius, feathered, featherSum);
  combineSupport(alpha, feathered);

  if (config.guidedFilter && rgba && rgba.length === pixelCount * 4) {
    if (!state.guided) {
      state.guided = createGuidedFilterScratch(width, height);
    }
    const luma = state.luma;
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      luma[i] =
        (rgba[offset] * 77 + rgba[offset + 1] * 150 + rgba[offset + 2] * 29) >>
        8;
    }
    guidedFilter(
      alpha,
      luma,
      width,
      height,
      config.guidedRadius,
      config.guidedEps,
      state.guided,
    );
  }

  const { blended } = temporalBlend(alpha, state.previous, {
    weight: config.temporalWeight,
    maxDelta: config.temporalMaxDelta,
  });

  if (!state.previous) {
    state.previous = new Uint8Array(pixelCount);
  }
  state.previous.set(alpha);

  return { stats, lowConfidence: false, cut, blended };
}
