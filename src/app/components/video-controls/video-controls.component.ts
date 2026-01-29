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
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UtilitiesService } from '../../services/utilities.service';
import { VolumeGestureDirective } from '../../directives/volume-gesture.directive';

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
  autoHideDelay: 1500, // Shorter delay for more responsive feel
};

@Component({
  selector: 'app-video-controls',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatMenuModule,
    MatTooltipModule,
    VolumeGestureDirective,
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
    '(touchstart)': 'onTouchStart($event)',
    '(click)': 'onOverlayClick($event)',
  },
})
export class VideoControlsComponent implements OnDestroy {
  private readonly utilities = inject(UtilitiesService);
  private readonly hostElement = inject(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

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
  controlsVisibilityChange = output<boolean>(); // Emits when controls visibility changes

  // Internal state - reactive signals for video state
  controlsVisible = signal(true);
  isHovering = signal(false);
  isHoveringControlsBar = signal(false);
  isSeeking = signal(false);

  // Seek preview state (for time bubble while dragging/touching progress bar)
  seekPreviewTime = signal<number | null>(null);
  seekPreviewPercent = signal<number>(0);
  isShowingSeekPreview = signal(false);

  // Track if last interaction was touch to ignore synthetic mouse events
  private lastInteractionWasTouch = false;
  private touchInteractionTimeout: ReturnType<typeof setTimeout> | null = null;
  volumeSliderVisible = signal(false);

  // Small screen detection for responsive menu (Cast/PiP move into settings menu)
  isSmallScreen = signal(false);
  private mediaQueryList: MediaQueryList | null = null;

  // Video state signals (updated via event listeners)
  paused = signal(true);
  hasPlayedOnce = signal(false); // Track if video has been played at least once
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
  formattedSeekPreview = computed(() => {
    const time = this.seekPreviewTime();
    return time !== null ? this.formatTime(time) : '';
  });

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
    // Initialize small screen detection
    if (this.isBrowser) {
      this.mediaQueryList = window.matchMedia('(max-width: 600px)');
      this.isSmallScreen.set(this.mediaQueryList.matches);
      this.mediaQueryList.addEventListener('change', this.onMediaQueryChange);
    }

    // Watch for video element changes and attach event listeners
    effect(() => {
      const video = this.videoElement();
      console.log('[VideoControls] videoElement changed:', !!video, video?.src);
      this.cleanupVideoListeners();
      this.hasPlayedOnce.set(false); // Reset when video element changes

      if (video) {
        this.attachVideoListeners(video);
        // Initialize state from video
        this.updateStateFromVideo(video);
      }
    });

    // Emit controls visibility changes to parent
    effect(() => {
      const visible = this.controlsVisible();
      this.controlsVisibilityChange.emit(visible);
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
    if (this.touchInteractionTimeout) {
      clearTimeout(this.touchInteractionTimeout);
    }
    // Clean up progress touch listeners
    document.removeEventListener('touchmove', this.boundProgressTouchMove);
    document.removeEventListener('touchend', this.boundProgressTouchEnd);
    document.removeEventListener('touchcancel', this.boundProgressTouchEnd);
    // Clean up media query listener
    this.mediaQueryList?.removeEventListener('change', this.onMediaQueryChange);
  }

  private onMediaQueryChange = (e: MediaQueryListEvent) => {
    this.isSmallScreen.set(e.matches);
  };

  private attachVideoListeners(video: HTMLVideoElement): void {
    const onPlay = () => {
      this.paused.set(false);
      this.hasPlayedOnce.set(true);
    };
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
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    this.isHovering.set(true);
    this.showControls();
  }

  onMouseLeave(): void {
    // In native fullscreen, don't track hovering - let parent handle it
    if (this.nativeFullscreen()) return;
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    this.isHovering.set(false);
    // Immediately hide controls when mouse leaves (no delay)
    if (!this.paused()) {
      this.clearAutoHideTimer();
      this.controlsVisible.set(false);
    }
  }

  onMouseMove(): void {
    // In native fullscreen, let parent handle mouse events
    if (this.nativeFullscreen()) return;
    // Ignore synthetic mouse events that follow touch events
    if (this.lastInteractionWasTouch) return;
    this.showControls();
    if (!this.isHovering() && !this.paused()) {
      this.startAutoHideTimer();
    }
  }

  /** Called on touch devices when user taps the controls area */
  onTouchStart(event: TouchEvent): void {
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

    // In native fullscreen, let parent handle touch events
    if (this.nativeFullscreen()) return;

    // Reset hover state since we're on a touch device
    this.isHovering.set(false);
    // Show controls and start auto-hide timer on touch
    this.showControlsAndStartTimer();
  }

  /** Called when clicking on the overlay (not on controls) to toggle play/pause */
  onOverlayClick(event: MouseEvent): void {
    // Don't toggle if click was on controls-bar or center play button (they stop propagation)
    // This method is only reached when clicking on the overlay area
    this.playPause.emit();
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

  // Handle center play button click - start auto-hide timer after playing
  onCenterPlayButtonClick(): void {
    this.playPause.emit();
    // Start auto-hide timer immediately after clicking play
    this.startAutoHideTimer();
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

  // Volume gesture change (from press-and-hold swipe on touch devices)
  onVolumeGestureChange(volume: number): void {
    // Volume from gesture is 0-100, emit as 0-1
    this.volumeChange.emit(volume / 100);
  }

  showVolumeSlider(): void {
    this.volumeSliderVisible.set(true);
  }

  hideVolumeSlider(): void {
    this.volumeSliderVisible.set(false);
  }

  // Reference to progress bar element for touch handling
  private progressBarElement: HTMLElement | null = null;

  // Seeking
  onProgressClick(event: MouseEvent): void {
    const progressBar = event.currentTarget as HTMLElement;
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = percent * this.duration();
    this.seek.emit(time);
  }

  onProgressMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.isSeeking.set(true);
    this.progressBarElement = event.currentTarget as HTMLElement;
    this.updateSeekPreview(event.clientX);
    this.onProgressClick(event);

    const onMouseMove = (e: MouseEvent) => {
      this.updateSeekPreview(e.clientX);
      this.seekFromClientX(e.clientX);
    };

    const onMouseUp = () => {
      this.isSeeking.set(false);
      this.isShowingSeekPreview.set(false);
      this.seekPreviewTime.set(null);
      this.progressBarElement = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Touch handlers for mobile progress bar interaction
  onProgressTouchStart(event: TouchEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isSeeking.set(true);
    this.progressBarElement = event.currentTarget as HTMLElement;

    const touch = event.touches[0];
    this.updateSeekPreview(touch.clientX);
    this.seekFromClientX(touch.clientX);

    // Add document-level touch handlers for tracking outside the element
    document.addEventListener('touchmove', this.boundProgressTouchMove, { passive: false });
    document.addEventListener('touchend', this.boundProgressTouchEnd);
    document.addEventListener('touchcancel', this.boundProgressTouchEnd);
  }

  private boundProgressTouchMove = (event: TouchEvent) => this.onProgressTouchMove(event);
  private boundProgressTouchEnd = () => this.onProgressTouchEnd();

  private onProgressTouchMove(event: TouchEvent): void {
    if (!this.isSeeking() || !this.progressBarElement) return;
    event.preventDefault();
    const touch = event.touches[0];
    this.updateSeekPreview(touch.clientX);
    this.seekFromClientX(touch.clientX);
  }

  private onProgressTouchEnd(): void {
    this.isSeeking.set(false);
    this.isShowingSeekPreview.set(false);
    this.seekPreviewTime.set(null);
    this.progressBarElement = null;
    document.removeEventListener('touchmove', this.boundProgressTouchMove);
    document.removeEventListener('touchend', this.boundProgressTouchEnd);
    document.removeEventListener('touchcancel', this.boundProgressTouchEnd);
  }

  // Helper to update seek preview from clientX position
  private updateSeekPreview(clientX: number): void {
    if (!this.progressBarElement) return;
    const rect = this.progressBarElement.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = percent * this.duration();
    this.seekPreviewPercent.set(percent * 100);
    this.seekPreviewTime.set(time);
    this.isShowingSeekPreview.set(true);
  }

  // Helper to seek from clientX position
  private seekFromClientX(clientX: number): void {
    if (!this.progressBarElement) return;
    const rect = this.progressBarElement.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = percent * this.duration();
    this.seek.emit(time);
  }

  // Show seek preview on hover (mouse only)
  onProgressMouseMove(event: MouseEvent): void {
    if (this.isSeeking()) return; // Don't update hover preview while seeking
    const progressBar = event.currentTarget as HTMLElement;
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = percent * this.duration();
    this.seekPreviewPercent.set(percent * 100);
    this.seekPreviewTime.set(time);
    this.isShowingSeekPreview.set(true);
  }

  onProgressMouseLeave(): void {
    if (!this.isSeeking()) {
      this.isShowingSeekPreview.set(false);
      this.seekPreviewTime.set(null);
    }
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
