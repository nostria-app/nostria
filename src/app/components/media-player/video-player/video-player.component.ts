import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  afterNextRender,
  OnDestroy,
  input,
  signal,
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
import { VolumeGestureDirective } from '../../../directives/volume-gesture.directive';
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
    VolumeGestureDirective,
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
  private readonly elementRef = inject(ElementRef);

  footer = input<boolean>(false);
  isNativeFullscreen = signal(false);
  cursorHidden = signal(false);

  private cursorHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly CURSOR_HIDE_DELAY = 3000;

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
      this.setupFullscreenListener();
    });
  }

  ngOnDestroy(): void {
    this.media.setVideoElement(undefined);
    this.clearCursorHideTimeout();
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  private fullscreenChangeHandler = () => {
    const isFullscreen = !!document.fullscreenElement;
    console.log('[VideoPlayer] fullscreenChangeHandler, isFullscreen:', isFullscreen);
    this.isNativeFullscreen.set(isFullscreen);

    if (isFullscreen) {
      // Start auto-hide timer when entering fullscreen
      this.videoControlsRef?.showControlsAndStartTimer();
      this.startCursorHideTimer();
    } else {
      // Show cursor when exiting fullscreen
      this.showCursor();
    }
  };

  private setupFullscreenListener(): void {
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
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
      // Normalize volume to 0-1 range (input may be 0-100 from slider/gesture)
      const normalizedVolume = volume > 1 ? volume / 100 : volume;
      video.volume = normalizedVolume;
      if (video.muted && normalizedVolume > 0) {
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
    this.showCursor();
  }

  onVideoContainerMouseLeave(): void {
    // Let the controls auto-hide logic handle this
  }

  onVideoContainerMouseMove(): void {
    console.log('[VideoPlayer] onVideoContainerMouseMove, nativeFs:', this.isNativeFullscreen());
    // In native fullscreen, use showControlsAndStartTimer to ensure auto-hide works
    if (this.isNativeFullscreen()) {
      this.videoControlsRef?.showControlsAndStartTimer();
    } else {
      this.videoControlsRef?.showControls();
    }
    this.showCursor();
    this.startCursorHideTimer();
  }

  private showCursor(): void {
    this.clearCursorHideTimeout();
    this.cursorHidden.set(false);
  }

  private startCursorHideTimer(): void {
    if (!this.isNativeFullscreen()) return;

    this.clearCursorHideTimeout();
    console.log('[VideoPlayer] Starting cursor hide timer');
    this.cursorHideTimeout = setTimeout(() => {
      console.log('[VideoPlayer] Cursor hide timer fired');
      if (this.isNativeFullscreen() && !this.media.paused) {
        this.cursorHidden.set(true);
      }
    }, this.CURSOR_HIDE_DELAY);
  }

  private clearCursorHideTimeout(): void {
    if (this.cursorHideTimeout) {
      clearTimeout(this.cursorHideTimeout);
      this.cursorHideTimeout = null;
    }
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
