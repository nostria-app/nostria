import { Component, effect, inject, signal, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { Router, RouterLink } from '@angular/router';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { AccountService, PaymentService } from '../../../api/services';
import { TierDetails } from '../../../api/models/tier-details';
import { AccountStateService } from '../../../services/account-state.service';
import { CreatePayment$Params } from '../../../api/fn/payment/create-payment';
import { ApplicationService } from '../../../services/application.service';
import { environment } from '../../../../environments/environment';
import { PremiumApiService } from '../../../services/premium-api.service';

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
  selector: 'app-renew',
  imports: [
    CommonModule,
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
    RouterLink,
  ],
  templateUrl: './renew.component.html',
  styleUrl: './renew.component.scss',
})
export class RenewComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private paymentService = inject(PaymentService);
  private premiumApi = inject(PremiumApiService);
  accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  environment = environment;

  paymentFormGroup = this.formBuilder.group({
    paymentOption: [Validators.required],
  });

  currentStep = signal<number>(0);
  stepComplete = signal<Record<number, boolean>>({});
  tiers = signal<TierDisplay[]>([]);
  selectedTier = signal<TierDisplay | null>(null);
  selectedPaymentOption = signal<'monthly' | 'quarterly' | 'yearly' | null>('yearly');
  paymentInvoice = signal<PaymentInvoice | null>(null);
  invoiceExpiresIn = signal<string>('15');
  isGeneratingInvoice = signal<boolean>(false);
  isPaymentCompleted = signal<boolean>(false);
  paymentCheckInterval = signal<number | null | ReturnType<typeof setInterval>>(null);
  
  // Computed values for current subscription
  currentTier = computed(() => this.accountState.subscription()?.tier || 'premium');
  currentExpiry = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    return expires ? new Date(expires) : null;
  });
  isExpired = computed(() => {
    const expires = this.currentExpiry();
    return expires ? expires.getTime() < Date.now() : false;
  });
  
  selectedPrice = computed(
    () =>
      this.selectedTier()?.details?.pricing?.[this.selectedPaymentOption() || 'monthly'] || {
        priceCents: 0,
        currency: 'USD',
      }
  );
  
  // Calculate the new expiry date based on current expiry and selected plan
  selectedTierTill = computed(() => {
    if (!this.selectedTier() || !this.selectedPaymentOption()) return '';
    const paymentOption = this.selectedPaymentOption();
    const days = paymentOption === 'monthly' ? 31 : paymentOption === 'quarterly' ? 92 : 365;
    
    // If subscription is active, extend from current expiry, otherwise start from now
    const currentExpiry = this.currentExpiry();
    const baseDate = (currentExpiry && !this.isExpired()) ? currentExpiry.getTime() : Date.now();
    const validTill = baseDate + 24 * 60 * 60 * 1000 * days;
    
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
            
            // Pre-select the user's current tier
            const currentTierKey = this.currentTier();
            const matchingTier = tiers.find(t => t.key === currentTierKey);
            if (matchingTier) {
              this.selectedTier.set(matchingTier);
            } else if (tiers.length > 0) {
              this.selectedTier.set(tiers[0]);
            }
          });
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.resetPayment();
  }

  nextStep() {
    if (this.currentStep() === 0 && this.paymentFormGroup.valid) {
      this.stepComplete.set({
        ...this.stepComplete(),
        0: true,
      });
      this.generatePaymentInvoice();
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
      console.error(
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

      // Move to the payment step
      this.currentStep.set(1);

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
    if (this.paymentCheckInterval() !== null) {
      window.clearInterval(this.paymentCheckInterval() as number);
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
        1: true,
      });

      await this.renewSubscription();
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

  async renewSubscription() {
    try {
      const paymentId = this.paymentInvoice()!.id;
      const updatedAccount = await firstValueFrom(this.premiumApi.renewSubscription(paymentId));
      
      this.stepComplete.set({
        ...this.stepComplete(),
        2: true,
      });
      this.isPaymentCompleted.set(true);
      
      // Update the subscription in local state
      this.accountState.addSubscription(updatedAccount);
      
      // Refresh subscription to ensure we have the latest data
      await this.accountState.refreshSubscription();

      // Show success message
      this.snackBar.open('Subscription renewed successfully!', 'Great!', {
        duration: 8000,
      });

      // After 2 seconds, proceed to completion step
      setTimeout(() => {
        this.currentStep.set(2);
      }, 2000);
    } catch (e: unknown) {
      console.error('Failed to renew subscription:', e);
      const errorMessage = (e as { error?: { error?: string } })?.error?.error || 'Failed to renew subscription. Please try again.';
      this.snackBar.open(errorMessage, 'Ok', { 
        duration: 5000 
      });
    }
  }

  resetPayment() {
    // Stop any payment check interval
    this.stopPaymentCheck();

    // Reset the payment state
    this.paymentInvoice.set(null);
    this.isPaymentCompleted.set(false);

    // Go back to payment options
    this.currentStep.set(0);
  }

  finishSetup() {
    // Navigate to the premium page
    this.router.navigate(['/premium']);

    this.snackBar.open('Your subscription has been renewed!', 'Thanks!', {
      duration: 5000,
    });
  }

  // Helper methods for template
  getStepLabel(step: number): string {
    switch (step) {
      case 0:
        return 'Select Plan';
      case 1:
        return 'Payment';
      case 2:
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
