import { Injectable, signal, computed, inject } from '@angular/core';
import { RelayService } from './relay.service';
import { NostrService } from './nostr.service';

@Injectable({

  providedIn: 'root'
})
export class BookmarkService {
  relay = inject(RelayService);
  nostr = inject(NostrService);

  // bookmarks = signal<any[]>([]);
  bookmarkEvents = signal<any[]>([]);
  bookmarkArticles = signal<any[]>([]);
  bookmarkUrls = signal<any[]>([]);

  async initialize() {
    const bookmarksEvent = await this.relay.get({ authors: [this.nostr.pubkey()], kinds: [10003] });
    if (bookmarksEvent) {
      const bookmarksEvents = bookmarksEvent.tags.filter(tag => tag[0] === 'e').map(tag => ({ id: tag[1] }));
      this.bookmarkEvents.set(bookmarksEvents);

      const bookmarksArticles = bookmarksEvent.tags.filter(tag => tag[0] === 'a').map(tag => ({ id: tag[1] }));
      this.bookmarkArticles.set(bookmarksArticles);

      const bookmarkUrls = bookmarksEvent.tags.filter(tag => tag[0] === 'r').map(tag => ({ id: tag[1] }));
      this.bookmarkUrls.set(bookmarkUrls);
    }
  }

  // Create a computed signal to track bookmarked status for notes
  bookmarkEventsStatus = computed(() => {
    const allBookmarks = this.bookmarkEvents();
    const statusMap: Record<string, boolean> = {};

    // Map all bookmarked IDs for efficient lookup
    allBookmarks.forEach(bookmark => {
      statusMap[bookmark.id] = true;
    });

    return statusMap;
  });

  // Create a computed signal for bookmark icons
  bookmarkEventsIcons = computed(() => {
    const statuses = this.bookmarkEventsStatus();
    const result: Record<string, string> = {};

    Object.keys(statuses).forEach(noteId => {
      result[noteId] = statuses[noteId] ? 'bookmark' : 'bookmark_border';
    });

    return result;
  });

  addBookmarkEvent(id: string) {
    const existingBookmark = this.bookmarkEvents().find(b => b.id === id);
    if (existingBookmark) {
      this.bookmarkEvents.update(bookmarks => bookmarks.filter(b => b.id !== id));
    } else {
      this.bookmarkEvents.update(bookmarks => [...bookmarks, { id }]);
    }
  }

  toggleBookmarkEvent(id: string) {
    const existingBookmark = this.bookmarkEvents().find(b => b.id === id);
    if (existingBookmark) {
      this.bookmarkEvents.update(bookmarks => bookmarks.filter(b => b.id !== id));
    } else {
      this.bookmarkEvents.update(bookmarks => [...bookmarks, { id }]);
    }
  }

  isBookmarkedEvent(id: string): boolean {
    return !!this.bookmarkEvents().find(b => b.id === id);
  }

  // Helper method to get tooltip text based on bookmark status
  getBookmarkEventTooltip(id: string): string {
    return this.bookmarkEventsStatus()[id] ? 'Remove bookmark' : 'Add bookmark';
  }

  // Helper method to get icon based on bookmark status
  getBookmarkEventIcon(id: string): string {
    return this.bookmarkEventsStatus()[id] ? 'bookmark' : 'bookmark_border';
  }
}
