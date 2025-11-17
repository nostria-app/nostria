import {
  Component,
  inject,
  computed,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';

@Component({
  selector: 'app-audio-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSliderModule,
    FormsModule,
    RouterModule,
  ],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.compact-mode]': '!footer()',
  },
})
export class AudioPlayerComponent {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);

  footer = input<boolean>(false);

  // Computed values for display
  currentTime = computed(() => this.media.time);
  duration = computed(() => this.media.duration);
  isPodcast = computed(() => this.media.current()?.type === 'Podcast');

  formatLabel(value: number): string {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  onTimeChange(value: number): void {
    this.media.time = value;
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
