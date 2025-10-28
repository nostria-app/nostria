import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
import { BadgeHoverCardComponent } from '../components/badge/hover-card/badge-hover-card.component';

/**
 * Service to manage badge hover cards across the application
 * Provides a unified way to display badge hover cards with consistent behavior
 */
@Injectable({
  providedIn: 'root',
})
export class BadgeHoverCardService implements OnDestroy {
  private overlay = inject(Overlay);
  private router = inject(Router);

  // Track active overlay and component references
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Track mouse state
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);

  // Timers
  private hoverTimeout?: number;
  private closeTimeout?: number;

  constructor() {
    // Close hover card on navigation
    this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        this.closeHoverCard();
      });
  }

  /**
   * Shows a hover card for a badge
   * @param element The HTML element to attach the hover card to
   * @param pubkey The public key of the badge issuer
   * @param slug The badge slug identifier
   * @param delay Optional delay before showing (default 500ms)
   */
  showHoverCard(element: HTMLElement, pubkey: string, slug: string, delay = 500): void {
    this.isMouseOverTrigger.set(true);

    // Clear any existing close timeout
    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    // Clear any existing hover timeout
    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    // If already showing a hover card, close it immediately
    if (this.overlayRef) {
      this.closeHoverCard();
    }

    // Show hover card after delay
    this.hoverTimeout = window.setTimeout(() => {
      this.createHoverCard(element, pubkey, slug);
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
  private createHoverCard(element: HTMLElement, pubkey: string, slug: string): void {
    // Don't show if already showing
    if (this.overlayRef) {
      return;
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
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
        },
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
        },
      ])
      .withPush(true)
      .withViewportMargin(16);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: false,
    });

    const portal = new ComponentPortal(BadgeHoverCardComponent);
    this.hoverCardComponentRef = this.overlayRef.attach(portal);

    // Set the badge data
    this.hoverCardComponentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef.setInput('slug', slug);

    // Handle mouse events on the card
    const cardElement = this.overlayRef.overlayElement;

    cardElement.addEventListener('mouseenter', () => {
      this.isMouseOverCard.set(true);
      if (this.closeTimeout) {
        window.clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
    });

    cardElement.addEventListener('mouseleave', () => {
      this.isMouseOverCard.set(false);
      this.scheduleClose();
    });
  }

  /**
   * Schedules the closing of the hover card
   */
  private scheduleClose(): void {
    // Clear any existing close timeout
    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
    }

    // Close after delay if mouse is not over trigger or card
    this.closeTimeout = window.setTimeout(() => {
      if (!this.isMouseOverTrigger() && !this.isMouseOverCard()) {
        this.closeHoverCard();
      }
    }, 200);
  }

  /**
   * Immediately closes the hover card
   */
  private closeHoverCard(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }

    this.isMouseOverTrigger.set(false);
    this.isMouseOverCard.set(false);

    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
  }

  ngOnDestroy(): void {
    this.closeHoverCard();
  }
}
