import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class UrlUpdateService {
  private location = inject(Location);
  private router = inject(Router);

  /**
   * Method 1: Using Location.replaceState() - Updates URL without navigation
   * This is the most efficient and direct approach
   */
  updateUrlSilently(url: string): void {
    this.location.replaceState(url);
  }

  /**
   * Method 2: Using Location.go() - Similar to replaceState but adds to history
   */
  updateUrlWithHistory(url: string): void {
    this.location.go(url);
  }

  /**
   * Method 3: Using Router.navigate() with skipLocationChange
   * Updates internal router state but doesn't change browser URL
   */
  updateRouterStateSilently(commands: any[], extras?: any): void {
    this.router.navigate(commands, {
      ...extras,
      skipLocationChange: true,
    });
  }

  /**
   * Method 4: Using Router.navigate() with replaceUrl
   * Replaces current URL in history without adding new entry
   */
  replaceCurrentUrl(commands: any[], extras?: any): void {
    this.router.navigate(commands, {
      ...extras,
      replaceUrl: true,
    });
  }

  /**
   * Method 5: Update query parameters only without navigation
   */
  updateQueryParamsSilently(queryParams: Record<string, any>): void {
    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'merge',
    });
    this.location.replaceState(this.router.serializeUrl(urlTree));
  }

  /**
   * Method 6: Update specific path segments without navigation
   */
  updatePathSilently(pathSegments: string[], queryParams?: Record<string, any>): void {
    const urlTree = this.router.createUrlTree(pathSegments, { queryParams });
    this.location.replaceState(this.router.serializeUrl(urlTree));
  }
}
