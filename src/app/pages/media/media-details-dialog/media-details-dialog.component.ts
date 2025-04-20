import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { MediaItem, MediaService } from '../../../services/media.service';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';

@Component({
  selector: 'app-media-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSnackBarModule,
    TimestampPipe
  ],
  templateUrl: './media-details-dialog.component.html',
  styleUrls: ['./media-details-dialog.component.scss']
})
export class MediaDetailsDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaDetailsDialogComponent>);
  mediaItem: MediaItem = inject(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  
  isEditing = signal(false);
  metadataForm: FormGroup;
  
  constructor() {
    this.metadataForm = this.fb.group({
      title: [this.mediaItem.url || '', Validators.maxLength(100)],
      description: [this.mediaItem.url || '', Validators.maxLength(500)]
    });
  }
  
  toggleEditMode(): void {
    this.isEditing.update(value => !value);
    if (!this.isEditing()) {
      // Reset form when canceling edit
      this.metadataForm.setValue({
        title: this.mediaItem.url || '',
        description: this.mediaItem.url || ''
      });
    }
  }
  
  async saveMetadata(): Promise<void> {
    if (this.metadataForm.valid) {
      try {
        await this.mediaService.updateMetadata(
          this.mediaItem.sha256, 
          this.metadataForm.value
        );
        this.mediaItem = {
          ...this.mediaItem,
          url: this.metadataForm.value.title
        };
        this.isEditing.set(false);
        this.snackBar.open('Metadata updated successfully', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to update metadata', 'Close', { duration: 3000 });
      }
    }
  }
  
  close(): void {
    this.dialogRef.close();
  }
  
  formatDate(date: Date): string {
    return new Date(date).toLocaleString();
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
}
