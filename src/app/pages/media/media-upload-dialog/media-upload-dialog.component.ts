import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-media-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './media-upload-dialog.component.html',
  styleUrls: ['./media-upload-dialog.component.scss']
})
export class MediaUploadDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaUploadDialogComponent>);
  private fb = inject(FormBuilder);
  
  uploadForm: FormGroup;
  selectedFile = signal<File | null>(null);
  previewUrl = signal<string | null>(null);
  isImage = signal<boolean>(false);
  
  constructor() {
    this.uploadForm = this.fb.group({
      title: ['', Validators.maxLength(100)],
      description: ['', Validators.maxLength(500)]
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.selectedFile.set(file);
      
      // Check if the file is an image
      this.isImage.set(file.type.startsWith('image/'));
      
      // Create a preview if it's an image
      if (this.isImage()) {
        const reader = new FileReader();
        reader.onload = () => {
          this.previewUrl.set(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        this.previewUrl.set(null);
      }
    }
  }
  
  clearFile(): void {
    this.selectedFile.set(null);
    this.previewUrl.set(null);
  }
  
  onSubmit(): void {
    if (this.uploadForm.valid && this.selectedFile()) {
      this.dialogRef.close({
        file: this.selectedFile(),
        title: this.uploadForm.value.title,
        description: this.uploadForm.value.description
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
}
