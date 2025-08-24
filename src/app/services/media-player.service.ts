import { effect, inject, Injectable, signal, computed } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MediaItem, OnInitialized } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';

export interface VideoWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isMaximized: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class MediaPlayerService implements OnInitialized {
  private sanitizer = inject(DomSanitizer);
  utilities = inject(UtilitiesService);
  localStorage = inject(LocalStorageService);
  layout = inject(LayoutService);
  app = inject(ApplicationService);
  media = signal<MediaItem[]>([]);
  audio?: HTMLAudioElement;
  current?: MediaItem;
  index = 0;
  readonly MEDIA_STORAGE_KEY = 'nostria-media-queue';

  // Cache for YouTube embed URLs
  private _youtubeUrlCache = new Map<string, SafeResourceUrl>();
  readonly WINDOW_STATE_STORAGE_KEY = 'nostria-video-window-state';

  // Video window state
  videoWindowState = signal<VideoWindowState>({
    x: 100,
    y: 100,
    width: 560,
    height: 315,
    isMinimized: false,
    isMaximized: false,
  });

  // minimized = false;
  // previousWidth = 800;
  // previousHeight = 600;

  // Convert to computed signals
  canPrevious = computed(() => this.index > 0);
  canNext = computed(() => this.index < this.media().length - 1);

  // Convert to signals
  youtubeUrl = signal<SafeResourceUrl | undefined>(undefined);
  videoUrl = signal<SafeResourceUrl | undefined>(undefined);
  videoMode = signal(false);
  pausedYouTubeUrl = signal<SafeResourceUrl | undefined>(undefined);

  // Video element reference
  private videoElement?: HTMLVideoElement;

  private _isFullscreen = signal(false);

  isFullscreen = this._isFullscreen.asReadonly();

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    effect(() => {
      if (this.app.initialized()) {
        this.initialize();
      }
    });

    navigator.mediaSession.setActionHandler('play', async () => {
      if (!this.audio) {
        return;
      }

      // Resume playback
      try {
        await this.audio.play();
      } catch (err: any) {
        console.error(err.name, err.message);
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (!this.audio) {
        return;
      }

      // Pause active playback
      this.audio.pause();
    });

    navigator.mediaSession.setActionHandler('seekbackward', () => {
      this.rewind(10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      this.forward(10);
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (this.canPrevious()) {
        this.previous();
      }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (this.canNext()) {
        this.next();
      }
    });
  }
  initialize(): void {
    const mediaQueue = this.localStorage.getItem(this.MEDIA_STORAGE_KEY);

    if (mediaQueue == null || mediaQueue == '' || mediaQueue === 'undefined') {
      return;
    }

    this.media.set(JSON.parse(mediaQueue) as MediaItem[]);

    // Load video window state
    const windowState = this.localStorage.getItem(this.WINDOW_STATE_STORAGE_KEY);
    if (windowState && windowState !== 'undefined') {
      this.videoWindowState.set(JSON.parse(windowState) as VideoWindowState);
    }
  }

  exit() {
    console.log('Exiting media player and hiding footer');

    // Use the centralized cleanup method
    this.cleanupCurrentMedia();

    // Clean up audio completely
    if (this.audio) {
      this.audio.removeEventListener('ended', this.handleMediaEnded);
      this.audio.pause();
      this.audio.src = '';
      this.audio = undefined;
    }

    // Clean up video element
    if (this.videoElement) {
      this.videoElement.removeEventListener('ended', this.handleMediaEnded);
      this.setVideoElement(undefined);
    }

    // Reset all state
    this.index = -1;
    this.current = undefined;
    this.videoMode.set(false);
    this.youtubeUrl.set(undefined);
    this.videoUrl.set(undefined);
    this.pausedYouTubeUrl.set(undefined);
    this._isFullscreen.set(false);

    // Clear media queue
    // this.media.set([]);

    // Hide the media player footer
    this.layout.showMediaPlayer.set(false);

    // Clear saved queue from localStorage
    this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);

    // Update media session
    navigator.mediaSession.playbackState = 'none';

    console.log('Media player completely exited and hidden');
  }

  play(file: MediaItem) {
    this.layout.showMediaPlayer.set(true);
    // this.media.set[];
    this.media.update((files) => [...files, file]);

    // this.stop();

    this.start();
  }

  enque(file: MediaItem) {
    // TODO: Clean the file.source URL!
    // this.layout.showMediaPlayer.set(true);
    this.media.update((files) => [...files, file]);
    // this.snackBar.open('Added to media queue', 'Hide', {
    //   duration: 1500,
    //   horizontalPosition: 'center',
    //   verticalPosition: 'bottom',
    // });
    this.save();
  }

  dequeue(file: MediaItem) {
    this.media.update((files) => {
      const index = files.findIndex((e) => e === file);
      if (index === -1) {
        return files;
      }
      return files.filter((_, i) => i !== index);
    });
    this.save();
  }
  async save() {
    if (this.media().length === 0) {
      this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);
      return;
    }

    this.localStorage.setItem(this.MEDIA_STORAGE_KEY, JSON.stringify(this.media()));
  }

  saveWindowState() {
    this.localStorage.setItem(
      this.WINDOW_STATE_STORAGE_KEY,
      JSON.stringify(this.videoWindowState()),
    );
  }

  updateWindowPosition(x: number, y: number) {
    this.videoWindowState.update((state) => ({ ...state, x, y }));
    this.saveWindowState();
  }

  updateWindowSize(width: number, height: number) {
    this.videoWindowState.update((state) => ({ ...state, width, height }));
    this.saveWindowState();
  }

  minimizeWindow() {
    this.videoWindowState.update((state) => ({
      ...state,
      isMinimized: !state.isMinimized,
    }));
    this.saveWindowState();
  }

  maximizeWindow() {
    this.videoWindowState.update((state) => ({
      ...state,
      isMaximized: !state.isMaximized,
      isMinimized: false,
    }));
    this.saveWindowState();
  }

  closeVideoWindow() {
    this.exit();
  }

  setVideoElement(videoElement: HTMLVideoElement | undefined) {
    console.log('setVideoElement called with:', videoElement);

    // Remove event listeners from previous video element
    if (this.videoElement) {
      this.videoElement.removeEventListener('ended', this.handleMediaEnded);
    }

    this.videoElement = videoElement;

    // Add event listeners to new video element
    if (videoElement) {
      videoElement.addEventListener('ended', this.handleMediaEnded);
      console.log('Video element registered for current video');
    }
  }

  private handleMediaEnded = () => {
    console.log('Media ended, checking for next item');
    if (this.canNext()) {
      console.log('Auto-advancing to next media item');
      this.next();
    } else {
      console.log('No next media item available, stopping playback');
      navigator.mediaSession.playbackState = 'none';
    }
  };

  getYouTubeEmbedUrl = computed(() => {
    // Return a function that caches YouTube embed URLs
    return (url: string, query?: string): SafeResourceUrl => {
      console.log('getYouTubeEmbedUrl called with:', url, 'and query:', query);

      // Create cache key including query parameter
      const cacheKey = query ? `${url}?${query}` : url;

      // Check if we already have this URL cached
      if (this._youtubeUrlCache.has(cacheKey)) {
        console.log('Returning cached YouTube embed URL for:', cacheKey);
        return this._youtubeUrlCache.get(cacheKey)!;
      }

      const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
      const match = url.match(regex);

      let embedUrl: SafeResourceUrl;

      if (match && match[1]) {
        const baseEmbedUrl = `https://www.youtube.com/embed/${match[1]}?enablejsapi=1`;
        const finalUrl = query ? `${baseEmbedUrl}&${query}` : baseEmbedUrl;
        embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(finalUrl);
      } else {
        embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl('');
      }

      // Cache the result
      this._youtubeUrlCache.set(cacheKey, embedUrl);
      console.log('Cached YouTube embed URL for:', cacheKey);

      return embedUrl;
    };
  });

  async start() {
    if (this.index === -1) {
      this.index = 0;
    }

    const file = this.media()[this.index];

    if (!file) {
      return;
    }

    // Clean up previous media before starting new one
    this.cleanupCurrentMedia();

    this.current = file;

    this.layout.showMediaPlayer.set(true);
    if (file.type === 'YouTube') {
      this.videoMode.set(true);
      this.videoUrl.set(undefined);
      const youTubeUrl = this.getYouTubeEmbedUrl()(file.source, 'autoplay=1');
      this.youtubeUrl.set(youTubeUrl);
    } else if (file.type === 'Video') {
      this.videoMode.set(true);
      this.youtubeUrl.set(undefined);

      console.log('Starting video, videoElement available:', !!this.videoElement);

      // Set the new video URL first
      this.videoUrl.set(this.utilities.sanitizeUrlAndBypassFrame(file.source));

      // If video element is available, handle playback
      if (this.videoElement) {
        try {
          // Add ended event listener
          this.videoElement.addEventListener('ended', this.handleMediaEnded);

          // Add event listeners for when video is ready
          const handleCanPlay = async () => {
            if (this.videoElement) {
              try {
                await this.videoElement.play();
                console.log('Video started playing');
              } catch (error) {
                console.error('Error playing video:', error);
              }
            }
            this.videoElement?.removeEventListener('canplay', handleCanPlay);
          };

          this.videoElement.addEventListener('canplay', handleCanPlay, {
            once: true,
          });
        } catch (error) {
          console.error('Error setting up video:', error);
        }
      } else {
        console.warn('Video element not available for video playback');
      }
    } else {
      this.videoMode.set(false);
      this.youtubeUrl.set(undefined);
      this.videoUrl.set(undefined);

      // Remove event listeners from previous audio element
      if (this.audio) {
        this.audio.removeEventListener('ended', this.handleMediaEnded);
      }

      if (!this.audio) {
        this.audio = new Audio(file.source);
      } else {
        this.audio.src = file.source;
      }

      // Add ended event listener to audio
      this.audio.addEventListener('ended', this.handleMediaEnded);

      await this.audio.play();
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: file.title,
      artist: file.artist,
      album: 'Nostria',
      artwork: [{ src: file.artwork }],
    });

    navigator.mediaSession.playbackState = 'playing';
  }

  private cleanupCurrentMedia() {
    // Stop and cleanup audio
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      // Remove event listeners
      this.audio.removeEventListener('ended', this.handleMediaEnded);
      this.audio.removeEventListener('canplay', () => {});
      this.audio.removeEventListener('loadeddata', () => {});
    }

    // Stop and cleanup video
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
      // Remove event listeners
      this.videoElement.removeEventListener('ended', this.handleMediaEnded);
      this.videoElement.removeEventListener('canplay', () => {});
      this.videoElement.removeEventListener('loadeddata', () => {});
    }

    // Clear video URLs to stop any playing videos
    if (this.videoMode()) {
      this.pausedYouTubeUrl.set(undefined);
    }
  }

  async resume() {
    if (this.videoMode()) {
      if (this.current?.type === 'Video' && this.videoElement) {
        try {
          await this.videoElement.play();
        } catch (err) {
          console.error('Error resuming video:', err);
        }
      } else {
        this.youtubeUrl.set(this.pausedYouTubeUrl());
        this.pausedYouTubeUrl.set(undefined);
      }
    } else {
      if (!this.audio) {
        this.start();
        return;
      }

      console.log('RESUME!');
      try {
        await this.audio.play();
      } catch (err) {
        console.error(err);
      }
    }

    navigator.mediaSession.playbackState = 'playing';
  }

  pause() {
    if (this.videoMode()) {
      if (this.current?.type === 'Video' && this.videoElement) {
        this.videoElement.pause();
      } else {
        this.pausedYouTubeUrl.set(this.youtubeUrl());
        this.youtubeUrl.set(undefined);
      }
    } else {
      if (!this.audio) {
        return;
      }

      this.audio.pause();
    }

    navigator.mediaSession.playbackState = 'paused';
  }

  async pictureInPicture(): Promise<void> {
    try {
      // Find the current video element
      const videoElement = this.getCurrentVideoElement();

      if (!videoElement) {
        console.warn('No video element found for Picture-in-Picture');
        return;
      }

      // Check if Picture-in-Picture is supported
      if (!document.pictureInPictureEnabled) {
        console.warn('Picture-in-Picture is not supported in this browser');
        return;
      }

      // Check if video supports Picture-in-Picture
      if (videoElement.disablePictureInPicture) {
        console.warn('Picture-in-Picture is disabled for this video');
        return;
      }

      // Toggle Picture-in-Picture mode
      if (document.pictureInPictureElement) {
        // Exit Picture-in-Picture if currently active
        await document.exitPictureInPicture();
        console.debug('Exited Picture-in-Picture mode');
      } else {
        // Enter Picture-in-Picture mode
        await videoElement.requestPictureInPicture();
        console.debug('Entered Picture-in-Picture mode');
      }
    } catch (error) {
      console.error('Picture-in-Picture error:', error);
    }
  }

  fullscreen(): void {
    this._isFullscreen.set(true);
  }

  exitFullscreen(): void {
    this._isFullscreen.set(false);
  }

  private getCurrentVideoElement(): HTMLVideoElement | null {
    // Return the video element reference if available
    if (this.videoElement) {
      return this.videoElement;
    }

    // Try to find video element in the footer media player
    const footerVideo = document.querySelector('.media-player-footer video') as HTMLVideoElement;
    if (footerVideo) {
      return footerVideo;
    }

    // Try to find video element in the video window
    const windowVideo = document.querySelector('.video-window video') as HTMLVideoElement;
    if (windowVideo) {
      return windowVideo;
    }

    // Try to find any video element on the page
    const anyVideo = document.querySelector('video') as HTMLVideoElement;
    if (anyVideo) {
      return anyVideo;
    }

    return null;
  }

  next() {
    this.index++;
    this.start();
  }

  previous() {
    this.index--;
    this.start();
  }

  get error() {
    return this.audio?.error;
  }

  get paused() {
    if (this.videoMode()) {
      if (this.current?.type === 'Video' && this.videoElement) {
        return this.videoElement.paused;
      } else {
        return this.youtubeUrl() == null;
      }
    } else {
      if (!this.audio) {
        return true;
      }

      return this.audio.paused;
    }
  }

  get muted() {
    if (!this.audio) {
      return false;
    }

    return this.audio.muted;
  }

  get time() {
    if (!this.audio) {
      return 10;
    }

    return Math.floor(this.audio.currentTime);
  }

  set time(value) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime = value;
  }

  get duration() {
    if (!this.audio) {
      return 100;
    }

    return Math.floor(this.audio.duration);
  }

  mute() {
    if (!this.audio) {
      return;
    }

    this.audio.muted = !this.audio.muted;
  }

  forward(value: number) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime += value;
  }

  rewind(value: number) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime -= value;
  }

  rate() {
    if (!this.audio) {
      return;
    }

    console.log(this.audio.playbackRate);

    if (this.audio.playbackRate == 2.0) {
      this.audio.playbackRate = 1.0;
    } else {
      this.audio.playbackRate = 2.0;
    }
  }

  clearQueue() {
    console.log('Clearing entire media queue');

    // Stop current playback
    this.cleanupCurrentMedia();

    // Reset audio
    if (this.audio) {
      this.audio.removeEventListener('ended', this.handleMediaEnded);
      this.audio.pause();
      this.audio.src = '';
      this.audio = undefined;
    }

    // Reset video element
    if (this.videoElement) {
      this.videoElement.removeEventListener('ended', this.handleMediaEnded);
      this.setVideoElement(undefined);
    }

    // Reset all state
    this.index = -1;
    this.current = undefined;
    this.videoMode.set(false);
    this.youtubeUrl.set(undefined);
    this.videoUrl.set(undefined);
    this.pausedYouTubeUrl.set(undefined);
    this._isFullscreen.set(false);

    // Clear media queue
    this.media.set([]);

    // Hide the media player
    this.layout.showMediaPlayer.set(false);

    // Clear saved queue from localStorage
    this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);

    // Update media session
    navigator.mediaSession.playbackState = 'none';

    console.log('Media queue completely cleared');
  }

  /**
   * Clear the YouTube URL cache (useful for memory management)
   */
  clearYouTubeUrlCache(): void {
    this._youtubeUrlCache.clear();
    console.log('YouTube URL cache cleared');
  }
}
