import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { Wallets } from '../../services/wallets';

export interface PayInvoiceDialogData {
  invoice: string;
  amountSats: number;
  description?: string;
  expiry?: number;
  timestamp?: number;
}

export interface PayInvoiceDialogResult {
  success: boolean;
  preimage?: string;
}

interface WalletOption {
  pubkey: string;
  name: string;
  connectionString: string;
  isPrimary: boolean;
}

@Component({
  selector: 'app-pay-invoice-dialog',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
  ],
  templateUrl: './pay-invoice-dialog.component.html',
  styleUrl: './pay-invoice-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayInvoiceDialogComponent {
  private snackBar = inject(MatSnackBar);
  private wallets = inject(Wallets);
  dialogRef = inject(CustomDialogRef);

  data!: PayInvoiceDialogData;

  // State signals
  isPaying = signal(false);
  paymentSuccess = signal(false);
  paymentError = signal<string | null>(null);

  // Wallet selection
  walletOptions = computed<WalletOption[]>(() => {
    const walletsMap = this.wallets.wallets();
    return Object.entries(walletsMap).map(([pubkey, wallet]) => ({
      pubkey,
      name: wallet.name || pubkey.substring(0, 8) + '...',
      connectionString: wallet.connections[0],
      isPrimary: wallet.isPrimary ?? false,
    }));
  });
  hasWallet = computed(() => this.wallets.hasWallets());
  hasMultipleWallets = computed(() => this.walletOptions().length > 1);
  selectedWalletPubkey = signal<string | null>(null);

  selectedWallet = computed(() => {
    const options = this.walletOptions();
    const selected = this.selectedWalletPubkey();
    if (selected) {
      return options.find(w => w.pubkey === selected) ?? options[0] ?? null;
    }
    return options.find(w => w.isPrimary) ?? options[0] ?? null;
  });

  isExpired = computed(() => {
    const expiry = this.data?.expiry;
    const timestamp = this.data?.timestamp;
    if (!expiry || !timestamp) return false;
    const expiryTime = timestamp + expiry;
    return Math.floor(Date.now() / 1000) > expiryTime;
  });

  expiryDate = computed(() => {
    const expiry = this.data?.expiry;
    const timestamp = this.data?.timestamp;
    if (!expiry || !timestamp) return null;
    return new Date((timestamp + expiry) * 1000);
  });

  initialize(): void {
    // Set default selected wallet to primary
    const primary = this.walletOptions().find(w => w.isPrimary);
    if (primary) {
      this.selectedWalletPubkey.set(primary.pubkey);
    }
  }

  onWalletSelected(pubkey: string): void {
    this.selectedWalletPubkey.set(pubkey);
  }

  formatSats(sats: number): string {
    return sats.toLocaleString();
  }

  async payInvoice(): Promise<void> {
    if (!this.data?.invoice) return;

    if (this.isExpired()) {
      this.snackBar.open('This invoice has expired.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    if (!this.hasWallet()) {
      this.snackBar.open('No wallet connected. Please connect a wallet first.', 'Setup', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    this.isPaying.set(true);
    this.paymentError.set(null);
    this.paymentSuccess.set(false);

    try {
      const wallet = this.selectedWallet();
      if (!wallet?.connectionString) {
        throw new Error('No wallet connection available');
      }

      const { NWCClient } = await import('@getalby/sdk');
      const nwcClient = new NWCClient({
        nostrWalletConnectUrl: wallet.connectionString,
      });

      const result = await nwcClient.payInvoice({ invoice: this.data.invoice });

      this.paymentSuccess.set(true);
      this.snackBar.open(
        `Paid ${this.formatSats(this.data.amountSats)} sats successfully!`,
        'Dismiss',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        }
      );

      // Close dialog after brief success display
      setTimeout(() => {
        this.dialogRef.close({
          success: true,
          preimage: typeof result.preimage === 'string' ? result.preimage : undefined,
        } as PayInvoiceDialogResult);
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed. Please try again.';
      this.paymentError.set(message);
      this.snackBar.open(message, 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isPaying.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
