import { Component, output, OutputEmitterRef, ViewChild, ElementRef } from '@angular/core';
import {FormControl, ReactiveFormsModule} from '@angular/forms';

@Component({
  selector: 'app-import-image-prompt',
  imports: [
    ReactiveFormsModule,
  ],
  templateUrl: './import-image-prompt.component.html',
  styleUrl: './import-image-prompt.component.scss'
})
export class ImportImagePromptComponent {
  fileCtrl = new FormControl('');

  fileUploaded: OutputEmitterRef<File> = output();

  async selectImage(index: number) {
    console.log('select image', index);
    let imageBlobURL = this.images[index];
    if (imageBlobURL) {
      // Now we can throw this up to the app.
      let blob = await fetch(imageBlobURL).then(r => r.blob());
      this.fileUploaded.emit(new File([blob], `file_${self.crypto.randomUUID()}`));
    }
  }

  // Use @ViewChild to get a reference to the hidden file input element in the template.
  // 'fileInput' matches the local template variable #fileInput in the HTML.
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // Array to hold the URLs of the uploaded images.
  // We initialize it with nulls to represent empty slots.
  images: (string | null)[] = [];

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
        this.images.push(e.target?.result as string);
      };
      // Start reading the file as a Data URL (base64 encoded string), which is suitable for `src` attributes.
      reader.readAsDataURL(file);
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
   * Removes an image from a specified slot by setting its value back to null.
   * @param index The index of the image slot to clear.
   */
  removeImage(index: number): void {
    // Ensure the index is within the valid bounds of the images array.
    if (index >= 0 && index < this.images.length) {
      this.images.splice(index, 1);
    }
  }
}
