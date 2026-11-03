import { Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { applyColorMatrix, ColorMatrix, scaleMatrix } from '../processing/color-correction';
import { ImageProcessor } from '../processing/image-processor.service';

/** Longest edge of the on-screen preview. Full resolution is only used for downloads. */
const PREVIEW_MAX_EDGE = 1600;

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; original: ImageData; matrix: ColorMatrix }
  | { kind: 'error'; message: string };

/**
 * Shows the corrected version of `file` with a strength slider, press-and-hold
 * comparison with the original, and full-resolution download.
 */
@Component({
  selector: 'app-image-preview',
  templateUrl: './image-preview.component.html',
  styleUrl: './image-preview.component.css',
})
export class ImagePreviewComponent {
  private readonly processor = inject(ImageProcessor);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly file = input.required<File>();

  /** Correction strength, 0–100. Shared across images on purpose. */
  readonly strength = signal(100);
  readonly comparing = signal(false);
  readonly status = signal<Status>({ kind: 'loading' });
  readonly errorMessage = computed(() => {
    const s = this.status();
    return s.kind === 'error' ? s.message : null;
  });
  readonly downloading = signal(false);
  readonly downloadError = signal<string | null>(null);

  /** Scratch buffer for the filtered preview, reused across slider moves. */
  private working?: ImageData;
  /** Incremented per load so results for a previously selected file are dropped. */
  private loadToken = 0;

  constructor() {
    effect(() => {
      this.load(this.file());
    });

    effect(() => {
      const status = this.status();
      if (status.kind !== 'ready') return;
      this.draw(status.original, status.matrix, this.strength() / 100, this.comparing());
    });
  }

  private async load(file: File) {
    const token = ++this.loadToken;
    this.status.set({ kind: 'loading' });
    this.comparing.set(false);
    this.downloadError.set(null);
    try {
      const original = await decodePreview(file);
      if (token !== this.loadToken) return;
      // The worker takes ownership of the buffer, so hand it a copy.
      const matrix = await this.processor.analyze(original.data.slice(), original.width, original.height);
      if (token !== this.loadToken) return;
      this.working = new ImageData(original.width, original.height);
      this.status.set({ kind: 'ready', original, matrix });
    } catch (e) {
      if (token !== this.loadToken) return;
      console.error(e);
      this.status.set({
        kind: 'error',
        message:
          `Couldn't open “${file.name}”. Your browser may not support this format ` +
          `(HEIC photos usually need converting to JPEG first).`,
      });
    }
  }

  private draw(original: ImageData, matrix: ColorMatrix, strength: number, showOriginal: boolean) {
    const canvas = this.canvas().nativeElement;
    if (canvas.width !== original.width || canvas.height !== original.height) {
      canvas.width = original.width;
      canvas.height = original.height;
    }
    const ctx = canvas.getContext('2d')!;
    if (showOriginal || strength === 0) {
      ctx.putImageData(original, 0, 0);
      return;
    }
    const out = this.working!;
    applyColorMatrix(original.data, out.data, scaleMatrix(matrix, strength));
    ctx.putImageData(out, 0, 0);
  }

  // --- Compare (press and hold) ---

  protected startCompare(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.comparing.set(true);
  }

  protected endCompare() {
    this.comparing.set(false);
  }

  protected compareKey(event: KeyboardEvent, down: boolean) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) this.comparing.set(down);
  }

  // --- Download ---

  async download() {
    const status = this.status();
    if (status.kind !== 'ready' || this.downloading()) return;
    this.downloading.set(true);
    this.downloadError.set(null);
    const file = this.file();
    try {
      const { mimeType, extension } = outputFormat(file.type);
      const blob = await this.processor.render(file, scaleMatrix(status.matrix, this.strength() / 100), mimeType);
      saveBlob(blob, `${baseName(file.name)}-scubafix.${extension}`);
    } catch (e) {
      console.error(e);
      this.downloadError.set('Saving failed — the image may be too large for this device.');
    } finally {
      this.downloading.set(false);
    }
  }
}

/** Decodes `file` (respecting EXIF orientation) into pixels no larger than PREVIEW_MAX_EDGE. */
async function decodePreview(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

/** Keep JPEG/WebP lossy (photos as PNG are huge); everything else becomes PNG. */
function outputFormat(inputType: string): { mimeType: string; extension: string } {
  switch (inputType) {
    case 'image/jpeg':
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    case 'image/webp':
      return { mimeType: 'image/webp', extension: 'webp' };
    case 'image/png':
      return { mimeType: 'image/png', extension: 'png' };
    default:
      return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
}

function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename) || 'image';
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
