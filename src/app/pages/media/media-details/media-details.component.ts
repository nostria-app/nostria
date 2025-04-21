import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
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

@Component({
  selector: 'app-media-details',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TimestampPipe
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
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load media item');
    } finally {
      this.loading.set(false);
    }
  }

  async downloadMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

    try {
      const response = await fetch(item.url);
      const blob = await response.blob();
      
      // Create a temporary link and trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.getFileName(item);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.snackBar.open('Download started', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open('Failed to download media', 'Close', { duration: 3000 });
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

  async mirrorMedia(): Promise<void> {
    const item = this.mediaItem();
    if (!item) return;

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

  getMediaIcon(type: string): string {
    if (type.startsWith('image')) return 'image';
    if (type.startsWith('video')) return 'videocam';
    return 'insert_drive_file';
  }

  getFileName(item: MediaItem): string {
    const extension = item.type.split('/')[1] || 'file';
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
}
