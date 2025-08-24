import { Component, inject, signal, effect, ElementRef, viewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-video-player',
  imports: [NgClass, MatIconModule, MatButtonModule],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent {
  media = inject(MediaPlayerService);
  layout = inject(LayoutService);

  private windowRef = viewChild<ElementRef>('videoWindow');
  private isDragging = signal(false);
  private isResizing = signal(false);
  private dragStart = signal({ x: 0, y: 0, windowX: 0, windowY: 0 });
  private resizeStart = signal({ x: 0, y: 0, width: 0, height: 0 });

  constructor() {
    // Handle window resize
    effect(() => {
      const state = this.media.videoWindowState();
      if (this.windowRef()) {
        const element = this.windowRef()!.nativeElement;
        element.style.left = `${state.x}px`;
        element.style.top = `${state.y}px`;
        element.style.width = `${state.width}px`;
        element.style.height = `${state.height}px`;
      }
    });
  }

  onMouseDown(event: MouseEvent) {
    if (
      (event.target as HTMLElement).closest('.window-controls') ||
      (event.target as HTMLElement).closest('.resize-handle')
    ) {
      return;
    }

    this.isDragging.set(true);
    const state = this.media.videoWindowState();
    this.dragStart.set({
      x: event.clientX,
      y: event.clientY,
      windowX: state.x,
      windowY: state.y,
    });

    document.addEventListener('mousemove', this.onMouseMove.bind(this));
    document.addEventListener('mouseup', this.onMouseUp.bind(this));
    event.preventDefault();
  }

  onResizeMouseDown(event: MouseEvent) {
    this.isResizing.set(true);
    const state = this.media.videoWindowState();
    this.resizeStart.set({
      x: event.clientX,
      y: event.clientY,
      width: state.width,
      height: state.height,
    });

    document.addEventListener('mousemove', this.onResizeMouseMove.bind(this));
    document.addEventListener('mouseup', this.onResizeMouseUp.bind(this));
    event.preventDefault();
    event.stopPropagation();
  }
  private onMouseMove(event: MouseEvent) {
    if (this.isDragging()) {
      const start = this.dragStart();
      const newX = start.windowX + (event.clientX - start.x);
      const newY = start.windowY + (event.clientY - start.y);

      // Get titlebar height when in overlay mode
      const titlebarHeight = this.layout.overlayMode() ? 33 : 0; // default 33px from env(titlebar-area-height, 33px)

      // Constrain to viewport
      const maxX = window.innerWidth - this.media.videoWindowState().width;
      const maxY = window.innerHeight - this.media.videoWindowState().height;

      this.media.updateWindowPosition(
        Math.max(0, Math.min(newX, maxX)),
        Math.max(titlebarHeight, Math.min(newY, maxY)),
      );
    }
  }

  private onResizeMouseMove(event: MouseEvent) {
    if (this.isResizing()) {
      const start = this.resizeStart();
      const newWidth = Math.max(320, start.width + (event.clientX - start.x));
      const newHeight = Math.max(180, start.height + (event.clientY - start.y));

      this.media.updateWindowSize(newWidth, newHeight);
    }
  }

  private onMouseUp() {
    this.isDragging.set(false);
    document.removeEventListener('mousemove', this.onMouseMove.bind(this));
    document.removeEventListener('mouseup', this.onMouseUp.bind(this));
  }

  private onResizeMouseUp() {
    this.isResizing.set(false);
    document.removeEventListener('mousemove', this.onResizeMouseMove.bind(this));
    document.removeEventListener('mouseup', this.onResizeMouseUp.bind(this));
  }

  onMinimize() {
    this.media.minimizeWindow();
  }

  onMaximize() {
    this.media.maximizeWindow();
  }

  onClose() {
    this.media.closeVideoWindow();
  }
  get windowClasses() {
    const state = this.media.videoWindowState();
    return {
      minimized: state.isMinimized,
      maximized: state.isMaximized,
      dragging: this.isDragging(),
      resizing: this.isResizing(),
      'overlay-mode': this.layout.overlayMode(),
    };
  }
}
