import { Injectable, signal, computed, inject } from '@angular/core';
import { Router, NavigationEnd, PRIMARY_OUTLET, UrlTree } from '@angular/router';
import { filter } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { PanelActionsService } from './panel-actions.service';

/**
 * Panel position - which side the content renders on
 */
export type PanelPosition = 'left' | 'right';

/**
 * Route type determines which panel a route renders in
 */
export type RouteType = 'list' | 'detail' | 'full-width';

/**
 * Navigation entry for history stack
 */
export interface NavigationEntry {
  path: string;
  params?: Record<string, string>;
  title?: string;
  type: RouteType;
}

/**
 * Route configuration for panel assignment
 */
interface RouteConfig {
  type: RouteType;
  title?: string;
}

/**
 * Callback for when route cache should be cleared
 */
export type ClearCacheCallback = () => void;

/**
 * Callback for when right panel should be cleared
 */
export type ClearRightPanelCallback = () => void;

/**
 * Service to manage dual-panel navigation with independent history stacks
 * and clean URLs.
 * 
 * Layout rules:
 * - Left panel: List/root components (Feeds, Profile, Music, etc.)
 * - Right panel: Detail views (Events, Articles, Playlists, etc.)
 * - Feeds shows when left panel has no content
 * - When navigating to a ROOT list component, clear ALL history
 * - Detail views preserve the current left panel content
 */
@Injectable({
  providedIn: 'root'
})
export class PanelNavigationService {
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);
  private panelActions = inject(PanelActionsService);

  // Navigation stacks for each panel
  private _leftStack = signal<NavigationEntry[]>([]);
  private _rightStack = signal<NavigationEntry[]>([]);

  // Current route info from Angular router
  private _currentRoute = signal<NavigationEntry | null>(null);

  // Track which panel the current URL route belongs to
  private _currentRoutePanel = signal<PanelPosition | null>(null);

  // Track if navigation is from back button (don't clear history)
  private _isBackNavigation = false;

  // Track if we should preserve the right panel on the next navigation
  private _preserveRightPanelOnNextNavigation = false;

  // Callback to clear route cache (set by RouteReuseStrategy)
  private _clearCacheCallback: ClearCacheCallback | null = null;

  // Callback to clear right panel (set by RightPanelService)
  private _clearRightPanelCallback: ClearRightPanelCallback | null = null;

  // Public readonly signals
  leftStack = this._leftStack.asReadonly();
  rightStack = this._rightStack.asReadonly();
  currentRoute = this._currentRoute.asReadonly();

  // Current active routes for each panel (top of stack or current if matching)
  leftRoute = computed(() => {
    const stack = this._leftStack();
    return stack.length > 0 ? stack[stack.length - 1] : null;
  });

  rightRoute = computed(() => {
    const stack = this._rightStack();
    return stack.length > 0 ? stack[stack.length - 1] : null;
  });

  // Whether each panel has content
  hasLeftContent = computed(() => this._leftStack().length > 0);
  hasRightContent = computed(() => this._rightStack().length > 0);

  // Whether the left panel is showing the home route (no header needed)
  isHomeRoute = computed(() => {
    const route = this.leftRoute();
    return route?.path === '' || route?.path === '/';
  });

  // Whether feeds should be shown (explicitly feeds route /f)
  showFeeds = computed(() => {
    // Only show feeds when explicitly on the /f route
    const activeRoute = this.leftRoute();
    if (activeRoute && (activeRoute.path === '/f' || activeRoute.path === 'f')) {
      return true;
    }
    // Don't show feeds for other routes like Home ('')
    // They render via router-outlet instead
    return false;
  });

  // Whether feeds should be centered (left empty, right empty)
  feedsCentered = computed(() => this.showFeeds() && !this.hasRightContent());

  // Whether the current router-outlet content should render in left panel
  isCurrentRouteLeft = computed(() => this._currentRoutePanel() === 'left');

  // Whether the current router-outlet content should render in right panel
  isCurrentRouteRight = computed(() => this._currentRoutePanel() === 'right');

  // Whether right panel is full-width mode
  isRightFullWidth = computed(() => {
    const right = this.rightRoute();
    return right?.type === 'full-width';
  });

  // Mobile detection
  isMobile = signal(false);

  // Route type configuration
  private routeConfig: Record<string, RouteConfig> = {
    // List/root routes (left panel)
    '': { type: 'list', title: 'Home' },
    'f': { type: 'list', title: 'Feeds' },
    'p': { type: 'list', title: 'Profile' },
    'u': { type: 'list', title: 'Profile' },
    'music': { type: 'list', title: 'Music' },
    'music/offline': { type: 'list', title: 'Offline Music' },
    'music/liked': { type: 'list', title: 'Liked Songs' },
    'music/liked-playlists': { type: 'list', title: 'Liked Playlists' },
    'music/tracks': { type: 'list', title: 'All Songs' },
    'music/playlists': { type: 'list', title: 'Playlists' },
    'music/artists': { type: 'list', title: 'Artists' },
    'music/terms': { type: 'list', title: 'Music Terms' },
    'articles': { type: 'list', title: 'Articles' },
    'articles/edit': { type: 'list', title: 'My Articles' },
    'collections': { type: 'list', title: 'Collections' },
    'people': { type: 'list', title: 'People' },
    'people/discover': { type: 'list', title: 'Discover People' },
    'summary': { type: 'list', title: 'Summary' },
    'discover': { type: 'list', title: 'Discover' },
    // Note: discover/media and discover/content without params are list routes
    // But discover/media/:category and discover/content/:category are detail routes
    // This is handled by checking segment count in getRouteType
    'messages': { type: 'list', title: 'Messages' },
    'notifications': { type: 'list', title: 'Notifications' },
    'lists': { type: 'list', title: 'Lists' },
    'media': { type: 'list', title: 'Media' },
    'relays': { type: 'list', title: 'Relays' },
    'settings': { type: 'list', title: 'Settings' },
    'credentials': { type: 'list', title: 'Credentials' },
    'accounts': { type: 'list', title: 'Accounts' },
    'badges': { type: 'list', title: 'Badges' },
    'calendar': { type: 'list', title: 'Calendar' },
    'memos': { type: 'list', title: 'Memos' },
    'youtube': { type: 'list', title: 'YouTube' },
    'zaps': { type: 'list', title: 'Zap History' },
    'polls': { type: 'list', title: 'Polls' },
    'queue': { type: 'list', title: 'Media Queue' },
    'playlists': { type: 'list', title: 'Playlists' },
    'about': { type: 'list', title: 'About' },
    'terms': { type: 'list', title: 'Terms' },
    'collections/relays': { type: 'list', title: 'Relays' },
    'premium': { type: 'list', title: 'Premium' },
    'analytics': { type: 'list', title: 'Analytics' },
    'ai': { type: 'list', title: 'AI' },
    'backup': { type: 'list', title: 'Backup' },
    'delete-event': { type: 'list', title: 'Delete Event' },
    'delete-account': { type: 'list', title: 'Delete Account' },
    'search': { type: 'list', title: 'Search' },

    // Detail routes (right panel)
    'e': { type: 'detail', title: 'Event' },
    'a': { type: 'detail', title: 'Article' },
    'b': { type: 'detail', title: 'Badge' },
    'music/song': { type: 'detail', title: 'Song' },
    'music/playlist': { type: 'detail', title: 'Playlist' },
    'music/artist': { type: 'detail', title: 'Artist' },
    'article/create': { type: 'detail', title: 'New Article' },
    'article/edit': { type: 'detail', title: 'Edit Article' },
    'badges/details': { type: 'detail', title: 'Badge Details' },
    'badges/create': { type: 'detail', title: 'Create Badge' },
    'badges/edit': { type: 'detail', title: 'Edit Badge' },
    'playlists/edit': { type: 'detail', title: 'Edit Playlist' },
    'polls/edit': { type: 'detail', title: 'Edit Poll' },
    'discover/content': { type: 'detail', title: 'Discover Content' },
    'premium/upgrade': { type: 'detail', title: 'Upgrade' },
    'ai/settings': { type: 'detail', title: 'AI Settings' },
    'collections/interests': { type: 'list', title: 'Interests' },
    'collections/emojis': { type: 'list', title: 'Emojis' },
    'collections/bookmarks': { type: 'list', title: 'Bookmarks' },

    // Full-width routes (right panel, expanded)
    'streams': { type: 'full-width', title: 'Live Streams' },
    'stream': { type: 'full-width', title: 'Live Stream' },
    'meetings': { type: 'full-width', title: 'Meetings' },
  };

  constructor() {
    // Monitor mobile breakpoint
    this.breakpointObserver.observe('(max-width: 1023px)').subscribe(result => {
      this.isMobile.set(result.matches);
    });

    // Listen to router navigation events
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event) => {
      const navEvent = event as NavigationEnd;
      this.handleNavigation(navEvent.urlAfterRedirects);
    });
  }

  /**
   * Get route type from URL path
   */
  getRouteType(path: string): RouteType {
    const cleanPath = path.replace(/^\//, '').split('?')[0];

    // Home route
    if (!cleanPath || cleanPath === '') {
      return 'list';
    }

    // Check exact match first
    if (this.routeConfig[cleanPath]) {
      return this.routeConfig[cleanPath].type;
    }

    // Special case: discover/media/:category and discover/content/:category are detail routes
    // but discover/media (exact) and discover/content (exact) are list routes
    const segments = cleanPath.split('/');
    if (segments[0] === 'discover' && segments.length === 3) {
      return 'detail';
    }

    // Check prefix matches (longest first)
    for (let i = segments.length; i > 0; i--) {
      const prefix = segments.slice(0, i).join('/');
      if (this.routeConfig[prefix]) {
        return this.routeConfig[prefix].type;
      }
    }

    // Check first segment only
    if (segments[0] && this.routeConfig[segments[0]]) {
      return this.routeConfig[segments[0]].type;
    }

    // Default to detail (right panel)
    return 'detail';
  }

  /**
   * Get route title from URL path
   */
  getRouteTitle(path: string): string {
    const cleanPath = path.replace(/^\//, '').split('?')[0];

    if (!cleanPath || cleanPath === '') {
      return 'Home';
    }

    if (this.routeConfig[cleanPath]) {
      return this.routeConfig[cleanPath].title || '';
    }

    const segments = cleanPath.split('/');
    for (let i = segments.length; i > 0; i--) {
      const prefix = segments.slice(0, i).join('/');
      if (this.routeConfig[prefix]) {
        return this.routeConfig[prefix].title || '';
      }
    }

    if (segments[0] && this.routeConfig[segments[0]]) {
      return this.routeConfig[segments[0]].title || '';
    }

    return '';
  }

  /**
   * Get target panel for a route
   */
  getTargetPanel(path: string): PanelPosition {
    const type = this.getRouteType(path);
    return type === 'list' ? 'left' : 'right';
  }

  /**
   * Set callback for clearing route cache
   */
  setClearCacheCallback(callback: ClearCacheCallback): void {
    this._clearCacheCallback = callback;
  }

  /**
   * Set callback for clearing right panel content
   */
  setClearRightPanelCallback(callback: ClearRightPanelCallback): void {
    this._clearRightPanelCallback = callback;
  }

  /**
   * Set flag to preserve right panel on the next navigation.
   * Used when navigating to a list view from a detail view that should stay open.
   */
  preserveRightPanelOnNextNavigation(): void {
    this._preserveRightPanelOnNextNavigation = true;
  }

  /**
   * Handle navigation events from the router
   */
  private handleNavigation(url: string): void {
    // Parse the URL using Angular's UrlTree to correctly handle auxiliary routes
    const tree: UrlTree = this.router.parseUrl(url);
    const primaryGroup = tree.root.children[PRIMARY_OUTLET];
    const rightGroup = tree.root.children['right'];

    // Extract paths for left (primary) and right (auxiliary) panels
    // toString() handles segments joining
    const leftPath = primaryGroup ? primaryGroup.toString() : '';
    const rightPath = rightGroup ? rightGroup.toString() : '';

    // --- LEFT PANEL LOGIC ---
    // Note: leftPath can be empty string '' for home route, which is valid
    if (leftPath !== undefined) {
      const type = this.getRouteType(leftPath);
      const title = this.getRouteTitle(leftPath);
      const entry: NavigationEntry = { path: leftPath, title, type };

      // Check current stack to determine transition type
      const leftStack = this._leftStack();
      const currentLeft = leftStack[leftStack.length - 1];

      const currentSection = currentLeft?.path.split('/')[0] || '';
      const newSection = leftPath.split('/')[0] || '';
      const isSameSection = currentSection === newSection && currentSection !== '';
      const isSearchNavigation = newSection === 'search'; // Search preserves history
      const shouldPreserveRightPanel = this._preserveRightPanelOnNextNavigation;

      // Logic for clearing history vs pushing
      if (!this._isBackNavigation && !isSameSection && !shouldPreserveRightPanel && !isSearchNavigation) {
        // Switching sections (e.g. Music -> Search)

        // Special seeding for Collections
        if ((entry.path.startsWith('collections/') || entry.path.startsWith('media')) && entry.path !== 'collections') {
          const parentWithTitle: NavigationEntry = { path: 'collections', title: 'Collections', type: 'list' };
          this._leftStack.set([parentWithTitle, entry]);
        } else {
          this._leftStack.set([entry]);
        }

        // If the URL *DOES NOT* have a right component, clear the right stack too.
        if (!rightPath) {
          this._rightStack.set([]);
          if (this._clearRightPanelCallback) this._clearRightPanelCallback();
          if (this._clearCacheCallback) this._clearCacheCallback();
        }

      } else {
        // Same section OR Back nav OR Preserved
        if (this._isBackNavigation) {
          const existingIndex = leftStack.findIndex(e => e.path === leftPath);
          if (existingIndex >= 0) {
            this._leftStack.update(s => s.slice(0, existingIndex + 1));
          } else {
            this._leftStack.update(s => [...s, entry]);
          }
        } else {
          // Forward navigation in same section
          // Avoid duplicates at top of stack (comparing path string)
          if (!currentLeft || currentLeft.path !== leftPath) {
            this._leftStack.update(s => [...s, entry]);
          }
        }
      }

      // Update Current Route indicators
      this._currentRoute.set(entry);
      if (!rightPath) {
        this._currentRoutePanel.set('left');
      }

      // Clear the page title when left panel route changes
      // Components that want a custom title will set it in their ngOnInit
      this.panelActions.clearPageTitle();
      this.panelActions.clearLeftPanelActions();
    }

    // --- RIGHT PANEL LOGIC ---
    if (rightPath) {
      const type = this.getRouteType(rightPath);
      const title = this.getRouteTitle(rightPath);
      const entry: NavigationEntry = { path: rightPath, title, type };

      const rightStack = this._rightStack();
      const currentRight = rightStack[rightStack.length - 1];

      if (this._isBackNavigation) {
        const existingIndex = rightStack.findIndex(e => e.path === rightPath);
        if (existingIndex >= 0) {
          this._rightStack.update(s => s.slice(0, existingIndex + 1));
        } else {
          this._rightStack.update(s => [...s, entry]);
        }
      } else {
        // Forward nav
        if (!currentRight || currentRight.path !== rightPath) {
          this._rightStack.update(s => [...s, entry]);
        }
      }

      this._currentRoute.set(entry);
      this._currentRoutePanel.set('right');
    }

    // Reset flags
    this._preserveRightPanelOnNextNavigation = false;
    this._isBackNavigation = false;
  }

  /**
   * Navigate to a route (standard navigation)
   */
  navigateTo(path: string, params?: Record<string, string>): void {
    this.router.navigate([path], { queryParams: params });
  }

  /**
   * Go back in left panel history
   */
  goBackLeft(): void {
    const stack = this._leftStack();
    if (stack.length <= 1) {
      // Clear left panel, show feeds
      this._leftStack.set([]);
      // Navigate to home or keep current right route
      const right = this.rightRoute();
      this._isBackNavigation = true;
      if (right) {
        this.router.navigate([right.path]);
      } else {
        this.router.navigate(['/']);
      }
      return;
    }

    // Pop current entry and navigate to previous
    const newStack = stack.slice(0, -1);
    const prev = newStack[newStack.length - 1];
    this._leftStack.set(newStack);
    this._isBackNavigation = true;
    this.router.navigate([prev.path]);
  }

  /**
   * Go back in right panel history
   */
  goBackRight(): void {
    const stack = this._rightStack();
    if (stack.length <= 1) {
      // Clear right panel
      this._rightStack.set([]);
      // Navigate to left route or home
      const left = this.leftRoute();
      this._isBackNavigation = true;
      if (left) {
        this.router.navigate([left.path]);
      } else {
        this.router.navigate(['/']);
      }
      return;
    }

    // Pop current entry and navigate to previous
    const newStack = stack.slice(0, -1);
    const prev = newStack[newStack.length - 1];
    this._rightStack.set(newStack);
    this._isBackNavigation = true;
    this.router.navigate([prev.path]);
  }

  /**
   * Close left panel (clear all history, show feeds)
   */
  closeLeft(): void {
    this._leftStack.set([]);
    // Navigate to right route or home
    const right = this.rightRoute();
    if (right) {
      this.router.navigate([right.path]);
    } else {
      this.router.navigate(['/']);
    }
  }

  /**
   * Close right panel (clear all history)
   */
  closeRight(): void {
    this._rightStack.set([]);
    // Clear right panel callback if set
    if (this._clearRightPanelCallback) {
      this._clearRightPanelCallback();
    }
    // Navigate to left route or home
    const left = this.leftRoute();
    if (left) {
      this.router.navigate([left.path]);
    } else {
      this.router.navigate(['/']);
    }
  }

  /**
   * Clear left stack without navigation (useful for programmatic control)
   */
  clearLeftStack(): void {
    this._leftStack.set([]);
  }

  /**
   * Clear right stack without navigation (useful for programmatic control)
   */
  clearRightStack(): void {
    this._rightStack.set([]);
    if (this._clearRightPanelCallback) {
      this._clearRightPanelCallback();
    }
  }

  /**
   * Navigate to home and clear all navigation history
   */
  navigateToHome(): void {
    this._leftStack.set([]);
    this._rightStack.set([]);
    if (this._clearRightPanelCallback) {
      this._clearRightPanelCallback();
    }
    if (this._clearCacheCallback) {
      this._clearCacheCallback();
    }
    this.router.navigate(['/']);
  }

  /**
   * Get title for left panel
   */
  getLeftTitle(): string {
    const route = this.leftRoute();
    return route?.title || '';
  }

  /**
   * Get title for right panel
   */
  getRightTitle(): string {
    const route = this.rightRoute();
    return route?.title || '';
  }

  /**
   * Check if left panel has history to go back
   */
  canGoBackLeft(): boolean {
    return this._leftStack().length > 1;
  }

  /**
   * Check if right panel has history to go back
   */
  canGoBackRight(): boolean {
    return this._rightStack().length > 1;
  }

  /**
   * Handle initial route on app load
   */
  handleInitialRoute(url: string): void {
    this.handleNavigation(url);
  }

  /**
   * Open feeds in left panel
   */
  openFeeds(): void {
    this._leftStack.set([]);
    const right = this.rightRoute();
    if (right) {
      this.router.navigate([right.path]);
    } else {
      this.router.navigate(['/']);
    }
  }

  /**
   * Clear all navigation history (for logout, etc.)
   */
  clearHistory(): void {
    this._leftStack.set([]);
    this._rightStack.set([]);
    this._currentRoute.set(null);
    this._currentRoutePanel.set(null);
  }
}