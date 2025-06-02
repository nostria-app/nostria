import { Component, ElementRef, inject, signal, effect, input } from '@angular/core';
import { LayoutService } from '../../services/layout.service';
import { ThemeService } from '../../services/theme.service';
import { CommonModule, DOCUMENT } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem } from '../../interfaces';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { AddMediaDialog, AddMediaDialogData } from '../../pages/media-queue/add-media-dialog/add-media-dialog';
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
  imports: [MatButtonModule, MatIconModule, RouterModule, MatSliderModule, ReactiveFormsModule, FormsModule, TimePipe, CommonModule],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss'
})
export class MediaPlayerComponent {
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

  formatLabel(value: number): string {
    return TimePipe.time(value);
  }

  // Signals to track display mode state

  private mediaQueryList?: MediaQueryList;
  constructor() {
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
  } ngOnInit() {
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

  ngOnDestroy() {
    // Clean up media query listener
    if (this.mediaQueryList) {
      this.mediaQueryList.removeEventListener('change', () => { });
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
      debugger;
      if (!result || !result.url) {
        return;
      }

      if (result.url.indexOf('youtu.be') > -1 || result.url.indexOf('youtube.com') > -1) {
        const youtubes = [...result.url.matchAll(this.utilities.regexpYouTube)];
        let youtube = youtubes.map((i) => {
          return { url: `https://www.youtube.com/embed/${i[1]}` };
        });

        for (let index = 0; index < youtube.length; index++) {
          const youtubeUrl = youtube[index].url;
          this.media.enque({ artist: '', artwork: '/logos/youtube.png', title: youtubeUrl, source: youtubeUrl, type: 'YouTube' });
        }
      } else if (result.url.indexOf('.mp4') > -1 || result.url.indexOf('.webm') > -1) {
        this.media.enque({ artist: '', artwork: '/logos/youtube.png', title: result.url, source: result.url, type: 'Video' });
      } else {
        this.media.enque({ artist: '', artwork: '', title: result.url, source: result.url, type: 'Music' });
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
