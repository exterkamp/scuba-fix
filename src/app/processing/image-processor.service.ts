import { Injectable, OnDestroy } from '@angular/core';
import { ColorMatrix } from './color-correction';
import { Adjustments } from './pipeline';
import { ProcessingEngine } from './processing-engine';
import { WorkerRequest, WorkerResponse } from './worker-protocol';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type Request = DistributiveOmit<WorkerRequest, 'id'>;
type ResponseOf<T extends WorkerResponse['type']> = Extract<WorkerResponse, { type: T }>;

/**
 * A promise-based connection to one processing worker, with a main-thread
 * fallback. Created lazily so nothing runs during prerendering.
 */
class WorkerChannel {
  private worker?: Worker | null;
  private fallback?: ProcessingEngine;
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

  async send(req: Request, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const full = { ...req, id: this.nextId++ } as WorkerRequest;
    const worker = this.getWorker();
    const res = worker
      ? await new Promise<WorkerResponse>((resolve, reject) => {
          this.pending.set(full.id, { resolve, reject });
          worker.postMessage(full, transfer);
        })
      : (await (this.fallback ??= new ProcessingEngine()).handle(full))[0];
    if (res.type === 'error') throw new Error(res.message);
    return res;
  }

  terminate() {
    this.worker?.terminate();
    this.worker = undefined;
    this.failAll(new Error('Image processor stopped.'));
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      return (this.worker = null);
    }
    const worker = new Worker(new URL('./color-correction.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(data.id);
      this.pending.delete(data.id);
      p?.resolve(data);
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

/**
 * Front end for image processing. Previews and full-size exports use separate
 * workers so a slow export never blocks slider feedback.
 */
@Injectable({ providedIn: 'root' })
export class ImageProcessor implements OnDestroy {
  private readonly previewChannel = new WorkerChannel();
  private readonly exportChannel = new WorkerChannel();
  private nextSession = 0;

  /**
   * Starts a preview session for RGBA pixels (the buffer is transferred).
   * Returns the session id and the classic correction matrix.
   */
  async load(pixels: Uint8ClampedArray, width: number, height: number): Promise<{ session: number; classicMatrix: ColorMatrix }> {
    const session = this.nextSession++;
    const res = await this.previewChannel.send({ type: 'load', session, pixels, width, height }, [pixels.buffer]);
    return { session, classicMatrix: (res as ResponseOf<'load'>).classicMatrix };
  }

  /** Renders the current session's preview with `adjustments`. */
  async preview(session: number, adjustments: Adjustments): Promise<Uint8ClampedArray> {
    const res = await this.previewChannel.send({ type: 'preview', session, adjustments: { ...adjustments } });
    return (res as ResponseOf<'preview'>).pixels;
  }

  /** Renders `file` at full resolution. */
  async export(file: Blob, adjustments: Adjustments, classicMatrix: ColorMatrix, mimeType: string, quality = 0.92): Promise<Blob> {
    const res = await this.exportChannel.send({
      type: 'export',
      file,
      adjustments: { ...adjustments },
      classicMatrix: [...classicMatrix],
      mimeType,
      quality,
    });
    return (res as ResponseOf<'export'>).blob;
  }

  ngOnDestroy(): void {
    this.previewChannel.terminate();
    this.exportChannel.terminate();
  }
}
