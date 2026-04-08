import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MediaService, MediaItem } from '../../services/media.service';
import { AccountStateService } from '../../services/account-state.service';
import { LoggerService } from '../../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

export interface MediaChooserDialogData {
  /** Allow multiple selection */
  multiple?: boolean;
  /** Filter by media type: 'images', 'videos', 'files', or 'all' */
  mediaType?: 'images' | 'videos' | 'files' | 'all';
  /** How encrypted library items should be handled when selected */
  encryptedSelectionBehavior?: 'keep-encrypted' | 'decrypt-and-queue' | 'decrypt-and-reupload';
}

export interface MediaChooserSelectedItem extends MediaItem {
  localFile?: File;
  uploadOriginal?: boolean;
}

export interface MediaChooserResult {
  /** Selected media items */
  items: MediaChooserSelectedItem[];
}

interface MediaChooserDisplayItem extends MediaItem {
  displayUrl?: string;
  encrypted?: boolean;
}

@Component({
  selector: 'app-media-chooser-dialog',
  imports: [
    FormsModule,
    MaterialCustomDialogComponent,
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
  private readonly dialogRef = inject(MatDialogRef<MediaChooserDialogComponent, MediaChooserResult>, { optional: true });
  readonly data = inject<MediaChooserDialogData | null>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  private readonly mediaService = inject(MediaService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);

  // View state
  activeTab = signal<'images' | 'videos' | 'files'>('images');
  selectedItems = signal<Set<string>>(new Set());
  searchQuery = signal('');
  isLoading = signal(false);
  isConfirming = signal(false);
  mediaDisplayUrls = signal<Map<string, string>>(new Map());
  encryptedMediaMap = signal<Map<string, true>>(new Map());

  displayMedia = computed<MediaChooserDisplayItem[]>(() => {
    const allMedia = this.mediaService.mediaItems();
    const displayUrls = this.mediaDisplayUrls();
    const encryptedMedia = this.encryptedMediaMap();

    return allMedia.map(item => ({
      ...item,
      displayUrl: displayUrls.get(item.sha256),
      encrypted: encryptedMedia.has(item.sha256),
    }));
  });

  // Computed media lists
  images = computed(() => {
    const allMedia = this.displayMedia();
    const query = this.searchQuery().toLowerCase();
    return allMedia
      .filter(item => item.type?.startsWith('image') || false)
      .filter(item => !query || this.getFileName(item.url).toLowerCase().includes(query))
      .sort((a, b) => b.uploaded - a.uploaded);
  });

  videos = computed(() => {
    const allMedia = this.displayMedia();
    const query = this.searchQuery().toLowerCase();
    return allMedia
      .filter(item => item.type?.startsWith('video') || false)
      .filter(item => !query || this.getFileName(item.url).toLowerCase().includes(query))
      .sort((a, b) => b.uploaded - a.uploaded);
  });

  files = computed(() => {
    const allMedia = this.displayMedia();
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

    effect(() => {
      const items = this.mediaService.mediaItems();
      void this.hydrateEncryptedMedia(items);
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
      void this.confirm([item]);
      return;
    }
    this.toggleItemSelection(item);
  }

  onSpaceKey(event: Event, item: MediaItem): void {
    event.preventDefault();
    this.selectItem(item);
  }

  onEnterKey(event: Event, item: MediaItem): void {
    event.preventDefault();
    if (!this.allowMultiple()) {
      // Single selection mode - immediately confirm
      this.selectItem(item);
    } else {
      // Multi-select: select the item if not already selected, then confirm
      if (!this.isSelected(item.sha256)) {
        this.toggleItemSelection(item);
      }
      this.confirm();
    }
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

  getItemSourceUrl(item: MediaChooserDisplayItem): string {
    return item.displayUrl || item.url;
  }

  isEncrypted(item: MediaChooserDisplayItem): boolean {
    return item.encrypted || false;
  }

  hasRenderablePreview(item: MediaChooserDisplayItem): boolean {
    if (!this.isEncrypted(item)) {
      return true;
    }

    return this.getItemSourceUrl(item) !== item.url;
  }

  async confirm(preselectedItems?: MediaItem[]): Promise<void> {
    const selectedItems = preselectedItems || this.getSelectedItems();
    if (selectedItems.length === 0 || this.isConfirming()) {
      return;
    }

    this.isConfirming.set(true);

    try {
      const resolvedItems = await this.resolveSelectedItems(selectedItems);
      this.dialogRef?.close({ items: resolvedItems });
    } catch (error) {
      this.logger.error('Failed to process selected media items', error);
      this.snackBar.open(
        error instanceof Error ? error.message : 'Failed to process selected media items',
        'Close',
        { duration: 5000 }
      );
    } finally {
      this.isConfirming.set(false);
    }
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

  private async resolveSelectedItems(items: MediaItem[]): Promise<MediaChooserSelectedItem[]> {
    const behavior = this.data?.encryptedSelectionBehavior || 'decrypt-and-reupload';

    if (behavior === 'keep-encrypted') {
      return items;
    }

    return await Promise.all(items.map(item => this.resolveSelectedItem(item)));
  }

  private async resolveSelectedItem(item: MediaItem): Promise<MediaChooserSelectedItem> {
    const decryptedMedia = await this.mediaService.getDecryptedMediaFile(item);
    if (!decryptedMedia) {
      return item;
    }

    if (this.data?.encryptedSelectionBehavior === 'decrypt-and-queue') {
      return {
        ...item,
        type: decryptedMedia.file.type || item.type,
        size: decryptedMedia.file.size,
        localFile: decryptedMedia.file,
        uploadOriginal: true,
      };
    }

    const uploadResult = await this.mediaService.uploadFile(
      decryptedMedia.file,
      false,
      this.mediaService.mediaServers()
    );

    if (!uploadResult.item || uploadResult.status === 'error') {
      throw new Error(uploadResult.message || 'Failed to upload decrypted media');
    }

    return uploadResult.item;
  }

  private async hydrateEncryptedMedia(items: MediaItem[]): Promise<void> {
    if (items.length === 0) {
      this.encryptedMediaMap.set(new Map());
      this.mediaDisplayUrls.set(new Map());
      return;
    }

    try {
      const encryptedReferences = await this.mediaService.getEncryptedMediaReferences();
      const encryptedMap = new Map<string, true>();
      const displayUrls = new Map<string, string>();

      await Promise.all(items.map(async item => {
        if (!encryptedReferences.has(item.sha256)) {
          return;
        }

        encryptedMap.set(item.sha256, true);

        try {
          const resolvedUrl = await this.mediaService.getResolvedMediaUrl(item, true);
          if (resolvedUrl) {
            displayUrls.set(item.sha256, resolvedUrl);
          }
        } catch (error) {
          this.logger.warn(`Failed to hydrate encrypted media preview for ${item.sha256}`, error);
        }
      }));

      this.encryptedMediaMap.set(encryptedMap);
      this.mediaDisplayUrls.set(displayUrls);
    } catch (error) {
      this.logger.warn('Failed to load encrypted media references in chooser', error);
      this.encryptedMediaMap.set(new Map());
      this.mediaDisplayUrls.set(new Map());
    }
  }
}
