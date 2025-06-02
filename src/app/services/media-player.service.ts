import { effect, inject, Injectable, signal, computed } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';
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
  utilities = inject(UtilitiesService);
  localStorage = inject(LocalStorageService);
  layout = inject(LayoutService);
  app = inject(ApplicationService); media = signal<MediaItem[]>([]);
  audio?: HTMLAudioElement;
  current?: MediaItem;
  index = 0;
  readonly MEDIA_STORAGE_KEY = 'nostria-media-queue';
  readonly WINDOW_STATE_STORAGE_KEY = 'nostria-video-window-state';

  // Video window state
  videoWindowState = signal<VideoWindowState>({
    x: 100,
    y: 100,
    width: 560,
    height: 315,
    isMinimized: false,
    isMaximized: false
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

  constructor() {
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
    let mediaQueue = this.localStorage.getItem(this.MEDIA_STORAGE_KEY);

    if (mediaQueue == null || mediaQueue == '' || mediaQueue === 'undefined') {
      return
    }

    this.media.set(JSON.parse(mediaQueue) as MediaItem[]);

    // Load video window state
    const windowState = this.localStorage.getItem(this.WINDOW_STATE_STORAGE_KEY);
    if (windowState && windowState !== 'undefined') {
      this.videoWindowState.set(JSON.parse(windowState) as VideoWindowState);
    }
  }

  exit() {
    // Use the centralized cleanup method
    this.cleanupCurrentMedia();

    if (this.audio) {
      this.audio = undefined;
    }

    this.index = -1;
    this.current = undefined;
    this.layout.showMediaPlayer.set(false);
    this.media.set([]);
    this.videoMode.set(false);
  }

  play(file: MediaItem) {
    this.layout.showMediaPlayer.set(true);
    // this.media.set[];
    this.media.update(files => [...files, file]);

    // this.stop();

    this.start();
  }

  enque(file: MediaItem) {
    // TODO: Clean the file.source URL!
    this.layout.showMediaPlayer.set(true);
    this.media.update(files => [...files, file]);
    // this.snackBar.open('Added to media queue', 'Hide', {
    //   duration: 1500,
    //   horizontalPosition: 'center',
    //   verticalPosition: 'bottom',
    // });
    this.save()
  }

  dequeue(file: MediaItem) {
    this.media.update(files => {
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
    this.localStorage.setItem(this.WINDOW_STATE_STORAGE_KEY, JSON.stringify(this.videoWindowState()));
  }

  updateWindowPosition(x: number, y: number) {
    this.videoWindowState.update(state => ({ ...state, x, y }));
    this.saveWindowState();
  }

  updateWindowSize(width: number, height: number) {
    this.videoWindowState.update(state => ({ ...state, width, height }));
    this.saveWindowState();
  }

  minimizeWindow() {
    this.videoWindowState.update(state => ({ ...state, isMinimized: !state.isMinimized }));
    this.saveWindowState();
  }

  maximizeWindow() {
    this.videoWindowState.update(state => ({
      ...state,
      isMaximized: !state.isMaximized,
      isMinimized: false
    }));
    this.saveWindowState();
  }

  closeVideoWindow() {
    this.exit();
  }

  setVideoElement(videoElement: HTMLVideoElement | undefined) {
    this.videoElement = videoElement;
  }

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
      this.videoUrl.set(undefined); // Clear any previous video URL
      this.youtubeUrl.set(this.utilities.sanitizeUrlAndBypassFrame(file.source + '?autoplay=1'));
    } else if (file.type === 'Video') {
      this.videoMode.set(true);

      if (this.videoElement) {
        this.videoElement.pause(); // Stop the current video
      }

      this.youtubeUrl.set(undefined); // Clear any previous YouTube URL
      this.videoUrl.set(this.utilities.sanitizeUrlAndBypassFrame(file.source));

      if (this.videoElement) {
        this.videoElement.load(); // Reload the video
        this.videoElement.play(); // Start playing the new video
      }
    } else {
      this.videoMode.set(false);
      // Clear video URLs when switching to audio
      this.youtubeUrl.set(undefined);
      this.videoUrl.set(undefined);

      if (!this.audio) {
        this.audio = new Audio(file.source);
      } else {
        this.audio.src = file.source;
      }

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
    }

    // Stop and cleanup video
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
    }

    // Clear video URLs to stop any playing videos
    if (this.videoMode()) {
      this.youtubeUrl.set(undefined);
      this.videoUrl.set(undefined);
      this.pausedYouTubeUrl.set(undefined);
    }
  }

  async resume() {
    if (this.videoMode()) {
      if (this.current?.type === 'Video' && this.videoElement) {
        try {
          await this.videoElement.play();
        } catch (err) {
          console.error(err);
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

  isFullscreen = signal(false);

  async fullscreen() {
    this.isFullscreen.set(true);
  }

  async fullscreen2(): Promise<void> {
    // try {
    //   // For video content, we'll use the video window approach
    //   if (this.current?.type === 'Video' || this.current?.type === 'YouTube') {
    //     // Open video in window mode and maximize it
    //     // this.openVideoWindow();

    //     // Wait a frame for the window to be created
    //     await new Promise(resolve => requestAnimationFrame(resolve));

    //     // Maximize the video window
    //     this.maximizeWindow();
    //     console.debug('Video opened in fullscreen window mode');
    //     return;
    //   }

    //   // Fallback: try to find and fullscreen the video element directly
    //   const videoElement = this.getCurrentVideoElement();

    //   if (!videoElement) {
    //     console.warn('No video element found for fullscreen');
    //     return;
    //   }

    //   // Check if fullscreen is supported
    //   if (!document.fullscreenEnabled) {
    //     console.warn('Fullscreen is not supported in this browser');
    //     return;
    //   }

    //   // Toggle fullscreen mode
    //   if (document.fullscreenElement) {
    //     // Exit fullscreen if currently active
    //     await document.exitFullscreen();
    //     console.debug('Exited fullscreen mode');
    //   } else {
    //     // Enter fullscreen mode
    //     await videoElement.requestFullscreen();
    //     console.debug('Entered fullscreen mode');
    //   }
    // } catch (error) {
    //   console.error('Fullscreen error:', error);
    // }
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
    debugger;
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
      return this.youtubeUrl() == null;
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
}
