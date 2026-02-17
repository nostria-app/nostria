import { Component, inject, signal, effect, computed, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  MatDialogModule,
  MatDialog,
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Router, ActivatedRoute } from '@angular/router';
import { MediaService, MediaItem } from '../../services/media.service';
import { MediaUploadDialogComponent } from './media-upload-dialog/media-upload-dialog.component';
import { MediaServersSettingsDialogComponent } from './media-servers-settings-dialog/media-servers-settings-dialog.component';
import { ApplicationStateService } from '../../services/application-state.service';
import { NostrService } from '../../services/nostr.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { LocalStorageService } from '../../services/local-storage.service';
import { AccountStateService } from '../../services/account-state.service';
import { LoggerService } from '../../services/logger.service';
import { MediaPublishDialogComponent, MediaPublishOptions } from './media-publish-dialog/media-publish-dialog.component';
import { PublishService } from '../../services/publish.service';
import { nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { CustomDialogService } from '../../services/custom-dialog.service';

export type ViewMode = 'large' | 'medium' | 'details';
export type MediaFilter = 'all' | 'images' | 'videos' | 'audio' | 'files';

@Component({
  selector: 'app-media',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatCheckboxModule,
    TimestampPipe,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss'],
})
export class MediaComponent {
  mediaService = inject(MediaService);
  nostr = inject(NostrService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);
  private readonly publishService = inject(PublishService);
  private readonly twoColumnLayout = inject(TwoColumnLayoutService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly customDialog = inject(CustomDialogService);
  private readonly destroyRef = inject(DestroyRef);

  // View state
  viewMode = signal<ViewMode>('medium');
  mediaFilter = signal<MediaFilter>('all');
  selectedItems = signal<string[]>([]);
  selectionMode = signal(false);

  // Long press tracking
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;

  // Sort options
  sortOption = signal<'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc'>('newest');

  // Computed filtered and sorted media list
  filteredMedia = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    const filter = this.mediaFilter();

    let filtered: MediaItem[];
    switch (filter) {
      case 'images':
        filtered = allMedia.filter(item => item.type?.startsWith('image') || false);
        break;
      case 'videos':
        filtered = allMedia.filter(item => item.type?.startsWith('video') || false);
        break;
      case 'audio':
        filtered = allMedia.filter(item => item.type?.startsWith('audio') || false);
        break;
      case 'files':
        filtered = allMedia.filter(item => !item.type || (!item.type.startsWith('image') && !item.type.startsWith('video') && !item.type.startsWith('audio')));
        break;
      default:
        filtered = allMedia;
    }

    return this.sortMediaItems(filtered);
  });

  // Computed total storage used
  totalStorageBytes = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    return allMedia.reduce((total, item) => total + (item.size || 0), 0);
  });

  // Table columns for details view
  displayedColumns: string[] = ['select', 'name', 'mirrors', 'type', 'size', 'uploaded', 'actions'];

  constructor() {
    this.twoColumnLayout.setWideLeft();

    // Restore view mode from localStorage
    const savedViewMode = this.localStorage.getItem(this.appState.MEDIA_VIEW_MODE);
    if (savedViewMode && ['large', 'medium', 'details'].includes(savedViewMode)) {
      this.viewMode.set(savedViewMode as ViewMode);
    }

    // Restore filter from localStorage
    const savedFilter = this.localStorage.getItem(this.appState.MEDIA_FILTER);
    if (savedFilter && ['all', 'images', 'videos', 'audio', 'files'].includes(savedFilter)) {
      this.mediaFilter.set(savedFilter as MediaFilter);
    }

    effect(async () => {
      if (this.accountState.initialized()) {
        await this.mediaService.loadMedia();
      }
    });

    // Clear selection when filter changes
    effect(() => {
      this.mediaFilter(); // Track the filter
      this.selectedItems.set([]);
      this.selectionMode.set(false);
    });

    // Check for upload query parameter
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const uploadParam = params.get('upload');
      const filterParam = params.get('filter');

      if (filterParam && ['all', 'images', 'videos', 'audio', 'files'].includes(filterParam)) {
        this.mediaFilter.set(filterParam as MediaFilter);
      }

      if (uploadParam === 'true') {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });

        setTimeout(() => {
          this.openUploadDialog();
        }, 100);
      }
    });
  }

  layout = inject(LayoutService);

  // View mode methods
  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    this.localStorage.setItem(this.appState.MEDIA_VIEW_MODE, mode);
  }

  cycleViewMode(): void {
    const modes: ViewMode[] = ['large', 'medium', 'details'];
    const currentIndex = modes.indexOf(this.viewMode());
    const nextIndex = (currentIndex + 1) % modes.length;
    this.setViewMode(modes[nextIndex]);
  }

  getViewModeIcon(): string {
    switch (this.viewMode()) {
      case 'large': return 'view_module';
      case 'medium': return 'grid_view';
      case 'details': return 'view_list';
      default: return 'grid_view';
    }
  }

  getViewModeLabel(): string {
    switch (this.viewMode()) {
      case 'large': return 'Large';
      case 'medium': return 'Medium';
      case 'details': return 'Details';
      default: return 'View';
    }
  }

  // Filter methods
  setMediaFilter(filter: MediaFilter): void {
    this.mediaFilter.set(filter);
    this.localStorage.setItem(this.appState.MEDIA_FILTER, filter);
  }

  getFilterLabel(): string {
    switch (this.mediaFilter()) {
      case 'all': return 'All Files';
      case 'images': return 'Images';
      case 'videos': return 'Videos';
      case 'audio': return 'Audio';
      case 'files': return 'Other Files';
      default: return 'All Files';
    }
  }

  getFilterIcon(): string {
    switch (this.mediaFilter()) {
      case 'images': return 'image';
      case 'videos': return 'videocam';
      case 'audio': return 'audiotrack';
      case 'files': return 'insert_drive_file';
      default: return 'filter_list';
    }
  }

  // Selection methods
  onItemPointerDown(event: PointerEvent, sha256: string): void {
    // Only handle primary button (left click / touch)
    if (event.button !== 0) return;

    this.longPressTriggered = false;

    // Start long press timer for touch/mouse
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      this.enterSelectionMode(sha256);
    }, 500); // 500ms for long press
  }

  onItemPointerUp(event: PointerEvent): void {
    // Clear long press timer
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // If long press was triggered, prevent the click event from firing
    if (this.longPressTriggered) {
      event.preventDefault();
      event.stopPropagation();
    }
    // Selection is now handled by onCardClick, not here
  }

  onItemPointerLeave(): void {
    // Clear long press timer if pointer leaves
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  enterSelectionMode(sha256: string): void {
    this.selectionMode.set(true);
    this.selectedItems.set([sha256]);
  }

  toggleItemSelection(sha256: string): void {
    this.selectedItems.update(items => {
      if (items.includes(sha256)) {
        const newItems = items.filter(item => item !== sha256);
        // Exit selection mode if no items selected
        if (newItems.length === 0) {
          this.selectionMode.set(false);
        }
        return newItems;
      } else {
        return [...items, sha256];
      }
    });
  }

  // Track if checkbox was just clicked to prevent double handling
  private checkboxClicked = false;

  onCheckboxClick(event: Event, sha256: string): void {
    event.stopPropagation();
    event.preventDefault();
    this.checkboxClicked = true;

    if (!this.selectionMode()) {
      this.enterSelectionMode(sha256);
    } else {
      this.toggleItemSelection(sha256);
    }

    // Reset after a short delay
    setTimeout(() => {
      this.checkboxClicked = false;
    }, 100);
  }

  onCardClick(event: Event, item: MediaItem): void {
    // If checkbox was just clicked, ignore this click
    if (this.checkboxClicked) {
      return;
    }

    // If long press was triggered, ignore the click
    if (this.longPressTriggered) {
      return;
    }

    // If in selection mode, toggle selection
    if (this.selectionMode()) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleItemSelection(item.sha256);
      return;
    }

    // Otherwise, navigate to details
    this.localStorage.setItem(this.appState.MEDIA_FILTER, this.mediaFilter());
    this.layout.openMediaDetails(item.sha256);
  }

  selectAll(): void {
    const currentMedia = this.filteredMedia();
    this.selectionMode.set(true);
    this.selectedItems.set(currentMedia.map(item => item.sha256));
  }

  clearSelection(): void {
    this.selectedItems.set([]);
    this.selectionMode.set(false);
  }

  isSelected(sha256: string): boolean {
    return this.selectedItems().includes(sha256);
  }

  // Open dialogs
  openUploadDialog(): void {
    const dialogRef = this.dialog.open(MediaUploadDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result && result.file) {
        try {
          this.mediaService.uploading.set(true);

          const uploadResult = await this.mediaService.uploadFile(
            result.file,
            result.uploadOriginal,
            result.servers
          );

          this.mediaService.uploading.set(false);

          if (uploadResult.status === 'duplicate') {
            this.snackBar.open('This file already exists in your media library.', 'Close', {
              duration: 3000,
            });
          } else if (uploadResult.status === 'success') {
            this.snackBar.open('Media uploaded successfully', 'Close', {
              duration: 3000,
            });
          }
        } catch {
          this.mediaService.uploading.set(false);
          this.snackBar.open('Failed to upload media', 'Close', {
            duration: 3000,
          });
        }
      }
    });
  }

  openServersDialog(): void {
    this.customDialog.open(MediaServersSettingsDialogComponent, {
      title: 'Media Servers',
      width: '550px',
      maxWidth: '95vw',
    });
  }

  dismissError(): void {
    this.mediaService.clearError();
  }

  openDetailsDialog(item: MediaItem): void {
    this.localStorage.setItem(this.appState.MEDIA_FILTER, this.mediaFilter());
    this.layout.openMediaDetails(item.sha256);
  }

  openMediaPreview(event: Event, item: MediaItem): void {
    event.stopPropagation();

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: item.url,
        mediaType: item.type,
        mediaTitle: item.url || 'Media',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  navigateToDetails(event: Event, item: MediaItem): void {
    event.preventDefault();
    event.stopPropagation();

    // Don't navigate if in selection mode
    if (this.selectionMode()) {
      this.toggleItemSelection(item.sha256);
      return;
    }

    this.localStorage.setItem(this.appState.MEDIA_FILTER, this.mediaFilter());
    this.layout.openMediaDetails(item.sha256);
  }

  async deleteSelected(sha256?: string): Promise<void> {
    const itemsToDelete = sha256 ? [sha256] : this.selectedItems();
    const confirmMessage =
      itemsToDelete.length === 1
        ? 'Are you sure you want to delete this item?'
        : `Are you sure you want to delete ${itemsToDelete.length} items?`;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Confirm Delete',
        message: confirmMessage,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        if (
          itemsToDelete.length > 1 &&
          !this.mediaService.batchOperationsTemporarilyDisabledDueToBug
        ) {
          await this.mediaService.deleteFiles(itemsToDelete);
        } else {
          let deletedCount = 0;

          for (const id of itemsToDelete) {
            try {
              await this.mediaService.deleteFile(id);
              deletedCount++;
            } catch (err) {
              this.logger.error(`Failed to delete item ${id}:`, err);
            }
          }

          if (deletedCount === 0 && itemsToDelete.length > 0) {
            throw new Error('Failed to delete any items');
          }
        }

        this.snackBar.open(
          `${itemsToDelete.length} ${itemsToDelete.length === 1 ? 'item' : 'items'} deleted`,
          'Close',
          { duration: 3000 }
        );
        this.clearSelection();
      } catch (error) {
        this.snackBar.open('Failed to delete some items', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  async downloadSelected(sha256?: string): Promise<void> {
    const itemsToDownload = sha256 ? [sha256] : this.selectedItems();

    if (itemsToDownload.length === 0) return;

    try {
      this.snackBar.open(`Starting download of ${itemsToDownload.length} file(s)...`, 'Close', {
        duration: 3000,
      });

      for (const id of itemsToDownload) {
        const item = await this.mediaService.getFileById(id);
        if (item && item.url && this.isBrowser) {
          try {
            const response = await fetch(item.url);
            const blob = await response.blob();

            const filename = this.getFileName(item.url);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (err) {
            this.logger.error(`Failed to download ${item.url}:`, err);
          }
        }
      }

      this.snackBar.open(`Download of ${itemsToDownload.length} file(s) initiated`, 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open('Failed to download some items', 'Close', {
        duration: 3000,
      });
    }
  }

  async mirrorSelected(): Promise<void> {
    const itemsToMirror = this.selectedItems();
    if (itemsToMirror.length === 0) return;

    try {
      const toMirror: MediaItem[] = [];
      const alreadyMirrored: MediaItem[] = [];

      for (const id of itemsToMirror) {
        const item = await this.mediaService.getFileById(id);
        if (item && item.url) {
          if (this.mediaService.isFullyMirrored(item)) {
            alreadyMirrored.push(item);
          } else {
            toMirror.push(item);
          }
        }
      }

      if (toMirror.length > 0) {
        if (!this.mediaService.batchOperationsTemporarilyDisabledDueToBug) {
          await this.mediaService.mirrorFiles(toMirror);
        } else {
          let mirroredCount = 0;

          for (const item of toMirror) {
            try {
              await this.mediaService.mirrorFile(item.sha256, item.url);
              mirroredCount++;
            } catch (err) {
              this.logger.error(`Failed to mirror item ${item.sha256}:`, err);
            }
          }

          if (mirroredCount === 0 && toMirror.length > 0) {
            throw new Error('Failed to mirror any items');
          }
        }
      }

      if (toMirror.length > 0 && alreadyMirrored.length > 0) {
        this.snackBar.open(
          `Mirrored ${toMirror.length} file(s), ${alreadyMirrored.length} already fully mirrored`,
          'Close',
          { duration: 3000 }
        );
      } else if (toMirror.length > 0) {
        this.snackBar.open(`Mirrored ${toMirror.length} file(s) successfully`, 'Close', {
          duration: 3000,
        });
      } else if (alreadyMirrored.length > 0) {
        this.snackBar.open(`All selected files are already fully mirrored`, 'Close', {
          duration: 3000,
        });
      }
    } catch (error) {
      this.snackBar.open('Failed to mirror some items', 'Close', {
        duration: 3000,
      });
    }
  }

  isFullyMirrored(item: MediaItem): boolean {
    return this.mediaService.isFullyMirrored(item);
  }

  async mirrorItem(sha256: string, url: string): Promise<void> {
    const item = await this.mediaService.getFileById(sha256);
    if (item && this.mediaService.isFullyMirrored(item)) {
      this.snackBar.open('Media is already mirrored to all your servers', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      await this.mediaService.mirrorFile(sha256, url);
      this.snackBar.open('Media mirrored successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open('Failed to mirror media', 'Close', { duration: 3000 });
    }
  }

  refreshMedia(): void {
    this.mediaService.getFiles();
  }

  setSortOption(option: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc'): void {
    this.sortOption.set(option);
  }

  private sortMediaItems(items: MediaItem[]): MediaItem[] {
    const sortOption = this.sortOption();

    if (sortOption === 'name-asc' || sortOption === 'name-desc') {
      const itemsWithNames = items.map(item => ({
        item,
        name: this.getFileName(item.url)
      }));

      itemsWithNames.sort((a, b) => {
        return sortOption === 'name-asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      });

      return itemsWithNames.map(x => x.item);
    }

    return [...items].sort((a, b) => {
      switch (sortOption) {
        case 'newest':
          return (b.uploaded || 0) - (a.uploaded || 0);
        case 'oldest':
          return (a.uploaded || 0) - (b.uploaded || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        default:
          return 0;
      }
    });
  }

  getSortLabel(): string {
    switch (this.sortOption()) {
      case 'newest':
        return 'Newest First';
      case 'oldest':
        return 'Oldest First';
      case 'name-asc':
        return 'Name (A-Z)';
      case 'name-desc':
        return 'Name (Z-A)';
      case 'size-asc':
        return 'Size (Small-Large)';
      case 'size-desc':
        return 'Size (Large-Small)';
      default:
        return 'Sort';
    }
  }

  getMediaTypeIcon(type: string): string {
    if (type?.startsWith('image')) return 'image';
    if (type?.startsWith('video')) return 'videocam';
    if (type?.startsWith('audio')) return 'audiotrack';
    return 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFileName(url: string): string {
    if (!url) return 'Unknown';
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1];
  }

  async publishSelected(): Promise<void> {
    const itemsToPublish = this.selectedItems();
    if (itemsToPublish.length === 0) return;

    const firstItem = await this.mediaService.getFileById(itemsToPublish[0]);
    if (!firstItem) {
      this.snackBar.open('Failed to load media item', 'Close', { duration: 3000 });
      return;
    }

    if (itemsToPublish.length > 1) {
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Publish Multiple Items',
          message: `You selected ${itemsToPublish.length} items. Publish them one by one?`,
          confirmText: 'Publish',
          cancelText: 'Cancel',
          confirmColor: 'primary',
        },
      });

      const confirmed = await dialogRef.afterClosed().toPromise();
      if (!confirmed) return;

      let successCount = 0;
      let failCount = 0;
      let lastSuccessfulEventId: string | null = null;

      for (const itemId of itemsToPublish) {
        const item = await this.mediaService.getFileById(itemId);
        if (!item) continue;

        const eventId = await this.publishSingleItemWithoutNavigation(item);
        if (eventId) {
          successCount++;
          lastSuccessfulEventId = eventId;
        } else {
          failCount++;
        }
      }

      if (successCount > 0) {
        this.snackBar.open(
          `Published ${successCount} item(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
          'Close',
          { duration: 5000 }
        );

        if (lastSuccessfulEventId) {
          this.layout.openGenericEvent(lastSuccessfulEventId);
        }
      } else {
        this.snackBar.open('Failed to publish items', 'Close', { duration: 3000 });
      }

      this.clearSelection();
    } else {
      const result = await this.layout.publishSingleItem(firstItem);
      if (result) {
        this.clearSelection();
      }
    }
  }

  async publishSingleItemFromCard(item: MediaItem): Promise<void> {
    await this.layout.publishSingleItem(item);
  }

  private async publishSingleItemWithoutNavigation(item: MediaItem): Promise<string | null> {
    const dialogRef = this.dialog.open(MediaPublishDialogComponent, {
      data: {
        mediaItem: item,
      },
      maxWidth: '650px',
      width: '100%',
      panelClass: 'responsive-dialog',
    });

    const result: MediaPublishOptions | null = await dialogRef.afterClosed().toPromise();

    if (!result) {
      return null;
    }

    try {
      const event = await this.buildMediaEvent(item, result);
      const signedEvent = await this.nostr.signEvent(event);
      const publishResult = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      if (publishResult.success) {
        const neventId = nip19.neventEncode({
          id: signedEvent.id,
          author: signedEvent.pubkey,
          kind: signedEvent.kind,
        });
        return neventId;
      } else {
        return null;
      }
    } catch (error) {
      this.logger.error('Error publishing media:', error);
      return null;
    }
  }

  private async buildMediaEvent(item: MediaItem, options: MediaPublishOptions) {
    const tags: string[][] = [];

    if (options.kind === 1) {
      let content = options.content || '';
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += item.url;

      const imetaTag = ['imeta'];
      imetaTag.push(`url ${item.url}`);
      if (item.type) {
        imetaTag.push(`m ${item.type}`);
      }
      imetaTag.push(`x ${item.sha256}`);
      if (item.size) {
        imetaTag.push(`size ${item.size}`);
      }
      if (options.alt) {
        imetaTag.push(`alt ${options.alt}`);
      }
      if (item.mirrors && item.mirrors.length > 0) {
        item.mirrors.forEach(mirrorUrl => {
          imetaTag.push(`fallback ${mirrorUrl}`);
        });
      }
      tags.push(imetaTag);

      options.hashtags.forEach(tag => {
        tags.push(['t', tag]);
      });

      if (options.contentWarning) {
        tags.push(['content-warning', options.contentWarning]);
      }

      if (options.location) {
        tags.push(['location', options.location]);
      }

      if (options.geohash) {
        tags.push(['g', options.geohash]);
      }

      tags.push(['client', 'nostria']);

      return this.nostr.createEvent(1, content, tags);
    }

    if ((options.kind === 34235 || options.kind === 34236) && options.dTag) {
      tags.push(['d', options.dTag]);
    }

    let thumbnailUrl = options.thumbnailUrl;
    const thumbnailUrls: string[] = [];
    if (options.thumbnailBlob && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      try {
        const thumbnailFile = new File([options.thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
        const uploadResult = await this.mediaService.uploadFile(
          thumbnailFile,
          false,
          this.mediaService.mediaServers()
        );

        if (uploadResult.status === 'success' && uploadResult.item) {
          thumbnailUrl = uploadResult.item.url;

          const allUrls = [uploadResult.item.url];
          if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
            allUrls.push(...uploadResult.item.mirrors);
          }

          const uniqueUrls = [...new Set(allUrls)];
          thumbnailUrls.push(...uniqueUrls);
        }
      } catch (error) {
        this.logger.error('Failed to upload thumbnail during publish:', error);
      }
    } else if (thumbnailUrl) {
      thumbnailUrls.push(thumbnailUrl);
    }

    if (options.title && options.title.trim().length > 0) {
      tags.push(['title', options.title]);
    }

    const imetaTag = ['imeta'];
    imetaTag.push(`url ${item.url}`);

    if (item.type) {
      imetaTag.push(`m ${item.type}`);
    }

    imetaTag.push(`x ${item.sha256}`);

    if (item.size) {
      imetaTag.push(`size ${item.size}`);
    }

    if (options.alt) {
      imetaTag.push(`alt ${options.alt}`);
    }

    if (options.imageDimensions && options.kind === 20) {
      imetaTag.push(`dim ${options.imageDimensions.width}x${options.imageDimensions.height}`);
    }

    if (options.blurhash && options.kind === 20) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    if (thumbnailUrls.length > 0 && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      thumbnailUrls.forEach(url => {
        imetaTag.push(`image ${url}`);
      });

      if (options.thumbnailDimensions) {
        imetaTag.push(`dim ${options.thumbnailDimensions.width}x${options.thumbnailDimensions.height}`);
      }
    }

    if (options.blurhash && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    if (options.duration !== undefined && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`duration ${options.duration}`);
    }

    if (item.mirrors && item.mirrors.length > 0) {
      item.mirrors.forEach(mirrorUrl => {
        imetaTag.push(`fallback ${mirrorUrl}`);
      });
    }

    tags.push(imetaTag);

    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);

    if (options.alt) {
      tags.push(['alt', options.alt]);
    }

    if (options.contentWarning) {
      tags.push(['content-warning', options.contentWarning]);
    }

    options.hashtags.forEach(tag => {
      tags.push(['t', tag]);
    });

    if (options.location) {
      tags.push(['location', options.location]);
    }

    if (options.geohash) {
      tags.push(['g', options.geohash]);
    }

    if ((options.kind === 34235 || options.kind === 34236) && options.origin) {
      const originTag = ['origin', options.origin.platform];
      if (options.origin.externalId) {
        originTag.push(options.origin.externalId);
      }
      if (options.origin.url) {
        originTag.push(options.origin.url);
      }
      tags.push(originTag);
    }

    if (item.type && options.kind === 20) {
      tags.push(['m', item.type]);
    }

    tags.push(['x', item.sha256]);
    tags.push(['client', 'nostria']);

    const event = this.nostr.createEvent(
      options.kind,
      options.content,
      tags
    );

    return event;
  }
}
