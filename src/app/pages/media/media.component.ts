import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { MediaService, MediaItem } from '../../services/media.service';
import { MediaUploadDialogComponent } from './media-upload-dialog/media-upload-dialog.component';
import { MediaServerDialogComponent } from './media-server-dialog/media-server-dialog.component';
import { ApplicationStateService } from '../../services/application-state.service';
import { NostrService } from '../../services/nostr.service';
import { standardizedTag } from '../../standardized-tags';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-media',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTabsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTableModule,
    TimestampPipe,
    MatTooltipModule
  ],
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss']
})
export class MediaComponent {
  mediaService = inject(MediaService);
  nostr = inject(NostrService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);

  // View state
  activeTab = signal<'images' | 'videos' | 'files' | 'servers'>('images');
  selectedItems = signal<string[]>([]);

  // Computed media lists
  images = signal<MediaItem[]>([]);
  videos = signal<MediaItem[]>([]);
  files = signal<MediaItem[]>([]);

  // Table columns for files display
  displayedColumns: string[] = ['select', 'name', 'mirrors', 'type', 'size', 'uploaded', 'actions'];

  constructor() {
    // Restore the active tab from localStorage if available
    const savedTab = localStorage.getItem('mediaActiveTab');
    if (savedTab && ['images', 'videos', 'files', 'servers'].includes(savedTab)) {
      this.activeTab.set(savedTab as 'images' | 'videos' | 'files' | 'servers');
    }

    // Update filtered lists whenever media items change
    effect(() => {
      const allMedia = this.mediaService.mediaItems();
      this.images.set(allMedia.filter(item => item.type.startsWith('image')));
      this.videos.set(allMedia.filter(item => item.type.startsWith('video')));
      this.files.set(allMedia.filter(item =>
        !item.type.startsWith('image') && !item.type.startsWith('video')
      ));
    });

    effect(async () => {
      if (this.app.initialized()) {
        console.log('APP INITIALIZED, FETCHING MEDIA SERVERS');
        const userServerList = await this.nostr.getMediaServers(this.nostr.pubkey());
        console.log('USER SERVER LIST', userServerList);

        if (userServerList) {
          const servers = this.nostr.getTags(userServerList, standardizedTag.server);
          this.mediaService.setMediaServers(servers);
        }

        // Fetch the media servers (from cache or relay).
        await this.mediaService.initialize();

        // Only fetch files if it's been more than 10 minutes since last fetch
        const tenMinutesInMs = 10 * 60 * 1000; // 10 minutes in milliseconds
        const currentTime = Date.now();
        const lastFetchTime = this.mediaService.getLastFetchTime();

        if (currentTime - lastFetchTime > tenMinutesInMs) {
          await this.mediaService.getFiles();
        }
      }
    });
  }

  openUploadDialog(): void {
    const dialogRef = this.dialog.open(MediaUploadDialogComponent, {
      width: '500px',
      disableClose: true // Prevent dialog from closing while uploading
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result && result.file) {
        try {
          // Set uploading state to true
          this.mediaService.uploading.set(true);

          debugger;

          // Pass the selected servers to the uploadFile method
          await this.mediaService.uploadFile(result.file, result.uploadOriginal, result.servers);

          // Set the uploading state to false
          this.mediaService.uploading.set(false);

          this.snackBar.open('Media uploaded successfully', 'Close', { duration: 3000 });
        } catch (error) {
          // Set the uploading state to false on error
          this.mediaService.uploading.set(false);

          this.snackBar.open('Failed to upload media', 'Close', { duration: 3000 });
        }
      }
    });
  }

  openServerDialog(server?: string): void {
    const dialogRef = this.dialog.open(MediaServerDialogComponent, {
      width: '500px',
      data: server
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) return;

      try {
        if (server) {
          // Update existing server
          // await this.mediaService.updateMediaServer(result);
          this.snackBar.open('Media server updated', 'Close', { duration: 3000 });
        } else {
          // Add new server
          await this.mediaService.addMediaServer(result);
          this.snackBar.open('Media server added', 'Close', { duration: 3000 });
        }
      } catch (error) {
        this.snackBar.open(
          error instanceof Error ? error.message : 'Failed to save media server',
          'Close',
          { duration: 3000 }
        );
      }
    });
  }

  async removeServer(url: string): Promise<void> {
    if (confirm('Are you sure you want to remove this media server?')) {
      try {
        await this.mediaService.removeMediaServer(url);
        this.snackBar.open('Media server removed', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to remove media server', 'Close', { duration: 3000 });
      }
    }
  }

  async testServer(url: string): Promise<void> {
    try {
      const result = await this.mediaService.testMediaServer(url);
      if (result.success) {
        this.snackBar.open(result.message, 'Close', { duration: 3000 });
      } else {
        this.snackBar.open(`Test failed: ${result.message}`, 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.snackBar.open('Failed to test media server', 'Close', { duration: 3000 });
    }
  }

  editServer(server: string): void {
    this.openServerDialog(server);
  }

  openDetailsDialog(item: MediaItem): void {
    // Save the current active tab before navigating
    localStorage.setItem('mediaActiveTab', this.activeTab());

    // Navigate to details page instead of opening dialog
    this.router.navigate(['/media', 'details', item.sha256]);
  }

  openMediaPreview(event: Event, item: MediaItem): void {
    // Stop event propagation to prevent toggling selection
    event.stopPropagation();

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: item.url,
        mediaType: item.type,
        mediaTitle: item.url || 'Media'
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'media-preview-dialog'
    });
  }

  navigateToDetails(event: Event, item: MediaItem): void {
    // Ensure the event doesn't propagate to parent elements
    event.preventDefault();
    event.stopPropagation();

    // Save the current active tab before navigating
    localStorage.setItem('mediaActiveTab', this.activeTab());

    // Navigate to details page with the item ID
    this.router.navigate(['/media', 'details', item.sha256]);
  }

  toggleItemSelection(sha256: string): void {
    this.selectedItems.update(items => {
      if (items.includes(sha256)) {
        return items.filter(itemSha256 => itemSha256 !== sha256);
      } else {
        return [...items, sha256];
      }
    });
  }

  selectAll(): void {
    const currentMedia = this.activeTab() === 'images' ? this.images() : this.activeTab() === 'videos' ? this.videos() : this.files();
    this.selectedItems.set(currentMedia.map(item => item.sha256));
  }

  clearSelection(): void {
    this.selectedItems.set([]);
  }

  async deleteSelected(sha256?: string): Promise<void> {
    const itemsToDelete = sha256 ? [sha256] : this.selectedItems();
    const confirmMessage = itemsToDelete.length === 1
      ? 'Are you sure you want to delete this item?'
      : `Are you sure you want to delete ${itemsToDelete.length} items?`;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Confirm Delete',
        message: confirmMessage,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        for (const id of itemsToDelete) {
          await this.mediaService.deleteFile(id);
        }
        this.snackBar.open(`${itemsToDelete.length} ${itemsToDelete.length === 1 ? 'item' : 'items'} deleted`, 'Close', { duration: 3000 });
        this.selectedItems.set([]);
      } catch (error) {
        this.snackBar.open('Failed to delete some items', 'Close', { duration: 3000 });
      }
    }
  }

  async mirrorItem(sha256: string, url: string, servers?: string[]): Promise<void> {
    try {
      await this.mediaService.mirrorFile(sha256, url);
      this.snackBar.open('Media mirrored successfully', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to mirror media', 'Close', { duration: 3000 });
    }
  }

  async reportItem(sha256: string): Promise<void> {
    const reason = prompt('Please provide a reason for reporting this media:');
    if (reason) {
      try {
        await this.mediaService.reportFile(sha256, reason);
        this.snackBar.open('Media reported successfully', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to report media', 'Close', { duration: 3000 });
      }
    }
  }

  refreshMedia(): void {
    // This method is called when the user clicks refresh
    // No changes needed here as it should always fetch fresh data
    this.mediaService.getFiles();
  }

  isSelected(sha256: string): boolean {
    return this.selectedItems().includes(sha256);
  }

  setActiveTab(tab: 'images' | 'videos' | 'files' | 'servers'): void {
    this.activeTab.set(tab);
    // Store the selected tab in localStorage
    localStorage.setItem('mediaActiveTab', tab);

    if (tab !== 'servers') {
      this.selectedItems.set([]);
    }
  }

  getMediaTypeIcon(type: string): string {
    return type === 'image' ? 'image' : type === 'video' ? 'videocam' : 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // Helper to get filename from URL
  getFileName(url: string): string {
    if (!url) return 'Unknown';
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1];
  }
}