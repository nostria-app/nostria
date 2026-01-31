import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Custom route reuse strategy.
 * 
 * This strategy does NOT cache/reuse any routes. All components are destroyed
 * and recreated on navigation. The only customization is to prevent route reuse
 * in the 'right' auxiliary outlet to avoid Angular router state tree issues.
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

  /**
   * Determine if the route should be reused.
   * Never reuse routes in the 'right' auxiliary outlet to prevent
   * Angular's router state tree from getting confused.
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.outlet === 'right' || curr.outlet === 'right') {
      return false;
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
