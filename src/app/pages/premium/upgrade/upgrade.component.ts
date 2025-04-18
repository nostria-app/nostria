import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule, MatRadioGroup } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

interface PaymentOption {
  id: string;
  name: string;
  pricePerMonth: number;
  billingPeriod: string;
  totalPrice: number;
  description: string;
}

interface PaymentInvoice {
  paymentRequest: string;
  expiresAt: number;
  status: 'pending' | 'paid' | 'expired';
}

@Component({
  selector: 'app-upgrade',
  standalone: true,
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
    MatTooltipModule
  ],
  templateUrl: './upgrade.component.html',
  styleUrl: './upgrade.component.scss'
})
export class UpgradeComponent {
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  usernameFormGroup = this.formBuilder.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z0-9_]+$')]]
  });

  paymentFormGroup = this.formBuilder.group({
    paymentOption: ['yearly', Validators.required]
  });

  currentStep = signal<number>(0);
  isUsernameAvailable = signal<boolean | null>(null);
  isCheckingUsername = signal<boolean>(false);
  paymentOptions = signal<PaymentOption[]>([
    {
      id: 'quarterly',
      name: 'Quarterly',
      pricePerMonth: 6,
      billingPeriod: '3 months',
      totalPrice: 18,
      description: 'Billed as $18 every 3 months'
    },
    {
      id: 'yearly',
      name: 'Yearly',
      pricePerMonth: 5,
      billingPeriod: '12 months',
      totalPrice: 60,
      description: 'Billed as $60 per year (Save $12)'
    }
  ]);
  
  selectedPaymentOption = signal<PaymentOption | null>(null);
  paymentInvoice = signal<PaymentInvoice | null>(null);
  isGeneratingInvoice = signal<boolean>(false);
  isPaymentCompleted = signal<boolean>(false);
  paymentCheckInterval = signal<number | null | any>(null);
  
  constructor() {
    // Initialize with yearly plan selected
    this.selectedPaymentOption.set(this.paymentOptions()[1]);
    
    // Set up form value changes
    effect(() => {
      const paymentOption = this.paymentFormGroup.get('paymentOption')?.value;
      if (paymentOption) {
        const option = this.paymentOptions().find(opt => opt.id === paymentOption);
        if (option) {
          this.selectedPaymentOption.set(option);
        }
      }
    });
    
    // Add CSS variables for primary color in RGB format for opacity support
    this.setupThemeVariables();
  }
  
  private setupThemeVariables() {
    // Get the computed primary color and convert to RGB for opacity support
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim();
    if (primaryColor) {
      const rgb = this.hexToRgb(primaryColor) || '142, 68, 173'; // Fallback to default purple
      document.documentElement.style.setProperty('--mat-primary-rgb', rgb);
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
      // Simulate API call to check username availability
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // For demo purposes, we'll make usernames that start with 'test' unavailable
      const isAvailable = !username.toLowerCase().startsWith('test');
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
    if (!this.selectedPaymentOption()) return;
    
    this.isGeneratingInvoice.set(true);
    
    try {
      // Simulate API call to generate Lightning invoice
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Create a mock invoice that expires in 15 minutes
      const expiryTime = Date.now() + (15 * 60 * 1000);
      
      this.paymentInvoice.set({
        paymentRequest: 'lnbc1500n1p3zug37pp5hvpwkj3j5ww760na4h6kpuqfk5htx2wvteypjhxguwuclep3uyylqdq8w3jhxapqvehhygzyfap4xxqyz5vqcqzpgxqyz5vqsp5u7unxml9qtupqf0f056lt227yqwemkwd8hm6x2a3u4u473tkpars9qyyssqtfyvk8yyj0n48jemgzwlh3qaplj4012lgjg8g8hh95dfjky9vn3h68z0wl397l078zx4dg4jxgzqvhl8mhjq7xq40mlrj8893zegpsxgmzs5',
        expiresAt: expiryTime,
        status: 'pending'
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
  
  startPaymentCheck() {
    // Clear any existing interval
    if (this.paymentCheckInterval() !== null) {
      window.clearInterval(this.paymentCheckInterval());
    }
    
    // Check every 3 seconds
    const intervalId = window.setInterval(async () => {
      await this.checkPaymentStatus();
      
      // If payment completed or expired, stop checking
      if (this.paymentInvoice()?.status !== 'pending') {
        window.clearInterval(this.paymentCheckInterval()!);
        this.paymentCheckInterval.set(null);
      }
    }, 3000);
    
    this.paymentCheckInterval.set(intervalId);
  }
  
  async checkPaymentStatus() {
    if (!this.paymentInvoice()) return;
    
    // Simulate API call to check payment status
    // For demo, we'll randomly complete the payment after a few checks
    if (Math.random() > 0.7) {
      this.paymentInvoice.set({
        ...this.paymentInvoice()!,
        status: 'paid'
      });
      
      this.isPaymentCompleted.set(true);
      
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
    if (this.paymentInvoice()!.expiresAt < Date.now()) {
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
    if (this.paymentCheckInterval() !== null) {
      window.clearInterval(this.paymentCheckInterval());
      this.paymentCheckInterval.set(null);
    }
    
    // Reset the payment state
    this.paymentInvoice.set(null);
    this.isPaymentCompleted.set(false);
    
    // Go back to payment options
    this.currentStep.set(1);
  }
  
  finishSetup() {
    // Navigate to the home page or another appropriate page
    this.router.navigate(['/home']);
    
    this.snackBar.open('Welcome to Nostria Premium! Enjoy your new features.', 'Thanks!', {
      duration: 5000
    });
  }
  
  // Helper methods for template
  getStepLabel(step: number): string {
    switch(step) {
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
}
