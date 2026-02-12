import {
  Component,
  inject,
  computed,
  input,
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
    '[class.footer-mode]': 'footer()',
    '[class.compact-mode]': '!footer()',
  },
})
export class YouTubePlayerComponent {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);

  footer = input<boolean>(false);

  toggleFullscreen(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
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