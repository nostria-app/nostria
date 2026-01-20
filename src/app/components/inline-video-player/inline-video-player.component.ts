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
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VideoPlaybackService } from '../../services/video-playback.service';

@Component({
  selector: 'app-inline-video-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatMenuModule,
    MatTooltipModule,
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
  private readonly videoPlayback = inject(VideoPlaybackService);
  // Inputs
  src = input.required<string>();
  poster = input<string>();
  autoplay = input<boolean>(false);
  muted = input<boolean>(false);
  loop = input<boolean>(false);
  blurred = input<boolean>(false);

  // Outputs - renamed to avoid conflict with DOM events
  videoPlay = output<void>();
  videoPause = output<void>();
  videoEnded = output<void>();
  videoError = output<ErrorEvent>();
  videoLoadedMetadata = output<Event>();
  videoCanPlay = output<void>();

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  // State signals
  paused = signal(true);
  hasPlayedOnce = signal(false); // Track if video has been played at least once
  currentTime = signal(0);
  duration = signal(0);
  buffered = signal(0);
  volume = signal(1);
  isMuted = signal(false);
  playbackRate = signal(1);
  controlsVisible = signal(true);
  isFullscreen = signal(false);
  volumeSliderVisible = signal(false);
  isReady = signal(false);

  // Computed mute state - uses persisted state from service, or muted input for autoplay
  shouldBeMuted = computed(() => {
    // If muted input is set (e.g., for autoplay), use it
    if (this.muted()) {
      return true;
    }
    // Otherwise prefer the persisted mute state from the service
    return this.videoPlayback.isMuted();
  });

  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private videoEventCleanup: (() => void) | null = null;
  private intersectionObserver?: IntersectionObserver;
  private isInViewport = signal(true);

  // Progress calculations
  progressPercent = computed(() => {
    const dur = this.duration();
    if (dur <= 0) return 0;
    return (this.currentTime() / dur) * 100;
  });

  bufferedPercent = computed(() => {
    const dur = this.duration();
    if (dur <= 0) return 0;
    return (this.buffered() / dur) * 100;
  });

  // Formatted times
  formattedCurrentTime = computed(() => this.formatTime(this.currentTime()));
  formattedDuration = computed(() => this.formatTime(this.duration()));

  // Volume icon
  volumeIcon = computed(() => {
    if (this.isMuted() || this.volume() === 0) return 'volume_off';
    if (this.volume() < 0.5) return 'volume_down';
    return 'volume_up';
  });

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

    // Auto-pause when scrolled out of viewport
    effect(() => {
      const inViewport = this.isInViewport();
      const video = this.videoElement?.nativeElement;
      
      if (!inViewport && video && !video.paused) {
        video.pause();
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
  }

  ngOnDestroy(): void {
    this.cleanupVideoListeners();
    this.clearAutoHideTimer();
    
    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    
    // Unregister from video playback service
    const video = this.videoElement?.nativeElement;
    if (video) {
      this.videoPlayback.unregisterPlaying(video);
    }
  }

  onVideoElementReady(): void {
    if (this.videoElement?.nativeElement) {
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
      this.videoCanPlay.emit();
    };
    const onError = (e: Event) => this.videoError.emit(e as ErrorEvent);

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

  // Control methods
  togglePlay(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {
        // Play failed, likely due to autoplay restrictions
      });
      // Start auto-hide timer when video starts playing
      this.startAutoHideTimer();
    } else {
      video.pause();
    }
  }

  onVideoClick(event: MouseEvent | TouchEvent): void {
    // Toggle play/pause when clicking on video
    // Show controls briefly on touch devices
    if (event instanceof TouchEvent) {
      if (!this.paused()) {
        this.showControls();
        this.startAutoHideTimer();
      }
    }
    this.togglePlay();
  }

  onVideoDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleFullscreen();
  }

  onPlayButtonClick(): void {
    this.togglePlay();
  }

  onTouchStart(): void {
    // On touch devices, show controls when user touches the container
    if (!this.paused()) {
      this.showControls();
      this.startAutoHideTimer();
    }
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

  onVolumeSliderChange(value: number): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.volume = value / 100;
      if (video.muted && value > 0) {
        video.muted = false;
      }
    }
  }

  onProgressClick(event: MouseEvent): void {
    const progressBar = event.currentTarget as HTMLElement;
    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const time = percent * this.duration();

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.currentTime = time;
    }
  }

  onProgressKeyDown(event: KeyboardEvent): void {
    const video = this.videoElement?.nativeElement;
    if (!video) return;

    const step = 5; // seconds
    if (event.key === 'ArrowLeft') {
      video.currentTime = Math.max(0, video.currentTime - step);
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      video.currentTime = Math.min(video.duration, video.currentTime + step);
      event.preventDefault();
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
        this.isFullscreen.set(false);
      } else {
        await container.requestFullscreen();
        this.isFullscreen.set(true);
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

  showVolumeSlider(): void {
    this.volumeSliderVisible.set(true);
  }

  hideVolumeSlider(): void {
    this.volumeSliderVisible.set(false);
  }

  onMouseEnter(): void {
    this.showControls();
  }

  onMouseLeave(): void {
    // Immediately hide controls when mouse leaves (no delay)
    if (!this.paused()) {
      this.clearAutoHideTimer();
      this.controlsVisible.set(false);
    }
  }

  onMouseMove(): void {
    this.showControls();
    if (!this.paused()) {
      this.startAutoHideTimer();
    }
  }

  showControls(): void {
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
