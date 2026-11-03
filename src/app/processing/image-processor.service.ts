import { Injectable, OnDestroy } from '@angular/core';
import { ColorMatrix } from './color-correction';
import { analyze, render } from './processing-core';
import { WorkerRequest, WorkerResponse } from './worker-protocol';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/**
 * Promise-based front end for the color-correction worker. The worker is
 * created lazily (so nothing happens during prerendering) and work falls back
 * to the main thread if workers aren't available.
 */
@Injectable({ providedIn: 'root' })
export class ImageProcessor implements OnDestroy {
  private worker?: Worker | null;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  /** Computes the correction matrix for an RGBA pixel buffer. The buffer is transferred. */
  async analyze(pixels: Uint8ClampedArray, width: number, height: number): Promise<ColorMatrix> {
    const worker = this.getWorker();
    if (!worker) return analyze(pixels, width, height);
    const res = await this.send({ type: 'analyze', pixels, width, height }, [pixels.buffer]);
    return (res as Extract<WorkerResponse, { type: 'analyze' }>).matrix;
  }

  /** Renders `file` at full resolution with `matrix` applied. */
  async render(file: Blob, matrix: ColorMatrix, mimeType: string, quality = 0.92): Promise<Blob> {
    const worker = this.getWorker();
    if (!worker) return render(file, matrix, mimeType, quality);
    const res = await this.send({ type: 'render', file, matrix: [...matrix], mimeType, quality });
    return (res as Extract<WorkerResponse, { type: 'render' }>).blob;
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.failAll(new Error('Image processor destroyed.'));
  }

  private send(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      return (this.worker = null);
    }
    const worker = new Worker(new URL('./color-correction.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    worker.onerror = (e) => {
      // A crashed worker can't be trusted: fail everything and start fresh next time.
      e.preventDefault();
      worker.terminate();
      this.worker = undefined;
      this.failAll(new Error(e.message || 'Image worker crashed.'));
    };
    return (this.worker = worker);
  }

  private failAll(error: Error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
