import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { RelayService } from './relay.service';
import { NostrService } from './nostr.service';
import { ApplicationService } from './application.service';
import { ApplicationStateService } from './application-state.service';
import { NostrEvent } from '../interfaces';

// Define bookmark types
export type BookmarkType = 'event' | 'article' | 'url';

@Injectable({
  providedIn: 'root'
})
export class BookmarkService {
  relay = inject(RelayService);
  app = inject(ApplicationService);
  appState = inject(ApplicationStateService);

  bookmarkEvents = signal<any[]>([]);
  bookmarkArticles = signal<any[]>([]);
  bookmarkUrls = signal<any[]>([]);

  // Legacy computed properties for backward compatibility
  // bookmarkEventsStatus = computed(() => this.bookmarkStatus().event);
  // bookmarkEventsIcons = computed(() => this.bookmarkIcons().event);
  bookmarkEvent: NostrEvent | null = null;

  constructor() {
    effect(async () => {
      const pubkey = this.appState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.bookmarkEvent = null;
        this.bookmarkEvents.set([]);
        this.bookmarkArticles.set([]);
        this.bookmarkUrls.set([]);
      }
    });
  }

  async initialize() {
    if (!this.appState.pubkey()) {
      return;
    }

    const bookmarksEvent = await this.relay.get({ authors: [this.appState.pubkey()!], kinds: [10003] });
    if (bookmarksEvent) {
      this.bookmarkEvent = bookmarksEvent;

      const bookmarksEvents = bookmarksEvent.tags.filter(tag => tag[0] === 'e').map(tag => ({ id: tag[1] }));
      this.bookmarkEvents.set(bookmarksEvents);

      const bookmarksArticles = bookmarksEvent.tags.filter(tag => tag[0] === 'a').map(tag => ({ id: tag[1] }));
      this.bookmarkArticles.set(bookmarksArticles);

      const bookmarkUrls = bookmarksEvent.tags.filter(tag => tag[0] === 'r').map(tag => ({ id: tag[1] }));
      this.bookmarkUrls.set(bookmarkUrls);
    }
  }

  // Helper to get the appropriate signal based on bookmark type
  private getBookmarkSignal(type: BookmarkType) {
    switch (type) {
      case 'event': return this.bookmarkEvents;
      case 'article': return this.bookmarkArticles;
      case 'url': return this.bookmarkUrls;
      default: return this.bookmarkEvents; // Default to events
    }
  }

  // Create computed signals to track bookmarked status for all types
  bookmarkStatus = computed(() => {
    const eventStatus = this.createStatusMap(this.bookmarkEvents());
    const articleStatus = this.createStatusMap(this.bookmarkArticles());
    const urlStatus = this.createStatusMap(this.bookmarkUrls());

    return {
      event: eventStatus,
      article: articleStatus,
      url: urlStatus
    };
  });

  // Create computed signal for bookmark icons for all types
  bookmarkIcons = computed(() => {
    const statuses = this.bookmarkStatus();
    const result = {
      event: this.createIconMap(statuses.event),
      article: this.createIconMap(statuses.article),
      url: this.createIconMap(statuses.url)
    };

    return result;
  });

  // Helper method to create status maps
  private createStatusMap(bookmarks: any[]): Record<string, boolean> {
    const statusMap: Record<string, boolean> = {};
    bookmarks.forEach(bookmark => {
      statusMap[bookmark.id] = true;
    });
    return statusMap;
  }

  // Helper method to create icon maps
  private createIconMap(statusMap: Record<string, boolean>): Record<string, string> {
    const iconMap: Record<string, string> = {};
    Object.keys(statusMap).forEach(id => {
      iconMap[id] = statusMap[id] ? 'bookmark' : 'bookmark_border';
    });
    return iconMap;
  }

  addBookmark(id: string, type: BookmarkType = 'event') {
    const signal = this.getBookmarkSignal(type);
    const existingBookmark = signal().find(b => b.id === id);

    if (existingBookmark) {
      signal.update(bookmarks => bookmarks.filter(b => b.id !== id));
    } else {
      signal.update(bookmarks => [...bookmarks, { id }]);
    }
  }

  toggleBookmark(id: string, type: BookmarkType = 'event') {
    this.addBookmark(id, type); // Add and toggle are the same operation
  }

  isBookmarked(id: string, type: BookmarkType = 'event'): boolean {
    return !!this.getBookmarkSignal(type)().find(b => b.id === id);
  }

  // Helper method to get tooltip text based on bookmark status
  getBookmarkTooltip(id: string, type: BookmarkType = 'event'): string {
    return this.bookmarkStatus()[type][id] ? 'Remove bookmark' : 'Add bookmark';
  }

  // Helper method to get icon based on bookmark status
  getBookmarkIcon(id: string, type: BookmarkType = 'event'): string {
    return this.bookmarkStatus()[type][id] ? 'bookmark' : 'bookmark_border';
  }

  // Legacy methods for backward compatibility
  addBookmarkEvent(id: string) {
    this.addBookmark(id, 'event');
  }

  toggleBookmarkEvent(id: string) {
    this.toggleBookmark(id, 'event');
  }

  isBookmarkedEvent(id: string): boolean {
    return this.isBookmarked(id, 'event');
  }

  getBookmarkEventTooltip(id: string): string {
    return this.getBookmarkTooltip(id, 'event');
  }

  getBookmarkEventIcon(id: string): string {
    return this.getBookmarkIcon(id, 'event');
  }

  publish() {
    
  }
}
