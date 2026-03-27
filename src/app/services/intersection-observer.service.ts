import { Injectable, inject, PLATFORM_ID, NgZone, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Callback function type for intersection changes
 */
export type IntersectionCallback = (isIntersecting: boolean, entry: IntersectionObserverEntry) => void;

/**
 * Options for observing an element
 */
export interface ObserveOptions {
  /**
   * Scroll root for the observer (default: null = browser viewport)
   */
  root?: Element | Document | null;

  /**
   * Root margin for the observer (default: '200px')
   * Positive values trigger observation before element enters viewport
   */
  rootMargin?: string;
  
  /**
   * Threshold for intersection (default: 0.01)
   * 0.01 means 1% of element must be visible
   */
  threshold?: number;
}

/**
 * Internal tracking for observed elements
 */
interface ObservedEntry {
  observerKey: string;
  callback: IntersectionCallback;
  options: Required<ObserveOptions>;
}

/**
 * Shared IntersectionObserver service that manages a pool of observers
 * to reduce memory usage and improve performance when observing many elements.
 * 
 * Instead of each component creating its own IntersectionObserver (which is expensive
 * when you have hundreds of components), this service creates a small number of
 * shared observers grouped by their options (root + rootMargin + threshold).
 * 
 * Usage:
 * ```typescript
 * // In your component
 * private intersectionService = inject(IntersectionObserverService);
 * 
 * ngAfterViewInit() {
 *   this.intersectionService.observe(
 *     this.elementRef.nativeElement,
 *     (isIntersecting) => {
 *       if (isIntersecting) {
 *         this.loadContent();
 *       }
 *     }
 *   );
 * }
 * 
 * ngOnDestroy() {
 *   this.intersectionService.unobserve(this.elementRef.nativeElement);
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class IntersectionObserverService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ngZone = inject(NgZone);
  private nextRootId = 0;
  
  /**
   * Map of observer key -> IntersectionObserver
   * Key format: `${rootId}:${rootMargin}:${threshold}`
   */
  private observers = new Map<string, IntersectionObserver>();
  private rootIds = new WeakMap<object, number>();
  
  /**
   * Map of element -> observed entry data
   * Tracks all observed elements and their callbacks
   */
  private observedElements = new Map<Element, ObservedEntry[]>();
  
  /**
   * Default options for observation
   */
  private readonly defaultOptions: Required<ObserveOptions> = {
    root: null,
    rootMargin: '200px',
    threshold: 0.01
  };
  
  /**
   * Start observing an element for intersection changes
   * 
   * @param element The DOM element to observe
   * @param callback Function called when intersection state changes
   * @param options Optional configuration for observation
   */
  observe(
    element: Element,
    callback: IntersectionCallback,
    options?: ObserveOptions
  ): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    // Merge with defaults
    const resolvedOptions: Required<ObserveOptions> = {
      root: options?.root ?? this.defaultOptions.root,
      rootMargin: options?.rootMargin ?? this.defaultOptions.rootMargin,
      threshold: options?.threshold ?? this.defaultOptions.threshold
    };
    
    const observerKey = this.getObserverKey(resolvedOptions);

    // Get or create the observer for these options
    const observer = this.getOrCreateObserver(resolvedOptions);

    // Store or replace the callback for this element + observer key
    const existingEntries = this.observedElements.get(element) ?? [];
    const filteredEntries = existingEntries.filter(entry => entry.observerKey !== observerKey);
    filteredEntries.push({
      observerKey,
      callback,
      options: resolvedOptions
    });
    this.observedElements.set(element, filteredEntries);
    
    // Start observing
    observer.observe(element);
  }
  
  /**
   * Stop observing an element
   * 
   * @param element The DOM element to stop observing
   */
  unobserve(element: Element, options?: ObserveOptions): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const entries = this.observedElements.get(element);
    if (!entries || entries.length === 0) {
      return;
    }

    if (options) {
      const resolvedOptions: Required<ObserveOptions> = {
        root: options.root ?? this.defaultOptions.root,
        rootMargin: options.rootMargin ?? this.defaultOptions.rootMargin,
        threshold: options.threshold ?? this.defaultOptions.threshold
      };
      const observerKey = this.getObserverKey(resolvedOptions);
      const remainingEntries = entries.filter(entry => entry.observerKey !== observerKey);
      const observer = this.observers.get(observerKey);

      if (observer) {
        observer.unobserve(element);
      }

      if (remainingEntries.length > 0) {
        this.observedElements.set(element, remainingEntries);
      } else {
        this.observedElements.delete(element);
      }

      return;
    }

    for (const entry of entries) {
      const observer = this.observers.get(entry.observerKey);
      if (observer) {
        observer.unobserve(element);
      }
    }

    this.observedElements.delete(element);
  }
  
  /**
   * Check if an element is currently being observed
   */
  isObserving(element: Element): boolean {
    return (this.observedElements.get(element)?.length ?? 0) > 0;
  }
  
  /**
   * Get the number of currently observed elements
   */
  getObservedCount(): number {
    let count = 0;
    for (const entries of this.observedElements.values()) {
      count += entries.length;
    }
    return count;
  }
  
  /**
   * Get the number of active observers
   */
  getObserverCount(): number {
    return this.observers.size;
  }
  
  ngOnDestroy(): void {
    // Disconnect all observers
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }
    this.observers.clear();
    this.observedElements.clear();
  }
  
  /**
   * Get or create an IntersectionObserver for the given options
   */
  private getOrCreateObserver(options: Required<ObserveOptions>): IntersectionObserver {
    const key = this.getObserverKey(options);
    
    let observer = this.observers.get(key);
    if (!observer) {
      // Create observer outside Angular zone to avoid unnecessary change detection
      observer = this.ngZone.runOutsideAngular(() => {
        return new IntersectionObserver(
          (entries) => this.handleIntersection(key, entries),
          {
            root: options.root,
            rootMargin: options.rootMargin,
            threshold: options.threshold
          }
        );
      });
      
      this.observers.set(key, observer);
    }
    
    return observer;
  }
  
  /**
   * Generate a unique key for an observer based on its options
   */
  private getObserverKey(options: Required<ObserveOptions>): string {
    return `${this.getRootKey(options.root)}:${options.rootMargin}:${options.threshold}`;
  }

  /**
   * Generate a stable key for an observer root.
   */
  private getRootKey(root: Element | Document | null): string {
    if (!root) {
      return 'viewport';
    }

    const existingId = this.rootIds.get(root);
    if (existingId !== undefined) {
      return `root-${existingId}`;
    }

    const newId = ++this.nextRootId;
    this.rootIds.set(root, newId);
    return `root-${newId}`;
  }
  
  /**
   * Handle intersection changes for all observed elements
   */
  private handleIntersection(observerKey: string, entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const observedEntries = this.observedElements.get(entry.target);
      const observedEntry = observedEntries?.find(candidate => candidate.observerKey === observerKey);
      if (observedEntry) {
        // Run callback inside Angular zone to trigger change detection
        this.ngZone.run(() => {
          observedEntry.callback(entry.isIntersecting, entry);
        });
      }
    }
  }
}
