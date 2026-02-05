import { Component, inject, signal, computed } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { QrCodeComponent } from '../qr-code/qr-code.component';
import { ZapService } from '../../services/zap.service';
import { Wallets } from '../../services/wallets';
import { ZapErrorHandlerService } from '../../services/zap-error-handler.service';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { Event } from 'nostr-tools';

export interface ZapDialogData {
  recipientPubkey: string;
  recipientName?: string;
  recipientMetadata?: Record<string, unknown>;
  eventId?: string;
  eventKind?: number; // Added eventKind
  eventAddress?: string; // Added eventAddress for addressable events (a tag)
  eventContent?: string;
  goalEventId?: string; // For NIP-75 zap goals
  zapSplits?: { pubkey: string; relay: string; weight: number }[];
  event?: Event; // The actual event object for split zaps
}

export interface ZapDialogResult {
  amount: number;
  message: string;
  paymentMethod: 'nwc' | 'native' | 'manual';
  invoice?: string;
}

interface LnurlPayResponse {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  commentAllowed?: number;
}

export type PaymentMethod = 'nwc' | 'native' | 'manual';
export type DialogState = 'input' | 'confirmation';

// File extension constants for content type detection
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'];
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'rtf'];

// Domain constants for content type detection
const IMAGE_HOSTING_DOMAINS = ['imgur.com', 'i.imgur.com', 'imagebin.ca', 'postimg.cc', 'imgbb.com', 'prnt.sc'];
const VIDEO_HOSTING_DOMAINS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv'];

@Component({
  selector: 'app-zap-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    ReactiveFormsModule,
    UserProfileComponent,
    QrCodeComponent
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
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);

  data: ZapDialogData = inject(MAT_DIALOG_DATA);

  // State management
  currentState = signal<DialogState>('input');
  isProcessing = signal(false);
  errorMessage = signal<string | null>(null);
  isErrorRecoverable = signal(false);
  selectedPaymentMethod = signal<PaymentMethod>('nwc');
  invoiceUrl = signal<string | null>(null);
  isMobile = signal(false);
  lnurlPayInfo = signal<LnurlPayResponse | null>(null);
  isLoadingLnurlInfo = signal(false);
  lnurlError = signal<string | null>(null);
  forceComment = signal(false); // Added forceComment signal

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

  // Computed property for comment limit
  commentLimit = computed(() => {
    const lnurlInfo = this.lnurlPayInfo();
    if (!lnurlInfo) return null; // Don't show limit until loaded
    return lnurlInfo.commentAllowed ?? 0;
  });

  // Computed property to check if comments are allowed
  commentsAllowed = computed(() => {
    const limit = this.commentLimit();
    return limit !== null && limit > 0;
  });

  // Computed property to check if we should allow comments
  shouldAllowComments = computed(() => {
    return this.commentsAllowed() || this.forceComment();
  });

  // Computed property for amount limits
  amountLimits = computed(() => {
    const lnurlInfo = this.lnurlPayInfo();
    if (!lnurlInfo) {
      return null; // Don't show limits until loaded
    }
    return {
      minSats: lnurlInfo.minSendable / 1000,
      maxSats: lnurlInfo.maxSendable / 1000,
    };
  });

  contentInfo = computed(() => {
    const content = this.data.eventContent;
    if (!content) {
      return { type: 'text', icon: 'article', display: content || '' };
    }
    return this.getContentInfo(content);
  });

  zapForm = new FormGroup({
    amount: new FormControl<string | number>(21, [Validators.required]),
    customAmount: new FormControl({ value: null, disabled: true }), // Start disabled
    message: new FormControl('', [Validators.maxLength(200)]), // Conservative default until LNURL loads
    selectedWallet: new FormControl<string>(''),
  });

  constructor() {
    // Watch for amount changes to enable/disable custom amount
    this.zapForm.get('amount')?.valueChanges.subscribe(value => {
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
      const connectedWallet = wallets.find(w => w.connected);
      if (connectedWallet) {
        this.zapForm.get('selectedWallet')?.setValue(connectedWallet.id);
      }
    }

    // Check if on mobile device
    this.breakpointObserver.observe('(max-width: 768px)').subscribe(result => {
      this.isMobile.set(result.matches);
    });

    // Fetch LNURL pay info for the recipient
    this.fetchLnurlPayInfo();

    // Ensure the form is in the correct initial state
    // Trigger the amount change handler manually for the initial value
    const initialAmount = this.zapForm.get('amount')?.value;
    if (initialAmount !== 'custom') {
      const customAmountControl = this.zapForm.get('customAmount');
      customAmountControl?.clearValidators();
      customAmountControl?.disable();
      customAmountControl?.setValue(null);
      customAmountControl?.updateValueAndValidity();
    }
  }

  async fetchLnurlPayInfo(): Promise<void> {
    // For zap splits, we don't need to validate LNURL info upfront
    // Each recipient will be validated when the split zap is sent
    if (this.data.zapSplits && this.data.zapSplits.length > 0) {
      this.isLoadingLnurlInfo.set(false);
      this.lnurlError.set(null);
      return;
    }

    if (!this.data.recipientMetadata) {
      this.lnurlError.set('No recipient metadata available');
      return;
    }

    try {
      this.isLoadingLnurlInfo.set(true);
      this.lnurlError.set(null);

      const lightningAddress = this.zapService.getLightningAddress(this.data.recipientMetadata);
      if (!lightningAddress) {
        this.lnurlError.set('No Lightning address found for recipient');
        return;
      }

      const lnurlInfo = await this.zapService.fetchLnurlPayInfo(lightningAddress);
      this.lnurlPayInfo.set(lnurlInfo);

      // Update form validators based on the LNURL response
      this.updateFormValidators();

      // Check if current selected amount is still valid
      this.validateCurrentAmount();
    } catch (error) {
      console.error('Failed to fetch LNURL pay info:', error);
      this.lnurlError.set('Failed to load payment information');
    } finally {
      this.isLoadingLnurlInfo.set(false);
    }
  }

  updateFormValidators(): void {
    const messageControl = this.zapForm.get('message');
    const customAmountControl = this.zapForm.get('customAmount');
    const commentLimit = this.commentLimit();
    const amountLimits = this.amountLimits();

    // Update message validators and enable/disable based on commentAllowed
    if (messageControl) {
      if (this.forceComment()) {
        // If forced, allow up to 200 chars (standard Nostr limit usually)
        messageControl.setValidators([Validators.maxLength(200)]);
        messageControl.enable();
      } else if (commentLimit === null) {
        // LNURL info not loaded yet, use conservative default
        messageControl.setValidators([Validators.maxLength(200)]);
        messageControl.enable();
      } else if (commentLimit === 0) {
        // Comments not allowed, disable the field
        messageControl.clearValidators();
        messageControl.disable();
        messageControl.setValue(''); // Clear any existing message
      } else {
        // Comments allowed with specific limit
        messageControl.setValidators([Validators.maxLength(commentLimit)]);
        messageControl.enable();
      }
      messageControl.updateValueAndValidity();
    }

    // Update custom amount validators
    if (customAmountControl) {
      if (amountLimits === null) {
        // LNURL info not loaded yet, use basic validation
        const currentValidators = [Validators.required, Validators.min(1)];
        customAmountControl.setValidators(currentValidators);
      } else {
        const currentValidators = [
          Validators.required,
          Validators.min(amountLimits.minSats),
          Validators.max(amountLimits.maxSats),
        ];
        customAmountControl.setValidators(currentValidators);
      }
      customAmountControl.updateValueAndValidity();
    }
  }

  validateCurrentAmount(): void {
    const currentAmount = this.zapForm.get('amount')?.value;
    if (typeof currentAmount === 'number') {
      const limits = this.amountLimits();
      if (limits && (currentAmount < limits.minSats || currentAmount > limits.maxSats)) {
        // Current amount is invalid, reset to custom and show error
        this.zapForm.get('amount')?.setValue('custom');
        this.errorMessage.set(
          `Default amount ${currentAmount} sats is outside the allowed range (${limits.minSats} - ${limits.maxSats} sats). Please enter a custom amount.`
        );
      }
    }
  }

  getFinalAmount(): number {
    const amount = this.zapForm.get('amount')?.value;
    if (amount === 'custom') {
      return this.zapForm.get('customAmount')?.value || 0;
    }
    return typeof amount === 'number' ? amount : 0;
  }

  selectAmount(amount: number | string): void {
    // Validate preset amounts against LNURL limits
    if (typeof amount === 'number') {
      const limits = this.amountLimits();
      if (limits && (amount < limits.minSats || amount > limits.maxSats)) {
        // If preset amount is outside limits, don't select it and show error
        this.errorMessage.set(
          `Amount ${amount} sats is outside the allowed range (${limits.minSats} - ${limits.maxSats} sats)`
        );
        return;
      }
    }

    this.zapForm.get('amount')?.setValue(amount);
    this.errorMessage.set(null); // Clear any previous errors
  }

  isAmountValid(amount: number): boolean {
    const limits = this.amountLimits();
    if (!limits) {
      // If LNURL info not loaded yet, allow all preset amounts for now
      // They will be validated when the form is submitted
      return true;
    }
    return amount >= limits.minSats && amount <= limits.maxSats;
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedPaymentMethod.set(method);
  }

  async proceedToConfirmation(): Promise<void> {
    if (!this.zapForm.valid) {
      return;
    }

    // Skip LNURL validation for zap splits - each recipient will be validated individually
    if (this.data.zapSplits && this.data.zapSplits.length > 0) {
      this.errorMessage.set(null);
      this.currentState.set('confirmation');
      return;
    }

    // If LNURL info is still loading, wait for it or show error
    if (this.isLoadingLnurlInfo()) {
      this.errorMessage.set('Please wait while payment information is loading...');
      return;
    }

    // If there was an error loading LNURL info, don't proceed
    if (this.lnurlError()) {
      this.errorMessage.set('Unable to load payment information. Please try again.');
      return;
    }

    // Validate the current amount against LNURL limits
    const finalAmount = this.getFinalAmount();
    const limits = this.amountLimits();
    if (limits && (finalAmount < limits.minSats || finalAmount > limits.maxSats)) {
      this.errorMessage.set(
        `Amount ${finalAmount} sats is outside the allowed range (${limits.minSats} - ${limits.maxSats} sats)`
      );
      return;
    }

    // Clear any errors and proceed
    this.errorMessage.set(null);
    this.currentState.set('confirmation');
  }

  backToInput(): void {
    this.currentState.set('input');
    this.invoiceUrl.set(null);
    this.isProcessing.set(false);
    this.errorMessage.set(null);
    this.isErrorRecoverable.set(false);
  }

  clearError(): void {
    this.errorMessage.set(null);
    this.isErrorRecoverable.set(false);
  }

  retryZap(): void {
    this.clearError();
    this.confirmNwcPayment();
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
    const selectedWallet = this.availableWallets().find(w => w.id === selectedWalletId);
    return selectedWallet?.name || 'No Wallet';
  }

  openCredentials(): void {
    // Navigate to credentials tab where user can manage NWC connection
    try {
      this.dialogRef.close({ confirmed: false });
      this.router.navigate(['/accounts'], { queryParams: { tab: 'credentials' } });
    } catch {
      // If navigation fails, fallback to redirect route
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
        this.data.eventKind, // eventKind
        this.data.eventAddress // eventAddress
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

  getContentInfo(content: string): { type: string; icon: string; display: string } {
    if (!content) {
      return { type: 'text', icon: 'article', display: content };
    }

    // Check if it's a URL
    try {
      const url = new URL(content);
      const extension = url.pathname.split('.').pop()?.toLowerCase();

      // Image types
      if (extension && IMAGE_EXTENSIONS.includes(extension)) {
        return { type: 'image', icon: 'image', display: 'Image' };
      }

      // Video types  
      if (extension && VIDEO_EXTENSIONS.includes(extension)) {
        return { type: 'video', icon: 'videocam', display: 'Video' };
      }

      // Audio types
      if (extension && AUDIO_EXTENSIONS.includes(extension)) {
        return { type: 'audio', icon: 'audiotrack', display: 'Audio' };
      }

      // Document types
      if (extension && DOCUMENT_EXTENSIONS.includes(extension)) {
        return { type: 'document', icon: 'description', display: 'Document' };
      }

      // Check for common image hosting domains
      const hostname = url.hostname.toLowerCase();
      if (IMAGE_HOSTING_DOMAINS.some(domain => hostname.includes(domain))) {
        return { type: 'image', icon: 'image', display: 'Image' };
      }

      // Check for common video hosting domains
      if (VIDEO_HOSTING_DOMAINS.some(domain => hostname.includes(domain))) {
        return { type: 'video', icon: 'videocam', display: 'Video' };
      }

      // Generic URL - show domain
      return { type: 'link', icon: 'link', display: `Link (${hostname})` };
    } catch {
      // Not a valid URL, check for other patterns

      // Check if it looks like a data URL (base64 image)
      if (content.startsWith('data:image/')) {
        return { type: 'image', icon: 'image', display: 'Image' };
      }

      if (content.startsWith('data:video/')) {
        return { type: 'video', icon: 'videocam', display: 'Video' };
      }

      if (content.startsWith('data:audio/')) {
        return { type: 'audio', icon: 'audiotrack', display: 'Audio' };
      }

      // Check if it's very long text (likely needs truncation)
      if (content.length > 100) {
        return { type: 'text', icon: 'article', display: content.substring(0, 97) + '...' };
      }

      // Regular text
      return { type: 'text', icon: 'article', display: content };
    }
  }

  async confirmNwcPayment(): Promise<void> {
    this.isProcessing.set(true);
    this.errorMessage.set(null);

    try {
      const amount = this.getFinalAmount();
      const message = this.zapForm.get('message')?.value || '';

      // Check if this is a zap split
      if (this.data.zapSplits && this.data.zapSplits.length > 0) {
        // Get the event - either from data or load it
        let event = this.data.event;

        if (!event) {
          if (!this.data.eventId) {
            throw new Error('Event ID required for zap splits');
          }

          console.log('Loading event for split zap:', this.data.eventId);
          const eventRecord = await this.dataService.getEventById(this.data.eventId);
          console.log('Loaded event:', eventRecord);

          if (!eventRecord?.event) {
            console.error('Event data missing:', eventRecord);
            throw new Error('Could not load event for zap split. The event may not be available yet.');
          }

          event = eventRecord.event;
        }

        console.log('Sending split zap to', this.data.zapSplits.length, 'recipients');
        // Send split zap
        await this.zapService.sendSplitZap(event, amount, message);

        this.snackBar.open(
          `⚡ Successfully sent ${amount} sats split to ${this.data.zapSplits.length} recipients!`,
          'Dismiss',
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          }
        );
      } else {
        // Regular single-recipient zap
        await this.zapService.sendZap(
          this.data.recipientPubkey,
          amount,
          message,
          this.data.eventId,
          this.data.recipientMetadata,
          undefined, // customRelays
          this.data.goalEventId, // goalEventId
          this.data.eventKind, // eventKind
          this.data.eventAddress // eventAddress
        );

        this.snackBar.open(
          `⚡ Successfully sent ${amount} sats${this.data.recipientName ? ` to ${this.data.recipientName}` : ''}!`,
          'Dismiss',
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          }
        );
      }

      this.dialogRef.close({
        amount,
        message,
        paymentMethod: 'nwc',
      } as ZapDialogResult);
    } catch (error) {
      console.error('Failed to send zap:', error);
      const zapError = this.errorHandler.handleZapError(error);
      this.errorMessage.set(zapError.message);
      this.isErrorRecoverable.set(zapError.recoverable);
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
      }
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

  close(): void {
    this.dialogRef.close();
  }

  toggleForceComment(): void {
    this.forceComment.update(v => !v);
    this.updateFormValidators();
  }
}
