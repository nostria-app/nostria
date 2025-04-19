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
      title: [this.mediaItem.title || '', Validators.maxLength(100)],
      description: [this.mediaItem.description || '', Validators.maxLength(500)]
    });
  }
  
  toggleEditMode(): void {
    this.isEditing.update(value => !value);
    if (!this.isEditing()) {
      // Reset form when canceling edit
      this.metadataForm.setValue({
        title: this.mediaItem.title || '',
        description: this.mediaItem.description || ''
      });
    }
  }
  
  async saveMetadata(): Promise<void> {
    if (this.metadataForm.valid) {
      try {
        await this.mediaService.updateMetadata(
          this.mediaItem.id, 
          this.metadataForm.value
        );
        this.mediaItem = {
          ...this.mediaItem,
          title: this.metadataForm.value.title,
          description: this.metadataForm.value.description
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
