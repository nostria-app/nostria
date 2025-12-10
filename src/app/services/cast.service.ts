import { Injectable, signal } from '@angular/core';

// Type declarations for Google Cast SDK
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    chrome?: {
      cast?: {
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: string;
          MediaInfo: new (contentId: string, contentType: string) => ChromeCastMediaInfo;
          LoadRequest: new (mediaInfo: ChromeCastMediaInfo) => ChromeCastLoadRequest;
        };
        AutoJoinPolicy: {
          ORIGIN_SCOPED: string;
        };
      };
    };
    cast?: {
      framework: {
        CastContext: {
          getInstance: () => CastContext;
        };
      };
    };
  }
}

interface ChromeCastMediaInfo {
  contentId: string;
  contentType: string;
  metadata?: {
    title?: string;
    images?: { url: string }[];
  };
}

interface ChromeCastLoadRequest {
  mediaInfo: ChromeCastMediaInfo;
}

interface CastContext {
  setOptions: (options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }) => void;
  getCurrentSession: () => CastSession | null;
  requestSession: () => Promise<void>;
}

interface CastSession {
  loadMedia: (request: ChromeCastLoadRequest) => Promise<void>;
  getSessionState: () => string;
}

export interface CastMediaInfo {
  url: string;
  contentType: string;
  title?: string;
  thumbnail?: string;
}

@Injectable({
  providedIn: 'root',
})
export class CastService {
  private sdkLoaded = false;
  private sdkLoading = false;
  private sdkAvailable = signal(false);
  private loadPromise: Promise<boolean> | null = null;

  /** Signal indicating if Cast SDK is available */
  readonly isAvailable = this.sdkAvailable.asReadonly();

  /**
   * Lazy load the Google Cast SDK
   * Only loads once, subsequent calls return the cached promise
   */
  async loadCastSDK(): Promise<boolean> {
    // If already loaded and available
    if (this.sdkLoaded) {
      return this.sdkAvailable();
    }

    // If currently loading, return the existing promise
    if (this.sdkLoading && this.loadPromise) {
      return this.loadPromise;
    }

    this.sdkLoading = true;
    this.loadPromise = this.doLoadCastSDK();
    return this.loadPromise;
  }

  private async doLoadCastSDK(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      // Check if SDK is already loaded (e.g., from another part of the app)
      if (window.cast?.framework?.CastContext) {
        this.sdkLoaded = true;
        this.sdkAvailable.set(true);
        this.initializeCastFramework();
        resolve(true);
        return;
      }

      // Set up the callback before loading the script
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        this.sdkLoaded = true;
        this.sdkLoading = false;
        this.sdkAvailable.set(isAvailable);

        if (isAvailable) {
          this.initializeCastFramework();
        }

        resolve(isAvailable);
      };

      // Create and load the script
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src =
        'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.async = true;

      script.onerror = () => {
        console.error('Failed to load Google Cast SDK');
        this.sdkLoaded = true;
        this.sdkLoading = false;
        this.sdkAvailable.set(false);
        resolve(false);
      };

      document.head.appendChild(script);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.sdkLoaded) {
          console.warn('Google Cast SDK load timeout');
          this.sdkLoaded = true;
          this.sdkLoading = false;
          this.sdkAvailable.set(false);
          resolve(false);
        }
      }, 10000);
    });
  }

  private initializeCastFramework(): void {
    if (!window.cast?.framework?.CastContext || !window.chrome?.cast) {
      return;
    }

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      castContext.setOptions({
        receiverApplicationId:
          window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      console.log('Cast framework initialized');
    } catch (error) {
      console.error('Failed to initialize Cast framework:', error);
    }
  }

  /**
   * Cast media to a Cast device
   * Loads SDK if not already loaded
   */
  async castMedia(mediaInfo: CastMediaInfo): Promise<boolean> {
    const isAvailable = await this.loadCastSDK();

    if (!isAvailable) {
      console.log('Cast: SDK not available');
      return false;
    }

    if (!window.cast?.framework?.CastContext || !window.chrome?.cast) {
      console.log('Cast: Framework not ready');
      return false;
    }

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      let session = castContext.getCurrentSession();

      // If no session, request one (this prompts the user to select a device)
      if (!session) {
        await castContext.requestSession();
        session = castContext.getCurrentSession();
      }

      if (!session) {
        console.log('Cast: No session available');
        return false;
      }

      // Create media info
      const chromeCastMediaInfo = new window.chrome.cast.media.MediaInfo(
        mediaInfo.url,
        mediaInfo.contentType
      );

      // Add metadata if available
      if (mediaInfo.title || mediaInfo.thumbnail) {
        chromeCastMediaInfo.metadata = {};
        if (mediaInfo.title) {
          chromeCastMediaInfo.metadata.title = mediaInfo.title;
        }
        if (mediaInfo.thumbnail) {
          chromeCastMediaInfo.metadata.images = [{ url: mediaInfo.thumbnail }];
        }
      }

      // Create and send load request
      const request = new window.chrome.cast.media.LoadRequest(
        chromeCastMediaInfo
      );
      await session.loadMedia(request);

      console.log('Cast: Media loaded successfully');
      return true;
    } catch (error) {
      console.error('Cast: Failed to cast media:', error);
      return false;
    }
  }

  /**
   * Cast video from a video element
   * Falls back to Remote Playback API if Cast SDK fails
   */
  async castVideoElement(
    video: HTMLVideoElement,
    title?: string,
    thumbnail?: string
  ): Promise<boolean> {
    const videoUrl = video.currentSrc || video.src;

    if (!videoUrl) {
      console.log('Cast: No video source available');
      return false;
    }

    // Determine content type
    const contentType = this.getContentType(videoUrl);

    // Try Google Cast SDK first
    const castResult = await this.castMedia({
      url: videoUrl,
      contentType,
      title,
      thumbnail,
    });

    if (castResult) {
      return true;
    }

    // Fall back to Remote Playback API
    return this.tryRemotePlayback(video);
  }

  /**
   * Try the Remote Playback API (works in Chrome without SDK)
   */
  private async tryRemotePlayback(
    video: HTMLVideoElement
  ): Promise<boolean> {
    if (!('remote' in video) || !video.remote) {
      console.log('Cast: Remote Playback API not supported');
      return false;
    }

    const remote = video.remote as RemotePlayback;

    try {
      await remote.prompt();
      console.log('Cast: Remote playback started, state:', remote.state);
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';
      console.log('Cast: Remote playback failed -', errorName, ':', errorMessage);
      return false;
    }
  }

  /**
   * Get MIME type based on URL extension
   */
  private getContentType(url: string): string {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('.m3u8') || urlLower.includes('m3u8')) {
      return 'application/x-mpegURL';
    }
    if (urlLower.includes('.mpd')) {
      return 'application/dash+xml';
    }
    if (urlLower.endsWith('.webm')) {
      return 'video/webm';
    }
    if (urlLower.endsWith('.ogg') || urlLower.endsWith('.ogv')) {
      return 'video/ogg';
    }
    if (urlLower.endsWith('.mov')) {
      return 'video/quicktime';
    }

    // Default to mp4
    return 'video/mp4';
  }
}
