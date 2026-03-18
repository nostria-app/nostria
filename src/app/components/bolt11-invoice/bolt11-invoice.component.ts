import { Component, input, signal, inject, computed, PLATFORM_ID } from '@angular/core';
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
import { PayInvoiceDialogComponent, PayInvoiceDialogData } from '../pay-invoice-dialog/pay-invoice-dialog.component';

interface DecodedInvoiceData {
  paymentHash: string;
  satoshi: number;
  timestamp: number;
  expiry: number | undefined;
  description: string | undefined;
}

@Component({
  selector: 'app-bolt11-invoice',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, OverlayModule, QrCodeComponent],
  templateUrl: './bolt11-invoice.component.html',
  styleUrl: './bolt11-invoice.component.scss',
})
export class Bolt11InvoiceComponent {
  invoice = input.required<string>();

  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private overlay = inject(Overlay);
  private customDialog = inject(CustomDialogService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  showQrCode = signal(false);
  private overlayRef: OverlayRef | null = null;

  // Decoded invoice data
  decoded = signal<DecodedInvoiceData | null>(null);
  decodeAttempted = signal(false);

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
   */
  async ngOnInit(): Promise<void> {
    try {
      const { decodeInvoice } = await import('@getalby/lightning-tools');
      const result = decodeInvoice(this.invoice());
      this.decoded.set(result);
    } catch {
      // Decode failed silently — the component will show the truncated invoice string
    } finally {
      this.decodeAttempted.set(true);
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
