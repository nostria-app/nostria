import { Component, inject, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ImageDialogData {
  imageUrl: string;
}

@Component({
  selector: 'app-image-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './image-dialog.component.html',
  styleUrl: './image-dialog.component.scss',
})
export class ImageDialogComponent implements AfterViewInit, OnDestroy {
  dialogData = inject<ImageDialogData>(MAT_DIALOG_DATA);
  dialogRef = inject(MatDialogRef<ImageDialogComponent>);

  @ViewChild('imageElement') imageElement!: ElementRef<HTMLImageElement>;
  @ViewChild('containerElement') containerElement!: ElementRef<HTMLDivElement>;

  // Zoom controls
  scale = signal(1);
  translateX = signal(0);
  translateY = signal(0);

  // Track mouse movement for panning
  isDragging = signal(false);
  lastMouseX = signal(0);
  lastMouseY = signal(0);

  private fullscreenChangeHandler = () => this.onFullscreenChange();

  ngAfterViewInit() {
    this.enterFullscreen();
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    this.exitFullscreen();
  }

  /**
   * Enter fullscreen mode with no navigation UI
   */
  private async enterFullscreen(): Promise<void> {
    try {
      const dialogContainer = document.querySelector('.cdk-overlay-pane');
      if (dialogContainer && document.fullscreenEnabled) {
        await dialogContainer.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (error) {
      console.warn('Could not enter fullscreen mode:', error);
    }
  }

  /**
   * Exit fullscreen mode
   */
  private async exitFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn('Could not exit fullscreen mode:', error);
    }
  }

  /**
   * Handle fullscreen change events (e.g., user presses Escape)
   */
  private onFullscreenChange(): void {
    if (!document.fullscreenElement) {
      this.dialogRef.close();
    }
  }

  /**
   * Zoom in the image
   */
  zoomIn(): void {
    this.scale.update(current => Math.min(current + 0.25, 5));
  }

  /**
   * Zoom out the image
   */
  zoomOut(): void {
    this.scale.update(current => Math.max(current - 0.25, 0.5));
  }

  /**
   * Reset zoom and position
   */
  resetView(): void {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  /**
   * Close the dialog
   */
  close(): void {
    this.dialogRef.close();
  }

  /**
   * Handle mouse or touch down event to start dragging
   */
  onPointerDown(event: MouseEvent | TouchEvent): void {
    // Only allow dragging when zoomed in
    if (this.scale() <= 1) return;

    let clientX: number, clientY: number;

    if (event instanceof TouchEvent) {
      event.preventDefault(); // Prevent scrolling on touch devices
      if (event.touches.length !== 1) return;
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      event.preventDefault(); // Prevent default browser dragging
      if (event.button !== 0) return; // Only left mouse button
      clientX = event.clientX;
      clientY = event.clientY;
    }

    this.isDragging.set(true);
    this.lastMouseX.set(clientX);
    this.lastMouseY.set(clientY);
  }

  /**
   * Handle mouse or touch move event for dragging
   */
  onPointerMove(event: MouseEvent | TouchEvent): void {
    // Only process movement if we're currently dragging
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

  /**
   * Handle mouse or touch up event to end dragging
   */
  onPointerUp(): void {
    this.isDragging.set(false);
  }

  /**
   * Handle mouse wheel event for zooming
   */
  onWheel(event: WheelEvent): void {
    event.preventDefault();

    // Only zoom if image is loaded and refs are available
    if (!this.imageElement?.nativeElement || !this.containerElement?.nativeElement) return;

    const img = this.imageElement.nativeElement;
    const container = this.containerElement.nativeElement;

    // Get bounding rects
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Mouse position relative to image
    const mouseX = event.clientX - imgRect.left;
    const mouseY = event.clientY - imgRect.top;

    // Current scale
    const prevScale = this.scale();

    // Zoom direction
    const delta = event.deltaY < 0 ? 1 : -1;
    let nextScale = prevScale + delta * 0.25;
    nextScale = Math.max(0.5, Math.min(5, nextScale));

    if (nextScale === prevScale) return;

    // Calculate the new translation so that the zoom is centered at the mouse position
    // (x, y) in image coordinates
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    const displayWidth = imgRect.width;
    const displayHeight = imgRect.height;

    // Ratio of mouse position in image
    const relX = mouseX / displayWidth;
    const relY = mouseY / displayHeight;

    // Compute the offset in the transformed space
    const offsetX = (relX * displayWidth - displayWidth / 2) / prevScale;
    const offsetY = (relY * displayHeight - displayHeight / 2) / prevScale;

    // Update scale
    this.scale.set(nextScale);

    // Adjust translation to keep the zoom centered at the mouse position
    this.translateX.update(x => x - offsetX * (nextScale - prevScale));
    this.translateY.update(y => y - offsetY * (nextScale - prevScale));
  }

  /**
   * Get transform style based on zoom and pan
   */
  getTransformStyle(): string {
    return `scale(${this.scale()}) translate(${this.translateX() / this.scale()}px, ${this.translateY() / this.scale()}px)`;
  }
}
