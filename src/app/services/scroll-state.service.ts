import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * A lightweight service for tracking scroll state.
 * This service is extracted from LayoutService to break circular dependencies
 * in components that only need scroll state information.
 */
@Injectable({ providedIn: 'root' })
export class ScrollStateService {
  private platformId = inject(PLATFORM_ID);
  
  /** Signal indicating whether the user is currently scrolling */
  isScrolling = signal(false);
  
  /** Signal indicating the current scroll position */
  scrollPosition = signal(0);
  
  /** Signal indicating whether the page is scrolled to the bottom */
  scrolledToBottom = signal(false);
  
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initScrollListener();
    }
  }
  
  private initScrollListener(): void {
    let ticking = false;
    
    const handleScroll = () => {
      this.isScrolling.set(true);
      this.scrollPosition.set(window.scrollY);
      
      // Clear existing timeout
      if (this.scrollTimeout) {
        clearTimeout(this.scrollTimeout);
      }
      
      // Set scrolling to false after scroll stops
      this.scrollTimeout = setTimeout(() => {
        this.isScrolling.set(false);
        
        // Check if scrolled to bottom
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        const scrollTop = window.scrollY;
        const threshold = 100; // pixels from bottom
        
        this.scrolledToBottom.set(scrollTop + clientHeight >= scrollHeight - threshold);
      }, 150);
    };
    
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }
  
  isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
