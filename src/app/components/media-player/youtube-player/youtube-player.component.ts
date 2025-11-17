import {
  Component,
  inject,
  computed,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';

@Component({
  selector: 'app-youtube-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RouterModule,
  ],
  templateUrl: './youtube-player.component.html',
  styleUrl: './youtube-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.compact-mode]': '!footer()',
  },
})
export class YouTubePlayerComponent {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);

  footer = input<boolean>(false);

  youtubeUrl = computed(() => {
    const current = this.media.current();
    if (!current || current.type !== 'YouTube') return undefined;
    return this.media.getYouTubeEmbedUrl()(current.source, 'autoplay=1');
  });
}