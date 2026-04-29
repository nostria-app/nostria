import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TtsSequencePlayerService } from '../../services/tts-sequence-player.service';

@Component({
  selector: 'app-tts-sequence-player',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './tts-sequence-player.component.html',
  styleUrl: './tts-sequence-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TtsSequencePlayerComponent {
  readonly player = inject(TtsSequencePlayerService);

  readonly progressPercent = computed(() => {
    const duration = this.player.duration();
    return duration > 0 ? (this.player.currentTime() / duration) * 100 : 0;
  });

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '0:00';
    }

    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
  }
}
