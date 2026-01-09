import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface TextInputDialogData {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

@Component({
  selector: 'app-text-input-dialog',
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.message) {
        <p>{{ data.message }}</p>
      }
      
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ data.label }}</mat-label>
        <input
          matInput
          [formControl]="inputControl"
          [placeholder]="data.placeholder || ''"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
        />
        @if (inputControl.hasError('required')) {
          <mat-error>{{ data.label }} is required</mat-error>
        }
        @if (inputControl.hasError('minlength')) {
          <mat-error>Must be at least {{ data.minLength }} characters</mat-error>
        }
        @if (inputControl.hasError('maxlength')) {
          <mat-error>Must not exceed {{ data.maxLength }} characters</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        (click)="onSubmit()"
        [disabled]="inputControl.invalid"
      >
        OK
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
    }

    mat-dialog-content {
      min-width: 350px;
      padding-top: 16px;
    }

    p {
      margin-bottom: 16px;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class TextInputDialogComponent {
  private dialogRef = inject(MatDialogRef<TextInputDialogComponent>);
  readonly data = inject<TextInputDialogData>(MAT_DIALOG_DATA);

  inputControl: FormControl<string | null>;

  constructor() {
    const validators = [];

    if (this.data.required !== false) {
      validators.push(Validators.required);
    }

    if (this.data.minLength) {
      validators.push(Validators.minLength(this.data.minLength));
    }

    if (this.data.maxLength) {
      validators.push(Validators.maxLength(this.data.maxLength));
    }

    this.inputControl = new FormControl(this.data.initialValue || '', validators);
  }

  onSubmit(): void {
    if (this.inputControl.valid) {
      this.dialogRef.close(this.inputControl.value?.trim());
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
