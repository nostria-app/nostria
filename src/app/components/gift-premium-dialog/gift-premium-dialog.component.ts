import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { QrCodeComponent } from '../qr-code/qr-code.component';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { UtilitiesService } from '../../services/utilities.service';
import { PlatformService } from '../../services/platform.service';
import { InAppPurchaseService } from '../../services/in-app-purchase.service';
import { AccountStateService } from '../../services/account-state.service';
import { BITCOIN_PRICE_API } from '../../services/runes-settings.service';
import { environment } from '../../../environments/environment';

// Hardcoded Nostria Premium receiver
const NOSTRIA_PREMIUM_PUBKEY = '3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658';
const NOSTRIA_PREMIUM_LIGHTNING_ADDRESS = 'nostriapayment@coinos.io';

// Development mode pricing multiplier (10x cheaper in dev mode)
// const PRICE_MULTIPLIER = environment.production ? 1 : 0.1;
const PRICE_MULTIPLIER = environment.production ? 1 : 1;

interface BitcoinPrice {
  usd: number;
  eur: number;
  gbp: number;
}

export interface GiftPremiumDialogData {
  recipientPubkey: string;
  recipientName?: string;
  recipientMetadata?: Record<string, unknown>;
}

/**
 * Gift Premium data structure
 * 
 * Zap content format (clear text, order is important):
 * Line 1: "🎁 Nostria Premium Gift" (identifier)
 * Line 2: Receiver pubkey
 * Line 3: Subscription type ("premium" or "premium-plus")
 * Line 4: Duration in months ("1" or "3")
 * Line 5+: Optional user message (can span multiple lines)
 * 
 * Example:
 * 🎁 Nostria Premium Gift
 * npub1abc...
 * premium
 * 1
 * Happy birthday! Enjoy your month of Premium!
 */
export interface GiftPremiumData {
  receiver: string;
  message: string;
  subscription: 'premium' | 'premium-plus';
  duration: 1 | 3;
}

type PremiumType = 'premium' | 'premium-plus';
type Duration = 1 | 3;
type DialogState = 'input' | 'confirmation';
type PaymentMethod = 'nwc' | 'native' | 'manual';

@Component({
  selector: 'app-gift-premium-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatTooltipModule,
    ReactiveFormsModule,
    UserProfileComponent,
    QrCodeComponent,
  ],
  templateUrl: './gift-premium-dialog.component.html',
  styleUrls: ['./gift-premium-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GiftPremiumDialogComponent {
  dialogRef = inject(CustomDialogRef);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private wallets = inject(Wallets);
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);
  private utilities = inject(UtilitiesService);
  readonly platform = inject(PlatformService);
  readonly iap = inject(InAppPurchaseService);
  private accountState = inject(AccountStateService);

  data!: GiftPremiumDialogData;

  // State management
  currentState = signal<DialogState>('input');
  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);
  selectedPaymentMethod = signal<PaymentMethod>('nwc');
  invoiceUrl = signal<string | null>(null);
  bitcoinPrice = signal<BitcoinPrice | null>(null);
  loadingPrice = signal(true);
  showCelebration = signal(false);

  // Arrays for celebration particles
  confettiItems = Array.from({ length: 50 }, (_, i) => i);
  sparkleItems = Array.from({ length: 20 }, (_, i) => i);
  burstItems = Array.from({ length: 20 }, (_, i) => i);

  // Form and reactive state
  giftForm = new FormGroup({
    premiumType: new FormControl<PremiumType>('premium', [Validators.required]),
    duration: new FormControl<Duration>(1, [Validators.required]),
    message: new FormControl('', [Validators.maxLength(100)]),
    selectedWallet: new FormControl<string>(''),
  });

  // Convert observables to signals for automatic cleanup
  private formChanges = toSignal(this.giftForm.valueChanges, { initialValue: null });
  isMobile = toSignal(this.breakpointObserver.observe('(max-width: 768px)'), {
    initialValue: { matches: false, breakpoints: {} },
  });

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
          (w as { connections: unknown[] }).connections.length > 0
      );
    } catch {
      return false;
    }
  });

  // Computed amount based on selected premium type and duration
  totalAmount = computed(() => {
    // Track form changes to trigger reactivity
    this.formChanges();

    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;
    const price = this.bitcoinPrice();

    if (!price) {
      return 0;
    }

    // Calculate price in dollars
    const dollarAmount = premiumType === 'premium'
      ? (duration === 1 ? 10 : 30)
      : (duration === 1 ? 25 : 75);

    // Apply development mode discount (10x cheaper in dev mode)
    const adjustedDollarAmount = dollarAmount * PRICE_MULTIPLIER;

    // Convert to sats: (dollars / btc_price_in_dollars) * 100,000,000
    return Math.round((adjustedDollarAmount / price.usd) * 100000000);
  });

  // Computed pricing display text
  pricingInfo = computed<{ sats: number; usd: string } | null>(() => {
    // Track form changes to trigger reactivity
    this.formChanges();

    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;
    const amount = this.totalAmount();
    const price = this.bitcoinPrice();

    if (!price) {
      return null;
    }

    const dollarAmount = premiumType === 'premium'
      ? (duration === 1 ? 10 : 30)
      : (duration === 1 ? 25 : 75);

    // Apply development mode discount
    const adjustedDollarAmount = dollarAmount * PRICE_MULTIPLIER;

    return {
      sats: amount,
      usd: `$${adjustedDollarAmount}`,
    };
  });

  constructor() {
    // Fetch Bitcoin price
    this.fetchBitcoinPrice();

    // Set default wallet if only one is available
    const wallets = this.availableWallets();
    if (wallets.length === 1) {
      this.giftForm.get('selectedWallet')?.setValue(wallets[0].id);
    } else if (wallets.length > 1) {
      // Set the first connected wallet as default
      const connectedWallet = wallets.find(w => w.connected);
      if (connectedWallet) {
        this.giftForm.get('selectedWallet')?.setValue(connectedWallet.id);
      }
    }
  }

  async fetchBitcoinPrice(): Promise<void> {
    try {
      const response = await fetch(BITCOIN_PRICE_API);
      if (!response.ok) {
        throw new Error('Failed to fetch Bitcoin price');
      }
      const data = await response.json() as BitcoinPrice;
      this.bitcoinPrice.set(data);
    } catch (error) {
      console.error('Error fetching Bitcoin price:', error);
      // Set a fallback price if API fails (using ~$100k as fallback)
      this.bitcoinPrice.set({ usd: 100000, eur: 90000, gbp: 80000 });
    } finally {
      this.loadingPrice.set(false);
    }
  }

  getPremiumTypeName(type: PremiumType | null | undefined): string {
    if (!type) return 'Premium';
    return type === 'premium' ? 'Premium' : 'Premium+';
  }

  getDollarAmount(premiumType: 'premium' | 'premium-plus', duration: 1 | 3): number {
    const baseAmount = premiumType === 'premium'
      ? (duration === 1 ? 10 : 30)
      : (duration === 1 ? 25 : 75);
    return baseAmount * PRICE_MULTIPLIER;
  }

  getDurationText(duration: Duration | null | undefined): string {
    if (!duration) return '1 month';
    return duration === 1 ? '1 month' : '3 months';
  }

  proceedToConfirmation(): void {
    if (!this.giftForm.valid) {
      return;
    }

    this.currentState.set('confirmation');
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedPaymentMethod.set(method);
  }

  async generateInvoice(): Promise<void> {
    this.isProcessing.set(true);
    try {
      const amountInSats = this.totalAmount();
      const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
      const duration = this.giftForm.get('duration')?.value as Duration;
      const message = this.giftForm.get('message')?.value || '';

      // Create clear text format for zap content
      const zapContentLines = [
        '🎁 Nostria Premium Gift',
        this.data.recipientPubkey,
        premiumType,
        duration.toString(),
      ];

      if (message) {
        zapContentLines.push(message);
      }

      const zapContent = zapContentLines.join('\n');

      // Use ZapService to generate the actual invoice for Nostria Premium
      const invoice = await this.zapService.generateInvoiceForManualPayment(
        NOSTRIA_PREMIUM_PUBKEY,
        amountInSats,
        zapContent,
        undefined,
        { lud16: NOSTRIA_PREMIUM_LIGHTNING_ADDRESS }
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
    if (this.isMobile().matches) {
      window.location.href = lightningUrl;
    } else {
      // For desktop, copy invoice to clipboard and show instructions
      this.copyInvoice();
      this.snackBar.open(
        'Invoice copied to clipboard. Open your Lightning wallet and paste it.',
        'Dismiss',
        {
          duration: 5000,
        }
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
    return this.utilities.truncateInvoice(invoice);
  }

  getSelectedWalletName(): string {
    const selectedWalletId = this.giftForm.get('selectedWallet')?.value;
    const selectedWallet = this.availableWallets().find(w => w.id === selectedWalletId);
    return selectedWallet?.name || 'No Wallet';
  }

  openCredentials(): void {
    // Navigate to credentials tab where user can manage NWC connection
    try {
      this.dialogRef.close({ success: false });
      this.router.navigate(['/accounts'], { queryParams: { tab: 'credentials' } });
    } catch {
      // If navigation fails, fallback to redirect route
      window.location.href = '#/credentials';
    }
  }

  markAsPaid(): void {
    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;

    this.triggerCelebration();

    this.snackBar.open(
      `Payment initiated for ${this.getPremiumTypeName(premiumType)} gift (${this.getDurationText(duration)})!`,
      'Dismiss',
      {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      }
    );

    // Delay closing to show celebration
    setTimeout(() => {
      this.dialogRef.close({ success: true });
    }, 2500);
  }

  triggerCelebration(): void {
    this.showCelebration.set(true);
    // Auto-hide after animation completes
    setTimeout(() => {
      this.showCelebration.set(false);
    }, 3000);
  }

  backToInput(): void {
    this.currentState.set('input');
    this.invoiceUrl.set(null);
    this.isProcessing.set(false);
    this.errorMessage.set(null);
  }

  async confirmGift(): Promise<void> {
    if (!this.giftForm.valid || this.isProcessing()) {
      return;
    }

    // Only NWC payment method proceeds with automatic payment
    if (this.selectedPaymentMethod() !== 'nwc') {
      return;
    }

    this.isProcessing.set(true);
    this.errorMessage.set(null);

    try {
      const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
      const duration = this.giftForm.get('duration')?.value as Duration;
      const message = this.giftForm.get('message')?.value || '';

      // Create clear text format for zap content (order is important for parsing)
      // Line 1: Gift type identifier
      // Line 2: Receiver pubkey
      // Line 3: Subscription type (premium or premium-plus)
      // Line 4: Duration in months
      // Line 5+: Optional user message
      const zapContentLines = [
        '🎁 Nostria Premium Gift',
        this.data.recipientPubkey,
        premiumType,
        duration.toString(),
      ];

      if (message) {
        zapContentLines.push(message);
      }

      const zapContent = zapContentLines.join('\n');

      // Get the amount in sats
      const amountInSats = this.totalAmount();

      // Fetch BOTH the gift recipient's relays AND Nostria Premium's relays
      // This ensures the Lightning provider publishes the zap receipt to both sets of relays
      const [giftRecipientRelays, nostriaPremiumRelays] = await Promise.all([
        this.zapService.getRecipientRelays(this.data.recipientPubkey),
        this.zapService.getRecipientRelays(NOSTRIA_PREMIUM_PUBKEY),
      ]);

      // Combine both sets of relays, removing duplicates
      const combinedRelays = [...new Set([...giftRecipientRelays, ...nostriaPremiumRelays])];

      // Send the zap to the hardcoded Nostria Premium receiver
      // The payment goes to Nostria, not to the recipient
      // But we include BOTH the gift recipient's and Nostria's relays in the zap request
      await this.zapService.sendZap(
        NOSTRIA_PREMIUM_PUBKEY, // Always send to Nostria Premium pubkey
        amountInSats,
        zapContent, // Pass the serialized JSON as the message
        undefined, // No event ID
        { lud16: NOSTRIA_PREMIUM_LIGHTNING_ADDRESS }, // Use hardcoded lightning address
        combinedRelays // Include both gift recipient's and Nostria's relays
      );

      this.triggerCelebration();

      this.snackBar.open(
        `Successfully gifted ${this.getPremiumTypeName(premiumType)} for ${this.getDurationText(duration)}!`,
        'Dismiss',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        }
      );

      // Delay closing to show celebration
      setTimeout(() => {
        this.dialogRef.close({ success: true });
      }, 2500);
    } catch (error) {
      console.error('Failed to send gift premium zap:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send gift. Please try again.';

      this.errorMessage.set(errorMessage);

      this.snackBar.open(errorMessage, 'Dismiss', {
        duration: 6000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Purchase a gift subscription via Google Play Store (Android native).
   */
  async purchaseGiftWithPlayStore(): Promise<void> {
    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;
    if (!premiumType || !duration) return;

    const tier = premiumType === 'premium' ? 'premium' : 'premium_plus';
    const productId = this.iap.getGiftProductId(tier as 'premium' | 'premium_plus', duration);
    if (!productId) {
      this.snackBar.open('Gift product not available in store.', 'Close', { duration: 5000 });
      return;
    }

    this.isProcessing.set(true);
    try {
      const result = await this.iap.purchaseWithPlayStore(productId);
      if (result.success && result.purchaseToken) {
        const verified = await this.iap.verifyPurchaseWithBackend(
          result.purchaseToken,
          this.accountState.pubkey(),
          'play-store'
        );

        if (verified) {
          this.triggerCelebration();
          this.snackBar.open(
            `Successfully gifted ${this.getPremiumTypeName(premiumType)} for ${this.getDurationText(duration)}!`,
            'Dismiss',
            { duration: 5000 }
          );
          setTimeout(() => this.dialogRef.close({ success: true }), 2500);
        } else {
          this.snackBar.open(
            'Purchase completed but verification failed. Please contact support.',
            'Close',
            { duration: 8000 }
          );
        }
      } else if (result.error && result.error !== 'Purchase cancelled by user') {
        this.snackBar.open(`Purchase failed: ${result.error}`, 'Close', { duration: 5000 });
      }
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Purchase a gift subscription via Apple App Store (iOS native).
   */
  async purchaseGiftWithAppStore(): Promise<void> {
    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;
    if (!premiumType || !duration) return;

    const tier = premiumType === 'premium' ? 'premium' : 'premium_plus';
    const productId = this.iap.getGiftProductId(tier as 'premium' | 'premium_plus', duration);
    if (!productId) {
      this.snackBar.open('Gift product not available in store.', 'Close', { duration: 5000 });
      return;
    }

    this.isProcessing.set(true);
    try {
      const result = await this.iap.purchaseWithAppStore(productId);
      if (result.success && result.purchaseToken) {
        const verified = await this.iap.verifyPurchaseWithBackend(
          result.purchaseToken,
          this.accountState.pubkey(),
          'app-store'
        );

        if (verified) {
          this.triggerCelebration();
          this.snackBar.open(
            `Successfully gifted ${this.getPremiumTypeName(premiumType)} for ${this.getDurationText(duration)}!`,
            'Dismiss',
            { duration: 5000 }
          );
          setTimeout(() => this.dialogRef.close({ success: true }), 2500);
        } else {
          this.snackBar.open(
            'Purchase completed but verification failed. Please contact support.',
            'Close',
            { duration: 8000 }
          );
        }
      } else if (result.error && result.error !== 'Purchase cancelled by user') {
        this.snackBar.open(`Purchase failed: ${result.error}`, 'Close', { duration: 5000 });
      }
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Open external gift payment URL (fallback).
   */
  openExternalGiftPayment(): void {
    const premiumType = this.giftForm.get('premiumType')?.value as PremiumType;
    const duration = this.giftForm.get('duration')?.value as Duration;
    const tier = premiumType === 'premium' ? 'premium' : 'premium_plus';

    this.iap.openExternalGiftUrl(
      this.accountState.pubkey(),
      this.data.recipientPubkey,
      tier,
      duration
    );

    // Close the dialog after redirecting
    setTimeout(() => this.dialogRef.close({ success: false }), 1000);
  }

  onCancel(): void {
    this.dialogRef.close({ success: false });
  }

  close(): void {
    this.dialogRef.close({ success: false });
  }

  openWalletSettings(): void {
    this.router.navigate(['/settings'], { queryParams: { tab: 'wallets' } });
    this.dialogRef.close({ success: false });
  }
}
