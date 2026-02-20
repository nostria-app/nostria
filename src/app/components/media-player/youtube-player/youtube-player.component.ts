import {
  Component,
  inject,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-youtube-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RouterModule,
    UserProfileComponent,
  ],
  templateUrl: './youtube-player.component.html',
  styleUrl: './youtube-player.component.scss',
  host: {
    '[class.footer-mode]': '!layout.fullscreenMediaPlayer() && !layout.expandedMediaPlayer()',
    '[class.footer-expanded-mode]': '!layout.fullscreenMediaPlayer() && layout.expandedMediaPlayer()',
    '[class.compact-mode]': 'layout.fullscreenMediaPlayer()',
  },
})
export class YouTubePlayerComponent {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);

  footer = input<boolean>(false);

  /** Whether we're in fullscreen mode. For YouTube, the single instance always
   *  lives in the footer-drag-zone with [footer]="true", so we read the layout
   *  signal directly instead of relying on the footer input. */
  readonly isFullscreen = computed(() => this.layout.fullscreenMediaPlayer());

  toggleFullscreen(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
  }

  toggleExpand(): void {
    this.layout.expandedMediaPlayer.update(v => !v);
  }

  isNpubArtist(artist: string | undefined): boolean {
    return !!artist && artist.startsWith('npub1');
  }

  getNpubPubkey(artist: string): string {
    try {
      const decoded = nip19.decode(artist);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch {
      // Ignore decoding errors
    }
    return '';
  }
}