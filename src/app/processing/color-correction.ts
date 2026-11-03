/**
 * Underwater color correction.
 *
 * The algorithm estimates how much red light the water absorbed, hue-shifts
 * the red channel back in, then stretches each channel's histogram so the
 * darkest/brightest meaningful values map to black/white.
 *
 * Everything here is pure and DOM-free so it can run on the main thread, in a
 * web worker, or in a unit test.
 */

/**
 * A 4x5 color matrix in the same row-major layout as SVG `feColorMatrix`:
 *
 *   R' = m[0]*R  + m[1]*G  + m[2]*B  + m[3]*A  + m[4]*255
 *   G' = m[5]*R  + m[6]*G  + m[7]*B  + m[8]*A  + m[9]*255
 *   B' = m[10]*R + m[11]*G + m[12]*B + m[13]*A + m[14]*255
 *   A' = m[15]*R + m[16]*G + m[17]*B + m[18]*A + m[19]*255
 */
export type ColorMatrix = readonly number[];

export const IDENTITY_MATRIX: ColorMatrix = Object.freeze([
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
]);

// Tuning constants.
/** A histogram bucket counts as "empty" when it holds fewer than 1/RATIO of all pixels. */
const THRESHOLD_RATIO = 2000;
/** Keep hue-shifting until the shifted average red reaches this level. */
const MIN_AVG_RED = 60;
/** Never hue-shift more than this many degrees. */
const MAX_HUE_SHIFT = 120;
/** Extra blue folded into the red channel; empirically looks better. */
const BLUE_MAGIC_VALUE = 1.2;

interface Rgb { r: number; g: number; b: number; }

/** Computes the correction matrix for an RGBA pixel buffer. */
export function computeColorMatrix(pixels: Uint8ClampedArray, width: number, height: number): ColorMatrix {
  const pixelCount = width * height;
  if (pixelCount === 0) return IDENTITY_MATRIX;

  const thresholdLevel = pixelCount / THRESHOLD_RATIO;
  const avg = averageColor(pixels, pixelCount);
  const hueShift = findHueShift(avg);

  // Histograms, with red replaced by the hue-shifted red.
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  const k = hueShiftCoefficients(hueShift);
  for (let i = 0; i < pixelCount * 4; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const red = clampByte(Math.round(k.r * r + k.g * g + k.b * b));
    histR[red]++;
    histG[g]++;
    histB[b]++;
  }

  const adjR = normalizingInterval(histR, thresholdLevel);
  const adjG = normalizingInterval(histG, thresholdLevel);
  const adjB = normalizingInterval(histB, thresholdLevel);

  const redGain = 256 / (adjR.high - adjR.low);
  const greenGain = 256 / (adjG.high - adjG.low);
  const blueGain = 256 / (adjB.high - adjB.low);

  const redOffset = (-adjR.low / 256) * redGain;
  const greenOffset = (-adjG.low / 256) * greenGain;
  const blueOffset = (-adjB.low / 256) * blueGain;

  return [
    k.r * redGain, k.g * redGain, k.b * redGain * BLUE_MAGIC_VALUE, 0, redOffset,
    0, greenGain, 0, 0, greenOffset,
    0, 0, blueGain, 0, blueOffset,
    0, 0, 0, 1, 0,
  ];
}

/**
 * Linearly blends between the identity matrix (strength 0) and `matrix`
 * (strength 1). Because the matrix is linear, this is equivalent to blending
 * the original and fully-corrected images (before clamping).
 */
export function scaleMatrix(matrix: ColorMatrix, strength: number): ColorMatrix {
  const s = Math.min(1, Math.max(0, strength));
  return matrix.map((v, i) => IDENTITY_MATRIX[i] + (v - IDENTITY_MATRIX[i]) * s);
}

/**
 * Applies `matrix` to the RGBA buffer `src`, writing into `dst` (which may be
 * `src` itself). Alpha is copied through untouched.
 */
export function applyColorMatrix(src: Uint8ClampedArray, dst: Uint8ClampedArray, matrix: ColorMatrix): void {
  const [rr, rg, rb, , ro, gr, gg, gb, , go, br, bg, bb, , bo] = matrix;
  const rOff = ro * 255, gOff = go * 255, bOff = bo * 255;
  // Uint8ClampedArray clamps and rounds on write, so no Math.min/max needed.
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    dst[i] = rr * r + rg * g + rb * b + rOff;
    dst[i + 1] = gr * r + gg * g + gb * b + gOff;
    dst[i + 2] = br * r + bg * g + bb * b + bOff;
    dst[i + 3] = src[i + 3];
  }
}

function averageColor(pixels: Uint8ClampedArray, pixelCount: number): Rgb {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < pixelCount * 4; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount };
}

/** Smallest hue shift (in degrees) that brings the average red up to MIN_AVG_RED. */
function findHueShift(avg: Rgb): number {
  let hueShift = 0;
  let newAvgRed = avg.r;
  while (newAvgRed < MIN_AVG_RED) {
    const k = hueShiftCoefficients(hueShift);
    newAvgRed = k.r * avg.r + k.g * avg.g + k.b * avg.b;
    hueShift++;
    if (hueShift > MAX_HUE_SHIFT) break;
  }
  return hueShift;
}

/** Per-channel weights that, summed, give the hue-shifted red value. */
export function hueShiftCoefficients(degrees: number): Rgb {
  const u = Math.cos(degrees * Math.PI / 180);
  const w = Math.sin(degrees * Math.PI / 180);
  return {
    r: 0.299 + 0.701 * u + 0.168 * w,
    g: 0.587 - 0.587 * u + 0.330 * w,
    b: 0.114 - 0.114 * u - 0.497 * w,
  };
}

/**
 * Finds the widest run between "near-empty" histogram buckets: that range is
 * where the image's real tonal content lives and gets stretched to 0..255.
 */
export function normalizingInterval(hist: ArrayLike<number>, thresholdLevel: number): { low: number; high: number } {
  const stops = [0];
  for (let i = 0; i < 256; i++) {
    if (hist[i] - thresholdLevel < 2) stops.push(i);
  }
  stops.push(255);

  let low = 0, high = 255, maxDist = 0;
  for (let i = 1; i < stops.length; i++) {
    const dist = stops[i] - stops[i - 1];
    if (dist > maxDist) {
      maxDist = dist;
      low = stops[i - 1];
      high = stops[i];
    }
  }
  return { low, high };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
