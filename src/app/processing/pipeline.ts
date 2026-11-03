import { clahe } from './clahe';
import { applyColorMatrix, ColorMatrix, computeColorMatrix, scaleMatrix } from './color-correction';
import { fuse } from './fusion';

export type Method = 'classic' | 'fusion';

export interface Adjustments {
  method: Method;
  /** 0..1 blend from the original to the fully corrected image. */
  strength: number;
  /** 0..1 amount of local contrast (CLAHE) applied after correction. */
  clarity: number;
}

/**
 * Holds one image's preview-sized pixels and caches the expensive per-method
 * results, so slider moves only redo the cheap steps.
 */
export class PreviewSession {
  private matrix?: ColorMatrix;
  private fused?: Uint8ClampedArray;

  constructor(
    readonly pixels: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}

  /** The classic correction matrix (computed once from the preview pixels). */
  classicMatrix(): ColorMatrix {
    return (this.matrix ??= computeColorMatrix(this.pixels, this.width, this.height));
  }

  render(adj: Adjustments): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.pixels.length);
    if (adj.method === 'classic') {
      applyColorMatrix(this.pixels, out, scaleMatrix(this.classicMatrix(), adj.strength));
    } else {
      this.fused ??= fuse(this.pixels, this.width, this.height);
      blend(this.pixels, this.fused, out, adj.strength);
    }
    clahe(out, out, this.width, this.height, adj.clarity);
    return out;
  }
}

/**
 * Full-resolution version of PreviewSession.render. The classic matrix comes
 * from the preview so the export matches what the user saw.
 */
export function renderFull(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  adj: Adjustments,
  classicMatrix: ColorMatrix,
): void {
  if (adj.method === 'classic') {
    applyColorMatrix(pixels, pixels, scaleMatrix(classicMatrix, adj.strength));
  } else {
    blend(pixels, fuse(pixels, width, height), pixels, adj.strength);
  }
  clahe(pixels, pixels, width, height, adj.clarity);
}

/** dst = a + (b - a) * t, per channel (alpha from a). */
function blend(a: Uint8ClampedArray, b: Uint8ClampedArray, dst: Uint8ClampedArray, t: number) {
  for (let i = 0; i < a.length; i += 4) {
    dst[i] = a[i] + (b[i] - a[i]) * t;
    dst[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * t;
    dst[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * t;
    dst[i + 3] = a[i + 3];
  }
}

/** Decodes `file` at full resolution, processes it, and re-encodes it. */
export async function exportFile(
  file: Blob,
  adj: Adjustments,
  classicMatrix: ColorMatrix,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not supported.');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    renderFull(imageData.data, imageData.width, imageData.height, adj, classicMatrix);
    ctx.putImageData(imageData, 0, 0);
    return await canvas.convertToBlob({ type: mimeType, quality });
  } finally {
    bitmap.close();
  }
}
