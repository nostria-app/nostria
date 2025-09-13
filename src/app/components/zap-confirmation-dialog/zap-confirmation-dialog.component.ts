import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BreakpointObserver } from '@angular/cdk/layout';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { QrCodeComponent } from '../qr-code/qr-code.component';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';

export interface ZapConfirmationData {
  recipient: {
    name?: string;
    displayName?: string;
    pubkey: string;
    picture?: string;
    metadata?: Record<string, unknown>;
  };
  amount: number;
  message?: string;
  wallet: {
    id: string;
    name: string;
  };
  eventTitle?: string;
  isProfileZap: boolean;
  eventId?: string;
  invoice?: string; // Lightning invoice for manual payment options
}

export type PaymentMethod = 'nwc' | 'native' | 'manual';

@Component({
  selector: 'app-zap-confirmation-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    QrCodeComponent,
  ],
  template: `
    <div class="confirmation-dialog">
      <h2 mat-dialog-title>
        <mat-icon>bolt</mat-icon>
        Confirm Lightning Zap
      </h2>

      <mat-dialog-content>
        <div class="confirmation-content">
          <!-- Recipient Info -->
          <div class="recipient-section">
            <h3>Zapping</h3>
            <div class="recipient-info">
              <app-user-profile [pubkey]="data.recipient.pubkey"></app-user-profile>
            </div>
            @if (data.eventTitle) {
              <div class="event-context">
                <mat-icon>article</mat-icon>
                <span>{{ data.eventTitle }}</span>
              </div>
            } @else if (data.isProfileZap) {
              <div class="event-context">
                <mat-icon>person</mat-icon>
                <span>Profile zap</span>
              </div>
            }
          </div>

          <mat-divider></mat-divider>

          <!-- Amount -->
          <div class="amount-section">
            <h3>Amount</h3>
            <div class="amount-display">
              <mat-icon>bolt</mat-icon>
              <span class="amount">{{ formatAmount(data.amount) }}</span>
              <span class="unit">sats</span>
            </div>
          </div>

          <mat-divider></mat-divider>

          <!-- Message -->
          @if (data.message) {
            <div class="message-section">
              <h3>Message</h3>
              <div class="message-content">
                <mat-icon>message</mat-icon>
                <p>{{ data.message }}</p>
              </div>
            </div>
            <mat-divider></mat-divider>
          }

          <!-- Payment Method Selection -->
          <div class="payment-method-section">
            <h3>Choose Payment Method</h3>

            <div class="payment-method-buttons">
              <button
                mat-stroked-button
                (click)="selectPayment('nwc')"
                [class.selected]="selectedPaymentMethod() === 'nwc'"
              >
                <mat-icon>account_balance_wallet</mat-icon>
                Wallet Connect
              </button>

              <button
                mat-stroked-button
                (click)="selectPayment('native')"
                [class.selected]="selectedPaymentMethod() === 'native'"
              >
                <mat-icon>smartphone</mat-icon>
                Lightning Wallet
              </button>

              <button
                mat-stroked-button
                (click)="selectPayment('manual')"
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
                  <span>{{ data.wallet.name }}</span>
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
        <button mat-button (click)="cancel()" [disabled]="isProcessing()">Cancel</button>

        @if (selectedPaymentMethod() === 'nwc') {
          <button
            mat-flat-button
            color="primary"
            (click)="confirmNwcPayment()"
            class="confirm-button"
            [disabled]="isProcessing()"
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
        } @else if (selectedPaymentMethod() === 'native' || selectedPaymentMethod() === 'manual') {
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
    </div>
  `,
  styles: [
    `
      .confirmation-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 16px 0;
        color: #1976d2;
      }

      .confirmation-content {
        padding: 0;
      }

      .recipient-section,
      .amount-section,
      .message-section,
      .payment-method-section {
        padding: 16px 0;
      }

      .recipient-section h3,
      .amount-section h3,
      .message-section h3,
      .payment-method-section h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 500;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .recipient-info {
        margin-bottom: 8px;
      }

      .event-context {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #666;
        font-size: 14px;
        margin-top: 8px;
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
        color: #ff9800;
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .amount {
        color: #1976d2;
      }

      .unit {
        color: #666;
        font-size: 16px;
      }

      .message-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .message-content mat-icon {
        color: #666;
        margin-top: 2px;
      }

      .message-content p {
        margin: 0;
        color: #333;
        line-height: 1.4;
        word-break: break-word;
      }

      .payment-method-content {
        padding: 16px;
        min-height: 120px;
      }

      .method-description {
        color: #666;
        margin: 0 0 16px 0;
        line-height: 1.4;
      }

      .wallet-info {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #333;
        margin-bottom: 8px;
      }

      .wallet-info mat-icon {
        color: #4caf50;
      }

      .processing-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #666;
        padding: 20px 0;
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
        color: #666;
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
        background: #f9f9f9;
        border-radius: 8px;
      }

      .invoice-details {
        margin-top: 16px;
      }

      .invoice-label {
        font-size: 12px;
        color: #666;
        margin: 0 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .invoice-text {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
        font-family: monospace;
        font-size: 12px;
        word-break: break-all;
        min-height: 0;
        justify-content: space-between;
      }

      .invoice-text:hover {
        background: #eeeeee;
      }

      .invoice-text:focus {
        outline: 2px solid #1976d2;
        background: #eeeeee;
      }

      .invoice-value {
        flex: 1;
        text-align: left;
      }

      .copy-icon {
        color: #666;
        font-size: 16px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
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

      ::ng-deep .mat-mdc-tab-group .mat-mdc-tab-label {
        min-width: 0 !important;
        padding: 0 16px !important;
      }

      ::ng-deep .mat-mdc-tab-label-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      ::ng-deep .mat-mdc-tab-label mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      @media (max-width: 480px) {
        .confirmation-dialog {
          min-width: 300px;
        }

        .payment-method-content {
          padding: 12px;
          min-height: 100px;
        }

        .qr-code-container qr-code {
          width: 150px;
          height: 150px;
        }

        ::ng-deep .mat-mdc-tab-label-content {
          flex-direction: column;
          gap: 4px;
        }

        ::ng-deep .mat-mdc-tab-label {
          padding: 0 8px !important;
        }

        ::ng-deep .mat-mdc-tab-label span {
          font-size: 11px;
        }
      }
    `,
  ],
})
export class ZapConfirmationDialogComponent {
  private dialogRef = inject(MatDialogRef<ZapConfirmationDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private breakpointObserver = inject(BreakpointObserver);
  private zapService = inject(ZapService);
  private router = inject(Router);
  private wallets = inject(Wallets);
  protected data = inject<ZapConfirmationData>(MAT_DIALOG_DATA);

  // State management
  selectedTabIndex = signal(0);
  selectedPaymentMethod = computed((): PaymentMethod => {
    const index = this.selectedTabIndex();
    switch (index) {
      case 0:
        return 'nwc';
      case 1:
        return 'native';
      case 2:
        return 'manual';
      default:
        return 'nwc';
    }
  });

  isProcessing = signal(false);
  invoiceUrl = signal<string | null>(null);
  isMobile = signal(false);

  // Helper to check for NWC wallets
  hasNwcWallet = computed(() => {
    try {
      const walletsMap = this.wallets.wallets ? this.wallets.wallets() : {};
      const entries = Object.entries(walletsMap) as [string, any][];
      return entries.some(([, w]) => w && w.connections && w.connections.length > 0);
    } catch {
      return false;
    }
  });

  selectPayment(method: PaymentMethod): void {
    switch (method) {
      case 'nwc':
        this.selectedTabIndex.set(0);
        break;
      case 'native':
        this.selectedTabIndex.set(1);
        break;
      case 'manual':
        this.selectedTabIndex.set(2);
        break;
    }
  }

  openCredentials(): void {
    // Navigate to credentials page where user can paste NWC connection string
    try {
      this.dialogRef.close({ confirmed: false });
      this.router.navigate(['/credentials']);
    } catch (e) {
      // If navigation fails, fallback to opening new window with #/credentials
      window.location.href = '#/credentials';
    }
  }

  constructor() {
    // Check if on mobile device
    this.breakpointObserver.observe('(max-width: 768px)').subscribe((result) => {
      this.isMobile.set(result.matches);
    });

    // If invoice is already provided, set it
    if (this.data.invoice) {
      this.invoiceUrl.set(this.data.invoice);
    }
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return amount.toLocaleString();
  }

  onTabChange(event: { index: number }): void {
    this.selectedTabIndex.set(event.index);
  }

  async generateInvoice(): Promise<void> {
    this.isProcessing.set(true);
    try {
      // Use ZapService to generate the actual invoice
      const invoice = await this.zapService.generateInvoiceForManualPayment(
        this.data.recipient.pubkey,
        this.data.amount,
        this.data.message,
        this.data.eventId,
        this.data.recipient.metadata,
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
    this.dialogRef.close({
      confirmed: true,
      paymentMethod: 'nwc',
    });
  }

  markAsPaid(): void {
    this.dialogRef.close({
      confirmed: true,
      paymentMethod: this.selectedPaymentMethod(),
      invoice: this.invoiceUrl(),
    });
  }

  cancel(): void {
    this.dialogRef.close({
      confirmed: false,
    });
  }
}
