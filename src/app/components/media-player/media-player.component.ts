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
import { MatMenuModule } from '@angular/material/menu';
import { MediaPlayerService } from '../../services/media-player.service';
import { RouterModule } from '@angular/router';
import { Router, NavigationEnd } from '@angular/router';
import { Location } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { UtilitiesService } from '../../services/utilities.service';
import { FeedService } from '../../services/feed.service';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TimePipe } from '../../pipes/time.pipe';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { LiveChatComponent } from '../live-chat/live-chat.component';
import { StreamInfoBarComponent } from '../stream-info-bar/stream-info-bar.component';

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
    MatMenuModule,
    StreamInfoBarComponent,
  ],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.fullscreen-host]': 'layout.fullscreenMediaPlayer()',
  },
})
export class MediaPlayerComponent implements AfterViewInit, OnInit, OnDestroy {
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
  private readonly location = inject(Location);
  private readonly feed = inject(FeedService);
  private routerSub?: Subscription;
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

      // Check if we're on a stream route
      const currentUrl = this.router.url;
      const isStreamRoute = currentUrl.startsWith('/stream/');

      // If on a stream route, navigate to streams page
      if (isStreamRoute) {
        // Navigate to streams page
        this.router.navigate(['/streams']);
      } else if (this.utilities.isBrowser() && window.history.state?.previousUrl) {
        // Restore previous URL if available
        this.location.replaceState(window.history.state.previousUrl);
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
        // Get active relay URLs as hints
        const relayHints = this.feed.userRelays().map(r => r.url).slice(0, 5); // Limit to 5 relays
        const nevent = this.utilities.encodeEventForUrl(this.media.current.liveEventData, relayHints);

        // Store current URL to restore on exit (store in history state)
        const previousUrl = this.router.url;

        // Use replaceState to update URL without triggering navigation
        this.location.replaceState(`/stream/${nevent}`, '', { previousUrl });
      }
    }
  }

  toggleChatVisibility(): void {
    this.chatVisible = !this.chatVisible;
  }

  copyEventData(): void {
    if (this.media.current?.liveEventData) {
      this.layout.copyToClipboard(this.media.current.liveEventData, 'json');
    }
  }

  copyEventUrl(): void {
    if (this.media.current?.liveEventData) {
      const relayHints = this.feed.userRelays().map(r => r.url).slice(0, 5);
      const nevent = this.utilities.encodeEventForUrl(this.media.current.liveEventData, relayHints);
      const shareableUrl = `https://nostria.app/stream/${nevent}`;
      this.layout.copyToClipboard(shareableUrl, 'event URL');
    }
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
    this.removeEscapeListener();

    // Clean up video element reference in service
    this.media.setVideoElement(undefined);

    // Clean up if component is destroyed while in fullscreen
    if (this.media.isFullscreen() && this.originalVideoParent) {
      this.moveVideoBackToOriginal();
    }
  }
}
