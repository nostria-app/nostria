import { Component, inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

export interface EditTrackDialogData {
  url: string;
  title?: string;
  artist?: string;
  duration?: string;
  index: number;
}

export interface EditTrackDialogResult {
  url: string;
  title?: string;
  artist?: string;
  duration?: string;
  index: number;
}

@Component({
  selector: 'app-edit-track-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './edit-track-dialog.component.html',
  styleUrl: './edit-track-dialog.component.scss',
})
export class EditTrackDialogComponent {
  private dialogRef = inject(MatDialogRef<EditTrackDialogComponent>);
  data = inject<EditTrackDialogData>(MAT_DIALOG_DATA);
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

      this.dialogRef.close({
        ...formValue,
        index: this.data.index,
      } as EditTrackDialogResult);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
