import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  afterNextRender,
  OnDestroy,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { VideoControlsComponent } from '../../video-controls/video-controls.component';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-video-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RouterModule,
    UserProfileComponent,
    VideoControlsComponent,
  ],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.compact-mode]': '!footer()',
  },
})
export class VideoPlayerComponent implements OnDestroy {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);
  private readonly utilities = inject(UtilitiesService);

  footer = input<boolean>(false);

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  constructor() {
    if (!this.utilities.isBrowser()) {
      return;
    }

    afterNextRender(() => {
      this.registerVideoElement();
    });
  }

  ngOnDestroy(): void {
    this.media.setVideoElement(undefined);
  }

  registerVideoElement(): void {
    if (this.videoElement?.nativeElement) {
      this.media.setVideoElement(this.videoElement.nativeElement);
    }
  }

  onVideoError(event: ErrorEvent): void {
    const video = event.target as HTMLVideoElement;
    console.error('Video error:', video.error);
  }

  toggleFullscreen(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
  }

  async pictureInPicture(): Promise<void> {
    await this.media.pictureInPicture();
  }

  // Video controls integration
  onPlayPause(): void {
    if (this.media.paused) {
      this.media.resume();
    } else {
      this.media.pause();
    }
  }

  onSeek(time: number): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.currentTime = time;
    }
  }

  onVolumeChange(volume: number): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.volume = volume;
      if (video.muted && volume > 0) {
        video.muted = false;
      }
    }
  }

  onPlaybackRateChange(rate: number): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.playbackRate = rate;
    }
    this.media.setPlaybackRate(rate);
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
