import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Custom route reuse strategy that keeps components alive when navigating.
 * Components are only destroyed when navigating to root pages.
 * 
 * Root pages that clear the cache:
 * - Music, Summary, Messages, Discover, People, Collections, Streams
 * 
 * Special handling:
 * - Feeds is always kept alive and never destroyed
 */
@Injectable({
  providedIn: 'root'
})
export class CustomReuseStrategy implements RouteReuseStrategy {
  private handlers = new Map<string, DetachedRouteHandle>();

  // Root paths that should clear the navigation cache (except feeds)
  private readonly rootPaths = new Set([
    'music',
    'summary',
    'messages',
    'discover',
    'people',
    'collections',
    'streams',
  ]);

  // Paths that should never be destroyed
  private readonly persistentPaths = new Set([
    'feeds',
    '', // home/feeds
  ]);

  // Paths that should be cached
  private readonly cacheablePaths = new Set([
    'feeds',
    '',
    'summary',
    'notifications',
    'search',
    'bookmarks',
    'music',
    'discover',
    'messages',
    'people',
    'collections',
    'streams',
    'settings',
  ]);

  /**
   * Get the route key for caching
   */
  private getRouteKey(route: ActivatedRouteSnapshot): string {
    // Build the full path from root
    const segments: string[] = [];
    let current: ActivatedRouteSnapshot | null = route;

    while (current) {
      if (current.routeConfig?.path) {
        segments.unshift(current.routeConfig.path);
      }
      current = current.parent;
    }

    // Include outlet name for named outlets
    const outlet = route.outlet;
    const path = segments.join('/');

    return outlet === 'primary' ? path : `${outlet}:${path}`;
  }

  /**
   * Get the root path from a route
   */
  private getRootPath(route: ActivatedRouteSnapshot): string {
    let root = route;
    while (root.parent && root.parent.routeConfig) {
      root = root.parent;
    }
    return root.routeConfig?.path || '';
  }

  /**
   * Determine if the route should be detached and stored
   */
  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const path = route.routeConfig?.path || '';

    // Always detach cacheable routes
    if (this.cacheablePaths.has(path)) {
      return true;
    }

    // Don't detach dynamic routes like e/:id, p/:id, a/:naddr
    if (path.includes(':')) {
      return false;
    }

    return false;
  }

  /**
   * Store the detached route handle
   */
  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (handle) {
      const key = this.getRouteKey(route);
      this.handlers.set(key, handle);
    }
  }

  /**
   * Determine if we should attach a stored route
   */
  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    return this.handlers.has(key);
  }

  /**
   * Retrieve the stored route handle
   */
  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.getRouteKey(route);
    return this.handlers.get(key) || null;
  }

  /**
   * Determine if the route should be reused
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    // Never reuse routes in the 'right' auxiliary outlet
    // This prevents Angular's router state tree from getting confused
    // when the same profile route config is used in both primary and auxiliary outlets
    if (future.outlet === 'right' || curr.outlet === 'right') {
      return false;
    }
    return future.routeConfig === curr.routeConfig;
  }

  /**
   * Clear all cached routes except persistent ones (like feeds)
   * Called when navigating to a root page
   */
  clearCache(keepPersistent = true): void {
    if (keepPersistent) {
      // Keep only persistent paths
      for (const [key] of this.handlers) {
        const path = key.includes(':') ? key.split(':')[1] : key;
        if (!this.persistentPaths.has(path)) {
          this.handlers.delete(key);
        }
      }
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Check if navigating to a root path that should clear cache
   */
  isRootNavigation(path: string): boolean {
    return this.rootPaths.has(path);
  }

  /**
   * Get the number of cached routes (for debugging)
   */
  getCacheSize(): number {
    return this.handlers.size;
  }
}
