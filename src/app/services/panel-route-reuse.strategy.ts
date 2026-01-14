import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';
import { PanelNavigationService } from './panel-navigation.service';

/**
 * Custom RouteReuseStrategy that caches "list" type routes (left panel)
 * when navigating to "detail" type routes (right panel).
 * 
 * This allows the left panel content to be preserved when opening
 * detail views in the right panel.
 */
@Injectable()
export class PanelRouteReuseStrategy implements RouteReuseStrategy {
  private storedRoutes = new Map<string, DetachedRouteHandle>();
  private panelNav: PanelNavigationService | null = null;

  /**
   * Set the panel navigation service (called from app.config.ts)
   */
  setPanelNavigationService(service: PanelNavigationService): void {
    this.panelNav = service;
  }

  /**
   * Get route key for storage
   */
  private getRouteKey(route: ActivatedRouteSnapshot): string {
    const path = route.pathFromRoot
      .filter(r => r.routeConfig)
      .map(r => r.routeConfig!.path)
      .filter(p => p && p.length > 0)
      .join('/');
    return path || 'home';
  }

  /**
   * Determine if the route should be detached (cached) when leaving
   */
  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    if (!this.panelNav) return false;

    const path = this.getRouteKey(route);
    const routeType = this.panelNav.getRouteType('/' + path);

    // Only cache "list" type routes (left panel)
    // This preserves the left panel when navigating to detail views
    return routeType === 'list';
  }

  /**
   * Store the detached route handle
   */
  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (handle) {
      const key = this.getRouteKey(route);
      this.storedRoutes.set(key, handle);
    }
  }

  /**
   * Determine if a stored route should be attached (restored)
   */
  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    return this.storedRoutes.has(key);
  }

  /**
   * Retrieve the stored route handle
   */
  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.getRouteKey(route);
    return this.storedRoutes.get(key) || null;
  }

  /**
   * Determine if the route should reuse the current component
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  /**
   * Clear all cached routes (called when navigating to a root list component)
   */
  clearCache(): void {
    this.storedRoutes.forEach((handle: DetachedRouteHandle) => {
      // Destroy the cached components
      if (handle && (handle as any).componentRef) {
        (handle as any).componentRef.destroy();
      }
    });
    this.storedRoutes.clear();
  }

  /**
   * Clear a specific cached route
   */
  clearRouteCache(path: string): void {
    this.storedRoutes.delete(path);
  }
}
