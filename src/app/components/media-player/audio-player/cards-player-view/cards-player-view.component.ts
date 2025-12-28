import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
  output,
  ElementRef,
  viewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { CircularProgressComponent } from '../circular-progress/circular-progress.component';
import { LyricsViewComponent } from '../lyrics-view/lyrics-view.component';

@Component({
  selector: 'app-cards-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SwipeGestureDirective,
    CircularProgressComponent,
    LyricsViewComponent,
  ],
  templateUrl: './cards-player-view.component.html',
  styleUrl: './cards-player-view.component.scss',
})
export class CardsPlayerViewComponent implements AfterViewInit, OnDestroy {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();

  // Swipe animation state
  swipeOffset = signal(0);
  isAnimating = signal(false);

  // Lyrics view toggle
  showLyrics = signal(false);
  canShowLyrics = computed(() => {
    const current = this.media.current();
    // Show lyrics button for Music type (can search API) or if lyrics exist
    return current?.type === 'Music' || !!current?.lyrics;
  });

  toggleLyrics(): void {
    this.showLyrics.update(v => !v);
  }

  // Circular seek gesture state
  private circularContainer = viewChild<ElementRef<HTMLDivElement>>('circularContainer');
  private isCircularSeeking = signal(false);
  private lastAngle = 0;
  private seekStartTime = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private circularGestureDecided = false;
  private boundTouchStart = this.onCircularTouchStart.bind(this);
  private boundTouchMove = this.onCircularTouchMove.bind(this);
  private boundTouchEnd = this.onCircularTouchEnd.bind(this);

  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  progress = computed(() => {
    const dur = this.duration();
    if (!dur) return 0;
    return this.currentTime() / dur;
  });

  // Get previous track
  previousTrack = computed(() => {
    const queue = this.media.media();
    const index = this.media.index;
    if (index > 0) {
      return queue[index - 1];
    }
    return null;
  });

  // Get next track
  nextTrack = computed(() => {
    const queue = this.media.media();
    const index = this.media.index;
    if (index < queue.length - 1) {
      return queue[index + 1];
    }
    return null;
  });

  formatTime(value: number): string {
    if (!value || isNaN(value)) return '0:00';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  onSwipeProgress(event: SwipeProgressEvent): void {
    // Disable gestures when lyrics are showing
    if (this.showLyrics()) return;

    if (event.direction === 'horizontal') {
      // Limit the offset to prevent over-swiping
      const maxOffset = 150;
      this.swipeOffset.set(Math.max(-maxOffset, Math.min(maxOffset, event.deltaX)));
    } else if (event.direction === 'vertical' && event.deltaY > 0) {
      // Dragging down - emit progress for playlist drawer
      this.queueDragProgress.emit(event.deltaY);
    }
  }

  onSwipeStart(): void {
    this.isAnimating.set(false);
  }

  onSwipeEnd(): void {
    // Animate back to center
    this.isAnimating.set(true);
    this.swipeOffset.set(0);
    // Notify parent that drag ended
    this.queueDragEnd.emit();
  }

  onSwipe(event: SwipeEvent): void {
    // Disable gestures when lyrics are showing to prevent interference while scrolling
    if (this.showLyrics()) return;

    switch (event.direction) {
      case 'left':
        if (this.media.canNext()) {
          this.animateSwipe('left');
        } else {
          this.bounceBack();
        }
        break;
      case 'right':
        if (this.media.canPrevious()) {
          this.animateSwipe('right');
        } else {
          this.bounceBack();
        }
        break;
      case 'down':
        this.openQueue.emit();
        break;
    }
  }

  private animateSwipe(direction: 'left' | 'right'): void {
    this.isAnimating.set(true);
    this.swipeOffset.set(direction === 'left' ? -300 : 300);

    setTimeout(() => {
      if (direction === 'left') {
        this.media.next();
      } else {
        this.media.previous();
      }
      this.swipeOffset.set(0);
      setTimeout(() => {
        this.isAnimating.set(false);
      }, 50);
    }, 200);
  }

  private bounceBack(): void {
    this.isAnimating.set(true);
    this.swipeOffset.set(0);
    setTimeout(() => {
      this.isAnimating.set(false);
    }, 300);
  }

  ngAfterViewInit(): void {
    this.setupCircularGesture();
  }

  ngOnDestroy(): void {
    this.cleanupCircularGesture();
  }

  private setupCircularGesture(): void {
    const container = this.circularContainer()?.nativeElement;
    if (!container) return;

    container.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    container.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    container.addEventListener('touchend', this.boundTouchEnd, { passive: true });
  }

  private cleanupCircularGesture(): void {
    const container = this.circularContainer()?.nativeElement;
    if (!container) return;

    container.removeEventListener('touchstart', this.boundTouchStart);
    container.removeEventListener('touchmove', this.boundTouchMove);
    container.removeEventListener('touchend', this.boundTouchEnd);
  }

  private onCircularTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;

    const container = this.circularContainer()?.nativeElement;
    if (!container) return;

    const touch = event.touches[0];
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Check if touch is within the circular area (artwork region)
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const radius = rect.width / 2;

    // Only track if touch is within 80% of the radius (inside artwork area)
    if (distance < radius * 0.8) {
      // Don't block yet - just record the start position
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.lastAngle = Math.atan2(dy, dx);
      this.seekStartTime = this.media.audio?.currentTime ?? 0;
      this.circularGestureDecided = false;
    }
  }

  private onCircularTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 1) return;

    // If we already decided this is a circular gesture, handle seeking
    if (this.isCircularSeeking()) {
      event.preventDefault();
      event.stopPropagation();
      this.handleCircularSeek(event.touches[0]);
      return;
    }

    // If we haven't recorded a start position, ignore
    if (this.touchStartX === 0 && this.touchStartY === 0) return;

    // If gesture already decided (and it's not circular), let it pass through
    if (this.circularGestureDecided) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Need at least 10px of movement to decide
    if (absDeltaX < 10 && absDeltaY < 10) return;

    this.circularGestureDecided = true;

    // If primarily vertical movement (especially downward), let swipe gesture handle it
    if (absDeltaY > absDeltaX && deltaY > 0) {
      // Vertical swipe down - don't block, let parent handle playlist drawer
      this.touchStartX = 0;
      this.touchStartY = 0;
      return;
    }

    // Horizontal or upward movement - treat as circular seeking
    this.isCircularSeeking.set(true);
    event.preventDefault();
    event.stopPropagation();
    this.handleCircularSeek(touch);
  }

  private handleCircularSeek(touch: Touch): void {
    const container = this.circularContainer()?.nativeElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const currentAngle = Math.atan2(dy, dx);

    // Calculate angle delta
    let angleDelta = currentAngle - this.lastAngle;

    // Handle wrap-around at -PI/PI boundary
    if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
    if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

    // Convert angle delta to time delta
    // Full circle = full duration, so angle/(2*PI) * duration
    const duration = this.duration();
    if (duration && this.media.audio) {
      const timeDelta = (angleDelta / (2 * Math.PI)) * duration;
      const newTime = Math.max(0, Math.min(duration, this.media.audio.currentTime + timeDelta));
      this.media.audio.currentTime = newTime;
    }

    this.lastAngle = currentAngle;
  }

  private onCircularTouchEnd(): void {
    this.isCircularSeeking.set(false);
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.circularGestureDecided = false;
  }

  seekByCircle(event: MouseEvent): void {
    // Only handle click if not from a drag gesture
    if (this.isCircularSeeking()) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Calculate angle from center
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    // Convert to progress (0-1), starting from top
    let progress = (angle + Math.PI / 2) / (2 * Math.PI);
    if (progress < 0) progress += 1;

    // Seek to position
    const duration = this.duration();
    if (duration && this.media.audio) {
      this.media.audio.currentTime = progress * duration;
    }
  }

  getRepeatTooltip(): string {
    switch (this.media.repeat()) {
      case 'off': return 'Repeat: Off';
      case 'all': return 'Repeat: All';
      case 'one': return 'Repeat: One';
    }
  }
}
