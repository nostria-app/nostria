import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Result of a search handler attempting to handle a search request.
 */
export interface SearchHandlerResult {
  /** Whether the handler handled the search (if true, global search won't be triggered) */
  handled: boolean;
}

/**
 * Callback function type for search handlers.
 * Components can register handlers that receive the search query.
 * Return { handled: true } to prevent global search, { handled: false } to let it proceed.
 */
export type SearchHandler = (query: string) => SearchHandlerResult;

/**
 * Service to manage global search actions.
 * 
 * This service allows a single search button to trigger search across the app.
 * Components can register handlers to intercept and handle search requests
 * with their own custom search implementation.
 * 
 * If no handler claims the search (all return handled: false), the global search is triggered.
 * 
 * Usage in components:
 * ```typescript
 * // Register handler in ngOnInit
 * this.searchAction.registerHandler((query) => {
 *   if (this.shouldHandleSearch) {
 *     this.localSearchQuery.set(query);
 *     return { handled: true };
 *   }
 *   return { handled: false };
 * });
 * 
 * // Unregister in ngOnDestroy
 * this.searchAction.unregisterHandler(this.myHandler);
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class SearchActionService {
  /** Subject for search trigger events (for components using RxJS) */
  private readonly searchTriggered$ = new Subject<void>();
  
  /** Registered search handlers from components */
  private handlers = new Set<SearchHandler>();
  
  /** Signal indicating whether a component-specific search is active */
  private readonly _componentSearchActive = signal(false);
  componentSearchActive = this._componentSearchActive.asReadonly();
  
  /** The active component search handler (if any) */
  private activeComponentHandler: SearchHandler | null = null;
  
  /**
   * Register a search handler.
   * Handlers are called in order when search is triggered.
   * If any handler returns { handled: true }, global search is not opened.
   */
  registerHandler(handler: SearchHandler): void {
    this.handlers.add(handler);
    this.activeComponentHandler = handler;
    this._componentSearchActive.set(true);
  }
  
  /**
   * Unregister a search handler.
   * Call this in component's ngOnDestroy.
   */
  unregisterHandler(handler: SearchHandler): void {
    this.handlers.delete(handler);
    if (this.activeComponentHandler === handler) {
      this.activeComponentHandler = null;
      this._componentSearchActive.set(false);
    }
  }
  
  /**
   * Clear all handlers and reset state.
   * Used when navigating to a page that doesn't have custom search.
   */
  clearHandlers(): void {
    this.handlers.clear();
    this.activeComponentHandler = null;
    this._componentSearchActive.set(false);
  }
  
  /**
   * Trigger search action.
   * This is called by the global search button.
   * 
   * @param query Optional initial query string
   * @returns true if a component handler handled the search, false if global search should open
   */
  triggerSearch(query = ''): boolean {
    // Notify subscribers
    this.searchTriggered$.next();
    
    // Try each handler
    for (const handler of this.handlers) {
      const result = handler(query);
      if (result.handled) {
        return true;
      }
    }
    
    // No handler claimed it - global search should handle it
    return false;
  }
  
  /**
   * Get observable for search trigger events.
   * Components can subscribe to be notified when search is triggered.
   */
  get onSearchTriggered() {
    return this.searchTriggered$.asObservable();
  }
  
  /**
   * Check if there are any registered handlers.
   */
  hasHandlers(): boolean {
    return this.handlers.size > 0;
  }
}
