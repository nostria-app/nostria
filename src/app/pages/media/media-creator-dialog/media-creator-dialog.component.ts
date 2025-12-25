import { Component, inject, signal, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { MediaService, MediaItem } from '../../../services/media.service';
import { NostrService } from '../../../services/nostr.service';
import { VideoFilterService } from '../../../services/video-filter.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { nip19, NostrEvent } from 'nostr-tools';

export interface MediaCreatorResult {
  published: boolean;
  mediaEvent?: NostrEvent;
  noteEvent?: NostrEvent;
}

interface MediaFile {
  file: File;
  preview: string;
  type: 'image' | 'video';
  dimensions?: { width: number; height: number };
}

@Component({
  selector: 'app-media-creator-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatTabsModule,
  ],
  templateUrl: './media-creator-dialog.component.html',
  styleUrl: './media-creator-dialog.component.scss',
})
export class MediaCreatorDialogComponent implements AfterViewInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<MediaCreatorDialogComponent, MediaCreatorResult>);
  private mediaService = inject(MediaService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  filterService = inject(VideoFilterService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private utilities = inject(UtilitiesService);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('filterCanvas') filterCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('filterChips') filterChipsContainer?: ElementRef<HTMLDivElement>;

  // Media state
  mediaFile = signal<MediaFile | null>(null);
  isDragOver = signal(false);
  dragCounter = 0;

  // Filter state
  selectedFilter = signal<string>('none');
  showFilters = signal(false);
  private filterAnimationFrame: number | null = null;
  private imageElement: HTMLImageElement | null = null;

  // Swipe gesture state for filters
  private touchStartX = 0;
  private touchStartY = 0;
  private isSwiping = false;
  private readonly SWIPE_THRESHOLD = 50;

  // Form fields
  title = signal('');
  content = signal('');
  alt = signal('');
  contentWarning = signal('');
  hashtags = signal<string[]>([]);
  hashtagInput = signal('');

  // Options
  alsoPostAsNote = signal(true);
  uploadOriginal = signal(false);

  // Thumbnail (for videos)
  thumbnailBlob = signal<Blob | undefined>(undefined);
  thumbnailUrl = signal<string | undefined>(undefined);
  thumbnailDimensions = signal<{ width: number; height: number } | undefined>(undefined);
  blurhash = signal<string | undefined>(undefined);

  // Processing state
  isUploading = signal(false);
  isPublishing = signal(false);
  uploadProgress = signal(0);
  uploadStatus = signal('');
  private publishGuard = false;

  // Computed
  isImage = computed(() => this.mediaFile()?.type === 'image');
  isVideo = computed(() => this.mediaFile()?.type === 'video');
  canPublish = computed(() =>
    this.mediaFile() !== null &&
    !this.isUploading() &&
    !this.isPublishing() &&
    !this.publishGuard
  );

  // Determine the event kind based on media type and dimensions
  mediaKind = computed((): 20 | 21 | 22 => {
    const media = this.mediaFile();
    if (!media) return 20;

    if (media.type === 'image') return 20;

    // Video - check orientation
    if (media.dimensions) {
      const isVertical = media.dimensions.height > media.dimensions.width;
      return isVertical ? 22 : 21;
    }

    // Default to short video (kind 22) for mobile-first
    return 22;
  });

  mediaKindLabel = computed(() => {
    const kind = this.mediaKind();
    switch (kind) {
      case 20: return 'Photo';
      case 21: return 'Video';
      case 22: return 'Short Video';
      default: return 'Media';
    }
  });

  ngAfterViewInit(): void {
    // Initialize filters when canvas is available
    if (this.filterCanvas?.nativeElement) {
      this.filterService.initWebGL(this.filterCanvas.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.stopFilterRendering();
    this.cleanupMedia();
    this.filterService.cleanup();
  }

  // File selection methods
  openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.processFile(input.files[0]);
    }
  }

  // Drag and drop handlers
  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    this.isDragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    this.dragCounter = 0;

    const files = event.dataTransfer?.files;
    if (files && files[0]) {
      this.processFile(files[0]);
    }
  }

  private async processFile(file: File): Promise<void> {
    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      this.snackBar.open('Please select an image or video file', 'Close', { duration: 3000 });
      return;
    }

    // Cleanup previous media
    this.cleanupMedia();

    // Create preview URL
    const preview = URL.createObjectURL(file);

    // Get dimensions
    const dimensions = await this.getMediaDimensions(file, isImage ? 'image' : 'video', preview);

    const mediaFile: MediaFile = {
      file,
      preview,
      type: isImage ? 'image' : 'video',
      dimensions,
    };

    this.mediaFile.set(mediaFile);
    this.selectedFilter.set('none');

    // Initialize filter preview for images
    if (isImage) {
      await this.initializeImageFilter(preview);
      await this.generateBlurhash(preview);
    }

    // Extract thumbnail for videos
    if (isVideo) {
      await this.extractVideoThumbnail(preview);
    }
  }

  private async getMediaDimensions(
    file: File,
    type: 'image' | 'video',
    preview: string
  ): Promise<{ width: number; height: number } | undefined> {
    return new Promise((resolve) => {
      if (type === 'image') {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(undefined);
        img.src = preview;
      } else {
        const video = document.createElement('video');
        video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => resolve(undefined);
        video.src = preview;
      }
    });
  }

  private async initializeImageFilter(imageUrl: string): Promise<void> {
    // Load image for filter rendering
    this.imageElement = new Image();
    this.imageElement.crossOrigin = 'anonymous';

    await new Promise<void>((resolve) => {
      this.imageElement!.onload = () => resolve();
      this.imageElement!.onerror = () => resolve();
      this.imageElement!.src = imageUrl;
    });

    // Start filter rendering if canvas is ready
    if (this.filterCanvas?.nativeElement && this.imageElement) {
      this.filterService.initWebGL(this.filterCanvas.nativeElement);
      this.startFilterRendering();
    }
  }

  private startFilterRendering(): void {
    if (!this.imageElement || !this.filterCanvas?.nativeElement) return;

    const render = () => {
      if (this.imageElement && this.mediaFile()?.type === 'image') {
        this.filterService.applyFilterToImage(this.imageElement);
      }
      this.filterAnimationFrame = requestAnimationFrame(render);
    };

    render();
  }

  private stopFilterRendering(): void {
    if (this.filterAnimationFrame !== null) {
      cancelAnimationFrame(this.filterAnimationFrame);
      this.filterAnimationFrame = null;
    }
  }

  private async generateBlurhash(imageUrl: string): Promise<void> {
    try {
      const result = await this.imagePlaceholder.generatePlaceholders(imageUrl);
      this.blurhash.set(result.blurhash);
    } catch (error) {
      console.error('Failed to generate blurhash:', error);
    }
  }

  private async extractVideoThumbnail(videoUrl: string): Promise<void> {
    try {
      const result = await this.utilities.extractThumbnailFromVideo(videoUrl, 1);
      this.thumbnailBlob.set(result.blob);
      this.thumbnailUrl.set(result.objectUrl);
      this.thumbnailDimensions.set(result.dimensions);

      // Generate blurhash from thumbnail
      await this.generateBlurhash(result.objectUrl);
    } catch (error) {
      console.error('Failed to extract video thumbnail:', error);
    }
  }

  private cleanupMedia(): void {
    const media = this.mediaFile();
    if (media?.preview) {
      URL.revokeObjectURL(media.preview);
    }
    if (this.thumbnailUrl()) {
      URL.revokeObjectURL(this.thumbnailUrl()!);
    }
    this.mediaFile.set(null);
    this.thumbnailBlob.set(undefined);
    this.thumbnailUrl.set(undefined);
    this.thumbnailDimensions.set(undefined);
    this.blurhash.set(undefined);
    this.imageElement = null;
  }

  // Filter methods
  selectFilter(filterId: string): void {
    this.selectedFilter.set(filterId);
    this.filterService.setFilter(filterId);
  }

  toggleFilters(): void {
    this.showFilters.set(!this.showFilters());
  }

  getCurrentFilterIcon(): string {
    const filter = this.filterService.availableFilters.find(f => f.id === this.selectedFilter());
    return filter?.icon || 'filter_none';
  }

  getCurrentFilterName(): string {
    const filter = this.filterService.availableFilters.find(f => f.id === this.selectedFilter());
    return filter?.name || 'None';
  }

  getCurrentFilterIndex(): number {
    return this.filterService.availableFilters.findIndex(f => f.id === this.selectedFilter());
  }

  // Swipe gesture handlers for filter selection
  onTouchStart(event: TouchEvent): void {
    if (this.isVideo()) return;
    this.touchStartX = event.touches[0].clientX;
    this.touchStartY = event.touches[0].clientY;
    this.isSwiping = false;
  }

  onTouchMove(event: TouchEvent): void {
    if (this.isVideo()) return;
    const deltaX = event.touches[0].clientX - this.touchStartX;
    const deltaY = event.touches[0].clientY - this.touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      this.isSwiping = true;
      event.preventDefault();
    }
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.isVideo() || !this.isSwiping) return;

    const deltaX = event.changedTouches[0].clientX - this.touchStartX;

    if (Math.abs(deltaX) >= this.SWIPE_THRESHOLD) {
      const filters = this.filterService.availableFilters;
      const currentIndex = this.getCurrentFilterIndex();

      if (deltaX > 0 && currentIndex > 0) {
        this.selectFilter(filters[currentIndex - 1].id);
      } else if (deltaX < 0 && currentIndex < filters.length - 1) {
        this.selectFilter(filters[currentIndex + 1].id);
      }
    }

    this.isSwiping = false;
  }

  // Hashtag methods
  addHashtag(): void {
    const tag = this.hashtagInput().trim().toLowerCase().replace(/^#/, '');
    if (tag && !this.hashtags().includes(tag)) {
      this.hashtags.set([...this.hashtags(), tag]);
      this.hashtagInput.set('');
    }
  }

  removeHashtag(tag: string): void {
    this.hashtags.set(this.hashtags().filter(t => t !== tag));
  }

  onHashtagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addHashtag();
    }
  }

  // Clear media to select new one
  clearMedia(): void {
    this.cleanupMedia();
    this.stopFilterRendering();
    this.selectedFilter.set('none');
    this.title.set('');
    this.content.set('');
    this.alt.set('');
    this.hashtags.set([]);
  }

  // Cancel and close dialog
  cancel(): void {
    this.cleanupMedia();
    this.dialogRef.close({ published: false });
  }

  // Publish the media
  async publish(): Promise<void> {
    const media = this.mediaFile();
    if (!media || !this.canPublish()) return;

    this.publishGuard = true;
    this.isUploading.set(true);
    this.uploadStatus.set('Preparing media...');

    try {
      // For images with filters, render the filtered version
      let fileToUpload = media.file;
      if (media.type === 'image' && this.selectedFilter() !== 'none' && this.filterCanvas?.nativeElement) {
        this.uploadStatus.set('Applying filter...');
        fileToUpload = await this.renderFilteredImage(media.file);
      }

      // Upload the media file
      this.uploadStatus.set('Uploading media...');
      const uploadResult = await this.mediaService.uploadFile(
        fileToUpload,
        this.uploadOriginal(),
        this.mediaService.mediaServers()
      );

      if (uploadResult.status !== 'success' || !uploadResult.item) {
        throw new Error('Failed to upload media');
      }

      const mediaItem = uploadResult.item;
      this.uploadStatus.set('Publishing to Nostr...');
      this.isUploading.set(false);
      this.isPublishing.set(true);

      // Build and publish the media event
      const mediaEvent = await this.publishMediaEvent(mediaItem, media);

      // Optionally publish as a note too
      let noteEvent: NostrEvent | undefined;
      if (this.alsoPostAsNote()) {
        noteEvent = await this.publishNoteEvent(mediaEvent);
      }

      this.snackBar.open('Media published successfully!', 'Close', { duration: 3000 });
      this.dialogRef.close({
        published: true,
        mediaEvent,
        noteEvent
      });

    } catch (error) {
      console.error('Failed to publish media:', error);
      this.snackBar.open('Failed to publish media', 'Close', { duration: 5000 });
      this.publishGuard = false;
    } finally {
      this.isUploading.set(false);
      this.isPublishing.set(false);
      this.uploadStatus.set('');
    }
  }

  private async renderFilteredImage(originalFile: File): Promise<File> {
    const canvas = this.filterCanvas?.nativeElement;
    if (!canvas) return originalFile;

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const filteredFile = new File([blob], originalFile.name, { type: 'image/jpeg' });
          resolve(filteredFile);
        } else {
          resolve(originalFile);
        }
      }, 'image/jpeg', 0.95);
    });
  }

  private async publishMediaEvent(mediaItem: MediaItem, media: MediaFile): Promise<NostrEvent> {
    const kind = this.mediaKind();
    const tags: string[][] = [];

    // Build imeta tag
    const imetaTag = ['imeta'];
    imetaTag.push(`url ${mediaItem.url}`);

    if (mediaItem.type) {
      imetaTag.push(`m ${mediaItem.type}`);
    }

    imetaTag.push(`x ${mediaItem.sha256}`);

    if (mediaItem.size) {
      imetaTag.push(`size ${mediaItem.size}`);
    }

    if (this.alt().trim()) {
      imetaTag.push(`alt ${this.alt().trim()}`);
    }

    // Add dimensions
    if (media.dimensions && kind === 20) {
      imetaTag.push(`dim ${media.dimensions.width}x${media.dimensions.height}`);
    }

    // Add blurhash
    if (this.blurhash()) {
      imetaTag.push(`blurhash ${this.blurhash()}`);
    }

    // For videos, add thumbnail info
    if (kind === 21 || kind === 22) {
      // Upload thumbnail if we have one
      if (this.thumbnailBlob()) {
        try {
          const thumbFile = new File([this.thumbnailBlob()!], 'thumbnail.jpg', { type: 'image/jpeg' });
          const thumbResult = await this.mediaService.uploadFile(thumbFile, false, this.mediaService.mediaServers());

          if (thumbResult.status === 'success' && thumbResult.item) {
            imetaTag.push(`image ${thumbResult.item.url}`);
            if (thumbResult.item.mirrors?.length) {
              thumbResult.item.mirrors.forEach(url => imetaTag.push(`image ${url}`));
            }
          }
        } catch (error) {
          console.error('Failed to upload thumbnail:', error);
        }
      }

      if (this.thumbnailDimensions()) {
        imetaTag.push(`dim ${this.thumbnailDimensions()!.width}x${this.thumbnailDimensions()!.height}`);
      }
    }

    // Add mirror URLs as fallback
    if (mediaItem.mirrors?.length) {
      mediaItem.mirrors.forEach(url => imetaTag.push(`fallback ${url}`));
    }

    tags.push(imetaTag);

    // Add title if provided
    if (this.title().trim()) {
      tags.push(['title', this.title().trim()]);
    }

    // Add alt tag for accessibility
    if (this.alt().trim()) {
      tags.push(['alt', this.alt().trim()]);
    }

    // Add content warning
    if (this.contentWarning().trim()) {
      tags.push(['content-warning', this.contentWarning().trim()]);
    }

    // Add hashtags
    this.hashtags().forEach(tag => tags.push(['t', tag]));

    // Add metadata tags
    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);
    tags.push(['x', mediaItem.sha256]);
    tags.push(['client', 'nostria']);

    // For images, add MIME type tag
    if (kind === 20 && mediaItem.type) {
      tags.push(['m', mediaItem.type]);
    }

    // Create and publish the event
    const content = this.content().trim() || mediaItem.url;
    const event = this.nostrService.createEvent(kind, content, tags);

    const result = await this.nostrService.signAndPublish(event);

    if (!result.success || !result.event) {
      throw new Error('Failed to sign and publish media event');
    }

    return result.event;
  }

  private async publishNoteEvent(mediaEvent: NostrEvent): Promise<NostrEvent> {
    // Create nevent reference
    const nevent = nip19.neventEncode({
      id: mediaEvent.id,
      author: mediaEvent.pubkey,
      kind: mediaEvent.kind,
    });

    // Build note content
    let noteContent = this.content().trim();
    if (noteContent) {
      noteContent += '\n\n';
    }
    noteContent += `nostr:${nevent}`;

    // Build tags
    const tags: string[][] = [];

    // Reference the media event
    tags.push(['q', mediaEvent.id, '', mediaEvent.pubkey]);

    // Add hashtags
    this.hashtags().forEach(tag => tags.push(['t', tag]));

    // Add content warning if set
    if (this.contentWarning().trim()) {
      tags.push(['content-warning', this.contentWarning().trim()]);
    }

    // Add client tag
    tags.push(['client', 'nostria']);

    // Create and publish
    const event = this.nostrService.createEvent(1, noteContent, tags);
    const result = await this.nostrService.signAndPublish(event);

    if (!result.success || !result.event) {
      throw new Error('Failed to sign and publish note event');
    }

    return result.event;
  }
}
