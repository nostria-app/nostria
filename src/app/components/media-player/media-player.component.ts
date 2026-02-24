import {
  Component,
  inject,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  PLATFORM_ID,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { LiveStreamPlayerComponent } from './live-stream-player/live-stream-player.component';
import { AudioPlayerComponent } from './audio-player/audio-player.component';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { YouTubePlayerComponent } from './youtube-player/youtube-player.component';
import { LayoutService } from '../../services/layout.service';
import { MediaPlayerService } from '../../services/media-player.service';

@Component({
  selector: 'app-media-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiveStreamPlayerComponent,
    AudioPlayerComponent,
    VideoPlayerComponent,
    YouTubePlayerComponent,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss',
  host: {
    '[class.footer-mode]': '!layout.fullscreenMediaPlayer()',
    '[class.fullscreen-mode]': 'layout.fullscreenMediaPlayer()',
    '[class.expanded-mode]': 'layout.expandedMediaPlayer()',
    '[class.podcast-mode]': 'isPodcast()',
    '[class.footer-dragging]': 'isFooterDragging() || isResizing()',
  },
})
export class MediaPlayerComponent implements OnDestroy {
  readonly layout = inject(LayoutService);
  readonly media = inject(MediaPlayerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Footer drag state
  readonly isFooterDragging = signal(false);

  // Footer drag position (relative offset from default position)
  readonly footerOffsetX = signal(0);
  readonly footerOffsetY = signal(0);
  private footerDragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  // Resize state
  readonly isResizing = signal(false);
  readonly resizeWidth = signal<number | null>(null);  // null = use CSS default
  readonly resizeHeight = signal<number | null>(null); // null = use CSS default
  private resizeStart = { x: 0, y: 0, width: 0, height: 0 };

  // Bound event handlers for proper cleanup
  private boundFooterMove = this.onFooterMouseMove.bind(this);
  private boundFooterUp = this.onFooterMouseUp.bind(this);
  private boundResizeMove = this.onResizeMouseMove.bind(this);
  private boundResizeUp = this.onResizeMouseUp.bind(this);
  private boundWindowResize = this.onWindowResize.bind(this);

  // Footer mode is when NOT in fullscreen
  footer = computed(() => !this.layout.fullscreenMediaPlayer());

  // Computed signals to determine which player to show
  isLiveStream = computed(() => (this.media.current()?.type === 'HLS' || this.media.current()?.type === 'LiveKit' || this.media.current()?.type === 'External') && this.media.current()?.isLiveStream);
  isYouTube = computed(() => this.media.current()?.type === 'YouTube');
  isVideo = computed(() => this.media.current()?.type === 'Video'
    || (this.media.current()?.type === 'HLS' && !this.media.current()?.isLiveStream)
    || (this.media.current()?.type === 'Music' && !!this.media.current()?.video));
  isAudio = computed(() => (this.media.current()?.type === 'Music' && !this.media.current()?.video) || this.media.current()?.type === 'Podcast');
  isPodcast = computed(() => this.media.current()?.type === 'Podcast');

  constructor() {
    if (this.isBrowser) {
      // Sync footer drag offset and resize dimensions to the host element
      effect(() => {
        const isFooter = this.footer();
        const offsetX = this.footerOffsetX();
        const offsetY = this.footerOffsetY();
        const width = this.resizeWidth();
        const height = this.resizeHeight();
        const el = document.querySelector('app-media-player') as HTMLElement;
        if (!el) return;

        if (isFooter) {
          if (offsetX === 0 && offsetY === 0) {
            el.style.transform = 'none';
          } else {
            el.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
          }
          // Apply resize dimensions if set
          el.style.maxWidth = width !== null ? `${width}px` : '';
          el.style.height = height !== null ? `${height}px` : '';
        } else {
          // In fullscreen mode, always clear the transform and resize overrides
          el.style.transform = 'none';
          el.style.maxWidth = '';
          el.style.height = '';
        }
      });

      // Listen for window resize to clamp pill position
      window.addEventListener('resize', this.boundWindowResize);

      // Reset custom resize dimensions when expanded mode changes
      effect(() => {
        this.layout.expandedMediaPlayer(); // track signal
        this.resizeWidth.set(null);
        this.resizeHeight.set(null);
      });
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      window.removeEventListener('resize', this.boundWindowResize);
      document.removeEventListener('mousemove', this.boundFooterMove);
      document.removeEventListener('mouseup', this.boundFooterUp);
      document.removeEventListener('mousemove', this.boundResizeMove);
      document.removeEventListener('mouseup', this.boundResizeUp);
    }
  }

  // --- Footer drag logic ---

  /**
   * Calculate the allowed offset bounds so the pill stays within the viewport.
   *
   * Uses getBoundingClientRect() to get the element's actual position, then
   * subtracts the current transform offsets to find the base (untransformed)
   * position. From there, computes how far offsets can go while keeping
   * at least minVisible pixels on screen on each edge.
   */
  private getOffsetBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minVisible = 48;

    const el = document.querySelector('app-media-player') as HTMLElement;
    if (!el) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const rect = el.getBoundingClientRect();
    const currentOffsetX = this.footerOffsetX();
    const currentOffsetY = this.footerOffsetY();

    // The rect includes the current transform. Subtract to get the base position.
    const baseLeft = rect.left - currentOffsetX;
    const baseTop = rect.top - currentOffsetY;
    const pillWidth = rect.width;
    const pillHeight = rect.height;

    // With offset, the pill's actual position is:
    //   left = baseLeft + offsetX
    //   top  = baseTop + offsetY
    //
    // Constraints: at least minVisible pixels of the pill must remain visible on each edge.

    // Left edge: pill right edge (baseLeft + offsetX + pillWidth) >= minVisible
    const minX = minVisible - pillWidth - baseLeft;
    // Right edge: pill left edge (baseLeft + offsetX) <= vw - minVisible
    const maxX = vw - minVisible - baseLeft;

    // Top edge: pill bottom edge (baseTop + offsetY + pillHeight) >= minVisible
    const minY = minVisible - pillHeight - baseTop;
    // Bottom edge: pill top edge (baseTop + offsetY) <= vh - minVisible
    const maxY = vh - minVisible - baseTop;

    return { minX, maxX, minY, maxY };
  }

  private clampOffsets(offsetX: number, offsetY: number): { x: number; y: number } {
    const bounds = this.getOffsetBounds();
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, offsetX)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, offsetY)),
    };
  }

  onFooterMouseDown(event: MouseEvent): void {
    // Don't start drag if clicking on a button or interactive element
    if ((event.target as HTMLElement).closest('button, a, input, mat-slider, [mattooltip]')) {
      return;
    }

    // Don't allow dragging when in fullscreen mode (YouTube uses footer-drag-zone in fullscreen)
    if (!this.footer()) {
      return;
    }

    this.isFooterDragging.set(true);
    this.footerDragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.footerOffsetX(),
      offsetY: this.footerOffsetY(),
    };

    document.addEventListener('mousemove', this.boundFooterMove);
    document.addEventListener('mouseup', this.boundFooterUp);
    event.preventDefault();
  }

  private onFooterMouseMove(event: MouseEvent): void {
    if (!this.isFooterDragging()) return;

    const rawOffsetX = this.footerDragStart.offsetX + (event.clientX - this.footerDragStart.x);
    const rawOffsetY = this.footerDragStart.offsetY + (event.clientY - this.footerDragStart.y);

    const clamped = this.clampOffsets(rawOffsetX, rawOffsetY);
    this.footerOffsetX.set(clamped.x);
    this.footerOffsetY.set(clamped.y);
  }

  private onFooterMouseUp(): void {
    this.isFooterDragging.set(false);
    document.removeEventListener('mousemove', this.boundFooterMove);
    document.removeEventListener('mouseup', this.boundFooterUp);
  }

  /**
   * When the browser window is resized, clamp the pill's offset so it remains visible.
   */
  private onWindowResize(): void {
    if (!this.footer()) return;

    const currentX = this.footerOffsetX();
    const currentY = this.footerOffsetY();

    // Skip if no offset applied
    if (currentX === 0 && currentY === 0) return;

    const clamped = this.clampOffsets(currentX, currentY);
    if (clamped.x !== currentX || clamped.y !== currentY) {
      this.footerOffsetX.set(clamped.x);
      this.footerOffsetY.set(clamped.y);
    }
  }

  // --- Resize logic ---

  onResizeMouseDown(event: MouseEvent): void {
    const el = document.querySelector('app-media-player') as HTMLElement;
    if (!el) return;

    this.isResizing.set(true);
    const rect = el.getBoundingClientRect();
    this.resizeStart = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };

    document.addEventListener('mousemove', this.boundResizeMove);
    document.addEventListener('mouseup', this.boundResizeUp);
    event.preventDefault();
    event.stopPropagation();
  }

  private onResizeMouseMove(event: MouseEvent): void {
    if (!this.isResizing()) return;

    const minWidth = 300;
    const minHeight = 200;
    const maxWidth = Math.min(1200, window.innerWidth - 32);
    const maxHeight = Math.min(900, window.innerHeight - 32);

    const deltaX = event.clientX - this.resizeStart.x;
    const deltaY = event.clientY - this.resizeStart.y;

    const newWidth = Math.max(minWidth, Math.min(maxWidth, this.resizeStart.width + deltaX));
    const newHeight = Math.max(minHeight, Math.min(maxHeight, this.resizeStart.height + deltaY));

    this.resizeWidth.set(newWidth);
    this.resizeHeight.set(newHeight);
  }

  private onResizeMouseUp(): void {
    this.isResizing.set(false);
    document.removeEventListener('mousemove', this.boundResizeMove);
    document.removeEventListener('mouseup', this.boundResizeUp);
  }
}
