// Real-world examples for your Feeds component

import { Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-practical-url-examples',
  template: `<!-- Your template here -->`,
})
export class PracticalUrlExamplesComponent {
  private location = inject(Location);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // =============================================================================
  // PRACTICAL EXAMPLES FOR YOUR FEEDS COMPONENT
  // =============================================================================

  /**
   * Example 1: Update feed path in URL without navigation
   * Perfect for when user selects a different feed
   */
  selectFeedSilently(feedPath: string): void {
    // Update URL from /f to /f/my-custom-feed without triggering navigation
    this.location.replaceState(`/f/${feedPath}`);
    
    // Your existing feed selection logic continues...
    // this.feedsCollectionService.setActiveFeed(feedId);
    console.log('Feed selected, URL updated silently to:', `/f/${feedPath}`);
  }

  /**
   * Example 2: Update column index for mobile view state
   * Maintains which column is visible when user navigates between columns
   */
  updateColumnVisibility(columnIndex: number): void {
    const currentPath = this.location.path().split('?')[0]; // Get path without query params
    const urlTree = this.router.createUrlTree([], {
      queryParams: { column: columnIndex },
      queryParamsHandling: 'merge'
    });
    
    // This preserves existing query params and only updates/adds the column param
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Column visibility updated in URL:', columnIndex);
  }

  /**
   * Example 3: Update filter state in URL
   * Useful for maintaining selected tags or filters when user refreshes page
   */
  updateFiltersInUrl(selectedTags: string[], showAdvanced: boolean): void {
    const queryParams: any = {};
    
    if (selectedTags.length > 0) {
      queryParams.tags = selectedTags.join(',');
    }
    
    if (showAdvanced) {
      queryParams.advanced = 'true';
    }
    
    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'merge'
    });
    
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Filters updated in URL:', queryParams);
  }

  /**
   * Example 4: Update scroll position or view state
   * Maintain UI state like which section is active
   */
  updateViewState(activeSection: string, visibleColumn?: number): void {
    const queryParams: any = { section: activeSection };
    
    if (visibleColumn !== undefined) {
      queryParams.column = visibleColumn;
    }
    
    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'merge'
    });
    
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('View state updated in URL:', queryParams);
  }

  /**
   * Example 5: Restore state from URL on component initialization
   * Read URL parameters and restore component state without triggering navigation
   */
  restoreStateFromUrl(): void {
    const queryParams = this.route.snapshot.queryParams;
    
    // Restore filters
    if (queryParams['tags']) {
      const tags = queryParams['tags'].split(',');
      // this.selectedTags.set(tags);
      console.log('Restored tags from URL:', tags);
    }
    
    // Restore active section
    if (queryParams['section']) {
      // this.activeSection.set(queryParams['section']);
      console.log('Restored section from URL:', queryParams['section']);
    }
    
    // Restore column visibility
    if (queryParams['column']) {
      const columnIndex = parseInt(queryParams['column'], 10);
      // this.visibleColumnIndex.set(columnIndex);
      console.log('Restored column index from URL:', columnIndex);
    }
  }

  /**
   * Example 6: Update URL when dragging/reordering columns
   * Maintain column order state in URL for better UX
   */
  updateColumnOrderInUrl(newColumnOrder: string[]): void {
    const queryParams = {
      columnOrder: newColumnOrder.join(',')
    };
    
    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'merge'
    });
    
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Column order updated in URL:', newColumnOrder);
  }

  /**
   * Example 7: Clean up URL parameters
   * Remove specific parameters without affecting others
   */
  cleanupUrlParameters(paramsToRemove: string[]): void {
    const currentParams = { ...this.route.snapshot.queryParams };
    
    // Remove specified parameters
    paramsToRemove.forEach(param => {
      delete currentParams[param];
    });
    
    const urlTree = this.router.createUrlTree([], {
      queryParams: currentParams
    });
    
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Cleaned up URL parameters:', paramsToRemove);
  }

  /**
   * Example 8: Update URL with complex state object
   * Serialize complex state into URL for deep linking
   */
  updateComplexStateInUrl(state: {
    feedId: string;
    columnIndex: number;
    filters: string[];
    sortBy: string;
    viewMode: string;
  }): void {
    const queryParams = {
      feed: state.feedId,
      column: state.columnIndex.toString(),
      filters: state.filters.join(','),
      sort: state.sortBy,
      view: state.viewMode
    };
    
    // Remove empty parameters
    Object.keys(queryParams).forEach(key => {
      if (!queryParams[key as keyof typeof queryParams] || queryParams[key as keyof typeof queryParams] === '') {
        delete queryParams[key as keyof typeof queryParams];
      }
    });
    
    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'replace' // Replace all query params
    });
    
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Complex state updated in URL:', state);
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Get current URL path without domain
   */
  getCurrentPath(): string {
    return this.location.path();
  }

  /**
   * Get current query parameters as object
   */
  getCurrentQueryParams(): Record<string, string> {
    return this.route.snapshot.queryParams;
  }

  /**
   * Check if URL has specific query parameter
   */
  hasQueryParam(paramName: string): boolean {
    return paramName in this.route.snapshot.queryParams;
  }

  /**
   * Get specific query parameter value
   */
  getQueryParam(paramName: string, defaultValue?: string): string | undefined {
    return this.route.snapshot.queryParams[paramName] || defaultValue;
  }
}
