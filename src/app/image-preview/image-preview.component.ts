import { Component, input, ViewChild, ElementRef } from '@angular/core';

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

  ngAfterViewInit(): void {
    this.ctx = this.outputCanvas.nativeElement.getContext('2d')!;
    this.drawImageOnCanvas();

    // Calculate the filter.
    // TODO: Make service to calculate a filter offscreen.
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

  async drawImageOnCanvas() {
      this.bitmap = await createImageBitmap(this.imageFile()!);
      let scale = this.scaleImageToCanvas(this.bitmap);

      // Manually scale the output canvas.
      this.outputCanvas.nativeElement.height = scale.height;
      this.outputCanvas.nativeElement.width = scale.width;

      this.ctx.drawImage(this.bitmap, 0, 0, this.bitmap.width, this.bitmap.height, 0, 0, scale.width, scale.height);
}
  
}
