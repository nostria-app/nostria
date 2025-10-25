import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-pin-prompt-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Enter Your PIN</h2>
    <mat-dialog-content>
      <p>Your private key is protected with a PIN. Please enter your PIN to access your credentials.</p>
      
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>PIN Code</mat-label>
        <input
          matInput
          [type]="hidePin() ? 'password' : 'text'"
          [formControl]="pinControl"
          placeholder="Enter your PIN"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
        />
        <button
          mat-icon-button
          matSuffix
          (click)="hidePin.set(!hidePin())"
          type="button"
        >
          <mat-icon>{{ hidePin() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
        @if (pinControl.hasError('required')) {
          <mat-error>PIN is required</mat-error>
        }
        @if (pinControl.hasError('minlength')) {
          <mat-error>PIN must be at least 4 characters</mat-error>
        }
      </mat-form-field>

      @if (errorMessage()) {
        <p class="error-message">{{ errorMessage() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onSubmit()"
        [disabled]="pinControl.invalid"
      >
        Unlock
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
    }

    .error-message {
      color: #f44336;
      font-size: 14px;
      margin-top: 8px;
    }

    mat-dialog-content {
      min-width: 300px;
    }
  `],
})
export class PinPromptDialogComponent {
  private dialogRef = inject(MatDialogRef<PinPromptDialogComponent>);

  pinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  hidePin = signal(true);
  errorMessage = signal('');

  onSubmit(): void {
    if (this.pinControl.valid) {
      this.dialogRef.close(this.pinControl.value);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }

  setError(message: string): void {
    this.errorMessage.set(message);
  }
}
