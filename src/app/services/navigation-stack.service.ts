import { Injectable, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';

/**
 * Represents an item in the navigation stack
 */
export interface NavigationItem {
  type: 'event' | 'profile';
  id: string; // event id or pubkey
  data?: Event; // Optional event data for performance
}

/**
 * Service to manage navigation stack for the two-column feed view
 * Tracks the history of opened profiles/events in the right column
 */
@Injectable({
  providedIn: 'root'
})
export class NavigationStackService {
  // Stack of navigation items (most recent at the end)
  private stack = signal<NavigationItem[]>([]);

  // Computed signals for UI state
  hasItems = computed(() => this.stack().length > 0);
  hasMultipleItems = computed(() => this.stack().length > 1);
  currentItem = computed(() => {
    const items = this.stack();
    return items.length > 0 ? items[items.length - 1] : null;
  });

  // Get all items (for debugging/testing)
  getStack() {
    return this.stack();
  }

  /**
   * Push a new item onto the stack
   */
  push(item: NavigationItem) {
    this.stack.update(items => [...items, item]);
  }

  /**
   * Pop the last item from the stack
   * Returns the popped item, or null if stack was empty
   */
  pop(): NavigationItem | null {
    let popped: NavigationItem | null = null;
    this.stack.update(items => {
      if (items.length === 0) return items;
      popped = items[items.length - 1];
      return items.slice(0, -1);
    });
    return popped;
  }

  /**
   * Clear the entire stack
   */
  clear() {
    this.stack.set([]);
  }

  /**
   * Replace the current item (useful for navigation within same type)
   */
  replaceCurrent(item: NavigationItem) {
    this.stack.update(items => {
      if (items.length === 0) {
        return [item];
      }
      return [...items.slice(0, -1), item];
    });
  }

  /**
   * Navigate to an event
   */
  navigateToEvent(eventId: string, eventData?: Event) {
    this.push({
      type: 'event',
      id: eventId,
      data: eventData
    });
  }

  /**
   * Navigate to a profile
   */
  navigateToProfile(pubkey: string) {
    this.push({
      type: 'profile',
      id: pubkey
    });
  }
}
