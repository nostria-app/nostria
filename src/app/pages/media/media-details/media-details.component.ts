import { Component, inject, signal, effect, computed } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MediaService, MediaItem } from '../../../services/media.service';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { MediaPreviewDialogComponent } from '../../../components/media-preview-dialog/media-preview.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-media-details',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TimestampPipe,
    MatTooltipModule
],
  templateUrl: './media-details.component.html',
  styleUrls: ['./media-details.component.scss']
})
export class MediaDetailsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  loading = signal(true);
  error = signal<string | null>(null);
  mediaItem = signal<MediaItem | null>(null);
  textContent = signal<string | null>(null);
  textLoading = signal(false);
  
  // Add computed signal for memoized mirror status
  isFullyMirroredStatus = computed(() => {
    const item = this.mediaItem();
    return item ? this.mediaService.isFullyMirrored(item) : false;
  });

  constructor() {
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (!id) {
        this.error.set('No media ID provided');
        this.loading.set(false);
        return;
      }

      this.fetchMediaItem(id);
    });
  }

  private async fetchMediaItem(id: string): Promise<void> {
    try {
      this.loading.set(true);
      this.error.set(null);

      const item = await this.mediaService.getFileById(id);
      this.mediaItem.set(item);
      
      // If it's a text file, fetch its content
      if (item && this.isTextFile(item.type)) {
        await this.fetchTextContent(item.url);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load media item');
    } finally {
      this.loading.set(false);
    }
  }

  async fetchTextContent(url: string): Promise<void> {
    try {
      this.textLoading.set(true);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load text content (${response.status})`);
      }
      
      const text = await response.text();
      this.textContent.set(text);
    } catch (error) {
      console.error('Error fetching text content:', error);
      this.textContent.set('Error loading text content');
    } finally {
      this.textLoading.set(false);
    }
  }

  isTextFile(mimeType: string | null | undefined): boolean {
    // Handle null/undefined type case
    if (!mimeType) return false;
    
    // Check for common text MIME types
    const textMimeTypes = [
      'text/plain',
      'text/html',
      'text/css',
      'text/javascript',
      'application/json',
      'application/xml',
      'text/csv',
      'text/markdown',
      'application/x-sh'
    ];
    
    return textMimeTypes.some(type => mimeType.startsWith(type)) ||
           mimeType.includes('text/') ||
           // Check extensions for common text file formats
           this.hasTextFileExtension(mimeType);
  }
  
  hasTextFileExtension(mimeType: string): boolean {
    // For files where MIME type may not be correctly set,
    // check URL for common text file extensions
    const item = this.mediaItem();
    if (!item || !item.url) return false;
    
    const url = item.url.toLowerCase();
    const textExtensions = ['.txt', '.md', '.json', '.xml', '.csv', '.log', '.sh', '.js', '.ts', '.css', '.html', '.yml', '.yaml'];
    
    return textExtensions.some(ext => url.endsWith(ext));
  }

  async downloadMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    try {
      // Show loading message
      this.snackBar.open('Preparing download...', '', { duration: 2000 });
      
      // Fetch the file
      const response = await fetch(item.url);
      const blob = await response.blob();

      // Get proper filename based on URL or mime type
      const filename = this.getFileName(item);
      
      // Create download link with proper download attribute
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      
      // Append to document, click, then clean up
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.snackBar.open('Download started', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to download media', 'Close', { duration: 3000 });
      console.error('Download error:', error);
    }
  }

  openFullScreen(): void {
    const item = this.mediaItem();
    if (!item) return;

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

  async deleteMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Media',
        message: 'Are you sure you want to delete this media? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        await this.mediaService.deleteFile(item.sha256);
        this.snackBar.open('Media deleted successfully', 'Close', { duration: 3000 });
        this.router.navigate(['/media']);
      } catch (error) {
        this.snackBar.open('Failed to delete media', 'Close', { duration: 3000 });
      }
    }
  }

  // Change the function to return the computed value
  isFullyMirrored(): boolean {
    return this.isFullyMirroredStatus();
  }

  async mirrorMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    // Don't attempt mirroring if already mirrored to all available servers
    if (this.mediaService.isFullyMirrored(item)) {
      this.snackBar.open('Media is already mirrored to all your servers', 'Close', { duration: 3000 });
      return;
    }

    try {
      await this.mediaService.mirrorFile(item.sha256, item.url);
      this.snackBar.open('Media mirrored successfully', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to mirror media', 'Close', { duration: 3000 });
    }
  }

  goBack(): void {
    // Simply navigate back to the media list
    // The active tab will be restored from localStorage by the MediaComponent
    this.router.navigate(['/media']);
  }

  getMediaIcon(type: string | null | undefined): string {
    if (!type) return 'insert_drive_file'; // Default icon for unknown types
    if (type.startsWith('image')) return 'image';
    if (type.startsWith('video')) return 'videocam';
    if (this.isTextFile(type)) return 'description';
    return 'insert_drive_file';
  }

  getFileName(item: MediaItem): string {
    // Handle case where type might be null/undefined
    const mimeType = item.type || 'application/octet-stream';
    const extension = mimeType.split('/')[1] || 'file';
    const baseFileName = item.url?.split('/').pop() || `nostr-media.${extension}`;

    // If the URL already has a proper filename with extension, use it
    if (baseFileName.includes('.')) {
      return baseFileName;
    }

    // Otherwise construct one using the sha256 and the MIME type
    return `nostr-media-${item.sha256.substring(0, 8)}.${extension}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper method to extract server from URL
  getServerFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.host}/`;
    } catch {
      return 'Unknown Server';
    }
  }
}
