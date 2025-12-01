import { Component, inject, signal, computed } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Event } from 'nostr-tools';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { BookmarkService } from '../../services/bookmark.service';
import { ImageDialogComponent } from '../image-dialog/image-dialog.component';
import { MediaPreviewDialogComponent } from '../media-preview-dialog/media-preview.component';
import { EventMenuComponent } from '../event/event-menu/event-menu.component';

interface MediaWithCommentsDialogData {
  event: Event;
  // Optional: for navigation between media items
  allEvents?: Event[];
  currentIndex?: number;
}

interface VideoData {
  url: string;
  thumbnail?: string;
  blurhash?: string;
  duration?: number;
  title?: string;
  alt?: string;
}

@Component({
  selector: 'app-media-with-comments-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    CommentsListComponent,
    EventMenuComponent
],
  templateUrl: './media-with-comments-dialog.component.html',
  styleUrl: './media-with-comments-dialog.component.scss',
})
export class MediaWithCommentsDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaWithCommentsDialogComponent>);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  data: MediaWithCommentsDialogData = inject(MAT_DIALOG_DATA);
  bookmark = inject(BookmarkService);

  constructor() {
    // Close dialog on navigation (e.g., when clicking a profile)
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart),
      takeUntilDestroyed()
    ).subscribe(() => {
      this.dialogRef.close();
    });
  }

  // Navigation support
  allEvents = signal<Event[]>(this.data.allEvents || [this.data.event]);
  currentIndex = signal<number>(this.data.currentIndex ?? 0);

  // Initialize event from the correct index in allEvents array
  event = signal<Event>(
    this.data.allEvents && this.data.currentIndex !== undefined
      ? this.data.allEvents[this.data.currentIndex]
      : this.data.event
  );

  hasNavigation = computed(() => this.allEvents().length > 1);
  canGoPrevious = computed(() => this.currentIndex() > 0);
  canGoNext = computed(() => this.currentIndex() < this.allEvents().length - 1);

  // Touch gesture support
  private touchStartX = 0;
  private touchStartY = 0;
  private touchEndX = 0;
  private touchEndY = 0;
  private minSwipeDistance = 50;

  // Determine media type from event kind
  isPhoto = computed(() => {
    const ev = this.event();
    return ev.kind === 20; // NIP-68 Photo event
  });

  isVideo = computed(() => {
    const ev = this.event();
    return ev.kind === 21 || ev.kind === 22 || ev.kind === 34235 || ev.kind === 34236; // NIP-71 Video events (21, 22) and Addressable Video events (34235, 34236)
  });

  // Photo data
  imageUrls = computed(() => {
    const event = this.event();
    if (!this.isPhoto() || !event) return [];
    return this.getImageUrls(event);
  });

  currentImageIndex = signal(0);

  currentImageUrl = computed(() => {
    const urls = this.imageUrls();
    const index = this.currentImageIndex();
    return urls[index] || urls[0];
  });

  hasMultipleImages = computed(() => this.imageUrls().length > 1);
  canGoToPrevious = computed(() => this.currentImageIndex() > 0);
  canGoToNext = computed(() => this.currentImageIndex() < this.imageUrls().length - 1);

  // Video data
  videoData = computed(() => {
    const event = this.event();
    if (!this.isVideo() || !event) return null;
    return this.getVideoData(event);
  });

  videoMimeType = computed(() => {
    const videoInfo = this.videoData();
    if (!videoInfo?.url) return 'video/mp4';
    return this.getMimeTypeFromUrl(videoInfo.url);
  });

  // Common data
  title = computed(() => {
    const event = this.event();
    if (!event) return null;
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || null;
  });

  description = computed(() => {
    const event = this.event();
    if (!event || !event.content) return null;
    return event.content.replace(/#\w+/g, '').trim();
  });

  // Hashtags
  hashtags = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1]);
  });

  // Navigation methods for photo carousel
  goToPrevious(): void {
    if (this.canGoToPrevious()) {
      this.currentImageIndex.update(i => i - 1);
    }
  }

  goToNext(): void {
    if (this.canGoToNext()) {
      this.currentImageIndex.update(i => i + 1);
    }
  }

  goToIndex(index: number): void {
    if (index >= 0 && index < this.imageUrls().length) {
      this.currentImageIndex.set(index);
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  async toggleBookmark(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const nostrEvent = this.event();
    if (nostrEvent) {
      await this.bookmark.toggleBookmark(nostrEvent.id);
    }
  }

  openImagePreview(): void {
    const imageUrls = this.imageUrls();
    const currentIndex = this.currentImageIndex();

    if (imageUrls.length > 1) {
      // Multiple images - use MediaPreviewDialogComponent
      const mediaItems = imageUrls.map((url, index) => ({
        url,
        type: 'image/jpeg',
        title: this.title() || `Photo ${index + 1}`,
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
    } else if (imageUrls.length === 1) {
      // Single image - use ImageDialogComponent
      this.dialog.open(ImageDialogComponent, {
        data: {
          imageUrl: imageUrls[0],
          alt: this.title() || 'Photo'
        },
        maxWidth: '95vw',
        maxHeight: '95vh',
        panelClass: 'image-dialog-panel',
      });
    }
  }

  // Navigation between media items
  goToPreviousMedia(): void {
    if (this.canGoPrevious()) {
      const newIndex = this.currentIndex() - 1;
      this.currentIndex.set(newIndex);
      this.event.set(this.allEvents()[newIndex]);
      this.currentImageIndex.set(0); // Reset to first image in carousel
    }
  }

  goToNextMedia(): void {
    if (this.canGoNext()) {
      const newIndex = this.currentIndex() + 1;
      this.currentIndex.set(newIndex);
      this.event.set(this.allEvents()[newIndex]);
      this.currentImageIndex.set(0); // Reset to first image in carousel
    }
  }

  // Touch/swipe gesture handlers
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0].screenX;
    this.touchStartY = event.changedTouches[0].screenY;
  }

  onTouchEnd(event: TouchEvent): void {
    this.touchEndX = event.changedTouches[0].screenX;
    this.touchEndY = event.changedTouches[0].screenY;
    this.handleSwipe();
  }

  private handleSwipe(): void {
    const deltaX = this.touchEndX - this.touchStartX;
    const deltaY = this.touchEndY - this.touchStartY;

    // Only handle horizontal swipes (ignore vertical scrolling)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > this.minSwipeDistance) {
      if (deltaX > 0) {
        // Swipe right - go to previous
        this.goToPreviousMedia();
      } else {
        // Swipe left - go to next
        this.goToNextMedia();
      }
    }
  }

  // Keyboard navigation
  onKeyDown(event: KeyboardEvent): void {
    if (!this.hasNavigation()) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.goToPreviousMedia();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.goToNextMedia();
    }
  }

  // Helper methods for extracting media data
  private getImageUrls(event: Event): string[] {
    const imageUrls: string[] = [];

    if (event.kind === 20) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      for (const imetaTag of imetaTags) {
        const parsed = this.parseImetaTag(imetaTag);
        if (parsed['url']) {
          imageUrls.push(parsed['url']);
        }
      }
    } else {
      const imageTags = event.tags.filter(tag => tag[0] === 'image' || tag[0] === 'url');
      for (const tag of imageTags) {
        if (tag[1]) {
          imageUrls.push(tag[1]);
        }
      }
    }

    return [...new Set(imageUrls)];
  }

  private getVideoData(event: Event): VideoData | null {
    if (event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
      const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
      if (imetaTags.length === 0) return null;

      const primaryImeta = imetaTags[0];
      const parsed = this.parseImetaTag(primaryImeta);
      if (!parsed['url']) return null;

      const durationTag = event.tags.find(tag => tag[0] === 'duration');
      const altTag = event.tags.find(tag => tag[0] === 'alt');
      const titleTag = event.tags.find(tag => tag[0] === 'title');

      return {
        url: parsed['url'],
        thumbnail: parsed['image'],
        blurhash: parsed['blurhash'],
        duration: durationTag?.[1] ? parseInt(durationTag[1], 10) : undefined,
        title: titleTag?.[1],
        alt: altTag?.[1] || parsed['alt'],
      };
    } else {
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

  private parseImetaTag(imetaTag: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (let i = 1; i < imetaTag.length; i++) {
      const part = imetaTag[i];
      if (!part) continue;
      const spaceIndex = part.indexOf(' ');
      if (spaceIndex > 0) {
        const key = part.substring(0, spaceIndex);
        const value = part.substring(spaceIndex + 1);
        parsed[key] = value;
      }
    }
    return parsed;
  }

  private getMimeTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();
    const extension = urlLower.split('?')[0].split('#')[0].split('.').pop();

    const mimeTypeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'm4v': 'video/mp4',
      'mov': 'video/mp4',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
    };

    return mimeTypeMap[extension || ''] || 'video/mp4';
  }

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Check if the current event has a geohash tag
   */
  hasGeohash(): boolean {
    const ev = this.event();
    if (!ev || !ev.tags) return false;
    return ev.tags.some(tag => tag[0] === 'g');
  }

  /**
   * Get the geohash value from the current event
   */
  getGeohash(): string | null {
    const ev = this.event();
    if (!ev || !ev.tags) return null;
    const geohashTag = ev.tags.find(tag => tag[0] === 'g');
    return geohashTag?.[1] || null;
  }

  /**
   * Get the geohash URL for the current event
   */
  getGeohashUrl(): string | null {
    const geohash = this.getGeohash();
    if (!geohash) return null;
    return `https://geohash.softeng.co/${geohash}`;
  }
}
