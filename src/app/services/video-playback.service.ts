import { Injectable, signal, inject, computed, effect } from '@angular/core';
import { WakeLockService } from './wake-lock.service';
import { AccountLocalStateService } from './account-local-state.service';
import { AccountStateService } from './account-state.service';
import { PanelNavigationService } from './panel-navigation.service';

/**
 * Service to manage inline video playback across the application.
 * Ensures only one video plays at a time - when a new video starts,
 * the previously playing video is paused.
 * 
 * Also manages screen wake lock to prevent screen from dimming/locking
 * while videos are playing.
 * 
 * Additionally manages mute state persistence - when user mutes/unmutes
 * a video, the preference is remembered for all subsequent videos.
 */
@Injectable({
  providedIn: 'root',
})
export class VideoPlaybackService {
  private wakeLockService = inject(WakeLockService);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);
  private panelNav = inject(PanelNavigationService);

  // The currently playing video element
  private currentlyPlayingVideo = signal<HTMLVideoElement | null>(null);
  
  // Mute state signal - reactive for components to subscribe to
  // Default to true (muted) because browser autoplay requires muted videos
  private _isMuted = signal(true);
  
  // Computed signal that components can read
  readonly isMuted = this._isMuted.asReadonly();
  
  /**
   * Whether auto-play is allowed based on current app state.
   * This specifically prevents videos in the Feeds panel from auto-playing
   * when Feeds is not visible (e.g., when viewing a profile).
   * The IntersectionObserver in the video component handles viewport visibility,
   * but we need this check because Feeds is always rendered in the background.
   */
  readonly autoPlayAllowed = computed(() => {
    // If feeds panel is visible, allow auto-play there
    if (this.panelNav.showFeeds()) {
      return true;
    }
    // Feeds is NOT visible - videos in feeds should not auto-play
    // Return false so the effect in inline-video-player checks this
    // Videos in other panels (profile, etc.) will still auto-play
    // because they're rendered via router-outlet, not the feeds panel
    return false;
  });

  constructor() {
    // Initialize mute state from persisted value
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const persistedMuted = this.accountLocalState.getVolumeMuted(pubkey);
        this._isMuted.set(persistedMuted);
      }
    }, { allowSignalWrites: true });
  }

  /**
   * Register a video element as currently playing.
   * This will pause any previously playing video and enable wake lock.
   * Also applies the persisted mute state to the video.
   * @param videoElement The video element that is starting to play
   */
  registerPlaying(videoElement: HTMLVideoElement): void {
    const current = this.currentlyPlayingVideo();

    // If there's a different video currently playing, pause it
    if (current && current !== videoElement) {
      current.pause();
    }

    this.currentlyPlayingVideo.set(videoElement);

    // Enable wake lock when video starts playing
    this.wakeLockService.enable();
  }

  /**
   * Unregister a video element when it stops playing or is destroyed.
   * This will disable wake lock if no other video is playing.
   * @param videoElement The video element to unregister
   */
  unregisterPlaying(videoElement: HTMLVideoElement): void {
    if (this.currentlyPlayingVideo() === videoElement) {
      this.currentlyPlayingVideo.set(null);

      // Disable wake lock when video stops playing
      this.wakeLockService.disable();
    }
  }

  /**
   * Pause the currently playing video (if any).
   */
  pauseCurrentVideo(): void {
    const current = this.currentlyPlayingVideo();
    if (current) {
      current.pause();
      this.currentlyPlayingVideo.set(null);

      // Disable wake lock when video is paused
      this.wakeLockService.disable();
    }
  }

  /**
   * Set the mute state and persist it for the current account.
   * This will be applied to all videos.
   * @param muted Whether videos should be muted
   */
  setMuted(muted: boolean): void {
    this._isMuted.set(muted);
    
    // Persist to account state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setVolumeMuted(pubkey, muted);
    }
  }

  /**
   * Toggle the mute state and persist it.
   * @returns The new mute state
   */
  toggleMuted(): boolean {
    const newState = !this._isMuted();
    this.setMuted(newState);
    return newState;
  }

  /**
   * Get the persisted mute state for initializing video elements.
   * Components should use the isMuted signal for reactive updates.
   */
  getMutedState(): boolean {
    return this._isMuted();
  }
}
