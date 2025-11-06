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
import { MatRadioModule } from '@angular/material/radio';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';
import { environment } from '../../../environments/environment';

// Hardcoded Nostria Premium receiver
const NOSTRIA_PREMIUM_PUBKEY = '3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658';
const NOSTRIA_PREMIUM_LIGHTNING_ADDRESS = 'rudeshears26@walletofsatoshi.com';

// Bitcoin price API
const BITCOIN_PRICE_API = 'https://pay.ariton.app/price';

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
  standalone: true,
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
    MatRadioModule,
    MatCardModule,
    MatTooltipModule,
    ReactiveFormsModule,
    UserProfileComponent,
  ],
  templateUrl: './gift-premium-dialog.component.html',
  styleUrls: ['./gift-premium-dialog.component.scss'],
})
export class GiftPremiumDialogComponent {
  private dialogRef = inject(MatDialogRef<GiftPremiumDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private wallets = inject(Wallets);
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);

  data: GiftPremiumDialogData = inject(MAT_DIALOG_DATA);

  // State management
  currentState = signal<DialogState>('input');
  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);
  selectedPaymentMethod = signal<PaymentMethod>('nwc');
  invoiceUrl = signal<string | null>(null);
  isMobile = signal(false);
  bitcoinPrice = signal<BitcoinPrice | null>(null);
  loadingPrice = signal(true);

  // Track form changes for reactive updates
  private formChanged = signal(0);

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
    this.formChanged();

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
    this.formChanged();

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

  giftForm = new FormGroup({
    premiumType: new FormControl<PremiumType>('premium', [Validators.required]),
    duration: new FormControl<Duration>(1, [Validators.required]),
    message: new FormControl('', [Validators.maxLength(100)]),
    selectedWallet: new FormControl<string>(''),
  });

  constructor() {
    // Fetch Bitcoin price
    this.fetchBitcoinPrice();

    // Subscribe to form changes to trigger computed updates
    this.giftForm.valueChanges.subscribe(() => {
      this.formChanged.update(v => v + 1);
    });

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

    // Check if on mobile device
    this.breakpointObserver.observe('(max-width: 768px)').subscribe(result => {
      this.isMobile.set(result.matches);
    });
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

    // Validate that recipient has lightning address
    const lightningAddress = this.zapService.getLightningAddress(
      this.data.recipientMetadata || {}
    );

    if (!lightningAddress) {
      this.errorMessage.set('Recipient does not have a Lightning address configured');
      this.snackBar.open('Recipient does not have a Lightning address configured', 'Dismiss', {
        duration: 4000,
      });
      return;
    }

    this.currentState.set('confirmation');
  }

  backToInput(): void {
    this.currentState.set('input');
    this.errorMessage.set(null);
  }

  async confirmGift(): Promise<void> {
    if (!this.giftForm.valid || this.isProcessing()) {
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

      this.snackBar.open(
        `Successfully gifted ${this.getPremiumTypeName(premiumType)} for ${this.getDurationText(duration)}!`,
        'Dismiss',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        }
      );

      this.dialogRef.close({ success: true });
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
