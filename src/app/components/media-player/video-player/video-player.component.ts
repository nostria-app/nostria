import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  afterNextRender,
  OnDestroy,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { CastService } from '../../../services/cast.service';
import {
  toggleFullscreen as fullscreenToggle,
  addFullscreenChangeListener,
} from '../../../utils/fullscreen';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { VideoControlsComponent } from '../../video-controls/video-controls.component';
import { VolumeGestureDirective } from '../../../directives/volume-gesture.directive';
import { nip19 } from 'nostr-tools';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';

@Component({
  selector: 'app-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    '[class.footer-expanded-mode]': 'footer() && layout.expandedMediaPlayer()',
  },
})
export class VideoPlayerComponent implements OnDestroy {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);
  private readonly utilities = inject(UtilitiesService);
  private readonly castService = inject(CastService);
  private readonly elementRef = inject(ElementRef);
  private readonly overlayContainer = inject(OverlayContainer);

  footer = input<boolean>(false);
  cursorHidden = signal(false);
  isHoveringControlsBar = signal(false);
  isNativeFullscreen = signal(false);

  private fullscreenCleanup: (() => void) | null = null;
  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly AUTO_HIDE_DELAY = 3000;
  // Flag to ignore mouse events briefly after entering fullscreen
  private ignoreMouseEvents = false;
  // Track if last interaction was touch to ignore synthetic mouse events
  private lastInteractionWasTouch = false;
  private touchInteractionTimeout: ReturnType<typeof setTimeout> | null = null;
  private boundNativeFullscreenMouseMove = this.onNativeFullscreenMouseMove.bind(this);
  private boundNativeFullscreenTouchStart = this.onNativeFullscreenTouchStart.bind(this);

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
    this.clearAutoHideTimeout();
    if (this.touchInteractionTimeout) {
      clearTimeout(this.touchInteractionTimeout);
    }
    if (this.fullscreenCleanup) {
      this.fullscreenCleanup();
      this.fullscreenCleanup = null;
    }

    if (this.utilities.isBrowser()) {
      document.removeEventListener('mousemove', this.boundNativeFullscreenMouseMove, true);
      document.removeEventListener('touchstart', this.boundNativeFullscreenTouchStart, true);
    }
  }

  private onFullscreenChange = (isFullscreen: boolean) => {
    this.isNativeFullscreen.set(isFullscreen);

    // Move CDK overlay container into/out of fullscreen element for menus to work
    const overlayContainerEl = this.overlayContainer.getContainerElement();
    if (isFullscreen) {
      // Ignore mouse events briefly to prevent them from canceling auto-hide
      this.ignoreMouseEvents = true;
      setTimeout(() => {
        this.ignoreMouseEvents = false;
      }, 100);

      // Move overlay container into this component's fullscreen element
      const videoWrapper = this.elementRef.nativeElement.querySelector('.video-wrapper') as HTMLElement | null;
      const fullscreenElement = document.fullscreenElement as HTMLElement | null;
      const targetElement = fullscreenElement ?? videoWrapper;

      if (targetElement && overlayContainerEl) {
        targetElement.appendChild(overlayContainerEl);
      }

      // Reset hover state and start auto-hide timer when entering fullscreen
      this.isHoveringControlsBar.set(false);
      this.videoControlsRef?.forceShowControlsAndStartTimer();
      this.forceStartAutoHideTimer();

      document.addEventListener('mousemove', this.boundNativeFullscreenMouseMove, true);
      document.addEventListener('touchstart', this.boundNativeFullscreenTouchStart, true);
    } else {
      // Move overlay container back to body
      if (overlayContainerEl && overlayContainerEl.parentElement !== document.body) {
        document.body.appendChild(overlayContainerEl);
      }
      // Show cursor when exiting fullscreen
      this.ignoreMouseEvents = false;
      this.showCursor();

      document.removeEventListener('mousemove', this.boundNativeFullscreenMouseMove, true);
      document.removeEventListener('touchstart', this.boundNativeFullscreenTouchStart, true);
    }
  };

  private onNativeFullscreenMouseMove(): void {
    if (!this.isNativeFullscreen() || this.footer() || this.ignoreMouseEvents) {
      return;
    }

    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) {
      return;
    }

    this.videoControlsRef?.showControlsAndStartTimer();
    this.showCursor();
    this.startAutoHideTimer();
  }

  private onNativeFullscreenTouchStart(): void {
    if (!this.isNativeFullscreen() || this.footer() || this.ignoreMouseEvents) {
      return;
    }

    this.lastInteractionWasTouch = true;
    if (this.touchInteractionTimeout) {
      clearTimeout(this.touchInteractionTimeout);
    }
    this.touchInteractionTimeout = setTimeout(() => {
      this.lastInteractionWasTouch = false;
    }, 500);

    this.videoControlsRef?.showControlsAndStartTimer();
    this.showCursor();
    this.startAutoHideTimer();
  }

  private setupFullscreenListener(): void {
    this.fullscreenCleanup = addFullscreenChangeListener(
      this.videoElement?.nativeElement,
      this.onFullscreenChange
    );
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

  toggleExpand(): void {
    this.layout.expandedMediaPlayer.set(!this.layout.expandedMediaPlayer());
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

  async requestNativeFullscreen(): Promise<void> {
    const videoWrapper = this.elementRef.nativeElement.querySelector('.video-wrapper') as HTMLElement | null;
    const video = this.videoElement?.nativeElement;

    const success = await fullscreenToggle(videoWrapper, video);
    if (!success) {
      // Fullscreen not supported, fall back to expand
      this.toggleFullscreen();
    }
  }

  copyVideoUrl(): void {
    const currentMedia = this.media.current();
    if (currentMedia?.source) {
      navigator.clipboard.writeText(currentMedia.source);
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
    // Only handle in expanded mode (not footer mode)
    if (this.footer() || this.ignoreMouseEvents) return;
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    // Use showControlsAndStartTimer to ensure auto-hide continues
    this.videoControlsRef?.showControlsAndStartTimer();
    this.showCursor();
    this.startAutoHideTimer();
  }

  onVideoContainerMouseLeave(): void {
    // Only handle in expanded mode (not footer mode)
    if (this.footer() || this.ignoreMouseEvents) return;
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    // Start auto-hide immediately when leaving the video area
    if (!this.media.paused) {
      this.videoControlsRef?.showControlsAndStartTimer();
      this.startAutoHideTimer();
    }
  }

  onVideoContainerMouseMove(): void {
    // Only handle in expanded mode (not footer mode)
    if (this.footer() || this.ignoreMouseEvents) return;
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    // Don't restart timer if hovering controls bar
    if (this.isHoveringControlsBar()) {
      this.showCursor();
      return;
    }
    this.videoControlsRef?.showControlsAndStartTimer();
    this.showCursor();
    this.startAutoHideTimer();
  }

  /** Handle touch events on the video container for mobile auto-hide support */
  onVideoContainerTouchStart(): void {
    // Mark that this was a touch interaction to ignore subsequent synthetic mouse events
    this.lastInteractionWasTouch = true;
    // Clear any existing timeout
    if (this.touchInteractionTimeout) {
      clearTimeout(this.touchInteractionTimeout);
    }
    // Reset the flag after a delay to allow real mouse events again
    this.touchInteractionTimeout = setTimeout(() => {
      this.lastInteractionWasTouch = false;
    }, 500);

    // Only handle in expanded mode (not footer mode)
    if (this.footer() || this.ignoreMouseEvents) return;

    // Reset hover state since we're on a touch device
    this.isHoveringControlsBar.set(false);

    // Show controls and start auto-hide timer on touch
    this.videoControlsRef?.showControlsAndStartTimer();
    this.showCursor();
    this.startAutoHideTimer();
  }

  onControlsBarHover(hovering: boolean): void {
    this.isHoveringControlsBar.set(hovering);
    if (hovering) {
      // Keep cursor visible while hovering controls
      this.showCursor();
      this.clearAutoHideTimeout();
    } else {
      // Start auto-hide when leaving controls bar
      if (!this.media.paused) {
        this.startAutoHideTimer();
      }
    }
  }

  private showCursor(): void {
    this.cursorHidden.set(false);
  }

  private startAutoHideTimer(): void {
    // Only auto-hide if not paused and in expanded mode
    if (this.media.paused || this.footer() || this.isHoveringControlsBar()) return;

    this.clearAutoHideTimeout();
    this.autoHideTimeout = setTimeout(() => {
      if (!this.media.paused && !this.isHoveringControlsBar()) {
        this.cursorHidden.set(true);
      }
    }, this.AUTO_HIDE_DELAY);
  }

  /** Force start timer regardless of hover state - used when entering fullscreen */
  private forceStartAutoHideTimer(): void {
    if (this.footer()) return;

    this.clearAutoHideTimeout();
    this.autoHideTimeout = setTimeout(() => {
      // Only check hover state, not paused (video should be playing if user went fullscreen)
      if (!this.isHoveringControlsBar()) {
        this.cursorHidden.set(true);
      }
    }, this.AUTO_HIDE_DELAY);
  }

  private clearAutoHideTimeout(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
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
