import { clahe } from './clahe';
import { fuse, whiteBalance } from './fusion';
import { collapsePyramid, gaussianBlur, laplacianPyramid, plane, pyramidLevels } from './image-ops';
import { PreviewSession } from './pipeline';

function underwater(width: number, height: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < px.length; i += 4) {
    const t = i / px.length;
    px[i] = 15 + rand() * 25;
    px[i + 1] = 70 + t * 90 + rand() * 30;
    px[i + 2] = 110 + t * 70 + rand() * 40;
    px[i + 3] = 200 + (i % 50);
  }
  return px;
}

function meanChannel(px: Uint8ClampedArray, c: number): number {
  let s = 0;
  for (let i = c; i < px.length; i += 4) s += px[i];
  return s / (px.length / 4);
}

describe('image-ops', () => {
  it('laplacian pyramid round-trips exactly', () => {
    const p = plane(37, 23);
    p.data.forEach((_, i) => (p.data[i] = Math.sin(i * 0.37) * 0.5 + 0.5));
    const back = collapsePyramid(laplacianPyramid(p, 4));
    expect(back.width).toBe(37);
    back.data.forEach((v, i) => expect(v).toBeCloseTo(p.data[i], 5));
  });

  it('gaussian blur keeps a constant image constant', () => {
    const p = plane(20, 10);
    p.data.fill(0.42);
    gaussianBlur(p, 3).data.forEach((v) => expect(v).toBeCloseTo(0.42, 5));
  });

  it('picks sensible pyramid depths', () => {
    expect(pyramidLevels(1600, 1200)).toBe(7);
    expect(pyramidLevels(4, 4)).toBe(1);
  });
});

describe('fusion', () => {
  it('white balance lifts red in a blue-green image', () => {
    const [r, g] = whiteBalance(underwater(40, 30), 40, 30);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(r.data)).toBeGreaterThan(mean(g.data) * 0.5);
  });

  it('produces a same-sized image with more red and alpha preserved', () => {
    const src = underwater(64, 48);
    const out = fuse(src, 64, 48);
    expect(out.length).toBe(src.length);
    expect(meanChannel(out, 0)).toBeGreaterThan(meanChannel(src, 0) * 2);
    for (let i = 3; i < src.length; i += 4) expect(out[i]).toBe(src[i]);
  });

  it('handles an empty image', () => {
    expect(fuse(new Uint8ClampedArray(0), 0, 0).length).toBe(0);
  });
});

describe('clahe', () => {
  it('is a no-op at amount 0', () => {
    const src = underwater(16, 16);
    const dst = new Uint8ClampedArray(src.length);
    clahe(src, dst, 16, 16, 0);
    expect([...dst]).toEqual([...src]);
  });

  it('increases contrast of a low-contrast image and keeps alpha', () => {
    const w = 64, h = 64;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = 120 + ((i % w) * 16) / w; // 120..136 gradient
      src.set([v, v, v, 99], i * 4);
    }
    const dst = new Uint8ClampedArray(src.length);
    clahe(src, dst, w, h, 1);
    const range = (px: Uint8ClampedArray) => {
      let lo = 255, hi = 0;
      for (let i = 0; i < px.length; i += 4) { lo = Math.min(lo, px[i]); hi = Math.max(hi, px[i]); }
      return hi - lo;
    };
    expect(range(dst)).toBeGreaterThan(range(src));
    expect(dst[3]).toBe(99);
  });
});

describe('PreviewSession', () => {
  const w = 32, h = 24;
  const src = underwater(w, h);

  for (const method of ['classic', 'fusion'] as const) {
    it(`${method}: strength 0 and clarity 0 returns the original`, () => {
      const out = new PreviewSession(src, w, h).render({ method, strength: 0, clarity: 0 });
      expect([...out]).toEqual([...src]);
    });

    it(`${method}: full strength changes the image`, () => {
      const out = new PreviewSession(src, w, h).render({ method, strength: 1, clarity: 0 });
      expect(meanChannel(out, 0)).toBeGreaterThan(meanChannel(src, 0));
    });
  }
});
