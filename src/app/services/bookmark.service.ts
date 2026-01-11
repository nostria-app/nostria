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

export interface BookmarkList {
  id: string; // d-tag value
  name: string; // title tag
  event: Event | null;
  isDefault: boolean; // true for kind 10003
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

  // Kind 10003 - default bookmarks event (single replaceable)
  bookmarkEvent = signal<Event | null>(null);

  // Kind 30003 - bookmark lists (parameterized replaceable events)
  bookmarkLists = signal<BookmarkList[]>([]);

  // Currently selected bookmark list
  selectedListId = signal<string>('default');

  // Get the currently active bookmark list event
  activeBookmarkEvent = computed<Event | null>(() => {
    const listId = this.selectedListId();
    if (listId === 'default') {
      return this.bookmarkEvent();
    }

    const list = this.bookmarkLists().find(l => l.id === listId);
    return list?.event || null;
  });

  // All bookmark lists including the default one
  allBookmarkLists = computed<BookmarkList[]>(() => {
    const lists: BookmarkList[] = [];

    // Add default bookmark list
    const defaultEvent = this.bookmarkEvent();
    if (defaultEvent) {
      lists.push({
        id: 'default',
        name: 'Bookmarks',
        event: defaultEvent,
        isDefault: true
      });
    }

    // Add custom bookmark lists
    lists.push(...this.bookmarkLists());

    return lists;
  });

  bookmarks = computed<any[]>(() => {
    return this.activeBookmarkEvent()?.tags.map(tag => ({ id: tag[1] })).reverse() || [];
  });

  bookmarkEvents = computed<any[]>(() => {
    const event = this.activeBookmarkEvent();
    if (!event) return [];

    // Filter for 'e' tags and deduplicate by ID
    const eventTags = event.tags.filter(tag => tag[0] === 'e');
    const uniqueIds = new Set<string>();
    const uniqueEvents: any[] = [];

    // Reverse first to keep the most recent bookmarks
    for (let i = eventTags.length - 1; i >= 0; i--) {
      const id = eventTags[i][1];
      if (!uniqueIds.has(id)) {
        uniqueIds.add(id);
        uniqueEvents.push({ id });
      }
    }

    return uniqueEvents;
  });

  bookmarkArticles = computed<any[]>(() => {
    const event = this.activeBookmarkEvent();
    if (!event) return [];

    // Filter for 'a' tags and deduplicate by ID
    const articleTags = event.tags.filter(tag => tag[0] === 'a');
    const uniqueIds = new Set<string>();
    const uniqueArticles: any[] = [];

    // Reverse first to keep the most recent bookmarks
    for (let i = articleTags.length - 1; i >= 0; i--) {
      const id = articleTags[i][1];
      if (!uniqueIds.has(id)) {
        uniqueIds.add(id);
        uniqueArticles.push({ id });
      }
    }

    return uniqueArticles;
  });

  bookmarkUrls = computed<any[]>(() => {
    const event = this.activeBookmarkEvent();
    if (!event) return [];

    // Filter for 'r' tags and deduplicate by ID
    const urlTags = event.tags.filter(tag => tag[0] === 'r');
    const uniqueIds = new Set<string>();
    const uniqueUrls: any[] = [];

    // Reverse first to keep the most recent bookmarks
    for (let i = urlTags.length - 1; i >= 0; i--) {
      const id = urlTags[i][1];
      if (!uniqueIds.has(id)) {
        uniqueIds.add(id);
        uniqueUrls.push({ id });
      }
    }

    return uniqueUrls;
  });

  constructor() {
    effect(async () => {
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.bookmarkEvent.set(null);
        this.bookmarkLists.set([]);
      }
    });
  }

  async initialize() {
    // Load kind 10003 - default bookmarks
    const bookmarksEvent = await this.database.getEventByPubkeyAndKind(
      this.accountState.pubkey()!,
      kinds.BookmarkList
    );
    this.bookmarkEvent.set(bookmarksEvent);

    // Load kind 30003 - bookmark lists
    await this.loadBookmarkLists();
  }

  async loadBookmarkLists() {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    // Query for all bookmark lists (kind 30003)
    const events = await this.database.getEventsByPubkeyAndKind(pubkey, 30003);

    // Filter out YouTube bookmarks (they have a 't' tag with 'youtube')
    const filteredEvents = events.filter(event => {
      const tTags = event.tags.filter(t => t[0] === 't');
      return !tTags.some(t => t[1] === 'youtube');
    });

    const lists: BookmarkList[] = filteredEvents.map(event => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const titleTag = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled List';

      return {
        id: dTag,
        name: titleTag,
        event: event,
        isDefault: false
      };
    });

    this.bookmarkLists.set(lists);
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

  async addBookmark(id: string, type: BookmarkType = 'e', listId?: string) {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const targetListId = listId || this.selectedListId();
    let event: Event;

    if (targetListId === 'default') {
      // Use kind 10003
      event = this.bookmarkEvent() || {
        kind: kinds.BookmarkList,
        pubkey: this.accountState.pubkey(),
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [],
        id: '',
        sig: '',
      };
    } else {
      // Use kind 30003
      const list = this.bookmarkLists().find(l => l.id === targetListId);
      if (!list) {
        this.snackBar.open('Bookmark list not found', 'Close', { duration: 3000 });
        return;
      }

      event = list.event || {
        kind: 30003,
        pubkey: this.accountState.pubkey(),
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [
          ['d', targetListId],
          ['title', list.name]
        ],
        id: '',
        sig: '',
      };
    }

    const bookmarkId = id;

    // Check if the bookmark already exists
    const existingBookmark = event.tags.find(tag => tag[0] === type && tag[1] === bookmarkId);

    // If it exists, remove it; if not, add it
    if (existingBookmark) {
      // Remove from the bookmark event tags
      event.tags = event.tags.filter(tag => !(tag[0] === type && tag[1] === bookmarkId));
    } else {
      // Add to the bookmark event tags
      event.tags.push([type, bookmarkId]);
    }

    // Publish the updated event
    await this.publish(event, targetListId);
  }

  async addBookmarkToList(id: string, type: BookmarkType, listId: string) {
    return this.addBookmark(id, type, listId);
  }

  toggleBookmark(id: string, type: BookmarkType = 'e', listId?: string) {
    this.addBookmark(id, type, listId); // Add and toggle are the same operation
  }

  isBookmarked(id: string, type: BookmarkType = 'e', listId?: string): boolean {
    const targetListId = listId || this.selectedListId();
    let event: Event | null;

    if (targetListId === 'default') {
      event = this.bookmarkEvent();
    } else {
      const list = this.bookmarkLists().find(l => l.id === targetListId);
      event = list?.event || null;
    }

    if (!event) {
      return false;
    }

    return event.tags.some(tag => tag[0] === type && tag[1] === id);
  }

  // Check if item is bookmarked in ANY list
  isBookmarkedInAnyList(id: string, type: BookmarkType = 'e'): boolean {
    // Check default list
    if (this.bookmarkEvent()?.tags.some(tag => tag[0] === type && tag[1] === id)) {
      return true;
    }

    // Check all custom lists
    return this.bookmarkLists().some(list =>
      list.event?.tags.some(tag => tag[0] === type && tag[1] === id)
    );
  }

  // Get all lists that contain this bookmark
  getListsContainingBookmark(id: string, type: BookmarkType = 'e'): BookmarkList[] {
    const lists: BookmarkList[] = [];

    // Check default list
    if (this.bookmarkEvent()?.tags.some(tag => tag[0] === type && tag[1] === id)) {
      lists.push({
        id: 'default',
        name: 'Bookmarks',
        event: this.bookmarkEvent(),
        isDefault: true
      });
    }

    // Check custom lists
    this.bookmarkLists().forEach(list => {
      if (list.event?.tags.some(tag => tag[0] === type && tag[1] === id)) {
        lists.push(list);
      }
    });

    return lists;
  }

  // Helper method to get tooltip text based on bookmark status
  getBookmarkTooltip(id: string, type: BookmarkType = 'e'): string {
    return this.bookmarkEvents().find(b => b.id === id) ? 'Remove bookmark' : 'Add bookmark';
  }

  // Helper method to get icon based on bookmark status
  getBookmarkIcon(id: string, type: BookmarkType = 'e'): string {
    return this.isBookmarkedInAnyList(id, type) ? 'bookmark_remove' : 'bookmark_add';
  }

  async createBookmarkList(name: string): Promise<BookmarkList | null> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      await this.layout.showLoginDialog();
      return null;
    }

    // Generate a unique d-tag
    const dTag = Date.now().toString();

    const event: Event = {
      kind: 30003,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['d', dTag],
        ['title', name]
      ],
      id: '',
      sig: '',
    };

    await this.publish(event, dTag);

    const newList: BookmarkList = {
      id: dTag,
      name: name,
      event: event,
      isDefault: false
    };

    return newList;
  }

  async updateBookmarkList(listId: string, name: string): Promise<void> {
    const list = this.bookmarkLists().find(l => l.id === listId);
    if (!list || !list.event) {
      return;
    }

    const event = { ...list.event };

    // Update the title tag
    const titleTagIndex = event.tags.findIndex(t => t[0] === 'title');
    if (titleTagIndex !== -1) {
      event.tags[titleTagIndex] = ['title', name];
    } else {
      event.tags.push(['title', name]);
    }

    await this.publish(event, listId);
  }

  async deleteBookmarkList(listId: string): Promise<void> {
    const list = this.bookmarkLists().find(l => l.id === listId);
    if (!list || !list.event) {
      return;
    }

    // Create a deletion event (kind 5)
    const deletionEvent: Event = {
      kind: 5,
      pubkey: this.accountState.pubkey()!,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Deleted bookmark list',
      tags: [
        ['a', `30003:${this.accountState.pubkey()}:${listId}`]
      ],
      id: '',
      sig: '',
    };

    const signedEvent = await this.nostr.signEvent(deletionEvent);
    const publishPromises = await this.accountRelay.publish(signedEvent);
    await Promise.all(publishPromises || []);

    // Remove from local state
    this.bookmarkLists.set(this.bookmarkLists().filter(l => l.id !== listId));

    // If this was the selected list, switch to default
    if (this.selectedListId() === listId) {
      this.selectedListId.set('default');
    }
  }

  async publish(event: Event, listId?: string) {
    if (!event) {
      return;
    }

    event.id = '';
    event.sig = '';
    event.created_at = Math.floor(Date.now() / 1000);

    // Sign the event
    const signedEvent = await this.nostr.signEvent(event);

    // Update the local state based on event kind
    if (signedEvent.kind === kinds.BookmarkList) {
      this.bookmarkEvent.set(signedEvent);
    } else if (signedEvent.kind === 30003) {
      const dTag = signedEvent.tags.find(t => t[0] === 'd')?.[1] || '';
      const titleTag = signedEvent.tags.find(t => t[0] === 'title')?.[1] || 'Untitled List';

      const updatedList: BookmarkList = {
        id: dTag,
        name: titleTag,
        event: signedEvent,
        isDefault: false
      };

      const existingIndex = this.bookmarkLists().findIndex(l => l.id === dTag);
      if (existingIndex !== -1) {
        const lists = [...this.bookmarkLists()];
        lists[existingIndex] = updatedList;
        this.bookmarkLists.set(lists);
      } else {
        this.bookmarkLists.set([...this.bookmarkLists(), updatedList]);
      }
    }

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
