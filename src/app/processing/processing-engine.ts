import { exportFile, PreviewSession } from './pipeline';
import { WorkerRequest, WorkerResponse } from './worker-protocol';

/**
 * Handles worker requests. Used by the worker, and directly on the main
 * thread when workers aren't available.
 */
export class ProcessingEngine {
  private session?: { id: number; preview: PreviewSession };

  /** Returns the response plus any buffers to transfer with it. */
  async handle(req: WorkerRequest): Promise<[WorkerResponse, Transferable[]]> {
    try {
      switch (req.type) {
        case 'load': {
          const preview = new PreviewSession(req.pixels, req.width, req.height);
          this.session = { id: req.session, preview };
          return [{ id: req.id, type: 'load', classicMatrix: preview.classicMatrix() }, []];
        }
        case 'preview': {
          if (this.session?.id !== req.session) throw new Error('Stale preview session.');
          const pixels = this.session.preview.render(req.adjustments);
          return [{ id: req.id, type: 'preview', pixels }, [pixels.buffer]];
        }
        case 'export': {
          const blob = await exportFile(req.file, req.adjustments, req.classicMatrix, req.mimeType, req.quality);
          return [{ id: req.id, type: 'export', blob }, []];
        }
      }
    } catch (e) {
      return [{ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) }, []];
    }
  }
}
