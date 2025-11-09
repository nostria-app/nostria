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
import { encode } from 'blurhash';

export interface MediaPublishDialogData {
  mediaItem: MediaItem;
  thumbnailUrl?: string; // Optional thumbnail URL for videos
}

export interface MediaPublishOptions {
  kind: 20 | 21 | 22; // 20 = picture, 21 = video, 22 = short video
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
  imageDimensions?: { width: number; height: number }; // Image dimensions for pictures
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
  data: MediaPublishDialogData = inject(MAT_DIALOG_DATA);

  // Form fields
  kind = signal<20 | 21 | 22>(this.getDefaultKind());
  title = signal('');
  content = signal('');
  alt = signal('');
  contentWarning = signal('');
  hashtags = signal<string[]>([]);
  location = signal('');
  geohash = signal('');
  duration = signal<number | undefined>(undefined);

  // Thumbnail management
  thumbnailUrl = signal<string | undefined>(this.data.thumbnailUrl);
  thumbnailBlob = signal<Blob | undefined>(undefined); // Store extracted thumbnail blob
  thumbnailDimensions = signal<{ width: number; height: number } | undefined>(undefined);
  thumbnailUrlInput = signal<string | null>(null);
  thumbnailUrlInputValue = ''; // For ngModel binding
  blurhash = signal<string | undefined>(undefined);
  generatingBlurhash = signal(false);
  extractingThumbnail = signal(false);
  thumbnailExtractOffset = signal(0); // Track how many times extraction was called

  // UI state
  hashtagInput = signal('');
  publishing = signal(false);

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

  canPublish = (): boolean => {
    return !this.publishing();
  };

  private getDefaultKind(): 20 | 21 | 22 {
    const mediaType = this.data.mediaItem.type;

    if (mediaType?.startsWith('image')) {
      return 20; // Picture event
    } else if (mediaType?.startsWith('video')) {
      // Default to kind 21 (normal video), user can change to 22 (short video)
      return 21;
    }

    // Default to picture
    return 20;
  }

  getAvailableKinds(): { value: 20 | 21 | 22; label: string; description: string }[] {
    if (this.isImage()) {
      return [
        { value: 20, label: 'Picture (kind 20)', description: 'Standard image post' }
      ];
    } else if (this.isVideo()) {
      return [
        { value: 21, label: 'Video (kind 21)', description: 'Normal/horizontal video' },
        { value: 22, label: 'Short Video (kind 22)', description: 'Short/vertical video (stories, reels)' }
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
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.crossOrigin = 'anonymous';

      const videoUrl = this.data.mediaItem.url;
      video.src = videoUrl;

      // Wait for video to load metadata
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video'));
      });

      // Calculate seek time: start at 1s or 10%, then add 1s for each subsequent extraction
      const currentOffset = this.thumbnailExtractOffset();
      const baseSeekTime = Math.min(1, video.duration * 0.1);
      const seekTime = Math.min(baseSeekTime + currentOffset, video.duration - 0.5);
      video.currentTime = seekTime;

      // Increment offset for next extraction
      this.thumbnailExtractOffset.set(currentOffset + 1);

      // Wait for seek to complete
      await new Promise<void>(resolve => {
        video.onseeked = () => resolve();
      });

      // Create canvas and draw the video frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create thumbnail blob'));
          }
        }, 'image/jpeg', 0.9);
      });

      // Store blob and dimensions (don't upload yet)
      this.thumbnailBlob.set(blob);
      this.thumbnailDimensions.set({ width: canvas.width, height: canvas.height });

      // Create object URL for preview
      const objectUrl = URL.createObjectURL(blob);
      this.thumbnailUrl.set(objectUrl);

      // Hide URL input if it was visible
      this.thumbnailUrlInput.set(null);
      this.thumbnailUrlInputValue = '';

      // Auto-generate blurhash from the object URL (same as manual generation)
      await this.loadImageAndGenerateBlurhash(objectUrl);
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
    this.thumbnailExtractOffset.set(0); // Reset offset when removing thumbnail
  }

  // Helper method to load image and generate blurhash
  private async loadImageAndGenerateBlurhash(url: string): Promise<void> {
    try {
      this.generatingBlurhash.set(true);

      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
      });

      // Store dimensions
      this.thumbnailDimensions.set({ width: img.width, height: img.height });

      // Create canvas and draw image
      const canvas = document.createElement('canvas');
      // Optimized size for good quality blurhash without excessive hash length
      // Higher resolution provides more accurate color sampling for encoding
      const width = 64;
      const height = Math.floor((img.height / img.width) * width);

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, width, height);

      // Generate blurhash with balanced component counts
      // componentX and componentY can be between 1-9 (higher = more detail but longer hash)
      // Using 6x4 for a good balance of visual quality and hash length
      const hash = encode(
        imageData.data,
        width,
        height,
        6, // componentX (good horizontal detail)
        4  // componentY (good vertical detail)
      );

      this.blurhash.set(hash);
    } catch (error) {
      console.error('Failed to generate blurhash:', error);
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

    // For images, include dimensions if we have them
    if (this.isImage() && this.thumbnailDimensions()) {
      options.imageDimensions = this.thumbnailDimensions();
    }

    this.dialogRef.close(options);
  }
}
