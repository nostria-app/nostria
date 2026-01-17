import { Injectable, signal, computed, Type, inject, ComponentRef } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Configuration for a panel component
 */
export interface PanelConfig {
  component: Type<any>;
  inputs?: Record<string, any>;
  title?: string;
}

/**
 * Entry in the right panel navigation stack
 */
export interface RightPanelEntry {
  config: PanelConfig;
  url?: string; // Optional URL to display in browser
  componentRef?: ComponentRef<any>; // Reference to the created component (managed by container)
  scrollPosition?: number; // Save scroll position when navigating away
}

/**
 * Service to manage the right panel content independently from routing.
 * This allows the left panel (with router-outlet) to stay active while
 * showing detail views in the right panel.
 */
@Injectable({
  providedIn: 'root'
})
export class RightPanelService {
  private readonly router = inject(Router);

  // Stack of panel entries for back navigation
  private readonly _stack = signal<RightPanelEntry[]>([]);

  // Index of the currently active entry in the stack
  private readonly _activeIndex = signal<number>(-1);

  // Current entry is at the active index
  readonly currentEntry = computed(() => {
    const stack = this._stack();
    const index = this._activeIndex();
    return index >= 0 && index < stack.length ? stack[index] : null;
  });

  // Whether the right panel has content
  readonly hasContent = computed(() => this._stack().length > 0);

  // Whether we can go back (more than 1 entry in stack)
  readonly canGoBack = computed(() => this._activeIndex() > 0);

  // Current panel title
  readonly title = computed(() => {
    const entry = this.currentEntry();
    return entry?.config.title ?? '';
  });

  // Get all entries (for rendering all components with visibility control)
  readonly allEntries = this._stack.asReadonly();
  readonly activeIndex = this._activeIndex.asReadonly();

  /**
   * Open a component in the right panel
   * @param config Panel configuration with component and inputs
   * @param url Optional URL to update in browser (for sharing/bookmarking)
   */
  open(config: PanelConfig, url?: string): void {
    const entry: RightPanelEntry = { config, url };

    // Save scroll position of current entry before navigating
    const currentIndex = this._activeIndex();
    if (currentIndex >= 0) {
      this._stack.update(stack => {
        const updated = [...stack];
        if (updated[currentIndex]) {
          updated[currentIndex] = { ...updated[currentIndex], scrollPosition: this.getCurrentScrollPosition() };
        }
        return updated;
      });
    }

    // Add new entry to end of stack and make it active
    this._stack.update(stack => [...stack, entry]);
    this._activeIndex.set(this._stack().length - 1);

    // Scroll to top immediately when opening new content
    this.scrollToTop();

    // Update browser URL if provided (for sharing/bookmarking)
    if (url && typeof window !== 'undefined') {
      window.history.pushState({ rightPanel: true }, '', url);
    }
  }

  /**
   * Save component reference for an entry (called by container after creating component)
   */
  setComponentRef(index: number, ref: ComponentRef<any>): void {
    this._stack.update(stack => {
      const updated = [...stack];
      if (updated[index]) {
        updated[index] = { ...updated[index], componentRef: ref };
      }
      return updated;
    });
  }

  /**
   * Get current scroll position of the panel content
   */
  private getCurrentScrollPosition(): number {
    if (typeof document === 'undefined') return 0;
    const content = document.querySelector('.right-panel-content');
    return content?.scrollTop ?? 0;
  }

  /**
   * Scroll the right panel content to top
   */
  private scrollToTop(): void {
    if (typeof document === 'undefined') return;
    const content = document.querySelector('.right-panel-content');
    if (content) {
      content.scrollTop = 0;
    }
  }

  /**
   * Go back in the right panel history
   */
  goBack(): void {
    const currentIndex = this._activeIndex();
    if (currentIndex <= 0) {
      // Close panel
      this.close();
      return;
    }

    // Save scroll position of current entry
    this._stack.update(stack => {
      const updated = [...stack];
      if (updated[currentIndex]) {
        updated[currentIndex] = { ...updated[currentIndex], scrollPosition: this.getCurrentScrollPosition() };
      }
      return updated;
    });

    // Move to previous entry
    this._activeIndex.set(currentIndex - 1);

    // Update URL to previous entry if available
    const prevEntry = this._stack()[currentIndex - 1];
    if (prevEntry?.url && typeof window !== 'undefined') {
      window.history.replaceState({ rightPanel: true }, '', prevEntry.url);
    }
  }

  /**
   * Close the right panel and clear all history
   */
  close(): void {
    // Destroy all component refs
    const stack = this._stack();
    for (const entry of stack) {
      if (entry.componentRef) {
        entry.componentRef.destroy();
      }
    }

    this._stack.set([]);
    this._activeIndex.set(-1);

    // Reset URL to the current Angular router URL (the left panel's route)
    // Use replaceState to avoid triggering navigation and component reload
    if (typeof window !== 'undefined') {
      const currentRouterUrl = this.router.url;
      window.history.replaceState({}, '', currentRouterUrl);
    }
  }

  /**
   * Clear all panel history
   */
  clearHistory(): void {
    // Destroy all component refs
    const stack = this._stack();
    for (const entry of stack) {
      if (entry.componentRef) {
        entry.componentRef.destroy();
      }
    }

    this._stack.set([]);
    this._activeIndex.set(-1);
  }

  /**
   * Update the title of the current panel
   */
  updateTitle(title: string): void {
    const currentIndex = this._activeIndex();
    if (currentIndex < 0) return;

    this._stack.update(stack => {
      const updated = [...stack];
      if (updated[currentIndex]) {
        updated[currentIndex] = {
          ...updated[currentIndex],
          config: { ...updated[currentIndex].config, title }
        };
      }
      return updated;
    });
  }
}
