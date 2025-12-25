import { Component, computed, effect, input, signal, inject, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { VideoControlsComponent } from '../video-controls/video-controls.component';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Event } from 'nostr-tools';
import { MediaWithCommentsDialogComponent } from '../media-with-comments-dialog/media-with-comments-dialog.component';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { SettingsService } from '../../services/settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { CastService } from '../../services/cast.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';

interface VideoData {
  url: string;
  thumbnail?: string;
  blurhash?: string;
  thumbhash?: string;
  duration?: number;
  title?: string;
  alt?: string;
  dimensions?: { width: number; height: number };
}

@Component({
  selector: 'app-video-event',
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, CommentsListComponent, VideoControlsComponent],
  templateUrl: './video-event.component.html',
  styleUrl: './video-event.component.scss',
})
export class VideoEventComponent implements AfterViewInit, OnDestroy {
  event = input.required<Event>();
  hideComments = input<boolean>(false);
  showOverlay = input<boolean>(false);
  // Media navigation context (for Media tab grid)
  allMediaEvents = input<Event[]>([]);
  mediaEventIndex = input<number | undefined>(undefined);
  // Pubkey of someone who shared/reposted this content - if trusted, media should be revealed
  trustedByPubkey = input<string | undefined>(undefined);

  // Video player element - use setter to update signal when ViewChild resolves
  private _videoPlayerRef?: ElementRef<HTMLVideoElement>;
  videoElement = signal<HTMLVideoElement | undefined>(undefined);

  @ViewChild('videoPlayer')
  set videoPlayerRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this._videoPlayerRef = ref;
    const element = ref?.nativeElement;
    console.log('[VideoEvent] ViewChild videoPlayer resolved:', !!element, element?.src);
    this.videoElement.set(element);
  }
  get videoPlayerRef(): ElementRef<HTMLVideoElement> | undefined {
    return this._videoPlayerRef;
  }

  @ViewChild(VideoControlsComponent) videoControlsRef?: VideoControlsComponent;

  private router = inject(Router);
  private dialog = inject(MatDialog);
  private settings = inject(SettingsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private hostElement = inject(ElementRef);
  private videoPlayback = inject(VideoPlaybackService);
  private castService = inject(CastService);
  private imagePlaceholder = inject(ImagePlaceholderService);

  // Viewport visibility
  private intersectionObserver?: IntersectionObserver;
  isInViewport = signal(false);

  // Media privacy state
  isRevealed = signal(false);

  // Track actual video dimensions after metadata loads (accounts for rotation)
  private videoActualDimensions = signal<{ width: number; height: number } | undefined>(undefined);

  // Short form video detection and settings
  isShortFormVideo = computed(() => {
    const event = this.event();
    return event.kind === 22 || event.kind === 34236; // NIP-71 short form video kinds
  });

  shouldAutoPlay = computed(() => {
    const autoPlayEnabled = this.settings.settings()?.autoPlayShortForm ?? true;
    const inViewport = this.isInViewport();
    return this.isShortFormVideo() && autoPlayEnabled && inViewport;
  });

  shouldRepeat = computed(() => {
    const repeatEnabled = this.settings.settings()?.repeatShortForm ?? true;
    return this.isShortFormVideo() && repeatEnabled;
  });

  constructor() {
    effect(() => {
      const shouldPlay = this.shouldAutoPlay();
      const videoElement = this.videoPlayerRef?.nativeElement;
      const isCurrentlyExpanded = this.isExpanded();
      const isBlurred = this.shouldBlurMedia();
      const inOverlayMode = this.showOverlay();
      const isShortForm = this.isShortFormVideo();
      const inViewport = this.isInViewport();

      console.log('🎥 [Video AutoPlay] Effect triggered:', {
        eventId: this.event().id.substring(0, 8),
        shouldPlay,
        hasVideoElement: !!videoElement,
        isCurrentlyExpanded,
        isBlurred,
        inOverlayMode,
        isShortForm,
        inViewport
      });

      // Skip if blurred or in overlay mode
      if (isBlurred || inOverlayMode) {
        console.log('🎥 [Video AutoPlay] Skipping - blurred or overlay mode');
        return;
      }

      // Auto-expand when entering viewport (before we have a video element)
      if (shouldPlay && !isCurrentlyExpanded && isShortForm) {
        console.log('🎥 [Video AutoPlay] Auto-expanding video');
        this.isExpanded.set(true);
        return; // Let the next effect run handle playing after expansion
      }

      // Now handle play/pause if we have a video element
      if (!videoElement) {
        console.log('🎥 [Video AutoPlay] No video element yet');
        return;
      }

      // Pause/collapse video when leaving viewport (only for short form videos)
      if (!shouldPlay && isCurrentlyExpanded && isShortForm) {
        console.log('🎥 [Video AutoPlay] Pausing video (left viewport)');
        videoElement.pause();
      }

      // Play/pause based on viewport visibility
      if (isCurrentlyExpanded && isShortForm) {
        if (shouldPlay) {
          console.log('🎥 [Video AutoPlay] Playing video');
          videoElement.play().catch((error) => {
            console.log('🎥 [Video AutoPlay] Play failed:', error);
            // Ignore errors (e.g., user hasn't interacted with page yet)
          });
        } else {
          console.log('🎥 [Video AutoPlay] Pausing video');
          videoElement.pause();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up IntersectionObserver to detect when video enters/leaves viewport
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            // Consider video in viewport if at least 50% is visible
            const isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
            console.log('🎥 [Video AutoPlay] Viewport change:', {
              eventId: this.event().id.substring(0, 8),
              isVisible,
              intersectionRatio: entry.intersectionRatio,
              isIntersecting: entry.isIntersecting
            });
            this.isInViewport.set(isVisible);
          });
        },
        {
          threshold: [0, 0.5, 1],
          rootMargin: '0px',
        }
      );

      // Observe the component's host element directly
      if (this.hostElement?.nativeElement) {
        console.log('🎥 [Video AutoPlay] Setting up observer for event:', this.event().id.substring(0, 8));
        this.intersectionObserver.observe(this.hostElement.nativeElement);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    // Unregister video from playback service if it was playing
    const videoElement = this.videoPlayerRef?.nativeElement;
    if (videoElement) {
      this.videoPlayback.unregisterPlaying(videoElement);
    }
  }

  shouldBlurMedia = computed(() => {
    const privacy = this.settings.settings()?.mediaPrivacy;
    const currentEvent = this.event();
    const authorPubkey = currentEvent.pubkey;

    if (!privacy || privacy === 'show-always') {
      return false;
    }

    // Check if author is trusted for media reveal (trackChanges=true for reactivity)
    const currentUserPubkey = this.accountState.pubkey();
    if (currentUserPubkey) {
      const isTrusted = this.accountLocalState.isMediaAuthorTrusted(currentUserPubkey, authorPubkey, true);
      if (isTrusted) {
        return false;
      }
      // Also check if someone who shared/reposted this content is trusted
      const sharer = this.trustedByPubkey();
      if (sharer && this.accountLocalState.isMediaAuthorTrusted(currentUserPubkey, sharer, true)) {
        return false;
      }
    }

    // Check if sharer is in following list - trust what people you follow share
    const followingList = this.accountState.followingList();
    const sharer = this.trustedByPubkey();
    if (sharer && followingList.includes(sharer)) {
      return false;
    }

    if (privacy === 'blur-always') {
      return !this.isRevealed();
    }

    // blur-non-following mode
    const isFollowing = followingList.includes(authorPubkey);
    return !isFollowing && !this.isRevealed();
  });

  // Video expansion state
  isExpanded = signal(false);

  // Computed video data from the event
  videoData = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getVideoData(event);
  });

  // Computed placeholder data URL - uses default if none available (supports blurhash and thumbhash)
  // Uses preserveAspectRatio to ensure placeholder matches video dimensions
  placeholderDataUrl = computed(() => {
    const event = this.event();
    if (!event) return this.imagePlaceholder.getDefaultPlaceholderDataUrl(32, 32);

    return this.imagePlaceholder.getPlaceholderDataUrlFromEvent(event, 0, true);
  });

  // Legacy alias for backward compatibility
  blurhashDataUrl = this.placeholderDataUrl;

  // Track if thumbnail is loaded
  thumbnailLoaded = signal(false);

  // Track if video is ready to play (has enough data)
  videoReady = signal(false);

  // Get dimensions for video thumbnail
  videoDimensions = computed(() => {
    const data = this.videoData();
    return data?.dimensions;
  });

  // Get aspect ratio style for video container
  // Uses metadata dimensions (dim tag) since they represent intended display dimensions
  // (usually calculated from the correctly-rotated thumbnail)
  videoAspectRatio = computed(() => {
    // Use metadata dimensions - they represent intended display aspect ratio
    const dimensions = this.videoDimensions();
    if (dimensions && dimensions.width && dimensions.height) {
      return `${dimensions.width} / ${dimensions.height}`;
    }

    // Fallback to actual video dimensions
    const actualDims = this.videoActualDimensions();
    if (actualDims && actualDims.width && actualDims.height) {
      return `${actualDims.width} / ${actualDims.height}`;
    }

    // Default to 16:9 for videos
    return '16 / 9';
  });

  /**
   * Check if the video needs rotation correction
   * This happens when Blossom server strips EXIF rotation without rotating the video pixels,
   * but the thumbnail (used for dim tag) was rotated correctly.
   * Returns true if video file is landscape but dim says portrait (or vice versa)
   */
  needsRotationCorrection = computed(() => {
    const actualDims = this.videoActualDimensions();
    const dimensions = this.videoDimensions();

    if (!actualDims || !dimensions) {
      return false;
    }

    const metadataIsPortrait = dimensions.height > dimensions.width;
    const videoIsPortrait = actualDims.height > actualDims.width;

    // If metadata says portrait but video is landscape (or vice versa), needs rotation
    return metadataIsPortrait !== videoIsPortrait;
  });

  // Computed MIME type based on file extension
  videoMimeType = computed(() => {
    const videoInfo = this.videoData();
    if (!videoInfo?.url) return 'video/mp4';

    return this.getMimeTypeFromUrl(videoInfo.url);
  });

  // Video title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    return this.getEventTitle(event);
  });

  // Content warning check
  hasContentWarning = computed(() => {
    const event = this.event();
    if (!event) return false;

    return event.tags.some(tag => tag[0] === 'content-warning');
  });

  contentWarning = computed(() => {
    const event = this.event();
    if (!event) return null;

    const warningTag = event.tags.find(tag => tag[0] === 'content-warning');
    return warningTag?.[1] || 'Content may be sensitive';
  });

  // Description text (from summary tag or clean content)
  description = computed(() => {
    const event = this.event();
    if (!event) return null;

    // First try to get description from summary tag (NIP-71 standard)
    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    if (summaryTag?.[1]) {
      return summaryTag[1];
    }

    // If content exists, check if it's JSON (malformed event)
    if (event.content) {
      const trimmedContent = event.content.trim();
      // Skip JSON content - it's malformed for video events
      if ((trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) ||
        (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))) {
        return null;
      }
      // Otherwise use cleaned content
      return this.removeHashtagsFromContent(event.content);
    }

    return null;
  });

  expandVideo(clickEvent?: MouseEvent | KeyboardEvent): void {
    // Check if media should be blurred - reveal instead of opening dialog
    if (this.shouldBlurMedia()) {
      if (clickEvent) {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      }
      this.revealMedia();
      return;
    }

    // Prevent navigation when opening dialog in overlay mode
    if (this.showOverlay() && clickEvent) {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    }

    // If showOverlay is true, open the split-view dialog with comments
    if (this.showOverlay()) {
      const event = this.event();
      if (event) {
        this.dialog.open(MediaWithCommentsDialogComponent, {
          data: {
            event,
            allEvents: this.allMediaEvents().length > 0 ? this.allMediaEvents() : undefined,
            currentIndex: this.mediaEventIndex(),
            trustedByPubkey: this.trustedByPubkey()
          },
          maxWidth: '95vw',
          maxHeight: '95vh',
          width: '1400px',
          height: '90vh',
          panelClass: 'media-with-comments-dialog',
        });
      }
    } else {
      this.isExpanded.set(true);
    }
  }

  collapseVideo(): void {
    this.isExpanded.set(false);
  }

  /**
   * Handle video play event - register this video as currently playing
   * so other videos get paused.
   */
  onVideoPlay(event: globalThis.Event): void {
    const videoElement = event.target as HTMLVideoElement;
    if (videoElement) {
      this.videoPlayback.registerPlaying(videoElement);
    }
  }

  /**
   * Handle video pause event - unregister from playback service
   */
  onVideoPause(event: globalThis.Event): void {
    const videoElement = event.target as HTMLVideoElement;
    if (videoElement) {
      this.videoPlayback.unregisterPlaying(videoElement);
    }
  }

  // Video controls integration
  videoCurrentTime = signal(0);
  videoDuration = signal(0);

  onTimeUpdate(): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      this.videoCurrentTime.set(video.currentTime);
    }
  }

  onLoadedMetadata(): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      this.videoDuration.set(video.duration);
      // Store actual video dimensions after rotation is applied by the browser
      if (video.videoWidth && video.videoHeight) {
        this.videoActualDimensions.set({
          width: video.videoWidth,
          height: video.videoHeight
        });
      }
    }
  }

  onVideoCanPlay(): void {
    this.videoReady.set(true);
  }

  togglePlayPause(): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (!video) {
      console.warn('[VideoEvent] togglePlayPause: No video element');
      return;
    }

    console.log('[VideoEvent] togglePlayPause:', {
      paused: video.paused,
      readyState: video.readyState,
      networkState: video.networkState,
      currentSrc: video.currentSrc
    });

    if (video.paused) {
      video.play().catch((error) => {
        console.error('[VideoEvent] Play failed:', error);
      });
    } else {
      video.pause();
      console.log('[VideoEvent] Pause called, video.paused is now:', video.paused);
    }
  }

  onSeek(time: number): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      video.currentTime = time;
    }
  }

  onVolumeChange(volume: number): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      video.volume = volume;
      if (video.muted && volume > 0) {
        video.muted = false;
      }
    }
  }

  onMuteToggle(): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      video.muted = !video.muted;
    }
  }

  onPlaybackRateChange(rate: number): void {
    const video = this.videoPlayerRef?.nativeElement;
    if (video) {
      video.playbackRate = rate;
    }
  }

  toggleFullscreen(): void {
    const container = this.hostElement.nativeElement.querySelector('.video-player-container');
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch(() => { /* Fullscreen not supported */ });
    }
  }

  async togglePictureInPicture(): Promise<void> {
    const video = this.videoPlayerRef?.nativeElement;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP not supported or failed
    }
  }

  async castToDevice(): Promise<void> {
    const video = this.videoPlayerRef?.nativeElement;
    if (!video) {
      console.log('Cast: No video element available');
      return;
    }

    const videoInfo = this.videoData();
    await this.castService.castVideoElement(
      video,
      videoInfo?.title,
      videoInfo?.thumbnail
    );
  }

  // Methods to trigger controls visibility from parent container hover
  onVideoContainerMouseEnter(): void {
    this.videoControlsRef?.showControls();
  }

  onVideoContainerMouseLeave(): void {
    // Let the controls auto-hide logic handle this
  }

  onVideoContainerMouseMove(): void {
    this.videoControlsRef?.showControls();
  }

  revealMedia(): void {
    this.isRevealed.set(true);
  }

  // Trust author for media reveal (always show their media without blur)
  trustAuthor(): void {
    const currentUserPubkey = this.accountState.pubkey();
    const authorPubkey = this.event().pubkey;
    if (currentUserPubkey && authorPubkey) {
      this.accountLocalState.addTrustedMediaAuthor(currentUserPubkey, authorPubkey);
      // Also reveal the current media immediately
      this.isRevealed.set(true);
    }
  }

  openEventPage(): void {
    const event = this.event();
    if (event) {
      // If showOverlay is true, open the split-view dialog
      if (this.showOverlay()) {
        this.dialog.open(MediaWithCommentsDialogComponent, {
          data: {
            event,
            allEvents: this.allMediaEvents().length > 0 ? this.allMediaEvents() : undefined,
            currentIndex: this.mediaEventIndex(),
            trustedByPubkey: this.trustedByPubkey()
          },
          maxWidth: '95vw',
          maxHeight: '95vh',
          width: '1400px',
          height: '90vh',
          panelClass: 'media-with-comments-dialog',
        });
      } else {
        this.router.navigate(['/e', event.id]);
      }
    }
  }

  private getVideoData(event: Event): VideoData | null {
    // For kind 21, 22, 34235, and 34236 events (NIP-71), extract video data from 'imeta' tags
    if (event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');

      console.log('Video event kind:', event.kind, 'imeta tags:', imetaTags);

      // If imeta tags exist, parse them
      if (imetaTags.length > 0) {
        // Use the first imeta tag for primary video data
        const primaryImeta = imetaTags[0];
        const parsed = this.parseImetaTag(primaryImeta);

        // Get placeholder data with dimensions from the service
        const placeholderData = this.imagePlaceholder.extractPlaceholderFromImeta(primaryImeta);

        console.log('Parsed imeta tag:', parsed);

        if (parsed['url']) {
          // Get duration from dedicated duration tag
          const durationTag = event.tags.find(tag => tag[0] === 'duration');
          const altTag = event.tags.find(tag => tag[0] === 'alt');
          const titleTag = event.tags.find(tag => tag[0] === 'title');

          const videoData: VideoData = {
            url: parsed['url'],
            thumbnail: parsed['image'],
            blurhash: placeholderData.blurhash || parsed['blurhash'],
            thumbhash: placeholderData.thumbhash,
            dimensions: placeholderData.dimensions,
            duration: durationTag?.[1] ? parseInt(durationTag[1], 10) : undefined,
            title: titleTag?.[1],
            alt: altTag?.[1] || parsed['alt'],
          };

          console.log('Video data:', videoData);

          return videoData;
        }
      }

      // Fallback: Try to get video URL from 'src' or 'url' tag (some events don't use imeta)
      const srcTag = event.tags.find(tag => tag[0] === 'src');
      const urlTag = event.tags.find(tag => tag[0] === 'url');
      const videoUrl = srcTag?.[1] || urlTag?.[1];

      if (videoUrl) {
        const imageTag = event.tags.find(tag => tag[0] === 'image');
        const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
        const blurhashTag = event.tags.find(tag => tag[0] === 'blurhash');
        const thumbhashTag = event.tags.find(tag => tag[0] === 'thumbhash');
        const durationTag = event.tags.find(tag => tag[0] === 'duration');
        const titleTag = event.tags.find(tag => tag[0] === 'title');
        const altTag = event.tags.find(tag => tag[0] === 'alt');

        return {
          url: videoUrl,
          thumbnail: thumbTag?.[1] || imageTag?.[1],
          blurhash: blurhashTag?.[1],
          thumbhash: thumbhashTag?.[1],
          duration: durationTag?.[1] ? parseInt(durationTag[1], 10) : undefined,
          title: titleTag?.[1],
          alt: altTag?.[1],
        };
      }

      console.warn('No video URL found in event');
      return null;
    } else {
      // Fallback for other event types
      const urlTag = event.tags.find(tag => tag[0] === 'url');
      const imageTag = event.tags.find(tag => tag[0] === 'image');
      const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
      const blurhashTag = event.tags.find(tag => tag[0] === 'blurhash');
      const durationTag = event.tags.find(tag => tag[0] === 'duration');
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const altTag = event.tags.find(tag => tag[0] === 'alt');

      if (!urlTag?.[1]) return null;

      return {
        url: urlTag[1],
        thumbnail: thumbTag?.[1] || imageTag?.[1],
        blurhash: blurhashTag?.[1],
        duration: durationTag?.[1] ? parseInt(durationTag[1], 10) : undefined,
        title: titleTag?.[1],
        alt: altTag?.[1],
      };
    }
  }

  private getEventTitle(event: Event): string | null {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  }

  private removeHashtagsFromContent(content: string): string {
    return content.replace(/#\w+/g, '').trim();
  }

  private parseImetaTag(imetaTag: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};

    for (let i = 1; i < imetaTag.length; i++) {
      const part = imetaTag[i];
      if (!part) continue;

      // Find the first space to separate key from value
      const spaceIndex = part.indexOf(' ');
      if (spaceIndex > 0) {
        const key = part.substring(0, spaceIndex);
        const value = part.substring(spaceIndex + 1);

        // For 'url' key, prefer the first occurrence (usually the direct MP4)
        // Don't overwrite if we already have a value
        if (key === 'url' && parsed[key]) {
          continue;
        }

        parsed[key] = value;
      }
    }

    return parsed;
  }

  /**
   * Generate a placeholder data URL - supports both blurhash and thumbhash
   * @deprecated Use imagePlaceholder service directly instead
   * Note: Placeholder is decoded at small size for performance - CSS scales it up
   */
  generateBlurhashDataUrl(placeholder: string, width = 32, height = 32): string {
    return this.imagePlaceholder.generatePlaceholderDataUrl(placeholder, width, height);
  }

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Determines the correct MIME type based on the video file extension
   * Modern .mov files are typically MPEG-4 videos that can be played by modern browsers
   */
  private getMimeTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();

    // Extract file extension
    const extension = urlLower.split('?')[0].split('#')[0].split('.').pop();

    // Map file extensions to MIME types
    const mimeTypeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'm4v': 'video/mp4',
      'mov': 'video/mp4', // Modern .mov files are usually MPEG-4
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
      'avi': 'video/x-msvideo',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'mkv': 'video/x-matroska',
      '3gp': 'video/3gpp',
      '3g2': 'video/3gpp2',
    };

    // Return the MIME type or default to mp4
    return mimeTypeMap[extension || ''] || 'video/mp4';
  }
}
