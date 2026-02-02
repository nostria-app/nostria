import { Component, input, signal, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayModule, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { QrCodeComponent } from '../qr-code/qr-code.component';

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

  showQrCode = signal(false);
  private overlayRef: OverlayRef | null = null;

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
   * Open invoice in lightning wallet
   */
  openInWallet(): void {
    window.location.href = this.getLightningUrl();
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
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /**
   * Get display label
   */
  getTypeLabel(): string {
    return 'BOLT11 Invoice';
  }

  /**
   * Get icon
   */
  getTypeIcon(): string {
    return 'bolt';
  }
}
