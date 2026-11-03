import { Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ColorMatrix } from '../processing/color-correction';
import { ImageProcessor } from '../processing/image-processor.service';
import { Adjustments, Method } from '../processing/pipeline';

/** Longest edge of the on-screen preview. Full resolution is only used for downloads. */
const PREVIEW_MAX_EDGE = 1600;
const SETTINGS_KEY = 'scuba-fix:adjustments';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; session: number; original: ImageData; classicMatrix: ColorMatrix }
  | { kind: 'error'; message: string };

interface Settings { method: Method; strength: number; clarity: number; }
const DEFAULT_SETTINGS: Settings = { method: 'classic', strength: 100, clarity: 0 };

/**
 * Shows the corrected version of `file` with method/strength/clarity controls,
 * press-and-hold comparison with the original, and full-resolution download.
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

  // Adjustments are remembered across images and visits.
  private readonly saved = loadSettings();
  readonly method = signal<Method>(this.saved.method);
  /** 0–100 */
  readonly strength = signal(this.saved.strength);
  /** 0–100 */
  readonly clarity = signal(this.saved.clarity);
  private readonly adjustments = computed<Adjustments>(() => ({
    method: this.method(),
    strength: this.strength() / 100,
    clarity: this.clarity() / 100,
  }));

  readonly status = signal<Status>({ kind: 'loading' });
  readonly errorMessage = computed(() => {
    const s = this.status();
    return s.kind === 'error' ? s.message : null;
  });
  readonly ready = computed(() => this.status().kind === 'ready');
  /** Latest rendered preview; null until the first render for this image arrives. */
  readonly rendered = signal<ImageData | null>(null);
  readonly rendering = signal(false);
  readonly comparing = signal(false);
  readonly downloading = signal(false);
  readonly downloadError = signal<string | null>(null);

  /** Incremented per load so results for a previously selected file are dropped. */
  private loadToken = 0;
  private previewQueued = false;

  constructor() {
    effect(() => {
      this.load(this.file());
    });

    // Re-render whenever the adjustments change; requestPreview coalesces bursts.
    effect(() => {
      this.adjustments();
      if (this.status().kind === 'ready') untracked(() => this.requestPreview());
    });

    effect(() => {
      const rendered = this.rendered();
      const status = this.status();
      if (!rendered || status.kind !== 'ready') return;
      this.draw(this.comparing() ? status.original : rendered);
    });

    effect(() => saveSettings({ method: this.method(), strength: this.strength(), clarity: this.clarity() }));
  }

  private async load(file: File) {
    const token = ++this.loadToken;
    this.status.set({ kind: 'loading' });
    this.rendered.set(null);
    this.comparing.set(false);
    this.downloadError.set(null);
    try {
      const original = await decodePreview(file);
      if (token !== this.loadToken) return;
      // The worker takes ownership of the buffer, so hand it a copy.
      const { session, classicMatrix } = await this.processor.load(original.data.slice(), original.width, original.height);
      if (token !== this.loadToken) return;
      this.status.set({ kind: 'ready', session, original, classicMatrix });
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

  /** Renders the preview; while one render is in flight, only the latest request is kept. */
  private async requestPreview() {
    if (this.rendering()) {
      this.previewQueued = true;
      return;
    }
    this.rendering.set(true);
    try {
      do {
        this.previewQueued = false;
        const status = this.status();
        if (status.kind !== 'ready') break;
        const token = this.loadToken;
        try {
          const pixels = await this.processor.preview(status.session, this.adjustments());
          if (token === this.loadToken) {
            this.rendered.set(new ImageData(pixels, status.original.width, status.original.height));
          }
        } catch (e) {
          // A newer image replaced this session; its own load will render.
          if (token === this.loadToken) throw e;
        }
      } while (this.previewQueued);
    } catch (e) {
      console.error(e);
      this.status.set({ kind: 'error', message: 'Processing failed — the image may be too large for this device.' });
    } finally {
      this.rendering.set(false);
    }
  }

  private draw(image: ImageData) {
    const canvas = this.canvas().nativeElement;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    canvas.getContext('2d')!.putImageData(image, 0, 0);
  }

  protected setMethod(method: Method) {
    this.method.set(method);
  }

  protected sliderValue(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
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
      const blob = await this.processor.export(file, this.adjustments(), status.classicMatrix, mimeType);
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

function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    const pct = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : d);
    return {
      method: s.method === 'fusion' ? 'fusion' : 'classic',
      strength: pct(s.strength, DEFAULT_SETTINGS.strength),
      clarity: pct(s.clarity, DEFAULT_SETTINGS.clarity),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode, SSR); settings just won't persist.
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
