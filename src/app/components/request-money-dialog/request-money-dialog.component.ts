import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { Wallets } from '../../services/wallets';
import { MessagingService } from '../../services/messaging.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { SatDisplayService } from '../../services/sat-display.service';
import { SatAmountComponent } from '../sat-amount/sat-amount.component';

export interface RequestMoneyDialogData {
  recipientPubkey: string;
}

export interface RequestMoneyDialogResult {
  success: boolean;
  amountSats: number;
  invoice: string;
}

interface WalletOption {
  pubkey: string;
  name: string;
  connectionString: string;
  isPrimary: boolean;
}

interface ExpiryOption {
  label: string;
  seconds: number;
}


@Component({
  selector: 'app-request-money-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatSelectModule,
    UserProfileComponent,
    SatAmountComponent,
  ],
  templateUrl: './request-money-dialog.component.html',
  styleUrl: './request-money-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestMoneyDialogComponent {
  private snackBar = inject(MatSnackBar);
  private wallets = inject(Wallets);
  private messagingService = inject(MessagingService);
  private satDisplay = inject(SatDisplayService);
  dialogRef = inject(CustomDialogRef);

  data!: RequestMoneyDialogData;

  // Form controls
  satsControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);
  dollarsControl = new FormControl<number | null>(null, [
    Validators.min(0.01),
  ]);
  memoControl = new FormControl<string>('');

  // State signals
  isGenerating = signal(false);
  isConverting = signal(false);
  invoiceGenerated = signal(false);
  generatedInvoice = signal<string | null>(null);
  generationError = signal<string | null>(null);
  hasWallet = computed(() => this.wallets.hasWallets());
  inputMode = signal<'sats' | 'dollars'>('sats');

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
  selectedWalletValue = computed(() => this.selectedWallet()?.pubkey ?? null);

  // Cached exchange rate (sats per dollar)
  private satsPerDollar = signal<number | null>(null);

  // Quick amount presets (in sats)
  quickAmounts = [100, 500, 1000, 5000, 10000, 50000];

  // Expiry options
  expiryOptions: ExpiryOption[] = [
    { label: '1 day', seconds: 86400 },
    { label: '1 week', seconds: 604800 },
    { label: '1 month', seconds: 2592000 },
  ];
  selectedExpiry = signal<number>(86400); // default 1 day

  // Conversion tracking
  private conversionTimeout: ReturnType<typeof setTimeout> | null = null;

  async initialize(): Promise<void> {
    if (!this.data?.recipientPubkey) return;

    // Set default selected wallet to primary
    const primary = this.walletOptions().find(w => w.isPrimary);
    if (primary) {
      this.selectedWalletPubkey.set(primary.pubkey);
    }

    // Fetch exchange rate for quick amount USD display
    this.fetchExchangeRate();
  }

  private async fetchExchangeRate(): Promise<void> {
    const rate = await this.satDisplay.getSatsPerDollar();
    this.satsPerDollar.set(rate);
  }

  satsToUsd(sats: number): string | null {
    const rate = this.satsPerDollar();
    if (!rate || rate <= 0) return null;
    return this.satDisplay.formatUsdValue(sats / rate);
  }

  selectQuickAmount(sats: number): void {
    this.satsControl.setValue(sats);
    this.inputMode.set('sats');
    this.convertSatsToDollars(sats);
  }

  onWalletSelected(pubkey: string): void {
    this.selectedWalletPubkey.set(pubkey);
  }

  onExpirySelected(seconds: number): void {
    this.selectedExpiry.set(seconds);
  }

  async onSatsChanged(): Promise<void> {
    if (this.inputMode() !== 'sats') return;

    const sats = this.satsControl.value;
    if (!sats || sats <= 0) {
      this.dollarsControl.setValue(null, { emitEvent: false });
      return;
    }

    this.convertSatsToDollars(sats);
  }

  async onDollarsChanged(): Promise<void> {
    if (this.inputMode() !== 'dollars') return;

    const dollars = this.dollarsControl.value;
    if (!dollars || dollars <= 0) {
      this.satsControl.setValue(null, { emitEvent: false });
      return;
    }

    this.convertDollarsToSats(dollars);
  }

  setInputMode(mode: 'sats' | 'dollars'): void {
    this.inputMode.set(mode);
  }

  private async convertSatsToDollars(sats: number): Promise<void> {
    if (this.conversionTimeout) {
      clearTimeout(this.conversionTimeout);
    }

    this.conversionTimeout = setTimeout(async () => {
      this.isConverting.set(true);
      try {
        const satsPerDollar = await this.satDisplay.getSatsPerDollar();
        if (typeof satsPerDollar === 'number' && satsPerDollar > 0) {
          this.satsPerDollar.set(satsPerDollar);
          const dollars = sats / satsPerDollar;
          this.dollarsControl.setValue(Math.round(dollars * 100) / 100, { emitEvent: false });
        }
      } catch {
        // Conversion failed silently
      } finally {
        this.isConverting.set(false);
      }
    }, 300);
  }

  private async convertDollarsToSats(dollars: number): Promise<void> {
    if (this.conversionTimeout) {
      clearTimeout(this.conversionTimeout);
    }

    this.conversionTimeout = setTimeout(async () => {
      this.isConverting.set(true);
      try {
        const sats = await this.satDisplay.convertUsdToSats(dollars);
        if (typeof sats === 'number' && sats > 0) {
          this.satsPerDollar.set(dollars > 0 ? sats / dollars : null);
          this.satsControl.setValue(Math.round(sats), { emitEvent: false });
        }
      } catch {
        // Conversion failed silently
      } finally {
        this.isConverting.set(false);
      }
    }, 300);
  }

  async generateInvoice(): Promise<void> {
    const sats = this.satsControl.value;
    if (!sats || sats <= 0) {
      this.snackBar.open('Please enter an amount', 'Dismiss', {
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

    this.isGenerating.set(true);
    this.generationError.set(null);
    this.invoiceGenerated.set(false);

    try {
      const wallet = this.selectedWallet();
      if (!wallet?.connectionString) {
        throw new Error('No wallet connection available');
      }

      const memo = this.memoControl.value?.trim() || '';

      // Create NWC client and generate invoice
      const { NWCClient } = await import('@getalby/sdk');
      const nwcClient = new NWCClient({
        nostrWalletConnectUrl: wallet.connectionString,
      });

      const amountMsats = sats * 1000;
      const invoiceResult = await nwcClient.makeInvoice({
        amount: amountMsats,
        description: memo || 'Payment request',
        expiry: this.selectedExpiry(),
      });

      const invoice = typeof invoiceResult.invoice === 'string' ? invoiceResult.invoice : null;
      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      this.generatedInvoice.set(invoice);

      // Send the invoice as a DM (same content for both parties to preserve reaction compatibility)
      const formattedAmount = sats.toLocaleString();
      const messageText = memo
        ? `Payment request for ${formattedAmount} sats: ${memo}\n\n${invoice}`
        : `Payment request for ${formattedAmount} sats.\n\n${invoice}`;

      await this.messagingService.sendPaymentNotification(messageText, this.data.recipientPubkey);

      this.invoiceGenerated.set(true);
      this.snackBar.open('Invoice sent!', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      // Close dialog after brief success display
      setTimeout(() => {
        this.dialogRef.close({ success: true, amountSats: sats, invoice } as RequestMoneyDialogResult);
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate invoice. Please try again.';
      this.generationError.set(message);
      this.snackBar.open(message, 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isGenerating.set(false);
    }
  }

  formatSats(sats: number): string {
    return this.satDisplay.getDisplayValueFromSats(sats, { showUnit: false }).value;
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
