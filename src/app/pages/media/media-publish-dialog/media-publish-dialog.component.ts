import { Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MediaItem, MediaService } from '../../../services/media.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UtilitiesService } from '../../../services/utilities.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';

export interface MediaPublishDialogData {
  mediaItem: MediaItem;
  thumbnailUrl?: string; // Optional thumbnail URL for videos
}

export interface MediaPublishOptions {
  kind: 20 | 21 | 22 | 34235 | 34236; // 20 = picture, 21 = video, 22 = short video, 34235 = addressable video, 34236 = addressable short video
  title: string;
  content: string;
  alt?: string;
  contentWarning?: string;
  hashtags: string[];
  location?: string;
  geohash?: string;
  duration?: number; // For videos (in seconds)
  thumbnailUrl?: string; // Thumbnail URL for videos
  thumbnailBlob?: Blob; // Thumbnail blob for videos (to be uploaded)
  thumbnailDimensions?: { width: number; height: number }; // Thumbnail dimensions
  blurhash?: string; // Blurhash of thumbnail or image
  thumbhash?: string; // Thumbhash of thumbnail or image (newer alternative)
  imageDimensions?: { width: number; height: number }; // Image dimensions for pictures
  dTag?: string; // For addressable events (kinds 34235, 34236) - unique identifier
  origin?: { platform: string; externalId?: string; url?: string }; // For imported content (NIP-71)
  customRelays?: string[]; // Additional custom relays to publish to
}

@Component({
  selector: 'app-media-publish-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatIconModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './media-publish-dialog.component.html',
  styleUrls: ['./media-publish-dialog.component.scss'],
})
export class MediaPublishDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaPublishDialogComponent>);
  private mediaService = inject(MediaService);
  private utilities = inject(UtilitiesService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  data: MediaPublishDialogData = inject(MAT_DIALOG_DATA);

  // Form fields
  kind = signal<20 | 21 | 22 | 34235 | 34236>(this.getDefaultKind());
  title = signal('');
  content = signal('');
  alt = signal('');
  contentWarning = signal('');
  hashtags = signal<string[]>([]);
  location = signal('');
  geohash = signal('');
  duration = signal<number | undefined>(undefined);

  // Addressable event fields (NIP-71)
  dTag = signal('');
  originPlatform = signal('');
  originExternalId = signal('');
  originUrl = signal('');

  // Thumbnail management
  thumbnailUrl = signal<string | undefined>(this.data.thumbnailUrl);
  thumbnailBlob = signal<Blob | undefined>(undefined); // Store extracted thumbnail blob
  thumbnailDimensions = signal<{ width: number; height: number } | undefined>(undefined);
  thumbnailUrlInput = signal<string | null>(null);
  thumbnailUrlInputValue = ''; // For ngModel binding
  blurhash = signal<string | undefined>(undefined);
  thumbhash = signal<string | undefined>(undefined);
  generatingBlurhash = signal(false);
  extractingThumbnail = signal(false);
  thumbnailExtractOffset = signal(0); // Track how many times extraction was called

  // Custom relays
  customRelays = signal<string[]>([]);
  customRelayInput = signal('');

  // UI state
  hashtagInput = signal('');
  publishing = signal(false);
  private publishInitiated = false; // Guard against race conditions from double-clicks

  constructor() {
    // Auto-generate blurhash for images on init
    if (this.isImage()) {
      this.loadImageAndGenerateBlurhash(this.data.mediaItem.url);
    }

    // Auto-extract thumbnail for videos on init
    if (this.isVideo()) {
      this.extractThumbnailFromVideo();
    }
  }

  // Computed
  isImage = (): boolean => {
    return this.data.mediaItem.type?.startsWith('image') || false;
  };

  isVideo = (): boolean => {
    return this.data.mediaItem.type?.startsWith('video') || false;
  };

  isShortFormVideo = (): boolean => {
    return this.kind() === 22 || this.kind() === 34236;
  };

  canPublish = (): boolean => {
    return !this.publishing() && !this.publishInitiated;
  };

  private getDefaultKind(): 20 | 21 | 22 | 34235 | 34236 {
    const mediaType = this.data.mediaItem.type;

    if (mediaType?.startsWith('image')) {
      return 20; // Picture event
    } else if (mediaType?.startsWith('video')) {
      // Check if it's a webm file (likely recorded) or small file size (< 10MB suggests short video)
      const isLikelyRecorded = this.data.mediaItem.type?.includes('webm') ||
        (this.data.mediaItem.size && this.data.mediaItem.size < 10 * 1024 * 1024);

      // Default to kind 22 (short video) for likely recorded videos, otherwise kind 21 (normal video)
      return isLikelyRecorded ? 22 : 21;
    }

    // Default to picture
    return 20;
  }

  getAvailableKinds(): { value: 20 | 21 | 22 | 34235 | 34236; label: string; description: string }[] {
    if (this.isImage()) {
      return [
        { value: 20, label: 'Picture (kind 20)', description: 'Standard image post' }
      ];
    } else if (this.isVideo()) {
      return [
        { value: 21, label: 'Video (kind 21)', description: 'Normal/horizontal video' },
        { value: 22, label: 'Short Video (kind 22)', description: 'Short/vertical video (stories, reels)' },
        { value: 34235, label: 'Addressable Video (kind 34235)', description: 'Updateable normal video (NIP-71)' },
        { value: 34236, label: 'Addressable Short Video (kind 34236)', description: 'Updateable short video (NIP-71)' }
      ];
    }

    return [
      { value: 20, label: 'Picture (kind 20)', description: 'Standard image post' }
    ];
  }

  addHashtag(): void {
    const tag = this.hashtagInput().trim().toLowerCase();
    if (tag && !this.hashtags().includes(tag)) {
      this.hashtags.set([...this.hashtags(), tag]);
      this.hashtagInput.set('');
    }
  }

  removeHashtag(tag: string): void {
    this.hashtags.set(this.hashtags().filter(t => t !== tag));
  }

  onHashtagInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addHashtag();
    }
  }

  addCustomRelay(): void {
    const relay = this.customRelayInput().trim();
    if (!relay) return;

    // Normalize relay URL
    let normalizedRelay = relay;
    if (!normalizedRelay.startsWith('wss://') && !normalizedRelay.startsWith('ws://')) {
      normalizedRelay = 'wss://' + normalizedRelay;
    }

    // Add trailing slash if there's no path component
    try {
      const url = new URL(normalizedRelay);
      if (url.pathname === '') {
        normalizedRelay = normalizedRelay + '/';
      }
    } catch {
      // Invalid URL, skip normalization
    }

    if (!this.customRelays().includes(normalizedRelay)) {
      this.customRelays.set([...this.customRelays(), normalizedRelay]);
      this.customRelayInput.set('');
    }
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.set(this.customRelays().filter(r => r !== relay));
  }

  addPresetRelay(relay: string): void {
    if (!this.customRelays().includes(relay)) {
      this.customRelays.set([...this.customRelays(), relay]);
    }
  }

  onDurationInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    this.duration.set(value ? parseFloat(value) : undefined);
  }

  // Thumbnail management methods
  async extractThumbnailFromVideo(): Promise<void> {
    if (!this.isVideo()) return;

    this.extractingThumbnail.set(true);

    try {
      const videoUrl = this.data.mediaItem.url;

      // Calculate seek time with offset for repeated extractions
      const currentOffset = this.thumbnailExtractOffset();
      const baseSeekTime = 1; // Start at 1 second
      const seekTime = baseSeekTime + currentOffset;

      // Use centralized utility service for thumbnail extraction
      const result = await this.utilities.extractThumbnailFromVideo(videoUrl, seekTime);

      // Increment offset for next extraction
      this.thumbnailExtractOffset.set(currentOffset + 1);

      // Store blob and dimensions (don't upload yet)
      this.thumbnailBlob.set(result.blob);
      this.thumbnailDimensions.set(result.dimensions);
      this.thumbnailUrl.set(result.objectUrl);

      // Hide URL input if it was visible
      this.thumbnailUrlInput.set(null);
      this.thumbnailUrlInputValue = '';

      // Auto-generate blurhash from the object URL
      await this.loadImageAndGenerateBlurhash(result.objectUrl);
    } catch (error) {
      console.error('Failed to extract thumbnail:', error);
    } finally {
      this.extractingThumbnail.set(false);
    }
  }

  async onThumbnailFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];

    if (!file.type.startsWith('image/')) {
      console.error('Only image files are allowed for thumbnails');
      return;
    }

    try {
      // Reset extraction offset since user is uploading their own thumbnail
      this.thumbnailExtractOffset.set(0);

      // Store blob for later upload
      this.thumbnailBlob.set(file);

      // Create object URL for preview
      const objectUrl = URL.createObjectURL(file);
      this.thumbnailUrl.set(objectUrl);

      // Hide URL input if it was visible
      this.thumbnailUrlInput.set(null);
      this.thumbnailUrlInputValue = '';

      // Read dimensions and auto-generate blurhash
      await this.loadImageAndGenerateBlurhash(objectUrl);
    } catch (error) {
      console.error('Failed to process thumbnail:', error);
    }
  }

  onThumbnailUrlBlur(): void {
    const url = this.thumbnailUrlInputValue.trim();
    if (url) {
      // Reset extraction offset since user is using a URL
      this.thumbnailExtractOffset.set(0);

      this.thumbnailUrl.set(url);
      this.thumbnailBlob.set(undefined); // Clear blob since we're using URL
      this.thumbnailUrlInputValue = '';
      this.thumbnailUrlInput.set(null);

      // Auto-generate blurhash from URL
      this.loadImageAndGenerateBlurhash(url);
    }
  }

  removeThumbnail(): void {
    this.thumbnailUrl.set(undefined);
    this.thumbnailBlob.set(undefined);
    this.thumbnailDimensions.set(undefined);
    this.blurhash.set(undefined);
    this.thumbhash.set(undefined);
    this.thumbnailExtractOffset.set(0); // Reset offset when removing thumbnail
  }

  // Helper method to load image and generate placeholders (blurhash and/or thumbhash based on settings)
  private async loadImageAndGenerateBlurhash(url: string): Promise<void> {
    try {
      this.generatingBlurhash.set(true);

      // Use the imagePlaceholder service to generate based on user preference
      const result = await this.imagePlaceholder.generatePlaceholders(url);

      // Store dimensions and placeholder hashes
      this.thumbnailDimensions.set(result.dimensions);
      if (result.blurhash) {
        this.blurhash.set(result.blurhash);
      }
      if (result.thumbhash) {
        this.thumbhash.set(result.thumbhash);
      }
    } catch (error) {
      console.error('Failed to generate placeholders:', error);
    } finally {
      this.generatingBlurhash.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  publish(): void {
    if (!this.canPublish()) {
      return;
    }

    // Set guard flag immediately to prevent race conditions
    this.publishInitiated = true;

    const options: MediaPublishOptions = {
      kind: this.kind(),
      title: this.title().trim(),
      content: this.content().trim(),
      hashtags: this.hashtags(),
    };

    // Add optional fields if provided
    if (this.alt().trim()) {
      options.alt = this.alt().trim();
    }

    if (this.contentWarning().trim()) {
      options.contentWarning = this.contentWarning().trim();
    }

    if (this.location().trim()) {
      options.location = this.location().trim();
    }

    if (this.geohash().trim()) {
      options.geohash = this.geohash().trim();
    }

    if (this.duration() !== undefined && this.duration()! > 0) {
      options.duration = this.duration();
    }

    // Include thumbnail URL if set
    if (this.thumbnailUrl()) {
      options.thumbnailUrl = this.thumbnailUrl();
    }

    // Include thumbnail blob if available (for upload during publish)
    if (this.thumbnailBlob()) {
      options.thumbnailBlob = this.thumbnailBlob();
    }

    // Include thumbnail dimensions if available
    if (this.thumbnailDimensions()) {
      options.thumbnailDimensions = this.thumbnailDimensions();
    }

    // Include blurhash if generated
    if (this.blurhash()) {
      options.blurhash = this.blurhash();
    }

    // Include thumbhash if generated
    if (this.thumbhash()) {
      options.thumbhash = this.thumbhash();
    }

    // For images, include dimensions if we have them
    if (this.isImage() && this.thumbnailDimensions()) {
      options.imageDimensions = this.thumbnailDimensions();
    }

    // For addressable events (kinds 34235, 34236), include d-tag
    if (this.kind() === 34235 || this.kind() === 34236) {
      // Generate d-tag if not provided by user
      const userProvidedDTag = this.dTag().trim();
      if (userProvidedDTag) {
        options.dTag = userProvidedDTag;
      } else {
        // Auto-generate d-tag using timestamp + random suffix for uniqueness
        const timestamp = Math.floor(Date.now() / 1000);
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        options.dTag = `${timestamp}-${randomSuffix}`;
      }

      // Include origin tag if platform is specified
      if (this.originPlatform().trim()) {
        options.origin = {
          platform: this.originPlatform().trim(),
        };

        if (this.originExternalId().trim()) {
          options.origin.externalId = this.originExternalId().trim();
        }

        if (this.originUrl().trim()) {
          options.origin.url = this.originUrl().trim();
        }
      }
    }

    // Include custom relays if any are added
    if (this.customRelays().length > 0) {
      options.customRelays = this.customRelays();
    }

    this.dialogRef.close(options);
  }
}
