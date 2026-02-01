import { Injectable, inject, signal, OnDestroy, NgZone, Type } from '@angular/core';
import { Overlay, OverlayRef, ConnectedPosition } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
// ProfileHoverCardComponent is dynamically imported to break circular dependency

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

  // Cached component type for lazy loading
  private ProfileHoverCardComponentType: Type<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Track mouse state
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);

  // Timers
  private hoverTimeout?: number;
  private closeTimeout?: number;

  // Scroll listener bound function
  private scrollListener = this.onScroll.bind(this);
  constructor() {
    // Close hover card immediately on navigation
    this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        // Reset mouse state immediately to prevent any pending timeouts from opening cards
        this.isMouseOverTrigger.set(false);
        this.isMouseOverCard.set(false);

        // Clear all timers and close immediately
        if (this.hoverTimeout) {
          window.clearTimeout(this.hoverTimeout);
          this.hoverTimeout = undefined;
        }
        if (this.closeTimeout) {
          window.clearTimeout(this.closeTimeout);
          this.closeTimeout = undefined;
        }
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
    // Use internal close to avoid resetting isMouseOverTrigger since we're about to show a new card
    if (this.overlayRef) {
      this.closeOverlay();
    }

    // Show hover card after delay
    this.hoverTimeout = window.setTimeout(() => {
      // Double-check we should still show the card (prevents race conditions)
      if (this.isMouseOverTrigger()) {
        this.createHoverCard(element, pubkey);
      }
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
  private async createHoverCard(element: HTMLElement, pubkey: string): Promise<void> {
    // Don't show if already showing or if mouse is no longer over trigger
    if (this.overlayRef || !this.isMouseOverTrigger()) {
      return;
    }

    // Verify element is still in DOM and visible (prevents stuck cards after navigation)
    if (!document.body.contains(element)) {
      this.isMouseOverTrigger.set(false);
      return;
    }

    // Dynamically import the component to break circular dependency
    if (!this.ProfileHoverCardComponentType) {
      const { ProfileHoverCardComponent } = await import('../components/user-profile/hover-card/profile-hover-card.component');
      this.ProfileHoverCardComponentType = ProfileHoverCardComponent;
    }

    // Check again after async import - element might have been removed during import
    if (!document.body.contains(element) || !this.isMouseOverTrigger()) {
      this.isMouseOverTrigger.set(false);
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

    const portal = new ComponentPortal(this.ProfileHoverCardComponentType!);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef = componentRef;
    this.currentPubkey = pubkey;

    // Add scroll listener to close on any scroll (capture phase to catch all scroll events)
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.scrollListener, { capture: true, passive: true });
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

    overlayElement.addEventListener('mouseleave', (event: MouseEvent) => {
      // Don't close if moving to a menu (Material menus are rendered outside the overlay)
      const relatedTarget = event.relatedTarget as HTMLElement;
      if (relatedTarget?.closest('.cdk-overlay-pane')) {
        // Moving to another overlay (like a menu), don't schedule close yet
        return;
      }

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
      } else if (isMenuOpen) {
        // If menu is open, check again after it might be closed
        this.scheduleClose();
      }
    }, 500);
  }

  /**
   * Internal method to close overlay without resetting mouse state.
   * Used when switching between profiles to avoid race conditions.
   */
  private closeOverlay(): void {
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

    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
      this.currentPubkey = null;
    }
  }

  /**
   * Closes and cleans up the hover card
   */
  closeHoverCard(): void {
    // Reset mouse state signals to prevent stuck states
    this.isMouseOverTrigger.set(false);
    this.isMouseOverCard.set(false);

    this.closeOverlay();
  }

  /**
   * Clean up on service destruction
   */
  ngOnDestroy(): void {
    // Remove scroll listener on destroy
    window.removeEventListener('scroll', this.scrollListener, { capture: true });
    this.closeHoverCard();
  }
}
