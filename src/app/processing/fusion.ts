import {
  clamp, collapsePyramid, gaussianBlur, gaussianPyramid, laplacianPyramid, Plane, plane, pyrDown, pyramidLevels, pyrUp,
} from './image-ops';

/*
 * "Color Balance and Fusion for Underwater Image Enhancement"
 * C. O. Ancuti, C. Ancuti, C. De Vleeschouwer, P. Bekaert. IEEE TIP 27(1), 2018.
 *
 *  1. White balance: compensate the red channel (and blue, in green water)
 *     using the better-preserved green channel, then apply Gray World.
 *  2. Derive two inputs from it: a gamma-corrected version (global contrast)
 *     and a sharpened version (edges/detail).
 *  3. Weight each input per pixel by Laplacian contrast, saliency and
 *     saturation, and blend them with a multi-scale (Laplacian pyramid) fusion
 *     so the weight maps don't introduce halos.
 *
 * Deviations from the paper, chosen after testing on real dive photos:
 *  - Partial Gray World (see GRAY_WORLD_POWER).
 *  - A light percentile stretch after Gray World; without it hazy shots stay
 *    flat and grey.
 *  - Input 2 uses a plain unsharp mask (I + (I - G*I)). The paper's
 *    "normalized" form, (I + N{I - G*I}) / 2, halves the contrast of that
 *    input and made results look washed out.
 */

/** Gamma applied to the white-balanced image for the "contrast" input. */
const GAMMA = 1.3;
/** Fraction of pixels clipped at each end by the post-white-balance stretch. */
const STRETCH_CLIP = 0.005;
/**
 * Partial Gray World: gains are raised to this power (1 = full Gray World).
 * Full Gray World turns bright open water pink when the subject is dark.
 */
const GRAY_WORLD_POWER = 0.75;
/** Regularizer added to each weight map before normalizing. */
const WEIGHT_DELTA = 0.1;

export function fuse(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(rgba.length);
  if (n === 0) return out;

  const wb = whiteBalance(rgba, width, height);

  // Input 1: gamma-corrected.
  const in1 = wb.map((p) => {
    const q = plane(width, height);
    for (let i = 0; i < n; i++) q.data[i] = lut(GAMMA_LUT, p.data[i]);
    return q;
  });
  // Input 2: sharpened.
  const in2 = sharpen(wb);

  // Weight of input 1; input 2 gets (1 - w1) since the weights are normalized.
  // Weights only feed a Gaussian pyramid, so computing them at half
  // resolution is visually identical and ~4x cheaper.
  const half1 = in1.map(pyrDown), half2 = in2.map(pyrDown);
  const { width: hw, height: hh } = half1[0];
  const w1raw = weightMap(half1, hw, hh);
  const w2raw = weightMap(half2, hw, hh);
  const w1half = plane(hw, hh);
  for (let i = 0; i < w1half.data.length; i++) {
    w1half.data[i] = (w1raw[i] + WEIGHT_DELTA) / (w1raw[i] + w2raw[i] + 2 * WEIGHT_DELTA);
  }

  const levels = pyramidLevels(width, height);
  const weightPyr = [pyrUp(w1half, width, height), ...gaussianPyramid(w1half, levels - 1)];
  for (let c = 0; c < 3; c++) {
    const l1 = laplacianPyramid(in1[c], levels);
    const l2 = laplacianPyramid(in2[c], levels);
    for (let lvl = 0; lvl < levels; lvl++) {
      const a = l1[lvl].data, b = l2[lvl].data, wt = weightPyr[lvl].data;
      for (let i = 0; i < a.length; i++) a[i] = b[i] + wt[i] * (a[i] - b[i]);
    }
    const fused = collapsePyramid(l1).data;
    for (let i = 0; i < n; i++) out[i * 4 + c] = fused[i] * 255;
  }
  for (let i = 3; i < out.length; i += 4) out[i] = rgba[i];
  return out;
}

/**
 * Red (and, in greenish water, blue) compensation, Gray World, then a light
 * percentile stretch. Returns [r, g, b] planes in 0..1.
 */
export function whiteBalance(rgba: Uint8ClampedArray, width: number, height: number): Plane[] {
  const n = width * height;
  const [r, g, b] = [plane(width, height), plane(width, height), plane(width, height)];
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const R = rgba[i * 4] / 255, G = rgba[i * 4 + 1] / 255, B = rgba[i * 4 + 2] / 255;
    r.data[i] = R; g.data[i] = G; b.data[i] = B;
    sr += R; sg += G; sb += B;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const compensateBlue = mb < mg;

  // Ir_c = Ir + (mean(Ig) - mean(Ir)) * (1 - Ir) * Ig   (alpha = 1)
  sr = sg = sb = 0;
  for (let i = 0; i < n; i++) {
    const G = g.data[i];
    const R = r.data[i] + (mg - mr) * (1 - r.data[i]) * G;
    const B = compensateBlue ? b.data[i] + (mg - mb) * (1 - b.data[i]) * G : b.data[i];
    r.data[i] = R; b.data[i] = B;
    sr += R; sg += G; sb += B;
  }

  // Gray World.
  const means = [sr / n, sg / n, sb / n];
  const gray = (means[0] + means[1] + means[2]) / 3;
  const planes = [r, g, b];
  planes.forEach((p, c) => {
    const gain = means[c] > 1e-6 ? Math.pow(gray / means[c], GRAY_WORLD_POWER) : 1;
    for (let i = 0; i < n; i++) p.data[i] *= gain;
  });

  // One stretch shared by all channels (so it doesn't undo the white balance).
  const hist = new Uint32Array(1024);
  for (const p of planes) for (let i = 0; i < n; i++) hist[clamp(Math.round(p.data[i] * 1023), 0, 1023)]++;
  const clip = 3 * n * STRETCH_CLIP;
  let lo = 0, hi = 1023;
  for (let acc = 0; lo < 1023 && (acc += hist[lo]) < clip; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < clip; hi--);
  const low = lo / 1023, scale = hi > lo ? 1023 / (hi - lo) : 1;
  for (const p of planes) for (let i = 0; i < n; i++) p.data[i] = clamp((p.data[i] - low) * scale, 0, 1);
  return planes;
}

function sharpen(rgb: Plane[]): Plane[] {
  const { width, height } = rgb[0];
  // Scale the blur with the image so preview and full-size results match.
  const sigma = Math.max(1.5, Math.max(width, height) / 400);
  return rgb.map((p) => {
    const blurred = gaussianBlur(p, sigma).data;
    const q = plane(width, height);
    for (let i = 0; i < q.data.length; i++) q.data[i] = clamp(2 * p.data[i] - blurred[i], 0, 1);
    return q;
  });
}

/** Sum of the Laplacian contrast, saliency and saturation weights. */
function weightMap([r, g, b]: Plane[], width: number, height: number): Float32Array {
  const n = width * height;
  const lum = new Float32Array(n);
  const lab = [plane(width, height), plane(width, height), plane(width, height)];
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const R = r.data[i], G = g.data[i], B = b.data[i];
    lum[i] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    toLab(R, G, B, lab, i);
    mean[0] += lab[0].data[i]; mean[1] += lab[1].data[i]; mean[2] += lab[2].data[i];
  }
  mean[0] /= n; mean[1] /= n; mean[2] /= n;

  // Saliency (Achanta et al. 2009): distance of the slightly blurred Lab image from its mean.
  const blurSigma = Math.max(1, Math.max(width, height) / 800);
  const [bl, ba, bb] = lab.map((p) => gaussianBlur(p, blurSigma).data);

  const w = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const up = Math.max(y - 1, 0) * width, row = y * width, down = Math.min(y + 1, height - 1) * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const lu = lum[i];
      // Laplacian contrast (4-neighbour), on 0..1 luminance.
      const lap = Math.abs(
        4 * lu - lum[row + Math.max(x - 1, 0)] - lum[row + Math.min(x + 1, width - 1)] - lum[up + x] - lum[down + x],
      );
      // Lab distances are ~0..100; scale to be comparable with the 0..1 weights.
      const dl = bl[i] - mean[0], da = ba[i] - mean[1], db = bb[i] - mean[2];
      const saliency = Math.sqrt(dl * dl + da * da + db * db) / 100;
      const dr = r.data[i] - lu, dg = g.data[i] - lu, dbb = b.data[i] - lu;
      const saturation = Math.sqrt((dr * dr + dg * dg + dbb * dbb) / 3);
      w[i] = lap + saliency + saturation;
    }
  }
  return w;
}

// Lookup tables: Math.pow/cbrt per pixel dominated the runtime.
const LUT_SIZE = 4096;
const SRGB_TO_LINEAR = new Float32Array(LUT_SIZE + 1);
const LAB_F = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) {
  const v = i / LUT_SIZE;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  LAB_F[i] = v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
}
const GAMMA_LUT = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) GAMMA_LUT[i] = Math.pow(i / LUT_SIZE, GAMMA);
const lut = (table: Float32Array, v: number) => table[v <= 0 ? 0 : v >= 1 ? LUT_SIZE : Math.round(v * LUT_SIZE)];

/** sRGB (0..1) to CIE L*a*b* (D65). */
function toLab(R: number, G: number, B: number, out: Plane[], i: number) {
  const lr = lut(SRGB_TO_LINEAR, R), lg = lut(SRGB_TO_LINEAR, G), lb = lut(SRGB_TO_LINEAR, B);
  const fx = lut(LAB_F, (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
  const fy = lut(LAB_F, 0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  const fz = lut(LAB_F, (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
  out[0].data[i] = 116 * fy - 16;
  out[1].data[i] = 500 * (fx - fy);
  out[2].data[i] = 200 * (fy - fz);
}
