import { Component, effect, inject, signal, OnDestroy } from '@angular/core';

import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
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
import { NameService } from '../../../services/name.service';
import { debounceTime, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { AccountService, PaymentService } from '../../../api/services';
import { TierDetails } from '../../../api/models/tier-details';
import { AccountStateService } from '../../../services/account-state.service';
import { CreatePayment$Params } from '../../../api/fn/payment/create-payment';
import { ApplicationService } from '../../../services/application.service';
import { environment } from '../../../../environments/environment';
import { Payment } from '../../../api/models';

interface PaymentInvoice {
  id: string;
  invoice: string;
  status: 'pending' | 'paid' | 'expired';
  expires: number;
}

interface PricingDisplay {
  pricePerMonth: string,
  totalPrice: string,
  currency: string,
  period: string,
};

interface TierDisplay {
  key: string;
  details: TierDetails;
  pricing: {
    quarterly: PricingDisplay;
    yearly: PricingDisplay;
  }
};

@Component({
  selector: 'app-upgrade',
  standalone: true,
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
    MatTooltipModule
  ],
  templateUrl: './upgrade.component.html',
  styleUrl: './upgrade.component.scss'
})
export class UpgradeComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private name = inject(NameService);
  private accountService = inject(AccountService)
  private paymentService = inject(PaymentService)
  private accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  environment = environment;

  usernameFormGroup = this.formBuilder.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z0-9_]+$')]]
  });

  paymentFormGroup = this.formBuilder.group({
    paymentOption: ['yearly' as 'yearly', Validators.required]
  });

  currentStep = signal<number>(0);
  isUsernameAvailable = signal<boolean | null>(null);
  isCheckingUsername = signal<boolean>(false);
  tiers = signal<TierDisplay[]>([]);
  selectedTier = signal<TierDisplay | null>(null);
  selectedPaymentOption = signal<'quarterly' | 'yearly' | null>('yearly');
  paymentInvoice = signal<PaymentInvoice | null>(null);
  invoiceExpiresIn = signal<string>('15');
  isGeneratingInvoice = signal<boolean>(false);
  isPaymentCompleted = signal<boolean>(false);
  paymentCheckInterval = signal<number | null | any>(null);

  constructor() {
    effect(() => {
      if (this.accountState.initialized()) {
        // Fetch tiers from API
        this.accountService.getTiers().pipe(takeUntil(this.destroy$)).subscribe(tiersObj => {
          const tiers = Object.values(tiersObj).map(tier => {
            return {
              key: tier.tier,
              details: tier,
              pricing: {
                quarterly: this.getPricing(tier, 'quarterly'),
                yearly: this.getPricing(tier, 'yearly'),
              }
            }
          });

          this.tiers.set(tiers);
          if (tiers.length > 0) {
            this.selectedTier.set(tiers[0]);
          }
        });
      }
    });

    // Set up form value changes
    effect(() => {
      const paymentOption = this.paymentFormGroup.get('paymentOption')?.value;
      if (paymentOption) {
        this.selectedPaymentOption.set(paymentOption);
      }
    });

    // Add CSS variables for primary color in RGB format for opacity support
    this.setupThemeVariables();

    this.usernameFormGroup.get('username')?.valueChanges
      .pipe(
        debounceTime(300), // Wait 300ms after last keystroke
        takeUntil(this.destroy$)
      )
      .subscribe(value => {
        this.checkUsernameAvailability();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.resetPayment();
  }

  private setupThemeVariables() {
    // Get the computed primary color and convert to RGB for opacity support
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim();
    if (primaryColor) {
      const rgb = this.hexToRgb(primaryColor) || '142, 68, 173'; // Fallback to default purple
      document.documentElement.style.setProperty('--mat-sys-background', rgb);
    }

    // Get the background color for overlay calculations
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--mat-card-container-color').trim();
    if (backgroundColor) {
      const rgb = this.hexToRgb(backgroundColor) || '255, 255, 255';
      document.documentElement.style.setProperty('--mat-background-rgb', rgb);
    }
  }

  private hexToRgb(hex: string): string | null {
    // Remove # if present
    hex = hex.replace('#', '');

    // Convert 3-digit hex to 6-digit
    if (hex.length === 3) {
      hex = hex.split('').map(x => x + x).join('');
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return null;
    }

    return `${r}, ${g}, ${b}`;
  }

  async checkUsernameAvailability() {
    const username = this.usernameFormGroup.get('username')?.value;

    if (!username || username.length < 3) {
      this.isUsernameAvailable.set(null);
      return;
    }

    this.isCheckingUsername.set(true);

    try {
      const isAvailable = await firstValueFrom(this.name.isUsernameAvailable(username));
      this.isUsernameAvailable.set(isAvailable);
    } finally {
      this.isCheckingUsername.set(false);
    }
  }

  nextStep() {
    if (this.currentStep() === 0 && this.usernameFormGroup.valid && this.isUsernameAvailable()) {
      this.currentStep.set(1);
    } else if (this.currentStep() === 1 && this.paymentFormGroup.valid) {
      this.generatePaymentInvoice();
    }
  }

  prevStep() {
    if (this.currentStep() > 0) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  async generatePaymentInvoice() {
    const selectedTier = this.selectedTier()
    const selectedPaymentOption = this.selectedPaymentOption()
    if (!selectedTier || !selectedPaymentOption) return;

    const selectedPrice = selectedTier.details.pricing[selectedPaymentOption]?.priceCents

    if (!selectedPrice) {
      console.error('No price found for selected tier and payment option ', selectedTier.key, selectedPaymentOption);
      return;
    }

    this.isGeneratingInvoice.set(true);

    try {
      const pubkey = this.accountState.pubkey();
      const request: CreatePayment$Params = {
        body: {
          billingCycle: selectedPaymentOption,
          tierName: selectedTier.details.tier,
          price: selectedPrice,
          pubkey,
        }
      }

      const payment = await firstValueFrom(this.paymentService.createPayment(request));

      this.paymentInvoice.set({
        id: payment.id,
        invoice: payment.lnInvoice,
        status: payment.status,
        expires: payment.expires,
      });

      // Move to the payment step
      this.currentStep.set(2);

      // Start checking for payment
      this.startPaymentCheck();

    } catch (error) {
      this.snackBar.open('Error generating payment invoice. Please try again.', 'Close', {
        duration: 5000
      });
    } finally {
      this.isGeneratingInvoice.set(false);
    }
  }

  stopPaymentCheck() {
    if (this.paymentCheckInterval() !== null) {
      window.clearInterval(this.paymentCheckInterval());
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
      this.invoiceExpiresIn.set(String(minutesToExpiry))
      // If payment completed or expired, stop checking
      if (this.paymentInvoice()?.status !== 'pending') {
        this.stopPaymentCheck();
        this.paymentCheckInterval.set(null);
        this.paymentInvoice.set(null);
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
    const paymentInvoice = this.paymentInvoice()
    if (!paymentInvoice) return;

    let payment: Payment | undefined;

    payment = await firstValueFrom(this.paymentService.getPayment({
      paymentId: paymentInvoice.id,
      pubkey: this.accountState.pubkey()
    }));

    if (payment.status === 'paid') {
      this.paymentInvoice.set({
        ...this.paymentInvoice()!,
        status: 'paid'
      });

      // TODO: check reponse code
      // 409 — pubkey already registered
      // 400/500 — something is wrong. Notify devs and retry
      await firstValueFrom(this.accountService.addAccount({
        body: {
          pubkey: this.accountState.pubkey(),
          username: this.usernameFormGroup.get('username')?.value,
          paymentId: this.paymentInvoice()!.id,
        }
      }));

      this.isPaymentCompleted.set(true);
      // touch account state to load account subscription
      this.accountState.changeAccount(this.accountState.account())

      // Show success message
      this.snackBar.open('Payment successful! Your premium account is now active.', 'Great!', {
        duration: 8000
      });

      // After 2 seconds, proceed to completion step
      setTimeout(() => {
        this.currentStep.set(3);
      }, 2000);
    }

    // Check if invoice has expired
    if (payment.status === 'expired') {
      this.paymentInvoice.set({
        ...this.paymentInvoice()!,
        status: 'expired'
      });

      this.snackBar.open('Payment invoice has expired. Please generate a new one.', 'Ok', {
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
    this.currentStep.set(1);
  }

  finishSetup() {
    // Navigate to the home page or another appropriate page
    this.router.navigate(['/']);

    this.snackBar.open('Welcome to Nostria Premium! Enjoy your new features.', 'Thanks!', {
      duration: 5000
    });
  }

  // Helper methods for template
  getStepLabel(step: number): string {
    switch (step) {
      case 0: return 'Choose Username';
      case 1: return 'Select Plan';
      case 2: return 'Payment';
      case 3: return 'Complete';
      default: return '';
    }
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    this.snackBar.open('Payment request copied to clipboard', 'Ok', {
      duration: 3000
    });
  }

  // Helper for template: get human-readable features for a tier
  getFeatureDescriptions(tier: TierDisplay): string[] {
    if (!tier.details.entitlements?.features) return [];
    return tier.details.entitlements.features.map(feature => feature.label || feature.key);
  }

  // Helper for template: get pricing for a tier and billing period
  getPricing(tier: TierDetails, period: 'quarterly' | 'yearly'): PricingDisplay {
    const price = tier.pricing?.[period];
    if (!price) return { pricePerMonth: '', totalPrice: '', currency: '', period: '' };
    return {
      pricePerMonth: price.priceCents ? (price.priceCents / 100 / (period === 'yearly' ? 12 : 3)).toFixed(2) : '-',
      totalPrice: price.priceCents ? (price.priceCents / 100).toFixed(2) : '-',
      currency: price.currency || 'USD',
      period: period === 'yearly' ? '12 months' : '3 months',
    };
  }
}
