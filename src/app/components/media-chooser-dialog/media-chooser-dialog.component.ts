import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { MediaService, MediaItem } from '../../services/media.service';
import { AccountStateService } from '../../services/account-state.service';

export interface MediaChooserDialogData {
  /** Allow multiple selection */
  multiple?: boolean;
  /** Filter by media type: 'images', 'videos', 'files', or 'all' */
  mediaType?: 'images' | 'videos' | 'files' | 'all';
}

export interface MediaChooserResult {
  /** Selected media items */
  items: MediaItem[];
}

@Component({
  selector: 'app-media-chooser-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  templateUrl: './media-chooser-dialog.component.html',
  styleUrl: './media-chooser-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaChooserDialogComponent {
  dialogRef?: CustomDialogRef<MediaChooserDialogComponent, MediaChooserResult>;
  data: MediaChooserDialogData = {};

  private readonly mediaService = inject(MediaService);
  private readonly accountState = inject(AccountStateService);

  // View state
  activeTab = signal<'images' | 'videos' | 'files'>('images');
  selectedItems = signal<Set<string>>(new Set());
  searchQuery = signal('');
  isLoading = signal(false);

  // Computed media lists
  images = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    const query = this.searchQuery().toLowerCase();
    return allMedia
      .filter(item => item.type?.startsWith('image') || false)
      .filter(item => !query || this.getFileName(item.url).toLowerCase().includes(query))
      .sort((a, b) => b.uploaded - a.uploaded);
  });

  videos = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    const query = this.searchQuery().toLowerCase();
    return allMedia
      .filter(item => item.type?.startsWith('video') || false)
      .filter(item => !query || this.getFileName(item.url).toLowerCase().includes(query))
      .sort((a, b) => b.uploaded - a.uploaded);
  });

  files = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    const query = this.searchQuery().toLowerCase();
    return allMedia
      .filter(item => !item.type || (!item.type.startsWith('image') && !item.type.startsWith('video')))
      .filter(item => !query || this.getFileName(item.url).toLowerCase().includes(query))
      .sort((a, b) => b.uploaded - a.uploaded);
  });

  // Check if any items are selected
  hasSelection = computed(() => this.selectedItems().size > 0);

  // Get selected items count
  selectionCount = computed(() => this.selectedItems().size);

  // Check if multiple selection is allowed
  allowMultiple = computed(() => this.data?.multiple ?? true);

  // Check if media service is loading
  isMediaServiceLoading = computed(() => this.mediaService.loading());

  constructor() {
    // Load media when account is initialized
    effect(async () => {
      if (this.accountState.initialized()) {
        this.isLoading.set(true);
        try {
          await this.mediaService.loadMedia();
        } finally {
          this.isLoading.set(false);
        }
      }
    });

    // Set initial tab based on mediaType filter
    effect(() => {
      const mediaType = this.data?.mediaType;
      if (mediaType === 'images') {
        this.activeTab.set('images');
      } else if (mediaType === 'videos') {
        this.activeTab.set('videos');
      } else if (mediaType === 'files') {
        this.activeTab.set('files');
      }
    });
  }

  setActiveTab(tab: 'images' | 'videos' | 'files'): void {
    this.activeTab.set(tab);
  }

  getTabIndex(): number {
    switch (this.activeTab()) {
      case 'images': return 0;
      case 'videos': return 1;
      case 'files': return 2;
      default: return 0;
    }
  }

  onTabChange(index: number): void {
    switch (index) {
      case 0: this.activeTab.set('images'); break;
      case 1: this.activeTab.set('videos'); break;
      case 2: this.activeTab.set('files'); break;
    }
  }

  isSelected(sha256: string): boolean {
    return this.selectedItems().has(sha256);
  }

  toggleItemSelection(item: MediaItem): void {
    const selected = new Set(this.selectedItems());

    if (selected.has(item.sha256)) {
      selected.delete(item.sha256);
    } else {
      if (!this.allowMultiple()) {
        // Single selection mode - clear previous selection
        selected.clear();
      }
      selected.add(item.sha256);
    }

    this.selectedItems.set(selected);
  }

  selectItem(item: MediaItem): void {
    if (!this.allowMultiple()) {
      // Single selection mode - immediately confirm
      this.dialogRef?.close({ items: [item] });
      return;
    }
    this.toggleItemSelection(item);
  }

  getFileName(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || url;
    } catch {
      return url;
    }
  }

  formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getSelectedItems(): MediaItem[] {
    const selectedSet = this.selectedItems();
    const allMedia = this.mediaService.mediaItems();
    return allMedia.filter(item => selectedSet.has(item.sha256));
  }

  confirm(): void {
    const selectedItems = this.getSelectedItems();
    this.dialogRef?.close({ items: selectedItems });
  }

  cancel(): void {
    this.dialogRef?.close({ items: [] });
  }

  async refreshMedia(): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.mediaService.loadMedia();
    } finally {
      this.isLoading.set(false);
    }
  }
}
