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
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

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
export class InlineVideoPlayerComponent implements OnDestroy {
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

  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private videoEventCleanup: (() => void) | null = null;

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
  }

  ngOnDestroy(): void {
    this.cleanupVideoListeners();
    this.clearAutoHideTimer();
  }

  onVideoElementReady(): void {
    if (this.videoElement?.nativeElement) {
      this.attachVideoListeners(this.videoElement.nativeElement);
    }
  }

  private attachVideoListeners(video: HTMLVideoElement): void {
    const onPlay = () => {
      this.paused.set(false);
      this.videoPlay.emit();
    };
    const onPause = () => {
      this.paused.set(true);
      this.videoPause.emit();
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
      this.isMuted.set(video.muted);
      this.playbackRate.set(video.playbackRate);
      this.videoLoadedMetadata.emit(e);
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
    } else {
      video.pause();
    }
  }

  toggleMute(): void {
    const video = this.videoElement?.nativeElement;
    if (video) {
      video.muted = !video.muted;
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
    if (!this.paused()) {
      this.startAutoHideTimer();
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
    this.autoHideTimeout = setTimeout(() => {
      if (!this.paused()) {
        this.controlsVisible.set(false);
      }
    }, 3000);
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
