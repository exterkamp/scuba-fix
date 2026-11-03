import { applyColorMatrix, ColorMatrix, computeColorMatrix } from './color-correction';

/*
 * The actual work behind each worker request. Kept separate from the worker
 * entry point so the service can fall back to running it on the main thread
 * when workers are unavailable.
 */

export function analyze(pixels: Uint8ClampedArray, width: number, height: number): ColorMatrix {
  return computeColorMatrix(pixels, width, height);
}

/** Decodes `file` at full resolution, applies `matrix`, and re-encodes it. */
export async function render(file: Blob, matrix: ColorMatrix, mimeType: string, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not supported.');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    applyColorMatrix(imageData.data, imageData.data, matrix);
    ctx.putImageData(imageData, 0, 0);
    return await canvas.convertToBlob({ type: mimeType, quality });
  } finally {
    bitmap.close();
  }
}
