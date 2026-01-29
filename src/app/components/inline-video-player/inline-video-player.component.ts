import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  OnDestroy,
  AfterViewInit,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { VideoControlsComponent } from '../video-controls/video-controls.component';
import { CastService } from '../../services/cast.service';

@Component({
  selector: 'app-inline-video-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    VideoControlsComponent,
  ],
  templateUrl: './inline-video-player.component.html',
  styleUrl: './inline-video-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.playing]': '!paused()',
    '[class.fullscreen]': 'isFullscreen()',
  },
})
export class InlineVideoPlayerComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostElement = inject(ElementRef);
  private readonly overlayContainer = inject(OverlayContainer);
  private readonly videoPlayback = inject(VideoPlaybackService);
  private readonly castService = inject(CastService);

  @ViewChild(VideoControlsComponent) videoControlsRef?: VideoControlsComponent;
  // Inputs
  src = input.required<string>();
  poster = input<string>();
  autoplay = input<boolean>(false);
  muted = input<boolean>(false);
  loop = input<boolean>(false);
  blurred = input<boolean>(false);
  /** Whether this video is rendered inside the Feeds panel (which is always alive in background) */
  inFeedsPanel = input<boolean>(false);

  // Outputs - renamed to avoid conflict with DOM events
  videoPlay = output<void>();
  videoPause = output<void>();
  videoEnded = output<void>();
  videoError = output<ErrorEvent>();
  videoLoadedMetadata = output<Event>();
  videoCanPlay = output<void>();

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  // Signal for video element to pass to VideoControlsComponent
  videoElementSignal = signal<HTMLVideoElement | undefined>(undefined);

  // State signals
  paused = signal(true);
  hasPlayedOnce = signal(false); // Track if video has been played at least once
  currentTime = signal(0);
  duration = signal(0);
  buffered = signal(0);
  volume = signal(1);
  isMuted = signal(false);
  playbackRate = signal(1);
  private controlsVisible = signal(true);
  isFullscreen = signal(false);
  isReady = signal(false);
  hasError = signal(false);

  // Fallback blob URL when QUIC protocol fails
  private blobUrl = signal<string | null>(null);
  private hasTriedBlobFallback = false;

  // Computed source - use blob URL if available, otherwise original src
  effectiveSrc = computed(() => this.blobUrl() ?? this.src());

  // Computed mute state - uses persisted state from service
  // The muted input is only used during initial load if no persisted state exists
  shouldBeMuted = computed(() => {
    // Always use the persisted mute state from the service
    // This ensures user's mute preference carries across videos
    return this.videoPlayback.isMuted();
  });

  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private videoEventCleanup: (() => void) | null = null;
  private intersectionObserver?: IntersectionObserver;
  // Start as false - IntersectionObserver will set to true when actually visible
  private isInViewport = signal(false);
  // Track if video was auto-played (vs manually played by user click)
  // Only auto-played videos should be auto-paused when leaving viewport
  private wasAutoPlayed = signal(false);

  private readonly fullscreenChangeHandler = () => {
    const isFullscreen = !!document.fullscreenElement;
    this.isFullscreen.set(isFullscreen);

    const overlayContainerEl = this.overlayContainer.getContainerElement();
    if (isFullscreen) {
      const fullscreenElement = document.fullscreenElement;
      if (fullscreenElement && overlayContainerEl) {
        fullscreenElement.appendChild(overlayContainerEl);
      }
    } else if (overlayContainerEl && overlayContainerEl.parentElement !== document.body) {
      document.body.appendChild(overlayContainerEl);
    }
  };

  readonly playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  constructor() {
    effect(() => {
      // Re-attach listeners when src changes
      const currentSrc = this.src();
      if (currentSrc && this.videoElement?.nativeElement) {
        this.cleanupVideoListeners();
        this.attachVideoListeners(this.videoElement.nativeElement);
      }
    });

    // Handle viewport visibility changes for auto-play and auto-pause
    // NOTE: This effect handles both auto-play and auto-pause based on viewport visibility.
    effect(() => {
      const inViewport = this.isInViewport();
      const feedsAutoPlayAllowed = this.videoPlayback.autoPlayAllowed();
      const isBlurred = this.blurred();
      const isInFeeds = this.inFeedsPanel();
      const video = this.videoElement?.nativeElement;

      if (!video) return;

      // Never auto-play if video is blurred (behind reveal overlay)
      if (isBlurred) {
        return;
      }

      // For videos in the Feeds panel, only auto-play when Feeds is visible
      // For videos elsewhere (profiles, etc.), always allow auto-play based on viewport
      const canAutoPlay = isInFeeds ? feedsAutoPlayAllowed : true;

      if (inViewport) {
        // Video entered viewport
        if (canAutoPlay && this.autoplay() && !this.hasPlayedOnce() && video.paused) {
          // Auto-play is allowed - play if enabled and hasn't been played yet
          this.wasAutoPlayed.set(true);
          video.play().catch(() => {
            // Autoplay failed - likely due to browser restrictions
            // User will need to click to play
          });
        }
      } else {
        // Video left viewport - pause if currently playing
        // But don't pause if we're in fullscreen mode (fullscreen changes viewport intersection)
        const isFullscreen = !!document.fullscreenElement;
        if (!video.paused && !isFullscreen) {
          video.pause();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up IntersectionObserver to detect when video enters/leaves viewport
    if (isPlatformBrowser(this.platformId) && typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            // Consider video in viewport if at least 30% is visible
            const isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.3;
            this.isInViewport.set(isVisible);
          });
        },
        {
          threshold: [0, 0.3, 0.5, 1],
          rootMargin: '0px',
        }
      );

      // Observe the component's host element
      if (this.hostElement?.nativeElement) {
        this.intersectionObserver.observe(this.hostElement.nativeElement);
      }
    }

    if (isPlatformBrowser(this.platformId)) {
      document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    }
  }

  ngOnDestroy(): void {
    this.cleanupVideoListeners();
    this.clearAutoHideTimer();

    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    if (isPlatformBrowser(this.platformId)) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    }

    // Clean up blob URL if created
    const blob = this.blobUrl();
    if (blob) {
      URL.revokeObjectURL(blob);
    }

    // Unregister from video playback service
    const video = this.videoElement?.nativeElement;
    if (video) {
      this.videoPlayback.unregisterPlaying(video);
    }
  }

  onVideoElementReady(): void {
    if (this.videoElement?.nativeElement) {
      this.videoElementSignal.set(this.videoElement.nativeElement);
      this.attachVideoListeners(this.videoElement.nativeElement);
    }
  }

  private attachVideoListeners(video: HTMLVideoElement): void {
    const onPlay = () => {
      this.paused.set(false);
      this.hasPlayedOnce.set(true); // Mark that video has been played
      this.videoPlay.emit();
      // Register with playback service to pause other videos
      this.videoPlayback.registerPlaying(video);
    };
    const onPause = () => {
      this.paused.set(true);
      this.videoPause.emit();
      // Unregister from playback service
      this.videoPlayback.unregisterPlaying(video);
    };
    const onEnded = () => this.videoEnded.emit();
    const onTimeUpdate = () => {
      this.currentTime.set(video.currentTime);
      if (video.buffered.length > 0) {
        this.buffered.set(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onDurationChange = () => this.duration.set(video.duration || 0);
    const onVolumeChange = () => {
      this.volume.set(video.volume);
      this.isMuted.set(video.muted);
    };
    const onRateChange = () => this.playbackRate.set(video.playbackRate);
    const onLoadedMetadata = (e: Event) => {
      this.duration.set(video.duration || 0);
      this.volume.set(video.volume);
      this.playbackRate.set(video.playbackRate);
      this.videoLoadedMetadata.emit(e);

      // Apply persisted mute state when video loads
      const persistedMuted = this.videoPlayback.getMutedState();
      video.muted = persistedMuted;
      this.isMuted.set(persistedMuted);
    };
    const onCanPlay = () => {
      this.isReady.set(true);
      this.hasError.set(false);
      this.videoCanPlay.emit();
    };
    const onError = (e: Event) => {
      // Try blob fallback on network errors (like QUIC protocol errors)
      // This fetches the video without range requests, bypassing QUIC issues
      if (!this.hasTriedBlobFallback && this.src()) {
        this.hasTriedBlobFallback = true;
        this.tryBlobFallback();
      } else {
        this.hasError.set(true);
        this.videoError.emit(e as ErrorEvent);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);

    this.videoEventCleanup = () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };

    // Initialize state
    this.paused.set(video.paused);
    this.currentTime.set(video.currentTime);
    this.duration.set(video.duration || 0);
    this.volume.set(video.volume);
    this.isMuted.set(video.muted);
  }

  private cleanupVideoListeners(): void {
    if (this.videoEventCleanup) {
      this.videoEventCleanup();
      this.videoEventCleanup = null;
    }
  }

  /**
   * Fallback for QUIC protocol errors.
   * Fetches the video as a blob without range requests, which bypasses
   * QUIC/HTTP3 issues that can occur with partial content (206) responses.
   */
  private async tryBlobFallback(): Promise<void> {
    const url = this.src();
    if (!url || !isPlatformBrowser(this.platformId)) return;

    try {
      const response = await fetch(url, {
        // Avoid range requests by not specifying any range headers
        headers: {
          // Some servers respect this hint to disable HTTP/3
          'Accept': 'video/*',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrl.set(blobUrl);

      // The video element will automatically update due to effectiveSrc() change
      // Reset error state since we're retrying
      this.hasError.set(false);
    } catch {
      // Blob fallback also failed, show error state
      this.hasError.set(true);
    }
  }

  // Control methods
  togglePlay(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    if (video.paused) {
      // Mark as manually played - don't auto-pause when leaving viewport
      this.wasAutoPlayed.set(false);
      video.play().catch(() => {
        // Play failed, likely due to autoplay restrictions
      });
      // Start auto-hide timer when video starts playing
      this.startAutoHideTimer();
    } else {
      video.pause();
    }
  }

  onVideoClick(_event: MouseEvent | TouchEvent): void {
    // Toggle play/pause when clicking on video
    this.togglePlay();
  }

  onVideoDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleFullscreen();
  }

  toggleMute(): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      const newMutedState = !video.muted;
      video.muted = newMutedState;
      // Persist mute state for all videos
      this.videoPlayback.setMuted(newMutedState);
    }
  }

  setPlaybackRate(rate: number): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.playbackRate = rate;
    }
  }

  async toggleFullscreen(): Promise<void> {
    const container = this.videoElement?.nativeElement?.parentElement;
    if (!container) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch {
      // Fullscreen not supported
    }
  }

  async pictureInPicture(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP not supported
    }
  }

  async castToDevice(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    const videoUrl = this.effectiveSrc();
    if (!video || !videoUrl) return;

    await this.castService.castVideoElement(
      video,
      videoUrl,
      'Video', // Default title
    );
  }

  // Handler methods for VideoControlsComponent outputs
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
        this.videoPlayback.setMuted(false);
      }
    }
  }

  onMuteToggle(): void {
    this.toggleMute();
  }

  onPlaybackRateChange(rate: number): void {
    this.setPlaybackRate(rate);
  }

  private showControls(): void {
    this.clearAutoHideTimer();
    this.controlsVisible.set(true);
  }

  private startAutoHideTimer(): void {
    this.clearAutoHideTimer();
    // Shorter timeout for auto-hide (1.5 seconds) for more responsive feel
    this.autoHideTimeout = setTimeout(() => {
      if (!this.paused()) {
        this.controlsVisible.set(false);
      }
    }, 1500);
  }

  private clearAutoHideTimer(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
