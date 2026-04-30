import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
}
