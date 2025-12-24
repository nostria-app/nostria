import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { CircularProgressComponent } from '../circular-progress/circular-progress.component';

@Component({
  selector: 'app-cards-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SwipeGestureDirective,
    CircularProgressComponent,
  ],
  templateUrl: './cards-player-view.component.html',
  styleUrl: './cards-player-view.component.scss',
})
export class CardsPlayerViewComponent {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();

  // Swipe animation state
  swipeOffset = signal(0);
  isAnimating = signal(false);

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

  seekByCircle(event: MouseEvent): void {
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
