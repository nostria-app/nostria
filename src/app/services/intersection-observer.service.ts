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
  callback: IntersectionCallback;
  options: Required<ObserveOptions>;
}

/**
 * Shared IntersectionObserver service that manages a pool of observers
 * to reduce memory usage and improve performance when observing many elements.
 * 
 * Instead of each component creating its own IntersectionObserver (which is expensive
 * when you have hundreds of components), this service creates a small number of
 * shared observers grouped by their options (rootMargin + threshold).
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
  
  /**
   * Map of observer key -> IntersectionObserver
   * Key format: `${rootMargin}:${threshold}`
   */
  private observers = new Map<string, IntersectionObserver>();
  
  /**
   * Map of element -> observed entry data
   * Tracks all observed elements and their callbacks
   */
  private observedElements = new Map<Element, ObservedEntry>();
  
  /**
   * Default options for observation
   */
  private readonly defaultOptions: Required<ObserveOptions> = {
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
      rootMargin: options?.rootMargin ?? this.defaultOptions.rootMargin,
      threshold: options?.threshold ?? this.defaultOptions.threshold
    };
    
    // Get or create the observer for these options
    const observer = this.getOrCreateObserver(resolvedOptions);
    
    // Store the callback for this element
    this.observedElements.set(element, {
      callback,
      options: resolvedOptions
    });
    
    // Start observing
    observer.observe(element);
  }
  
  /**
   * Stop observing an element
   * 
   * @param element The DOM element to stop observing
   */
  unobserve(element: Element): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    const entry = this.observedElements.get(element);
    if (!entry) {
      return;
    }
    
    // Get the observer for this element's options
    const observerKey = this.getObserverKey(entry.options);
    const observer = this.observers.get(observerKey);
    
    if (observer) {
      observer.unobserve(element);
    }
    
    // Remove from tracked elements
    this.observedElements.delete(element);
  }
  
  /**
   * Check if an element is currently being observed
   */
  isObserving(element: Element): boolean {
    return this.observedElements.has(element);
  }
  
  /**
   * Get the number of currently observed elements
   */
  getObservedCount(): number {
    return this.observedElements.size;
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
          (entries) => this.handleIntersection(entries),
          {
            root: null, // Use viewport as root
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
    return `${options.rootMargin}:${options.threshold}`;
  }
  
  /**
   * Handle intersection changes for all observed elements
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const observedEntry = this.observedElements.get(entry.target);
      if (observedEntry) {
        // Run callback inside Angular zone to trigger change detection
        this.ngZone.run(() => {
          observedEntry.callback(entry.isIntersecting, entry);
        });
      }
    }
  }
}
