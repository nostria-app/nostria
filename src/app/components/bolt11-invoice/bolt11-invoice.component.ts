import { Component, input, signal, inject, computed, PLATFORM_ID, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayModule, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { QrCodeComponent } from '../qr-code/qr-code.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { PayInvoiceDialogComponent, PayInvoiceDialogData, PayInvoiceDialogResult } from '../pay-invoice-dialog/pay-invoice-dialog.component';
import { Wallets } from '../../services/wallets';
import { NwcService } from '../../services/nwc.service';
import { AccountStateService } from '../../services/account-state.service';

type InvoiceState = 'pending' | 'settled' | 'failed' | 'accepted' | 'expired' | 'unknown';

interface DecodedInvoiceData {
  paymentHash: string;
  satoshi: number;
  timestamp: number;
  expiry: number | undefined;
  description: string | undefined;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-bolt11-invoice',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, OverlayModule, QrCodeComponent],
  templateUrl: './bolt11-invoice.component.html',
  styleUrl: './bolt11-invoice.component.scss',
})
export class Bolt11InvoiceComponent implements OnInit, OnDestroy {
  invoice = input.required<string>();

  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private overlay = inject(Overlay);
  private customDialog = inject(CustomDialogService);
  private wallets = inject(Wallets);
  private nwcService = inject(NwcService);
  private accountState = inject(AccountStateService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  showQrCode = signal(false);
  private overlayRef: OverlayRef | null = null;

  // Decoded invoice data
  decoded = signal<DecodedInvoiceData | null>(null);
  decodeAttempted = signal(false);

  // Invoice payment status (from lookupInvoice polling)
  invoiceState = signal<InvoiceState>('unknown');
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  // Once a wallet recognizes the invoice, cache its pubkey for efficient subsequent lookups
  private ownerWalletPubkey: string | null = null;
  private pollingStopped = false;
  // Count consecutive "not recognized" results to stop after a reasonable limit
  private notRecognizedCount = 0;
  private readonly maxNotRecognized = 5;
  // Count consecutive errors to apply backoff
  private consecutiveErrors = 0;
  private readonly maxConsecutiveErrors = 5;

  // Terminal states that stop polling
  private readonly terminalStates: InvoiceState[] = ['settled', 'failed', 'accepted', 'expired'];

  isPaid = computed(() => this.invoiceState() === 'settled');
  isFailed = computed(() => this.invoiceState() === 'failed');

  // Computed properties from decoded data
  amountSats = computed(() => this.decoded()?.satoshi ?? 0);
  description = computed(() => this.decoded()?.description);
  isExpired = computed(() => {
    const d = this.decoded();
    if (!d || !d.expiry) return false;
    const expiryTime = d.timestamp + d.expiry;
    return Math.floor(Date.now() / 1000) > expiryTime;
  });
  expiryDate = computed(() => {
    const d = this.decoded();
    if (!d || !d.expiry) return null;
    return new Date((d.timestamp + d.expiry) * 1000);
  });

  /**
   * Decode the invoice on initialization.
   * Uses dynamic import so @getalby/lightning-tools is not in the main bundle.
   * After decoding, checks local paid cache first, then starts polling if needed.
   */
  async ngOnInit(): Promise<void> {
    // Check local paid invoices cache immediately — no wallet query needed
    if (this.isBrowser && this.accountState.isInvoicePaid(this.invoice())) {
      this.invoiceState.set('settled');
      this.decodeAttempted.set(true);

      // Still decode for display purposes (amount, description) but skip polling
      try {
        const { decodeInvoice } = await import('@getalby/lightning-tools');
        const result = decodeInvoice(this.invoice());
        this.decoded.set(result);
      } catch {
        // Decode failed silently
      }
      return;
    }

    try {
      const { decodeInvoice } = await import('@getalby/lightning-tools');
      const result = decodeInvoice(this.invoice());
      this.decoded.set(result);
    } catch {
      // Decode failed silently — the component will show the truncated invoice string
    } finally {
      this.decodeAttempted.set(true);
    }

    // Check if already expired before starting polling
    if (this.isExpired()) {
      this.invoiceState.set('expired');
      return;
    }

    // Start polling for payment status if we have a wallet
    if (this.isBrowser && this.wallets.hasWallets()) {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /**
   * Start polling lookupInvoice every 5 seconds via NwcService.
   * Uses NwcService's cached NWC clients to avoid creating new relay connections.
   * Stops on terminal states or after repeated failures.
   */
  private startPolling(): void {
    // Do an immediate lookup first
    this.lookupInvoiceStatus();

    this.pollingInterval = setInterval(() => {
      if (this.pollingStopped) {
        this.stopPolling();
        return;
      }
      const currentState = this.invoiceState();
      if (this.terminalStates.includes(currentState)) {
        this.stopPolling();
        return;
      }
      this.lookupInvoiceStatus();
    }, 5000);
  }

  private stopPolling(): void {
    this.pollingStopped = true;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Lookup invoice status via NwcService.lookupInvoice().
   * Uses NwcService's cached, properly managed NWC clients instead of
   * creating ephemeral clients that open new relay connections each time.
   *
   * On first successful lookup, caches the wallet pubkey for efficient future polls.
   * If no wallet recognizes the invoice after maxNotRecognized attempts, stops polling.
   * On repeated errors, stops polling to avoid wasting resources.
   */
  private async lookupInvoiceStatus(): Promise<void> {
    if (this.isPolling || this.pollingStopped) return;
    this.isPolling = true;

    try {
      const invoiceStr = this.invoice();
      // Use NwcService which manages cached NWC clients properly.
      // If we already know which wallet owns the invoice, pass its pubkey for efficiency.
      const result = await this.nwcService.lookupInvoice(invoiceStr, this.ownerWalletPubkey ?? undefined);

      if (result) {
        // Cache the owning wallet for future polls
        this.ownerWalletPubkey = result.walletPubkey;
        this.notRecognizedCount = 0;
        this.consecutiveErrors = 0;

        const state = (result.transaction.state as InvoiceState) ?? 'unknown';
        this.invoiceState.set(state);

        if (this.terminalStates.includes(state)) {
          // Persist settled status so we never have to poll for this invoice again
          if (state === 'settled') {
            this.accountState.markInvoicePaid(invoiceStr);
          }
          this.stopPolling();
        }
      } else {
        // No wallet recognized this invoice yet — keep trying up to a limit.
        this.notRecognizedCount++;
        if (this.notRecognizedCount >= this.maxNotRecognized) {
          this.stopPolling();
        }
      }
    } catch {
      // Track consecutive errors — stop after too many to avoid infinite retry
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        this.stopPolling();
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Get truncated invoice string for display
   */
  getTruncatedInvoice(): string {
    const invoice = this.invoice();
    if (invoice.length <= 30) return invoice;
    return `${invoice.substring(0, 15)}...${invoice.substring(invoice.length - 10)}`;
  }

  /**
   * Get the lightning: protocol URL for the invoice
   */
  getLightningUrl(): string {
    return `lightning:${this.invoice()}`;
  }

  /**
   * Format sats for display
   */
  formatSats(sats: number): string {
    return sats.toLocaleString();
  }

  /**
   * Copy invoice to clipboard
   */
  copyInvoice(): void {
    const success = this.clipboard.copy(this.invoice());

    if (success) {
      this.snackBar.open('BOLT11 invoice copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  /**
   * Open invoice in lightning wallet via lightning: URL scheme
   */
  openInWallet(): void {
    if (this.isBrowser) {
      window.location.href = this.getLightningUrl();
    }
  }

  /**
   * Open the Pay Invoice dialog
   */
  openPayDialog(): void {
    const d = this.decoded();
    const dialogRef = this.customDialog.open(PayInvoiceDialogComponent, {
      title: 'Pay Invoice',
      width: '450px',
      data: {
        invoice: this.invoice(),
        amountSats: d?.satoshi ?? 0,
        description: d?.description,
        expiry: d?.expiry,
        timestamp: d?.timestamp,
      } as PayInvoiceDialogData,
    });

    // The dialog component has an initialize() method
    if (dialogRef.componentInstance && typeof dialogRef.componentInstance.initialize === 'function') {
      dialogRef.componentInstance.initialize();
    }

    // Listen for dialog close — if payment succeeded, mark invoice as settled
    dialogRef.afterClosed$.subscribe(({ result }) => {
      const payResult = result as PayInvoiceDialogResult | undefined;
      if (payResult?.success) {
        this.invoiceState.set('settled');
        this.stopPolling();
        this.accountState.markInvoicePaid(this.invoice());
      }
    });
  }

  /**
   * Toggle QR code visibility (for mobile click)
   */
  toggleQrCode(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.showQrCode()) {
      this.hideQrCode();
    } else {
      this.showQrOverlay(event.target as HTMLElement);
    }
  }

  /**
   * Show QR code on hover (desktop)
   */
  onQrButtonMouseEnter(event: MouseEvent): void {
    // Only show on hover for non-touch devices
    if (!this.isTouchDevice()) {
      this.showQrOverlay(event.target as HTMLElement);
    }
  }

  /**
   * Hide QR code on mouse leave (desktop)
   */
  onQrButtonMouseLeave(): void {
    if (!this.isTouchDevice()) {
      this.hideQrCode();
    }
  }

  /**
   * Show QR code overlay
   */
  private showQrOverlay(element: HTMLElement): void {
    if (this.overlayRef) {
      return; // Already showing
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions([
        {
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetY: -8,
        },
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
        },
      ])
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: this.isTouchDevice(),
      backdropClass: 'qr-backdrop',
    });

    // For touch devices, close when backdrop is clicked
    if (this.isTouchDevice()) {
      this.overlayRef.backdropClick().subscribe(() => {
        this.hideQrCode();
      });
    }

    const portal = new ComponentPortal(QrCodeComponent);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.setInput('qrdata', this.getLightningUrl());
    componentRef.setInput('width', 200);

    this.showQrCode.set(true);
  }

  /**
   * Hide QR code overlay
   */
  hideQrCode(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    this.showQrCode.set(false);
  }

  /**
   * Check if device is touch-enabled
   */
  private isTouchDevice(): boolean {
    if (!this.isBrowser) return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }
}
