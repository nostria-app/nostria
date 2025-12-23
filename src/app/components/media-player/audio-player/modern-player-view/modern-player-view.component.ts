import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent } from '../../../../directives/swipe-gesture.directive';

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
})
export class ModernPlayerViewComponent {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();

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

  onVolumeChange(value: number): void {
    if (this.media.audio) {
      this.media.audio.volume = value / 100;
    }
  }

  get volume(): number {
    return this.media.audio ? Math.round(this.media.audio.volume * 100) : 100;
  }
}
