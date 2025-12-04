import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { NostrService } from './nostr.service';
import { ApplicationService } from './application.service';
import { ApplicationStateService } from './application-state.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from './layout.service';
import { Event, kinds } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';

// Define bookmark types
export type BookmarkType = 'e' | 'a' | 'r' | 't';

export interface ArticleBookmark {
  kind: number;
  id: string;
  slug: string;
}

@Injectable({
  providedIn: 'root',
})
export class BookmarkService {
  accountRelay = inject(AccountRelayService);
  nostr = inject(NostrService);
  app = inject(ApplicationService);
  appState = inject(ApplicationStateService);
  accountState = inject(AccountStateService);
  snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);
  database = inject(DatabaseService);

  bookmarkEvent = signal<Event | null>(null);

  bookmarks = computed<any[]>(() => {
    return this.bookmarkEvent()?.tags.map(tag => ({ id: tag[1] })).reverse() || [];
  });

  bookmarkEvents = computed<any[]>(() => {
    return (
      this.bookmarkEvent()
        ?.tags.filter(tag => tag[0] === 'e')
        .map(tag => ({ id: tag[1] }))
        .reverse() || []
    );
  });

  bookmarkArticles = computed<any[]>(() => {
    return (
      this.bookmarkEvent()
        ?.tags.filter(tag => tag[0] === 'a')
        .map(tag => ({ id: tag[1] }))
        .reverse() || []
    );
  });

  bookmarkUrls = computed<any[]>(() => {
    return (
      this.bookmarkEvent()
        ?.tags.filter(tag => tag[0] === 'r')
        .map(tag => ({ id: tag[1] }))
        .reverse() || []
    );
  });

  constructor() {
    effect(async () => {
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.bookmarkEvent.set(null);
      }
    });
  }

  async initialize() {
    // Bookmark list (kind 10003) is already fetched in the consolidated account query
    // in nostr.service.ts, so we just load from storage
    const bookmarksEvent = await this.database.getEventByPubkeyAndKind(
      this.accountState.pubkey()!,
      kinds.BookmarkList
    );
    this.bookmarkEvent.set(bookmarksEvent);
  }

  // Helper to get the appropriate signal based on bookmark type
  getBookmarkSignal(type: BookmarkType) {
    switch (type) {
      case 'e':
        return this.bookmarkEvents;
      case 'a':
        return this.bookmarkArticles;
      case 'r':
        return this.bookmarkUrls;
      default:
        return this.bookmarkEvents; // Default to events
    }
  }

  parseArticleId(id: string) {
    const split = id.split(':');

    return {
      kind: parseInt(split[0], 10),
      id: split[1],
      slug: split[2] || '',
    };
  }

  async addBookmark(id: string, type: BookmarkType = 'e') {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    let event = this.bookmarkEvent();

    if (!event) {
      // Create a new bookmark event if none exists
      event = {
        kind: kinds.BookmarkList,
        pubkey: this.accountState.pubkey(),
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [],
        id: '',
        sig: '',
      };
    }

    const bookmarkId = id;

    // Check if the bookmark already exists
    const existingBookmark = this.bookmarks().find(b => b.id === bookmarkId);

    // If it exists, remove it; if not, add it
    if (existingBookmark) {
      // Remove from the bookmark event tags
      event.tags = event.tags.filter(tag => !(tag[0] === type && tag[1] === bookmarkId));
    } else {
      // Add to the bookmark event tags
      event.tags.push([type, bookmarkId]);
    }

    // Publish the updated event
    await this.publish(event);
  }

  toggleBookmark(id: string, type: BookmarkType = 'e') {
    this.addBookmark(id, type); // Add and toggle are the same operation
  }

  isBookmarked(id: string, type: BookmarkType = 'e'): boolean {
    const list = this.getBookmarkSignal(type)();
    return list.find(b => b.id === id);
  }

  // Helper method to get tooltip text based on bookmark status
  getBookmarkTooltip(id: string, type: BookmarkType = 'e'): string {
    return this.bookmarkEvents().find(b => b.id === id) ? 'Remove bookmark' : 'Add bookmark';
  }

  // Helper method to get icon based on bookmark status
  getBookmarkIcon(id: string, type: BookmarkType = 'e'): string {
    return this.bookmarkEvents().find(b => b.id === id) ? 'bookmark_remove' : 'bookmark_add';
  }

  async publish(event: Event) {
    if (!event) {
      return;
    }

    event.id = '';
    event.sig = '';
    event.created_at = Math.floor(Date.now() / 1000);

    // Sign the event
    const signedEvent = await this.nostr.signEvent(event);

    // Update the local bookmark event with the signed event
    this.bookmarkEvent.set(signedEvent);

    // Publish to relays and get array of promises
    const publishPromises = await this.accountRelay.publish(signedEvent);

    await this.layout.showPublishResults(publishPromises, 'Bookmark');

    try {
      // Wait for all publishing results
      const results = await Promise.all(publishPromises || []);

      // Count successes and failures
      const successful = results.filter(result => result === '').length;
      const failed = results.length - successful;

      // Display appropriate notification
      if (failed === 0) {
        this.snackBar.open(
          `Bookmarks saved successfully to ${successful} ${successful === 1 ? 'relay' : 'relays'}`,
          'Close',
          {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'success-snackbar',
          }
        );
      } else {
        this.snackBar.open(
          `Bookmarks saved to ${successful} ${successful === 1 ? 'relay' : 'relays'}, failed on ${failed} ${failed === 1 ? 'relay' : 'relays'}`,
          'Close',
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: failed > successful ? 'error-snackbar' : 'warning-snackbar',
          }
        );
      }
    } catch (error) {
      console.error('Error publishing bookmarks:', error);
      this.snackBar.open('Failed to save bookmarks', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: 'error-snackbar',
      });
    }
  }
}
