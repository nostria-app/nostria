import {
  Component,
  ElementRef,
  inject,
  signal,
  effect,
  input,
  ViewChild,
  Renderer2,
  afterNextRender,
  AfterViewInit,
  DOCUMENT,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { ThemeService } from '../../services/theme.service';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem } from '../../interfaces';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import {
  AddMediaDialog,
  AddMediaDialogData,
} from '../../pages/media-queue/add-media-dialog/add-media-dialog';
import { UtilitiesService } from '../../services/utilities.service';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TimePipe } from '../../pipes/time.pipe';

interface WindowControlsOverlay {
  getTitlebarAreaRect(): DOMRect;
  visible: boolean;
}

declare global {
  interface Navigator {
    windowControlsOverlay: WindowControlsOverlay;
  }
}

@Component({
  selector: 'app-media-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterModule,
    MatSliderModule,
    ReactiveFormsModule,
    FormsModule,
    TimePipe,
  ],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss',
})
export class MediaPlayerComponent implements AfterViewInit, OnInit, OnDestroy {
  private readonly layout = inject(LayoutService);
  private readonly theme = inject(ThemeService);
  private readonly utilities = inject(UtilitiesService);
  private readonly document = inject(DOCUMENT);
  private elementRef = inject(ElementRef);
  media = inject(MediaPlayerService);
  dialog = inject(MatDialog);
  footer = input<boolean>(false);
  expanded = false;
  // maximized = false;
  private readonly renderer = inject(Renderer2);
  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  private originalVideoParent?: HTMLElement;
  private originalVideoNextSibling?: Node | null;

  formatLabel(value: number): string {
    return TimePipe.time(value);
  }

  // Signals to track display mode state

  private mediaQueryList?: MediaQueryList;
  constructor() {
    if (!this.utilities.isBrowser()) {
      return;
    }

    // Effect to handle footer mode class
    effect(() => {
      const div = this.elementRef.nativeElement;
      const isFooterMode = this.footer();

      if (isFooterMode) {
        div.classList.add('footer-mode');
      } else {
        div.classList.remove('footer-mode');
      }
    });

    // Effect to handle display mode changes (only for toolbar mode)
    effect(() => {
      const div = this.elementRef.nativeElement;
      const isOverlayMode = this.layout.overlayMode();
      const isFooterMode = this.footer();

      // Only apply overlay mode logic if not in footer mode
      if (!isFooterMode) {
        if (isOverlayMode) {
          div.classList.add('window-controls-overlay');
          div.style.display = 'block';
        } else {
          div.classList.remove('window-controls-overlay');
          div.style.display = 'none';
        }
      } else {
        // Footer mode should always be visible
        div.style.display = 'block';
        div.classList.remove('window-controls-overlay');
      }
    });

    // Effect to handle theme changes and update background color
    effect(() => {
      const isDark = this.theme.darkMode();
      this.updateBackgroundFromThemeColor();
    });

    // Effect to handle fullscreen video mode
    effect(() => {
      const isFullscreen = this.media.isFullscreen();

      if (isFullscreen && this.videoElement) {
        this.moveVideoToGlobalContainer();
      } else if (!isFullscreen && this.originalVideoParent) {
        this.moveVideoBackToOriginal();
      }
    });

    // Use afterNextRender to ensure ViewChild is available
    afterNextRender(() => {
      this.registerVideoElement();
    });
  }

  ngAfterViewInit() {
    // Register video element when view is initialized
    this.registerVideoElement();
  }

  registerVideoElement() {
    if (this.videoElement?.nativeElement) {
      console.log('Registering video element with service:', this.videoElement.nativeElement);
      this.media.setVideoElement(this.videoElement.nativeElement);
    } else {
      console.log('Video element not available yet');
    }
  }

  onVideoError(event: Event) {
    const video = event.target as HTMLVideoElement;
    console.error('Video error:', video.error);
    if (video.error) {
      console.error('Video error code:', video.error.code);
      console.error('Video error message:', video.error.message);
    }
  }

  onVideoEnded() {
    console.log('Video ended event received in component');
    // The service will handle this through its own event listener
    // This is just for additional logging/debugging if needed
  }

  private updateBackgroundFromThemeColor(): void {
    const metaThemeColor = this.document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const themeColor = metaThemeColor.getAttribute('content');
      if (themeColor) {
        const div = this.elementRef.nativeElement;
        div.style.setProperty('--theme-background-color', themeColor);
      }
    }
  }

  ngOnInit() {
    if (!this.utilities.isBrowser()) {
      return;
    }

    const div = this.elementRef.nativeElement;

    // Only apply window controls overlay logic for toolbar mode (not footer mode)
    if (!this.footer()) {
      if ('windowControlsOverlay' in navigator) {
        const { x } = navigator.windowControlsOverlay.getTitlebarAreaRect();
        if (x === 0) {
          div.classList.add('search-controls-right');
        } else {
          div.classList.add('search-controls-left');
        }

        // if (navigator.windowControlsOverlay.visible) {
        //   // The window controls overlay is visible in the title bar area.
        // }
      } else {
        div.classList.add('search-controls-right');
      }

      // Create and setup the media query list
      this.mediaQueryList = window.matchMedia('(display-mode: window-controls-overlay)');

      // Set initial state
      this.layout.overlayMode.set(this.mediaQueryList.matches);

      // Define callback for media query changes
      const handleDisplayModeChange = (event: MediaQueryListEvent) => {
        this.layout.overlayMode.set(event.matches);
      };

      // Add event listener
      this.mediaQueryList.addEventListener('change', handleDisplayModeChange);
    }
  }

  private moveVideoToGlobalContainer(): void {
    if (!this.videoElement?.nativeElement) return;

    const video = this.videoElement.nativeElement;
    const globalContainer = this.document.getElementById('global-fullscreen-container');

    if (!globalContainer) return;

    // Store original position
    this.originalVideoParent = video.parentElement as HTMLElement;
    this.originalVideoNextSibling = video.nextSibling;

    // Move video to global container
    this.renderer.appendChild(globalContainer, video);

    // Show global container
    this.renderer.setStyle(globalContainer, 'display', 'flex');

    // Add escape key listener
    this.addEscapeListener();
  }

  private moveVideoBackToOriginal(): void {
    if (!this.videoElement?.nativeElement || !this.originalVideoParent) return;

    const video = this.videoElement.nativeElement;
    const globalContainer = this.document.getElementById('global-fullscreen-container');

    // Hide global container
    if (globalContainer) {
      this.renderer.setStyle(globalContainer, 'display', 'none');
    }

    // Move video back to original position
    if (this.originalVideoNextSibling) {
      this.renderer.insertBefore(this.originalVideoParent, video, this.originalVideoNextSibling);
    } else {
      this.renderer.appendChild(this.originalVideoParent, video);
    }

    // Clean up
    this.originalVideoParent = undefined;
    this.originalVideoNextSibling = undefined;
    this.removeEscapeListener();
  }

  private escapeListener = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.media.isFullscreen()) {
      this.media.exitFullscreen();
    }
  };

  private addEscapeListener(): void {
    this.document.addEventListener('keydown', this.escapeListener);
  }

  private removeEscapeListener(): void {
    this.document.removeEventListener('keydown', this.escapeListener);
  }

  ngOnDestroy() {
    // Clean up media query listener
    if (this.mediaQueryList) {
      this.mediaQueryList.removeEventListener('change', () => {});
    }
    this.removeEscapeListener();

    // Clean up video element reference in service
    this.media.setVideoElement(undefined);

    // Clean up if component is destroyed while in fullscreen
    if (this.media.isFullscreen() && this.originalVideoParent) {
      this.moveVideoBackToOriginal();
    }
  }

  addTestSong() {
    // Open the add media dialog with a test song
    const dialogRef = this.dialog.open(AddMediaDialog, {
      data: {},
      maxWidth: '100vw',
      panelClass: 'full-width-dialog',
    });

    dialogRef.afterClosed().subscribe(async (result: AddMediaDialogData) => {
      if (!result || !result.url) {
        return;
      }

      if (result.url.indexOf('youtu.be') > -1 || result.url.indexOf('youtube.com') > -1) {
        const youtubes = [...result.url.matchAll(this.utilities.regexpYouTube)];
        const youtube = youtubes.map((i) => {
          return { url: `https://www.youtube.com/embed/${i[1]}` };
        });

        for (let index = 0; index < youtube.length; index++) {
          const youtubeUrl = youtube[index].url;
          this.media.enque({
            artist: '',
            artwork: '/logos/youtube.png',
            title: youtubeUrl,
            source: youtubeUrl,
            type: 'YouTube',
          });
        }
      } else if (result.url.indexOf('.mp4') > -1 || result.url.indexOf('.webm') > -1) {
        this.media.enque({
          artist: '',
          artwork: '/logos/youtube.png',
          title: result.url,
          source: result.url,
          type: 'Video',
        });
      } else {
        this.media.enque({
          artist: '',
          artwork: '',
          title: result.url,
          source: result.url,
          type: 'Music',
        });
      }
    });

    // let mediaItem: MediaItem = {
    //   artist: 'Test Artist',
    //   title: 'Test Song',
    //   artwork: 'https://example.com/artwork.jpg',
    //   source: 'https://github.com/rafaelreis-hotmart/Audio-Sample-files/raw/master/sample.mp3',
    //   type: 'Music'
    // };
    // this.media.enque(mediaItem);

    // this.media.start();
  }
}
