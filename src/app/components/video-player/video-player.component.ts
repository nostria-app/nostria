import { ChangeDetectionStrategy, Component, inject, signal, effect, ElementRef, viewChild, computed } from '@angular/core';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-video-player',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPlayerComponent {
  media = inject(MediaPlayerService);
  layout = inject(LayoutService);

  private windowRef = viewChild<ElementRef>('videoWindow');
  isDraggingState = signal(false);
  isResizingState = signal(false);
  private dragStart = signal({ x: 0, y: 0, windowX: 0, windowY: 0 });
  private resizeStart = signal({ x: 0, y: 0, width: 0, height: 0 });

  // Computed MIME type for video based on URL
  videoMimeType = computed(() => {
    const videoUrl = this.media.videoUrl();
    if (!videoUrl) return 'video/mp4';

    const url = String(videoUrl);
    return this.getMimeTypeFromUrl(url);
  });

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

    this.isDraggingState.set(true);
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
    this.isResizingState.set(true);
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
    if (this.isDraggingState()) {
      const start = this.dragStart();
      const newX = start.windowX + (event.clientX - start.x);
      const newY = start.windowY + (event.clientY - start.y);

      // Constrain to viewport
      const maxX = window.innerWidth - this.media.videoWindowState().width;
      const maxY = window.innerHeight - this.media.videoWindowState().height;

      this.media.updateWindowPosition(
        Math.max(0, Math.min(newX, maxX)),
        Math.max(0, Math.min(newY, maxY))
      );
    }
  }

  private onResizeMouseMove(event: MouseEvent) {
    if (this.isResizingState()) {
      const start = this.resizeStart();
      const newWidth = Math.max(320, start.width + (event.clientX - start.x));
      const newHeight = Math.max(180, start.height + (event.clientY - start.y));

      this.media.updateWindowSize(newWidth, newHeight);
    }
  }

  private onMouseUp() {
    this.isDraggingState.set(false);
    document.removeEventListener('mousemove', this.onMouseMove.bind(this));
    document.removeEventListener('mouseup', this.onMouseUp.bind(this));
  }

  private onResizeMouseUp() {
    this.isResizingState.set(false);
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

  /**
   * Determines the correct MIME type based on the video file extension
   * Modern .mov files are typically MPEG-4 videos that can be played by modern browsers
   */
  private getMimeTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();

    // Extract file extension
    const extension = urlLower.split('?')[0].split('#')[0].split('.').pop();

    // Map file extensions to MIME types
    const mimeTypeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'm4v': 'video/mp4',
      'mov': 'video/mp4', // Modern .mov files are usually MPEG-4
      'qt': 'video/quicktime',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'ogv': 'video/ogg',
      'avi': 'video/x-msvideo',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'mkv': 'video/x-matroska',
      '3gp': 'video/3gpp',
      '3g2': 'video/3gpp2',
    };

    // Return the MIME type or default to mp4
    return mimeTypeMap[extension || ''] || 'video/mp4';
  }
}
