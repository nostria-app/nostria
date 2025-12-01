import { Component, computed, effect, inject, input, signal } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Event } from 'nostr-tools';
import { decode } from 'blurhash';
import { ImageDialogComponent } from '../image-dialog/image-dialog.component';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';
import { MediaWithCommentsDialogComponent } from '../media-with-comments-dialog/media-with-comments-dialog.component';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { SettingsService } from '../../services/settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';

@Component({
  selector: 'app-photo-event',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, CommentsListComponent],
  templateUrl: './photo-event.component.html',
  styleUrl: './photo-event.component.scss',
})
export class PhotoEventComponent {
  event = input.required<Event>();
  hideComments = input<boolean>(false);
  showOverlay = input<boolean>(false);
  // Media navigation context (for Media tab grid)
  allMediaEvents = input<Event[]>([]);
  mediaEventIndex = input<number | undefined>(undefined);

  private dialog = inject(MatDialog);
  private router = inject(Router);
  private settings = inject(SettingsService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);

  // Current carousel index for inline navigation
  currentCarouselIndex = signal(0);

  // Touch tracking for swipe gestures
  private touchStartX = 0;
  private touchEndX = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Track if media has been revealed (for blur-to-show animation)
  isRevealed = signal(false);

  // Store generated blurhashes for images without imeta blurhash
  private generatedBlurhashes = signal<Map<string, string>>(new Map());

  constructor() {
    // Generate blurhashes on-the-fly when needed
    effect(() => {
      const shouldBlur = this.shouldBlurMedia();
      const imageUrls = this.imageUrls();
      const blurhashes = this.blurhashes();

      // Only generate if we should blur and there are missing blurhashes
      if (shouldBlur) {
        imageUrls.forEach((url, index) => {
          if (!blurhashes[index] && !this.generatedBlurhashes().has(url)) {
            // Generate blurhash asynchronously
            this.generateBlurhashForImage(url);
          }
        });
      }
    });
  }

  // Computed: Should media be blurred based on privacy settings?
  shouldBlurMedia = computed(() => {
    const mediaPrivacy = this.settings.settings().mediaPrivacy || 'show-always';
    const event = this.event();

    if (mediaPrivacy === 'show-always') {
      return false;
    }

    if (mediaPrivacy === 'blur-always') {
      return !this.isRevealed();
    }

    // blur-non-following
    const authorPubkey = event.pubkey;
    const isFollowing = this.accountState.followingList().includes(authorPubkey);
    return !isFollowing && !this.isRevealed();
  });

  // Computed image URLs from the event
  imageUrls = computed(() => {
    const event = this.event();
    if (!event) return [];

    return this.getImageUrls(event);
  });

  // Computed blurhashes for all images
  blurhashes = computed(() => {
    const event = this.event();
    if (!event) return [];

    const imageUrls = this.imageUrls();
    const generated = this.generatedBlurhashes();

    return imageUrls.map((url, index) => {
      // First try to get blurhash from event tags
      const tagBlurhash = this.getBlurhash(event, index);
      if (tagBlurhash) return tagBlurhash;

      // Otherwise, use generated blurhash if available
      return generated.get(url) || null;
    });
  });

  // Computed blurhash data URLs for performance
  blurhashDataUrls = computed(() => {
    const blurhashes = this.blurhashes();
    return blurhashes.map(blurhash => (blurhash ? this.generateBlurhashDataUrl(blurhash) : null));
  });

  // Photo title
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

  // Description text (content without hashtags)
  description = computed(() => {
    const event = this.event();
    if (!event || !event.content) return null;

    return this.removeHashtagsFromContent(event.content);
  });

  // Alt text for accessibility (per image)
  altTexts = computed(() => {
    const event = this.event();
    if (!event) return [];

    const imageUrls = this.imageUrls();
    return imageUrls.map((_, index) => this.getAltText(event, index));
  });

  // Legacy single alt text for backward compatibility
  altText = computed(() => {
    const altTexts = this.altTexts();
    return altTexts[0] || 'Photo';
  });

  // Carousel navigation state
  hasMultipleImages = computed(() => this.imageUrls().length > 1);
  canGoToPrevious = computed(() => this.currentCarouselIndex() > 0);
  canGoToNext = computed(() => this.currentCarouselIndex() < this.imageUrls().length - 1);

  // Current image for carousel display
  currentImageUrl = computed(() => {
    const urls = this.imageUrls();
    const index = this.currentCarouselIndex();
    return urls[index] || urls[0];
  });

  currentAltText = computed(() => {
    const alts = this.altTexts();
    const index = this.currentCarouselIndex();
    return alts[index] || 'Photo';
  });

  currentBlurhashDataUrl = computed(() => {
    const blurhashes = this.blurhashDataUrls();
    const index = this.currentCarouselIndex();
    return blurhashes[index] || null;
  });

  // Carousel navigation methods
  goToPrevious(): void {
    if (this.canGoToPrevious()) {
      this.currentCarouselIndex.update(i => i - 1);
    }
  }

  goToNext(): void {
    if (this.canGoToNext()) {
      this.currentCarouselIndex.update(i => i + 1);
    }
  }

  goToIndex(index: number): void {
    if (index >= 0 && index < this.imageUrls().length) {
      this.currentCarouselIndex.set(index);
    }
  }

  // Reveal blurred media with animation
  revealMedia(): void {
    this.isRevealed.set(true);
  }

  // Touch event handlers for swipe
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0].screenX;
  }

  onTouchEnd(event: TouchEvent): void {
    this.touchEndX = event.changedTouches[0].screenX;
    this.handleSwipe();
  }

  private handleSwipe(): void {
    const swipeDistance = this.touchStartX - this.touchEndX;

    if (Math.abs(swipeDistance) > this.SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        // Swiped left - go to next
        this.goToNext();
      } else {
        // Swiped right - go to previous
        this.goToPrevious();
      }
    }
  }

  openImageDialog(imageUrl: string, alt: string, event?: MouseEvent | KeyboardEvent): void {
    // If media is blurred, reveal it instead of opening dialog
    if (this.shouldBlurMedia()) {
      this.revealMedia();
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      return;
    }

    // Prevent navigation when opening dialog in overlay mode
    if (this.showOverlay() && event) {
      event.stopPropagation();
      event.preventDefault();
    }

    // If showOverlay is true, open the split-view dialog with comments
    if (this.showOverlay()) {
      const nostrEvent = this.event();
      if (nostrEvent) {
        this.dialog.open(MediaWithCommentsDialogComponent, {
          data: {
            event: nostrEvent,
            allEvents: this.allMediaEvents().length > 0 ? this.allMediaEvents() : undefined,
            currentIndex: this.mediaEventIndex()
          },
          maxWidth: '95vw',
          maxHeight: '95vh',
          width: '1400px',
          height: '90vh',
          panelClass: 'media-with-comments-dialog',
        });
      }
      return;
    }

    const imageUrls = this.imageUrls();
    const altTexts = this.altTexts();

    // Find the index of the clicked image
    const clickedIndex = imageUrls.indexOf(imageUrl);

    // If there are multiple images, use MediaPreviewDialogComponent
    if (imageUrls.length > 1) {
      const mediaItems = imageUrls.map((url, index) => ({
        url,
        type: 'image/jpeg',
        title: altTexts[index] || `Photo ${index + 1}`,
      }));

      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaItems,
          initialIndex: clickedIndex >= 0 ? clickedIndex : 0,
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        panelClass: 'media-preview-dialog',
      });
    } else {
      // Single image - use existing ImageDialogComponent
      this.dialog.open(ImageDialogComponent, {
        data: { imageUrl, alt },
        maxWidth: '95vw',
        maxHeight: '95vh',
        panelClass: 'image-dialog-panel',
      });
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
            currentIndex: this.mediaEventIndex()
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

  onImageLoad(event: globalThis.Event): void {
    const target = event.target as HTMLImageElement;
    if (target && target.previousElementSibling) {
      // Hide blurhash placeholder when main image loads
      (target.previousElementSibling as HTMLElement).style.opacity = '0';
    }
  }

  getBlurhash(event: Event, imageIndex = 0): string | null {
    // For kind 20 events (NIP-68), get blurhash from 'imeta' tags
    if (event.kind === 20) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      const targetImeta = imetaTags[imageIndex];

      if (targetImeta) {
        const parsed = this.parseImetaTag(targetImeta);
        return parsed['blurhash'] || null;
      }

      return null;
    } else {
      // Fallback for other event types
      const blurhashTags = event.tags.filter(tag => tag[0] === 'blurhash');
      return blurhashTags[imageIndex]?.[1] || null;
    }
  }

  generateBlurhashDataUrl(blurhash: string, width = 400, height = 400): string {
    try {
      const pixels = decode(blurhash, width, height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);

      return canvas.toDataURL();
    } catch (error) {
      console.warn('Failed to decode blurhash:', error);
      return '';
    }
  }

  private getImageUrls(event: Event): string[] {
    const imageUrls: string[] = [];

    // For kind 20 events (NIP-68), get URLs from 'imeta' tags
    if (event.kind === 20) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');

      for (const imetaTag of imetaTags) {
        const parsed = this.parseImetaTag(imetaTag);
        if (parsed['url']) {
          imageUrls.push(parsed['url']);
        }
      }
    } else {
      // Fallback for other event types
      // Get URLs from 'url' tags (primary images)
      const urlTags = event.tags.filter(tag => tag[0] === 'url');
      imageUrls.push(...urlTags.map(tag => tag[1]));

      // Get URLs from 'image' tags (alternative images)
      const imageTags = event.tags.filter(tag => tag[0] === 'image');
      imageUrls.push(...imageTags.map(tag => tag[1]));
    }

    // Remove duplicates
    return [...new Set(imageUrls)];
  }

  private getEventTitle(event: Event): string | null {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  }

  private getAltText(event: Event, imageIndex = 0): string {
    // For kind 20 events, try to get alt text from the specific imeta tag
    if (event.kind === 20) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      const targetImeta = imetaTags[imageIndex];
      if (targetImeta) {
        const parsed = this.parseImetaTag(targetImeta);
        if (parsed['alt']) {
          return parsed['alt'];
        }
      }
    }

    // Fallback to regular alt tag or title
    const altTag = event.tags.find(tag => tag[0] === 'alt');
    return altTag?.[1] || this.getEventTitle(event) || 'Photo';
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
        parsed[key] = value;
      }
    }

    return parsed;
  }

  private async generateBlurhashForImage(url: string): Promise<void> {
    try {
      const result = await this.utilities.generateBlurhash(url, 6, 4);

      // Update the map with the generated blurhash
      this.generatedBlurhashes.update(map => {
        const newMap = new Map(map);
        newMap.set(url, result.blurhash);
        return newMap;
      });
    } catch (error) {
      console.warn('Failed to generate blurhash for image:', url, error);
    }
  }
}
