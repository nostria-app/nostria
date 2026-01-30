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
  selector: 'app-bolt12-offer',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, OverlayModule, QrCodeComponent],
  templateUrl: './bolt12-offer.component.html',
  styleUrl: './bolt12-offer.component.scss',
})
export class Bolt12OfferComponent {
  offer = input.required<string>();
  type = input<'offer' | 'invoice'>('offer');

  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private overlay = inject(Overlay);

  showQrCode = signal(false);
  private overlayRef: OverlayRef | null = null;

  /**
   * Get truncated offer string for display
   */
  getTruncatedOffer(): string {
    const offer = this.offer();
    if (offer.length <= 30) return offer;
    return `${offer.substring(0, 15)}...${offer.substring(offer.length - 10)}`;
  }

  /**
   * Get the lightning: protocol URL for the offer
   */
  getLightningUrl(): string {
    return `lightning:${this.offer()}`;
  }

  /**
   * Copy offer to clipboard
   */
  copyOffer(): void {
    const success = this.clipboard.copy(this.offer());

    if (success) {
      this.snackBar.open('BOLT12 offer copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  /**
   * Open offer in lightning wallet
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
   * Get display label based on type
   */
  getTypeLabel(): string {
    return this.type() === 'offer' ? 'BOLT12 Offer' : 'BOLT12 Invoice';
  }

  /**
   * Get icon based on type
   */
  getTypeIcon(): string {
    return this.type() === 'offer' ? 'flash_on' : 'receipt_long';
  }
}
