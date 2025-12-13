import { Component, input, inject, effect, signal, ViewContainerRef, OnDestroy, computed } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { UtilitiesService } from '../../../services/utilities.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { ImageDialogComponent } from '../../image-dialog/image-dialog.component';
import { MediaPreviewDialogComponent } from '../../media-preview-dialog/media-preview.component';
import { ContentToken } from '../../../services/parsing.service';
import { FormatService } from '../../../services/format/format.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../../user-profile/hover-card/profile-hover-card.component';
import { CashuTokenComponent } from '../../cashu-token/cashu-token.component';
import { AudioPlayerComponent } from '../../audio-player/audio-player.component';
import { SettingsService } from '../../../services/settings.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { VideoPlaybackService } from '../../../services/video-playback.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';

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
  imports: [MatIconModule, MatProgressSpinnerModule, MatButtonModule, CashuTokenComponent, AudioPlayerComponent],
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

  // Store rendered HTML for nevent/note previews
  private eventPreviewsMap = signal<Map<number, SafeHtml>>(new Map());

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
  // Images separated only by linebreaks are treated as a single group
  displayItems = computed<DisplayItem[]>(() => {
    const tokens = this.contentTokens();
    const items: DisplayItem[] = [];
    let currentImageGroup: ContentToken[] = [];
    let pendingLinebreaks: ContentToken[] = [];
    let groupIdCounter = 0;

    for (const token of tokens) {
      const isImage = token.type === 'image' || token.type === 'base64-image';
      const isLinebreak = token.type === 'linebreak';

      if (isImage) {
        // Add to current image group, discard any pending linebreaks between images
        currentImageGroup.push(token);
        pendingLinebreaks = [];
      } else if (isLinebreak && currentImageGroup.length > 0) {
        // We're in an image group and hit a linebreak - save it temporarily
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
    const mediaPrivacy = this.settings.settings().mediaPrivacy || 'show-always';

    if (mediaPrivacy === 'show-always') {
      return false;
    }

    // Check if author is trusted for media reveal (trackChanges=true for reactivity)
    const authorPubkey = this.authorPubkey();
    const currentUserPubkey = this.accountState.pubkey();
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
          } catch (error) {
            console.error(`[NoteContent] Error loading preview for token ${token.id}:`, error);
            loadingMap.set(token.id, 'failed');
          }

          // Update state after each preview attempt
          this.eventPreviewsMap.set(new Map(previewsMap));
          this.eventLoadingMap.set(new Map(loadingMap));
        }
      }
    }
  }

  getEventPreview(tokenId: number): SafeHtml | undefined {
    return this.eventPreviewsMap().get(tokenId);
  }

  getEventLoadingState(tokenId: number): 'loading' | 'loaded' | 'failed' | undefined {
    return this.eventLoadingMap().get(tokenId);
  }

  onNostrMentionClick(token: ContentToken) {
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
        panelClass: 'media-preview-dialog',
      });
    } else {
      // Single image - use ImageDialogComponent
      this.dialog.open(ImageDialogComponent, {
        data: { imageUrl: images[0].content },
        maxWidth: '95vw',
        maxHeight: '95vh',
        panelClass: ['image-dialog', 'responsive-dialog'],
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
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: ['image-dialog', 'responsive-dialog'],
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
   * Note: Blurhash is decoded at small size (32x32) for performance - CSS scales it up
   */
  getImagePlaceholderUrl(token: ContentToken): string | null {
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
   */
  getVideoAspectRatio(token: ContentToken): string {
    if (token.dimensions) {
      return `${token.dimensions.width} / ${token.dimensions.height}`;
    }
    return '16 / 9'; // Default video aspect ratio
  }

  // Track loaded videos for progressive loading
  private loadedVideos = signal<Set<string>>(new Set());

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

    // Only show hover card for npub/nprofile mentions
    if (!token.nostrData) {
      console.log('[NoteContent] No nostrData on token');
      return;
    }

    const { type, data } = token.nostrData;
    const record = data as Record<string, unknown>;
    const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');

    console.log('[NoteContent] Mention hover - type:', type, 'pubkey:', pubkey);

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
        this.showMentionHoverCard(event.target as HTMLElement, pubkey);
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
}
