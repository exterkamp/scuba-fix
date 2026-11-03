import { ColorMatrix } from './color-correction';
import { Adjustments } from './pipeline';

/** Messages the main thread sends to the worker. */
export type WorkerRequest =
  | {
      id: number;
      /** Start a new preview session; replaces any previous one. */
      type: 'load';
      session: number;
      pixels: Uint8ClampedArray;
      width: number;
      height: number;
    }
  | { id: number; type: 'preview'; session: number; adjustments: Adjustments }
  | {
      id: number;
      /** Full-resolution export of the original file. */
      type: 'export';
      file: Blob;
      adjustments: Adjustments;
      classicMatrix: ColorMatrix;
      mimeType: string;
      quality: number;
    };

/** Messages the worker sends back. */
export type WorkerResponse =
  | { id: number; type: 'load'; classicMatrix: ColorMatrix }
  | { id: number; type: 'preview'; pixels: Uint8ClampedArray }
  | { id: number; type: 'export'; blob: Blob }
  | { id: number; type: 'error'; message: string };
