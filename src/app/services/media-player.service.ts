import { effect, inject, Injectable, signal, computed } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MediaItem, OnInitialized, Playlist, PodcastProgress } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';
import { WakeLockService } from './wake-lock.service';
import { OfflineMusicService } from './offline-music.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';

// YouTube Player API types
interface YouTubePlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
}

interface YouTubePlayerEvent {
  data: number;
}

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
  private router = inject(Router);
  utilities = inject(UtilitiesService);
  localStorage = inject(LocalStorageService);
  layout = inject(LayoutService);
  app = inject(ApplicationService);
  private wakeLockService = inject(WakeLockService);
  private offlineMusicService = inject(OfflineMusicService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  media = signal<MediaItem[]>([]);
  audio?: HTMLAudioElement;
  current = signal<MediaItem | undefined>(undefined);
  // Cache podcast positions to avoid excessive localStorage reads
  private podcastPositions = signal<Record<string, PodcastProgress>>({});
  // make index a signal-backed property so computed signals can react to changes
  private _index = signal<number>(0);
  get index(): number {
    return this._index();
  }
  set index(v: number) {
    this._index.set(v);
  }
  readonly MEDIA_STORAGE_KEY = 'nostria-media-queue';
  readonly PODCAST_POSITIONS_KEY = 'nostria-podcast-positions';

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

  // Convert to computed signals - consider shuffle and repeat states
  canPrevious = computed(() => {
    // If shuffle or repeat is enabled, always allow navigation
    if (this.shuffle() || this.repeat() !== 'off') {
      return this.media().length > 0;
    }
    return this._index() > 0;
  });
  canNext = computed(() => {
    // If shuffle or repeat is enabled, always allow navigation
    if (this.shuffle() || this.repeat() !== 'off') {
      return this.media().length > 0;
    }
    return this._index() < this.media().length - 1;
  });
  // Signal that indicates whether there are any items in the media queue
  hasQueue = computed(() => this.media().length > 0);

  // Shuffle and Repeat state
  shuffle = signal(false);
  repeat = signal<'off' | 'all' | 'one'>('off');

  // Convert to signals
  youtubeUrl = signal<SafeResourceUrl | undefined>(undefined);
  videoUrl = signal<SafeResourceUrl | undefined>(undefined);
  videoMode = signal(false);
  pausedYouTubeUrl = signal<SafeResourceUrl | undefined>(undefined);
  playbackRate = signal(1.0);

  // Signals for time and duration
  currentTimeSig = signal(0);
  durationSig = signal(0);

  // Signal for paused state - updated by play/pause actions and video element events
  private _isPaused = signal(true);

  // Video element reference
  private videoElement?: HTMLVideoElement;

  // HLS instance for live streaming
  private hlsInstance?: any;

  // HLS Quality levels
  hlsQualityLevels = signal<{ index: number; label: string; height?: number; bitrate?: number }[]>([]);
  hlsCurrentQuality = signal<number>(-1); // -1 = auto

  // Flag to track if video/HLS playback has been initialized for current item
  private videoPlaybackInitialized = false;

  private _isFullscreen = signal(false);

  isFullscreen = this._isFullscreen.asReadonly();

  // YouTube Player API reference
  private youtubePlayer?: YouTubePlayer;
  private youtubeApiReady = false;

  // Throttling for podcast position saves
  private lastPodcastPositionSave = 0;
  private readonly PODCAST_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private readonly POSITION_SAFETY_MARGIN_SECONDS = 2; // Buffer before end of media

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    // Load YouTube IFrame API
    this.loadYouTubeAPI();

    effect(() => {
      if (this.app.initialized()) {
        this.initialize();
      }
    });

    navigator.mediaSession.setActionHandler('play', async () => {
      // Use the centralized resume method
      await this.resume();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      // Use the centralized pause method
      this.pause();
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
    const pubkey = this.accountState.pubkey();

    // Load media queue
    const mediaQueueJson = this.localStorage.getItem(this.MEDIA_STORAGE_KEY);
    if (mediaQueueJson && mediaQueueJson !== '' && mediaQueueJson !== 'undefined') {
      try {
        const parsed = JSON.parse(mediaQueueJson);

        // Check if it's the old format (array) or new format (Record<pubkey, MediaItem[]>)
        if (Array.isArray(parsed)) {
          // Old format: migrate to new format
          console.log('Migrating media queue from old format to new pubkey-keyed format');
          const allQueues: Record<string, MediaItem[]> = {};
          if (pubkey && parsed.length > 0) {
            allQueues[pubkey] = parsed;
          }
          this.localStorage.setItem(this.MEDIA_STORAGE_KEY, JSON.stringify(allQueues));
          this.media.set(pubkey ? (allQueues[pubkey] || []) : []);
        } else {
          // New format: Record<pubkey, MediaItem[]>
          const allQueues = parsed as Record<string, MediaItem[]>;
          this.media.set(pubkey ? (allQueues[pubkey] || []) : []);
        }
      } catch {
        this.media.set([]);
      }
    }

    // Load podcast positions cache
    const positionsJson = this.localStorage.getItem(this.PODCAST_POSITIONS_KEY);
    if (positionsJson && positionsJson !== 'undefined') {
      try {
        const parsed = JSON.parse(positionsJson);

        // Check if it's the old format (flat Record<url, PodcastProgress>) or new format (Record<pubkey, Record<url, PodcastProgress>>)
        // Old format has string keys that look like URLs, new format has pubkey keys
        const firstKey = Object.keys(parsed)[0];
        const isOldFormat = firstKey && (firstKey.startsWith('http') || firstKey.startsWith('/'));

        if (isOldFormat) {
          // Old format: migrate to new format
          console.log('Migrating podcast positions from old format to new pubkey-keyed format');
          const allPositions: Record<string, Record<string, PodcastProgress>> = {};
          if (pubkey) {
            allPositions[pubkey] = parsed as Record<string, PodcastProgress>;
          }
          this.localStorage.setItem(this.PODCAST_POSITIONS_KEY, JSON.stringify(allPositions));
          this.podcastPositions.set(pubkey ? (allPositions[pubkey] || {}) : {});
        } else {
          // New format: Record<pubkey, Record<url, PodcastProgress>>
          const allPositions = parsed as Record<string, Record<string, PodcastProgress>>;
          this.podcastPositions.set(pubkey ? (allPositions[pubkey] || {}) : {});
        }
      } catch {
        this.podcastPositions.set({});
      }
    }

    // Load video window state (per-account UI preference for floating video player position/size)
    const windowStateJson = this.localStorage.getItem(this.WINDOW_STATE_STORAGE_KEY);
    if (windowStateJson && windowStateJson !== 'undefined') {
      try {
        const parsed = JSON.parse(windowStateJson);

        // Check if it's the old format (VideoWindowState directly) or new format (Record<pubkey, VideoWindowState>)
        // Old format has x, y, width, height properties directly
        if ('x' in parsed && 'y' in parsed && 'width' in parsed) {
          // Old format: migrate to new format
          console.log('Migrating video window state from old format to new pubkey-keyed format');
          const allStates: Record<string, VideoWindowState> = {};
          if (pubkey) {
            allStates[pubkey] = parsed as VideoWindowState;
          }
          this.localStorage.setItem(this.WINDOW_STATE_STORAGE_KEY, JSON.stringify(allStates));
          this.videoWindowState.set(pubkey ? (allStates[pubkey] || this.getDefaultWindowState()) : this.getDefaultWindowState());
        } else {
          // New format: Record<pubkey, VideoWindowState>
          const allStates = parsed as Record<string, VideoWindowState>;
          this.videoWindowState.set(pubkey ? (allStates[pubkey] || this.getDefaultWindowState()) : this.getDefaultWindowState());
        }
      } catch {
        this.videoWindowState.set(this.getDefaultWindowState());
      }
    }
  }

  private getDefaultWindowState(): VideoWindowState {
    return {
      x: 100,
      y: 100,
      width: 560,
      height: 315,
      isMinimized: false,
      isMaximized: false,
    };
  }

  private loadYouTubeAPI(): void {
    // Check if API is already loaded
    if ((window as unknown as { YT?: unknown }).YT) {
      this.youtubeApiReady = true;
      return;
    }

    // Create script tag to load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Set up callback for when API is ready
    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
      this.youtubeApiReady = true;
      console.log('YouTube IFrame API ready');
    };
  }

  private initYouTubePlayer(): void {
    if (!this.youtubeApiReady) {
      console.warn('YouTube API not ready yet');
      return;
    }

    const YT = (window as unknown as { YT: { Player: new (elementId: string, config: unknown) => YouTubePlayer; PlayerState: { ENDED: number } } }).YT;

    // If player already exists, just clear the reference (don't destroy - it removes the iframe!)
    // Angular will replace the iframe when the src binding changes
    if (this.youtubePlayer) {
      console.log('Clearing existing YouTube player reference for new iframe');
      this.youtubePlayer = undefined;
    }

    // Poll for iframe to be in DOM with src attribute set (meaning Angular has rendered it)
    let attempts = 0;
    const maxAttempts = 20;
    const pollInterval = 100;

    const checkIframe = () => {
      const iframe = document.getElementById('ytplayer') as HTMLIFrameElement | null;

      if (!iframe) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkIframe, pollInterval);
        } else {
          console.warn('YouTube iframe not found after polling');
        }
        return;
      }

      // Check if iframe has a src (meaning Angular has set it)
      if (!iframe.src || iframe.src === 'about:blank') {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkIframe, pollInterval);
        } else {
          console.warn('YouTube iframe src not set after polling');
        }
        return;
      }

      // Iframe is ready, initialize player
      try {
        this.youtubePlayer = new YT.Player('ytplayer', {
          events: {
            onStateChange: (event: YouTubePlayerEvent) => {
              // YT.PlayerState.ENDED = 0
              if (event.data === 0) {
                console.log('YouTube video ended');
                this.handleMediaEnded();
              }
            },
            onError: (event: { data: number }) => {
              console.warn('YouTube player error:', event.data);
              // Error codes: 2=invalid param, 5=HTML5 error, 100=not found, 101/150=not embeddable
              // Auto-advance to next video on error
              if (this.canNext()) {
                console.log('Skipping failed video, advancing to next');
                this.next();
              }
            },
          },
        });
        console.log('YouTube player initialized');
      } catch (error) {
        console.error('Error initializing YouTube player:', error);
      }
    };

    // Start polling
    checkIframe();
  }

  /**
   * Exit the media player and clean up resources.
   * 
   * Navigation behavior:
   * - Fullscreen mode on stream route: Navigates to /streams
   * - Footer mode (small player): Just closes, no navigation
   * - All other cases: Just closes, no navigation
   */
  exit() {
    console.log('Exiting media player and hiding footer');

    // Check if we're on a stream route and in fullscreen mode
    const currentUrl = this.router.url;
    const isStreamRoute = currentUrl.startsWith('/stream/');
    const isFullscreen = this.layout.fullscreenMediaPlayer();

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

    // Destroy YouTube player completely on exit
    if (this.youtubePlayer && typeof (this.youtubePlayer as { destroy?: () => void }).destroy === 'function') {
      try {
        (this.youtubePlayer as { destroy: () => void }).destroy();
        this.youtubePlayer = undefined;
      } catch (error) {
        console.error('Error destroying YouTube player:', error);
      }
    }

    // Reset all state
    this.index = -1;
    this.current.set(undefined);
    this.videoMode.set(false);
    this.youtubeUrl.set(undefined);
    this.videoUrl.set(undefined);
    this.pausedYouTubeUrl.set(undefined);
    this._isFullscreen.set(false);
    this._isPaused.set(true);

    // Clear media queue
    // this.media.set([]);

    // Hide the media player footer and exit fullscreen mode
    this.layout.showMediaPlayer.set(false);
    this.layout.fullscreenMediaPlayer.set(false);

    // Clear saved queue from localStorage
    // this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);

    // Update media session
    navigator.mediaSession.playbackState = 'none';

    console.log('Media player completely exited and hidden');

    // Only navigate to /streams if we were in fullscreen mode on a stream route
    // In footer mode (small player), just close without navigation
    if (isStreamRoute && isFullscreen) {
      console.log('[MediaPlayer] Navigating to /streams from fullscreen stream view');
      this.router.navigate(['/streams']);
    }
  }

  playPlaylist(playlist: Playlist): void {
    console.log('Playing playlist:', playlist.title);

    if (playlist.tracks.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    // Clear current queue
    this.clearQueue();

    // Convert playlist tracks to MediaItems
    const mediaItems: MediaItem[] = playlist.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png', // Default artwork
      type: this.getMediaType(track.url),
    }));

    // Play first track and add rest to queue
    if (mediaItems.length > 0) {
      this.play(mediaItems[0]);

      // Add remaining tracks to queue
      for (let i = 1; i < mediaItems.length; i++) {
        this.enque(mediaItems[i]);
      }
    }
  }

  addPlaylistToQueue(playlist: Playlist): void {
    console.log('Adding playlist to queue:', playlist.title);

    if (playlist.tracks.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    // Convert playlist tracks to MediaItems and add to queue
    const mediaItems: MediaItem[] = playlist.tracks.map((track, index) => ({
      source: track.url,
      title: track.title || `Track ${index + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png', // Default artwork
      type: this.getMediaType(track.url),
    }));

    // Add all tracks to queue
    mediaItems.forEach(item => {
      this.enque(item);
    });
  }

  private getMediaType(url: string): 'Music' | 'Podcast' | 'YouTube' | 'Video' | 'HLS' | 'LiveKit' | 'External' {
    if (!url) return 'Music';

    // Check for YouTube URLs
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'YouTube';
    }

    // Check for CornyChat/External streams
    if (url.toLowerCase().includes('cornychat')) {
      return 'External';
    }

    // Check for LiveKit streams
    if (url.toLowerCase().startsWith('wss+livekit')) {
      return 'LiveKit';
    }

    // Check for HLS streams (.m3u8)
    if (url.toLowerCase().includes('.m3u8')) {
      return 'HLS';
    }

    // Check for video file extensions
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
    const lowercaseUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowercaseUrl.includes(ext))) {
      return 'Video';
    }

    // Default to Music for music playlists
    return 'Music';
  }

  play(file: MediaItem) {
    this.layout.showMediaPlayer.set(true);
    // Add the file to the queue
    this.media.update(files => [...files, file]);

    // Set index to the newly added item (last in queue)
    this.index = this.media().length - 1;

    // Save the queue so it persists across app reloads
    this.save();

    this.start();
  }

  enque(file: MediaItem) {
    // TODO: Clean the file.source URL!
    // this.layout.showMediaPlayer.set(true);
    this.media.update(files => [...files, file]);
    this.save();
  }

  dequeue(file: MediaItem) {
    this.media.update(files => {
      const index = files.findIndex(e => e === file);
      if (index === -1) {
        return files;
      }
      return files.filter((_, i) => i !== index);
    });
    this.save();
  }

  async save() {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Load existing data for all accounts
    let allQueues: Record<string, MediaItem[]> = {};
    const stored = this.localStorage.getItem(this.MEDIA_STORAGE_KEY);
    if (stored && stored !== '' && stored !== 'undefined') {
      try {
        const parsed = JSON.parse(stored);
        // Handle old format (array) - just replace with new format
        if (!Array.isArray(parsed)) {
          allQueues = parsed as Record<string, MediaItem[]>;
        }
      } catch {
        allQueues = {};
      }
    }

    // Update current user's queue
    if (this.media().length === 0) {
      delete allQueues[pubkey];
    } else {
      allQueues[pubkey] = this.media();
    }

    // Save or remove if empty
    if (Object.keys(allQueues).length === 0) {
      this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);
    } else {
      this.localStorage.setItem(this.MEDIA_STORAGE_KEY, JSON.stringify(allQueues));
    }
  }

  saveWindowState() {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Load existing data for all accounts
    let allStates: Record<string, VideoWindowState> = {};
    const stored = this.localStorage.getItem(this.WINDOW_STATE_STORAGE_KEY);
    if (stored && stored !== 'undefined') {
      try {
        const parsed = JSON.parse(stored);
        // Handle old format (VideoWindowState directly) - just replace with new format
        if (!('x' in parsed && 'y' in parsed && 'width' in parsed)) {
          allStates = parsed as Record<string, VideoWindowState>;
        }
      } catch {
        allStates = {};
      }
    }

    // Update current user's window state
    allStates[pubkey] = this.videoWindowState();
    this.localStorage.setItem(this.WINDOW_STATE_STORAGE_KEY, JSON.stringify(allStates));
  }

  /**
   * Get current timestamp in Nostr format (seconds since epoch)
   */
  private getCurrentNostrTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Save the current playback position for a podcast
   * @param url The media file URL used as unique identifier
   * @param position The current playback position in seconds
   * @param duration Optional total duration in seconds
   */
  savePodcastPosition(url: string, position: number, duration?: number): void {
    // Validate inputs
    if (typeof url !== 'string' || url.trim() === '' || typeof position !== 'number' || position < 0 || !isFinite(position)) {
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const positions = { ...this.podcastPositions() };

      // Get existing progress or create new
      const existing = positions[url] || { position: 0, lastListenedAt: 0, completed: false };

      // Update progress
      positions[url] = {
        position,
        duration: duration || existing.duration,
        lastListenedAt: this.getCurrentNostrTimestamp(),
        completed: existing.completed, // Preserve completed status
      };

      // Update the signal cache
      this.podcastPositions.set(positions);

      // Load existing data for all accounts and save
      let allPositions: Record<string, Record<string, PodcastProgress>> = {};
      const stored = this.localStorage.getItem(this.PODCAST_POSITIONS_KEY);
      if (stored && stored !== 'undefined') {
        try {
          const parsed = JSON.parse(stored);
          // Handle old format - just replace with new format
          const firstKey = Object.keys(parsed)[0];
          const isOldFormat = firstKey && (firstKey.startsWith('http') || firstKey.startsWith('/'));
          if (!isOldFormat) {
            allPositions = parsed as Record<string, Record<string, PodcastProgress>>;
          }
        } catch {
          allPositions = {};
        }
      }

      allPositions[pubkey] = positions;
      this.localStorage.setItem(this.PODCAST_POSITIONS_KEY, JSON.stringify(allPositions));
    } catch (error) {
      console.error('Error saving podcast position:', error);
    }
  }

  /**
   * Restore the playback position for a podcast
   * @param url The media file URL used as unique identifier
   * @returns The saved position in seconds, or 0 if not found
   */
  restorePodcastPosition(url: string): number {
    const progress = this.podcastPositions()[url];
    return progress?.position || 0;
  }

  /**
   * Get full podcast progress data
   * @param url The media file URL used as unique identifier
   * @returns The podcast progress data or null if not found
   */
  getPodcastProgress(url: string): PodcastProgress | null {
    return this.podcastPositions()[url] || null;
  }

  /**
   * Mark a podcast as completed/listened
   * @param url The media file URL used as unique identifier
   * @param completed Whether the podcast is completed
   */
  setPodcastCompleted(url: string, completed: boolean): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const positions = { ...this.podcastPositions() };

      // Get existing progress or create new
      const existing = positions[url] || {
        position: 0,
        lastListenedAt: this.getCurrentNostrTimestamp(),
        completed: false
      };

      // Update completed status
      positions[url] = {
        ...existing,
        completed,
        lastListenedAt: this.getCurrentNostrTimestamp(),
      };

      // Update the signal cache
      this.podcastPositions.set(positions);

      // Load existing data for all accounts and save
      let allPositions: Record<string, Record<string, PodcastProgress>> = {};
      const stored = this.localStorage.getItem(this.PODCAST_POSITIONS_KEY);
      if (stored && stored !== 'undefined') {
        try {
          const parsed = JSON.parse(stored);
          const firstKey = Object.keys(parsed)[0];
          const isOldFormat = firstKey && (firstKey.startsWith('http') || firstKey.startsWith('/'));
          if (!isOldFormat) {
            allPositions = parsed as Record<string, Record<string, PodcastProgress>>;
          }
        } catch {
          allPositions = {};
        }
      }

      allPositions[pubkey] = positions;
      this.localStorage.setItem(this.PODCAST_POSITIONS_KEY, JSON.stringify(allPositions));
    } catch (error) {
      console.error('Error setting podcast completed status:', error);
    }
  }

  /**
   * Reset podcast progress (clear position and completed status)
   * @param url The media file URL used as unique identifier
   */
  resetPodcastProgress(url: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const positions = { ...this.podcastPositions() };
      delete positions[url];

      // Update the signal cache
      this.podcastPositions.set(positions);

      // Load existing data for all accounts and save
      let allPositions: Record<string, Record<string, PodcastProgress>> = {};
      const stored = this.localStorage.getItem(this.PODCAST_POSITIONS_KEY);
      if (stored && stored !== 'undefined') {
        try {
          const parsed = JSON.parse(stored);
          const firstKey = Object.keys(parsed)[0];
          const isOldFormat = firstKey && (firstKey.startsWith('http') || firstKey.startsWith('/'));
          if (!isOldFormat) {
            allPositions = parsed as Record<string, Record<string, PodcastProgress>>;
          }
        } catch {
          allPositions = {};
        }
      }

      allPositions[pubkey] = positions;
      this.localStorage.setItem(this.PODCAST_POSITIONS_KEY, JSON.stringify(allPositions));
    } catch (error) {
      console.error('Error resetting podcast progress:', error);
    }
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
    this.videoWindowState.update(state => ({
      ...state,
      isMinimized: !state.isMinimized,
    }));
    this.saveWindowState();
  }

  maximizeWindow() {
    this.videoWindowState.update(state => ({
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
      this.videoElement.removeEventListener('play', this.handleVideoPlay);
      this.videoElement.removeEventListener('pause', this.handleVideoPause);
      this.videoElement.removeEventListener('volumechange', this.handleVolumeChange);
    }

    this.videoElement = videoElement;

    // Add event listeners to new video element
    if (videoElement) {
      videoElement.addEventListener('ended', this.handleMediaEnded);
      videoElement.addEventListener('play', this.handleVideoPlay);
      videoElement.addEventListener('pause', this.handleVideoPause);

      // Restore saved volume settings
      this.restoreVolumeSettings(videoElement);

      // Listen for volume/mute changes to persist them
      videoElement.addEventListener('volumechange', this.handleVolumeChange);

      console.log('Video element registered for current video');

      // If we have a current video/HLS item that's waiting for the video element, set it up now
      const currentItem = this.current();
      if (currentItem && (currentItem.type === 'Video' || currentItem.type === 'HLS')) {
        console.log('Setting up deferred video/HLS playback');
        this.setupVideoPlayback(currentItem);
      }
    }
  }

  private handleVideoPlay = () => {
    console.log('[MediaPlayer] Video playing, enabling wake lock');
    this.wakeLockService.enable();
  };

  private handleVideoPause = () => {
    console.log('[MediaPlayer] Video paused, disabling wake lock');
    this.wakeLockService.disable();
  };

  private handleVolumeChange = () => {
    if (this.videoElement) {
      this.saveVolumeSettings(this.videoElement.volume, this.videoElement.muted);
    }
  };

  private saveVolumeSettings(volume: number, muted: boolean): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    this.accountLocalState.setVolumeLevel(pubkey, volume);
    this.accountLocalState.setVolumeMuted(pubkey, muted);
  }

  private restoreVolumeSettings(videoElement: HTMLVideoElement): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const volume = this.accountLocalState.getVolumeLevel(pubkey);
    const muted = this.accountLocalState.getVolumeMuted(pubkey);

    videoElement.volume = Math.max(0, Math.min(1, volume));
    videoElement.muted = muted;
    console.log('[MediaPlayer] Restored volume settings:', { volume, muted });
  }

  private handleMediaEnded = () => {
    console.log('Media ended, checking for next item');

    // Mark podcast as completed if applicable
    const currentItem = this.current();
    if (currentItem?.type === 'Podcast') {
      this.setPodcastCompleted(currentItem.source, true);
    }

    // Handle repeat modes
    if (this.repeat() === 'one') {
      // Repeat current track
      console.log('Repeat one mode - replaying current track');
      this.start();
      return;
    }

    if (this.canNext()) {
      console.log('Auto-advancing to next media item');
      this.next();
    } else if (this.repeat() === 'all' && this.media().length > 0) {
      // Wrap to beginning of queue
      console.log('Repeat all mode - wrapping to beginning');
      this.index = 0;
      this.start();
    } else {
      console.log('No next media item available, stopping playback');
      navigator.mediaSession.playbackState = 'none';
    }
  };

  private handleTimeUpdate = () => {
    if (this.audio) {
      this.currentTimeSig.set(this.audio.currentTime);

      // Save podcast position periodically (only for podcasts), throttled to every 2 seconds
      const currentItem = this.current();
      if (currentItem?.type === 'Podcast') {
        const now = Date.now();
        if (now - this.lastPodcastPositionSave >= this.PODCAST_SAVE_INTERVAL) {
          this.savePodcastPosition(currentItem.source, this.audio.currentTime, this.audio.duration);
          this.lastPodcastPositionSave = now;
        }
      }
    }
  };

  private handleLoadedMetadata = () => {
    if (this.audio) {
      this.durationSig.set(this.audio.duration);

      // Restore saved position for podcasts
      const currentItem = this.current();
      if (currentItem?.type === 'Podcast') {
        const savedPosition = this.restorePodcastPosition(currentItem.source);
        // Ensure duration is valid and position is within safe bounds
        const duration = this.audio.duration;
        if (!isNaN(duration) && isFinite(duration) && savedPosition < duration - this.POSITION_SAFETY_MARGIN_SECONDS) {
          this.audio.currentTime = savedPosition;
          console.log(`Restored podcast position: ${savedPosition}s for ${currentItem.source}`);
        }
      }
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

    this.current.set(file);

    // Reset video playback initialization flag for new media
    this.videoPlaybackInitialized = false;

    this.layout.showMediaPlayer.set(true);
    if (file.type === 'YouTube') {
      this.videoMode.set(true);
      this.videoUrl.set(undefined);
      const youTubeUrl = this.getYouTubeEmbedUrl()(file.source, 'autoplay=1');
      this.youtubeUrl.set(youTubeUrl);
      this._isPaused.set(false); // YouTube autoplays

      // Initialize YouTube player to detect when video ends
      // Use small initial delay, then poll for iframe readiness
      setTimeout(() => {
        this.initYouTubePlayer();
      }, 200);
    } else if (file.type === 'Video' || file.type === 'HLS') {
      this.videoMode.set(true);
      this.youtubeUrl.set(undefined);

      console.log('Starting video/HLS, videoElement available:', !!this.videoElement);

      // If video element is available, handle playback immediately
      if (this.videoElement) {
        this.setupVideoPlayback(file);
      } else {
        // Video element not available yet - it will be set up when registerVideoElement is called
        console.log('Video element will be set up when it becomes available');

        // For regular video, set the URL so the video element can load it
        if (file.type === 'Video') {
          this.videoUrl.set(this.utilities.sanitizeUrlAndBypassFrame(file.source));
        }
      }
    } else {
      this.videoMode.set(false);
      this.youtubeUrl.set(undefined);
      this.videoUrl.set(undefined);

      // Remove event listeners from previous audio element
      if (this.audio) {
        this.audio.removeEventListener('ended', this.handleMediaEnded);
      }

      // Check if this track is available offline and use cached URL if so
      let audioSource = file.source;
      if (file.type === 'Music') {
        try {
          audioSource = await this.offlineMusicService.getCachedAudioUrl(file.source);
          if (audioSource !== file.source) {
            console.log('Using cached audio for offline playback');
          }
        } catch (err) {
          console.warn('Failed to get cached audio, using original source:', err);
        }
      }

      if (!this.audio) {
        this.audio = new Audio();
        // Set crossOrigin BEFORE setting src to allow Web Audio API (equalizer) to process the audio
        this.audio.crossOrigin = 'anonymous';
        this.audio.src = audioSource;
        this.audio.addEventListener('ratechange', () => {
          if (this.audio) {
            this.playbackRate.set(this.audio.playbackRate);
          }
        });
      } else {
        // crossOrigin must be set before src for CORS to work properly
        this.audio.crossOrigin = 'anonymous';
        this.audio.src = audioSource;
      }

      // Sync signal
      this.playbackRate.set(this.audio.playbackRate);

      // Add event listeners to audio
      this.audio.addEventListener('ended', this.handleMediaEnded);
      this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
      this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        console.error('Audio error code:', this.audio?.error?.code);
        console.error('Audio error message:', this.audio?.error?.message);
        console.error('Audio source:', this.audio?.src);
      });

      console.log('Starting audio playback for:', file.source);
      await this.audio.play();
      this._isPaused.set(false);
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: file.title,
      artist: file.artist,
      album: 'Nostria',
      artwork: [{ src: file.artwork }],
    });

    navigator.mediaSession.playbackState = 'playing';
  }

  private setupVideoPlayback(file: MediaItem) {
    if (!this.videoElement) {
      console.warn('Cannot set up video playback: video element not available');
      return;
    }

    // Prevent re-initialization if already set up for this item
    if (this.videoPlaybackInitialized) {
      console.log('Video playback already initialized for current item, skipping');
      return;
    }

    console.log('Initializing video playback for:', file.type);
    this.videoPlaybackInitialized = true;

    try {
      // Add ended event listener
      this.videoElement.addEventListener('ended', this.handleMediaEnded);

      if (file.type === 'HLS') {
        // Handle HLS streaming
        this.setupHLS(file.source, this.videoElement);
      } else {
        // Set the new video URL for regular video
        this.videoUrl.set(this.utilities.sanitizeUrlAndBypassFrame(file.source));

        // Add event listeners for when video is ready
        const handleCanPlay = async () => {
          if (this.videoElement) {
            try {
              await this.videoElement.play();
              this._isPaused.set(false);
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
      }
    } catch (error) {
      console.error('Error setting up video:', error);
    }
  }

  private async setupHLS(url: string, videoElement: HTMLVideoElement) {
    console.log('Setting up HLS for:', url);

    // Reset quality levels
    this.hlsQualityLevels.set([]);
    this.hlsCurrentQuality.set(-1);

    // Dynamically import HLS.js
    try {
      const Hls = (await import('hls.js')).default;

      if (Hls.isSupported()) {
        // Destroy previous HLS instance if it exists
        if (this.hlsInstance) {
          this.hlsInstance.destroy();
        }

        this.hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });

        this.hlsInstance.loadSource(url);
        this.hlsInstance.attachMedia(videoElement);

        this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, async (_event: unknown, data: { levels: { height?: number; bitrate?: number }[] }) => {
          console.log('HLS manifest parsed, starting playback');

          // Extract quality levels
          const levels = data.levels.map((level: { height?: number; bitrate?: number }, index: number) => {
            let label = 'Auto';
            if (level.height) {
              label = `${level.height}p`;
            } else if (level.bitrate) {
              label = `${Math.round(level.bitrate / 1000)}kbps`;
            }
            return {
              index,
              label,
              height: level.height,
              bitrate: level.bitrate,
            };
          });

          // Sort by height/quality descending
          levels.sort((a, b) => (b.height || 0) - (a.height || 0));
          this.hlsQualityLevels.set(levels);
          console.log('HLS quality levels:', levels);

          try {
            await videoElement.play();
            this._isPaused.set(false);
            console.log('HLS stream started playing');
          } catch (error) {
            console.error('Error playing HLS stream:', error);
          }
        });

        // Track quality level changes
        this.hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (_event: unknown, data: { level: number }) => {
          this.hlsCurrentQuality.set(data.level);
          console.log('HLS quality switched to level:', data.level);
        });

        this.hlsInstance.on(Hls.Events.ERROR, (_event: any, data: any) => {
          console.error('HLS error:', data);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error('Fatal network error, trying to recover');
                this.hlsInstance?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error('Fatal media error, trying to recover');
                this.hlsInstance?.recoverMediaError();
                break;
              default:
                console.error('Fatal error, cannot recover');
                this.hlsInstance?.destroy();
                break;
            }
          }
        });
      } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        console.log('Using native HLS support');
        videoElement.src = url;
        try {
          await videoElement.play();
          this._isPaused.set(false);
          console.log('HLS stream started playing (native)');
        } catch (error) {
          console.error('Error playing HLS stream:', error);
        }
      } else {
        console.error('HLS is not supported in this browser');
      }
    } catch (error) {
      console.error('Error loading HLS.js:', error);
    }
  }

  private cleanupCurrentMedia() {
    // Save podcast position before cleanup
    const currentItem = this.current();
    if (currentItem?.type === 'Podcast' && this.audio) {
      this.savePodcastPosition(currentItem.source, this.audio.currentTime, this.audio.duration);
    }

    // Reset initialization flag
    this.videoPlaybackInitialized = false;

    // Stop and cleanup audio
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      // Remove event listeners
      this.audio.removeEventListener('ended', this.handleMediaEnded);
      this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    }

    // Cleanup HLS instance
    if (this.hlsInstance) {
      try {
        this.hlsInstance.destroy();
        this.hlsInstance = undefined;
        console.log('HLS instance destroyed');
      } catch (error) {
        console.error('Error destroying HLS instance:', error);
      }
    }

    // Stop and cleanup video
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
      // Remove event listeners
      this.videoElement.removeEventListener('ended', this.handleMediaEnded);
    }

    // Stop YouTube player (it will be destroyed and recreated for next video)
    if (this.youtubePlayer && typeof (this.youtubePlayer as { stopVideo?: () => void }).stopVideo === 'function') {
      try {
        (this.youtubePlayer as { stopVideo: () => void }).stopVideo();
      } catch (error) {
        console.error('Error stopping YouTube player:', error);
      }
    }

    // Clear video URLs to stop any playing videos
    if (this.videoMode()) {
      this.pausedYouTubeUrl.set(undefined);
    }
  }

  async resume() {
    // For live streams, restart instead of resuming
    const currentItem = this.current();
    if (currentItem?.isLiveStream) {
      this.start();
      return;
    }

    // Normal resume behavior for non-live content
    if (this.videoMode()) {
      if (currentItem?.type === 'Video' && this.videoElement) {
        try {
          await this.videoElement.play();
          this._isPaused.set(false);
        } catch (err) {
          console.error('Error resuming video:', err);
        }
      } else {
        this.youtubeUrl.set(this.pausedYouTubeUrl());
        this.pausedYouTubeUrl.set(undefined);
        this._isPaused.set(false);
      }
    } else {
      if (!this.audio) {
        this.start();
        return;
      }

      console.log('RESUME!');
      try {
        await this.audio.play();
        this._isPaused.set(false);
      } catch (err) {
        console.error(err);
      }
    }

    navigator.mediaSession.playbackState = 'playing';
  }

  pause() {
    // For live streams, stop playback instead of pausing
    const currentItem = this.current();
    if (currentItem?.isLiveStream) {
      if (this.videoMode()) {
        if (currentItem.type === 'Video' || currentItem.type === 'HLS') {
          if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.currentTime = 0;
          }
          // Destroy HLS instance for live streams
          if (this.hlsInstance) {
            try {
              this.hlsInstance.destroy();
              this.hlsInstance = undefined;
            } catch (error) {
              console.error('Error destroying HLS instance:', error);
            }
          }
        }
      }
      this._isPaused.set(true);
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    // Normal pause behavior for non-live content
    if (this.videoMode()) {
      if (currentItem?.type === 'Video' && this.videoElement) {
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

    this._isPaused.set(true);
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
    if (this.shuffle()) {
      // Pick a random index different from current
      const mediaLength = this.media().length;
      if (mediaLength > 1) {
        let newIndex = this.index;
        while (newIndex === this.index) {
          newIndex = Math.floor(Math.random() * mediaLength);
        }
        this.index = newIndex;
      }
    } else {
      this.index++;
    }
    this.start();
  }

  previous() {
    this.index--;
    this.start();
  }

  toggleShuffle(): void {
    this.shuffle.update(v => !v);
  }

  toggleRepeat(): void {
    this.repeat.update(v => {
      if (v === 'off') return 'all';
      if (v === 'all') return 'one';
      return 'off';
    });
  }

  get error() {
    return this.audio?.error;
  }

  get paused() {
    // Use the signal for reactive updates
    return this._isPaused();
  }

  get muted() {
    if (this.videoMode() && this.videoElement) {
      return this.videoElement.muted;
    }

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
    if (this.videoMode() && this.videoElement) {
      this.videoElement.muted = !this.videoElement.muted;
    }

    if (this.audio) {
      this.audio.muted = !this.audio.muted;
    }
  }

  forward(value: number) {
    // Support both video and audio playback
    if (this.videoMode() && this.videoElement) {
      this.videoElement.currentTime = Math.min(
        this.videoElement.duration || 0,
        this.videoElement.currentTime + value
      );
    } else if (this.audio) {
      this.audio.currentTime += value;
    }
  }

  rewind(value: number) {
    // Support both video and audio playback
    if (this.videoMode() && this.videoElement) {
      this.videoElement.currentTime = Math.max(
        0,
        this.videoElement.currentTime - value
      );
    } else if (this.audio) {
      this.audio.currentTime -= value;
    }
  }

  rate() {
    if (!this.audio) {
      return;
    }

    console.log(this.audio.playbackRate);

    if (this.audio.playbackRate == 2.0) {
      this.setPlaybackRate(1.0);
    } else {
      this.setPlaybackRate(2.0);
    }
  }

  setPlaybackRate(speed: number) {
    if (this.audio) {
      this.audio.playbackRate = speed;
      this.playbackRate.set(speed);
    }
  }

  /**
   * Set the HLS quality level
   * @param levelIndex The quality level index, or -1 for auto
   */
  setHlsQuality(levelIndex: number): void {
    if (this.hlsInstance) {
      this.hlsInstance.currentLevel = levelIndex;
      this.hlsCurrentQuality.set(levelIndex);
      console.log('HLS quality set to level:', levelIndex);
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
    this.current.set(undefined);
    this.videoMode.set(false);
    this.youtubeUrl.set(undefined);
    this.videoUrl.set(undefined);
    this.pausedYouTubeUrl.set(undefined);
    this._isFullscreen.set(false);

    // Also turn off fullscreen media player mode so it doesn't auto-open next time
    this.layout.fullscreenMediaPlayer.set(false);

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
