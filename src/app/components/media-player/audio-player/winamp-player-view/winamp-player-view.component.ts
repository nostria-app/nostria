import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
  output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { LyricsViewComponent } from '../lyrics-view/lyrics-view.component';

@Component({
  selector: 'app-winamp-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SwipeGestureDirective,
    LyricsViewComponent,
  ],
  templateUrl: './winamp-player-view.component.html',
  styleUrl: './winamp-player-view.component.scss',
})
export class WinampPlayerViewComponent implements OnInit, OnDestroy {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();

  // Visualization data
  visualizerBars = signal<number[]>(Array(28).fill(0));
  private animationFrame: number | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;

  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  progress = computed(() => {
    const dur = this.duration();
    if (!dur) return 0;
    return this.currentTime() / dur;
  });

  // Scrolling title
  scrollingTitle = signal('');
  private scrollPosition = 0;
  private scrollInterval: number | null = null;

  // Lyrics view toggle
  showLyrics = signal(false);
  hasLyrics = computed(() => !!this.media.current()?.lyrics);

  toggleLyrics(): void {
    this.showLyrics.update(v => !v);
  }

  ngOnInit(): void {
    this.startTitleScroll();
    this.initVisualizer();
  }

  ngOnDestroy(): void {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }

  private initVisualizer(): void {
    // Simple fake visualizer animation
    // Real implementation would use Web Audio API with the actual audio element
    const animate = () => {
      if (!this.media.paused) {
        const bars = Array(28).fill(0).map(() =>
          Math.random() * 0.8 + (Math.random() > 0.7 ? 0.2 : 0)
        );
        this.visualizerBars.set(bars);
      } else {
        // When paused, slowly decay
        this.visualizerBars.update(bars =>
          bars.map(b => Math.max(0, b - 0.05))
        );
      }
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  private startTitleScroll(): void {
    this.scrollInterval = window.setInterval(() => {
      const title = this.media.current()?.title || 'No track playing';
      const artist = this.media.current()?.artist || '';
      const fullText = artist ? `*** ${title} - ${artist} ***   ` : `*** ${title} ***   `;

      this.scrollPosition = (this.scrollPosition + 1) % fullText.length;
      const scrolled = fullText.substring(this.scrollPosition) + fullText.substring(0, this.scrollPosition);
      this.scrollingTitle.set(scrolled.substring(0, 30));
    }, 150);
  }

  formatTime(value: number): string {
    if (!value || isNaN(value)) return '0:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatTimeDisplay(value: number): string {
    if (!value || isNaN(value)) return '00:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  onTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (this.media.audio && Math.abs(this.media.audio.currentTime - value) > 0.5) {
      this.media.audio.currentTime = value;
    }
  }

  onVolumeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (this.media.audio) {
      this.media.audio.volume = value / 100;
    }
  }

  get volume(): number {
    return this.media.audio ? Math.round(this.media.audio.volume * 100) : 100;
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

  // Equalizer presets
  eqBands = signal<number[]>([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);

  updateEqBand(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    this.eqBands.update(bands => {
      const newBands = [...bands];
      newBands[index] = value;
      return newBands;
    });
  }

  getRepeatTooltip(): string {
    switch (this.media.repeat()) {
      case 'off': return 'Repeat: Off';
      case 'all': return 'Repeat: All';
      case 'one': return 'Repeat: One';
    }
  }
}
