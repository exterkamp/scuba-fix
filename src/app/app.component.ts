import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {ImportImagePromptComponent} from './import-image-prompt/import-image-prompt.component';
import { ImagePreviewComponent } from './image-preview/image-preview.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    ImportImagePromptComponent,
    ImagePreviewComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  file = signal<File|undefined>(undefined)

  saveFile(file: File) {
    console.log(`saving file: ${file.name}`)
    this.reset();
    this.file.set(file);
  }

  reset() {
    this.file.set(undefined);
  }
}
