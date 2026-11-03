import {
  applyColorMatrix,
  computeColorMatrix,
  IDENTITY_MATRIX,
  normalizingInterval,
  scaleMatrix,
} from './color-correction';

/** A deterministic, blue-green "underwater" test image with little red. */
function underwaterPixels(width: number, height: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < px.length; i += 4) {
    const t = (i / 4) / (width * height);
    px[i] = 10 + rand() * 30;
    px[i + 1] = 60 + t * 100 + rand() * 40;
    px[i + 2] = 90 + t * 80 + rand() * 50;
    px[i + 3] = 255;
  }
  return px;
}

/** The original (pre-Angular) implementation, kept verbatim as a reference. */
function legacyGenerateImageFilter(pixels: Uint8ClampedArray, width: number, height: number): number[] {
  const numOfPixels = width * height;
  const thresholdLevel = numOfPixels / 2000;
  const hist: any = { r: [], g: [], b: [] };
  const normalize: any = { r: [], g: [], b: [] };
  let hueShift = 0;
  for (let i = 0; i < 256; i++) { hist.r.push(0); hist.g.push(0); hist.b.push(0); }
  const avg = { r: 0, g: 0, b: 0 };
  for (let p = 0; p < numOfPixels * 4; p += 4) { avg.r += pixels[p]; avg.g += pixels[p + 1]; avg.b += pixels[p + 2]; }
  avg.r /= numOfPixels; avg.g /= numOfPixels; avg.b /= numOfPixels;
  const hueShiftRed = (r: number, g: number, b: number, h: number) => {
    const U = Math.cos(h * Math.PI / 180), W = Math.sin(h * Math.PI / 180);
    return { r: (0.299 + 0.701 * U + 0.168 * W) * r, g: (0.587 - 0.587 * U + 0.330 * W) * g, b: (0.114 - 0.114 * U - 0.497 * W) * b };
  };
  let newAvgRed = avg.r;
  while (newAvgRed < 60) {
    const s = hueShiftRed(avg.r, avg.g, avg.b, hueShift);
    newAvgRed = s.r + s.g + s.b;
    hueShift++;
    if (hueShift > 120) newAvgRed = 60;
  }
  for (let p = 0; p < numOfPixels * 4; p += 4) {
    const s = hueShiftRed(pixels[p], pixels[p + 1], pixels[p + 2], hueShift);
    const red = Math.round(Math.min(255, Math.max(0, s.r + s.g + s.b)));
    hist.r[red] += 1; hist.g[pixels[p + 1]] += 1; hist.b[pixels[p + 2]] += 1;
  }
  for (const c of ['r', 'g', 'b']) {
    normalize[c].push(0);
    for (let i = 0; i < 256; i++) if (hist[c][i] - thresholdLevel < 2) normalize[c].push(i);
    normalize[c].push(255);
  }
  const interval = (a: number[]) => {
    let high = 255, low = 0, maxDist = 0;
    for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; if (d > maxDist) { maxDist = d; high = a[i]; low = a[i - 1]; } }
    return { low, high };
  };
  const ar = interval(normalize.r), ag = interval(normalize.g), ab = interval(normalize.b);
  const shifted = hueShiftRed(1, 1, 1, hueShift);
  const redGain = 256 / (ar.high - ar.low), greenGain = 256 / (ag.high - ag.low), blueGain = 256 / (ab.high - ab.low);
  return [
    shifted.r * redGain, shifted.g * redGain, shifted.b * redGain * 1.2, 0, (-ar.low / 256) * redGain,
    0, greenGain, 0, 0, (-ag.low / 256) * greenGain,
    0, 0, blueGain, 0, (-ab.low / 256) * blueGain,
    0, 0, 0, 1, 0,
  ];
}

describe('color-correction', () => {
  it('matches the original implementation', () => {
    const w = 120, h = 80;
    const px = underwaterPixels(w, h);
    const actual = computeColorMatrix(px, w, h);
    const expected = legacyGenerateImageFilter(px, w, h);
    expect(actual.length).toBe(20);
    actual.forEach((v, i) => expect(v).withContext(`m[${i}]`).toBeCloseTo(expected[i], 10));
  });

  it('boosts red in a blue-green image', () => {
    const w = 64, h = 64;
    const px = underwaterPixels(w, h);
    const out = new Uint8ClampedArray(px.length);
    applyColorMatrix(px, out, computeColorMatrix(px, w, h));
    const avgRed = (buf: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < buf.length; i += 4) s += buf[i];
      return s / (buf.length / 4);
    };
    expect(avgRed(out)).toBeGreaterThan(avgRed(px) * 2);
  });

  it('returns identity for an empty image', () => {
    expect(computeColorMatrix(new Uint8ClampedArray(0), 0, 0)).toEqual(IDENTITY_MATRIX);
  });

  it('scaleMatrix blends between identity and the full matrix', () => {
    const m = computeColorMatrix(underwaterPixels(32, 32), 32, 32);
    expect(scaleMatrix(m, 0)).toEqual([...IDENTITY_MATRIX]);
    scaleMatrix(m, 1).forEach((v, i) => expect(v).toBeCloseTo(m[i], 12));
    scaleMatrix(m, 0.5).forEach((v, i) => expect(v).toBeCloseTo((m[i] + IDENTITY_MATRIX[i]) / 2, 12));
    expect(scaleMatrix(m, 5)).toEqual(scaleMatrix(m, 1));
  });

  it('applyColorMatrix with identity is a no-op and preserves alpha', () => {
    const src = new Uint8ClampedArray([10, 20, 30, 40, 250, 0, 128, 7]);
    const dst = new Uint8ClampedArray(src.length);
    applyColorMatrix(src, dst, IDENTITY_MATRIX);
    expect([...dst]).toEqual([...src]);
  });

  it('applyColorMatrix clamps to 0..255', () => {
    const src = new Uint8ClampedArray([200, 200, 200, 255]);
    const dst = new Uint8ClampedArray(4);
    applyColorMatrix(src, dst, [2, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    expect([...dst]).toEqual([255, 0, 200, 255]);
  });

  it('normalizingInterval picks the widest populated run', () => {
    const hist = new Array(256).fill(0);
    for (let i = 40; i < 200; i++) hist[i] = 100;
    expect(normalizingInterval(hist, 10)).toEqual({ low: 39, high: 200 });
  });
});
