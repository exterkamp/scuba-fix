import { Component, ElementRef, inject, output, viewChild } from '@angular/core';
import { ImageLibrary } from '../image-library.service';

/** Horizontal strip of loaded images, plus an "add images" button. */
@Component({
  selector: 'app-image-tray',
  templateUrl: './image-tray.component.html',
  styleUrl: './image-tray.component.css',
})
export class ImageTrayComponent {
  protected readonly library = inject(ImageLibrary);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /** Emitted with the number of non-image files that were ignored. */
  readonly skipped = output<number>();

  openPicker() {
    this.fileInput().nativeElement.click();
  }

  protected onFilesChosen(input: HTMLInputElement) {
    if (input.files?.length) {
      const skipped = this.library.add(input.files);
      if (skipped) this.skipped.emit(skipped);
    }
    // Allow choosing the same file again.
    input.value = '';
  }
}
