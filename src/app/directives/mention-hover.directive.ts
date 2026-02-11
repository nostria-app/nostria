import { Directive, ElementRef, inject, NgZone, OnDestroy, ViewContainerRef, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Overlay, OverlayRef, ConnectedPosition } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router, NavigationStart } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { ProfileHoverCardComponent } from '../components/user-profile/hover-card/profile-hover-card.component';

/**
 * Directive to add hover tooltips for mentions in innerHTML-rendered content
 * Listens for mouseenter/mouseleave on elements with .nostr-mention class
 * On touch devices, uses long-press (press and hold) instead of hover
 */
@Directive({
  selector: '[appMentionHover]',
})
export class MentionHoverDirective implements OnDestroy {
  private el = inject(ElementRef);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);
  private router = inject(Router);
  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);

  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private hoverTimeout?: number;
  private closeTimeout?: number;
  private currentTrigger: HTMLElement | null = null;

  private isMouseOverTrigger = false;
  private isMouseOverCard = false;
  private routerSubscription?: Subscription;

  // Long press support for touch devices
  private longPressTimeout?: number;
  private longPressTrigger: HTMLElement | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly LONG_PRESS_DURATION = 500;
  private readonly MOVE_THRESHOLD = 10;

  // Detect touch device
  private isTouchDevice = isPlatformBrowser(this.platformId) && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Scroll listener bound function
  private scrollListener = this.onScroll.bind(this);

  constructor() {
    // Use event delegation to handle dynamically created mention links
    this.el.nativeElement.addEventListener('mouseenter', this.onMouseEnter.bind(this), true);
    this.el.nativeElement.addEventListener('mouseleave', this.onMouseLeave.bind(this), true);

    // Add touch event listeners for long-press on touch devices
    if (this.isTouchDevice) {
      this.el.nativeElement.addEventListener('touchstart', this.onTouchStart.bind(this), { capture: true, passive: true });
      this.el.nativeElement.addEventListener('touchend', this.onTouchEnd.bind(this), true);
      this.el.nativeElement.addEventListener('touchmove', this.onTouchMove.bind(this), { capture: true, passive: true });
      this.el.nativeElement.addEventListener('touchcancel', this.onTouchEnd.bind(this), true);
    }

    // Close hover card on navigation
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        this.closeHoverCard();
      });
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.el.nativeElement.removeEventListener('mouseenter', this.onMouseEnter.bind(this), true);
    this.el.nativeElement.removeEventListener('mouseleave', this.onMouseLeave.bind(this), true);
    if (this.isTouchDevice) {
      this.el.nativeElement.removeEventListener('touchstart', this.onTouchStart.bind(this), true);
      this.el.nativeElement.removeEventListener('touchend', this.onTouchEnd.bind(this), true);
      this.el.nativeElement.removeEventListener('touchmove', this.onTouchMove.bind(this), true);
      this.el.nativeElement.removeEventListener('touchcancel', this.onTouchEnd.bind(this), true);
    }
    this.routerSubscription?.unsubscribe();
  }

  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      this.cancelLongPress();
      return;
    }

    const target = event.target as HTMLElement;
    const mentionLink = this.findMentionLink(target);
    if (!mentionLink) {
      return;
    }

    const pubkey = mentionLink.getAttribute('data-pubkey');
    const type = mentionLink.getAttribute('data-type');

    if (type !== 'profile' || !pubkey) {
      return;
    }

    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.longPressTrigger = mentionLink;

    this.longPressTimeout = window.setTimeout(() => {
      if (this.longPressTrigger === mentionLink) {
        this.ngZone.run(() => {
          this.showHoverCard(mentionLink, pubkey);
        });
      }
    }, this.LONG_PRESS_DURATION);
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.longPressTimeout || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - this.touchStartX);
    const deltaY = Math.abs(touch.clientY - this.touchStartY);

    if (deltaX > this.MOVE_THRESHOLD || deltaY > this.MOVE_THRESHOLD) {
      this.cancelLongPress();
    }
  }

  private onTouchEnd(): void {
    this.cancelLongPress();
  }

  private cancelLongPress(): void {
    if (this.longPressTimeout) {
      window.clearTimeout(this.longPressTimeout);
      this.longPressTimeout = undefined;
    }
    this.longPressTrigger = null;
  }

  private onMouseEnter(event: MouseEvent): void {
    // Skip hover on touch devices - they use long press instead
    if (this.isTouchDevice) {
      return;
    }

    const target = event.target as HTMLElement;

    // Check if the target or any parent is a nostr-mention link
    const mentionLink = this.findMentionLink(target);
    if (!mentionLink) {
      return;
    }

    const pubkey = mentionLink.getAttribute('data-pubkey');
    const type = mentionLink.getAttribute('data-type');

    // Only show for profile mentions
    if (type !== 'profile' || !pubkey) {
      return;
    }

    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }

    this.currentTrigger = mentionLink;
    this.isMouseOverTrigger = true;

    this.hoverTimeout = setTimeout(() => {
      if (this.isMouseOverTrigger && this.currentTrigger === mentionLink) {
        this.showHoverCard(mentionLink, pubkey);
      }
    }, 500) as unknown as number;
  }

  private onMouseLeave(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const mentionLink = this.findMentionLink(target);

    if (mentionLink === this.currentTrigger) {
      this.isMouseOverTrigger = false;
      this.scheduleClose();
    }
  }

  private findMentionLink(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current && current !== this.el.nativeElement) {
      if (current.classList.contains('nostr-mention')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private showHoverCard(element: HTMLElement, pubkey: string): void {
    if (this.overlayRef) {
      return;
    }

    // Create an ElementRef wrapper for proper positioning
    const elementRef = new ElementRef(element);

    // Calculate available space to intelligently order positions
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const cardHeight = 400; // Approximate height of fully loaded hover card

    const preferAbove = spaceBelow < cardHeight && spaceAbove > spaceBelow;

    const positions: ConnectedPosition[] = preferAbove
      ? [
        { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
        { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
      ]
      : [
        { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
        { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
      ];

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(elementRef)
      .withPositions(positions)
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent, this.viewContainerRef);
    this.hoverCardComponentRef = this.overlayRef.attach(portal);
    this.hoverCardComponentRef.setInput('pubkey', pubkey);

    // Add scroll listener to close on any scroll (capture phase to catch all scroll events)
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.scrollListener, { capture: true, passive: true });
    });

    // Track mouse over card
    const cardElement = this.overlayRef.overlayElement;
    cardElement.addEventListener('mouseenter', () => {
      this.isMouseOverCard = true;
      if (this.closeTimeout) {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
    });
    cardElement.addEventListener('mouseleave', () => {
      this.isMouseOverCard = false;
      this.scheduleClose();
    });
  }

  private scheduleClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }

    this.closeTimeout = setTimeout(() => {
      // Check if menu is open
      if (this.hoverCardComponentRef?.instance?.isMenuOpen?.()) {
        this.scheduleClose(); // Reschedule
        return;
      }

      if (!this.isMouseOverTrigger && !this.isMouseOverCard) {
        this.closeHoverCard();
      } else {
        this.scheduleClose(); // Reschedule
      }
    }, 300) as unknown as number;
  }

  private closeHoverCard(): void {
    this.cleanup();
    this.currentTrigger = null;
  }

  /**
   * Handles scroll events - closes hover card when user scrolls
   */
  private onScroll(): void {
    this.closeHoverCard();
  }

  private cleanup(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    this.cancelLongPress();
    // Remove scroll listener
    window.removeEventListener('scroll', this.scrollListener, { capture: true });
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }
}
