import { Component, inject, signal, computed } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { QrCodeComponent } from '../qr-code/qr-code.component';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';
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
  paymentMethod: 'nwc' | 'native' | 'manual';
  invoice?: string;
}

export type PaymentMethod = 'nwc' | 'native' | 'manual';
export type DialogState = 'input' | 'confirmation';

@Component({
  selector: 'app-zap-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    ReactiveFormsModule,
    UserProfileComponent,
    QrCodeComponent,
  ],
  template: `
    <div class="zap-dialog" [class.confirmation-state]="currentState() === 'confirmation'">
      <!-- Input State -->
      @if (currentState() === 'input') {
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
            (click)="proceedToConfirmation()"
            [disabled]="isProcessing() || !zapForm.valid"
          >
            Continue ({{ getFinalAmount() }} sats)
          </button>
        </mat-dialog-actions>
      }

      <!-- Confirmation State -->
      @if (currentState() === 'confirmation') {
        <h2 mat-dialog-title>
          <mat-icon>bolt</mat-icon>
          Confirm Lightning Zap
        </h2>

        <mat-dialog-content>
          <div class="confirmation-content">
            <!-- Recipient Info -->
            <div class="section recipient-section">
              <h3>Zapping</h3>
              <div class="recipient-info">
                <app-user-profile [pubkey]="data.recipientPubkey"></app-user-profile>
              </div>
              @if (data.eventContent) {
                <div class="event-context">
                  <mat-icon>article</mat-icon>
                  <span>{{ data.eventContent }}</span>
                </div>
              } @else if (!data.eventId) {
                <div class="event-context">
                  <mat-icon>person</mat-icon>
                  <span>Profile zap</span>
                </div>
              }
            </div>

            <mat-divider></mat-divider>

            <!-- Amount -->
            <div class="section amount-section">
              <h3>Amount</h3>
              <div class="amount-display">
                <mat-icon>bolt</mat-icon>
                <span class="amount">{{ formatAmount(getFinalAmount()) }}</span>
                <span class="unit">sats</span>
              </div>
            </div>

            @if (zapForm.get('message')?.value) {
              <mat-divider></mat-divider>
              <div class="section message-section">
                <h3>Message</h3>
                <div class="message-content">
                  <mat-icon>message</mat-icon>
                  <p>{{ zapForm.get('message')?.value }}</p>
                </div>
              </div>
            }

            <mat-divider></mat-divider>

            <!-- Payment Method Selection -->
            <div class="section payment-method-section">
              <h3>Choose Payment Method</h3>

              <div class="payment-method-buttons">
                <button
                  mat-stroked-button
                  (click)="selectPaymentMethod('nwc')"
                  [class.selected]="selectedPaymentMethod() === 'nwc'"
                >
                  <mat-icon>account_balance_wallet</mat-icon>
                  Wallet Connect
                </button>

                <button
                  mat-stroked-button
                  (click)="selectPaymentMethod('native')"
                  [class.selected]="selectedPaymentMethod() === 'native'"
                >
                  <mat-icon>smartphone</mat-icon>
                  Lightning Wallet
                </button>

                <button
                  mat-stroked-button
                  (click)="selectPaymentMethod('manual')"
                  [class.selected]="selectedPaymentMethod() === 'manual'"
                >
                  <mat-icon>qr_code</mat-icon>
                  QR Code
                </button>
              </div>

              <div class="payment-method-content">
                <!-- NWC Content -->
                @if (selectedPaymentMethod() === 'nwc') {
                  <div class="wallet-info">
                    <mat-icon>account_balance_wallet</mat-icon>
                    <span>{{ getSelectedWalletName() }}</span>
                  </div>
                  <p class="method-description">
                    Use your connected Nostr Wallet Connect (NWC) wallet to pay automatically.
                  </p>

                  @if (!hasNwcWallet()) {
                    <div class="no-wallet-warning">
                      <mat-icon class="warning-icon">warning</mat-icon>
                      <div>
                        <p>No NWC wallet connected.</p>
                        <p>
                          Please add your NWC connection string on the
                          <button mat-button color="primary" (click)="openCredentials()">
                            Credentials
                          </button>
                          page.
                        </p>
                      </div>
                    </div>
                  }

                  @if (isProcessing() && selectedPaymentMethod() === 'nwc') {
                    <div class="processing-indicator">
                      <mat-spinner diameter="20"></mat-spinner>
                      <span>Processing payment...</span>
                    </div>
                  }
                }

                <!-- Native (Open Lightning) Content -->
                @if (selectedPaymentMethod() === 'native') {
                  @if (invoiceUrl()) {
                    <div class="native-wallet-section">
                      <p class="method-description">
                        Open your mobile Lightning wallet app to pay this invoice.
                      </p>
                      <button
                        mat-raised-button
                        color="primary"
                        (click)="openLightningWallet()"
                        class="open-wallet-btn"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        Open Lightning Wallet
                      </button>
                      <p class="wallet-hint">
                        If your wallet doesn't open automatically, copy the invoice manually.
                      </p>
                    </div>
                  } @else if (isProcessing() && selectedPaymentMethod() === 'native') {
                    <div class="processing-indicator">
                      <mat-spinner diameter="20"></mat-spinner>
                      <span>Generating invoice...</span>
                    </div>
                  } @else {
                    <p class="method-description">
                      Click "Generate Invoice" to create a Lightning invoice for your mobile wallet.
                    </p>
                  }
                }

                <!-- Manual (QR Code) Content -->
                @if (selectedPaymentMethod() === 'manual') {
                  @if (invoiceUrl()) {
                    <div class="qr-code-section">
                      <p class="method-description">
                        Scan this QR code with any Lightning wallet to pay.
                      </p>
                      <div class="qr-code-container">
                        <qr-code [qrdata]="invoiceUrl()!" [width]="200" [height]="200"></qr-code>
                      </div>
                      <div class="invoice-details">
                        <p class="invoice-label">Lightning Invoice:</p>
                        <button
                          class="invoice-text"
                          (click)="copyInvoice()"
                          (keydown.enter)="copyInvoice()"
                          (keydown.space)="copyInvoice()"
                          type="button"
                          aria-label="Copy invoice to clipboard"
                        >
                          <span class="invoice-value">{{ truncateInvoice(invoiceUrl()!) }}</span>
                          <mat-icon class="copy-icon">content_copy</mat-icon>
                        </button>
                      </div>
                    </div>
                  } @else if (isProcessing() && selectedPaymentMethod() === 'manual') {
                    <div class="processing-indicator">
                      <mat-spinner diameter="20"></mat-spinner>
                      <span>Generating QR code...</span>
                    </div>
                  } @else {
                    <p class="method-description">
                      Click "Generate QR Code" to create a QR code for manual payment.
                    </p>
                  }
                }
              </div>
            </div>
          </div>
        </mat-dialog-content>

        <mat-dialog-actions>
          <button mat-button (click)="backToInput()" [disabled]="isProcessing()">Back</button>

          @if (selectedPaymentMethod() === 'nwc') {
            <button
              mat-flat-button
              color="primary"
              (click)="confirmNwcPayment()"
              class="confirm-button"
              [disabled]="isProcessing() || !hasNwcWallet()"
            >
              @if (isProcessing()) {
                <ng-container>
                  <mat-spinner diameter="18"></mat-spinner>
                  Processing...
                </ng-container>
              } @else {
                <ng-container>
                  <mat-icon>bolt</mat-icon>
                  Send Zap
                </ng-container>
              }
            </button>
          } @else if (
            selectedPaymentMethod() === 'native' || selectedPaymentMethod() === 'manual'
          ) {
            @if (!invoiceUrl()) {
              <button
                mat-flat-button
                color="primary"
                (click)="generateInvoice()"
                class="confirm-button"
                [disabled]="isProcessing()"
              >
                @if (isProcessing()) {
                  <ng-container>
                    <mat-spinner diameter="18"></mat-spinner>
                    Generating...
                  </ng-container>
                } @else {
                  <ng-container>
                    <mat-icon>receipt</mat-icon>
                    {{
                      selectedPaymentMethod() === 'native' ? 'Generate Invoice' : 'Generate QR Code'
                    }}
                  </ng-container>
                }
              </button>
            } @else {
              <button mat-flat-button color="accent" (click)="markAsPaid()" class="confirm-button">
                <mat-icon>check</mat-icon>
                I've Paid
              </button>
            }
          }
        </mat-dialog-actions>
      }
    </div>
  `,
  styles: [
    `
      .zap-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      .zap-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .confirmation-content {
        padding: 0;
      }

      .section {
        padding: 16px 0;
      }

      .section h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
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

      .amount-buttons button {
        padding: 12px 8px;
        font-size: 13px;
        font-weight: 500;
        border-radius: 8px;
        transition: all 0.2s ease;
      }

      .amount-buttons button.selected {
        background-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        border-color: var(--mat-sys-primary);
      }

      .amount-buttons button:hover:not(.selected) {
        background-color: var(--mat-sys-surface-variant);
        border-color: var(--mat-sys-primary);
      }

      .payment-method-buttons {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }

      .payment-method-buttons button {
        padding: 12px 8px;
        font-size: 12px;
        font-weight: 500;
        border-radius: 8px;
        transition: all 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }

      .payment-method-buttons button.selected {
        background-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        border-color: var(--mat-sys-primary);
      }

      .payment-method-buttons button:hover:not(.selected) {
        background-color: var(--mat-sys-surface-variant);
        border-color: var(--mat-sys-primary);
      }

      .payment-method-content {
        padding: 16px;
        min-height: 80px;
        background: var(--mat-sys-surface-container-low);
        border-radius: 8px;
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
        background: var(--mat-sys-surface-variant);
        color: var(--mat-sys-on-surface-variant);
      }

      .wallet-status.connected {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
      }

      .recipient-info {
        margin-bottom: 8px;
      }

      .event-context {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        margin-top: 8px;
        color: var(--mat-sys-on-surface-variant);
      }

      .event-context mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .amount-display {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 24px;
        font-weight: 500;
      }

      .amount-display mat-icon {
        color: var(--mat-sys-secondary);
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .amount {
        color: var(--mat-sys-primary);
      }

      .unit {
        color: var(--mat-sys-on-surface-variant);
        font-size: 16px;
      }

      .message-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .message-content mat-icon {
        color: var(--mat-sys-on-surface-variant);
        margin-top: 2px;
      }

      .message-content p {
        margin: 0;
        color: var(--mat-sys-on-surface);
        line-height: 1.4;
        word-break: break-word;
      }

      .method-description {
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 16px 0;
        line-height: 1.4;
      }

      .wallet-info {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--mat-sys-on-surface);
        margin-bottom: 8px;
      }

      .wallet-info mat-icon {
        color: var(--mat-sys-tertiary);
      }

      .processing-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--mat-sys-on-surface-variant);
        padding: 20px 0;
        justify-content: center;
      }

      .native-wallet-section {
        text-align: center;
      }

      .open-wallet-btn {
        margin: 16px 0;
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        justify-content: center;
      }

      .wallet-hint {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        margin: 8px 0 0 0;
      }

      .qr-code-section {
        text-align: center;
      }

      .qr-code-container {
        display: flex;
        justify-content: center;
        margin: 16px 0;
        padding: 16px;
        background: var(--mat-sys-surface-variant);
        border-radius: 8px;
      }

      .invoice-details {
        margin-top: 16px;
      }

      .invoice-label {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .invoice-text {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
        font-family: monospace;
        font-size: 12px;
        word-break: break-all;
        min-height: 0;
        justify-content: space-between;
        width: 100%;
      }

      .invoice-text:hover {
        background: var(--mat-sys-surface-container-high);
      }

      .invoice-text:focus {
        outline: 2px solid var(--mat-sys-primary);
        background: var(--mat-sys-surface-container-high);
      }

      .invoice-value {
        flex: 1;
        text-align: left;
        color: var(--mat-sys-on-surface);
      }

      .copy-icon {
        color: var(--mat-sys-on-surface-variant);
        font-size: 16px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .no-wallet-warning {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: var(--mat-sys-error-container);
        border: 1px solid var(--mat-sys-error);
        border-radius: 8px;
        margin-bottom: 16px;
      }

      .warning-icon {
        color: var(--mat-sys-error);
      }

      .no-wallet-warning p {
        margin: 0;
        color: var(--mat-sys-on-error-container);
      }

      .full-width {
        width: 100%;
      }

      .event-preview {
        background: var(--mat-sys-surface-container-low);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .event-preview h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: var(--mat-sys-on-surface-variant);
      }

      .event-content {
        margin: 0;
        font-style: italic;
        color: var(--mat-sys-on-surface);
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--mat-sys-error);
        background: var(--mat-sys-error-container);
        padding: 12px;
        border-radius: 4px;
        margin-top: 16px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 16px 0;
        color: var(--mat-sys-primary);
      }

      mat-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 0 0 0;
        margin: 0;
      }

      .confirm-button {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      mat-divider {
        margin: 8px 0;
      }

      @media (max-width: 480px) {
        .zap-dialog {
          min-width: 300px;
        }

        .amount-buttons {
          grid-template-columns: repeat(2, 1fr);
        }

        .payment-method-buttons {
          grid-template-columns: repeat(1, 1fr);
        }

        .payment-method-content {
          padding: 12px;
          min-height: 60px;
        }

        .qr-code-container qr-code {
          width: 150px;
          height: 150px;
        }
      }

      /* Dark mode support is handled via CSS custom properties */
    `,
  ],
})
export class ZapDialogComponent {
  private dialogRef = inject(MatDialogRef<ZapDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private wallets = inject(Wallets);
  private errorHandler = inject(ZapErrorHandlerService);
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);

  data: ZapDialogData = inject(MAT_DIALOG_DATA);

  // State management
  currentState = signal<DialogState>('input');
  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);
  selectedPaymentMethod = signal<PaymentMethod>('nwc');
  invoiceUrl = signal<string | null>(null);
  isMobile = signal(false);

  // Computed property for available wallets
  availableWallets = computed(() => {
    const walletsMap = this.wallets.wallets();
    return Object.entries(walletsMap).map(([id, wallet]) => ({
      id,
      name: wallet.name || 'Unknown Wallet',
      connected: wallet.connections && wallet.connections.length > 0,
    }));
  });

  // Helper to check for NWC wallets
  hasNwcWallet = computed(() => {
    try {
      const walletsMap = this.wallets.wallets ? this.wallets.wallets() : {};
      const entries = Object.entries(walletsMap);
      return entries.some(
        ([, w]) =>
          w &&
          (w as { connections?: unknown[] }).connections &&
          (w as { connections: unknown[] }).connections.length > 0,
      );
    } catch {
      return false;
    }
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

    // Check if on mobile device
    this.breakpointObserver.observe('(max-width: 768px)').subscribe((result) => {
      this.isMobile.set(result.matches);
    });
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

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedPaymentMethod.set(method);
  }

  proceedToConfirmation(): void {
    if (!this.zapForm.valid) {
      return;
    }
    this.currentState.set('confirmation');
  }

  backToInput(): void {
    this.currentState.set('input');
    this.invoiceUrl.set(null);
    this.isProcessing.set(false);
    this.errorMessage.set(null);
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return amount.toLocaleString();
  }

  getSelectedWalletName(): string {
    const selectedWalletId = this.zapForm.get('selectedWallet')?.value;
    const selectedWallet = this.availableWallets().find((w) => w.id === selectedWalletId);
    return selectedWallet?.name || 'No Wallet';
  }

  openCredentials(): void {
    // Navigate to credentials page where user can paste NWC connection string
    try {
      this.dialogRef.close({ confirmed: false });
      this.router.navigate(['/credentials']);
    } catch {
      // If navigation fails, fallback to opening new window with #/credentials
      window.location.href = '#/credentials';
    }
  }

  async generateInvoice(): Promise<void> {
    this.isProcessing.set(true);
    try {
      // Use ZapService to generate the actual invoice
      const invoice = await this.zapService.generateInvoiceForManualPayment(
        this.data.recipientPubkey,
        this.getFinalAmount(),
        this.zapForm.get('message')?.value || undefined,
        this.data.eventId,
        this.data.recipientMetadata,
      );

      this.invoiceUrl.set(invoice);
    } catch (error) {
      console.error('Failed to generate invoice:', error);
      this.snackBar.open('Failed to generate invoice. Please try again.', 'Dismiss', {
        duration: 3000,
      });
    } finally {
      this.isProcessing.set(false);
    }
  }

  openLightningWallet(): void {
    const invoice = this.invoiceUrl();
    if (!invoice) return;

    // Create lightning URL for mobile wallets
    const lightningUrl = `lightning:${invoice}`;

    // Try to open native lightning wallet
    if (this.isMobile()) {
      window.location.href = lightningUrl;
    } else {
      // For desktop, copy invoice to clipboard and show instructions
      this.copyInvoice();
      this.snackBar.open(
        'Invoice copied to clipboard. Open your Lightning wallet and paste it.',
        'Dismiss',
        {
          duration: 5000,
        },
      );
    }
  }

  copyInvoice(): void {
    const invoice = this.invoiceUrl();
    if (!invoice) return;

    navigator.clipboard
      .writeText(invoice)
      .then(() => {
        this.snackBar.open('Invoice copied to clipboard!', 'Dismiss', {
          duration: 2000,
        });
      })
      .catch(() => {
        this.snackBar.open('Failed to copy invoice. Please select and copy manually.', 'Dismiss', {
          duration: 3000,
        });
      });
  }

  truncateInvoice(invoice: string): string {
    if (invoice.length <= 20) return invoice;
    return `${invoice.substring(0, 10)}...${invoice.substring(invoice.length - 10)}`;
  }

  async confirmNwcPayment(): Promise<void> {
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
        paymentMethod: 'nwc',
      } as ZapDialogResult);
    } catch (error) {
      console.error('Failed to send zap:', error);
      const zapError = this.errorHandler.handleZapError(error);
      this.errorMessage.set(zapError.message);
    } finally {
      this.isProcessing.set(false);
    }
  }

  markAsPaid(): void {
    const amount = this.getFinalAmount();
    const message = this.zapForm.get('message')?.value || '';

    this.snackBar.open(
      `⚡ Payment initiated for ${amount} sats${this.data.recipientName ? ` to ${this.data.recipientName}` : ''}!`,
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
      paymentMethod: this.selectedPaymentMethod(),
      invoice: this.invoiceUrl(),
    } as ZapDialogResult);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
