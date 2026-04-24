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
import { ZapService } from '../../services/zap.service';
import { Wallets, Wallet } from '../../services/wallets';
import { DataService } from '../../services/data.service';
import { MessagingService } from '../../services/messaging.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { SatDisplayService } from '../../services/sat-display.service';
import { SatAmountComponent } from '../sat-amount/sat-amount.component';

interface LnurlPayInfo {
  callback: string;
  maxSendable: number;
  minSendable: number;
  commentAllowed?: number;
}

export interface SendMoneyDialogData {
  recipientPubkey: string;
}

export interface SendMoneyDialogResult {
  success: boolean;
  amountSats: number;
}

interface WalletOption {
  pubkey: string;
  name: string;
  connectionString: string;
  isPrimary: boolean;
}

@Component({
  selector: 'app-send-money-dialog',
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
  templateUrl: './send-money-dialog.component.html',
  styleUrl: './send-money-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendMoneyDialogComponent {
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private wallets = inject(Wallets);
  private dataService = inject(DataService);
  private messagingService = inject(MessagingService);
  private satDisplay = inject(SatDisplayService);
  dialogRef = inject(CustomDialogRef);

  data!: SendMoneyDialogData;

  // Form controls
  satsControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);
  dollarsControl = new FormControl<number | null>(null, [
    Validators.min(0.01),
  ]);
  commentControl = new FormControl<string>('');

  // State signals
  isSending = signal(false);
  isConverting = signal(false);
  isResolvingLnAddress = signal(false);
  paymentSuccess = signal(false);
  paymentError = signal<string | null>(null);
  lightningAddress = signal<string | null>(null);
  lnurlPayInfo = signal<LnurlPayInfo | null>(null);
  commentAllowed = computed(() => this.lnurlPayInfo()?.commentAllowed ?? 0);
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

    this.isResolvingLnAddress.set(true);
    try {
      const profile = await this.dataService.getProfile(this.data.recipientPubkey);
      if (profile?.data) {
        const lnAddress = this.zapService.getLightningAddress(profile.data);
        this.lightningAddress.set(lnAddress);

        // Pre-fetch LNURL pay info to get commentAllowed
        if (lnAddress) {
          try {
            const payInfo = await this.zapService.fetchLnurlPayInfo(lnAddress);
            this.lnurlPayInfo.set(payInfo);
            if (payInfo.commentAllowed && payInfo.commentAllowed > 0) {
              this.commentControl.setValidators([Validators.maxLength(payInfo.commentAllowed)]);
              this.commentControl.updateValueAndValidity();
            }
          } catch {
            // LNURL info fetch failed - will retry at payment time
          }
        }
      }
    } catch {
      // Silently fail - user can still attempt payment
    } finally {
      this.isResolvingLnAddress.set(false);
    }
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

  async onSatsChanged(): Promise<void> {
    if (this.inputMode() !== 'sats') return;

    const sats = this.satsControl.value;
    if (!sats || sats <= 0) {
      this.dollarsControl.setValue(null, { emitEvent: false });
      return;
    }

    // Convert sats to USD
    this.convertSatsToDollars(sats);
  }

  async onDollarsChanged(): Promise<void> {
    if (this.inputMode() !== 'dollars') return;

    const dollars = this.dollarsControl.value;
    if (!dollars || dollars <= 0) {
      this.satsControl.setValue(null, { emitEvent: false });
      return;
    }

    // Convert USD to sats
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

  async sendPayment(): Promise<void> {
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

    const lnAddress = this.lightningAddress();
    if (!lnAddress) {
      this.snackBar.open('Recipient has no Lightning address configured.', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    this.isSending.set(true);
    this.paymentError.set(null);
    this.paymentSuccess.set(false);

    try {
      // Use cached LNURL pay info or fetch fresh
      const lnurlInfo = this.lnurlPayInfo() ?? await this.zapService.fetchLnurlPayInfo(lnAddress);

      // Convert sats to millisats for LNURL
      const amountMsats = sats * 1000;

      // Validate amount against LNURL limits
      if (amountMsats < lnurlInfo.minSendable) {
        throw new Error(`Minimum amount is ${Math.ceil(lnurlInfo.minSendable / 1000)} sats`);
      }
      if (amountMsats > lnurlInfo.maxSendable) {
        throw new Error(`Maximum amount is ${Math.floor(lnurlInfo.maxSendable / 1000)} sats`);
      }

      // Build the LNURL callback URL (plain payment, no zap request)
      let requestUrl = `${lnurlInfo.callback}?amount=${amountMsats}`;

      // Add comment if allowed and provided
      const comment = this.commentControl.value?.trim();
      if (comment) {
        if (lnurlInfo.commentAllowed && comment.length > lnurlInfo.commentAllowed) {
          throw new Error(`Comment too long. Maximum ${lnurlInfo.commentAllowed} characters allowed.`);
        }
        requestUrl += `&comment=${encodeURIComponent(comment)}`;
      }

      const response = await fetch(requestUrl);
      if (!response.ok) {
        throw new Error(`Failed to get invoice: HTTP ${response.status}`);
      }
      const invoiceData = await response.json();
      if (!invoiceData.pr) {
        throw new Error('No invoice received from recipient');
      }

      // Pay the invoice using the selected wallet
      const wallet = this.selectedWallet();
      if (!wallet?.connectionString) {
        throw new Error('No wallet connection available');
      }

      const { LN } = await import('@getalby/sdk');
      const ln = new LN(wallet.connectionString);
      try {
        await ln.pay(invoiceData.pr);
      } finally {
        ln.close();
      }

      // Send payment notification DM (same content for both parties to preserve reaction compatibility)
      const formattedAmount = sats.toLocaleString();
      const messageText = comment
        ? `${formattedAmount} sats was transferred: ${comment}`
        : `${formattedAmount} sats was transferred.`;

      try {
        await this.messagingService.sendPaymentNotification(messageText, this.data.recipientPubkey);
      } catch {
        // Payment succeeded but DM notification failed — don't block the success flow
      }

      this.paymentSuccess.set(true);
      this.snackBar.open(`Sent ${sats.toLocaleString()} sats successfully!`, 'Dismiss', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      // Close dialog after brief success display
      setTimeout(() => {
        this.dialogRef.close({ success: true, amountSats: sats } as SendMoneyDialogResult);
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
      this.isSending.set(false);
    }
  }

  formatSats(sats: number): string {
    return this.satDisplay.getDisplayValueFromSats(sats, { showUnit: false }).value;
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
