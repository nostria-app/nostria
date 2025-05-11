import { Component, inject, signal } from '@angular/core';
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
export class ImageDialogComponent {
  dialogData = inject<ImageDialogData>(MAT_DIALOG_DATA);
  dialogRef = inject(MatDialogRef<ImageDialogComponent>);
  
  // Zoom controls
  scale = signal(1);
  translateX = signal(0);
  translateY = signal(0);
  
  // Track mouse movement for panning
  isDragging = signal(false);
  lastMouseX = signal(0);
  lastMouseY = signal(0);
  
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
   * Get transform style based on zoom and pan
   */
  getTransformStyle(): string {
    return `scale(${this.scale()}) translate(${this.translateX() / this.scale()}px, ${this.translateY() / this.scale()}px)`;
  }
}
