import { Component, effect, inject, signal, OnDestroy, computed } from '@angular/core';

import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime, firstValueFrom, from, of, Subject, switchMap, takeUntil } from 'rxjs';
import { AccountService, PaymentService } from '../../../api/services';
import { TierDetails } from '../../../api/models/tier-details';
import { AccountStateService } from '../../../services/account-state.service';
import { CreatePayment$Params } from '../../../api/fn/payment/create-payment';
import { ApplicationService } from '../../../services/application.service';
import { LoggerService } from '../../../services/logger.service';
import { PlatformService } from '../../../services/platform.service';
import { InAppPurchaseService } from '../../../services/in-app-purchase.service';
import { environment } from '../../../../environments/environment';
import { UsernameService } from '../../../services/username';

interface PaymentInvoice {
  id: string;
  invoice: string;
  status: 'pending' | 'paid' | 'expired';
  expires: number;
}

interface PricingDisplay {
  pricePerMonth: string;
  totalPrice: string;
  currency: string;
  period: string;
}

interface TierDisplay {
  key: string;
  details: TierDetails;
  pricing: {
    monthly: PricingDisplay;
    quarterly: PricingDisplay;
    yearly: PricingDisplay;
  };
}

@Component({
  selector: 'app-upgrade',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatStepperModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatIconModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './upgrade.component.html',
  styleUrl: './upgrade.component.scss',
})
export class UpgradeComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private usernameService = inject(UsernameService);
  private accountService = inject(AccountService);
  private paymentService = inject(PaymentService);
  private accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  private readonly logger = inject(LoggerService);
  readonly platform = inject(PlatformService);
  readonly iap = inject(InAppPurchaseService);
  environment = environment;

  usernameFormGroup = this.formBuilder.group({
    username: [
      '',
      [Validators.required, Validators.minLength(2), Validators.pattern('^[a-zA-Z0-9_]+$')],
    ],
  });

  paymentFormGroup = this.formBuilder.group({
    paymentOption: [Validators.required],
  });

  currentStep = signal<number>(0);
  stepComplete = signal<Record<number, boolean>>({});
  isCheckingUsername = signal<boolean>(false);
  tiers = signal<TierDisplay[]>([]);
  selectedTier = signal<TierDisplay | null>(null);
  selectedPaymentOption = signal<'monthly' | 'quarterly' | 'yearly' | null>('yearly');
  selectedPaymentMethod = signal<'lightning' | 'play-store' | 'app-store' | 'external' | null>(null);
  paymentInvoice = signal<PaymentInvoice | null>(null);
  invoiceExpiresIn = signal<string>('15');
  isGeneratingInvoice = signal<boolean>(false);
  isPaymentCompleted = signal<boolean>(false);
  paymentCheckInterval = signal<number | null>(null);

  readonly storeSingleSubscriptionMode = computed(
    () => this.platform.canPayWithPlayStore() || this.platform.canPayWithAppStore()
  );

  readonly planTiers = computed(() => {
    const allTiers = this.tiers();
    if (!this.storeSingleSubscriptionMode()) {
      return allTiers;
    }
    return allTiers.filter(tier => tier.key === 'premium');
  });

  /** Available payment methods based on platform detection */
  availablePaymentMethods = computed(() => {
    const methods: { key: 'lightning' | 'play-store' | 'app-store' | 'external'; label: string; icon: string; description: string; recommended: boolean }[] = [];

    // Bitcoin Lightning is always available (except possibly on native where we still show it as an option)
    methods.push({
      key: 'lightning',
      label: 'Bitcoin Lightning',
      icon: 'bolt',
      description: 'Pay with Bitcoin via Lightning Network',
      recommended: !this.platform.isNativeApp(),
    });

    // Play Store is available only when the platform route is Play Store and billing is initialized
    if (this.platform.canPayWithPlayStore() && this.iap.playStoreAvailable()) {
      methods.push({
        key: 'play-store',
        label: 'Google Play',
        icon: 'shop',
        description: 'Pay through Google Play Store',
        recommended: true,
      });
    }

    // App Store is available only when the platform route is App Store and StoreKit bridge is initialized
    if (this.platform.canPayWithAppStore() && this.iap.appStoreAvailable()) {
      methods.push({
        key: 'app-store',
        label: 'App Store',
        icon: 'apple',
        description: 'Pay through Apple App Store',
        recommended: true,
      });
    }

    // External browser payment is always available as a fallback
    methods.push({
      key: 'external',
      label: 'Pay in Browser',
      icon: 'open_in_new',
      description: 'Complete payment on nostria.app',
      recommended: false,
    });

    return methods;
  });

  /** The recommended payment method (first recommended one, or first available) */
  recommendedPaymentMethod = computed(() => {
    const methods = this.availablePaymentMethods();
    return methods.find(m => m.recommended) || methods[0];
  });
  selectedPrice = computed(
    () =>
      this.selectedTier()?.details?.pricing?.[this.selectedPaymentOption() || 'monthly'] || {
        priceCents: 0,
        currency: 'USD',
      }
  );
  selectedTierTill = computed(() => {
    if (!this.selectedTier() || !this.selectedPaymentOption()) return '';
    const paymentOption = this.selectedPaymentOption();
    const days = paymentOption === 'monthly' ? 31 : paymentOption === 'quarterly' ? 92 : 365;
    const validTill = Date.now() + 24 * 60 * 60 * 1000 * days;
    const date = new Date(validTill);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  });

  constructor() {
    effect(() => {
      if (this.accountState.initialized()) {
        // Fetch tiers from API
        this.accountService
          .getTiers()
          .pipe(takeUntil(this.destroy$))
          .subscribe(tiersObj => {
            const tiers = Object.values(tiersObj).map(tier => {
              return {
                key: tier.tier,
                details: tier,
                pricing: {
                  monthly: this.getPricing(tier, 'monthly'),
                  quarterly: this.getPricing(tier, 'quarterly'),
                  yearly: this.getPricing(tier, 'yearly'),
                },
              };
            });

            this.tiers.set(tiers);
            if (tiers.length > 0) {
              this.selectedTier.set(tiers[0]);
            }
          });
      }
    });

    this.usernameFormGroup
      .get('username')
      ?.valueChanges.pipe(
        takeUntil(this.destroy$),
        debounceTime(300), // Wait 300ms after last keystroke
        switchMap(value => {
          const trimmedValue = (value || '').trim();
          if (!trimmedValue) {
            return of({ success: true, message: '' });
          }
          this.isCheckingUsername.set(true);
          return from(this.usernameService.isUsernameAvailable(trimmedValue));
        })
      )
      .subscribe(({ success, message }) => {
        this.isCheckingUsername.set(false);
        if (!success) {
          this.usernameFormGroup.get('username')!.setErrors({ username: message });
          this.usernameFormGroup.get('username')!.markAllAsTouched();
        }
      });

    effect(() => {
      if (!this.storeSingleSubscriptionMode()) {
        return;
      }

      if (this.selectedPaymentOption() !== 'monthly') {
        this.selectedPaymentOption.set('monthly');
      }

      const premiumTier = this.tiers().find(tier => tier.key === 'premium') ?? null;
      if (!premiumTier) {
        return;
      }

      if (this.selectedTier()?.key !== premiumTier.key) {
        this.selectedTier.set(premiumTier);
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.resetPayment();
  }

  nextStep() {
    if (this.currentStep() === 0 && this.usernameFormGroup.valid) {
      this.stepComplete.set({
        ...this.stepComplete(),
        0: true,
      });

      if (this.stepComplete()[1] && this.stepComplete()[2]) {
        this.createAccount();
      } else {
        this.currentStep.set(1);
      }
    } else if (this.currentStep() === 1 && this.paymentFormGroup.valid) {
      this.stepComplete.set({
        ...this.stepComplete(),
        1: true,
      });
      // Pre-select the recommended payment method
      this.selectedPaymentMethod.set(this.recommendedPaymentMethod()?.key || 'lightning');
      // Move to payment step — invoice generation happens when user selects Lightning
      this.currentStep.set(2);
    }
  }

  /**
   * Called when user selects a payment method in Step 3.
   * If Lightning is selected, generate the invoice immediately.
   */
  selectPaymentMethod(method: 'lightning' | 'play-store' | 'app-store' | 'external') {
    this.selectedPaymentMethod.set(method);
    // If switching to Lightning and we don't have an invoice yet, generate one
    if (method === 'lightning' && !this.paymentInvoice()) {
      this.generatePaymentInvoice();
    }
  }

  /**
   * Execute the selected payment method action.
   */
  executePayment() {
    const method = this.selectedPaymentMethod();
    switch (method) {
      case 'play-store':
        this.purchaseWithPlayStore();
        break;
      case 'app-store':
        this.purchaseWithAppStore();
        break;
      case 'external':
        this.openExternalPayment();
        break;
      case 'lightning':
        // Invoice is already being generated/displayed via selectPaymentMethod
        if (!this.paymentInvoice()) {
          this.generatePaymentInvoice();
        }
        break;
    }
  }

  prevStep() {
    if (this.currentStep() > 0) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  async generatePaymentInvoice() {
    const selectedTier = this.selectedTier();
    const selectedPaymentOption = this.selectedPaymentOption();
    if (!selectedTier || !selectedPaymentOption) return;

    const selectedPrice = this.selectedPrice().priceCents;

    if (!selectedPrice) {
      this.logger.error(
        'No price found for selected tier and payment option ',
        selectedTier.key,
        selectedPaymentOption
      );
      return;
    }

    this.isGeneratingInvoice.set(true);

    try {
      const pubkey = this.accountState.pubkey();
      const request: CreatePayment$Params = {
        body: {
          billingCycle: selectedPaymentOption,
          tierName: selectedTier.details.tier,
          pubkey,
        },
      };

      const payment = await firstValueFrom(this.paymentService.createPayment(request));

      this.paymentInvoice.set({
        id: payment.id,
        invoice: payment.lnInvoice,
        status: payment.status,
        expires: payment.expires,
      });

      // Start checking for payment
      this.startPaymentCheck();
    } catch {
      this.snackBar.open('Error generating payment invoice. Please try again.', 'Close', {
        duration: 5000,
      });
    } finally {
      this.isGeneratingInvoice.set(false);
    }
  }

  stopPaymentCheck() {
    const intervalId = this.paymentCheckInterval();
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      this.paymentCheckInterval.set(null);
    }
  }

  startPaymentCheck() {
    // Clear any existing interval
    this.stopPaymentCheck();

    // Check every 3 seconds
    const intervalId = window.setInterval(async () => {
      await this.checkPaymentStatus();
      const invoice = this.paymentInvoice();
      if (!invoice) return;
      // const minutesToExpiry = Math.round((invoice.expires - Date.now()) / 60000);
      const minutesToExpiry = Math.max(0, Math.round((invoice.expires - Date.now()) / 60000));
      this.invoiceExpiresIn.set(String(minutesToExpiry));
      // If payment completed or expired, stop checking
      if (this.paymentInvoice()?.status !== 'pending') {
        this.stopPaymentCheck();
        this.paymentCheckInterval.set(null);
      }
    }, 3000);

    this.paymentCheckInterval.set(intervalId);
  }

  // async finalize() {
  //   await firstValueFrom(this.accountService.addAccount({
  //     body: {
  //       pubkey: this.accountState.pubkey(),
  //       username: 'sondreb',
  //       paymentId: 'payment-972e68f1-c8c1-482f-94cb-ac708ca7baa3',
  //     }
  //   }));

  //   this.isPaymentCompleted.set(true);
  //   // touch account state to load account subscription
  //   this.accountState.changeAccount(this.accountState.account())

  //   // Show success message
  //   this.snackBar.open('Payment successful! Your premium account is now active.', 'Great!', {
  //     duration: 8000
  //   });

  //   // After 2 seconds, proceed to completion step
  //   setTimeout(() => {
  //     this.currentStep.set(3);
  //   }, 2000);
  // }

  async checkPaymentStatus() {
    const paymentInvoice = this.paymentInvoice();
    if (!paymentInvoice || paymentInvoice.status !== 'pending') return;

    const payment = await firstValueFrom(
      this.paymentService.getPayment({
        paymentId: paymentInvoice.id,
        pubkey: this.accountState.pubkey(),
      })
    );

    if (payment.status === 'paid') {
      this.paymentInvoice.set({
        ...this.paymentInvoice()!,
        status: 'paid',
      });
      this.stepComplete.set({
        ...this.stepComplete(),
        2: true,
      });

      await this.createAccount();
    }

    // Check if invoice has expired
    if (payment.status === 'expired') {
      this.paymentInvoice.set({
        ...this.paymentInvoice()!,
        status: 'expired',
      });

      this.snackBar.open('Payment invoice has expired. Please generate a new one.', 'Ok', {
        duration: 5000,
      });
    }
  }

  async createAccount() {
    // 409 — pubkey already registered
    // 400/500 — something is wrong. TODO: Notify devs and retry
    try {
      await firstValueFrom(
        this.accountService.addAccount({
          body: {
            pubkey: this.accountState.pubkey(),
            username: this.usernameFormGroup.get('username')?.value,
            paymentId: this.paymentInvoice()!.id,
          },
        })
      );
      this.stepComplete.set({
        ...this.stepComplete(),
        3: true,
      });
      this.isPaymentCompleted.set(true);
      // touch account state to load account subscription
      await this.accountState.changeAccount(this.accountState.account());

      // Show success message
      this.snackBar.open('Payment successful! Your premium account is now active.', 'Great!', {
        duration: 8000,
      });

      // After 2 seconds, proceed to completion step
      setTimeout(() => {
        this.currentStep.set(3);
      }, 2000);
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err.status === 409) {
        this.snackBar.open(err?.error?.error || 'Username conflict', 'Ok', { duration: 5000 });
        this.stepComplete.set({
          ...this.stepComplete(),
          0: false,
        });
        this.currentStep.set(0);
        this.usernameFormGroup
          .get('username')!
          .setValue(this.usernameFormGroup.get('username')!.value);
      }
    }
  }

  resetPayment() {
    // Stop any payment check interval
    this.stopPaymentCheck();

    // Reset the payment state
    this.paymentInvoice.set(null);
    this.isPaymentCompleted.set(false);
    this.selectedPaymentMethod.set(null);

    // Go back to payment options
    this.currentStep.set(1);
  }

  finishSetup() {
    // Navigate to the home page or another appropriate page
    this.router.navigate(['/']);

    this.snackBar.open('Welcome to Nostria Premium! Enjoy your new features.', 'Thanks!', {
      duration: 5000,
    });
  }

  /**
   * Initiate a Play Store purchase for the selected tier/billing cycle.
   * Called when the user is on Android native app.
   */
  async purchaseWithPlayStore() {
    const productId = this.iap.getPrimaryStoreSubscriptionProductId();

    const result = await this.iap.purchaseWithPlayStore(productId);
    if (result.success && result.purchaseToken) {
      // Verify the purchase with our backend
      const verified = await this.iap.verifyPurchaseWithBackend(
        result.purchaseToken,
        this.accountState.pubkey(),
        'play-store'
      );

      if (verified) {
        this.stepComplete.set({ ...this.stepComplete(), 2: true, 3: true });
        this.isPaymentCompleted.set(true);
        await this.accountState.changeAccount(this.accountState.account());

        this.snackBar.open('Payment successful! Your premium account is now active.', 'Great!', {
          duration: 8000,
        });
        setTimeout(() => this.currentStep.set(3), 1000);
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
  }

  /**
   * Purchase via Apple App Store / StoreKit.
   * Uses the native iOS bridge to trigger a StoreKit purchase.
   */
  async purchaseWithAppStore() {
    const productId = this.iap.getPrimaryStoreSubscriptionProductId();

    const result = await this.iap.purchaseWithAppStore(productId);
    if (result.success && result.purchaseToken) {
      // Verify the purchase with our backend
      const verified = await this.iap.verifyPurchaseWithBackend(
        result.purchaseToken,
        this.accountState.pubkey(),
        'app-store'
      );

      if (verified) {
        this.stepComplete.set({ ...this.stepComplete(), 2: true, 3: true });
        this.isPaymentCompleted.set(true);
        await this.accountState.changeAccount(this.accountState.account());

        this.snackBar.open('Payment successful! Your premium account is now active.', 'Great!', {
          duration: 8000,
        });
        setTimeout(() => this.currentStep.set(3), 1000);
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
  }

  /**
   * Open external payment URL (fallback for any platform).
   */
  openExternalPayment() {
    const selectedTier = this.selectedTier();
    const selectedPaymentOption = this.selectedPaymentOption();
    this.iap.openExternalPaymentUrl(
      this.accountState.pubkey(),
      selectedTier?.details.tier,
      selectedPaymentOption || undefined
    );
  }

  // Helper methods for template
  getStepLabel(step: number): string {
    switch (step) {
      case 0:
        return 'Choose Username';
      case 1:
        return 'Select Plan';
      case 2:
        return 'Payment';
      case 3:
        return 'Complete';
      default:
        return '';
    }
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    this.snackBar.open('Payment request copied to clipboard', 'Ok', {
      duration: 3000,
    });
  }

  // Helper for template: get human-readable features for a tier
  getFeatureDescriptions(tier: TierDisplay): string[] {
    if (!tier.details.entitlements?.features) return [];
    return tier.details.entitlements.features.map(feature => feature.label || feature.key);
  }

  // Helper for template: get pricing for a tier and billing period
  getPricing(tier: TierDetails, period: 'monthly' | 'quarterly' | 'yearly'): PricingDisplay {
    const price = tier.pricing?.[period];
    if (!price) return { pricePerMonth: '', totalPrice: '', currency: '', period: '' };
    const months = period === 'yearly' ? 12 : period === 'quarterly' ? 3 : 1;
    return {
      pricePerMonth: price.priceCents
        ? (price.priceCents / 100 / months).toFixed(2)
        : '-',
      totalPrice: price.priceCents ? (price.priceCents / 100).toFixed(2) : '-',
      currency: price.currency || 'USD',
      period: period === 'yearly' ? '12 months' : period === 'quarterly' ? '3 months' : '1 month',
    };
  }
}
