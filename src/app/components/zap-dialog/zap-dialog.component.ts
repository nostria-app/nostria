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
  templateUrl: './zap-dialog.component.html',
  styleUrls: ['./zap-dialog.component.scss'],
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
