import { Injectable, signal, inject, effect } from '@angular/core';
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

  constructor() {
    // Watch for changes in playing video and manage wake lock accordingly
    effect(() => {
      const video = this.currentlyPlayingVideo();
      
      if (video && !video.paused) {
        // Video is playing, enable wake lock
        this.wakeLockService.enable();
      } else {
        // No video playing or video is paused, disable wake lock
        this.wakeLockService.disable();
      }
    });
  }

  /**
   * Register a video element as currently playing.
   * This will pause any previously playing video.
   * @param videoElement The video element that is starting to play
   */
  registerPlaying(videoElement: HTMLVideoElement): void {
    const current = this.currentlyPlayingVideo();

    // If there's a different video currently playing, pause it
    if (current && current !== videoElement) {
      current.pause();
    }

    this.currentlyPlayingVideo.set(videoElement);
  }

  /**
   * Unregister a video element when it stops playing or is destroyed.
   * @param videoElement The video element to unregister
   */
  unregisterPlaying(videoElement: HTMLVideoElement): void {
    if (this.currentlyPlayingVideo() === videoElement) {
      this.currentlyPlayingVideo.set(null);
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
    }
  }
}
