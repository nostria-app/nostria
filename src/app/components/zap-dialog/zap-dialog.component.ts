import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialog,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';
import { signal, computed } from '@angular/core';
import {
  ZapConfirmationDialogComponent,
  ZapConfirmationData,
} from '../zap-confirmation-dialog/zap-confirmation-dialog.component';
import { ZapErrorHandlerService } from '../../services/zap-error-handler.service';

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
        @if (availableWallets().length > 1) {
          <div class="wallet-selection">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Select Wallet</mat-label>
              <mat-select formControlName="selectedWallet">
                @for (wallet of availableWallets(); track wallet.id) {
                  <mat-option [value]="wallet.id">
                    <div class="wallet-option">
                      <mat-icon>account_balance_wallet</mat-icon>
                      <span class="wallet-name">{{ wallet.name }}</span>
                      <span class="wallet-status" [class.connected]="wallet.connected">
                        {{ wallet.connected ? 'Connected' : 'Disconnected' }}
                      </span>
                    </div>
                  </mat-option>
                }
              </mat-select>
              <mat-hint>Choose which wallet to use for this zap</mat-hint>
            </mat-form-field>
          </div>
        } @else if (availableWallets().length === 0) {
          <div class="no-wallet-warning">
            <mat-icon class="warning-icon">warning</mat-icon>
            <p>
              No wallet connected. Please connect a Nostr Wallet Connect (NWC) wallet to send zaps.
            </p>
          </div>
        }

        <div class="amount-selection">
          <h3>Select Amount</h3>
          <div class="amount-buttons">
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 21"
              (click)="selectAmount(21)"
            >
              ⚡ 21
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 420"
              (click)="selectAmount(420)"
            >
              ⚡ 420
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 1000"
              (click)="selectAmount(1000)"
            >
              ⚡ 1K
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 5000"
              (click)="selectAmount(5000)"
            >
              ⚡ 5K
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 10000"
              (click)="selectAmount(10000)"
            >
              ⚡ 10K
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 100000"
              (click)="selectAmount(100000)"
            >
              ⚡ 100K
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.selected]="zapForm.get('amount')?.value === 'custom'"
              (click)="selectAmount('custom')"
            >
              ⚡ Custom
            </button>
          </div>
        </div>

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

      .amount-selection h3 {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 500;
      }

      .amount-buttons {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }

      @media (max-width: 480px) {
        .amount-buttons {
          grid-template-columns: repeat(2, 1fr);
        }
        .zap-form {
          min-width: 300px;
        }
      }

      .amount-buttons button {
        padding: 12px 8px;
        font-size: 13px;
        font-weight: 500;
        border-radius: 8px;
        transition: all 0.2s ease;
      }

      .amount-buttons button.selected {
        background-color: #2196f3;
        color: white;
        border-color: #2196f3;
      }

      .amount-buttons button:hover:not(.selected) {
        background-color: #f5f5f5;
        border-color: #2196f3;
      }

      .wallet-selection {
        margin-bottom: 16px;
      }

      .wallet-option {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .wallet-name {
        flex: 1;
        font-weight: 500;
      }

      .wallet-status {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 12px;
        background: #f5f5f5;
        color: #666;
      }

      .wallet-status.connected {
        background: #e8f5e8;
        color: #4caf50;
      }

      .no-wallet-warning {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: #fff3e0;
        border: 1px solid #ffcc02;
        border-radius: 8px;
        margin-bottom: 16px;
      }

      .warning-icon {
        color: #ff9800;
      }

      .no-wallet-warning p {
        margin: 0;
        color: #e65100;
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
  private wallets = inject(Wallets);
  private dialog = inject(MatDialog);
  private errorHandler = inject(ZapErrorHandlerService);

  data: ZapDialogData = inject(MAT_DIALOG_DATA);

  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);

  // Computed property for available wallets
  availableWallets = computed(() => {
    const walletsMap = this.wallets.wallets();
    return Object.entries(walletsMap).map(([id, wallet]) => ({
      id,
      name: wallet.name || 'Unknown Wallet',
      connected: wallet.connections && wallet.connections.length > 0,
    }));
  });

  zapForm = new FormGroup({
    amount: new FormControl<string | number>(21, [Validators.required]),
    customAmount: new FormControl<number | null>(null),
    message: new FormControl('', [Validators.maxLength(280)]),
    selectedWallet: new FormControl<string>(''),
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

    // Set default wallet if only one is available
    const wallets = this.availableWallets();
    if (wallets.length === 1) {
      this.zapForm.get('selectedWallet')?.setValue(wallets[0].id);
    } else if (wallets.length > 1) {
      // Set the first connected wallet as default
      const connectedWallet = wallets.find((w) => w.connected);
      if (connectedWallet) {
        this.zapForm.get('selectedWallet')?.setValue(connectedWallet.id);
      }
    }
  }

  getFinalAmount(): number {
    const amount = this.zapForm.get('amount')?.value;
    if (amount === 'custom') {
      return this.zapForm.get('customAmount')?.value || 0;
    }
    return typeof amount === 'number' ? amount : 0;
  }

  selectAmount(amount: number | string): void {
    this.zapForm.get('amount')?.setValue(amount);
  }

  async onSendZap(): Promise<void> {
    if (!this.zapForm.valid) {
      return;
    }

    const amount = this.getFinalAmount();
    const message = this.zapForm.get('message')?.value || '';
    const selectedWalletId = this.zapForm.get('selectedWallet')?.value;

    // Find the selected wallet
    const selectedWallet = this.availableWallets().find((w) => w.id === selectedWalletId);
    if (!selectedWallet) {
      this.errorMessage.set('Please select a wallet to send the zap.');
      return;
    }

    // Show confirmation dialog
    const confirmationData: ZapConfirmationData = {
      recipient: {
        pubkey: this.data.recipientPubkey,
        name: this.data.recipientName,
        displayName: this.data.recipientName,
        picture: this.data.recipientMetadata?.['picture'] as string,
      },
      amount,
      message: message || undefined,
      wallet: {
        id: selectedWallet.id,
        name: selectedWallet.name,
      },
      eventTitle: this.data.eventContent,
      isProfileZap: !this.data.eventId,
    };

    const confirmationDialogRef = this.dialog.open(ZapConfirmationDialogComponent, {
      data: confirmationData,
      width: '500px',
      maxWidth: '90vw',
    });

    const confirmed = await confirmationDialogRef.afterClosed().toPromise();
    if (!confirmed) {
      return; // User cancelled
    }

    this.isProcessing.set(true);
    this.errorMessage.set(null);

    try {
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
      const zapError = this.errorHandler.handleZapError(error);
      this.errorMessage.set(zapError.message);
    } finally {
      this.isProcessing.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
