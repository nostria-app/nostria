import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ZapService } from '../../services/zap.service';
import { signal } from '@angular/core';

export interface ZapDialogData {
  recipientPubkey: string;
  recipientName?: string;
  recipientMetadata?: Record<string, unknown>;
  eventId?: string;
  eventContent?: string;
}

export interface ZapDialogResult {
  amount: number;
  message: string;
}

@Component({
  selector: 'app-zap-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>bolt</mat-icon>
      Send Lightning Zap
      @if (data.recipientName) {
        to {{ data.recipientName }}
      }
    </h2>

    <mat-dialog-content>
      @if (data.eventContent) {
        <div class="event-preview">
          <h4>Zapping this note:</h4>
          <p class="event-content">"{{ data.eventContent }}"</p>
        </div>
      }

      <form [formGroup]="zapForm" class="zap-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Amount (sats)</mat-label>
          <mat-select formControlName="amount" required>
            <mat-option [value]="21">⚡ 21 sats</mat-option>
            <mat-option [value]="100">⚡ 100 sats</mat-option>
            <mat-option [value]="500">⚡ 500 sats</mat-option>
            <mat-option [value]="1000">⚡ 1,000 sats</mat-option>
            <mat-option [value]="5000">⚡ 5,000 sats</mat-option>
            <mat-option [value]="10000">⚡ 10,000 sats</mat-option>
            <mat-option value="custom">⚡ Custom amount</mat-option>
          </mat-select>
          @if (zapForm.get('amount')?.hasError('required')) {
            <mat-error>Amount is required</mat-error>
          }
        </mat-form-field>

        @if (zapForm.get('amount')?.value === 'custom') {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Custom Amount (sats)</mat-label>
            <input matInput formControlName="customAmount" type="number" min="1" />
            @if (zapForm.get('customAmount')?.hasError('required')) {
              <mat-error>Custom amount is required</mat-error>
            }
            @if (zapForm.get('customAmount')?.hasError('min')) {
              <mat-error>Amount must be at least 1 sat</mat-error>
            }
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Message (optional)</mat-label>
          <textarea
            matInput
            formControlName="message"
            placeholder="Add a message with your zap..."
            rows="3"
          ></textarea>
          <mat-hint>{{ zapForm.get('message')?.value?.length || 0 }}/280 characters</mat-hint>
          @if (zapForm.get('message')?.hasError('maxlength')) {
            <mat-error>Message is too long (max 280 characters)</mat-error>
          }
        </mat-form-field>
      </form>

      @if (errorMessage()) {
        <div class="error-message">
          <mat-icon>error</mat-icon>
          {{ errorMessage() }}
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()" [disabled]="isProcessing()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onSendZap()"
        [disabled]="isProcessing() || !zapForm.valid"
      >
        @if (isProcessing()) {
          <mat-spinner diameter="18"></mat-spinner>
          Processing...
        } @else {
          <ng-container>
            <mat-icon>bolt</mat-icon>
            Send Zap ({{ getFinalAmount() }} sats)
          </ng-container>
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .zap-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 400px;
      }

      .full-width {
        width: 100%;
      }

      .event-preview {
        background: #f5f5f5;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .event-preview h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: #666;
      }

      .event-content {
        margin: 0;
        font-style: italic;
        color: #333;
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f44336;
        background: #ffebee;
        padding: 12px;
        border-radius: 4px;
        margin-top: 16px;
      }

      mat-dialog-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      mat-dialog-actions button {
        margin-left: 8px;
      }

      mat-spinner {
        margin-right: 8px;
      }
    `,
  ],
})
export class ZapDialogComponent {
  private dialogRef = inject(MatDialogRef<ZapDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);

  data: ZapDialogData = inject(MAT_DIALOG_DATA);

  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);

  zapForm = new FormGroup({
    amount: new FormControl<string | number>('', [Validators.required]),
    customAmount: new FormControl<number | null>(null),
    message: new FormControl('', [Validators.maxLength(280)]),
  });

  constructor() {
    // Watch for amount changes to enable/disable custom amount
    this.zapForm.get('amount')?.valueChanges.subscribe((value) => {
      const customAmountControl = this.zapForm.get('customAmount');
      if (value === 'custom') {
        customAmountControl?.setValidators([Validators.required, Validators.min(1)]);
        customAmountControl?.enable();
      } else {
        customAmountControl?.clearValidators();
        customAmountControl?.disable();
        customAmountControl?.setValue(null);
      }
      customAmountControl?.updateValueAndValidity();
    });
  }

  getFinalAmount(): number {
    const amount = this.zapForm.get('amount')?.value;
    if (amount === 'custom') {
      return this.zapForm.get('customAmount')?.value || 0;
    }
    return typeof amount === 'number' ? amount : 0;
  }

  async onSendZap(): Promise<void> {
    if (!this.zapForm.valid) {
      return;
    }

    this.isProcessing.set(true);
    this.errorMessage.set(null);

    try {
      const amount = this.getFinalAmount();
      const message = this.zapForm.get('message')?.value || '';

      await this.zapService.sendZap(
        this.data.recipientPubkey,
        amount,
        message,
        this.data.eventId,
        this.data.recipientMetadata,
      );

      this.snackBar.open(
        `⚡ Successfully sent ${amount} sats${this.data.recipientName ? ` to ${this.data.recipientName}` : ''}!`,
        'Dismiss',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        },
      );

      this.dialogRef.close({
        amount,
        message,
      } as ZapDialogResult);
    } catch (error) {
      console.error('Failed to send zap:', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to send zap. Please try again.',
      );
    } finally {
      this.isProcessing.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
