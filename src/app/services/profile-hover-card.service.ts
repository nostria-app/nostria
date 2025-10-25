import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../components/user-profile/hover-card/profile-hover-card.component';

/**
 * Service to manage profile hover cards across the application
 * Provides a unified way to display profile hover cards with consistent behavior
 */
@Injectable({
  providedIn: 'root',
})
export class ProfileHoverCardService implements OnDestroy {
  private overlay = inject(Overlay);

  // Track active overlay and component references
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  
  // Track mouse state
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);
  
  // Timers
  private hoverTimeout?: number;
  private closeTimeout?: number;

  /**
   * Shows a hover card for a profile
   * @param element The HTML element to attach the hover card to
   * @param pubkey The public key of the profile to display
   * @param delay Optional delay before showing (default 500ms)
   */
  showHoverCard(element: HTMLElement, pubkey: string, delay = 500): void {
    this.isMouseOverTrigger.set(true);

    // Clear any existing close timeout
    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    // If already showing for this element, don't create another
    if (this.overlayRef) {
      return;
    }

    // Show hover card after delay
    this.hoverTimeout = window.setTimeout(() => {
      this.createHoverCard(element, pubkey);
    }, delay);
  }

  /**
   * Hides the currently displayed hover card
   */
  hideHoverCard(): void {
    this.isMouseOverTrigger.set(false);

    // Clear hover timeout
    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    // Schedule close
    this.scheduleClose();
  }

  /**
   * Creates and displays the hover card overlay
   */
  private createHoverCard(element: HTMLElement, pubkey: string): void {
    // Don't show if already showing
    if (this.overlayRef) {
      return;
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions([
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'end',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'bottom',
          offsetY: -8,
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom',
          offsetY: -8,
        },
      ])
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: false,
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef = componentRef;

    // Add mouse enter/leave listeners to overlay
    const overlayElement = this.overlayRef.overlayElement;
    overlayElement.addEventListener('mouseenter', () => {
      this.isMouseOverCard.set(true);
      if (this.closeTimeout) {
        window.clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
    });

    overlayElement.addEventListener('mouseleave', () => {
      this.isMouseOverCard.set(false);
      this.scheduleClose();
    });
  }

  /**
   * Schedules closing the hover card
   */
  private scheduleClose(): void {
    this.closeTimeout = window.setTimeout(() => {
      const isMenuOpen = this.hoverCardComponentRef?.instance?.isMenuOpen?.();
      if (!this.isMouseOverTrigger() && !this.isMouseOverCard() && !isMenuOpen) {
        this.closeHoverCard();
      }
    }, 300);
  }

  /**
   * Closes and cleans up the hover card
   */
  private closeHoverCard(): void {
    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }

  /**
   * Clean up on service destruction
   */
  ngOnDestroy(): void {
    this.closeHoverCard();
  }
}
