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

    // Check if video has a valid source
    if (!video.src && !video.currentSrc) {
      console.log('Cast: No video source available');
      return;
    }

    // Use the Remote Playback API if available (Chrome, Edge, Safari)
    if ('remote' in video && video.remote) {
      const remote = video.remote as RemotePlayback;
      
      // Check current state
      console.log('Cast: Remote playback state:', remote.state);
      
      try {
        await remote.prompt();
        console.log('Cast: Prompt successful, new state:', remote.state);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'Unknown';
        console.log('Cast: Prompt failed -', errorName, ':', errorMessage);
        
        // InvalidStateError means no devices available or video not ready
        // NotSupportedError means the video source doesn't support remote playback
        // NotAllowedError means user didn't grant permission
        if (errorName === 'NotFoundError') {
          console.log('Cast: No cast devices found on the network');
        }
      }
    } else {
      console.log('Cast: Remote Playback API not supported in this browser');
      // Try Presentation API as fallback (for some browsers)
      this.tryPresentationAPI(video);
    }
  }

  private tryPresentationAPI(video: HTMLVideoElement): void {
    // Presentation API is another way to cast content
    if ('presentation' in navigator && navigator.presentation) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const presentation = navigator.presentation as any;
      if (presentation.defaultRequest) {
        presentation.defaultRequest.start().catch((err: Error) => {
          console.log('Presentation API failed:', err.message);
        });
      }
    }
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
}
