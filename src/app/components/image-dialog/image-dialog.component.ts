import { Component, inject, signal, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ImageDialogData {
  imageUrl: string;
}

@Component({
  selector: 'app-image-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './image-dialog.component.html',
  styleUrl: './image-dialog.component.scss'
})
export class ImageDialogComponent implements AfterViewInit {
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
  
  ngAfterViewInit() {
    // No-op, but needed for ViewChild
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
   * Handle mouse down event to start dragging
   */
  onMouseDown(event: MouseEvent): void {
    if (this.scale() > 1) {
      this.isDragging.set(true);
      this.lastMouseX.set(event.clientX);
      this.lastMouseY.set(event.clientY);
    }
  }
  
  /**
   * Handle mouse move event for dragging
   */
  onMouseMove(event: MouseEvent): void {
    if (this.isDragging()) {
      const deltaX = event.clientX - this.lastMouseX();
      const deltaY = event.clientY - this.lastMouseY();
      
      this.translateX.update(x => x + deltaX);
      this.translateY.update(y => y + deltaY);
      
      this.lastMouseX.set(event.clientX);
      this.lastMouseY.set(event.clientY);
    }
  }
  
  /**
   * Handle mouse up event to end dragging
   */
  onMouseUp(): void {
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
