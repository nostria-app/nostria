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
import { formatDuration } from '../../utils/format-duration';
import {
  toggleFullscreen as fullscreenToggle,
  isInFullscreen,
  addFullscreenChangeListener,
} from '../../utils/fullscreen';
import { VideoControlsComponent, VideoControlsConfig } from '../video-controls/video-controls.component';
import { CastService } from '../../services/cast.service';
import { UtilitiesService } from '../../services/utilities.service';

const DEFAULT_INLINE_VIDEO_CONTROLS_CONFIG: VideoControlsConfig = {
  showQuality: false,
  isLiveStream: false,
};

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
  private readonly utilities = inject(UtilitiesService);

  @ViewChild(VideoControlsComponent) videoControlsRef?: VideoControlsComponent;
  // Inputs
  src = input.required<string>();
  poster = input<string>();
  autoplay = input<boolean>(false);
  muted = input<boolean>(false);
  loop = input<boolean>(false);
  blurred = input<boolean>(false);
  ignoreGlobalMutePreference = input<boolean>(false);
  objectFit = input<'contain' | 'cover'>('contain');
  expectedDim = input<string>('');
  fillContainer = input<boolean>(false);
  controlsConfig = input<VideoControlsConfig | undefined>(undefined);
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
  needsRotationCorrection = signal(false);

  // Fallback blob URL when QUIC protocol fails
  private blobUrl = signal<string | null>(null);
  private hasTriedBlobFallback = false;

  // Computed source - use blob URL if available, otherwise original src
  effectiveSrc = computed(() => this.blobUrl() ?? this.src());
  private generatedPoster = signal<string | null>(null);
  private posterFallbackAttemptedForSrc: string | null = null;

  effectivePoster = computed(() => this.poster() || this.generatedPoster() || undefined);

  effectivePreload = computed<'metadata'>(() => 'metadata');

  effectiveControlsConfig = computed<VideoControlsConfig>(() => ({
    ...DEFAULT_INLINE_VIDEO_CONTROLS_CONFIG,
    ...(this.controlsConfig() ?? {}),
  }));

  effectiveObjectFit = computed<'contain' | 'cover'>(() => {
    if (this.isFullscreen()) {
      return 'contain';
    }

    return this.objectFit();
  });

  // Computed mute state - uses persisted state from service
  // The muted input is only used during initial load if no persisted state exists
  shouldBeMuted = computed(() => {
    if (this.ignoreGlobalMutePreference()) {
      return this.muted();
    }

    return this.muted() || this.videoPlayback.isMuted();
  });

  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private videoEventCleanup: (() => void) | null = null;
  private intersectionObserver?: IntersectionObserver;
  // Start as false - IntersectionObserver will set to true when actually visible
  private isInViewport = signal(false);
  // Track if video was auto-played (vs manually played by user click)
  // Only auto-played videos should be auto-paused when leaving viewport
  private wasAutoPlayed = signal(false);
  private userPausedByInteraction = signal(false);

  private fullscreenCleanup: (() => void) | null = null;
  private visibilityChangeCleanup: (() => void) | null = null;
  private pageShowCleanup: (() => void) | null = null;

  private readonly onFullscreenChange = (fullscreen: boolean) => {
    this.isFullscreen.set(fullscreen);

    const overlayContainerEl = this.overlayContainer.getContainerElement();
    if (fullscreen) {
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
      // Re-attach listeners when effective source changes
      const currentSrc = this.effectiveSrc();

      if (currentSrc !== this.posterFallbackAttemptedForSrc) {
        this.posterFallbackAttemptedForSrc = null;
        this.clearGeneratedPoster();
      }

      this.ensurePosterFallback(currentSrc);

      if (currentSrc && this.videoElement?.nativeElement) {
        this.hasPlayedOnce.set(false);
        this.paused.set(true);
        this.currentTime.set(0);
        this.duration.set(0);
        this.buffered.set(0);
        this.needsRotationCorrection.set(false);
        this.wasAutoPlayed.set(false);
        this.userPausedByInteraction.set(false);
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
        } else if (isInFeeds && !canAutoPlay && !video.paused) {
          // Feeds panel became hidden while video was playing in viewport.
          // IntersectionObserver doesn't re-fire on visibility changes,
          // so isInViewport may be stale. Actively pause the video.
          video.pause();
        }
      } else {
        // Video left viewport - pause if currently playing
        // But don't pause if we're in fullscreen mode (fullscreen changes viewport intersection)
        if (!video.paused && !isInFullscreen(video)) {
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
            // AND the element is actually visible (not hidden via CSS visibility).
            // This is needed because IntersectionObserver reports intersection even
            // when parent has visibility:hidden (e.g., feeds panel hidden behind other pages).
            const isGeometricallyVisible = entry.isIntersecting && entry.intersectionRatio >= 0.3;
            const isCssVisible = !this.isHiddenByVisibility(entry.target);
            this.isInViewport.set(isGeometricallyVisible && isCssVisible);
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
      this.fullscreenCleanup = addFullscreenChangeListener(
        this.videoElement?.nativeElement,
        this.onFullscreenChange
      );

      const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') {
          return;
        }

        requestAnimationFrame(() => {
          this.resumeAutoplayAfterAppReturn();
        });
      };

      const onPageShow = () => {
        requestAnimationFrame(() => {
          this.resumeAutoplayAfterAppReturn();
        });
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('pageshow', onPageShow);

      this.visibilityChangeCleanup = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };

      this.pageShowCleanup = () => {
        window.removeEventListener('pageshow', onPageShow);
      };
    }
  }

  ngOnDestroy(): void {
    this.cleanupVideoListeners();
    this.clearAutoHideTimer();

    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    if (isPlatformBrowser(this.platformId) && this.fullscreenCleanup) {
      this.fullscreenCleanup();
      this.fullscreenCleanup = null;
    }

    if (this.visibilityChangeCleanup) {
      this.visibilityChangeCleanup();
      this.visibilityChangeCleanup = null;
    }

    if (this.pageShowCleanup) {
      this.pageShowCleanup();
      this.pageShowCleanup = null;
    }

    // Clean up blob URL if created
    const blob = this.blobUrl();
    if (blob) {
      URL.revokeObjectURL(blob);
    }

    this.clearGeneratedPoster();

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
      this.applyOrientationCorrectionHint(video);

      // Apply persisted mute state when video loads
      const mutedState = this.shouldBeMuted();
      video.muted = mutedState;
      this.isMuted.set(mutedState);

      const currentSource = this.effectiveSrc();
      if (currentSource) {
        this.ensurePosterFallback(currentSource);
      }

      this.ensurePreviewFrame(video);
    };
    const onCanPlay = () => {
      this.isReady.set(true);
      this.hasError.set(false);
      this.videoCanPlay.emit();

      const currentSource = this.effectiveSrc();
      if (currentSource) {
        this.ensurePosterFallback(currentSource);
      }

      this.ensurePreviewFrame(video);

      const canAutoPlay = this.inFeedsPanel() ? this.videoPlayback.autoPlayAllowed() : true;
      if (canAutoPlay && this.autoplay() && this.isInViewport() && !this.hasPlayedOnce() && !this.blurred() && video.paused) {
        this.wasAutoPlayed.set(true);
        video.play().catch(() => {
          // Autoplay may still be blocked by browser policy
        });
      }
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

  private applyOrientationCorrectionHint(video: HTMLVideoElement): void {
    const expected = this.expectedDim().trim();
    if (!expected || !this.fillContainer()) {
      this.needsRotationCorrection.set(false);
      return;
    }

    const [expectedWidthRaw, expectedHeightRaw] = expected.toLowerCase().split('x');
    const expectedWidth = Number.parseInt(expectedWidthRaw || '', 10);
    const expectedHeight = Number.parseInt(expectedHeightRaw || '', 10);

    if (Number.isNaN(expectedWidth) || Number.isNaN(expectedHeight) || expectedWidth <= 0 || expectedHeight <= 0) {
      this.needsRotationCorrection.set(false);
      return;
    }

    const actualWidth = video.videoWidth;
    const actualHeight = video.videoHeight;
    if (!actualWidth || !actualHeight) {
      this.needsRotationCorrection.set(false);
      return;
    }

    const expectedRatio = expectedWidth / expectedHeight;
    const actualRatio = actualWidth / actualHeight;
    const reciprocalExpected = 1 / expectedRatio;

    const normalDiff = Math.abs(actualRatio - expectedRatio);
    const reciprocalDiff = Math.abs(actualRatio - reciprocalExpected);

    const expectedPortrait = expectedHeight >= expectedWidth;
    const actualPortrait = actualHeight >= actualWidth;
    const orientationMismatch = expectedPortrait !== actualPortrait;

    const shouldRotate = orientationMismatch && reciprocalDiff + 0.05 < normalDiff;
    this.needsRotationCorrection.set(shouldRotate);
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

  private ensurePosterFallback(src: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!src || this.poster() || this.generatedPoster() || this.posterFallbackAttemptedForSrc === src) {
      return;
    }

    this.posterFallbackAttemptedForSrc = src;

    void this.generatePosterFallback(src);
  }

  private async generatePosterFallback(src: string): Promise<void> {
    try {
      const result = await this.utilities.extractThumbnailFromVideo(src, 0.35);

      if (this.src() !== src || this.poster()) {
        URL.revokeObjectURL(result.objectUrl);
        return;
      }

      this.clearGeneratedPoster();
      this.generatedPoster.set(result.objectUrl);
    } catch {
      // Allow future retry attempts if this attempt failed.
      if (this.effectiveSrc() === src && !this.poster() && !this.generatedPoster()) {
        this.posterFallbackAttemptedForSrc = null;
      }
    }
  }

  private clearGeneratedPoster(): void {
    const currentPoster = this.generatedPoster();
    if (currentPoster) {
      URL.revokeObjectURL(currentPoster);
      this.generatedPoster.set(null);
    }
  }

  private ensurePreviewFrame(video: HTMLVideoElement): void {
    // Keep initial timeline position stable (0:00) on load.
    // Preview fallback is handled via generated poster extraction only.
    void video;
  }

  // Control methods
  togglePlay(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    if (video.paused) {
      // Mark as manually played - don't auto-pause when leaving viewport
      this.wasAutoPlayed.set(false);
      this.userPausedByInteraction.set(false);
      video.play().catch(() => {
        // Play failed, likely due to autoplay restrictions
      });
      // Start auto-hide timer when video starts playing
      this.startAutoHideTimer();
    } else {
      this.userPausedByInteraction.set(true);
      video.pause();
    }
  }

  onVideoClick(): void {
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
    const video = this.videoElement?.nativeElement;
    if (!container && !video) return;

    await fullscreenToggle(container, video);
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

  /**
   * Check if an element or any of its ancestors has visibility:hidden.
   * IntersectionObserver reports intersection even for visibility:hidden elements,
   * so we need this extra check to prevent auto-play in hidden panels (e.g., feeds behind other pages).
   */
  private isHiddenByVisibility(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
      const style = getComputedStyle(current);
      if (style.visibility === 'hidden') {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private resumeAutoplayAfterAppReturn(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }

    if (!this.autoplay() || this.blurred() || !this.isInViewport() || this.userPausedByInteraction() || !video.paused) {
      return;
    }

    const canAutoPlay = this.inFeedsPanel() ? this.videoPlayback.autoPlayAllowed() : true;
    if (!canAutoPlay) {
      return;
    }

    video.play().catch(() => {
      // Autoplay may still be blocked by browser policy
    });
  }

  formatTime = formatDuration;
}
