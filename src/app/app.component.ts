import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {ImportImagePromptComponent} from './import-image-prompt/import-image-prompt.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    ImportImagePromptComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  file = signal<File|undefined>(undefined)

  saveFile(file: File) {
    this.file.set(file);
    console.log(this.file());
  }
}
