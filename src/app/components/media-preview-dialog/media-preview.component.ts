import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
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
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './media-preview.component.html',
  styleUrls: ['./media-preview.component.scss']
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
    return this.data.mediaType?.startsWith('video');
  }
  
  isImage(): boolean {
    return this.data.mediaType?.startsWith('image');
  }
}
