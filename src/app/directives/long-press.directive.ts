import { Directive, ElementRef, inject, input, output, OnDestroy, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Directive that emits an event when the user performs a long press (press and hold).
 * Works on both touch and mouse devices.
 * 
 * Usage:
 * <div appLongPress (longPress)="onLongPress($event)" [longPressDuration]="500">
 *   Press and hold me
 * </div>
 */
@Directive({
  selector: '[appLongPress]',
})
export class LongPressDirective implements OnDestroy {
  private el = inject(ElementRef);
  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);

  /** Duration in milliseconds before the long press is triggered (default: 500ms) */
  longPressDuration = input<number>(500);

  /** Emitted when a long press is detected. The event contains the original touch/mouse event. */
  longPress = output<TouchEvent | MouseEvent>();

  /** Emitted when long press is cancelled (finger lifted before duration) */
  longPressCancel = output<void>();

  private pressTimer: number | null = null;
  private isLongPressTriggered = false;
  private startX = 0;
  private startY = 0;
  private readonly MOVE_THRESHOLD = 10; // pixels

  // Bound event handlers for cleanup
  private boundTouchStart = this.onTouchStart.bind(this);
  private boundTouchEnd = this.onTouchEnd.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);
  private boundMouseDown = this.onMouseDown.bind(this);
  private boundMouseUp = this.onMouseUp.bind(this);
  private boundMouseLeave = this.onMouseLeave.bind(this);
  private boundContextMenu = this.onContextMenu.bind(this);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.ngZone.runOutsideAngular(() => {
        const element = this.el.nativeElement;

        // Touch events
        element.addEventListener('touchstart', this.boundTouchStart, { passive: true });
        element.addEventListener('touchend', this.boundTouchEnd);
        element.addEventListener('touchmove', this.boundTouchMove, { passive: true });
        element.addEventListener('touchcancel', this.boundTouchEnd);

        // Mouse events for desktop long-click
        element.addEventListener('mousedown', this.boundMouseDown);
        element.addEventListener('mouseup', this.boundMouseUp);
        element.addEventListener('mouseleave', this.boundMouseLeave);

        // Prevent context menu on long press
        element.addEventListener('contextmenu', this.boundContextMenu);
      });
    }
  }

  ngOnDestroy(): void {
    this.cancelPress();
    if (isPlatformBrowser(this.platformId)) {
      const element = this.el.nativeElement;
      element.removeEventListener('touchstart', this.boundTouchStart);
      element.removeEventListener('touchend', this.boundTouchEnd);
      element.removeEventListener('touchmove', this.boundTouchMove);
      element.removeEventListener('touchcancel', this.boundTouchEnd);
      element.removeEventListener('mousedown', this.boundMouseDown);
      element.removeEventListener('mouseup', this.boundMouseUp);
      element.removeEventListener('mouseleave', this.boundMouseLeave);
      element.removeEventListener('contextmenu', this.boundContextMenu);
    }
  }

  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      this.cancelPress();
      return;
    }

    const touch = event.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.startPress(event);
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.pressTimer || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - this.startX);
    const deltaY = Math.abs(touch.clientY - this.startY);

    // Cancel if finger moved too much
    if (deltaX > this.MOVE_THRESHOLD || deltaY > this.MOVE_THRESHOLD) {
      this.cancelPress();
    }
  }

  private onTouchEnd(): void {
    this.cancelPress();
  }

  private onMouseDown(event: MouseEvent): void {
    // Only handle left mouse button
    if (event.button !== 0) return;

    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startPress(event);
  }

  private onMouseUp(): void {
    this.cancelPress();
  }

  private onMouseLeave(): void {
    this.cancelPress();
  }

  private onContextMenu(event: Event): void {
    // Prevent context menu if long press was triggered
    if (this.isLongPressTriggered) {
      event.preventDefault();
      this.isLongPressTriggered = false;
    }
  }

  private startPress(event: TouchEvent | MouseEvent): void {
    this.isLongPressTriggered = false;
    this.cancelPress();

    this.pressTimer = window.setTimeout(() => {
      this.isLongPressTriggered = true;
      this.ngZone.run(() => {
        this.longPress.emit(event);
      });
    }, this.longPressDuration());
  }

  private cancelPress(): void {
    if (this.pressTimer) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = null;
      if (!this.isLongPressTriggered) {
        this.ngZone.run(() => {
          this.longPressCancel.emit();
        });
      }
    }
  }
}
