import { Component, inject, signal, computed, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { InlineVideoPlayerComponent } from '../inline-video-player/inline-video-player.component';

interface MediaItem {
  url: string;
  type: string;
  title?: string;
}

interface MediaPreviewData {
  mediaUrl?: string; // Legacy single media support
  mediaType?: string;
  mediaTitle?: string;
  mediaItems?: MediaItem[]; // New multi-media support
  initialIndex?: number; // Starting index for multi-media
}

@Component({
  selector: 'app-media-preview-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, InlineVideoPlayerComponent],
  templateUrl: './media-preview.component.html',
  styleUrls: ['./media-preview.component.scss'],
  host: {
    '(swiperight)': 'onSwipeRight()',
    '(swipeleft)': 'onSwipeLeft()',
    '(mousemove)': 'onMouseMove()',
    '(touchstart)': 'onTouchInteraction()',
    '(window:keydown)': 'handleKeyboardEvent($event)',
  },
})
export class MediaPreviewDialogComponent implements OnDestroy {
  private dialogRef = inject(MatDialogRef<MediaPreviewDialogComponent>);
  data: MediaPreviewData = inject(MAT_DIALOG_DATA);

  @ViewChild('imageElement') imageElement?: ElementRef<HTMLImageElement>;
  @ViewChild('containerElement') containerElement?: ElementRef<HTMLDivElement>;

  // Touch tracking for swipe gestures
  private touchStartX = 0;
  private touchEndX = 0;
  private readonly SWIPE_THRESHOLD = 50;

  // Double-tap tracking
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private readonly DOUBLE_TAP_DELAY = 300; // milliseconds
  private readonly DOUBLE_TAP_DISTANCE = 50; // pixels

// Auto-hide controls after inactivity
  private hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HIDE_CONTROLS_DELAY = 2000; // 2 seconds
  controlsVisible = signal(true);

  isVideoLoading = true;

  // Zoom and pan controls for images
  scale = signal(1);
  translateX = signal(0);
  translateY = signal(0);
  isDragging = signal(false);
  lastMouseX = signal(0);
  lastMouseY = signal(0);

  // Pinch-to-zoom tracking
  private isPinching = false;
  private initialPinchDistance = 0;
  private initialPinchScale = 1;
  private pinchCenterX = 0;
  private pinchCenterY = 0;

  // Current index in media items array
  currentIndex = signal(0);

  // Normalized media items array (converts legacy single item to array)
  mediaItems = computed(() => {
    if (this.data.mediaItems && this.data.mediaItems.length > 0) {
      return this.data.mediaItems;
    }
    // Legacy single media support
    if (this.data.mediaUrl) {
      return [
        {
          url: this.data.mediaUrl,
          type: this.data.mediaType || 'image',
          title: this.data.mediaTitle,
        },
      ];
    }
    return [];
  });

  // Current media item
  currentMedia = computed(() => {
    const items = this.mediaItems();
    const index = this.currentIndex();
    return items[index] || items[0];
  });

  // Navigation state
  hasMultipleItems = computed(() => this.mediaItems().length > 1);
  hasPrevious = computed(() => this.currentIndex() > 0);
  hasNext = computed(() => this.currentIndex() < this.mediaItems().length - 1);

  // Zoom percentage for display (rounded to avoid floating point issues)
  zoomPercentage = computed(() => Math.round(this.scale() * 100));

  constructor() {
    // Set initial index if provided
    if (this.data.initialIndex !== undefined) {
      this.currentIndex.set(this.data.initialIndex);
    }
    // Start the auto-hide timer
    this.resetHideControlsTimer();
  }

  ngOnDestroy(): void {
    this.clearHideControlsTimer();
  }

  // Auto-hide controls management
  private resetHideControlsTimer(): void {
    this.clearHideControlsTimer();
    this.controlsVisible.set(true);
    this.hideControlsTimer = setTimeout(() => {
      this.controlsVisible.set(false);
    }, this.HIDE_CONTROLS_DELAY);
  }

  private clearHideControlsTimer(): void {
    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = null;
    }
  }

  onMouseMove(): void {
    this.resetHideControlsTimer();
  }

  // Touch interaction handler - shows controls when user touches the screen
  onTouchInteraction(): void {
    this.resetHideControlsTimer();
  }

  // Zoom controls
  zoomIn(): void {
    this.scale.update(current => Math.min(current + 0.25, 5));
    this.resetHideControlsTimer();
  }

  zoomOut(): void {
    this.scale.update(current => Math.max(current - 0.25, 0.5));
    this.resetHideControlsTimer();
  }

  resetView(): void {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  // Keyboard navigation
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.hasMultipleItems()) return;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.previous();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  // Touch event handlers
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0].screenX;
  }

  onTouchEnd(event: TouchEvent): void {
    this.touchEndX = event.changedTouches[0].screenX;
    this.handleSwipe();
  }

  private handleSwipe(): void {
    if (!this.hasMultipleItems()) return;

    const swipeDistance = this.touchStartX - this.touchEndX;

    if (Math.abs(swipeDistance) > this.SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        // Swiped left - go to next
        this.next();
      } else {
        // Swiped right - go to previous
        this.previous();
      }
    }
  }

  onSwipeLeft(): void {
    this.next();
  }

  onSwipeRight(): void {
    this.previous();
  }

  // Navigation methods
  next(): void {
    if (this.hasNext()) {
      this.currentIndex.update(i => i + 1);
      this.isVideoLoading = true;
      this.resetView(); // Reset zoom when changing images
    }
  }

  previous(): void {
    if (this.hasPrevious()) {
      this.currentIndex.update(i => i - 1);
      this.isVideoLoading = true;
      this.resetView(); // Reset zoom when changing images
    }
  }

  goToIndex(index: number): void {
    if (index >= 0 && index < this.mediaItems().length) {
      this.currentIndex.set(index);
      this.isVideoLoading = true;
      this.resetView(); // Reset zoom when changing images
    }
  }

  // Pan/drag handlers for images
  onPointerDown(event: MouseEvent | TouchEvent): void {
    let clientX: number, clientY: number;

    if (event instanceof TouchEvent) {
      event.preventDefault();
      // Check for pinch gesture (two fingers)
      if (event.touches.length === 2) {
        this.startPinch(event);
        return;
      }
      if (event.touches.length !== 1) return;
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;

      // Check for double-tap
      const now = Date.now();
      const timeDiff = now - this.lastTapTime;
      const distance = Math.sqrt(
        Math.pow(clientX - this.lastTapX, 2) + Math.pow(clientY - this.lastTapY, 2)
      );

      if (timeDiff < this.DOUBLE_TAP_DELAY && distance < this.DOUBLE_TAP_DISTANCE) {
        // Double-tap detected
        this.onDoubleTap(clientX, clientY);
        this.lastTapTime = 0; // Reset to prevent triple-tap
        return;
      }

      this.lastTapTime = now;
      this.lastTapX = clientX;
      this.lastTapY = clientY;
    } else {
      event.preventDefault();
      if (event.button !== 0) return; // Only left mouse button
      clientX = event.clientX;
      clientY = event.clientY;
    }

    this.isDragging.set(true);
    this.lastMouseX.set(clientX);
    this.lastMouseY.set(clientY);
  }

  onPointerMove(event: MouseEvent | TouchEvent): void {
    if (event instanceof TouchEvent) {
      event.preventDefault();
      // Handle pinch gesture
      if (event.touches.length === 2 && this.isPinching) {
        this.handlePinch(event);
        return;
      }
      // If we were pinching but now have less than 2 fingers, stop pinching
      if (this.isPinching && event.touches.length < 2) {
        this.endPinch();
        return;
      }
    }

    if (!this.isDragging()) return;

    let clientX: number, clientY: number;

    if (event instanceof TouchEvent) {
      if (event.touches.length !== 1) return;
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      event.preventDefault();
      clientX = event.clientX;
      clientY = event.clientY;
    }

    const deltaX = clientX - this.lastMouseX();
    const deltaY = clientY - this.lastMouseY();

    this.translateX.update(x => x + deltaX);
    this.translateY.update(y => y + deltaY);

    this.lastMouseX.set(clientX);
    this.lastMouseY.set(clientY);
  }

  onPointerUp(): void {
    this.isDragging.set(false);
    this.endPinch();
  }

  // Pinch-to-zoom methods
  private startPinch(event: TouchEvent): void {
    if (event.touches.length !== 2) return;

    this.isPinching = true;
    this.isDragging.set(false);
    this.initialPinchDistance = this.getPinchDistance(event);
    this.initialPinchScale = this.scale();

    // Calculate pinch center point
    this.pinchCenterX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    this.pinchCenterY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
  }

  private handlePinch(event: TouchEvent): void {
    if (!this.isPinching || event.touches.length !== 2) return;

    const currentDistance = this.getPinchDistance(event);
    const scaleRatio = currentDistance / this.initialPinchDistance;
    let newScale = this.initialPinchScale * scaleRatio;

    // Round to nearest 0.01 (whole percentage) and clamp between 0.5 and 5
    newScale = Math.round(newScale * 100) / 100;
    newScale = Math.max(0.5, Math.min(5, newScale));

    this.scale.set(newScale);
    this.resetHideControlsTimer();
  }

  private endPinch(): void {
    this.isPinching = false;
  }

  private getPinchDistance(event: TouchEvent): number {
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  onDoubleClick(event: MouseEvent): void {
    event.preventDefault();

    if (!this.imageElement?.nativeElement || !this.containerElement?.nativeElement) return;

    const imgRect = this.imageElement.nativeElement.getBoundingClientRect();
    const mouseX = event.clientX - imgRect.left;
    const mouseY = event.clientY - imgRect.top;

    this.handleZoomToggle(mouseX, mouseY, imgRect.width, imgRect.height);
  }

  onDoubleTap(clientX: number, clientY: number): void {
    if (!this.imageElement?.nativeElement || !this.containerElement?.nativeElement) return;

    const imgRect = this.imageElement.nativeElement.getBoundingClientRect();
    const tapX = clientX - imgRect.left;
    const tapY = clientY - imgRect.top;

    this.handleZoomToggle(tapX, tapY, imgRect.width, imgRect.height);
  }

  private handleZoomToggle(x: number, y: number, width: number, height: number): void {
    const currentScale = this.scale();

    // If already zoomed in, reset to normal view
    if (currentScale > 1) {
      this.resetView();
      return;
    }

    // Zoom in to 2x centered on click/tap position
    const targetScale = 2;

    const relX = x / width;
    const relY = y / height;

    const offsetX = (relX * width - width / 2) / currentScale;
    const offsetY = (relY * height - height / 2) / currentScale;

    this.scale.set(targetScale);
    this.translateX.set(-offsetX * (targetScale - currentScale));
    this.translateY.set(-offsetY * (targetScale - currentScale));

    this.resetHideControlsTimer();
  }

  downloadMedia(): void {
    const media = this.currentMedia();
    if (!media) return;

    // Create a temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = media.url;
    link.download = media.title || `media-${Date.now()}`;
    link.target = '_blank';

    // For cross-origin resources, this will open in a new tab instead of downloading
    // But for same-origin or properly configured CORS resources, it will download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.resetHideControlsTimer();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();

    if (!this.imageElement?.nativeElement || !this.containerElement?.nativeElement) return;

    const img = this.imageElement.nativeElement;
    const imgRect = img.getBoundingClientRect();

    const mouseX = event.clientX - imgRect.left;
    const mouseY = event.clientY - imgRect.top;

    const prevScale = this.scale();

    const delta = event.deltaY < 0 ? 1 : -1;
    let nextScale = prevScale + delta * 0.25;
    nextScale = Math.max(0.5, Math.min(5, nextScale));

    if (nextScale === prevScale) return;

    const displayWidth = imgRect.width;
    const displayHeight = imgRect.height;

    const relX = mouseX / displayWidth;
    const relY = mouseY / displayHeight;

    const offsetX = (relX * displayWidth - displayWidth / 2) / prevScale;
    const offsetY = (relY * displayHeight - displayHeight / 2) / prevScale;

    this.scale.set(nextScale);

    this.translateX.update(x => x - offsetX * (nextScale - prevScale));
    this.translateY.update(y => y - offsetY * (nextScale - prevScale));
  }

  getTransformStyle(): string {
    return `scale(${this.scale()}) translate(${this.translateX() / this.scale()}px, ${this.translateY() / this.scale()}px)`;
  }

  close(): void {
    this.dialogRef.close();
  }

  onVideoLoad(): void {
    this.isVideoLoading = false;
  }

  isVideo(): boolean {
    const media = this.currentMedia();
    if (!media) return false;

    if (media.type?.startsWith('video')) {
      return true;
    }

    // Check file extension if type isn't available
    if (!media.type && media.url) {
      const url = media.url.toLowerCase();
      const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.mkv', '.qt'];
      return videoExtensions.some(ext => url.endsWith(ext));
    }

    return false;
  }

  isImage(): boolean {
    const media = this.currentMedia();
    if (!media) return false;

    if (media.type?.startsWith('image')) {
      return true;
    }

    // Check file extension if type isn't available
    if (!media.type && media.url) {
      const url = media.url.toLowerCase();
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
      return imageExtensions.some(ext => url.endsWith(ext));
    }

    return false;
  }
}
