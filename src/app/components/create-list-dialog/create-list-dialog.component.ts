import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';

export interface CreateListDialogData {
  title?: string;
  initialPrivate?: boolean;
}

export interface CreateListDialogResult {
  title: string;
  isPrivate: boolean;
}

@Component({
  selector: 'app-create-list-dialog',
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Create new list</h2>
    <mat-dialog-content>
      <p>Create a custom list to organize people you follow</p>
      
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>List Name</mat-label>
        <input
          matInput
          [formControl]="titleControl"
          placeholder="e.g., Developers, Friends, Artists"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
        />
        @if (titleControl.hasError('required')) {
          <mat-error>List name is required</mat-error>
        }
        @if (titleControl.hasError('minlength')) {
          <mat-error>Must be at least 1 character</mat-error>
        }
        @if (titleControl.hasError('maxlength')) {
          <mat-error>Must not exceed 100 characters</mat-error>
        }
      </mat-form-field>

      <div class="privacy-section">
        <mat-checkbox [formControl]="privateControl">
          <div class="checkbox-content">
            <div class="checkbox-label">
              <mat-icon>lock</mat-icon>
              <span>Private (encrypted)</span>
            </div>
            <div class="checkbox-description">
              Private lists are encrypted and only visible to you
            </div>
          </div>
        </mat-checkbox>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        (click)="onSubmit()"
        [disabled]="titleControl.invalid"
      >
        Create List
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
    }

    mat-dialog-content {
      min-width: 400px;
      padding-top: 16px;
    }

    p {
      margin-bottom: 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    .privacy-section {
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      background-color: var(--mat-sys-surface-container-low);
    }

    .checkbox-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    .checkbox-label mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .checkbox-description {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin-left: 26px;
    }

    mat-checkbox {
      width: 100%;
    }
  `],
})
export class CreateListDialogComponent {
  private dialogRef = inject(MatDialogRef<CreateListDialogComponent>);
  readonly data = inject<CreateListDialogData>(MAT_DIALOG_DATA);

  titleControl = new FormControl('', [
    Validators.required,
    Validators.minLength(1),
    Validators.maxLength(100),
  ]);

  privateControl = new FormControl(this.data?.initialPrivate ?? false);

  onSubmit(): void {
    if (this.titleControl.valid) {
      const result: CreateListDialogResult = {
        title: this.titleControl.value!.trim(),
        isPrivate: this.privateControl.value ?? false,
      };
      this.dialogRef.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
