import { Injectable, signal, computed, inject } from '@angular/core';
import { Event } from 'nostr-tools';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * Panel position for two-column layout
 */
export type PanelPosition = 'left' | 'right';

/**
 * Component types and their default panel positions
 * - 'left': List containers (Feeds, Profile, Music, Articles, Bookmarks, People, Summary)
 * - 'right': Detail views (Events, Article content, Music Track details, Contact cards, Search results)
 */
export type ComponentCategory =
  | 'feeds'          // Always left, centered when alone
  | 'profile'        // Left (list container)
  | 'music'          // Left (list container)
  | 'articles'       // Left (list container)
  | 'bookmarks'      // Left (list container)
  | 'interests'      // Left (list container)
  | 'people'         // Left (list container)
  | 'summary'        // Left (list container)
  | 'collections'    // Left (list container)
  | 'event'          // Right (detail view)
  | 'article-detail' // Right (detail view)
  | 'music-detail'   // Right (detail view, song/playlist)
  | 'contact-card'   // Right (detail view)
  | 'search'         // Right (results)
  | 'streams'        // Right (full-width)
  | 'other';         // Right by default

/**
 * Represents an item in the navigation stack
 */
export interface NavigationItem {
  type: ComponentCategory;
  id: string; // event id, pubkey, route path, etc.
  data?: Event; // Optional event data for performance
  route?: string; // The route path for this item
  fullWidth?: boolean; // Whether this component should take full width on the right
}

/**
 * Route configuration for panel positioning
 */
interface RouteConfig {
  category: ComponentCategory;
  panel: PanelPosition;
  fullWidth?: boolean; // For components that should take full available width
}

/**
 * Route to panel mapping configuration
 */
const ROUTE_CONFIG: Record<string, RouteConfig> = {
  // Left panel (list containers)
  '': { category: 'feeds', panel: 'left' },
  'p': { category: 'profile', panel: 'left' },
  'u': { category: 'profile', panel: 'left' },
  'music': { category: 'music', panel: 'left' },
  'articles': { category: 'articles', panel: 'left' },
  'collections': { category: 'collections', panel: 'left' },
  'people': { category: 'people', panel: 'left' },
  'summary': { category: 'summary', panel: 'left' },
  'discover': { category: 'interests', panel: 'left' },
  'search': { category: 'search', panel: 'left' },

  // Right panel (detail views)
  'e': { category: 'event', panel: 'right' },
  'a': { category: 'article-detail', panel: 'right' },
  'music/song': { category: 'music-detail', panel: 'right' },
  'music/playlist': { category: 'music-detail', panel: 'right' },
  'music/artist': { category: 'music-detail', panel: 'right' },
  'streams': { category: 'streams', panel: 'right', fullWidth: true },
  'stream': { category: 'streams', panel: 'right', fullWidth: true },
};

/**
 * Service to manage navigation stack for the two-column layout
 * Tracks the history of opened items in both left and right panels
 */
@Injectable({
  providedIn: 'root'
})
export class NavigationStackService {
  private router = inject(Router);

  // Separate stacks for left and right panels
  private leftStack = signal<NavigationItem[]>([]);
  private rightStack = signal<NavigationItem[]>([]);

  // Track current route for panel determination
  private currentRoute = signal<string>('');

  // Computed signals for left panel
  hasLeftItems = computed(() => this.leftStack().length > 0);
  hasMultipleLeftItems = computed(() => this.leftStack().length > 1);
  currentLeftItem = computed(() => {
    const items = this.leftStack();
    return items.length > 0 ? items[items.length - 1] : null;
  });

  // Computed signals for right panel (main navigation stack)
  hasRightItems = computed(() => this.rightStack().length > 0);
  hasMultipleRightItems = computed(() => this.rightStack().length > 1);
  currentRightItem = computed(() => {
    const items = this.rightStack();
    return items.length > 0 ? items[items.length - 1] : null;
  });

  // Legacy compatibility - these map to right panel
  hasItems = this.hasRightItems;
  hasMultipleItems = this.hasMultipleRightItems;
  currentItem = this.currentRightItem;

  // Check if current right panel item is full-width
  isRightPanelFullWidth = computed(() => {
    const item = this.currentRightItem();
    return item?.fullWidth ?? false;
  });

  constructor() {
    // Subscribe to router events to track navigation
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event) => {
      const navEvent = event as NavigationEnd;
      this.currentRoute.set(navEvent.urlAfterRedirects);
    });
  }

  /**
   * Get the panel position for a given route
   */
  getPanelForRoute(route: string): PanelPosition {
    const config = this.getRouteConfig(route);
    return config?.panel ?? 'right';
  }

  /**
   * Get route configuration for a path
   */
  private getRouteConfig(route: string): RouteConfig | null {
    // Clean the route - remove leading slash and query params
    const cleanRoute = route.replace(/^\//, '').split('?')[0];

    // Check for exact match first
    if (ROUTE_CONFIG[cleanRoute]) {
      return ROUTE_CONFIG[cleanRoute];
    }

    // Check for prefix matches (e.g., 'p/abc123' matches 'p')
    const segments = cleanRoute.split('/');
    for (let i = segments.length; i > 0; i--) {
      const prefix = segments.slice(0, i).join('/');
      if (ROUTE_CONFIG[prefix]) {
        return ROUTE_CONFIG[prefix];
      }
    }

    // Check first segment only
    if (segments[0] && ROUTE_CONFIG[segments[0]]) {
      return ROUTE_CONFIG[segments[0]];
    }

    return null;
  }

  // Get all items (for debugging/testing)
  getLeftStack() {
    return this.leftStack();
  }

  getRightStack() {
    return this.rightStack();
  }

  // Legacy compatibility
  getStack() {
    return this.rightStack();
  }

  /**
   * Push an item to the appropriate panel stack
   */
  push(item: NavigationItem, panel?: PanelPosition) {
    const targetPanel = panel ?? this.getPanelForItem(item);

    if (targetPanel === 'left') {
      this.leftStack.update(items => [...items, item]);
    } else {
      this.rightStack.update(items => [...items, item]);
    }
  }

  /**
   * Push to left panel specifically
   */
  pushLeft(item: NavigationItem) {
    this.leftStack.update(items => [...items, item]);
  }

  /**
   * Push to right panel specifically
   */
  pushRight(item: NavigationItem) {
    this.rightStack.update(items => [...items, item]);
  }

  /**
   * Pop from the right panel stack (default behavior)
   */
  pop(): NavigationItem | null {
    return this.popRight();
  }

  /**
   * Pop from left panel
   */
  popLeft(): NavigationItem | null {
    let popped: NavigationItem | null = null;
    this.leftStack.update(items => {
      if (items.length === 0) return items;
      popped = items[items.length - 1];
      return items.slice(0, -1);
    });
    return popped;
  }

  /**
   * Pop from right panel
   */
  popRight(): NavigationItem | null {
    let popped: NavigationItem | null = null;
    this.rightStack.update(items => {
      if (items.length === 0) return items;
      popped = items[items.length - 1];
      return items.slice(0, -1);
    });
    return popped;
  }

  /**
   * Clear the entire right stack (main navigation)
   */
  clear() {
    this.clearRight();
  }

  /**
   * Clear left panel stack
   */
  clearLeft() {
    this.leftStack.set([]);
  }

  /**
   * Clear right panel stack
   */
  clearRight() {
    this.rightStack.set([]);
  }

  /**
   * Clear both panels
   */
  clearAll() {
    this.leftStack.set([]);
    this.rightStack.set([]);
  }

  /**
   * Replace the current item in the appropriate panel
   */
  replaceCurrent(item: NavigationItem, panel?: PanelPosition) {
    const targetPanel = panel ?? this.getPanelForItem(item);

    if (targetPanel === 'left') {
      this.leftStack.update(items => {
        if (items.length === 0) return [item];
        return [...items.slice(0, -1), item];
      });
    } else {
      this.rightStack.update(items => {
        if (items.length === 0) return [item];
        return [...items.slice(0, -1), item];
      });
    }
  }

  /**
   * Determine which panel an item belongs to based on its type
   */
  private getPanelForItem(item: NavigationItem): PanelPosition {
    // If item has a route, use route config
    if (item.route) {
      return this.getPanelForRoute(item.route);
    }

    // Map types to panels
    switch (item.type) {
      case 'feeds':
      case 'profile':
      case 'music':
      case 'articles':
      case 'interests':
      case 'people':
      case 'summary':
      case 'collections':
      case 'search':
        return 'left';

      case 'event':
      case 'article-detail':
      case 'music-detail':
      case 'contact-card':
      case 'streams':
      case 'other':
      default:
        return 'right';
    }
  }

  /**
   * Navigate to an event (right panel)
   */
  navigateToEvent(eventId: string, eventData?: Event) {
    this.pushRight({
      type: 'event',
      id: eventId,
      data: eventData,
      route: `/e/${eventId}`
    });
  }

  /**
   * Navigate to a profile (right panel - profiles are detail views)
   */
  navigateToProfile(pubkey: string) {
    this.pushRight({
      type: 'profile',
      id: pubkey,
      route: `/p/${pubkey}`
    });
  }

  /**
   * Navigate to an article detail (right panel)
   */
  navigateToArticle(articleId: string) {
    this.pushRight({
      type: 'article-detail',
      id: articleId,
      route: `/a/${articleId}`
    });
  }

  /**
   * Navigate to music detail (right panel)
   */
  navigateToMusicDetail(type: 'song' | 'playlist' | 'artist', id: string) {
    this.pushRight({
      type: 'music-detail',
      id,
      route: `/music/${type}/${id}`
    });
  }

  /**
   * Navigate to streams (right panel, full-width)
   */
  navigateToStream(streamId: string) {
    this.pushRight({
      type: 'streams',
      id: streamId,
      route: `/stream/${streamId}`,
      fullWidth: true
    });
  }

  /**
   * Navigate to search results (right panel)
   */
  navigateToSearch(query: string) {
    this.pushRight({
      type: 'search',
      id: query,
      route: `/search?q=${encodeURIComponent(query)}`
    });
  }

  /**
   * Set the left panel content (replaces entire stack)
   */
  setLeftPanel(item: NavigationItem) {
    this.leftStack.set([item]);
  }

  /**
   * Set the right panel content (replaces entire stack)
   */
  setRightPanel(item: NavigationItem) {
    this.rightStack.set([item]);
  }
}
