import { Component, signal, ViewChild, ElementRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';

export interface Image {
  originalFile: File;
  dataURL: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    NgTemplateOutlet,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  images: Image[] = [];
  selectedIndex: number = -1;

  // Use @ViewChild to get a reference to the hidden file input element in the template.
  // 'fileInput' matches the local template variable #fileInput in the HTML.
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;


  file = signal<File|undefined>(undefined)

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
}

