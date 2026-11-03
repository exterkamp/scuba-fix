import { ColorMatrix } from './color-correction';

/** Messages the main thread sends to the color-correction worker. */
export type WorkerRequest =
  | {
      id: number;
      type: 'analyze';
      /** RGBA pixels (may be a downscaled copy of the image). */
      pixels: Uint8ClampedArray;
      width: number;
      height: number;
    }
  | {
      id: number;
      type: 'render';
      /** The original image file; decoded at full resolution in the worker. */
      file: Blob;
      matrix: ColorMatrix;
      mimeType: string;
      quality: number;
    };

/** Messages the worker sends back. */
export type WorkerResponse =
  | { id: number; type: 'analyze'; matrix: ColorMatrix }
  | { id: number; type: 'render'; blob: Blob }
  | { id: number; type: 'error'; message: string };
