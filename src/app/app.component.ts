import { Component, inject, signal, viewChild } from '@angular/core';
import { ImageLibrary } from './image-library.service';
import { ImagePreviewComponent } from './image-preview/image-preview.component';
import { ImageTrayComponent } from './image-tray/image-tray.component';

@Component({
  selector: 'app-root',
  imports: [ImagePreviewComponent, ImageTrayComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  host: {
    '(window:dragenter)': 'onDragEnter($event)',
    '(window:dragover)': 'onDragOver($event)',
    '(window:dragleave)': 'onDragLeave($event)',
    '(window:drop)': 'onDrop($event)',
    '(document:paste)': 'onPaste($event)',
  },
})
export class AppComponent {
  protected readonly library = inject(ImageLibrary);
  private readonly tray = viewChild.required(ImageTrayComponent);

  protected readonly dragging = signal(false);
  protected readonly notice = signal<string | null>(null);
  private dragDepth = 0;
  private noticeTimer?: ReturnType<typeof setTimeout>;

  protected openPicker() {
    this.tray().openPicker();
  }

  protected addFiles(files: Iterable<File>) {
    const list = [...files];
    if (!list.length) return;
    this.showSkipped(this.library.add(list));
  }

  protected showSkipped(count: number) {
    if (!count) return;
    this.notice.set(count === 1 ? 'Skipped 1 file that isn’t an image.' : `Skipped ${count} files that aren’t images.`);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), 5000);
  }

  // --- Drag and drop anywhere on the page ---

  protected onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  protected onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging.set(false);
  }

  protected onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    this.addFiles(e.dataTransfer!.files);
  }

  protected onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files?.length) {
      e.preventDefault();
      this.addFiles(files);
    }
  }
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes('Files');
}
