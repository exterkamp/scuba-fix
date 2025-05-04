import { Component, output, OutputEmitterRef } from '@angular/core';
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

  fileChanged(event: Event) {
    const file = (event.target as HTMLInputElement).files?.item(0); // Here we use only the first file (single file)
    if (!!file) {
      // Now we can throw this up to the app.
      this.fileUploaded.emit(file);
    }
  }
}
