import { Injectable, signal, inject } from '@angular/core';
import { WakeLockService } from './wake-lock.service';

/**
 * Service to manage inline video playback across the application.
 * Ensures only one video plays at a time - when a new video starts,
 * the previously playing video is paused.
 * 
 * Also manages screen wake lock to prevent screen from dimming/locking
 * while videos are playing.
 */
@Injectable({
  providedIn: 'root',
})
export class VideoPlaybackService {
  private wakeLockService = inject(WakeLockService);

  // The currently playing video element
  private currentlyPlayingVideo = signal<HTMLVideoElement | null>(null);

  /**
   * Register a video element as currently playing.
   * This will pause any previously playing video and enable wake lock.
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
}
