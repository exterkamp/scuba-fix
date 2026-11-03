/*
 * Small, allocation-conscious image primitives on single-channel Float32
 * planes. All functions treat out-of-bounds reads as clamped to the edge.
 */

export interface Plane {
  data: Float32Array;
  width: number;
  height: number;
}

export function plane(width: number, height: number): Plane {
  return { data: new Float32Array(width * height), width, height };
}

/**
 * Approximate Gaussian blur (three box-blur passes per axis). Cost is
 * independent of sigma.
 */
export function gaussianBlur(src: Plane, sigma: number): Plane {
  const { width: w, height: h } = src;
  // Box radius for 3 passes ~ sigma (W. Jarosz, "Fast Image Convolutions").
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  let a = Float32Array.from(src.data);
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
  return { data: a, width: w, height: h };
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  // Row-major sweep with one running sum per column, so memory access stays sequential.
  const norm = 1 / (2 * r + 1);
  const acc = new Float32Array(w);
  for (let i = -r; i <= r; i++) {
    const row = clamp(i, 0, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const out = y * w;
    const add = Math.min(y + r + 1, h - 1) * w;
    const sub = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) {
      dst[out + x] = acc[x] * norm;
      acc[x] += src[add + x] - src[sub + x];
    }
  }
}

/** Blur with the 5-tap binomial kernel [1 4 6 4 1]/16 and halve the resolution. */
export function pyrDown(src: Plane): Plane {
  const { width: w, height: h, data: s } = src;
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const tmp = new Float32Array(w2 * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x2 = 0; x2 < w2; x2++) {
      const x = x2 * 2;
      tmp[y * w2 + x2] =
        (s[row + clamp(x - 2, 0, w - 1)] + s[row + clamp(x + 2, 0, w - 1)] +
          4 * (s[row + clamp(x - 1, 0, w - 1)] + s[row + clamp(x + 1, 0, w - 1)]) +
          6 * s[row + x]) / 16;
    }
  }
  const out = plane(w2, h2);
  const d = out.data;
  for (let y2 = 0; y2 < h2; y2++) {
    const y = y2 * 2;
    const r0 = clamp(y - 2, 0, h - 1) * w2, r1 = clamp(y - 1, 0, h - 1) * w2, r2 = y * w2;
    const r3 = clamp(y + 1, 0, h - 1) * w2, r4 = clamp(y + 2, 0, h - 1) * w2;
    for (let x2 = 0; x2 < w2; x2++) {
      d[y2 * w2 + x2] = (tmp[r0 + x2] + tmp[r4 + x2] + 4 * (tmp[r1 + x2] + tmp[r3 + x2]) + 6 * tmp[r2 + x2]) / 16;
    }
  }
  return out;
}

/** Bilinearly upsample `src` (made by pyrDown) back to width x height. */
export function pyrUp(src: Plane, width: number, height: number): Plane {
  const { width: sw, height: sh, data: s } = src;
  const out = plane(width, height);
  const d = out.data;
  for (let y = 0; y < height; y++) {
    const fy = y / 2;
    const y0 = Math.min(Math.floor(fy), sh - 1), y1 = Math.min(y0 + 1, sh - 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = x / 2;
      const x0 = Math.min(Math.floor(fx), sw - 1), x1 = Math.min(x0 + 1, sw - 1), wx = fx - x0;
      const top = s[y0 * sw + x0] * (1 - wx) + s[y0 * sw + x1] * wx;
      const bottom = s[y1 * sw + x0] * (1 - wx) + s[y1 * sw + x1] * wx;
      d[y * width + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

export function gaussianPyramid(src: Plane, levels: number): Plane[] {
  const pyr = [src];
  for (let i = 1; i < levels; i++) pyr.push(pyrDown(pyr[i - 1]));
  return pyr;
}

/** Laplacian pyramid; the last level is the coarsest Gaussian level. */
export function laplacianPyramid(src: Plane, levels: number): Plane[] {
  // Copy level 0 so the caller's plane isn't overwritten.
  const gauss = gaussianPyramid({ ...src, data: Float32Array.from(src.data) }, levels);
  for (let i = 0; i < levels - 1; i++) {
    const up = pyrUp(gauss[i + 1], gauss[i].width, gauss[i].height).data;
    const g = gauss[i].data;
    for (let j = 0; j < g.length; j++) g[j] -= up[j];
  }
  return gauss;
}

/** Inverse of laplacianPyramid (exact, since it uses the same pyrUp). */
export function collapsePyramid(pyr: Plane[]): Plane {
  let acc = pyr[pyr.length - 1];
  for (let i = pyr.length - 2; i >= 0; i--) {
    const up = pyrUp(acc, pyr[i].width, pyr[i].height);
    const l = pyr[i].data, u = up.data;
    for (let j = 0; j < u.length; j++) u[j] += l[j];
    acc = up;
  }
  return acc;
}

/** Number of pyramid levels so the coarsest level is roughly 8–16px on its short side. */
export function pyramidLevels(width: number, height: number): number {
  return clamp(Math.floor(Math.log2(Math.min(width, height) / 8)), 1, 10);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
