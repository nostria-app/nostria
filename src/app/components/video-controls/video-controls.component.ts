import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  inject,
  ElementRef,
  HostListener,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UtilitiesService } from '../../services/utilities.service';

export interface QualityLevel {
  index: number;
  label: string;
  height?: number;
  bitrate?: number;
}

export interface VideoControlsConfig {
  showQuality?: boolean;
  showPiP?: boolean;
  showFullscreen?: boolean;
  showPlaybackRate?: boolean;
  showCast?: boolean;
  isLiveStream?: boolean;
  autoHide?: boolean;
  autoHideDelay?: number;
}

const DEFAULT_CONFIG: VideoControlsConfig = {
  showQuality: true,
  showPiP: true,
  showFullscreen: true,
  showPlaybackRate: true,
  showCast: true,
  isLiveStream: false,
  autoHide: true,
  autoHideDelay: 3000,
};

@Component({
  selector: 'app-video-controls',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './video-controls.component.html',
  styleUrl: './video-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.visible]': 'controlsVisible()',
    '[class.is-paused]': 'paused()',
    '[class.native-fullscreen]': 'nativeFullscreen()',
    '(mouseenter)': 'onMouseEnter()',
    '(mouseleave)': 'onMouseLeave()',
    '(mousemove)': 'onMouseMove()',
  },
})
export class VideoControlsComponent implements OnDestroy {
  private readonly utilities = inject(UtilitiesService);
  private readonly hostElement = inject(ElementRef);

  // Inputs
  videoElement = input<HTMLVideoElement | undefined>();
  config = input<VideoControlsConfig>({});
  qualityLevels = input<QualityLevel[]>([]);
  currentQuality = input<number>(-1); // -1 = auto
  nativeFullscreen = input<boolean>(false); // When true, parent manages auto-hide

  // Outputs
  seek = output<number>();
  playPause = output<void>();
  volumeChange = output<number>();
  muteToggle = output<void>();
  qualityChange = output<number>();
  playbackRateChange = output<number>();
  fullscreenToggle = output<void>();
  pipToggle = output<void>();
  castToggle = output<void>();
  controlsBarHover = output<boolean>(); // Emits true when hovering controls-bar, false when leaving

  // Internal state - reactive signals for video state
  controlsVisible = signal(true);
  isHovering = signal(false);
  isHoveringControlsBar = signal(false);
  isSeeking = signal(false);
  volumeSliderVisible = signal(false);

  // Video state signals (updated via event listeners)
  paused = signal(true);
  currentTime = signal(0);
  duration = signal(0);
  buffered = signal(0);
  volume = signal(1);
  muted = signal(false);
  playbackRate = signal(1);

  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private videoEventCleanup: (() => void) | null = null;

  // Merged config with defaults
  mergedConfig = computed(() => ({
    ...DEFAULT_CONFIG,
    ...this.config(),
  }));

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

  // Volume icon based on state
  volumeIcon = computed(() => {
    if (this.muted() || this.volume() === 0) return 'volume_off';
    if (this.volume() < 0.5) return 'volume_down';
    return 'volume_up';
  });

  // Current quality label
  currentQualityLabel = computed(() => {
    const current = this.currentQuality();
    const levels = this.qualityLevels();
    if (current === -1 || levels.length === 0) return 'Auto';
    const level = levels.find(l => l.index === current);
    return level?.label || 'Auto';
  });

  // Playback rate options
  readonly playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  constructor() {
    // Watch for video element changes and attach event listeners
    effect(() => {
      const video = this.videoElement();
      console.log('[VideoControls] videoElement changed:', !!video, video?.src);
      this.cleanupVideoListeners();

      if (video) {
        this.attachVideoListeners(video);
        // Initialize state from video
        this.updateStateFromVideo(video);
      }
    });

    // Auto-hide controls
    effect(() => {
      const cfg = this.mergedConfig();
      const hovering = this.isHovering();
      const seeking = this.isSeeking();
      const isPaused = this.paused();
      const isNativeFs = this.nativeFullscreen();

      // In native fullscreen, parent handles all auto-hide via showControlsAndStartTimer()
      // Don't interfere with the timer here
      if (isNativeFs) {
        return;
      }

      if (!cfg.autoHide || isPaused || hovering || seeking) {
        this.showControls();
        return;
      }

      this.startAutoHideTimer();
    });
  }

  ngOnDestroy(): void {
    this.cleanupVideoListeners();
    this.clearAutoHideTimer();
  }

  private attachVideoListeners(video: HTMLVideoElement): void {
    const onPlay = () => this.paused.set(false);
    const onPause = () => this.paused.set(true);
    const onTimeUpdate = () => {
      this.currentTime.set(video.currentTime);
      // Update buffered
      if (video.buffered.length > 0) {
        this.buffered.set(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onDurationChange = () => this.duration.set(video.duration || 0);
    const onVolumeChange = () => {
      this.volume.set(video.volume);
      this.muted.set(video.muted);
    };
    const onRateChange = () => this.playbackRate.set(video.playbackRate);
    const onLoadedMetadata = () => {
      this.duration.set(video.duration || 0);
      this.volume.set(video.volume);
      this.muted.set(video.muted);
      this.playbackRate.set(video.playbackRate);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    this.videoEventCleanup = () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }

  private cleanupVideoListeners(): void {
    if (this.videoEventCleanup) {
      this.videoEventCleanup();
      this.videoEventCleanup = null;
    }
  }

  private updateStateFromVideo(video: HTMLVideoElement): void {
    this.paused.set(video.paused);
    this.currentTime.set(video.currentTime);
    this.duration.set(video.duration || 0);
    this.volume.set(video.volume);
    this.muted.set(video.muted);
    this.playbackRate.set(video.playbackRate);
    if (video.buffered.length > 0) {
      this.buffered.set(video.buffered.end(video.buffered.length - 1));
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const video = this.videoElement();
    if (!video) return;

    // Don't intercept keyboard shortcuts with modifier keys (Ctrl+F, Cmd+F, etc.)
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // Only handle keys if our component or video is focused
    const activeElement = document.activeElement;
    const isInputFocused = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
    if (isInputFocused) return;

    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        this.onPlayPause();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.seekRelative(-5);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.seekRelative(5);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.changeVolume(Math.min(1, this.volume() + 0.1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.changeVolume(Math.max(0, this.volume() - 0.1));
        break;
      case 'm':
        event.preventDefault();
        this.onMuteToggle();
        break;
      case 'f':
        event.preventDefault();
        this.onFullscreenToggle();
        break;
    }
  }

  onMouseEnter(): void {
    // In native fullscreen, don't track hovering - let parent handle it
    if (this.nativeFullscreen()) return;
    this.isHovering.set(true);
    this.showControls();
  }

  onMouseLeave(): void {
    // In native fullscreen, don't track hovering - let parent handle it
    if (this.nativeFullscreen()) return;
    this.isHovering.set(false);
  }

  onMouseMove(): void {
    // In native fullscreen, let parent handle mouse events
    if (this.nativeFullscreen()) return;
    this.showControls();
    if (!this.isHovering() && !this.paused()) {
      this.startAutoHideTimer();
    }
  }

  /** Called when mouse enters the controls-bar (buttons area) */
  onControlsBarMouseEnter(): void {
    this.isHoveringControlsBar.set(true);
    this.controlsBarHover.emit(true);
  }

  /** Called when mouse leaves the controls-bar (buttons area) */
  onControlsBarMouseLeave(): void {
    this.isHoveringControlsBar.set(false);
    this.controlsBarHover.emit(false);
  }

  showControls(): void {
    this.clearAutoHideTimer();
    this.controlsVisible.set(true);
  }

  /** Show controls and start auto-hide timer - use this when called from parent container */
  showControlsAndStartTimer(): void {
    this.controlsVisible.set(true);
    this.clearAutoHideTimer();
    if (!this.paused()) {
      this.startAutoHideTimer();
    }
  }

  /** Force start auto-hide timer, resetting hover state - used when entering fullscreen */
  forceShowControlsAndStartTimer(): void {
    // Reset hover state since entering fullscreen repositions everything
    this.isHoveringControlsBar.set(false);
    this.controlsBarHover.emit(false);
    this.controlsVisible.set(true);
    this.clearAutoHideTimer();
    // Always start timer when entering fullscreen (even if appears paused due to race condition)
    // The hideControls will re-check paused state when timer fires
    this.startAutoHideTimer();
  }

  hideControls(): void {
    // Don't hide if hovering controls bar
    if (this.isHoveringControlsBar() || this.isSeeking()) {
      return;
    }
    // In native fullscreen, just hide - parent controls timing
    if (this.nativeFullscreen()) {
      this.controlsVisible.set(false);
      return;
    }
    // Normal mode - respect paused and hovering state
    if (!this.paused() && !this.isHovering()) {
      this.controlsVisible.set(false);
    }
  }

  private startAutoHideTimer(): void {
    this.clearAutoHideTimer();
    const delay = this.mergedConfig().autoHideDelay ?? 3000;
    this.autoHideTimeout = setTimeout(() => {
      this.hideControls();
    }, delay);
  }

  private clearAutoHideTimer(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  // Play/Pause - emit event for parent to handle
  // Parent component is responsible for calling video.play()/pause()
  onPlayPause(): void {
    this.playPause.emit();
  }

  // Volume
  onVolumeSliderChange(value: number): void {
    this.volumeChange.emit(value / 100);
  }

  changeVolume(value: number): void {
    this.volumeChange.emit(value);
  }

  onMuteToggle(): void {
    this.muteToggle.emit();
  }

  showVolumeSlider(): void {
    this.volumeSliderVisible.set(true);
  }

  hideVolumeSlider(): void {
    this.volumeSliderVisible.set(false);
  }

  // Seeking
  onProgressClick(event: MouseEvent): void {
    const progressBar = event.currentTarget as HTMLElement;
    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const time = percent * this.duration();
    this.seek.emit(time);
  }

  onProgressMouseDown(event: MouseEvent): void {
    this.isSeeking.set(true);
    this.onProgressClick(event);

    const onMouseMove = (e: MouseEvent) => {
      this.onProgressClick(e);
    };

    const onMouseUp = () => {
      this.isSeeking.set(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  seekRelative(seconds: number): void {
    const video = this.videoElement();
    if (!video) return;
    const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    this.seek.emit(newTime);
  }

  // Quality
  onQualityChange(level: number): void {
    this.qualityChange.emit(level);
  }

  // Playback Rate
  onPlaybackRateChange(rate: number): void {
    this.playbackRateChange.emit(rate);
  }

  // Fullscreen & PiP
  onFullscreenToggle(): void {
    this.fullscreenToggle.emit();
  }

  onPipToggle(): void {
    this.pipToggle.emit();
  }

  onCastToggle(): void {
    this.castToggle.emit();
  }

  // Utilities
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
