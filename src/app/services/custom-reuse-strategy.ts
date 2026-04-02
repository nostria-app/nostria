import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Custom route reuse strategy.
 * 
 * This strategy does NOT detach/cache routes.
 * It only controls when Angular can reuse the current component instance.
 * 
 * Note: FeedsComponent is embedded directly in app.html (not routed), so it
 * stays alive regardless of this strategy.
 */
@Injectable({
  providedIn: 'root'
})
export class CustomReuseStrategy implements RouteReuseStrategy {
  /**
   * Never detach routes - don't cache any components
   */
  shouldDetach(_route: ActivatedRouteSnapshot): boolean {
    return false;
  }

  /**
   * Never store anything
   */
  store(_route: ActivatedRouteSnapshot, _handle: DetachedRouteHandle | null): void {
    // No-op
  }

  /**
   * Never attach stored routes
   */
  shouldAttach(_route: ActivatedRouteSnapshot): boolean {
    return false;
  }

  /**
   * Never retrieve stored routes
   */
  retrieve(_route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    return null;
  }

  private shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }

    return aKeys.every(key => a[key] === b[key]);
  }

  private sameUrlSegments(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.url.length !== curr.url.length) {
      return false;
    }

    return future.url.every((segment, index) => segment.path === curr.url[index]?.path);
  }

  /**
   * Determine if the route should be reused.
   * Preserve the current right-pane component when only the left pane changes,
   * but still recreate right-pane components when their own params or path change.
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.outlet === 'right' || curr.outlet === 'right') {
      return future.routeConfig === curr.routeConfig
        && this.sameUrlSegments(future, curr)
        && this.shallowEqual(future.params, curr.params)
        && this.shallowEqual(future.queryParams, curr.queryParams);
    }
    return future.routeConfig === curr.routeConfig;
  }

  /**
   * Clear cache - no-op since we don't cache anything
   */
  clearCache(): void {
    // No-op
  }
}
