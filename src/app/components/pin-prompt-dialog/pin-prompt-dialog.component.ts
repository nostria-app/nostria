import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface PinPromptDialogData {
  /** Title for the dialog */
  title?: string;
  /** Message to display to the user */
  message?: string;
  /** Number of failed attempts so far */
  failedAttempts?: number;
  /** Whether to show the "forgot PIN" hint */
  showForgotHint?: boolean;
}

@Component({
  selector: 'app-pin-prompt-dialog',
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">{{ failedAttempts() > 0 ? 'error_outline' : 'lock' }}</mat-icon>
      {{ title() }}
    </h2>
    <mat-dialog-content>
      <p class="message">{{ message() }}</p>

      @if (failedAttempts() > 0) {
        <div class="error-banner">
          <mat-icon>warning</mat-icon>
          <div class="error-content">
            <strong>Incorrect PIN</strong>
            <span>{{ failedAttempts() === 1 ? 'The PIN you entered was incorrect.' : 'PIN incorrect. Attempt ' + failedAttempts() + ' failed.' }}</span>
          </div>
        </div>
      }
      
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>PIN Code</mat-label>
        <input
          matInput
          [type]="hidePin() ? 'password' : 'text'"
          [formControl]="pinControl"
          placeholder="Enter your PIN"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
          cdkFocusInitial
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

      @if (showForgotHint()) {
        <div class="forgot-hint">
          <mat-icon>help_outline</mat-icon>
          <span>Forgot your PIN? Go to <strong>Credentials</strong> page and use <strong>Reset PIN</strong> if you know your current PIN, or restore your account using your recovery phrase.</span>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        (click)="onSubmit()"
        [disabled]="pinControl.invalid"
      >
        @if (failedAttempts() > 0) {
          Try Again
        } @else {
          Unlock
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title-icon {
      color: var(--mat-sys-primary);
    }

    .title-icon.error {
      color: var(--mat-sys-error);
    }

    .message {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
    }

    .full-width {
      width: 100%;
    }

    .error-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      background-color: rgba(244, 67, 54, 0.1);
      border: 1px solid rgba(244, 67, 54, 0.3);
      border-radius: 8px;
      margin-bottom: 16px;

      mat-icon {
        color: var(--mat-sys-error);
        flex-shrink: 0;
      }

      .error-content {
        display: flex;
        flex-direction: column;
        gap: 2px;

        strong {
          color: var(--mat-sys-error);
          font-size: 14px;
        }

        span {
          color: var(--mat-sys-on-surface-variant);
          font-size: 13px;
        }
      }
    }

    .forgot-hint {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
      background-color: var(--mat-sys-surface-container);
      border-radius: 8px;
      margin-top: 16px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        color: var(--mat-sys-primary);
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 2px;
      }

      strong {
        color: var(--mat-sys-on-surface);
      }
    }

    mat-dialog-content {
      min-width: 300px;
    }
  `],
})
export class PinPromptDialogComponent {
  private dialogRef = inject(MatDialogRef<PinPromptDialogComponent>);
  private data = inject<PinPromptDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  pinControl = new FormControl('', [Validators.required, Validators.minLength(4)]);
  hidePin = signal(true);

  title = signal(this.data?.title || 'Enter Your PIN');
  message = signal(this.data?.message || 'Your private key is protected with a PIN. Please enter your PIN to access your credentials.');
  failedAttempts = signal(this.data?.failedAttempts || 0);
  showForgotHint = signal(this.data?.showForgotHint ?? (this.data?.failedAttempts ? this.data.failedAttempts >= 2 : false));

  onSubmit(): void {
    if (this.pinControl.valid) {
      this.dialogRef.close(this.pinControl.value);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }

  /** Updates the failed attempts count and clears the input */
  setFailedAttempts(count: number): void {
    this.failedAttempts.set(count);
    this.pinControl.reset();
    if (count >= 2) {
      this.showForgotHint.set(true);
    }
  }
}
