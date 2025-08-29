import { Component, inject, signal, computed } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';
import { ProfileStateService } from '../../../services/profile-state.service';
import { NostrRecord } from '../../../interfaces';

@Component({
  selector: 'app-profile-media',
  standalone: true,
  imports: [MatIconModule, MatGridListModule, LoadingOverlayComponent],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss',
})
export class ProfileMediaComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private profileState = inject(ProfileStateService);

  isLoading = signal(true);
  error = signal<string | null>(null);

  // Get media from profile state service
  media = computed(() => this.profileState.sortedMedia());

  constructor() {
    // Load media when component is initialized
    this.loadMedia();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadMedia(): Promise<void> {
    const pubkey = this.getPubkey();

    if (!pubkey) {
      this.error.set('No pubkey provided');
      this.isLoading.set(false);
      return;
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      // Set the current profile pubkey which will trigger data loading in ProfileStateService
      this.profileState.setCurrentProfilePubkey(pubkey);

      // The media will be automatically populated through the computed signal
      // Wait a bit for the initial load to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      this.logger.debug('Media loading initiated for pubkey:', pubkey);
    } catch (err) {
      this.logger.error('Error loading media:', err);
      this.error.set('Failed to load media');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Extract media URL from Nostr event
   */
  getMediaUrl(mediaItem: NostrRecord): string {
    // Look for URL in event content first
    if (mediaItem.event.content && mediaItem.event.content.trim()) {
      // If content contains a URL, use it
      const urlMatch = mediaItem.event.content.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        return urlMatch[0];
      }
    }

    // Look for URL in tags (common pattern: ["url", "https://..."])
    const urlTag = mediaItem.event.tags?.find((tag: string[]) => tag[0] === 'url');
    if (urlTag && urlTag[1]) {
      return urlTag[1];
    }

    // Look for image tag (common pattern: ["image", "https://..."])
    const imageTag = mediaItem.event.tags?.find((tag: string[]) => tag[0] === 'image');
    if (imageTag && imageTag[1]) {
      return imageTag[1];
    }

    // Fallback to a placeholder
    return 'https://via.placeholder.com/300x300?text=Media';
  }

  /**
   * Extract media description from Nostr event
   */
  getMediaDescription(mediaItem: NostrRecord): string {
    // Look for alt tag first
    const altTag = mediaItem.event.tags?.find((tag: string[]) => tag[0] === 'alt');
    if (altTag && altTag[1]) {
      return altTag[1];
    }

    // Look for summary tag
    const summaryTag = mediaItem.event.tags?.find((tag: string[]) => tag[0] === 'summary');
    if (summaryTag && summaryTag[1]) {
      return summaryTag[1];
    }

    // Use content if it doesn't look like a URL
    if (mediaItem.event.content && !mediaItem.event.content.match(/^https?:\/\//)) {
      return mediaItem.event.content.substring(0, 100);
    }

    // Fallback based on event kind
    const kindNames = { 20: 'Image', 21: 'Video', 22: 'Media' };
    return kindNames[mediaItem.event.kind as keyof typeof kindNames] || 'Media';
  }

  /**
   * Get video thumbnail (fallback to media URL for now)
   */
  getVideoThumbnail(mediaItem: NostrRecord): string {
    // Look for thumbnail tag
    const thumbnailTag = mediaItem.event.tags?.find((tag: string[]) => tag[0] === 'thumb');
    if (thumbnailTag && thumbnailTag[1]) {
      return thumbnailTag[1];
    }

    // For now, return a placeholder for video thumbnails
    return 'https://via.placeholder.com/300x300?text=Video';
  }
}
