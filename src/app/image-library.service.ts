import { computed, Injectable, OnDestroy, signal } from '@angular/core';

export interface LibraryImage {
  id: number;
  file: File;
  /** Object URL for thumbnails; revoked when the image is removed. */
  thumbnailUrl: string;
}

/** The set of images the user has loaded, and which one is being edited. */
@Injectable({ providedIn: 'root' })
export class ImageLibrary implements OnDestroy {
  private nextId = 0;
  private readonly _images = signal<readonly LibraryImage[]>([]);
  private readonly _selectedId = signal<number | null>(null);

  readonly images = this._images.asReadonly();
  readonly selectedId = this._selectedId.asReadonly();
  readonly selected = computed(() => this._images().find((i) => i.id === this._selectedId()) ?? null);

  /** Adds image files (non-images are skipped) and selects the first one added. Returns how many were skipped. */
  add(files: Iterable<File>): number {
    const added: LibraryImage[] = [];
    let skipped = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        skipped++;
        continue;
      }
      added.push({ id: this.nextId++, file, thumbnailUrl: URL.createObjectURL(file) });
    }
    if (added.length) {
      this._images.update((list) => [...list, ...added]);
      this._selectedId.set(added[0].id);
    }
    return skipped;
  }

  select(id: number) {
    this._selectedId.set(id);
  }

  remove(id: number) {
    const list = this._images();
    const index = list.findIndex((i) => i.id === id);
    if (index < 0) return;
    URL.revokeObjectURL(list[index].thumbnailUrl);
    const next = list.filter((i) => i.id !== id);
    this._images.set(next);
    if (this._selectedId() === id) {
      // Select the neighbour that slid into this slot, else the previous one.
      this._selectedId.set((next[index] ?? next[index - 1])?.id ?? null);
    }
  }

  ngOnDestroy() {
    for (const img of this._images()) URL.revokeObjectURL(img.thumbnailUrl);
  }
}
