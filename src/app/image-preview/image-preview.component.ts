import { Component, input, ViewChild, ElementRef } from '@angular/core';

import {
  CreateImageBitmapRequest,
  CreateFilterReqeuest,
  CreateFilterResults,
  Filter,
  WorkType,
  WorkResult,
  CreateImageBitmapResults,
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
  private ctx!: CanvasRenderingContext2D;

  imageFile = input<File>();

  private bitmap: ImageBitmap | undefined = undefined;
  private imageData: ImageData | undefined = undefined;
  private filter: Filter | undefined = undefined;
  private worker?: Worker = undefined;

  ngAfterViewInit(): void {
    this.ctx = this.outputCanvas.nativeElement.getContext('2d')!;
    // Draw, then initialize our worker, and start processing.
    
    createImageBitmap(this.imageFile()!)
      .then((bitmap) => {
          this.drawImageOnCanvas(bitmap);
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

  drawImageOnCanvas(bitmap: ImageBitmap) {
      let scale = this.scaleImageToCanvas(bitmap);

      // Manually scale the output canvas.
      this.outputCanvas.nativeElement.height = scale.height;
      this.outputCanvas.nativeElement.width = scale.width;

      this.ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, scale.width, scale.height);
  }

  private handleWorkerResponse(result: WorkResult) {
    // First we must figure out what kind of function we're a result for.
    switch (result.type) {
      case WorkType.CreateImageData:
        // Now handle all resultant types.
        switch (result.result) {
          case CreateImageBitmapResults.Success:
            this.setImageData(result.imageData);
            console.log(`We got some image data back: ${this.imageData}`);
            break;
          case CreateImageBitmapResults.Failure:
            throw new Error(`Error: ${result.reason}`);
        }
        break;
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
              this.drawImageOnCanvas(bitmap);
            });
            break;
        }
        break;
      default:
        throw new Error(`oh my god oh god no: ${JSON.stringify(result)}`)
    }
  }

  private setImageData(imageData: ImageData) {
    this.imageData = imageData;
    // And now calculate the filter!
    if (!this.worker) {
      return;
    }
    // this.worker.postMessage({
    //   type: WorkType.CreateFilter,
    //   imageData: this.imageData,
    // } as CreateFilterReqeuest, [this.imageData]);
  }
}
