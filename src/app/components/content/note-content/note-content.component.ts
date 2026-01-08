import { Component, input, inject, effect, signal, ViewContainerRef, OnDestroy, computed } from '@angular/core';
import { Router, NavigationStart, RouterLink } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { UtilitiesService } from '../../../services/utilities.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MediaPreviewDialogComponent } from '../../media-preview-dialog/media-preview.component';
import { ContentToken } from '../../../services/parsing.service';
import { FormatService } from '../../../services/format/format.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../../user-profile/hover-card/profile-hover-card.component';
import { CashuTokenComponent } from '../../cashu-token/cashu-token.component';
import { AudioPlayerComponent } from '../../audio-player/audio-player.component';
import { InlineVideoPlayerComponent } from '../../inline-video-player/inline-video-player.component';
import { SettingsService } from '../../../services/settings.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { VideoPlaybackService } from '../../../services/video-playback.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { PhotoEventComponent } from '../../event-types/photo-event.component';
import { EventHeaderComponent } from '../../event/header/header.component';
import { Event as NostrEvent } from 'nostr-tools';
import { ExternalLinkHandlerService } from '../../../services/external-link-handler.service';

// Type for grouped display items - either single token or image group
export interface DisplayItem {
  type: 'single' | 'image-group';
  token?: ContentToken;
  images?: ContentToken[];
  id: number;
}

@Component({
  selector: 'app-note-content',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule, MatButtonModule, CashuTokenComponent, AudioPlayerComponent, InlineVideoPlayerComponent, PhotoEventComponent, EventHeaderComponent, RouterLink],
  templateUrl: './note-content.component.html',
  styleUrl: './note-content.component.scss',
})
export class NoteContentComponent implements OnDestroy {
  contentTokens = input<ContentToken[]>([]);
  authorPubkey = input<string | undefined>(undefined);
  // Pubkey of someone who shared/reposted this content - if trusted, media should be revealed
  trustedByPubkey = input<string | undefined>(undefined);

  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private dialog = inject(MatDialog);
  private formatService = inject(FormatService);
  private sanitizer = inject(DomSanitizer);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);
  private settings = inject(SettingsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private videoPlayback = inject(VideoPlaybackService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private externalLinkHandler = inject(ExternalLinkHandlerService);

  // Store rendered HTML for nevent/note previews
  private eventPreviewsMap = signal<Map<number, SafeHtml>>(new Map());

  // Store raw events for special rendering (e.g., kind 20 photos with carousel/blurhash)
  private eventDataMap = signal<Map<number, NostrEvent>>(new Map());

  // Track loading state for each event preview
  private eventLoadingMap = signal<Map<number, 'loading' | 'loaded' | 'failed'>>(new Map());

  // Track last processed tokens to prevent redundant re-execution
  private lastProcessedTokens: ContentToken[] = [];

  // Hover card overlay
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private hoverTimeout?: number;
  private closeTimeout?: number;
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);
  private routerSubscription?: Subscription;

  // Image blur state - use default placeholder instead of generating for performance
  private revealedImages = signal<Set<string>>(new Set());

  // Track loaded images for progressive loading
  private loadedImages = signal<Set<string>>(new Set());

  // Carousel state for image groups - maps group ID to current index
  private carouselIndices = signal<Map<number, number>>(new Map());

  // Touch tracking for swipe gestures (horizontal and vertical)
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Computed: Group consecutive images into display items for Instagram-style carousel
  // Images separated only by linebreaks or whitespace are treated as a single group
  displayItems = computed<DisplayItem[]>(() => {
    const tokens = this.contentTokens();
    const items: DisplayItem[] = [];
    let currentImageGroup: ContentToken[] = [];
    let pendingLinebreaks: ContentToken[] = [];
    let groupIdCounter = 0;

    for (const token of tokens) {
      const isImage = token.type === 'image' || token.type === 'base64-image';
      const isLinebreak = token.type === 'linebreak';
      // Check if it's a whitespace-only text token (spaces between images)
      const isWhitespaceOnly = token.type === 'text' && token.content.trim() === '';

      if (isImage) {
        // Add to current image group, discard any pending linebreaks/whitespace between images
        currentImageGroup.push(token);
        pendingLinebreaks = [];
      } else if ((isLinebreak || isWhitespaceOnly) && currentImageGroup.length > 0) {
        // We're in an image group and hit a linebreak or whitespace - save it temporarily
        // in case more images follow
        pendingLinebreaks.push(token);
      } else {
        // Non-image, non-linebreak token (or linebreak with no prior images)
        // Flush any accumulated images as a group
        if (currentImageGroup.length > 0) {
          items.push({
            type: 'image-group',
            images: [...currentImageGroup],
            id: groupIdCounter++,
          });
          currentImageGroup = [];
        }

        // Add any pending linebreaks that weren't followed by more images
        for (const lb of pendingLinebreaks) {
          items.push({
            type: 'single',
            token: lb,
            id: groupIdCounter++,
          });
        }
        pendingLinebreaks = [];

        // Add non-image token as single item
        items.push({
          type: 'single',
          token,
          id: groupIdCounter++,
        });
      }
    }

    // Flush any remaining images
    if (currentImageGroup.length > 0) {
      items.push({
        type: 'image-group',
        images: [...currentImageGroup],
        id: groupIdCounter++,
      });
    }

    // Don't add trailing linebreaks - they create wasted space at the end of events

    // Remove any trailing linebreaks from the items array
    while (items.length > 0) {
      const lastItem = items[items.length - 1];
      if (lastItem.type === 'single' && lastItem.token?.type === 'linebreak') {
        items.pop();
      } else {
        break;
      }
    }

    return items;
  });

  // Computed: Should blur images based on privacy settings
  shouldBlurImages = computed(() => {
    const currentUserPubkey = this.accountState.pubkey();

    // If user is logged in but settings haven't loaded yet, blur for safety
    if (currentUserPubkey && !this.settings.settingsLoaded()) {
      return true;
    }

    const mediaPrivacy = this.settings.settings().mediaPrivacy || 'show-always';

    if (mediaPrivacy === 'show-always') {
      return false;
    }

    // Check if author is trusted for media reveal (trackChanges=true for reactivity)
    const authorPubkey = this.authorPubkey();
    if (currentUserPubkey) {
      if (authorPubkey) {
        const isTrusted = this.accountLocalState.isMediaAuthorTrusted(currentUserPubkey, authorPubkey, true);
        if (isTrusted) {
          return false;
        }
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

    if (mediaPrivacy === 'blur-always') {
      return true;
    }

    // blur-non-following
    if (!authorPubkey) return false;

    const isFollowing = followingList.includes(authorPubkey);
    return !isFollowing;
  });

  constructor() {
    // When tokens change, fetch event previews for nevent/note types
    effect(() => {
      const tokens = this.contentTokens();

      // Only process if tokens actually changed (not just reference change)
      if (this.tokensHaveChanged(tokens)) {
        this.lastProcessedTokens = [...tokens];
        this.loadEventPreviews(tokens);
      }
    });

    // Close hover card on navigation
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        this.closeHoverCard();
      });
  }

  /**
   * Check if tokens have actually changed by comparing their content
   */
  private tokensHaveChanged(newTokens: ContentToken[]): boolean {
    // If length changed, definitely changed
    if (newTokens.length !== this.lastProcessedTokens.length) {
      return true;
    }

    // Compare each token by id and type (shallow comparison is enough)
    for (let i = 0; i < newTokens.length; i++) {
      const newToken = newTokens[i];
      const oldToken = this.lastProcessedTokens[i];

      if (newToken.id !== oldToken.id || newToken.type !== oldToken.type) {
        return true;
      }
    }

    return false;
  }

  private async loadEventPreviews(tokens: ContentToken[]): Promise<void> {
    const previewsMap = new Map<number, SafeHtml>();
    const eventDataMap = new Map<number, NostrEvent>();
    const loadingMap = new Map<number, 'loading' | 'loaded' | 'failed'>();

    // Mark all event previews as loading
    for (const token of tokens) {
      if (token.type === 'nostr-mention' && token.nostrData) {
        const { type } = token.nostrData;
        if (type === 'nevent' || type === 'note') {
          loadingMap.set(token.id, 'loading');
        }
      }
    }

    // Update loading state immediately
    this.eventLoadingMap.set(loadingMap);

    // Fetch previews
    for (const token of tokens) {
      if (token.type === 'nostr-mention' && token.nostrData) {
        const { type, data } = token.nostrData;

        if (type === 'nevent' || type === 'note') {
          try {
            const eventId = type === 'nevent' ? data.id : data;
            const authorPubkey = type === 'nevent' ? (data.author || data.pubkey) : undefined;
            const relayHints = type === 'nevent' ? data.relays : undefined;

            // First, fetch the raw event to check its kind
            const event = await this.formatService.fetchEvent(
              eventId,
              authorPubkey,
              relayHints
            );

            if (event) {
              // For kind 20 (photo) events, store the raw event for PhotoEventComponent rendering
              if (event.kind === 20) {
                eventDataMap.set(token.id, event);
                loadingMap.set(token.id, 'loaded');
              } else {
                // For other kinds, generate HTML preview
                const previewHtml = await this.formatService.fetchEventPreview(
                  eventId,
                  authorPubkey,
                  relayHints
                );

                if (previewHtml) {
                  previewsMap.set(token.id, this.sanitizer.bypassSecurityTrustHtml(previewHtml));
                  loadingMap.set(token.id, 'loaded');
                } else {
                  loadingMap.set(token.id, 'failed');
                }
              }
            } else {
              loadingMap.set(token.id, 'failed');
            }
          } catch (error) {
            console.error(`[NoteContent] Error loading preview for token ${token.id}:`, error);
            loadingMap.set(token.id, 'failed');
          }

          // Update state after each preview attempt
          this.eventPreviewsMap.set(new Map(previewsMap));
          this.eventDataMap.set(new Map(eventDataMap));
          this.eventLoadingMap.set(new Map(loadingMap));
        }
      }
    }
  }

  getEventPreview(tokenId: number): SafeHtml | undefined {
    return this.eventPreviewsMap().get(tokenId);
  }

  getEventData(tokenId: number): NostrEvent | undefined {
    return this.eventDataMap().get(tokenId);
  }

  isPhotoEvent(tokenId: number): boolean {
    const event = this.eventDataMap().get(tokenId);
    return event?.kind === 20;
  }

  getEventLoadingState(tokenId: number): 'loading' | 'loaded' | 'failed' | undefined {
    return this.eventLoadingMap().get(tokenId);
  }

  onNostrMentionClick(token: ContentToken) {
    // If nostrData is not available yet but we have the raw URI, try to parse it
    if (!token.nostrData && token.content) {
      // Extract the nostr URI and navigate based on the prefix
      const nostrUri = token.content;

      if (nostrUri.startsWith('nostr:npub') || nostrUri.startsWith('nostr:nprofile')) {
        // Extract pubkey (supports both npub and nprofile)
        const identifier = nostrUri.replace('nostr:', '');
        const hexPubkey = this.utilities.safeGetHexPubkey(identifier);
        if (hexPubkey) {
          this.router.navigate(['/p', hexPubkey]);
        } else {
          // Fallback to raw identifier if conversion fails
          this.router.navigate(['/p', identifier]);
        }
        return;
      } else if (nostrUri.startsWith('nostr:note') || nostrUri.startsWith('nostr:nevent')) {
        // Navigate to the event page using the raw note/nevent
        const identifier = nostrUri.replace('nostr:', '');
        this.router.navigate(['/e', identifier]);
        return;
      } else if (nostrUri.startsWith('nostr:naddr')) {
        // Navigate to the article page using the raw naddr
        const identifier = nostrUri.replace('nostr:', '');
        this.router.navigate(['/a', identifier]);
        return;
      }
    }

    if (!token.nostrData) return;

    const { type, data } = token.nostrData;

    switch (type) {
      case 'npub':
      case 'nprofile': {
        // Navigate to profile page
        const record = data as Record<string, unknown>;
        const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');
        this.router.navigate(['/p', this.utilities.getNpubFromPubkey(pubkey)]);
        break;
      }
      case 'note':
      default:
        console.warn('Unsupported nostr URI type:', type);
    }
  }

  getVideoType(url: string): string {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    switch (extension) {
      case 'mp4':
      case 'm4v':
        return 'mp4';
      case 'webm':
        return 'webm';
      case 'mov':
        // Modern .mov files are typically MPEG-4 encoded and can be played as mp4
        return 'mp4';
      case 'avi':
        return 'x-msvideo';
      case 'wmv':
        return 'x-ms-wmv';
      case 'flv':
        return 'x-flv';
      case 'mkv':
        return 'x-matroska';
      case 'ogg':
      case 'ogv':
        return 'ogg';
      default:
        return 'mp4';
    }
  }

  /**
   * Check if a video format is likely to be supported by modern browsers
   * Modern .mov files are typically MPEG-4 encoded and can be played by browsers
   */
  isVideoFormatSupported(url: string): boolean {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    // MP4, WebM, and modern MOV files have good cross-browser support
    // Modern .mov files are typically MPEG-4 which browsers can play
    return extension === 'mp4' || extension === 'webm' || extension === 'mov' || extension === 'm4v';
  }

  /**
   * Handle video load errors by showing a download link
   */
  onVideoError(event: Event, videoUrl: string): void {
    const target = event.target as HTMLVideoElement;
    if (target) {
      console.warn('Video failed to load:', videoUrl);
      // The template will handle showing the fallback
    }
  }

  /**
   * Handle video play event - register this video as currently playing
   * so other videos get paused.
   */
  onVideoPlay(event: Event): void {
    const videoElement = event.target as HTMLVideoElement;
    if (videoElement) {
      this.videoPlayback.registerPlaying(videoElement);
    }
  }

  /**
   * Handle video pause event - unregister this video so wake lock
   * can be released.
   */
  onVideoPause(event: Event): void {
    const videoElement = event.target as HTMLVideoElement;
    if (videoElement) {
      this.videoPlayback.unregisterPlaying(videoElement);
    }
  }

  // ============ Image Carousel Methods ============

  /**
   * Get current carousel index for an image group
   */
  getCarouselIndex(groupId: number): number {
    return this.carouselIndices().get(groupId) || 0;
  }

  /**
   * Navigate to previous image in carousel
   */
  goToPrevious(groupId: number, images: ContentToken[]): void {
    const currentIndex = this.getCarouselIndex(groupId);
    if (currentIndex > 0) {
      this.setCarouselIndex(groupId, currentIndex - 1);
    }
  }

  /**
   * Navigate to next image in carousel
   */
  goToNext(groupId: number, images: ContentToken[]): void {
    const currentIndex = this.getCarouselIndex(groupId);
    if (currentIndex < images.length - 1) {
      this.setCarouselIndex(groupId, currentIndex + 1);
    }
  }

  /**
   * Set carousel index for a specific group
   */
  setCarouselIndex(groupId: number, index: number): void {
    this.carouselIndices.update(map => {
      const newMap = new Map(map);
      newMap.set(groupId, index);
      return newMap;
    });
  }

  /**
   * Check if can go to previous image
   */
  canGoToPrevious(groupId: number): boolean {
    return this.getCarouselIndex(groupId) > 0;
  }

  /**
   * Check if can go to next image
   */
  canGoToNext(groupId: number, images: ContentToken[]): boolean {
    return this.getCarouselIndex(groupId) < images.length - 1;
  }

  /**
   * Handle touch start for swipe gestures
   */
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0].clientX;
    this.touchStartY = event.touches[0].clientY;
  }

  /**
   * Handle touch end for swipe gestures (horizontal and vertical)
   */
  onTouchEnd(event: TouchEvent, groupId: number, images: ContentToken[]): void {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const diffX = this.touchStartX - touchEndX;
    const diffY = this.touchStartY - touchEndY;

    // Determine if swipe is more horizontal or vertical
    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);

    if (absX > this.SWIPE_THRESHOLD || absY > this.SWIPE_THRESHOLD) {
      if (absX >= absY) {
        // Horizontal swipe
        if (diffX > 0) {
          // Swipe left - go to next
          this.goToNext(groupId, images);
        } else {
          // Swipe right - go to previous
          this.goToPrevious(groupId, images);
        }
      } else {
        // Vertical swipe
        if (diffY > 0) {
          // Swipe up - go to next
          this.goToNext(groupId, images);
        } else {
          // Swipe down - go to previous
          this.goToPrevious(groupId, images);
        }
      }
    }
  }

  /**
   * Open image dialog for carousel - supports multi-image preview
   */
  openCarouselImageDialog(images: ContentToken[], currentIndex: number): void {
    // If image should be blurred and not revealed, reveal all images in the carousel
    const currentImage = images[currentIndex];
    if (this.shouldBlurImages() && !this.isImageRevealed(currentImage.content)) {
      this.revealAllImages(images);
      return;
    }

    if (images.length > 1) {
      // Multiple images - use MediaPreviewDialogComponent for carousel view
      const mediaItems = images.map((img, index) => ({
        url: img.content,
        type: 'image/jpeg',
        title: `Image ${index + 1}`,
      }));

      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaItems,
          initialIndex: currentIndex,
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
      });
    } else {
      // Single image - use unified MediaPreviewDialogComponent
      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaItems: [{ url: images[0].content, type: 'image/jpeg', title: 'Image' }],
          initialIndex: 0,
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
      });
    }
  }

  /**
   * Opens an image dialog to view the image with zoom capabilities
   */
  openImageDialog(imageUrl: string): void {
    // If image should be blurred and not revealed, reveal it instead
    if (this.shouldBlurImages() && !this.isImageRevealed(imageUrl)) {
      this.revealImage(imageUrl);
      return;
    }

    console.log('Opening image dialog for URL:', imageUrl);
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: [{ url: imageUrl, type: 'image/jpeg', title: 'Image' }],
        initialIndex: 0,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  /**
   * Check if an image is revealed
   */
  isImageRevealed(imageUrl: string): boolean {
    return this.revealedImages().has(imageUrl);
  }

  /**
   * Reveal a blurred image
   */
  revealImage(imageUrl: string): void {
    this.revealedImages.update(set => {
      const newSet = new Set(set);
      newSet.add(imageUrl);
      return newSet;
    });
  }

  /**
   * Reveal all images in a group (for carousels)
   * When user clicks reveal on one image, reveal all images in the post
   */
  revealAllImages(images: ContentToken[]): void {
    this.revealedImages.update(set => {
      const newSet = new Set(set);
      for (const image of images) {
        if (image.content) {
          newSet.add(image.content);
        }
      }
      return newSet;
    });
  }

  /**
   * Trust author for media reveal (always show their media without blur)
   */
  trustAuthor(): void {
    const currentUserPubkey = this.accountState.pubkey();
    const authorPubkey = this.authorPubkey();
    if (currentUserPubkey && authorPubkey) {
      this.accountLocalState.addTrustedMediaAuthor(currentUserPubkey, authorPubkey);
      // Also reveal all media in the current content immediately
      const tokens = this.contentTokens();
      this.revealedImages.update(set => {
        const newSet = new Set(set);
        for (const token of tokens) {
          if (token.type === 'image' || token.type === 'video' || token.type === 'base64-video') {
            if (token.content) {
              newSet.add(token.content);
            }
          }
        }
        return newSet;
      });
    }
  }

  /**
   * Get placeholder data URL for an image - uses service for both blurhash and thumbhash support
   * @deprecated Use getImagePlaceholderUrl with token for token-specific placeholders
   */
  getBlurhashDataUrl(): string | null {
    return this.imagePlaceholder.getDefaultPlaceholderDataUrl(400, 400) || null;
  }

  /**
   * Get placeholder data URL for an image token using its imeta data
   * Note: Blurhash is decoded at small size but with correct aspect ratio for proper positioning
   */
  getImagePlaceholderUrl(token: ContentToken): string | null {
    if (!token) {
      console.warn('[NoteContent] getImagePlaceholderUrl called with null/undefined token');
      return this.imagePlaceholder.getDefaultPlaceholderDataUrl(400, 400);
    }

    // Calculate small dimensions that preserve aspect ratio
    const dims = this.imagePlaceholder.getPlaceholderDimensions(token.dimensions);
    // First try thumbhash, then blurhash from the token
    if (token.thumbhash) {
      const url = this.imagePlaceholder.decodeThumbhash(token.thumbhash);
      if (url) return url;
    }
    if (token.blurhash) {
      // Decode at small size but with correct aspect ratio
      const url = this.imagePlaceholder.decodeBlurhash(token.blurhash, dims.width, dims.height);
      if (url) return url;
    }
    // Return default placeholder
    return this.imagePlaceholder.getDefaultPlaceholderDataUrl(dims.width, dims.height);
  }

  /**
   * Get aspect ratio style for an image token
   */
  getImageAspectRatio(token: ContentToken): string | null {
    if (token.dimensions) {
      return `${token.dimensions.width} / ${token.dimensions.height}`;
    }
    return null;
  }

  /**
   * Get placeholder data URL for a video token using its imeta data
   * Note: Blurhash is decoded at small size (32x32) for performance - CSS scales it up
   */
  getVideoPlaceholderUrl(token: ContentToken): string | null {
    if (!token) {
      console.warn('[NoteContent] getVideoPlaceholderUrl called with null/undefined token');
      return this.imagePlaceholder.getDefaultPlaceholderDataUrl(32, 32);
    }

    // First try thumbhash, then blurhash from the token
    if (token.thumbhash) {
      const url = this.imagePlaceholder.decodeThumbhash(token.thumbhash);
      if (url) return url;
    }
    if (token.blurhash) {
      // Decode at small size for performance - CSS will scale it up
      const url = this.imagePlaceholder.decodeBlurhash(token.blurhash, 32, 32);
      if (url) return url;
    }
    // Return default placeholder
    return this.imagePlaceholder.getDefaultPlaceholderDataUrl(32, 32);
  }

  /**
   * Get aspect ratio style for a video token
   * Uses metadata dimensions (dim tag) for initial sizing since they represent
   * the intended display dimensions (usually calculated from rotated thumbnail)
   */
  getVideoAspectRatio(token: ContentToken): string | null {
    // Use metadata dimensions from imeta dim tag
    // These represent the intended display aspect ratio
    if (token.dimensions) {
      return `${token.dimensions.width} / ${token.dimensions.height}`;
    }

    // Fallback to actual video dimensions if metadata not available
    const actualDims = this.videoActualDimensions().get(token.content);
    if (actualDims && actualDims.width && actualDims.height) {
      return `${actualDims.width} / ${actualDims.height}`;
    }

    // Don't set a default aspect ratio - let video's natural dimensions determine size
    return null;
  }

  /**
   * Check if a video is portrait orientation (height > width)
   * Uses metadata dimensions as the source of truth for intended orientation
   */
  isPortraitVideo(token: ContentToken): boolean {
    // Use metadata dimensions - they represent intended display
    if (token.dimensions) {
      return token.dimensions.height > token.dimensions.width;
    }

    // Fallback to actual video dimensions
    const actualDims = this.videoActualDimensions().get(token.content);
    if (actualDims) {
      return actualDims.height > actualDims.width;
    }

    return false;
  }

  /**
   * Check if the video needs rotation correction
   * This happens when Blossom server strips EXIF rotation without rotating the video pixels,
   * but the thumbnail (used for dim tag) was rotated correctly.
   * Returns true if video file is landscape but dim says portrait (or vice versa)
   */
  needsRotationCorrection(token: ContentToken): boolean {
    const actualDims = this.videoActualDimensions().get(token.content);
    if (!actualDims || !token.dimensions) {
      return false;
    }

    const metadataIsPortrait = token.dimensions.height > token.dimensions.width;
    const videoIsPortrait = actualDims.height > actualDims.width;

    // If metadata says portrait but video is landscape (or vice versa), needs rotation
    return metadataIsPortrait !== videoIsPortrait;
  }

  // Track loaded videos for progressive loading
  private loadedVideos = signal<Set<string>>(new Set());

  // Track actual video dimensions after metadata loads (accounts for rotation)
  private videoActualDimensions = signal<Map<string, { width: number; height: number }>>(new Map());

  /**
   * Check if a video is ready to play (for progressive loading)
   */
  isVideoReady(videoUrl: string): boolean {
    return this.loadedVideos().has(videoUrl);
  }

  /**
   * Mark a video as ready to play (for progressive loading transition)
   */
  onVideoReady(videoUrl: string): void {
    this.loadedVideos.update(set => {
      const newSet = new Set(set);
      newSet.add(videoUrl);
      return newSet;
    });
  }

  /**
   * Handle video metadata loaded event to get actual dimensions after rotation is applied
   */
  onVideoMetadataLoaded(event: Event, videoUrl: string): void {
    const video = event.target as HTMLVideoElement;
    if (video.videoWidth && video.videoHeight) {
      this.videoActualDimensions.update(map => {
        const newMap = new Map(map);
        newMap.set(videoUrl, {
          width: video.videoWidth,
          height: video.videoHeight
        });
        return newMap;
      });
    }
  }

  /**
   * Check if an image has finished loading (for progressive loading)
   */
  isImageLoaded(imageUrl: string): boolean {
    return this.loadedImages().has(imageUrl);
  }

  /**
   * Mark an image as loaded (for progressive loading transition)
   */
  onImageLoaded(imageUrl: string): void {
    this.loadedImages.update(set => {
      const newSet = new Set(set);
      newSet.add(imageUrl);
      return newSet;
    });
  }

  /**
   * Handle mouse enter on mention link
   */
  onMentionMouseEnter(event: MouseEvent, token: ContentToken): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    this.isMouseOverTrigger.set(true);

    // Try to extract pubkey from nostrData or raw content
    let pubkey: string | undefined;

    if (token.nostrData) {
      const { type, data } = token.nostrData;
      const record = data as Record<string, unknown>;
      pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');
      console.log('[NoteContent] Mention hover - type:', type, 'pubkey:', pubkey);
    } else if (token.content) {
      // Use utilities service to extract pubkey from npub/nprofile
      const nostrUri = token.content;
      if (nostrUri.startsWith('nostr:npub') || nostrUri.startsWith('nostr:nprofile')) {
        const identifier = nostrUri.replace('nostr:', '');
        const hexPubkey = this.utilities.safeGetHexPubkey(identifier);
        if (hexPubkey) {
          pubkey = hexPubkey;
          console.log('[NoteContent] Extracted pubkey using utilities service:', pubkey);
        }
      }
    }

    if (!pubkey) {
      console.log('[NoteContent] No pubkey found');
      return;
    }

    // Close existing hover card immediately when moving to a different user
    if (this.overlayRef) {
      this.closeHoverCard();
    }

    this.hoverTimeout = setTimeout(() => {
      if (this.isMouseOverTrigger()) {
        console.log('[NoteContent] Showing hover card for pubkey:', pubkey);
        this.showMentionHoverCard(event.target as HTMLElement, pubkey!);
      }
    }, 500) as unknown as number;
  }

  /**
   * Handle mouse leave on mention link
   */
  onMentionMouseLeave(): void {
    this.isMouseOverTrigger.set(false);
    this.scheduleClose();
  }

  /**
   * Show hover card for a mention
   */
  private showMentionHoverCard(element: HTMLElement, pubkey: string): void {
    console.log('[NoteContent] showMentionHoverCard called with pubkey:', pubkey);

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions([
        {
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetY: -8,
        },
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
        },
        {
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
        },
      ])
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent, this.viewContainerRef);
    const componentRef = this.overlayRef.attach(portal);

    console.log('[NoteContent] Setting pubkey on hover card instance:', pubkey);
    componentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef = componentRef;

    // Track mouse over card
    const cardElement = this.overlayRef.overlayElement;
    cardElement.addEventListener('mouseenter', () => {
      this.isMouseOverCard.set(true);
      if (this.closeTimeout) {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
    });
    cardElement.addEventListener('mouseleave', () => {
      this.isMouseOverCard.set(false);
      this.scheduleClose();
    });
  }

  /**
   * Schedule closing of the hover card
   */
  private scheduleClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }

    this.closeTimeout = setTimeout(() => {
      // Check if menu is open
      if (this.hoverCardComponentRef?.instance?.isMenuOpen?.()) {
        this.scheduleClose(); // Reschedule
        return;
      }

      if (!this.isMouseOverTrigger() && !this.isMouseOverCard()) {
        this.closeHoverCard();
      } else {
        this.scheduleClose(); // Reschedule
      }
    }, 300) as unknown as number;
  }

  /**
   * Close the hover card
   */
  private closeHoverCard(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }

  /**
   * Clean up on component destruction
   */
  ngOnDestroy(): void {
    this.closeHoverCard();
    this.routerSubscription?.unsubscribe();
  }

  /**
   * Check if content looks like JSON (starts with { or [ and ends with } or ])
   * This helps detect malformed events that have JSON in the content field
   */
  isJsonContent(content: string): boolean {
    if (!content || content.length < 2) return false;
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  /**
   * Format JSON content for display - pretty prints if possible
   */
  formatJsonContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, just return the original content
      return content;
    }
  }

  /**
   * Handle URL click - route internally if domain is configured
   */
  onUrlClick(url: string, event: MouseEvent): void {
    const handled = this.externalLinkHandler.handleLinkClick(url, event);

    if (handled) {
      // Prevent default navigation if we handled it internally
      event.preventDefault();
      event.stopPropagation();
    }
    // Otherwise, let the browser handle it (open in new tab)
  }
}
