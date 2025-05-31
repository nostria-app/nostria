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
import { Router, ActivatedRoute } from '@angular/router';
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
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { LocalStorageService } from '../../services/local-storage.service';

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
    MatTooltipModule,
    DragDropModule
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
  private route = inject(ActivatedRoute);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  private readonly localStorage = inject(LocalStorageService);

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
    const savedTab = this.localStorage.getItem(this.appState.MEDIA_ACTIVE_TAB);
    if (savedTab && ['images', 'videos', 'files', 'servers'].includes(savedTab)) {
      this.activeTab.set(savedTab as 'images' | 'videos' | 'files' | 'servers');
    }

    // Update filtered lists whenever media items change
    effect(() => {
      const allMedia = this.mediaService.mediaItems();
      this.images.set(allMedia.filter(item => item.type?.startsWith('image') || false));
      this.videos.set(allMedia.filter(item => item.type?.startsWith('video') || false));
      this.files.set(allMedia.filter(item => 
        !item.type || (!item.type.startsWith('image') && !item.type.startsWith('video'))
      ));
    });

    effect(async () => {
      if (this.app.initialized() && this.app.authenticated()) {
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
        const lastFetchTime = this.mediaService.getLastFetchTime();        if (currentTime - lastFetchTime > tenMinutesInMs) {
          await this.mediaService.getFiles();
        }
      }
    });    // Check for upload query parameter and trigger upload dialog
    this.route.queryParamMap.subscribe(params => {
      const uploadParam = params.get('upload');
      if (uploadParam === 'true') {
        // Remove the query parameter from URL without navigation
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true
        });
        
        // Open upload dialog after a small delay to ensure navigation is complete
        setTimeout(() => {
          this.openUploadDialog();
        }, 100);
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

          // Pass the selected servers to the uploadFile method
          const uploadResult = await this.mediaService.uploadFile(result.file, result.uploadOriginal, result.servers);
          
          // Set the uploading state to false
          this.mediaService.uploading.set(false);

          // Handle the result based on status
          if (uploadResult.status === 'duplicate') {
            this.snackBar.open('This file already exists in your media library.', 'Close', { duration: 3000 });
          } else if (uploadResult.status === 'success') {
            this.snackBar.open('Media uploaded successfully', 'Close', { duration: 3000 });
          }
        } catch (error) {
          // Set the uploading state to false on error
          this.mediaService.uploading.set(false);

          this.snackBar.open('Failed to upload media', 'Close', { duration: 3000 });
        }
      }
    });
  }

  dismissError(): void {
    this.mediaService.clearError();
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
          await this.mediaService.updateMediaServer(server, result);
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

  async reorderServers(event: CdkDragDrop<string[]>): Promise<void> {
    // Get current servers
    const currentServers = this.mediaService.mediaServers();
    
    // Skip if index didn't change (item dropped in same position)
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    
    // Create a new array with the updated order
    const newOrder = [...currentServers];
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);
    
    // Check if the order actually changed by comparing arrays
    const orderChanged = newOrder.some((server, index) => server !== currentServers[index]);
    
    if (orderChanged) {
      try {
        await this.mediaService.reorderMediaServers(newOrder);
        this.snackBar.open('Server order updated', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to reorder servers', 'Close', { duration: 3000 });
      }
    }
  }

  getPrimaryServer(): string | undefined {
    const servers = this.mediaService.mediaServers();
    return servers.length > 0 ? servers[0] : undefined;
  }

  openDetailsDialog(item: MediaItem): void {
    // Save the current active tab before navigating
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, this.activeTab());

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
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, this.activeTab());

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
        // Check if batch operations are disabled
        if (itemsToDelete.length > 1 && !this.mediaService.batchOperationsTemporarilyDisabledDueToBug) {
          // Use batch delete when feature is enabled
          await this.mediaService.deleteFiles(itemsToDelete);
        } else {
          // Fall back to individual deletes when disabled or for single items
          let deletedCount = 0;
          
          for (const id of itemsToDelete) {
            try {
              await this.mediaService.deleteFile(id);
              deletedCount++;
            } catch (err) {
              console.error(`Failed to delete item ${id}:`, err);
            }
          }
          
          if (deletedCount === 0 && itemsToDelete.length > 0) {
            throw new Error('Failed to delete any items');
          }
        }
        
        this.snackBar.open(`${itemsToDelete.length} ${itemsToDelete.length === 1 ? 'item' : 'items'} deleted`, 'Close', { duration: 3000 });
        this.selectedItems.set([]);
      } catch (error) {
        this.snackBar.open('Failed to delete some items', 'Close', { duration: 3000 });
      }
    }
  }

  async downloadSelected(sha256?: string): Promise<void> {
    let itemsToDownload: string[];

    if (sha256) {
      itemsToDownload = this.selectedItems();
    } else {
      itemsToDownload = this.selectedItems();
    }

    if (itemsToDownload.length === 0) return;
    
    try {
      // Set a status message during download
      this.snackBar.open(`Starting download of ${itemsToDownload.length} file(s)...`, 'Close', { duration: 3000 });
      
      // For each selected item, fetch and download
      for (const id of itemsToDownload) {
        const item = await this.mediaService.getFileById(id);
        if (item && item.url) {
          try {
            // Fetch the file content
            const response = await fetch(item.url);
            const blob = await response.blob();
            
            // Create a download link with proper filename
            const filename = this.getFileName(item.url);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            
            // Trigger download and clean up
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            // Small delay between downloads to prevent browser issues
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (err) {
            console.error(`Failed to download ${item.url}:`, err);
          }
        }
      }
      
      this.snackBar.open(`Download of ${itemsToDownload.length} file(s) initiated`, 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to download some items', 'Close', { duration: 3000 });
    }
  }
  
  async mirrorSelected(): Promise<void> {
    const itemsToMirror = this.selectedItems();
    if (itemsToMirror.length === 0) return;
    
    try {
      // Collect items to mirror and those already fully mirrored
      const toMirror: MediaItem[] = [];
      const alreadyMirrored: MediaItem[] = [];
      
      // First collect the items and check mirroring status
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
        // Check if batch operations are disabled
        if (!this.mediaService.batchOperationsTemporarilyDisabledDueToBug) {
          // Use batch mirroring when feature is enabled
          await this.mediaService.mirrorFiles(toMirror);
        } else {
          // Fall back to individual mirrors when disabled
          let mirroredCount = 0;
          
          for (const item of toMirror) {
            try {
              await this.mediaService.mirrorFile(item.sha256, item.url);
              mirroredCount++;
            } catch (err) {
              console.error(`Failed to mirror item ${item.sha256}:`, err);
            }
          }
          
          if (mirroredCount === 0 && toMirror.length > 0) {
            throw new Error('Failed to mirror any items');
          }
        }
      }
      
      // Show appropriate message based on results
      if (toMirror.length > 0 && alreadyMirrored.length > 0) {
        this.snackBar.open(`Mirrored ${toMirror.length} file(s), ${alreadyMirrored.length} already fully mirrored`, 'Close', { duration: 3000 });
      } else if (toMirror.length > 0) {
        this.snackBar.open(`Mirrored ${toMirror.length} file(s) successfully`, 'Close', { duration: 3000 });
      } else if (alreadyMirrored.length > 0) {
        this.snackBar.open(`All selected files are already fully mirrored`, 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.snackBar.open('Failed to mirror some items', 'Close', { duration: 3000 });
    }
  }

  isFullyMirrored(item: MediaItem): boolean {
    // Use the centralized method from MediaService
    return this.mediaService.isFullyMirrored(item);
  }

  async mirrorItem(sha256: string, url: string, servers?: string[]): Promise<void> {
    // Don't attempt mirroring if already mirrored to all available servers
    const item = await this.mediaService.getFileById(sha256);
    if (item && this.mediaService.isFullyMirrored(item)) {
      this.snackBar.open('Media is already mirrored to all your servers', 'Close', { duration: 3000 });
      return;
    }
    
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
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, tab);

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