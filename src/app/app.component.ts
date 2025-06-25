import { Component, signal, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { JsonPipe, NgTemplateOutlet } from '@angular/common';

import {
  CreateFilterReqeuest,
  CreateFilterResults,
  Filter,
  WorkType,
  WorkResult,
  ApplyFilterResults,
  ApplyFilterRequest,
} from './image-preview-worker-types';

export interface Image {
  id: string;
  originalFile: File;
  processedImageData: ImageData;
  dataURL: string;
  processedImageURL: string;
  filter?: Filter;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    NgTemplateOutlet,
    JsonPipe
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  images: Image[] = [];
  selectedIndex: number = -1;
  private worker?: Worker = undefined;

  // Use @ViewChild to get a reference to the hidden file input element in the template.
  // 'fileInput' matches the local template variable #fileInput in the HTML.
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;


  file = signal<File|undefined>(undefined)

  ngAfterViewInit(): void {
    // Initialize our worker.
    if (typeof Worker !== 'undefined') {
      // Create a new
      this.worker = new Worker(new URL('./image-preview.worker', import.meta.url));
      this.worker.onmessage = ({ data }) => {
        this.handleWorkerResponse(data);
      };
    } else {
      // Web workers are not supported in this environment.
      // You should add a fallback so that your program still executes correctly.
    }
  }

  getImage(id: string): Image {
    const i =  this.images.find((el) => el.id === id);
    if (!i) {
      throw Error("kaboom");
    }
    return i;
  }

  saveFile(file: File) {
    console.log(`saving file: ${file.name}`)
    this.reset();
    this.file.set(file);
  }

  reset() {
    this.file.set(undefined);
  }

  selectImage(index: number) {
    this.selectedIndex = index;
    const img = this.images[this.selectedIndex];
  }

  downloadSelectedImage() {
    const link = document.createElement('a');
    const selectedImage = this.images[this.selectedIndex];
    if (!selectedImage) return;
    link.href = selectedImage.dataURL;
    link.download = selectedImage.originalFile.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  processSelectedImage() {
    const img = this.images[this.selectedIndex];
    createImageBitmap(img.originalFile).then((bitmap) => {
      this.worker!.postMessage({
          type: WorkType.CreateFilter,
          id: img.id,
          bitmap,
      } as CreateFilterReqeuest, [bitmap]);
    });
  }

  applyFilter() {
    const img = this.images[this.selectedIndex];
    createImageBitmap(img.originalFile).then((bitmap) => {
      this.worker!.postMessage({
        type: WorkType.ApplyFilter,
        bitmap: bitmap,
        filter: JSON.stringify(img.filter),
        id: img.id,
      } as ApplyFilterRequest, [bitmap]);
    });
  }

  /**
   * Removes an image from a specified slot by setting its value back to null.
   * @param index The index of the image slot to clear.
   */
  removeImage(index: number): void {
    // Ensure the index is within the valid bounds of the images array.
    if (index >= 0 && index < this.images.length) {
      this.images.splice(index, 1);
    }
    if (this.selectedIndex === index) {
      this.selectedIndex = -1;
    }
  }

  /**
   * Programmatically triggers a click on the hidden file input element.
   * This allows the user to click on the visually distinct dotted box to open the file dialog.
   */
  triggerFileInput(): void {
    // Check if the fileInput ElementRef and its nativeElement exist before clicking.
    if (this.fileInput && this.fileInput.nativeElement) {
      this.fileInput.nativeElement.click();
    }
  }

  /**
   * Handles the file selection event when a user chooses an image.
   * Reads the selected file as a Data URL and displays it in the next available slot.
   * @param event The DOM event object from the file input change.
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      // Create a FileReader to asynchronously read the file content.
      const reader = new FileReader();

      reader.onload = (e: ProgressEvent<FileReader>) => {
        const image = {
          id: `${Date.now()}_image`,
          originalFile: file,
          dataURL: e.target?.result,
        } as Image;
        this.images.push(image);
        this.selectedIndex = this.images.length - 1;
      };
      // Start reading the file as a Data URL (base64 encoded string), which is suitable for `src` attributes.
      reader.readAsDataURL(file);
    }
  }


  private async handleWorkerResponse(result: WorkResult) {
    // First we must figure out what kind of function we're a result for.
    switch (result.type) {
      case WorkType.CreateFilter:
        // Now handle all resultant types.
        switch (result.result) {
          case CreateFilterResults.Success:
            const img = this.getImage(result.id);
            img.filter = result.filter;
            // this.filter = result.filter;
            console.log(`image ${img.id} updated with filter ${img.filter}`);
            // createImageBitmap(this.imageFile()!).then((bitmap) => {
            //   this.worker!.postMessage({
            //     type: WorkType.ApplyFilter,
            //     bitmap: bitmap,
            //     filter: JSON.stringify(result.filter),
            //   } as ApplyFilterRequest, [bitmap]);
            // });
            break;
        }
        break;
      case WorkType.ApplyFilter:
        switch (result.result) {
          case ApplyFilterResults.Success:
            const img = this.getImage(result.id);
            img.processedImageData = result.imageData;

            const blob = await blobifyImageData(img.processedImageData);
            const url = URL.createObjectURL(blob);
            img.processedImageURL = url;
            // const link = document.createElement('a');
            // link.href = url;
            // link.download = filename;
            // document.body.appendChild(link);
            // link.click();
            // document.body.removeChild(link);
            // URL.revokeObjectURL(url); // Clean up the URL object

            // createImageBitmap(img.processedImageData).then((bitmap) => {
            //   this.drawImageOnCanvas(bitmap, this.outputCanvas.nativeElement);
            // });
            break;
        }
        break;
      default:
        throw new Error(`oh my god oh god no: ${JSON.stringify(result)}`)
    }
  }

  // dragStart(e: MouseEvent) {
  //   console.log(e);
  //   let src = e.target;
  //   console.log(src);
  // }
}

function blobifyImageData(imageData: ImageData, mimeType = 'image/png'): Promise<Blob> {
  return createImageBitmap(imageData)
    .then((bitmap) => {
      const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
      let ctx = offscreen.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return offscreen.convertToBlob({type: mimeType});
  });
}

