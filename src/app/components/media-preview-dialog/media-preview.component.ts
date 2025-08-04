import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface MediaPreviewData {
  mediaUrl: string;
  mediaType: string;
  mediaTitle: string;
}

@Component({
  selector: 'app-media-preview-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './media-preview.component.html',
  styleUrls: ['./media-preview.component.scss'],
})
export class MediaPreviewDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaPreviewDialogComponent>);
  data: MediaPreviewData = inject(MAT_DIALOG_DATA);

  isVideoLoading = true;

  close(): void {
    this.dialogRef.close();
  }

  onVideoLoad(): void {
    this.isVideoLoading = false;
  }

  isVideo(): boolean {
    if (this.data.mediaType?.startsWith('video')) {
      return true;
    }

    // Check file extension if mediaType isn't available
    if (!this.data.mediaType && this.data.mediaUrl) {
      const url = this.data.mediaUrl.toLowerCase();
      const videoExtensions = [
        '.mp4',
        '.webm',
        '.ogg',
        '.mov',
        '.avi',
        '.wmv',
        '.mkv',
      ];
      return videoExtensions.some(ext => url.endsWith(ext));
    }

    return false;
  }

  isImage(): boolean {
    if (this.data.mediaType?.startsWith('image')) {
      return true;
    }

    // Check file extension if mediaType isn't available
    if (!this.data.mediaType && this.data.mediaUrl) {
      const url = this.data.mediaUrl.toLowerCase();
      const imageExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.svg',
        '.bmp',
      ];
      return imageExtensions.some(ext => url.endsWith(ext));
    }

    return false;
  }
}
