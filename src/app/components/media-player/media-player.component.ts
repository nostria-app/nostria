import {
  Component,
  ElementRef,
  inject,
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaPlayerService } from '../../services/media-player.service';
import { RouterModule } from '@angular/router';
import { Router, NavigationEnd } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { UtilitiesService } from '../../services/utilities.service';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TimePipe } from '../../pipes/time.pipe';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { LiveChatComponent } from '../live-chat/live-chat.component';

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
    MatTooltipModule,
    RouterModule,
    MatSliderModule,
    ReactiveFormsModule,
    FormsModule,
    TimePipe,
    LiveChatComponent,
  ],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.fullscreen-host]': 'layout.fullscreenMediaPlayer()',
  },
})
export class MediaPlayerComponent implements AfterViewInit, OnInit, OnDestroy {
  // expose layout to template so we can read overlayMode() there
  readonly layout = inject(LayoutService);
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
  private readonly router = inject(Router);
  private routerSub?: Subscription;
  private displayModeListener?: (event: MediaQueryListEvent) => void;
  // store the current page title shown in the titlebar
  pageTitle = '';

  // Chat visibility state
  chatVisible = true;

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  private originalVideoParent?: HTMLElement;
  private originalVideoNextSibling?: Node | null;
  private isExitingFullscreen = false;

  formatLabel(value: number): string {
    return TimePipe.time(value);
  }

  toggleFullscreen(): void {
    const currentState = this.layout.fullscreenMediaPlayer();

    if (currentState) {
      // Exiting fullscreen - add exit animation class
      this.isExitingFullscreen = true;
      const element = this.elementRef.nativeElement.querySelector('.media-player-footer');
      if (element) {
        element.classList.add('exiting-fullscreen');
      }

      // Navigate back to previous route
      if (this.utilities.isBrowser() && window.history.state?.previousUrl) {
        this.router.navigateByUrl(window.history.state.previousUrl);
      }

      // Wait for animation to complete before removing fullscreen mode
      setTimeout(() => {
        this.layout.fullscreenMediaPlayer.set(false);
        this.isExitingFullscreen = false;
        if (element) {
          element.classList.remove('exiting-fullscreen');
        }
      }, 400); // Match the animation duration (400ms)
    } else {
      // Entering fullscreen
      this.layout.fullscreenMediaPlayer.set(true);

      // Update URL with encoded event data if it's a live stream
      if (this.media.current?.isLiveStream && this.media.current?.liveEventData) {
        const encodedEvent = this.utilities.encodeEventForUrl(this.media.current.liveEventData);

        // Store current URL to restore on exit
        const previousUrl = this.router.url;

        console.log('Navigating to stream URL:', `/stream/${encodedEvent.substring(0, 50)}...`);
        console.log('Previous URL:', previousUrl);

        this.router.navigate(['/stream', encodedEvent], {
          state: { previousUrl }
        });
      } else {
        console.log('Not a live stream or no event data:', {
          isLiveStream: this.media.current?.isLiveStream,
          hasEventData: !!this.media.current?.liveEventData
        });
      }
    }
  }

  toggleChatVisibility(): void {
    this.chatVisible = !this.chatVisible;
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
      // read the signal so the effect reruns when darkMode changes
      this.theme.darkMode();
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

      // Define callback for media query changes and keep a reference so we can remove it later
      this.displayModeListener = (event: MediaQueryListEvent) => {
        this.layout.overlayMode.set(event.matches);
      };

      // Add event listener
      this.mediaQueryList.addEventListener('change', this.displayModeListener);
    }

    // Initialize page title from document
    this.pageTitle = this.document.title || '';

    // Subscribe to router navigation end events to update title when routes change
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        this.pageTitle = this.document.title || '';
      });
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
    if (event.key === 'Escape' && this.layout.fullscreenMediaPlayer()) {
      this.toggleFullscreen(); // Use toggleFullscreen to get animation
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
      if (this.displayModeListener) {
        this.mediaQueryList.removeEventListener('change', this.displayModeListener);
      }
    }
    this.removeEscapeListener();

    // Clean up video element reference in service
    this.media.setVideoElement(undefined);

    // Clean up if component is destroyed while in fullscreen
    if (this.media.isFullscreen() && this.originalVideoParent) {
      this.moveVideoBackToOriginal();
    }

    // Unsubscribe router events
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
  }
}
