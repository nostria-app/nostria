import { Component, inject, signal } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MediaService } from '../../../services/media.service';

@Component({
  selector: 'app-media-upload-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './media-upload-dialog.component.html',
  styleUrls: ['./media-upload-dialog.component.scss'],
})
export class MediaUploadDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaUploadDialogComponent>);
  private fb = inject(FormBuilder);
  private mediaService = inject(MediaService);

  uploadForm: FormGroup;
  selectedFile = signal<File | null>(null);
  previewUrl = signal<string | null>(null);
  isImage = signal<boolean>(false);
  isVideo = signal<boolean>(false);
  showOriginalOption = signal<boolean>(false);
  isDragging = signal<boolean>(false);
  isUploading = signal<boolean>(false);

  // Video thumbnail preview (for display only, not uploaded)
  videoThumbnailUrl = signal<string | null>(null);
  extractingThumbnail = signal<boolean>(false);

  // Add signals for servers
  availableServers = signal<string[]>([]);
  selectedServers = signal<string[]>([]);
  showServerSelection = signal<boolean>(false);

  constructor() {
    this.uploadForm = this.fb.group({
      uploadOriginal: [false],
    });

    // Initialize available servers from the media service
    this.availableServers.set(this.mediaService.mediaServers());

    // Auto select all servers by default
    if (this.availableServers().length > 0) {
      this.selectedServers.set(this.availableServers());
      this.showServerSelection.set(true);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.processFile(file);
    }
  }

  processFile(file: File): void {
    this.selectedFile.set(file);

    // Check if the file is an image or video
    this.isImage.set(file.type.startsWith('image/'));
    this.isVideo.set(file.type.startsWith('video/'));

    // Only show original option for images and videos
    this.showOriginalOption.set(this.isImage() || this.isVideo());

    // Create a preview if it's an image
    if (this.isImage()) {
      const reader = new FileReader();
      reader.onload = () => {
        this.previewUrl.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else if (this.isVideo()) {
      // For videos, extract thumbnail for preview only
      this.extractVideoThumbnail(file);
      this.previewUrl.set(null);
    } else {
      this.previewUrl.set(null);
    }
  }

  clearFile(): void {
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.showOriginalOption.set(false);
    this.videoThumbnailUrl.set(null);
  }

  async extractVideoThumbnail(videoFile: File): Promise<void> {
    this.extractingThumbnail.set(true);

    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const videoUrl = URL.createObjectURL(videoFile);
      video.src = videoUrl;

      // Wait for video to load metadata
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video'));
      });

      // Seek to 1 second or 10% of duration, whichever is smaller
      const seekTime = Math.min(1, video.duration * 0.1);
      video.currentTime = seekTime;

      // Wait for seek to complete
      await new Promise<void>(resolve => {
        video.onseeked = () => resolve();
      });

      // Create canvas and draw the video frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create thumbnail blob'));
          }
        }, 'image/jpeg', 0.9);
      });

      // Create preview URL (for display only, not saved)
      this.videoThumbnailUrl.set(URL.createObjectURL(blob));

      // Clean up
      URL.revokeObjectURL(videoUrl);
    } catch (error) {
      console.error('Failed to extract video thumbnail:', error);
      this.videoThumbnailUrl.set(null);
    } finally {
      this.extractingThumbnail.set(false);
    }
  }

  toggleServerSelection(server: string): void {
    this.selectedServers.update(servers => {
      if (servers.includes(server)) {
        return servers.filter(s => s !== server);
      } else {
        return [...servers, server];
      }
    });
  }

  isServerSelected(server: string): boolean {
    return this.selectedServers().includes(server);
  }

  onSubmit(): void {
    if (this.uploadForm.valid && this.selectedFile()) {
      this.isUploading.set(true); // Set uploading state to true when upload starts
      this.dialogRef.close({
        file: this.selectedFile(),
        uploadOriginal: this.uploadForm.value.uploadOriginal,
        servers: this.selectedServers(),
        isUploading: this.isUploading, // Pass the signal to the parent component
      });
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  getFileTypeIcon(file: File): string {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'videocam';
    return 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Drag and drop handlers
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      // Take only the first file
      this.processFile(files[0]);
    }
  }
}
