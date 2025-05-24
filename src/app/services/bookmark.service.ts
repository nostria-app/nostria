import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { RelayService } from './relay.service';
import { NostrService } from './nostr.service';
import { ApplicationService } from './application.service';
import { ApplicationStateService } from './application-state.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from './layout.service';
import { Event } from 'nostr-tools';

// Define bookmark types
export type BookmarkType = 'event' | 'article' | 'url';

@Injectable({
  providedIn: 'root'
})
export class BookmarkService {
  relay = inject(RelayService);
  nostr = inject(NostrService);
  app = inject(ApplicationService);
  appState = inject(ApplicationStateService);
  snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);

  bookmarkEvents = signal<any[]>([]);
  bookmarkArticles = signal<any[]>([]);
  bookmarkUrls = signal<any[]>([]);

  // Legacy computed properties for backward compatibility
  // bookmarkEventsStatus = computed(() => this.bookmarkStatus().event);
  // bookmarkEventsIcons = computed(() => this.bookmarkIcons().event);
  bookmarkEvent: Event | null = null;

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

  async addBookmark(id: string, type: BookmarkType = 'event') {
    const signal = this.getBookmarkSignal(type);
    const existingBookmark = signal().find(b => b.id === id);
    
    if (!this.bookmarkEvent) {
      // Create a new bookmark event if none exists
      this.bookmarkEvent = {
        kind: 10003,
        pubkey: this.appState.pubkey()!,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [],
        id: '',
        sig: ''
      };
    }
    
    // Get the appropriate tag prefix based on type
    const tagPrefix = this.getTagPrefix(type);
    
    if (existingBookmark) {
      // Remove from signal
      signal.update(bookmarks => bookmarks.filter(b => b.id !== id));
      
      // Remove from event tags
      if (this.bookmarkEvent) {
        this.bookmarkEvent.tags = this.bookmarkEvent.tags.filter(
          tag => !(tag[0] === tagPrefix && tag[1] === id)
        );
      }
    } else {
      // Add to signal
      signal.update(bookmarks => [...bookmarks, { id }]);
      
      // Add to event tags
      if (this.bookmarkEvent) {
        this.bookmarkEvent.tags.push([tagPrefix, id]);
      }
    }
    
    // Publish the updated event
    await this.publish();
  }

  toggleBookmark(id: string, type: BookmarkType = 'event') {
    this.addBookmark(id, type); // Add and toggle are the same operation
  }

  // Helper to get tag prefix based on bookmark type
  private getTagPrefix(type: BookmarkType): string {
    switch (type) {
      case 'event': return 'e';
      case 'article': return 'a';
      case 'url': return 'r';
      default: return 'e';
    }
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

  async publish() {
    if (!this.bookmarkEvent) {
      return;
    }
    
    // Clone the bookmark event and remove id and sig
    const eventToSign = { ...this.bookmarkEvent };
    eventToSign.id = '';
    eventToSign.sig = '';
    eventToSign.created_at = Math.floor(Date.now() / 1000);
    
    // Sign the event
    const signedEvent = await this.nostr.signEvent(eventToSign);
    
    // Update the local bookmark event with the signed event
    this.bookmarkEvent = signedEvent;
    
    // Publish to relays and get array of promises
    const publishPromises = await this.relay.publish(signedEvent);

    await this.layout.showPublishResults(publishPromises, 'Bookmark');
    
    try {
      // Wait for all publishing results
      const results = await Promise.all(publishPromises || []);
      
      // Count successes and failures
      const successful = results.filter(result => result === '').length;
      const failed = results.length - successful;
      
      // Display appropriate notification
      if (failed === 0) {
        this.snackBar.open(`Bookmarks saved successfully to ${successful} ${successful === 1 ? 'relay' : 'relays'}`, 'Close', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'success-snackbar'
        });
      } else {
        this.snackBar.open(
          `Bookmarks saved to ${successful} ${successful === 1 ? 'relay' : 'relays'}, failed on ${failed} ${failed === 1 ? 'relay' : 'relays'}`, 
          'Close', 
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: failed > successful ? 'error-snackbar' : 'warning-snackbar'
          }
        );
      }
    } catch (error) {
      console.error('Error publishing bookmarks:', error);
      this.snackBar.open('Failed to save bookmarks', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: 'error-snackbar'
      });
    }
  }
}
