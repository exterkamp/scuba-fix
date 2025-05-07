import { Component, input, ViewChild, ElementRef } from '@angular/core';

import {
  CreateFilterReqeuest,
  CreateFilterResults,
  Filter,
  WorkType,
  WorkResult,
  ApplyFilterResults,
  ApplyFilterRequest,
} from './image-preview-worker-types';

@Component({
  selector: 'app-image-preview',
  imports: [],
  templateUrl: './image-preview.component.html',
  styleUrl: './image-preview.component.scss'
})
export class ImagePreviewComponent {
  // its important myCanvas matches the variable name in the template
  @ViewChild('outputCanvas', {static: false})
  outputCanvas!: ElementRef<HTMLCanvasElement>;
  private outputCtx!: CanvasRenderingContext2D;

  @ViewChild('originalCanvas', {static: false})
  originalCanvas!: ElementRef<HTMLCanvasElement>;
  private originalCtx!: CanvasRenderingContext2D;

  imageFile = input<File>();

  private originalBitmap: ImageBitmap | undefined = undefined;
  private filteredBitmap: ImageBitmap | undefined = undefined;
  private filter: Filter | undefined = undefined;
  private worker?: Worker = undefined;

  ngAfterViewInit(): void {
    this.outputCtx = this.outputCanvas.nativeElement.getContext('2d')!;
    this.originalCtx = this.originalCanvas.nativeElement.getContext('2d')!;
    // Draw, then initialize our worker, and start processing.
    
    createImageBitmap(this.imageFile()!)
      .then((bitmap) => {
          this.originalBitmap = bitmap;
          this.drawImageOnCanvas(bitmap, this.originalCanvas.nativeElement);
          // Dumb.
          return bitmap;
        })
      .then((bitmap) => {
      // Calculate the filter.
      // TODO: Make service to calculate a filter offscreen.
      if (typeof Worker !== 'undefined') {
        // Create a new
        this.worker = new Worker(new URL('./image-preview.worker', import.meta.url));
        this.worker.onmessage = ({ data }) => {
          this.handleWorkerResponse(data);
        };
        this.worker.postMessage({
          type: WorkType.CreateFilter,
          bitmap,
        } as CreateFilterReqeuest, [bitmap]);
      } else {
        // Web workers are not supported in this environment.
        // You should add a fallback so that your program still executes correctly.
      }
    });
  }

  hideFilter() {
    this.outputCanvas.nativeElement.style.opacity = '0';
  }

  showFilter() {
    this.outputCanvas.nativeElement.style.opacity = '1';
  }

  download() {
    this.downloadImageFromCanvas();
  }

  private applyFilterToImageAndBlobify(mimeType = 'image/png'): Promise<Blob> {
    return createImageBitmap(this.imageFile()!)
      .then((bitmap) => applyFilterOffscreen(bitmap, this.filter!))
      .then((imageData) => createImageBitmap(imageData))
      .then((bitmap) => {
        const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
        let ctx = offscreen.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return offscreen.convertToBlob({type: mimeType});
    });
  }

  async downloadImageFromCanvas(filename = 'scuba-fix.png', mimeType = 'image/png') {
    const blob = await this.applyFilterToImageAndBlobify(mimeType);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up the URL object
  }

  
  scaleImageToCanvas(bitmap: ImageBitmap) {
    let area = {width: 500, height: 500};
    // The width-over-height aspect ratio.
    let bitmapAspectRatio = bitmap.width / bitmap.height;

    // scale down width
    let scaledWidth = Math.min(area.width, bitmap.width);
    // scale down height
    let scaledHeight = scaledWidth / bitmapAspectRatio;
    // If height is still too large, then scale down by that instead:
    if (scaledHeight > area.height) {
        console.log("Width scaling resulted in too tall of an image, let's retry with height.");
        scaledHeight = area.height;
        scaledWidth = bitmapAspectRatio * scaledHeight;
    }

    console.log(`Original size [${bitmap.width}, ${bitmap.height}] Aspect Ratio ${bitmapAspectRatio}, Scaled size [${scaledWidth}, ${scaledHeight}]`);

    return {width: scaledWidth, height: scaledHeight};
}

  drawImageOnCanvas(bitmap: ImageBitmap, canvas: HTMLCanvasElement) {
      let scale = this.scaleImageToCanvas(bitmap);
      let ctx = canvas.getContext('2d')!;

      // Manually scale the output canvas.
      canvas.height = scale.height;
      canvas.width = scale.width;

      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scale.width, scale.height);
  }

  private handleWorkerResponse(result: WorkResult) {
    // First we must figure out what kind of function we're a result for.
    switch (result.type) {
      case WorkType.CreateFilter:
        // Now handle all resultant types.
        switch (result.result) {
          case CreateFilterResults.Success:
            this.filter = result.filter;
            console.log(`filter: ${JSON.stringify(this.filter)}`);
            
            createImageBitmap(this.imageFile()!).then((bitmap) => {
              this.worker!.postMessage({
                type: WorkType.ApplyFilter,
                bitmap: bitmap,
                filter: JSON.stringify(result.filter),
              } as ApplyFilterRequest, [bitmap]);
            });
            break;
        }
        break;
      case WorkType.ApplyFilter:
        switch (result.result) {
          case ApplyFilterResults.Success:
            createImageBitmap(result.imageData).then((bitmap) => {
              this.filteredBitmap = bitmap;
              this.drawImageOnCanvas(bitmap, this.outputCanvas.nativeElement);
            });
            break;
        }
        break;
      default:
        throw new Error(`oh my god oh god no: ${JSON.stringify(result)}`)
    }
  }


}

function createImageDataFromBitmap(bitmap: ImageBitmap): ImageData {
  // Let's convert this to data via an offscreen canvas.
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  let ctx = offscreen.getContext("2d")!;
  // bitmap -> draw onto offscreen canvas
  ctx.drawImage(bitmap, 0, 0);
  // read out imageData from bitmap
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function applyFilterOffscreen(bitmap: ImageBitmap, filter: Filter) {
  const imageData = createImageDataFromBitmap(bitmap);
  const workingImageData = new Uint8ClampedArray(imageData.data);
  const baseImageData = imageData.data;
  // apply filter over imageData
  for (let i = 0; i < baseImageData.length; i += 4) {
      workingImageData[i] = Math.min(255, Math.max(0, baseImageData[i] * filter.red.r + 
                                                      baseImageData[i+1] * filter.red.g +
                                                      baseImageData[i+2] * filter.red.b +
                                                      filter.red.offset * 255)); // RED
      workingImageData[i + 1] = Math.min(255, Math.max(0, baseImageData[i+1] * filter.green.g + filter.green.offset * 255)); // GREEN
      workingImageData[i + 2] = Math.min(255, Math.max(0, baseImageData[i+2] * filter.blue.b + filter.blue.offset * 255)); // Blue
  }
  // console.log(workingImageData);
  const newImage = new ImageData(workingImageData, imageData.width, imageData.height);
  return newImage;
}