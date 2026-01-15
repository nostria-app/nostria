import { Injectable, signal, computed, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NavigationStackService } from './navigation-stack.service';
import { PanelNavigationService } from './panel-navigation.service';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Event } from 'nostr-tools';

/**
 * View mode for the two-column layout
 * - 'fixed': Both columns are 700px wide (1400px total)
 * - 'full-width': Left column is 700px, right takes remaining space
 */
export type ViewMode = 'fixed' | 'full-width';

/**
 * Content type determines how components are rendered
 */
export type ContentType = 'list' | 'detail' | 'full-width';

/**
 * Route categories for panel assignment
 */
interface RouteCategory {
  type: ContentType;
  preserveOnNavigation?: boolean; // Whether this component should be preserved when navigating away
}

/**
 * Service to manage the two-column layout system
 * 
 * Layout rules:
 * - Left panel: List containers (Feeds, Profile, Music, Articles, etc.)
 * - Right panel: Detail views (Events, Article content, etc.)
 * - Feeds is always centered when no right content, moves to left when right content exists
 * - On mobile, right panel overlays the left panel
 */
@Injectable({
  providedIn: 'root'
})
export class TwoColumnLayoutService {
  private router = inject(Router);
  private navigationStack = inject(NavigationStackService);
  private panelNav = inject(PanelNavigationService);
  private breakpointObserver = inject(BreakpointObserver);

  // Column widths
  readonly NARROW_WIDTH = 700;
  readonly WIDE_WIDTH = 1400;
  readonly LEFT_PANEL_WIDTH = 700; // Keep for backwards compatibility
  readonly RIGHT_PANEL_WIDTH = 700;

  // Width mode: 'narrow' (700px) or 'wide' (1400px)
  private _leftWidthMode = signal<'narrow' | 'wide'>('narrow');
  leftWidthMode = this._leftWidthMode.asReadonly();

  // Preference (legacy, kept for backwards compatibility)
  private preferredLeftWidth = signal(this.LEFT_PANEL_WIDTH);

  // Dynamic column widths - automatically shrinks to narrow when right panel has content
  leftColumnWidth = computed(() => {
    // If right panel has content, always use narrow width for split view
    if (this.panelNav.hasRightContent()) {
      return this.NARROW_WIDTH;
    }
    // Otherwise use the width mode setting
    return this._leftWidthMode() === 'wide' ? this.WIDE_WIDTH : this.NARROW_WIDTH;
  });

  rightColumnWidth = computed(() => {
    if (this.panelNav.hasRightContent()) {
      return this.RIGHT_PANEL_WIDTH;
    }
    // When in wide mode with no right content, hide right panel placeholder
    if (this._leftWidthMode() === 'wide') return 0;
    return this.RIGHT_PANEL_WIDTH;
  });

  /**
   * Set left panel to wide mode (1400px).
   * Will automatically shrink to 700px when right panel opens.
   */
  setWideLeft(): void {
    this._leftWidthMode.set('wide');
    this.preferredLeftWidth.set(this.WIDE_WIDTH);
  }

  /**
   * Set left panel to narrow/split view mode (700px).
   */
  setSplitView(): void {
    this._leftWidthMode.set('narrow');
    this.preferredLeftWidth.set(this.NARROW_WIDTH);
  }

  /**
   * Alias for setWideLeft - enable wide left panel
   */
  enableWideLeft(): void {
    this.setWideLeft();
  }

  /**
   * Alias for setSplitView - enable split view
   */
  enableSplitView(): void {
    this.setSplitView();
  }

  // Current view mode
  private _viewMode = signal<ViewMode>('fixed');
  viewMode = this._viewMode.asReadonly();

  // Track if on mobile/small screen
  isMobile = signal(false);

  // Track if feeds panel is collapsed (hidden)
  feedsCollapsed = signal(false);

  // Track current left panel route (for preservation)
  leftPanelRoute = signal<string | null>(null);

  // Track current right panel route
  rightPanelRoute = signal<string | null>(null);

  // Track if we're on the home route
  isHomeRoute = signal(true);

  // Track if current route is a "list" type (should render in left panel, hiding feeds)
  isListRoute = signal(false);

  // Track if current route is a "detail" type (should render in right panel)
  isDetailRoute = signal(false);

  // Whether the right panel is currently showing content
  // Right panel has content only for detail/full-width routes
  hasRightContent = computed(() => {
    return this.isDetailRoute() && !this.isHomeRoute();
  });

  // Whether feeds should be centered (no right content, on home route)
  shouldCenterFeeds = computed(() => {
    return this.isHomeRoute() && !this.feedsCollapsed() && !this.isListRoute();
  });

  // Whether feeds should be hidden (list route is active)
  shouldHideFeeds = computed(() => {
    return this.isListRoute();
  });

  // Whether right panel should be full-width
  isRightPanelFullWidth = computed(() => {
    return this.navigationStack.isRightPanelFullWidth() || this._viewMode() === 'full-width';
  });

  // CSS class for the main layout container
  layoutClass = computed(() => {
    const classes: string[] = ['two-column-layout'];

    if (this.hasRightContent()) {
      classes.push('has-right-content');
    }

    if (this.shouldCenterFeeds()) {
      classes.push('feeds-centered');
    }

    if (this.feedsCollapsed()) {
      classes.push('feeds-collapsed');
    }

    if (this.isRightPanelFullWidth()) {
      classes.push('right-full-width');
    }

    if (this.isMobile()) {
      classes.push('mobile-layout');
    }

    return classes.join(' ');
  });

  // Route categories mapping
  private routeCategories: Record<string, RouteCategory> = {
    // List containers (left panel - these replace feeds)
    '': { type: 'list' }, // Home/Feeds
    'p': { type: 'list', preserveOnNavigation: true }, // Profile
    'u': { type: 'list', preserveOnNavigation: true }, // Profile by username
    'music': { type: 'list', preserveOnNavigation: true },
    'music/offline': { type: 'list', preserveOnNavigation: true },
    'music/liked': { type: 'list', preserveOnNavigation: true },
    'music/liked-playlists': { type: 'list', preserveOnNavigation: true },
    'music/tracks': { type: 'list', preserveOnNavigation: true },
    'music/playlists': { type: 'list', preserveOnNavigation: true },
    'music/artists': { type: 'list', preserveOnNavigation: true },
    'music/terms': { type: 'list', preserveOnNavigation: true },
    'articles': { type: 'list', preserveOnNavigation: true },
    'articles/edit': { type: 'list', preserveOnNavigation: true },
    'collections': { type: 'list', preserveOnNavigation: true },
    'people': { type: 'list', preserveOnNavigation: true },
    'summary': { type: 'list', preserveOnNavigation: true },
    'discover': { type: 'list', preserveOnNavigation: true },
    'discover/media': { type: 'list', preserveOnNavigation: true },
    'messages': { type: 'list', preserveOnNavigation: true },
    'notifications': { type: 'list', preserveOnNavigation: true },
    'notifications/settings': { type: 'list', preserveOnNavigation: true },
    'notifications/manage': { type: 'list', preserveOnNavigation: true },
    'lists': { type: 'list', preserveOnNavigation: true },
    'media': { type: 'list', preserveOnNavigation: true },
    'relays': { type: 'list', preserveOnNavigation: true },
    'settings': { type: 'list', preserveOnNavigation: true },
    'credentials': { type: 'list', preserveOnNavigation: true },
    'accounts': { type: 'list', preserveOnNavigation: true },
    'badges': { type: 'list', preserveOnNavigation: true },
    'calendar': { type: 'list', preserveOnNavigation: true },
    'memos': { type: 'list', preserveOnNavigation: true },
    'youtube': { type: 'list', preserveOnNavigation: true },
    'zaps': { type: 'list', preserveOnNavigation: true },
    'polls': { type: 'list', preserveOnNavigation: true },
    'queue': { type: 'list', preserveOnNavigation: true },
    'playlists': { type: 'list', preserveOnNavigation: true },
    'about': { type: 'list', preserveOnNavigation: true },
    'terms': { type: 'list', preserveOnNavigation: true },
    // Collections pages
    'collections/relays': { type: 'list', preserveOnNavigation: true },
    'collections/bookmarks': { type: 'list', preserveOnNavigation: true },
    'delete-event': { type: 'list', preserveOnNavigation: true },
    'delete-account': { type: 'list', preserveOnNavigation: true },
    'search': { type: 'list', preserveOnNavigation: true },

    // Detail views (right panel)
    'e': { type: 'detail' }, // Event
    'a': { type: 'detail' }, // Article
    'b': { type: 'detail' }, // Badge details
    'music/song': { type: 'detail' },
    'music/playlist': { type: 'detail' },
    'music/artist': { type: 'detail' },
    'collections/emojis': { type: 'list', preserveOnNavigation: true },
    'collections/interests': { type: 'list', preserveOnNavigation: true },
    'article/create': { type: 'detail' },
    'article/edit': { type: 'detail' },
    'discover/content': { type: 'detail' },
    'badges/details': { type: 'detail' },
    'badges/create': { type: 'detail' },
    'badges/edit': { type: 'detail' },
    'playlists/edit': { type: 'detail' },
    'polls/edit': { type: 'detail' },

    // Full-width views (right panel, takes remaining space)
    'streams': { type: 'full-width' },
    'stream': { type: 'full-width' },
    'meetings': { type: 'full-width' },
  };

  constructor() {
    // Monitor mobile breakpoint
    this.breakpointObserver.observe('(max-width: 1023px)').subscribe(result => {
      this.isMobile.set(result.matches);
    });

    // Track route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event) => {
      const navEvent = event as NavigationEnd;
      this.handleRouteChange(navEvent.urlAfterRedirects);
    });

    // Initialize with current route
    this.handleRouteChange(this.router.url);
  }

  /**
   * Handle route changes to update panel states
   */
  private handleRouteChange(url: string): void {
    // Check if on home route (empty path or just query params)
    const cleanUrl = url.replace(/^\//, '').split('?')[0];
    const isHome = cleanUrl === '' || cleanUrl === 'home';
    this.isHomeRoute.set(isHome);

    const category = this.getRouteCategory(url);

    // Reset route type flags
    this.isListRoute.set(false);
    this.isDetailRoute.set(false);

    // Set width mode based on route:
    // - Home route gets wide mode (1400px)
    // - Other routes get narrow mode (700px) by default
    // Components can override this by calling setWideLeft() in their lifecycle
    if (isHome) {
      this._leftWidthMode.set('wide');
    } else {
      this._leftWidthMode.set('narrow');
    }

    if (category) {
      if (category.type === 'list') {
        // List container - set flag (not home means it's Music, Collections, etc.)
        if (!isHome) {
          this.isListRoute.set(true);
        }
        this.leftPanelRoute.set(url);
        this._viewMode.set('fixed');
      } else if (category.type === 'detail' || category.type === 'full-width') {
        // Detail/full-width goes to right panel
        this.isDetailRoute.set(true);
        this.rightPanelRoute.set(url);

        if (category.type === 'full-width') {
          this._viewMode.set('full-width');
        } else {
          this._viewMode.set('fixed');
        }
      }
    }
  }

  /**
   * Get route category from URL
   */
  private getRouteCategory(url: string): RouteCategory | null {
    const cleanUrl = url.replace(/^\//, '').split('?')[0];

    // Check exact match
    if (this.routeCategories[cleanUrl]) {
      return this.routeCategories[cleanUrl];
    }

    // Check prefix matches
    const segments = cleanUrl.split('/');
    for (let i = segments.length; i > 0; i--) {
      const prefix = segments.slice(0, i).join('/');
      if (this.routeCategories[prefix]) {
        return this.routeCategories[prefix];
      }
    }

    // Check first segment
    if (segments[0] && this.routeCategories[segments[0]]) {
      return this.routeCategories[segments[0]];
    }

    return null;
  }

  /**
   * Check if a given URL is a list container (left panel)
   */
  checkIsListRoute(url: string): boolean {
    const category = this.getRouteCategory(url);
    return category?.type === 'list';
  }

  /**
   * Check if a given URL is a detail view (right panel)
   */
  checkIsDetailRoute(url: string): boolean {
    const category = this.getRouteCategory(url);
    return category?.type === 'detail';
  }

  /**
   * Check if a given URL is full-width (right panel, expanded)
   */
  checkIsFullWidthRoute(url: string): boolean {
    const category = this.getRouteCategory(url);
    return category?.type === 'full-width';
  }

  /**
   * Toggle feeds panel visibility
   */
  toggleFeedsPanel(): void {
    this.feedsCollapsed.update(v => !v);
  }

  /**
   * Show feeds panel
   */
  showFeedsPanel(): void {
    this.feedsCollapsed.set(false);
  }

  /**
   * Hide feeds panel
   */
  hideFeedsPanel(): void {
    this.feedsCollapsed.set(true);
  }

  /**
   * Close right panel and clear navigation
   */
  closeRightPanel(): void {
    this.navigationStack.clearRight();
    this.rightPanelRoute.set(null);
    this._viewMode.set('fixed');

    // Navigate to home or last left panel route
    const leftRoute = this.leftPanelRoute();
    if (leftRoute && leftRoute !== '/') {
      this.router.navigate([leftRoute]);
    } else {
      this.router.navigate(['/']);
    }
  }

  /**
   * Go back in right panel navigation
   */
  goBackRight(): void {
    this.navigationStack.popRight();

    // If no more items, close the right panel
    if (!this.navigationStack.hasRightItems()) {
      this.closeRightPanel();
    }
  }

  /**
   * Reset navigation (clear both panels) and navigate to a root route
   */
  resetNavigation(route: string): void {
    this.navigationStack.clearAll();
    // Reset internal state
    this.rightPanelRoute.set(null);
    this._viewMode.set('fixed');

    // Navigate to the target route using navigateByUrl to handle query params correctly
    this.router.navigateByUrl(route);
  }

  /**
   * Navigate to an item, automatically determining panel position
   */
  navigateTo(url: string): void {
    const category = this.getRouteCategory(url);

    if (category?.type === 'list') {
      // List containers go to left, preserve the route
      this.leftPanelRoute.set(url);
      this.router.navigate([url]);
    } else {
      // Details go to right panel via navigation stack
      this.rightPanelRoute.set(url);
      this.router.navigate([url]);
    }
  }

  /**
   * Open a profile (right panel - profiles are detail views)
   */
  openProfile(pubkey: string): void {
    this.rightPanelRoute.set(`/p/${pubkey}`);
    this.router.navigate([{ outlets: { right: ['p', pubkey] } }]);
  }

  /**
   * Open an event (right panel, detail view)
   */
  openEvent(eventId: string, eventData?: Event): void {
    this.rightPanelRoute.set(`/e/${eventId}`);
    this.navigationStack.navigateToEvent(eventId, eventData);
    this.router.navigate([{ outlets: { right: ['e', eventId] } }], {
      state: { event: eventData }
    });
  }

  /**
   * Get current layout state for debugging
   */
  getLayoutState() {
    return {
      viewMode: this._viewMode(),
      isMobile: this.isMobile(),
      feedsCollapsed: this.feedsCollapsed(),
      leftPanelRoute: this.leftPanelRoute(),
      rightPanelRoute: this.rightPanelRoute(),
      hasRightContent: this.hasRightContent(),
      shouldCenterFeeds: this.shouldCenterFeeds(),
      isRightPanelFullWidth: this.isRightPanelFullWidth(),
      leftStackSize: this.navigationStack.getLeftStack().length,
      rightStackSize: this.navigationStack.getRightStack().length,
    };
  }
}