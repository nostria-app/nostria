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
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { VolumeGestureDirective } from '../../../directives/volume-gesture.directive';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-audio-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSliderModule,
    MatMenuModule,
    FormsModule,
    RouterModule,
    UserProfileComponent,
    VolumeGestureDirective,
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
  private router = inject(Router);

  footer = input<boolean>(false);

  // Computed values for display
  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  isPodcast = computed(() => this.media.current()?.type === 'Podcast');

  formatLabel(value: number): string {
    if (!value || isNaN(value)) {
      return '0:00';
    }

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

    // Only update if value actually changed to avoid jitter
    if (this.media.audio && Math.abs(this.media.audio.currentTime - value) > 0.5) {
      this.media.audio.currentTime = value;
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

  toggleFullscreen(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
  }

  toggleExpanded(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
  }

  close(): void {
    this.media.exit();
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

  // Check if we have a link to the song page
  hasSongLink(): boolean {
    const current = this.media.current();
    return !!(current?.eventPubkey && current?.eventIdentifier);
  }

  // Check if we have a link to the artist page  
  hasArtistLink(): boolean {
    const current = this.media.current();
    return !!current?.eventPubkey;
  }

  // Navigate to song detail page
  goToSong(): void {
    const current = this.media.current();
    if (current?.eventPubkey && current?.eventIdentifier) {
      this.router.navigate(['/music/song', current.eventPubkey, current.eventIdentifier]);
    }
  }

  // Navigate to artist page
  goToArtist(): void {
    const current = this.media.current();
    if (current?.eventPubkey) {
      this.router.navigate(['/music/artist', current.eventPubkey]);
    }
  }
}
