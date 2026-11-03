/*
 * Contrast Limited Adaptive Histogram Equalization on luminance.
 *
 * The image is split into a fixed TILES x TILES grid (fixed count rather than
 * fixed pixel size, so the preview and the full-size export look the same).
 * Each tile gets a clipped-histogram equalization curve; every pixel's
 * luminance is mapped through the bilinear blend of its four nearest tile
 * curves. The luminance change is added equally to R, G and B, which is
 * equivalent to equalizing Y in YCbCr and keeps the colors from shifting.
 */

const TILES = 8;
/** Histogram bins are clipped at CLIP_LIMIT x the average bin height. */
const CLIP_LIMIT = 2;

/**
 * Applies CLAHE to `src` and writes into `dst` (may be the same buffer).
 * `amount` (0..1) blends between the input and the fully equalized result.
 */
export function clahe(src: Uint8ClampedArray, dst: Uint8ClampedArray, width: number, height: number, amount: number) {
  const n = width * height;
  if (n === 0) return;
  if (amount <= 0) {
    if (dst !== src) dst.set(src);
    return;
  }

  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = Math.round(0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]);
  }

  const tilesX = Math.min(TILES, width), tilesY = Math.min(TILES, height);
  const tileW = width / tilesX, tileH = height / tilesY;

  // One 256-entry lookup table per tile.
  const luts = new Float32Array(tilesX * tilesY * 256);
  const hist = new Float64Array(256);
  for (let ty = 0; ty < tilesY; ty++) {
    const y0 = Math.floor(ty * tileH), y1 = Math.floor((ty + 1) * tileH);
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = Math.floor(tx * tileW), x1 = Math.floor((tx + 1) * tileW);
      hist.fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[lum[y * width + x]]++;
      const count = (x1 - x0) * (y1 - y0);
      const limit = Math.max(1, (CLIP_LIMIT * count) / 256);
      let excess = 0;
      for (let v = 0; v < 256; v++) {
        if (hist[v] > limit) {
          excess += hist[v] - limit;
          hist[v] = limit;
        }
      }
      const bonus = excess / 256;
      const lut = (ty * tilesX + tx) * 256;
      let cdf = 0;
      for (let v = 0; v < 256; v++) {
        cdf += hist[v] + bonus;
        luts[lut + v] = (cdf * 255) / count;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) / tileH - 0.5;
    const ty0 = Math.max(0, Math.floor(fy)), ty1 = Math.min(tilesY - 1, ty0 + 1);
    const wy = Math.min(1, Math.max(0, fy - ty0));
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / tileW - 0.5;
      const tx0 = Math.max(0, Math.floor(fx)), tx1 = Math.min(tilesX - 1, tx0 + 1);
      const wx = Math.min(1, Math.max(0, fx - tx0));
      const i = y * width + x;
      const v = lum[i];
      const top = luts[(ty0 * tilesX + tx0) * 256 + v] * (1 - wx) + luts[(ty0 * tilesX + tx1) * 256 + v] * wx;
      const bottom = luts[(ty1 * tilesX + tx0) * 256 + v] * (1 - wx) + luts[(ty1 * tilesX + tx1) * 256 + v] * wx;
      const delta = (top * (1 - wy) + bottom * wy - v) * amount;
      const p = i * 4;
      dst[p] = src[p] + delta;
      dst[p + 1] = src[p + 1] + delta;
      dst[p + 2] = src[p + 2] + delta;
      dst[p + 3] = src[p + 3];
    }
  }
}
