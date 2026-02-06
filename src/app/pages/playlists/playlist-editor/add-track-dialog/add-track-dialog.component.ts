import { Component, inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';

export interface AddTrackDialogData {
  url?: string;
  title?: string;
  artist?: string;
  duration?: string;
}

@Component({
  selector: 'app-add-track-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './add-track-dialog.component.html',
  styleUrl: './add-track-dialog.component.scss',
})
export class AddTrackDialogComponent {
  private dialogRef = inject(MatDialogRef<AddTrackDialogComponent>);
  private data = inject(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);

  trackForm: FormGroup;

  constructor() {
    this.trackForm = this.fb.group({
      url: [this.data?.url || '', [Validators.required, this.urlValidator]],
      title: [this.data?.title || ''],
      artist: [this.data?.artist || ''],
      duration: [this.data?.duration || '', [this.durationValidator]],
    });
  }

  private urlValidator(control: FormGroup): Record<string, boolean> | null {
    const value = control.value;
    if (!value) return null;

    try {
      new URL(value);
      return null;
    } catch {
      return { invalidUrl: true };
    }
  }

  private durationValidator(control: FormGroup): Record<string, boolean> | null {
    const value = control.value;
    if (!value) return null;

    // Accept formats like "3:45", "1:23:45", or "245" (seconds)
    const durationPattern = /^(\d+:)?\d{1,2}:\d{2}$|^\d+$/;

    if (!durationPattern.test(value)) {
      return { invalidDuration: true };
    }

    return null;
  }

  onSubmit(): void {
    if (this.trackForm.valid) {
      const formValue = this.trackForm.value;

      // Auto-extract title from URL if not provided
      if (!formValue.title && formValue.url) {
        formValue.title = this.extractTitleFromUrl(formValue.url);
      }

      this.dialogRef.close(formValue);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || '';

      // Remove file extension
      const title = filename.replace(/\.[^/.]+$/, '');

      return title || 'Unknown Track';
    } catch {
      return 'Unknown Track';
    }
  }
}