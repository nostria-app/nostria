import { Directive, ElementRef, inject, output, OnDestroy, AfterViewInit } from '@angular/core';

@Directive({
  selector: '[appVolumeGesture]',
})
export class VolumeGestureDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef);

  volumeChange = output<number>();

  private isHolding = false;
  private startX = 0;
  private startVolume = 0;
  private holdTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly HOLD_DELAY = 300; // ms before gesture activates
  private readonly SENSITIVITY = 200; // pixels for full volume range

  private overlay: HTMLElement | null = null;
  private volumeIndicator: HTMLElement | null = null;

  // Bound handlers for cleanup
  private boundTouchStart = this.onTouchStart.bind(this);
  private boundTouchMove = this.onTouchMove.bind(this);
  private boundTouchEnd = this.onTouchEnd.bind(this);
  private boundMouseDown = this.onMouseDown.bind(this);
  private boundMouseMove = this.onMouseMove.bind(this);
  private boundMouseUp = this.onMouseUp.bind(this);

  ngAfterViewInit(): void {
    const el = this.elementRef.nativeElement;

    // Touch events for mobile
    el.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    document.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    document.addEventListener('touchend', this.boundTouchEnd);
    document.addEventListener('touchcancel', this.boundTouchEnd);

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

    el.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    this.clearHoldTimeout();
    this.hideVolumeOverlay();
  }

  private onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.startGesture(touch.clientX);
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
    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'volume-gesture-overlay';
    this.overlay.innerHTML = `
      <div class="volume-gesture-container">
        <div class="volume-gesture-icon">
          <span class="material-icons">volume_up</span>
        </div>
        <div class="volume-gesture-bar">
          <div class="volume-gesture-fill"></div>
        </div>
        <div class="volume-gesture-value">100%</div>
      </div>
    `;

    // Add styles if not already present
    if (!document.getElementById('volume-gesture-styles')) {
      const style = document.createElement('style');
      style.id = 'volume-gesture-styles';
      style.textContent = `
        .volume-gesture-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .volume-gesture-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 24px 48px;
          background: rgba(30, 30, 30, 0.95);
          border-radius: 16px;
          min-width: 200px;
        }
        .volume-gesture-icon {
          color: white;
        }
        .volume-gesture-icon .material-icons {
          font-size: 48px;
        }
        .volume-gesture-bar {
          width: 150px;
          height: 8px;
          background: rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          overflow: hidden;
        }
        .volume-gesture-fill {
          height: 100%;
          background: var(--mat-sys-primary, #c5c0ff);
          border-radius: 4px;
          transition: width 0.05s ease-out;
        }
        .volume-gesture-value {
          color: white;
          font-size: 24px;
          font-weight: 500;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.overlay);
    this.volumeIndicator = this.overlay.querySelector('.volume-gesture-fill');
  }

  private updateVolumeIndicator(volume: number): void {
    if (!this.overlay) return;

    const fill = this.overlay.querySelector('.volume-gesture-fill') as HTMLElement;
    const value = this.overlay.querySelector('.volume-gesture-value') as HTMLElement;
    const icon = this.overlay.querySelector('.material-icons') as HTMLElement;

    if (fill) {
      fill.style.width = `${volume}%`;
    }
    if (value) {
      value.textContent = `${Math.round(volume)}%`;
    }
    if (icon) {
      if (volume === 0) {
        icon.textContent = 'volume_off';
      } else if (volume < 50) {
        icon.textContent = 'volume_down';
      } else {
        icon.textContent = 'volume_up';
      }
    }
  }

  private hideVolumeOverlay(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.volumeIndicator = null;
    }
  }
}
