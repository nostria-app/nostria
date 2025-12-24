import {
  Directive,
  ElementRef,
  output,
  inject,
  OnInit,
  OnDestroy,
  input,
} from '@angular/core';

export interface SwipeEvent {
  direction: 'left' | 'right' | 'up' | 'down';
  deltaX: number;
  deltaY: number;
  velocity: number;
}

export interface SwipeProgressEvent {
  deltaX: number;
  deltaY: number;
  progress: number; // 0-1 normalized progress
  direction: 'horizontal' | 'vertical';
}

@Directive({
  selector: '[appSwipeGesture]',
})
export class SwipeGestureDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef);

  /** Minimum distance in pixels to register as a swipe */
  threshold = input<number>(50);

  /** Enable horizontal swipe */
  horizontalSwipe = input<boolean>(true);

  /** Enable vertical swipe */
  verticalSwipe = input<boolean>(true);

  /** Enable swipe progress events for animations */
  trackProgress = input<boolean>(false);

  swipe = output<SwipeEvent>();
  swipeProgress = output<SwipeProgressEvent>();
  swipeStart = output<void>();
  swipeEnd = output<void>();

  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private isSwiping = false;
  private lockedDirection: 'horizontal' | 'vertical' | null = null;

  private boundTouchStart = this.onTouchStart.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);
  private boundTouchEnd = this.onTouchEnd.bind(this);
  private boundMouseDown = this.onMouseDown.bind(this);
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundMouseUp = this.onMouseUp.bind(this);

  ngOnInit(): void {
    const element = this.el.nativeElement;

    // Touch events
    element.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    element.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    element.addEventListener('touchend', this.boundTouchEnd, { passive: true });

    // Mouse events for desktop
    element.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
  }

  ngOnDestroy(): void {
    const element = this.el.nativeElement;

    element.removeEventListener('touchstart', this.boundTouchStart);
    element.removeEventListener('touchmove', this.boundTouchMove);
    element.removeEventListener('touchend', this.boundTouchEnd);

    element.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
  }

  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;

    // Ignore if started on an interactive element
    if (this.isInteractiveElement(event.target as HTMLElement)) return;

    const touch = event.touches[0];
    this.startSwipe(touch.clientX, touch.clientY);
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.isSwiping || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const shouldPrevent = this.handleMove(touch.clientX, touch.clientY);

    if (shouldPrevent) {
      event.preventDefault();
    }
  }

  private onTouchEnd(event: TouchEvent): void {
    if (!this.isSwiping) return;

    const touch = event.changedTouches[0];
    this.endSwipe(touch.clientX, touch.clientY);
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left click

    // Ignore if started on an interactive element
    if (this.isInteractiveElement(event.target as HTMLElement)) return;

    this.startSwipe(event.clientX, event.clientY);
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isSwiping) return;

    this.handleMove(event.clientX, event.clientY);
  }

  private onMouseUp(event: MouseEvent): void {
    if (!this.isSwiping) return;

    this.endSwipe(event.clientX, event.clientY);
  }

  private startSwipe(x: number, y: number): void {
    this.startX = x;
    this.startY = y;
    this.startTime = Date.now();
    this.isSwiping = true;
    this.lockedDirection = null;
    this.swipeStart.emit();
  }

  private handleMove(currentX: number, currentY: number): boolean {
    const deltaX = currentX - this.startX;
    const deltaY = currentY - this.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Lock direction after 10px of movement
    if (!this.lockedDirection && (absDeltaX > 10 || absDeltaY > 10)) {
      this.lockedDirection = absDeltaX > absDeltaY ? 'horizontal' : 'vertical';
    }

    if (this.trackProgress() && this.lockedDirection) {
      const isHorizontal = this.lockedDirection === 'horizontal';
      const delta = isHorizontal ? deltaX : deltaY;
      const progress = Math.min(Math.abs(delta) / this.threshold(), 1);

      this.swipeProgress.emit({
        deltaX,
        deltaY,
        progress,
        direction: this.lockedDirection,
      });
    }

    // Prevent scroll if we're swiping in the locked direction
    if (this.lockedDirection === 'horizontal' && this.horizontalSwipe()) {
      return true;
    }
    if (this.lockedDirection === 'vertical' && this.verticalSwipe()) {
      return true;
    }

    return false;
  }

  private endSwipe(endX: number, endY: number): void {
    const deltaX = endX - this.startX;
    const deltaY = endY - this.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);
    const duration = Date.now() - this.startTime;
    const velocity = Math.max(absDeltaX, absDeltaY) / duration;

    this.isSwiping = false;
    this.swipeEnd.emit();

    // Determine swipe direction
    if (absDeltaX >= this.threshold() && this.horizontalSwipe() && absDeltaX > absDeltaY) {
      this.swipe.emit({
        direction: deltaX > 0 ? 'right' : 'left',
        deltaX,
        deltaY,
        velocity,
      });
    } else if (absDeltaY >= this.threshold() && this.verticalSwipe() && absDeltaY > absDeltaX) {
      this.swipe.emit({
        direction: deltaY > 0 ? 'down' : 'up',
        deltaX,
        deltaY,
        velocity,
      });
    }

    this.lockedDirection = null;
  }

  /** Check if an element or its parent is an interactive element that should handle its own events */
  private isInteractiveElement(element: HTMLElement | null): boolean {
    while (element) {
      const tagName = element.tagName.toLowerCase();
      if (
        tagName === 'button' ||
        tagName === 'a' ||
        tagName === 'input' ||
        tagName === 'select' ||
        tagName === 'textarea' ||
        element.getAttribute('role') === 'button' ||
        element.hasAttribute('mat-button') ||
        element.hasAttribute('mat-icon-button') ||
        element.hasAttribute('mat-fab') ||
        element.classList.contains('pull-indicator') ||
        element.classList.contains('circular-container')
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }
}
