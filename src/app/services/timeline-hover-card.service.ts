import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { Overlay, OverlayRef, ConnectedPosition } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TimelineHoverCardComponent } from '../components/timeline-hover-card/timeline-hover-card.component';

/**
 * Service to manage timeline hover cards across the application
 * Shows recent posts when hovering over favorite users
 */
@Injectable({
  providedIn: 'root',
})
export class TimelineHoverCardService implements OnDestroy {
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

  // Track the current target element and pubkey to prevent flickering
  private currentTargetElement: HTMLElement | null = null;
  private currentPubkey: string | null = null;

  /**
   * Shows a timeline hover card for a user
   * @param element The HTML element to attach the hover card to
   * @param pubkey The public key of the user whose timeline to display
   * @param delay Optional delay before showing (default 500ms)
   */
  showHoverCard(element: HTMLElement, pubkey: string, delay = 500): void {
    // If hovering over the same element, don't restart the process
    if (this.currentTargetElement === element && this.currentPubkey === pubkey) {
      // Just ensure we're marked as hovering and cancel any pending close
      this.isMouseOverTrigger.set(true);
      if (this.closeTimeout) {
        window.clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
      return;
    }

    this.isMouseOverTrigger.set(true);
    this.currentTargetElement = element;
    this.currentPubkey = pubkey;

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

    // If already showing a hover card for a different user, close it first
    if (this.overlayRef) {
      // Dispose the overlay but don't reset state flags
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
      this.isMouseOverCard.set(false);
    }

    // Show hover card after delay
    this.hoverTimeout = window.setTimeout(() => {
      // Double-check the element and pubkey are still the same
      if (this.currentTargetElement === element && this.currentPubkey === pubkey && this.isMouseOverTrigger()) {
        this.createHoverCard(element, pubkey);
      }
    }, delay);
  }

  /**
   * Hides the currently displayed hover card
   */
  hideHoverCard(): void {
    this.isMouseOverTrigger.set(false);
    this.currentTargetElement = null;
    this.currentPubkey = null;

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

    // Get element position and viewport dimensions
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Determine optimal position
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const spaceRight = viewportWidth - rect.right;
    const spaceLeft = rect.left;

    // Card dimensions (approximate)
    const cardWidth = 400;
    const cardHeight = 500;

    // Build position strategies
    const positions: ConnectedPosition[] = [];

    // Prefer right if there's space
    if (spaceRight >= cardWidth) {
      positions.push({
        originX: 'end',
        originY: 'center',
        overlayX: 'start',
        overlayY: 'center',
        offsetX: 8,
      });
    }

    // Then try left
    if (spaceLeft >= cardWidth) {
      positions.push({
        originX: 'start',
        originY: 'center',
        overlayX: 'end',
        overlayY: 'center',
        offsetX: -8,
      });
    }

    // Then try below
    if (spaceBelow >= cardHeight) {
      positions.push({
        originX: 'center',
        originY: 'bottom',
        overlayX: 'center',
        overlayY: 'top',
        offsetY: 8,
      });
    }

    // Then try above
    if (spaceAbove >= cardHeight) {
      positions.push({
        originX: 'center',
        originY: 'top',
        overlayX: 'center',
        overlayY: 'bottom',
        offsetY: -8,
      });
    }

    // Fallback: right side
    if (positions.length === 0) {
      positions.push({
        originX: 'end',
        originY: 'center',
        overlayX: 'start',
        overlayY: 'center',
        offsetX: 8,
      });
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions(positions)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: false,
    });

    const portal = new ComponentPortal(TimelineHoverCardComponent);
    this.hoverCardComponentRef = this.overlayRef.attach(portal);

    // Set the pubkey input
    this.hoverCardComponentRef.setInput('pubkey', pubkey);

    // Add mouse enter/leave handlers to the card
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cardElement = (this.overlayRef as any).overlayElement as HTMLElement;
    if (cardElement) {
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
  }

  /**
   * Schedules the card to close after a delay
   */
  private scheduleClose(): void {
    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
    }

    this.closeTimeout = window.setTimeout(() => {
      if (!this.isMouseOverTrigger() && !this.isMouseOverCard()) {
        this.closeHoverCard();
      }
    }, 300);
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
    this.currentTargetElement = null;
    this.currentPubkey = null;

    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
  }

  ngOnDestroy(): void {
    this.closeHoverCard();
  }
}
