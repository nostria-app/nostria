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
import { CastService } from '../../../services/cast.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { VideoControlsComponent } from '../../video-controls/video-controls.component';
import { nip19 } from 'nostr-tools';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';

@Component({
  selector: 'app-video-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RouterModule,
    UserProfileComponent,
    VideoControlsComponent,
    MatMenuModule,
    MatSliderModule
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
  private readonly castService = inject(CastService);

  footer = input<boolean>(false);

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  @ViewChild(VideoControlsComponent)
  videoControlsRef?: VideoControlsComponent;

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

  async requestFullscreen(): Promise<void> {
    const videoArea = document.querySelector('.video-area');
    if (!videoArea) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await videoArea.requestFullscreen();
      }
    } catch {
      // Fullscreen not supported, fall back to expand
      this.toggleFullscreen();
    }
  }

  async castToDevice(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      console.log('Cast: No video element available');
      return;
    }

    const currentMedia = this.media.current();
    await this.castService.castVideoElement(
      video,
      currentMedia?.title,
      currentMedia?.artwork
    );
  }

  // Methods to trigger controls visibility from parent container hover
  onVideoContainerMouseEnter(): void {
    this.videoControlsRef?.showControls();
  }

  onVideoContainerMouseLeave(): void {
    // Let the controls auto-hide logic handle this
  }

  onVideoContainerMouseMove(): void {
    this.videoControlsRef?.showControls();
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

  get volume(): number {
    return this.videoElement?.nativeElement ? Math.round(this.videoElement.nativeElement.volume * 100) : 100;
  }
}
