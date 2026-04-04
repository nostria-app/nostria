import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { map } from 'rxjs';
import { RouteDataService } from '../../services/route-data.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { LayoutService } from '../../services/layout.service';
import { MediaPlayerService } from '../../services/media-player.service';


@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-navigation',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, RouterModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss',
})
export class NavigationComponent {
  hasState = computed(() => {
    return this.routeDataService.canGoBack();
  });

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private localSettings = inject(LocalSettingsService);
  private panelNav = inject(PanelNavigationService);
  readonly layout = inject(LayoutService);
  readonly media = inject(MediaPlayerService);

  // Convert route data to signal
  routeData = toSignal(this.route.data.pipe(map(data => data)), {
    initialValue: {},
  });

  isRoot = signal<boolean>(false);

  // Touch and hold functionality
  private touchTimer: number | null = null;
  private readonly TOUCH_HOLD_DURATION = 500; // 500ms

  routeDataService = inject(RouteDataService);

  // Toolbar media player state
  showToolbarPlayer = computed(() => this.layout.mediaPlayerInToolbar() && this.media.hasQueue());
  toolbarPlayerArtwork = computed(() => this.media.current()?.artwork ?? null);
  toolbarPlayerHovered = signal(false);
  toolbarPlayerFlyoutPosition = signal<{ top: number; left: number } | null>(null);
  private toolbarPlayerHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private toolbarPlayerFlyoutHovered = false;
  toolbarPlayerIntro = signal(false);
  private toolbarPlayerIntroTimer: ReturnType<typeof setTimeout> | null = null;
  private toolbarPlayerWasDocked = false;
  toolbarPlayerShowFlyout = computed(() =>
    (this.toolbarPlayerHovered() || this.toolbarPlayerIntro()) && this.showToolbarPlayer()
  );

  hasSongLink = computed(() => {
    const current = this.media.current();
    return !!(current?.eventPubkey && current?.eventIdentifier);
  });

  hasArtistLink = computed(() => {
    const current = this.media.current();
    return !!current?.eventPubkey;
  });

  constructor() {
    effect(() => {
      const routeData = this.routeDataService.currentRouteData();
      this.isRoot.set(routeData['isRoot'] || false);
    });

    // Show a brief intro flyout when the media player is docked to the toolbar
    effect(() => {
      const docked = this.layout.mediaPlayerInToolbar();
      const hasQueue = this.media.hasQueue();
      const wasDocked = this.toolbarPlayerWasDocked;
      this.toolbarPlayerWasDocked = docked;

      if (docked && hasQueue && !wasDocked) {
        setTimeout(() => {
          this.toolbarPlayerFlyoutPosition.set({ top: 56, left: 8 });
          this.toolbarPlayerIntro.set(true);

          this.toolbarPlayerIntroTimer = setTimeout(() => {
            this.toolbarPlayerIntro.set(false);
          }, 1200);
        });
      } else if (!docked) {
        this.toolbarPlayerIntro.set(false);
        if (this.toolbarPlayerIntroTimer) {
          clearTimeout(this.toolbarPlayerIntroTimer);
          this.toolbarPlayerIntroTimer = null;
        }
      }
    });
  }

  // Regular click - go back
  goBack() {
    this.routeDataService.goBack();
  }

  /**
   * Navigate to the configured home destination and clear navigation history.
   * Also clears the right panel content to return to a clean state.
   * Options:
   * - 'feeds': Navigate to /f (Feeds page)
   * - 'home': Navigate to / (Home page)
   * - 'first-menu-item': Navigate to the first visible menu item
   */
  navigateToHome(): void {
    // Close the right panel - this triggers the callback that properly clears
    // both the RightPanelService and the layout state
    this.panelNav.closeRight();

    // Clear navigation history
    this.routeDataService.clearHistory();

    const destination = this.localSettings.homeDestination();
    let path: string;

    switch (destination) {
      case 'home':
        path = '/';
        break;
      case 'first-menu-item':
        path = this.localSettings.firstMenuItemPath();
        break;
      case 'feeds':
      default:
        path = '/f';
        break;
    }

    // Ensure path is absolute for proper navigation
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    // Check if we're already on the target path. If so, skip clearing the
    // left stack because router.navigate() will be a no-op (same URL) and
    // the NavigationEnd event that repopulates the stack won't fire, leaving
    // the panel content hidden (blank screen).
    const currentPath = '/' + this.router.url.split('?')[0].split('(')[0].replace(/^\/+/, '');
    const alreadyOnTarget = currentPath === path;

    if (!alreadyOnTarget) {
      // Clear left panel navigation stack only when actually changing routes
      this.panelNav.clearLeftStack();
      this.router.navigate([path]);
    }
  }

  // Right click - show context menu
  onRightClick(event: MouseEvent) {
    event.preventDefault();
    this.showContextMenu(event);
  }

  // Touch start - begin touch hold timer
  onTouchStart(event: TouchEvent) {
    // Store the start time for duration checking
    (event.target as any).touchStartTime = event.timeStamp;

    this.touchTimer = window.setTimeout(() => {
      // Convert touch event to mouse event for context menu
      const touch = event.touches[0];
      const mouseEvent = new MouseEvent('contextmenu', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true,
      });
      this.onRightClick(mouseEvent);
    }, this.TOUCH_HOLD_DURATION);
  }

  // Touch end - clear timer and handle regular click
  onTouchEnd(event: TouchEvent) {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;

      // If timer was cleared quickly, treat as regular click
      const touchDuration = event.timeStamp - ((event.target as any).touchStartTime || 0);
      if (touchDuration < this.TOUCH_HOLD_DURATION) {
        event.preventDefault(); // Prevent mouse events
        this.goBack();
      }
    }
  }

  // Touch cancel - clear timer
  onTouchCancel(event: TouchEvent) {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
  }

  // Show context menu using global service
  private showContextMenu(event: MouseEvent) {
    if (this.routeDataService.canGoBack()) {
      // Dispatch a custom event to show the context menu
      const customEvent = new CustomEvent('show-navigation-context-menu', {
        detail: {
          x: event.clientX,
          y: event.clientY,
          onItemSelected: (index: number) => {
            this.routeDataService.goToHistoryItem(index);
          },
        },
      });
      window.dispatchEvent(customEvent);
    }
  }

  // --- Toolbar media player methods ---

  togglePlayPause(): void {
    if (this.media.paused) {
      this.media.resume();
    } else {
      this.media.pause();
    }
  }

  undockFromToolbar(): void {
    this.layout.mediaPlayerInToolbar.set(false);
    this.toolbarPlayerHovered.set(false);
    // On mobile, flip the cube to show the player face
    if (this.layout.isHandset()) {
      this.layout.setCubePlayerFace(true);
    }
  }

  openFullscreenPlayer(): void {
    this.layout.mediaPlayerInToolbar.set(false);
    this.layout.openFullscreenMediaPlayer();
    this.toolbarPlayerHovered.set(false);
  }

  goToSong(): void {
    const current = this.media.current();
    if (current?.eventPubkey && current?.eventIdentifier) {
      this.router.navigate(['/music/song', current.eventPubkey, current.eventIdentifier]);
      this.toolbarPlayerHovered.set(false);
    }
  }

  goToArtist(): void {
    const current = this.media.current();
    if (current?.eventPubkey) {
      this.router.navigate(['/music/artist', current.eventPubkey]);
      this.toolbarPlayerHovered.set(false);
    }
  }

  onToolbarPlayerEnter(event: MouseEvent): void {
    if (this.toolbarPlayerHoverTimer) {
      clearTimeout(this.toolbarPlayerHoverTimer);
      this.toolbarPlayerHoverTimer = null;
    }
    if (this.toolbarPlayerIntroTimer) {
      clearTimeout(this.toolbarPlayerIntroTimer);
      this.toolbarPlayerIntroTimer = null;
    }
    this.toolbarPlayerIntro.set(false);

    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();

    const top = rect.bottom + 4;
    const left = rect.left;

    this.toolbarPlayerFlyoutPosition.set({ top, left });
    this.toolbarPlayerHovered.set(true);
  }

  onToolbarPlayerLeave(): void {
    this.toolbarPlayerHoverTimer = setTimeout(() => {
      if (!this.toolbarPlayerFlyoutHovered) {
        this.toolbarPlayerHovered.set(false);
      }
    }, 200);
  }

  onToolbarPlayerFlyoutEnter(): void {
    this.toolbarPlayerFlyoutHovered = true;
    if (this.toolbarPlayerHoverTimer) {
      clearTimeout(this.toolbarPlayerHoverTimer);
      this.toolbarPlayerHoverTimer = null;
    }
    if (this.toolbarPlayerIntroTimer) {
      clearTimeout(this.toolbarPlayerIntroTimer);
      this.toolbarPlayerIntroTimer = null;
    }
    this.toolbarPlayerIntro.set(false);
    this.toolbarPlayerHovered.set(true);
  }

  onToolbarPlayerFlyoutLeave(): void {
    this.toolbarPlayerFlyoutHovered = false;
    this.toolbarPlayerHoverTimer = setTimeout(() => {
      this.toolbarPlayerHovered.set(false);
    }, 200);
  }
}
