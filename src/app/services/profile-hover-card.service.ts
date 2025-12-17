import { Injectable, inject, signal, OnDestroy, NgZone } from '@angular/core';
import { Overlay, OverlayRef, ConnectedPosition } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
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
  private router = inject(Router);
  private ngZone = inject(NgZone);

  // Track active overlay and component references
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private currentPubkey: string | null = null;

  // Track mouse state
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);

  // Timers
  private hoverTimeout?: number;
  private closeTimeout?: number;

  // Scroll listener bound function
  private scrollListener = this.onScroll.bind(this);

  // Click outside listener for mobile
  private clickOutsideListener = this.onClickOutside.bind(this);

  constructor() {
    // Close hover card on navigation
    this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        this.closeHoverCard();
      });
  }

  /**
   * Handles scroll events - closes hover card when user scrolls
   */
  private onScroll(): void {
    // Close immediately on scroll
    this.closeHoverCard();
  }

  /**
   * Handles click/touch outside the hover card - closes it on mobile
   */
  private onClickOutside(event: MouseEvent | TouchEvent): void {
    if (!this.overlayRef) return;

    const overlayElement = this.overlayRef.overlayElement;
    const target = event.target as Node;

    // Check if click/touch is outside the hover card
    if (!overlayElement.contains(target)) {
      this.closeHoverCard();
    }
  }

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

    // If already showing the same profile, just keep it open
    if (this.overlayRef && this.currentPubkey === pubkey) {
      return;
    }

    // Clear any existing hover timeout
    if (this.hoverTimeout) {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    // If already showing a different profile, close it immediately
    if (this.overlayRef) {
      this.closeHoverCard();
    }

    // Show hover card after delay
    this.hoverTimeout = window.setTimeout(() => {
      this.createHoverCard(element, pubkey);
    }, delay);
  }

  /**
   * Shows a hover card immediately (no delay).
   * Use this for long-press/touch gestures on mobile.
   * @param element The HTML element to attach the hover card to
   * @param pubkey The public key of the profile to display
   */
  showHoverCardImmediately(element: HTMLElement, pubkey: string): void {
    // Close any existing card
    this.closeHoverCard();

    // Create immediately
    this.createHoverCard(element, pubkey);
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

    // Get element position and viewport dimensions
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Calculate available space
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const spaceRight = viewportWidth - rect.left;
    const spaceLeft = rect.right;

    // Estimated hover card dimensions (based on typical size)
    const cardHeight = 400; // Approximate height of hover card
    const cardWidth = 320; // Width from the component

    // Determine best vertical position (prefer below unless insufficient space)
    const preferAbove = spaceBelow < cardHeight && spaceAbove > spaceBelow;

    // Determine best horizontal position
    const preferLeft = spaceRight < cardWidth && spaceLeft > spaceRight;

    // Build position array with intelligent ordering
    const positions: ConnectedPosition[] = [];

    if (preferAbove) {
      // Show above when there's more space above
      if (preferLeft) {
        positions.push(
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -8,
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -8,
          }
        );
      } else {
        positions.push(
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
          }
        );
      }

      // Fallback to below
      if (preferLeft) {
        positions.push(
          {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 8,
          },
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 8,
          }
        );
      } else {
        positions.push(
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
          }
        );
      }
    } else {
      // Show below when there's more space below (default)
      if (preferLeft) {
        positions.push(
          {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 8,
          },
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 8,
          }
        );
      } else {
        positions.push(
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
          }
        );
      }

      // Fallback to above
      if (preferLeft) {
        positions.push(
          {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -8,
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -8,
          }
        );
      } else {
        positions.push(
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
          }
        );
      }
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions(positions)
      .withViewportMargin(16)
      .withPush(true)
      .withFlexibleDimensions(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: false,
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef = componentRef;
    this.currentPubkey = pubkey;

    // Add scroll listener to close on any scroll (capture phase to catch all scroll events)
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.scrollListener, { capture: true, passive: true });
      // Add click/touch outside listener for mobile (delayed to avoid immediate close from the triggering touch)
      setTimeout(() => {
        document.addEventListener('click', this.clickOutsideListener, { capture: true });
        document.addEventListener('touchstart', this.clickOutsideListener, { capture: true, passive: true });
      }, 100);
    });

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
   * Uses a longer delay (500ms) to give users time to move from the trigger to the card
   */
  private scheduleClose(): void {
    // Clear any existing close timeout to avoid premature closing
    if (this.closeTimeout) {
      window.clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    this.closeTimeout = window.setTimeout(() => {
      const isMenuOpen = this.hoverCardComponentRef?.instance?.isMenuOpen?.();
      if (!this.isMouseOverTrigger() && !this.isMouseOverCard() && !isMenuOpen) {
        this.closeHoverCard();
      }
    }, 500);
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

    // Remove scroll listener
    window.removeEventListener('scroll', this.scrollListener, { capture: true });

    // Remove click/touch outside listeners
    document.removeEventListener('click', this.clickOutsideListener, { capture: true });
    document.removeEventListener('touchstart', this.clickOutsideListener, { capture: true });

    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
      this.currentPubkey = null;
    }
  }

  /**
   * Clean up on service destruction
   */
  ngOnDestroy(): void {
    // Remove scroll listener on destroy
    window.removeEventListener('scroll', this.scrollListener, { capture: true });
    // Remove click/touch outside listeners
    document.removeEventListener('click', this.clickOutsideListener, { capture: true });
    document.removeEventListener('touchstart', this.clickOutsideListener, { capture: true });
    this.closeHoverCard();
  }
}
