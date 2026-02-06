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
import { EncryptionService } from './encryption.service';
import { UtilitiesService } from './utilities.service';

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
  originalEvent?: Event; // Original encrypted event for private lists
  isDefault: boolean; // true for kind 10003
  isPrivate: boolean; // true for encrypted lists
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
  encryption = inject(EncryptionService);
  private utilities = inject(UtilitiesService);

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
        isDefault: true,
        isPrivate: false
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
        // NIP-51 e-tag format: ["e", id, relay, pubkey]
        const relay = eventTags[i][2] || undefined;
        const pubkey = eventTags[i][3] || undefined;
        uniqueEvents.push({ id, relay, pubkey });
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
        // NIP-51 a-tag format: ["a", coordinates, relay]
        const relay = articleTags[i][2] || undefined;
        uniqueArticles.push({ id, relay });
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
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Load kind 10003 - default bookmarks
    const bookmarksEvent = await this.database.getEventByPubkeyAndKind(
      pubkey,
      kinds.BookmarkList
    );
    this.bookmarkEvent.set(bookmarksEvent);

    // Load kind 30003 - bookmark lists from database
    await this.loadBookmarkLists();

    // Subscribe to bookmark lists from relays
    await this.subscribeToBookmarkLists();
  }

  /** Pending reload timeout for debouncing */
  private pendingReload: ReturnType<typeof setTimeout> | null = null;

  /** Flag to track if reload is needed after EOSE */
  private needsReloadAfterEose = false;

  private async subscribeToBookmarkLists() {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Subscribe to kind 30003 bookmark lists
      this.accountRelay.subscribe(
        {
          kinds: [30003],
          authors: [pubkey],
        },
        async (event: Event) => {
          // Save to database
          const dTag = event.tags.find(t => t[0] === 'd')?.[1];
          if (dTag) {
            const wasSaved = await this.database.saveReplaceableEvent({ ...event, dTag });
            // Only schedule reload if the event was actually saved (newer than existing)
            if (wasSaved) {
              this.needsReloadAfterEose = true;
            }
          }
        },
        () => {
          console.log('🔖 End of stored bookmark lists (EOSE)');
          // Only reload if any new events were saved
          if (this.needsReloadAfterEose) {
            this.needsReloadAfterEose = false;
            this.scheduleReload();
          }
        }
      );
    } catch (error) {
      console.error('Failed to subscribe to bookmark lists:', error);
    }
  }

  /**
   * Schedule a debounced reload of bookmark lists
   * Prevents multiple rapid reloads when receiving many events
   */
  private scheduleReload() {
    // Cancel any pending reload
    if (this.pendingReload) {
      clearTimeout(this.pendingReload);
    }

    // Schedule reload after a short delay to batch multiple changes
    this.pendingReload = setTimeout(async () => {
      this.pendingReload = null;
      await this.loadBookmarkLists();
    }, 100);
  }

  /**
   * Load all bookmark lists from database and decrypt private ones
   * This is called on initialization and can be called again to retry failed decryptions
   */
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

    // Deduplicate by d-tag (keep only the latest event for each d-tag)
    const deduplicatedMap = new Map<string, Event>();
    for (const event of filteredEvents) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (!dTag) continue;

      const existing = deduplicatedMap.get(dTag);
      if (!existing || event.created_at > existing.created_at) {
        deduplicatedMap.set(dTag, event);
      }
    }

    const lists: BookmarkList[] = Array.from(deduplicatedMap.values()).map(event => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';

      // Per NIP-51: private lists have encrypted content, public lists have empty content
      const isPrivate = !!event.content && event.content.length > 0;

      const titleTag = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled List';

      // Don't decrypt content on load - only decrypt when user opens the list
      // This is more efficient and follows lazy loading pattern

      return {
        id: dTag,
        name: titleTag,
        event: event, // Store original event, will decrypt on-demand
        originalEvent: undefined, // Not needed - event already has original data
        isDefault: false,
        isPrivate: isPrivate
      };
    });

    console.log(`[BookmarkService] ✅ Loaded ${lists.length} bookmark lists (from ${events.length} events)`);
    this.bookmarkLists.set(lists);
  }

  /**
   * Decrypt and expand a private list's content when user selects it
   * This is called on-demand when switching to a private list
   */
  async decryptPrivateList(listId: string): Promise<void> {
    const list = this.bookmarkLists().find(l => l.id === listId);
    if (!list || !list.isPrivate || !list.event) {
      return; // Not a private list or no event
    }

    if (!list.event.content) {
      return; // No content to decrypt
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      console.error('[BookmarkService] No pubkey for decryption');
      return;
    }

    try {
      console.log(`[BookmarkService] Decrypting private list "${list.name}" (${listId})...`);
      const decryptedContent = await this.encryption.decryptNip44(list.event.content, pubkey);
      const bookmarks: [string, string][] = JSON.parse(decryptedContent);

      // Create a new event with decrypted bookmarks as tags
      const decryptedEvent: Event = {
        kind: list.event.kind,
        pubkey: list.event.pubkey,
        created_at: list.event.created_at,
        content: list.event.content,
        id: list.event.id,
        sig: list.event.sig,
        tags: [
          ...list.event.tags,
          ...bookmarks
        ]
      };

      // Update the list with the decrypted event
      const updatedLists = this.bookmarkLists().map(l =>
        l.id === listId
          ? { ...l, event: decryptedEvent }
          : l
      );
      this.bookmarkLists.set(updatedLists);

      console.log(`[BookmarkService] ✅ Decrypted ${bookmarks.length} bookmarks in list "${list.name}"`);
    } catch (error) {
      console.error(`[BookmarkService] ❌ Failed to decrypt private list "${list.name}":`, error);
    }
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

  async addBookmark(id: string, type: BookmarkType = 'e', listId?: string, relay?: string, pubkey?: string) {
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
    let isPrivateList = false;

    if (targetListId === 'default') {
      // Use kind 10003
      event = this.bookmarkEvent() || {
        kind: kinds.BookmarkList,
        pubkey: this.accountState.pubkey(),
        created_at: this.utilities.currentDate(),
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

      isPrivateList = list.isPrivate;

      event = list.event || {
        kind: 30003,
        pubkey: this.accountState.pubkey(),
        created_at: this.utilities.currentDate(),
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

    if (isPrivateList) {
      // For private lists, store bookmarks in encrypted content field
      let bookmarks: [string, string][] = [];

      // Decrypt existing content if present
      if (event.content) {
        try {
          const decryptedContent = await this.encryption.decryptNip44(event.content, userPubkey);
          bookmarks = JSON.parse(decryptedContent);
        } catch (error) {
          console.error('Failed to decrypt private list content:', error);
          bookmarks = [];
        }
      }

      // Check if bookmark exists
      const existingIndex = bookmarks.findIndex(b => b[0] === type && b[1] === bookmarkId);

      if (existingIndex !== -1) {
        // Remove existing bookmark
        bookmarks.splice(existingIndex, 1);
      } else {
        // Add new bookmark with relay/pubkey hints per NIP-51
        const entry: string[] = [type, bookmarkId];
        if (type === 'e') {
          // NIP-51 e-tag format: ["e", id, relay, pubkey]
          entry.push(relay || '', pubkey || '');
        } else if (type === 'a') {
          // NIP-51 a-tag format: ["a", coordinates, relay]
          if (relay) entry.push(relay);
        }
        bookmarks.push(entry as [string, string]);
      }

      // Encrypt and store in content
      const encryptedContent = await this.encryption.encryptNip44(JSON.stringify(bookmarks), userPubkey);
      event.content = encryptedContent;

    } else {
      // For public lists, use tags as before
      const existingBookmark = event.tags.find(tag => tag[0] === type && tag[1] === bookmarkId);

      if (existingBookmark) {
        // Remove from the bookmark event tags
        event.tags = event.tags.filter(tag => !(tag[0] === type && tag[1] === bookmarkId));
      } else {
        // Add to the bookmark event tags with relay/pubkey hints per NIP-51
        if (type === 'e') {
          // NIP-51 e-tag format: ["e", id, relay, pubkey]
          event.tags.push([type, bookmarkId, relay || '', pubkey || '']);
        } else if (type === 'a') {
          // NIP-51 a-tag format: ["a", coordinates, relay]
          const tag = [type, bookmarkId];
          if (relay) tag.push(relay);
          event.tags.push(tag);
        } else {
          event.tags.push([type, bookmarkId]);
        }
      }
    }

    // Publish the updated event
    await this.publish(event, targetListId);

    // If this was a private list, decrypt it immediately so the UI can show the updated state
    if (isPrivateList && targetListId !== 'default') {
      await this.decryptPrivateList(targetListId);
    }
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
    let isPrivate = false;

    if (targetListId === 'default') {
      event = this.bookmarkEvent();
    } else {
      const list = this.bookmarkLists().find(l => l.id === targetListId);
      event = list?.event || null;
      isPrivate = list?.isPrivate || false;
    }

    if (!event) {
      return false;
    }

    // For private lists, we can't check tags until decrypted
    // But after addBookmark, the event.content should be updated
    // So we need to decrypt and check the content
    if (isPrivate && event.content) {
      // We can't do async here, so we'll check if tags are populated (already decrypted)
      // If tags only have metadata (d, title, etc), it means not decrypted yet
      const hasBookmarkTags = event.tags.some(tag => tag[0] === 'e' || tag[0] === 'a' || tag[0] === 't');
      if (!hasBookmarkTags) {
        // Not decrypted yet, can't determine from UI sync
        // This is a limitation - private lists need to be selected/decrypted first
        return false;
      }
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
        isDefault: true,
        isPrivate: false
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

  async createBookmarkList(name: string, customId?: string, isPrivate = false): Promise<BookmarkList | null> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      await this.layout.showLoginDialog();
      return null;
    }

    // Use custom ID if provided, otherwise generate a timestamp-based one
    const dTag = customId || Date.now().toString();

    console.log(`[BookmarkService] Creating bookmark list "${name}", isPrivate: ${isPrivate}`);

    const tags: string[][] = [
      ['d', dTag],
      ['title', name] // Title is always plain text per NIP-51
    ];

    // Per NIP-51: private lists have encrypted content, public lists have empty content
    // For private lists, encrypt an empty array so the app knows it's private
    let content = '';
    if (isPrivate) {
      const emptyBookmarks: [string, string][] = [];
      content = await this.encryption.encryptNip44(JSON.stringify(emptyBookmarks), userPubkey);
      console.log(`[BookmarkService] Encrypted empty array for private list, content length: ${content.length}`);
    }

    const event: Event = {
      kind: 30003,
      pubkey: userPubkey,
      created_at: this.utilities.currentDate(),
      content: content,
      tags: tags,
      id: '',
      sig: '',
    };

    await this.publish(event, dTag);

    const newList: BookmarkList = {
      id: dTag,
      name: name, // Store decrypted name locally
      event: event,
      isDefault: false,
      isPrivate: isPrivate
    };

    return newList;
  }

  async updateBookmarkList(listId: string, name: string): Promise<void> {
    const list = this.bookmarkLists().find(l => l.id === listId);
    if (!list) {
      console.error('List not found:', listId);
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      console.error('No pubkey available');
      return;
    }

    if (!list.event) {
      console.error('No event available for list:', listId);
      return;
    }

    // For private lists, we need to use the original event with encrypted content
    // Remove any decrypted bookmark tags (they start with 'e', 'a', or 't')
    const cleanTags = list.event.tags.filter(tag =>
      tag[0] === 'd' || tag[0] === 'title' || tag[0] === 'description' || tag[0] === 'image'
    );

    // Create a new event with updated title
    const event = {
      ...list.event,
      tags: [...cleanTags]
    };

    // Per NIP-51: title is always plain text (in tags array, not encrypted)
    console.log(`[BookmarkService] Updating list ${listId}, isPrivate: ${list.isPrivate}, title is plain text per NIP-51`);

    // Update the title tag (always plain text)
    const titleTagIndex = event.tags.findIndex(t => t[0] === 'title');
    if (titleTagIndex !== -1) {
      event.tags[titleTagIndex] = ['title', name];
    } else {
      event.tags.push(['title', name]);
    }

    await this.publish(event, listId);
  }

  /**
   * Toggle a list between public and private
   * Public lists: bookmarks in tags array, empty content
   * Private lists: encrypted bookmarks in content field, tags only have metadata
   */
  async toggleListPrivacy(listId: string): Promise<void> {
    const list = this.bookmarkLists().find(l => l.id === listId);
    if (!list || !list.event) {
      console.error('List not found:', listId);
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      console.error('No pubkey available');
      return;
    }

    const newIsPrivate = !list.isPrivate;
    console.log(`[BookmarkService] Toggling list "${list.name}" (d-tag: ${listId}) from ${list.isPrivate ? 'private' : 'public'} to ${newIsPrivate ? 'private' : 'public'}`);

    // Extract bookmark tags (e, a, t)
    const bookmarkTags = list.event.tags.filter(tag =>
      tag[0] === 'e' || tag[0] === 'a' || tag[0] === 't'
    );

    // Extract metadata tags (d, title, description, image)
    const metadataTags = list.event.tags.filter(tag =>
      tag[0] === 'd' || tag[0] === 'title' || tag[0] === 'description' || tag[0] === 'image'
    );

    console.log(`[BookmarkService] Metadata tags:`, metadataTags);
    console.log(`[BookmarkService] Bookmark tags count: ${bookmarkTags.length}`);

    let newContent = '';
    let newTags = [...metadataTags];

    if (newIsPrivate) {
      // Moving from public to private: encrypt bookmarks into content
      // Always encrypt an array (even if empty) so the app knows it's private
      const bookmarksJson = JSON.stringify(bookmarkTags);
      newContent = await this.encryption.encryptNip44(bookmarksJson, pubkey);
      console.log(`[BookmarkService] Encrypted ${bookmarkTags.length} bookmarks, content length: ${newContent.length}`);
    } else {
      // Moving from private to public: decrypt content and put in tags
      if (list.event.content) {
        try {
          const decryptedContent = await this.encryption.decryptNip44(list.event.content, pubkey);
          const decryptedBookmarks: [string, string][] = JSON.parse(decryptedContent);
          newTags = [...metadataTags, ...decryptedBookmarks];
        } catch (error) {
          console.error('Failed to decrypt content:', error);
          return;
        }
      }
    }

    const event: Event = {
      kind: 30003,
      pubkey: list.event.pubkey,
      created_at: this.utilities.currentDate(),
      tags: newTags,
      content: newContent,
      id: '',
      sig: ''
    };

    console.log(`[BookmarkService] Publishing toggled list with ${newTags.length} tags, content length: ${newContent.length}`);
    await this.publish(event, listId);
    console.log(`[BookmarkService] ✅ List "${list.name}" is now ${newIsPrivate ? 'private' : 'public'}`);
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
      created_at: this.utilities.currentDate(),
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
    event.created_at = this.utilities.currentDate();

    // Sign the event
    const signedEvent = await this.nostr.signEvent(event);

    // Update the local state for default bookmarks only
    // For kind 30003, let the subscription handler update via loadBookmarkLists
    if (signedEvent.kind === kinds.BookmarkList) {
      this.bookmarkEvent.set(signedEvent);
    }

    // Save to local database immediately
    // Use saveReplaceableEvent for kind 30003 (parameterized replaceable) to ensure old versions are replaced
    if (signedEvent.kind === 30003) {
      const dTag = signedEvent.tags.find(t => t[0] === 'd')?.[1];
      console.log(`[BookmarkService] Saving replaceable event with d-tag: "${dTag}"`);
      await this.database.saveReplaceableEvent({ ...signedEvent, dTag });
      // Reload lists from database to update UI immediately
      await this.loadBookmarkLists();
    } else {
      await this.database.saveEvent(signedEvent);
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
