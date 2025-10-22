import { Directive, ElementRef, inject, OnDestroy, ViewContainerRef } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../components/user-profile/hover-card/profile-hover-card.component';

/**
 * Directive to add hover tooltips for mentions in innerHTML-rendered content
 * Listens for mouseenter/mouseleave on elements with .nostr-mention class
 */
@Directive({
  selector: '[appMentionHover]',
  standalone: true,
})
export class MentionHoverDirective implements OnDestroy {
  private el = inject(ElementRef);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);

  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private hoverTimeout?: number;
  private closeTimeout?: number;
  private currentTrigger: HTMLElement | null = null;

  private isMouseOverTrigger = false;
  private isMouseOverCard = false;

  constructor() {
    // Use event delegation to handle dynamically created mention links
    this.el.nativeElement.addEventListener('mouseenter', this.onMouseEnter.bind(this), true);
    this.el.nativeElement.addEventListener('mouseleave', this.onMouseLeave.bind(this), true);
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.el.nativeElement.removeEventListener('mouseenter', this.onMouseEnter.bind(this), true);
    this.el.nativeElement.removeEventListener('mouseleave', this.onMouseLeave.bind(this), true);
  }

  private onMouseEnter(event: MouseEvent): void {
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

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(elementRef)
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
        {
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
        },
      ])
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent, this.viewContainerRef);
    this.hoverCardComponentRef = this.overlayRef.attach(portal);
    this.hoverCardComponentRef.setInput('pubkey', pubkey);

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

  private cleanup(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }
}
