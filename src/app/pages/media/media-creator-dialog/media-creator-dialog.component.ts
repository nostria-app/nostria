import { Component, inject, signal, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect } from '@angular/core';
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
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { MediaService, MediaItem } from '../../../services/media.service';
import { NostrService } from '../../../services/nostr.service';
import { VideoFilterService, PhotoAdjustments } from '../../../services/video-filter.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { nip19, NostrEvent } from 'nostr-tools';

export interface MediaCreatorResult {
  published: boolean;
  mediaEvent?: NostrEvent;
  noteEvent?: NostrEvent;
}

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'video';
  dimensions?: { width: number; height: number };
  blurhash?: string;
  thumbnailBlob?: Blob;
  thumbnailUrl?: string;
  thumbnailDimensions?: { width: number; height: number };
  alt?: string; // Per-image alt text
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
    MatSliderModule,
    DragDropModule,
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

  // Step navigation (1: select, 2: edit, 3: details)
  currentStep = signal<1 | 2 | 3>(1);
  stepTitle = computed(() => {
    switch (this.currentStep()) {
      case 1: return 'Select Media';
      case 2: return 'Edit';
      case 3: return 'Details';
      default: return 'Create Media';
    }
  });

  // Media state - support multiple files
  mediaFiles = signal<MediaFile[]>([]);
  selectedMediaIndex = signal(0);
  isDragOver = signal(false);
  dragCounter = 0;

  // Computed for current selected media
  currentMedia = computed(() => {
    const files = this.mediaFiles();
    const index = this.selectedMediaIndex();
    return files[index] ?? null;
  });

  // Filter state
  selectedFilter = signal<string>('none');
  filterIntensity = signal(100); // 0-100%
  showFilters = signal(true);
  editPanelTab = signal<'filters' | 'adjustments'>('filters');
  private filterAnimationFrame: number | null = null;
  private imageElement: HTMLImageElement | null = null;
  private canvasInitialized = false;

  // Photo adjustments
  adjustments = signal<PhotoAdjustments>({
    brightness: 0,
    contrast: 0,
    fade: 0,
    saturation: 0,
    temperature: 0,
    vignette: 0,
  });

  // Swipe gesture state for filters
  private touchStartX = 0;
  private touchStartY = 0;
  private isSwiping = false;
  private readonly SWIPE_THRESHOLD = 50;

  // Form fields
  title = signal('');
  content = signal('');
  contentWarning = signal('');
  hashtags = signal<string[]>([]);
  hashtagInput = signal('');

  // Computed for current media's alt text
  currentAlt = computed(() => this.currentMedia()?.alt ?? '');

  // Options
  alsoPostAsNote = signal(true);
  uploadOriginal = signal(false);

  // Processing state
  isUploading = signal(false);
  isPublishing = signal(false);
  uploadProgress = signal(0);
  uploadStatus = signal('');
  private publishGuard = false;

  // Computed
  hasMedia = computed(() => this.mediaFiles().length > 0);
  isImage = computed(() => this.currentMedia()?.type === 'image');
  isVideo = computed(() => this.currentMedia()?.type === 'video');
  mediaType = computed(() => this.mediaFiles()[0]?.type ?? 'image');
  canPublish = computed(() =>
    this.hasMedia() &&
    !this.isUploading() &&
    !this.isPublishing() &&
    !this.publishGuard
  );

  // Determine the event kind based on media type and dimensions
  mediaKind = computed((): 20 | 21 | 22 => {
    const media = this.mediaFiles()[0];
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

  // Accepted file types based on first media
  acceptedFileTypes = computed(() => {
    const type = this.mediaType();
    return type === 'video' ? 'video/*' : 'image/*';
  });

  constructor() {
    // Watch for step changes to re-initialize canvas
    effect(() => {
      const step = this.currentStep();
      const media = this.currentMedia();

      if (step === 2 && media?.type === 'image') {
        // Use longer delay and force canvas reinitialization
        this.canvasInitialized = false;
        setTimeout(() => this.reinitializeCanvas(), 100);
      }
    });

    // Watch for media selection changes
    effect(() => {
      const media = this.currentMedia();
      const step = this.currentStep();
      if (media?.type === 'image' && step === 2) {
        this.canvasInitialized = false;
        setTimeout(() => this.reinitializeCanvas(), 100);
      }
    });
  }

  ngAfterViewInit(): void {
    // Canvas will be initialized by effect when step changes
  }

  ngOnDestroy(): void {
    this.stopFilterRendering();
    this.cleanupAllMedia();
    this.filterService.cleanup();
  }

  private reinitializeCanvas(): void {
    const media = this.currentMedia();
    if (!media || media.type !== 'image') return;
    if (!this.filterCanvas?.nativeElement) {
      // Canvas not in DOM yet, retry
      setTimeout(() => this.reinitializeCanvas(), 50);
      return;
    }

    this.stopFilterRendering();

    // Load image for filter rendering
    this.imageElement = new Image();
    this.imageElement.crossOrigin = 'anonymous';

    this.imageElement.onload = () => {
      if (this.filterCanvas?.nativeElement && this.imageElement) {
        // Force WebGL reinitialization
        this.filterService.cleanup();
        this.filterService.initWebGL(this.filterCanvas.nativeElement);
        this.canvasInitialized = true;
        this.applyCurrentEffects();
      }
    };

    this.imageElement.src = media.preview;
  }

  // Apply current filter and adjustments
  private applyCurrentEffects(): void {
    if (!this.imageElement || !this.filterCanvas?.nativeElement || !this.canvasInitialized) return;

    // Set filter with intensity
    this.filterService.setFilter(this.selectedFilter());
    this.filterService.setFilterIntensity(this.filterIntensity() / 100);
    this.filterService.setAdjustments(this.adjustments());
    this.filterService.applyFilterToImage(this.imageElement);
  }

  // File selection methods
  openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFiles(Array.from(input.files));
    }
    // Reset input so same file can be selected again
    input.value = '';
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
    if (files && files.length > 0) {
      this.processFiles(Array.from(files));
    }
  }

  private async processFiles(files: File[]): Promise<void> {
    const existingType = this.mediaType();
    const hasExisting = this.hasMedia();

    for (const file of files) {
      await this.processFile(file, hasExisting ? existingType : undefined);
    }
  }

  private async processFile(file: File, requiredType?: 'image' | 'video'): Promise<void> {
    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      this.snackBar.open('Please select an image or video file', 'Close', { duration: 3000 });
      return;
    }

    const fileType = isImage ? 'image' : 'video';

    // If we have existing media, ensure type matches
    if (requiredType && fileType !== requiredType) {
      this.snackBar.open(
        `Cannot mix images and videos. Please select ${requiredType === 'image' ? 'images' : 'videos'} only.`,
        'Close',
        { duration: 3000 }
      );
      return;
    }

    // Create preview URL
    const preview = URL.createObjectURL(file);

    // Get dimensions
    const dimensions = await this.getMediaDimensions(file, fileType, preview);

    const mediaFile: MediaFile = {
      id: crypto.randomUUID(),
      file,
      preview,
      type: fileType,
      dimensions,
    };

    // Add to array
    this.mediaFiles.update(files => [...files, mediaFile]);
    this.selectedMediaIndex.set(this.mediaFiles().length - 1);
    this.selectedFilter.set('none');

    // Initialize filter preview for images
    if (isImage) {
      await this.generateBlurhashForMedia(mediaFile);
    }

    // Extract thumbnail for videos
    if (isVideo) {
      await this.extractVideoThumbnailForMedia(mediaFile);
    }

    // Auto-advance to edit step
    this.currentStep.set(2);
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

  private async generateBlurhashForMedia(mediaFile: MediaFile): Promise<void> {
    try {
      const result = await this.imagePlaceholder.generatePlaceholders(mediaFile.preview);
      this.mediaFiles.update(files =>
        files.map(f => f.id === mediaFile.id ? { ...f, blurhash: result.blurhash } : f)
      );
    } catch (error) {
      console.error('Failed to generate blurhash:', error);
    }
  }

  private async extractVideoThumbnailForMedia(mediaFile: MediaFile): Promise<void> {
    try {
      const result = await this.utilities.extractThumbnailFromVideo(mediaFile.preview, 1);
      this.mediaFiles.update(files =>
        files.map(f => f.id === mediaFile.id ? {
          ...f,
          thumbnailBlob: result.blob,
          thumbnailUrl: result.objectUrl,
          thumbnailDimensions: result.dimensions
        } : f)
      );

      // Generate blurhash from thumbnail
      const placeholders = await this.imagePlaceholder.generatePlaceholders(result.objectUrl);
      this.mediaFiles.update(files =>
        files.map(f => f.id === mediaFile.id ? { ...f, blurhash: placeholders.blurhash } : f)
      );
    } catch (error) {
      console.error('Failed to extract video thumbnail:', error);
    }
  }

  private cleanupAllMedia(): void {
    const files = this.mediaFiles();
    files.forEach(media => {
      URL.revokeObjectURL(media.preview);
      if (media.thumbnailUrl) {
        URL.revokeObjectURL(media.thumbnailUrl);
      }
    });
    this.mediaFiles.set([]);
    this.selectedMediaIndex.set(0);
    this.imageElement = null;
    this.canvasInitialized = false;
  }

  private startFilterRendering(): void {
    if (!this.imageElement || !this.filterCanvas?.nativeElement) return;

    // For images, just render once - no need for continuous animation loop
    this.applyCurrentEffects();
  }

  private stopFilterRendering(): void {
    if (this.filterAnimationFrame !== null) {
      cancelAnimationFrame(this.filterAnimationFrame);
      this.filterAnimationFrame = null;
    }
  }

  // Filter methods
  selectFilter(filterId: string): void {
    this.selectedFilter.set(filterId);
    this.filterService.setFilter(filterId);
    // Re-render with the new filter
    this.applyCurrentEffects();
  }

  // Update filter intensity
  updateFilterIntensity(value: number): void {
    this.filterIntensity.set(value);
    this.applyCurrentEffects();
  }

  // Update individual adjustment
  updateAdjustment(key: keyof PhotoAdjustments, value: number): void {
    this.adjustments.update(adj => ({ ...adj, [key]: value }));
    this.applyCurrentEffects();
  }

  // Reset all adjustments
  resetAdjustments(): void {
    this.adjustments.set({
      brightness: 0,
      contrast: 0,
      fade: 0,
      saturation: 0,
      temperature: 0,
      vignette: 0,
    });
    this.applyCurrentEffects();
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

  // Clear all media to select new ones
  clearMedia(): void {
    this.cleanupAllMedia();
    this.stopFilterRendering();
    this.selectedFilter.set('none');
    this.filterIntensity.set(100);
    this.resetAdjustments();
    this.title.set('');
    this.content.set('');
    this.hashtags.set([]);
    this.currentStep.set(1);
  }

  // Update alt text for current media
  updateCurrentAlt(altText: string): void {
    const index = this.selectedMediaIndex();
    this.mediaFiles.update(files =>
      files.map((f, i) => i === index ? { ...f, alt: altText } : f)
    );
  }

  // Drag and drop reorder for media thumbnails
  onThumbnailDrop(event: CdkDragDrop<MediaFile[]>): void {
    const files = [...this.mediaFiles()];
    moveItemInArray(files, event.previousIndex, event.currentIndex);
    this.mediaFiles.set(files);

    // Update selected index if the currently selected item moved
    const currentSelected = this.selectedMediaIndex();
    if (currentSelected === event.previousIndex) {
      this.selectedMediaIndex.set(event.currentIndex);
    } else if (
      currentSelected > event.previousIndex && currentSelected <= event.currentIndex
    ) {
      this.selectedMediaIndex.set(currentSelected - 1);
    } else if (
      currentSelected < event.previousIndex && currentSelected >= event.currentIndex
    ) {
      this.selectedMediaIndex.set(currentSelected + 1);
    }
  }

  // Remove a specific media file
  removeMedia(index: number): void {
    const files = this.mediaFiles();
    if (index >= 0 && index < files.length) {
      const media = files[index];
      URL.revokeObjectURL(media.preview);
      if (media.thumbnailUrl) {
        URL.revokeObjectURL(media.thumbnailUrl);
      }

      this.mediaFiles.update(f => f.filter((_, i) => i !== index));

      // Adjust selected index if needed
      if (this.selectedMediaIndex() >= this.mediaFiles().length) {
        this.selectedMediaIndex.set(Math.max(0, this.mediaFiles().length - 1));
      }

      // Go back to step 1 if no media left
      if (this.mediaFiles().length === 0) {
        this.currentStep.set(1);
      }
    }
  }

  // Select a media file for editing
  selectMedia(index: number): void {
    if (index >= 0 && index < this.mediaFiles().length) {
      this.selectedMediaIndex.set(index);
    }
  }

  // Step navigation methods
  goToNextStep(): void {
    const current = this.currentStep();
    if (current < 3) {
      this.currentStep.set((current + 1) as 1 | 2 | 3);
    }
  }

  goToPreviousStep(): void {
    const current = this.currentStep();
    if (current > 1) {
      this.currentStep.set((current - 1) as 1 | 2 | 3);
    }
  }

  goToStep(step: 1 | 2 | 3): void {
    // Only allow going to step 2+ if media is selected
    if (step > 1 && !this.hasMedia()) {
      return;
    }
    this.currentStep.set(step);
  }

  // Cancel and close dialog
  cancel(): void {
    this.cleanupAllMedia();
    this.dialogRef.close({ published: false });
  }

  // Publish the media
  async publish(): Promise<void> {
    const mediaFiles = this.mediaFiles();
    if (mediaFiles.length === 0 || !this.canPublish()) return;

    this.publishGuard = true;
    this.isUploading.set(true);
    this.uploadStatus.set('Preparing media...');

    try {
      // Upload all media files
      const uploadedItems: { item: MediaItem; media: MediaFile }[] = [];

      for (let i = 0; i < mediaFiles.length; i++) {
        const media = mediaFiles[i];
        this.uploadStatus.set(`Uploading ${i + 1} of ${mediaFiles.length}...`);

        // For images with filters, render the filtered version
        let fileToUpload = media.file;
        if (media.type === 'image' && this.selectedFilter() !== 'none' && this.filterCanvas?.nativeElement) {
          this.uploadStatus.set(`Applying filter to ${i + 1}...`);
          fileToUpload = await this.renderFilteredImage(media.file);
        }

        // Upload the media file
        const uploadResult = await this.mediaService.uploadFile(
          fileToUpload,
          this.uploadOriginal(),
          this.mediaService.mediaServers()
        );

        if (uploadResult.status !== 'success' || !uploadResult.item) {
          throw new Error(`Failed to upload media ${i + 1}`);
        }

        uploadedItems.push({ item: uploadResult.item, media });
      }

      this.uploadStatus.set('Publishing to Nostr...');
      this.isUploading.set(false);
      this.isPublishing.set(true);

      // Build and publish the media event
      const mediaEvent = await this.publishMediaEvent(uploadedItems);

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

  private async publishMediaEvent(uploadedItems: { item: MediaItem; media: MediaFile }[]): Promise<NostrEvent> {
    const kind = this.mediaKind();
    const tags: string[][] = [];

    // Build imeta tags for each media item
    for (const { item: mediaItem, media } of uploadedItems) {
      const imetaTag = ['imeta'];
      imetaTag.push(`url ${mediaItem.url}`);

      if (mediaItem.type) {
        imetaTag.push(`m ${mediaItem.type}`);
      }

      imetaTag.push(`x ${mediaItem.sha256}`);

      if (mediaItem.size) {
        imetaTag.push(`size ${mediaItem.size}`);
      }

      // Add per-image alt text
      if (media.alt?.trim()) {
        imetaTag.push(`alt ${media.alt.trim()}`);
      }

      // Add dimensions
      if (media.dimensions && kind === 20) {
        imetaTag.push(`dim ${media.dimensions.width}x${media.dimensions.height}`);
      }

      // Add blurhash
      if (media.blurhash) {
        imetaTag.push(`blurhash ${media.blurhash}`);
      }

      // For videos, add thumbnail info
      if (kind === 21 || kind === 22) {
        // Upload thumbnail if we have one
        if (media.thumbnailBlob) {
          try {
            const thumbFile = new File([media.thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
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

        if (media.thumbnailDimensions) {
          imetaTag.push(`dim ${media.thumbnailDimensions.width}x${media.thumbnailDimensions.height}`);
        }
      }

      // Add mirror URLs as fallback
      if (mediaItem.mirrors?.length) {
        mediaItem.mirrors.forEach(url => imetaTag.push(`fallback ${url}`));
      }

      tags.push(imetaTag);
    }

    // Add title if provided
    if (this.title().trim()) {
      tags.push(['title', this.title().trim()]);
    }

    // Add content warning
    if (this.contentWarning().trim()) {
      tags.push(['content-warning', this.contentWarning().trim()]);
    }

    // Add hashtags
    this.hashtags().forEach(tag => tags.push(['t', tag]));

    // Add metadata tags
    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);
    tags.push(['client', 'nostria']);

    // Add x tags for all media hashes
    uploadedItems.forEach(({ item }) => {
      tags.push(['x', item.sha256]);
    });

    // For images, add MIME type tag for first item
    if (kind === 20 && uploadedItems[0]?.item.type) {
      tags.push(['m', uploadedItems[0].item.type]);
    }

    // Create content - use description or list all URLs
    let content = this.content().trim();
    if (!content) {
      content = uploadedItems.map(({ item }) => item.url).join('\n');
    }

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
