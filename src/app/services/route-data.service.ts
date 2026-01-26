import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, Event } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { Location } from '@angular/common';

export interface NavigationHistoryItem {
  url: string;
  title: string;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root',
})
export class RouteDataService implements OnDestroy {
  private router = inject(Router);
  private titleService = inject(Title);
  private location = inject(Location);

  // Signal for current route data
  currentRouteData = signal<any>({});

  // Signal for navigation history
  navigationHistory = signal<NavigationHistoryItem[]>([]);

  // Track programmatic navigation to distinguish from browser navigation
  private isProgrammaticNavigation = false;

  // Store the popstate event listener for cleanup
  private popstateListener: ((event: PopStateEvent) => void) | null = null;

  // Computed signal for whether we can go back
  canGoBack = computed(() => {
    return this.navigationHistory().length > 1;
  });

  // Listen to navigation events
  navigationEvents = toSignal(
    this.router.events.pipe(filter(event => event instanceof NavigationEnd))
  );

  constructor() {
    // Update route data immediately
    this.updateRouteData();

    // Initialize with current route
    setTimeout(() => this.initializeHistory(), 0);

    // Listen for router events and track navigation
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.updateRouteData();
        // Delay history update to ensure title is properly set
        setTimeout(() => {
          this.updateNavigationHistory(event);
        }, 0);
      });

    // Listen for browser back/forward navigation using popstate
    if (typeof window !== 'undefined') {
      this.popstateListener = () => {
        if (!this.isProgrammaticNavigation) {
          // Small delay to ensure router has processed the navigation
          // and any dialog popstate handlers have run first
          setTimeout(() => {
            this.handleBrowserNavigation();
          }, 100);
        }
      };
      window.addEventListener('popstate', this.popstateListener);
    }
  }

  private initializeHistory() {
    // Add the initial/current route to history if not already present
    const currentUrl = this.router.url;
    const currentHistory = this.navigationHistory();

    if (currentHistory.length === 0 && currentUrl) {
      const initialTitle = this.getRouteTitle(currentUrl);
      const initialItem: NavigationHistoryItem = {
        url: currentUrl,
        title: initialTitle,
        timestamp: new Date(),
      };
      this.navigationHistory.set([initialItem]);
    }
  }

  private updateRouteData() {
    const route = this.router.routerState.root;
    let child = route;

    // Traverse to the activated route
    while (child.firstChild) {
      child = child.firstChild;
    }

    // Update the signal with current route data
    this.currentRouteData.set(child.snapshot.data);
  }

  private updateNavigationHistory(event: NavigationEnd) {
    const currentHistory = this.navigationHistory();

    // Clear history when navigating to root/home
    if (event.url === '/' || event.url.startsWith('/?')) {
      this.clearHistory();
      return;
    }

    // Get title from current route configuration first, then fallback to title service
    const routeTitle = this.getRouteTitle(event.url);
    const currentTitle = routeTitle || this.titleService.getTitle() || 'Page';

    // Don't add duplicate consecutive entries
    if (currentHistory.length > 0 && currentHistory[currentHistory.length - 1].url === event.url) {
      return;
    }

    // If this is not programmatic navigation, we need to add to history
    if (!this.isProgrammaticNavigation) {
      const newItem: NavigationHistoryItem = {
        url: event.url,
        title: currentTitle,
        timestamp: new Date(),
      };

      // Keep only last 10 history items
      const updatedHistory = [...currentHistory, newItem].slice(-10);
      this.navigationHistory.set(updatedHistory);
    }
  }

  private handleBrowserNavigation() {
    // When browser back/forward is used, sync our history with the browser state
    const currentUrl = this.router.url;
    const currentHistory = this.navigationHistory();

    // Find if the current URL exists in our history (search from end to beginning)
    // This handles the case where the same URL appears multiple times
    let existingIndex = -1;
    for (let i = currentHistory.length - 1; i >= 0; i--) {
      if (currentHistory[i].url === currentUrl) {
        existingIndex = i;
        break;
      }
    }

    if (existingIndex !== -1 && existingIndex < currentHistory.length - 1) {
      // User went back to a previous page - truncate history to that point
      this.navigationHistory.set(currentHistory.slice(0, existingIndex + 1));
    } else if (existingIndex === -1) {
      // URL not in history - this is a forward navigation or external navigation
      // Add it as a new item
      const routeTitle = this.getRouteTitle(currentUrl);
      const newItem: NavigationHistoryItem = {
        url: currentUrl,
        title: routeTitle,
        timestamp: new Date(),
      };
      this.navigationHistory.set([...currentHistory, newItem].slice(-10));
    }
    // If existingIndex === currentHistory.length - 1, we're already at the right place
  }

  private getRouteTitle(url: string): string {
    // Remove query params and fragments
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Find the best matching route
    const matchingRoute = this.findMatchingRoute(cleanUrl);

    if (matchingRoute?.title) {
      return typeof matchingRoute.title === 'string'
        ? matchingRoute.title
        : matchingRoute.title.toString();
    }

    // Generate title from URL segments
    return this.generateTitleFromUrl(cleanUrl);
  }

  private findMatchingRoute(url: string): any {
    // Helper function to check if a route pattern matches the URL
    const matchesPattern = (pattern: string, testUrl: string): boolean => {
      if (pattern === '') return testUrl === '/';

      // Convert route pattern to regex
      const regexPattern = pattern
        .replace(/:[^/]+/g, '[^/]+') // Replace :param with [^/]+
        .replace(/\*\*/g, '.*') // Replace ** with .*
        .replace(/\*/g, '[^/]*'); // Replace * with [^/]*

      const regex = new RegExp(`^/${regexPattern}$`);
      return regex.test(testUrl);
    };

    // Flatten all routes including children
    const flattenRoutes = (routes: any[], parentPath = ''): any[] => {
      const result: any[] = [];

      for (const route of routes) {
        const fullPath = parentPath + '/' + (route.path || '');
        const cleanPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

        result.push({ ...route, fullPath: cleanPath });

        if (route.children) {
          result.push(...flattenRoutes(route.children, cleanPath));
        }
      }

      return result;
    };

    const allRoutes = flattenRoutes(this.router.config);

    // Find the most specific matching route
    const matches = allRoutes.filter(route => matchesPattern(route.path || '', url));

    // Sort by specificity (longer paths first)
    matches.sort((a, b) => (b.fullPath?.length || 0) - (a.fullPath?.length || 0));

    return matches[0] || null;
  }

  private generateTitleFromUrl(url: string): string {
    const segments = url.split('/').filter(s => s.length > 0);

    if (segments.length === 0) return 'Home';

    // Handle special route patterns
    if (segments[0] === 'p' && segments.length > 1) {
      return 'Profile';
    }

    if (segments[0] === 'u' && segments.length > 1) {
      return 'Profile';
    }

    if (segments[0] === 'e' && segments.length > 1) {
      return 'Event';
    }

    if (segments[0] === 'a' && segments.length > 1) {
      return 'Article';
    }

    if (segments[0] === 'b' && segments.length > 1) {
      return 'Badge';
    }

    if (segments[0] === 'f' && segments.length > 1) {
      return 'Feed';
    }

    // Use the first segment for title
    const firstSegment = segments[0];

    // Handle special cases
    const titleMap: Record<string, string> = {
      settings: 'Settings',
      people: 'People',
      articles: 'Articles',
      messages: 'Messages',
      notifications: 'Notifications',
      credentials: 'Credentials',
      accounts: 'Accounts',
      about: 'About',
      relays: 'Relays',
      badges: 'Badges',
      media: 'Media',
      bookmarks: 'Bookmarks',
      premium: 'Premium',
      beta: 'Beta',
      'media-queue': 'Media Queue',
    };

    if (titleMap[firstSegment]) {
      return titleMap[firstSegment];
    }

    // Convert segment to title case
    return firstSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // Helper methods
  getRouteData<T>(key: string): T | undefined {
    return this.currentRouteData()[key];
  }

  hasRouteData(key: string): boolean {
    return key in this.currentRouteData();
  }

  // Navigation history methods
  goBack(): void {
    if (this.canGoBack()) {
      const history = this.navigationHistory();
      const previousUrl = history[history.length - 2]?.url;
      if (previousUrl) {
        // Mark as programmatic navigation to prevent double handling
        this.isProgrammaticNavigation = true;

        // Use browser's back() method to keep browser and app navigation in sync
        if (this.canUseBrowserBack()) {
          // Remove current item from history before navigating
          this.navigationHistory.set(history.slice(0, -1));

          // Use browser back - this will trigger popstate event
          window.history.back();

          // Reset flag after a short delay
          setTimeout(() => {
            this.isProgrammaticNavigation = false;
          }, 100);
        } else {
          // Fallback to router navigation if browser history is not available
          this.navigationHistory.set(history.slice(0, -1));

          this.router.navigateByUrl(previousUrl).then(() => {
            setTimeout(() => {
              this.isProgrammaticNavigation = false;
            }, 0);
          });
        }
      }
    }
  }

  goToHistoryItem(index: number): void {
    const history = this.navigationHistory();
    if (index >= 0 && index < history.length) {
      const targetUrl = history[index].url;
      const currentIndex = history.length - 1;

      // Mark as programmatic navigation
      this.isProgrammaticNavigation = true;

      // Calculate how many steps back we need to go
      const stepsBack = currentIndex - index;

      if (stepsBack > 0 && this.canUseBrowserHistory() && window.history.length > stepsBack) {
        // Remove items after the target index
        this.navigationHistory.set(history.slice(0, index + 1));

        // Use browser history to go back the calculated steps
        window.history.go(-stepsBack);

        // Reset flag after navigation
        setTimeout(() => {
          this.isProgrammaticNavigation = false;
        }, 100);
      } else {
        // Fallback to router navigation
        this.navigationHistory.set(history.slice(0, index + 1));

        this.router.navigateByUrl(targetUrl).then(() => {
          setTimeout(() => {
            this.isProgrammaticNavigation = false;
          }, 0);
        });
      }
    }
  }

  getNavigationHistory(): NavigationHistoryItem[] {
    return this.navigationHistory();
  }

  // Helper method to check if browser history navigation is available
  private canUseBrowserHistory(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.history !== 'undefined' &&
      window.history.length > 1
    );
  }

  // Helper method to check if we can go back using browser history
  private canUseBrowserBack(): boolean {
    return this.canUseBrowserHistory() && this.navigationHistory().length > 1;
  }

  // Clear navigation history (used when navigating to home/root)
  clearHistory(): void {
    this.navigationHistory.set([]);
    // Reinitialize with current route
    setTimeout(() => this.initializeHistory(), 0);
  }

  // Cleanup method for destroying the service
  ngOnDestroy() {
    if (this.popstateListener && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.popstateListener);
    }
  }
}
