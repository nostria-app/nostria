import { Component, inject, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, InlineVideoPlayerComponent],
  templateUrl: './media-preview.component.html',
  styleUrls: ['./media-preview.component.scss'],
  host: {
    '(swiperight)': 'onSwipeRight()',
    '(swipeleft)': 'onSwipeLeft()',
  },
})
export class MediaPreviewDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaPreviewDialogComponent>);
  data: MediaPreviewData = inject(MAT_DIALOG_DATA);

  @ViewChild('imageElement') imageElement?: ElementRef<HTMLImageElement>;
  @ViewChild('containerElement') containerElement?: ElementRef<HTMLDivElement>;

  // Touch tracking for swipe gestures
  private touchStartX = 0;
  private touchEndX = 0;
  private readonly SWIPE_THRESHOLD = 50;

  isVideoLoading = true;

  // Zoom and pan controls for images
  scale = signal(1);
  translateX = signal(0);
  translateY = signal(0);
  isDragging = signal(false);
  lastMouseX = signal(0);
  lastMouseY = signal(0);

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

  constructor() {
    // Set initial index if provided
    if (this.data.initialIndex !== undefined) {
      this.currentIndex.set(this.data.initialIndex);
    }
  }

  // Zoom controls
  zoomIn(): void {
    this.scale.update(current => Math.min(current + 0.25, 5));
  }

  zoomOut(): void {
    this.scale.update(current => Math.max(current - 0.25, 0.5));
  }

  resetView(): void {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  // Keyboard navigation
  @HostListener('window:keydown', ['$event'])
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

  // Pan/drag handlers for zoomed images
  onPointerDown(event: MouseEvent | TouchEvent): void {
    // Only allow dragging when zoomed in
    if (this.scale() <= 1) return;

    let clientX: number, clientY: number;

    if (event instanceof TouchEvent) {
      event.preventDefault();
      if (event.touches.length !== 1) return;
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
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
    if (!this.isDragging()) return;

    let clientX: number, clientY: number;

    if (event instanceof TouchEvent) {
      event.preventDefault();
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
      const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.mkv'];
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
