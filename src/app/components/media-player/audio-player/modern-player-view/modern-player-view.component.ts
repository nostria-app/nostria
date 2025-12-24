import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
  output,
  signal,
  effect,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { trigger, transition, style, animate, state } from '@angular/animations';

@Component({
  selector: 'app-modern-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSliderModule,
    SwipeGestureDirective,
  ],
  templateUrl: './modern-player-view.component.html',
  styleUrl: './modern-player-view.component.scss',
  animations: [
    trigger('fadeContent', [
      state('visible', style({ opacity: 1, transform: 'scale(1)' })),
      state('hidden', style({ opacity: 0, transform: 'scale(0.95)' })),
      transition('visible => hidden', animate('200ms ease-out')),
      transition('hidden => visible', animate('400ms ease-out')),
    ]),
    trigger('fadeBackground', [
      state('visible', style({ opacity: 0.8 })),
      state('hidden', style({ opacity: 0 })),
      transition('visible => hidden', animate('300ms ease-out')),
      transition('hidden => visible', animate('600ms ease-in')),
    ]),
  ],
})
export class ModernPlayerViewComponent {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();

  // Track change animation state
  contentState = signal<'visible' | 'hidden'>('visible');
  backgroundState = signal<'visible' | 'hidden'>('visible');
  private lastTrackId = signal<string | null>(null);

  // Displayed track info - only updates after fade-out completes
  displayedArtwork = signal<string | undefined>(undefined);
  displayedTitle = signal<string>('Unknown Track');
  displayedArtist = signal<string>('Unknown Artist');

  constructor() {
    // Watch for track changes and trigger animations
    effect(() => {
      const current = this.media.current();
      const currentId = current?.source || current?.title || null;
      const lastId = this.lastTrackId();

      if (lastId !== null && currentId !== lastId) {
        // Track changed - trigger fade animation
        this.contentState.set('hidden');
        this.backgroundState.set('hidden');

        // After fade out, update displayed info and fade back in
        setTimeout(() => {
          this.lastTrackId.set(currentId);
          // Update displayed content after fade-out
          this.displayedArtwork.set(current?.artwork);
          this.displayedTitle.set(current?.title || 'Unknown Track');
          this.displayedArtist.set(current?.artist || 'Unknown Artist');

          this.backgroundState.set('visible');
          // Stagger the content fade-in slightly
          setTimeout(() => {
            this.contentState.set('visible');
          }, 100);
        }, 250);
      } else if (lastId === null && currentId !== null) {
        // First track loaded - set immediately without animation
        this.lastTrackId.set(currentId);
        this.displayedArtwork.set(current?.artwork);
        this.displayedTitle.set(current?.title || 'Unknown Track');
        this.displayedArtist.set(current?.artist || 'Unknown Artist');
      }
    });
  }

  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  progress = computed(() => {
    const dur = this.duration();
    if (!dur) return 0;
    return this.currentTime() / dur;
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

  onTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (this.media.audio && Math.abs(this.media.audio.currentTime - value) > 0.5) {
      this.media.audio.currentTime = value;
    }
  }

  onSwipe(event: SwipeEvent): void {
    switch (event.direction) {
      case 'left':
        if (this.media.canNext()) this.media.next();
        break;
      case 'right':
        if (this.media.canPrevious()) this.media.previous();
        break;
      case 'down':
        this.openQueue.emit();
        break;
    }
  }

  onSwipeProgress(event: SwipeProgressEvent): void {
    if (event.direction === 'vertical' && event.deltaY > 0) {
      this.queueDragProgress.emit(event.deltaY);
    }
  }

  onSwipeEnd(): void {
    this.queueDragEnd.emit();
  }

  onVolumeChange(value: number): void {
    if (this.media.audio) {
      this.media.audio.volume = value / 100;
    }
  }

  get volume(): number {
    return this.media.audio ? Math.round(this.media.audio.volume * 100) : 100;
  }

  getRepeatTooltip(): string {
    switch (this.media.repeat()) {
      case 'off': return 'Repeat: Off';
      case 'all': return 'Repeat: All';
      case 'one': return 'Repeat: One';
    }
  }
}
