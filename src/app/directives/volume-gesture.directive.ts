import {
  Directive,
  ElementRef,
  inject,
  output,
  OnDestroy,
  AfterViewInit,
  ApplicationRef,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
} from '@angular/core';
import { VolumeOverlayComponent } from './volume-overlay.component';

@Directive({
  selector: '[appVolumeGesture]',
})
export class VolumeGestureDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);

  volumeChange = output<number>();

  private isHolding = false;
  private startX = 0;
  private startVolume = 0;
  private holdTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly HOLD_DELAY = 300; // ms before gesture activates
  private readonly SENSITIVITY = 70; // pixels for full volume range (lower = more sensitive)

  private overlayRef: ComponentRef<VolumeOverlayComponent> | null = null;

  // Bound handlers for cleanup
  private boundTouchStart = this.onTouchStart.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);
  private boundTouchEnd = this.onTouchEnd.bind(this);
  private boundMouseDown = this.onMouseDown.bind(this);
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundMouseUp = this.onMouseUp.bind(this);
  private boundContextMenu = this.onContextMenu.bind(this);

  ngAfterViewInit(): void {
    const el = this.elementRef.nativeElement;

    // Prevent text selection and context menu on the element
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.touchAction = 'manipulation';
    el.style.webkitTouchCallout = 'none';

    // Touch events for mobile
    el.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    document.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    document.addEventListener('touchend', this.boundTouchEnd);
    document.addEventListener('touchcancel', this.boundTouchEnd);

    // Prevent context menu (long-press menu on mobile)
    el.addEventListener('contextmenu', this.boundContextMenu);

    // Mouse events for testing on desktop (with mouse hold)
    el.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
  }

  ngOnDestroy(): void {
    const el = this.elementRef.nativeElement;

    el.removeEventListener('touchstart', this.boundTouchStart);
    document.removeEventListener('touchmove', this.boundTouchMove);
    document.removeEventListener('touchend', this.boundTouchEnd);
    document.removeEventListener('touchcancel', this.boundTouchEnd);
    el.removeEventListener('contextmenu', this.boundContextMenu);

    el.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    this.clearHoldTimeout();
    this.hideVolumeOverlay();
  }

  private onTouchStart(event: TouchEvent): void {
    // Prevent default to stop text selection and context menu on mobile
    event.preventDefault();
    const touch = event.touches[0];
    this.startGesture(touch.clientX);
  }

  private onContextMenu(event: Event): void {
    // Prevent context menu from appearing during hold gesture
    event.preventDefault();
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.isHolding) return;

    event.preventDefault();
    const touch = event.touches[0];
    this.updateVolume(touch.clientX);
  }

  private onTouchEnd(): void {
    this.endGesture();
  }

  private onMouseDown(event: MouseEvent): void {
    this.startGesture(event.clientX);
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isHolding) return;

    event.preventDefault();
    this.updateVolume(event.clientX);
  }

  private onMouseUp(): void {
    this.endGesture();
  }

  private startGesture(clientX: number): void {
    this.startX = clientX;

    // Get current volume from the nearest audio/video element or default to 100
    const mediaElement = document.querySelector('audio, video') as HTMLMediaElement;
    this.startVolume = mediaElement ? Math.round(mediaElement.volume * 100) : 100;

    this.holdTimeout = setTimeout(() => {
      this.isHolding = true;
      this.showVolumeOverlay();
      this.updateVolumeIndicator(this.startVolume);

      // Vibrate on mobile to indicate gesture started
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, this.HOLD_DELAY);
  }

  private updateVolume(clientX: number): void {
    const deltaX = clientX - this.startX;
    const volumeDelta = (deltaX / this.SENSITIVITY) * 100;
    const newVolume = Math.max(0, Math.min(100, this.startVolume + volumeDelta));

    this.volumeChange.emit(newVolume);
    this.updateVolumeIndicator(newVolume);
  }

  private endGesture(): void {
    this.clearHoldTimeout();

    if (this.isHolding) {
      this.isHolding = false;
      this.hideVolumeOverlay();
    }
  }

  private clearHoldTimeout(): void {
    if (this.holdTimeout) {
      clearTimeout(this.holdTimeout);
      this.holdTimeout = null;
    }
  }

  private showVolumeOverlay(): void {
    // Create the overlay component dynamically
    this.overlayRef = createComponent(VolumeOverlayComponent, {
      environmentInjector: this.environmentInjector,
    });

    // Attach to ApplicationRef for change detection
    this.appRef.attachView(this.overlayRef.hostView);

    // Append to DOM
    document.body.appendChild(this.overlayRef.location.nativeElement);
  }

  private updateVolumeIndicator(volume: number): void {
    if (!this.overlayRef) return;

    // Update the component's input using setInput
    this.overlayRef.setInput('volume', Math.round(volume));
  }

  private hideVolumeOverlay(): void {
    if (this.overlayRef) {
      this.appRef.detachView(this.overlayRef.hostView);
      this.overlayRef.destroy();
      this.overlayRef = null;
    }
  }
}
