import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Event, kinds } from 'nostr-tools';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { NostrService } from '../../services/nostr.service';
import { PublishService } from '../../services/publish.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { EncryptionService } from '../../services/encryption.service';
import { DatabaseService } from '../../services/database.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { ListEditorDialogComponent } from './list-editor-dialog/list-editor-dialog.component';

// NIP-51 List type definitions
export interface ListType {
  kind: number;
  name: string;
  description: string;
  icon: string;
  isReplaceable: boolean; // true for 10000 series, false for 30000 series (sets)
  expectedTags: string[];
}

export interface ListItem {
  tag: string; // 'p', 'e', 'a', 't', 'r', etc.
  value: string;
  relay?: string;
  pubkey?: string; // For 'e' tags: author's pubkey (4th element)
  marker?: string; // For other tags that use markers
  metadata?: string; // petname for 'p' tags, etc.
}

export interface ListData {
  event: Event;
  type: ListType;
  title?: string;
  description?: string;
  image?: string;
  identifier?: string; // d-tag for sets
  publicItems: ListItem[];
  privateItems: ListItem[];
  created: number;
}

// NIP-51 Standard Lists (10000 series - replaceable, single per kind)
const STANDARD_LISTS: ListType[] = [
  {
    kind: 10000,
    name: 'Mute List',
    description: 'Users and content you don\'t want to see',
    icon: 'block',
    isReplaceable: true,
    expectedTags: ['p', 't', 'word', 'e'],
  },
  {
    kind: 10001,
    name: 'Pinned Notes',
    description: 'Events showcased on your profile',
    icon: 'push_pin',
    isReplaceable: true,
    expectedTags: ['e'],
  },
  {
    kind: 10002,
    name: 'Read/Write Relays',
    description: 'Where you publish and expect mentions (NIP-65)',
    icon: 'router',
    isReplaceable: true,
    expectedTags: ['r'], // NIP-65: uses 'r' tags, not 'relay'
  },
  {
    kind: 10003,
    name: 'Bookmarks',
    description: 'Saved notes, articles, hashtags, and URLs',
    icon: 'bookmark',
    isReplaceable: true,
    expectedTags: ['e', 'a', 't', 'r'],
  },
  {
    kind: 10004,
    name: 'Communities',
    description: 'NIP-72 communities you belong to',
    icon: 'groups',
    isReplaceable: true,
    expectedTags: ['a'],
  },
  {
    kind: 10005,
    name: 'Public Chats',
    description: 'NIP-28 chat channels you\'re in',
    icon: 'chat',
    isReplaceable: true,
    expectedTags: ['e'],
  },
  {
    kind: 10006,
    name: 'Blocked Relays',
    description: 'Relays clients should never connect to',
    icon: 'block',
    isReplaceable: true,
    expectedTags: ['relay'],
  },
  {
    kind: 10007,
    name: 'Search Relays',
    description: 'Relays to use when performing searches',
    icon: 'search',
    isReplaceable: true,
    expectedTags: ['relay'],
  },
  {
    kind: 10009,
    name: 'Simple Groups',
    description: 'NIP-29 groups you\'re in',
    icon: 'group_work',
    isReplaceable: true,
    expectedTags: ['group', 'r'],
  },
  {
    kind: 10012,
    name: 'Relay Feeds',
    description: 'Favorite browsable relays and relay sets',
    icon: 'rss_feed',
    isReplaceable: true,
    expectedTags: ['relay', 'a'],
  },
  {
    kind: 10015,
    name: 'Interests',
    description: 'Topics and interest sets',
    icon: 'interests',
    isReplaceable: true,
    expectedTags: ['t', 'a'],
  },
  {
    kind: 10020,
    name: 'Media Follows',
    description: 'Multimedia (photos, short video) follow list',
    icon: 'perm_media',
    isReplaceable: true,
    expectedTags: ['p'],
  },
  {
    kind: 10030,
    name: 'Emojis',
    description: 'Preferred emojis and emoji sets',
    icon: 'emoji_emotions',
    isReplaceable: true,
    expectedTags: ['emoji', 'a'],
  },
  {
    kind: 10050,
    name: 'DM Relays',
    description: 'Where to receive NIP-17 direct messages',
    icon: 'mail',
    isReplaceable: true,
    expectedTags: ['relay'],
  },
  {
    kind: 10101,
    name: 'Good Wiki Authors',
    description: 'Recommended NIP-54 wiki authors',
    icon: 'article',
    isReplaceable: true,
    expectedTags: ['p'],
  },
  {
    kind: 10102,
    name: 'Good Wiki Relays',
    description: 'Relays with useful wiki articles',
    icon: 'library_books',
    isReplaceable: true,
    expectedTags: ['relay'],
  },
];

// NIP-51 Sets (30000 series - parameterized replaceable, multiple per kind)
const LIST_SETS: ListType[] = [
  {
    kind: 30000,
    name: 'Follow Sets',
    description: 'Categorized groups of users',
    icon: 'people',
    isReplaceable: false,
    expectedTags: ['p'],
  },
  {
    kind: 30002,
    name: 'Relay Sets',
    description: 'User-defined relay groups',
    icon: 'hub',
    isReplaceable: false,
    expectedTags: ['relay'],
  },
  {
    kind: 30003,
    name: 'Bookmark Sets',
    description: 'Categorized bookmarks',
    icon: 'bookmarks',
    isReplaceable: false,
    expectedTags: ['e', 'a', 't', 'r'],
  },
  {
    kind: 30004,
    name: 'Curation Sets (Articles)',
    description: 'Curated articles and notes',
    icon: 'collections',
    isReplaceable: false,
    expectedTags: ['a', 'e'],
  },
  {
    kind: 30005,
    name: 'Curation Sets (Videos)',
    description: 'Curated video collections',
    icon: 'video_library',
    isReplaceable: false,
    expectedTags: ['e'],
  },
  {
    kind: 30006,
    name: 'Curation Sets (Pictures)',
    description: 'Curated image and photo collections',
    icon: 'photo_library',
    isReplaceable: false,
    expectedTags: ['e'],
  },
  {
    kind: 30015,
    name: 'Interest Sets',
    description: 'Interest topics by hashtags',
    icon: 'label',
    isReplaceable: false,
    expectedTags: ['t'],
  },
  {
    kind: 30030,
    name: 'Emoji Sets',
    description: 'Categorized emoji groups',
    icon: 'emoji_emotions',
    isReplaceable: false,
    expectedTags: ['emoji'],
  },
  {
    kind: 31924,
    name: 'Calendar Sets',
    description: 'Categorized calendar events',
    icon: 'event',
    isReplaceable: false,
    expectedTags: ['a'],
  },
  {
    kind: 39089,
    name: 'Starter Packs',
    description: 'Named set of profiles to follow together',
    icon: 'group_add',
    isReplaceable: false,
    expectedTags: ['p'],
  },
  {
    kind: 39092,
    name: 'Media Starter Packs',
    description: 'Multimedia (photos, video) profile sets',
    icon: 'collections',
    isReplaceable: false,
    expectedTags: ['p'],
  },
];

@Component({
  selector: 'app-lists',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './lists.component.html',
  styleUrl: './lists.component.scss',
})
export class ListsComponent implements OnInit {
  private readonly accountState = inject(AccountStateService);
  private readonly data = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly publish = inject(PublishService);
  private readonly utilities = inject(UtilitiesService);
  private readonly encryption = inject(EncryptionService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly database = inject(DatabaseService);
  private readonly followSetsService = inject(FollowSetsService);

  // Available list types
  standardLists = STANDARD_LISTS;
  listSets = LIST_SETS;

  // State
  loading = signal(false);
  selectedTab = signal(0); // 0 = standard lists, 1 = sets
  selectedKind = signal<number | undefined>(undefined); // Filter by specific kind
  private isLoadingLists = false; // Guard to prevent overlapping loads

  // Loaded lists data
  standardListsData = signal<Map<number, ListData>>(new Map());
  setsData = signal<Map<number, ListData[]>>(new Map()); // Multiple sets per kind

  // Computed
  pubkey = computed(() => this.accountState.pubkey());

  constructor() {
    // Effect to reload lists when account changes
    effect(() => {
      const pubkey = this.pubkey();

      // Clear existing lists first
      this.standardListsData.set(new Map());
      this.setsData.set(new Map());

      // Reload lists for the new account (don't await - let it run in background)
      if (pubkey) {
        this.loadAllLists();
      } else {
        // No pubkey, ensure loading is false
        this.loading.set(false);
        this.isLoadingLists = false;
      }
    });
  }

  async ngOnInit() {
    // Lists are loaded automatically by the effect when pubkey is available
    // No need to call loadAllLists here

    // Add to window for debugging
    if (typeof window !== 'undefined') {
      (window as unknown as { listComponent?: ListsComponent }).listComponent = this;
    }

    // Check for query parameters to set initial tab and filter
    const queryParams = new URLSearchParams(window.location.search);
    const tab = queryParams.get('tab');
    const kind = queryParams.get('kind');

    if (tab === 'sets') {
      this.selectedTab.set(1);
    }

    if (kind) {
      const kindNumber = parseInt(kind, 10);
      if (!isNaN(kindNumber)) {
        this.selectedKind.set(kindNumber);
      }
    }
  }

  /**
   * Helper to wrap promises with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Load all lists for the current user
   */
  async loadAllLists() {
    const pubkey = this.pubkey();
    if (!pubkey) {
      this.logger.warn('[ListsComponent] No pubkey available');
      this.loading.set(false);
      this.isLoadingLists = false;
      return;
    }

    // Prevent overlapping loads
    if (this.isLoadingLists) {
      this.logger.warn('[ListsComponent] Already loading lists, skipping duplicate call');
      return;
    }

    this.logger.info('[ListsComponent] Starting to load lists for pubkey:', pubkey);
    this.isLoadingLists = true;
    this.loading.set(true);

    // Set a maximum timeout for the entire load operation (30 seconds)
    // const timeoutId = setTimeout(() => {
    //   if (this.isLoadingLists) {
    //     this.logger.error('[ListsComponent] Load operation timed out after 30 seconds');
    //     this.isLoadingLists = false;
    //     this.loading.set(false);
    //     this.snackBar.open('Failed to load lists (timeout)', 'Close', { duration: 5000 });
    //   }
    // }, 30000);

    try {
      // Load standard lists (10000 series) and sets (30000 series) in parallel
      this.logger.info('[ListsComponent] Loading lists and sets...');

      await Promise.all([
        this.loadStandardLists(pubkey),
        this.loadSets(pubkey)
      ]);

      this.logger.info('[ListsComponent] All lists loaded successfully');
    } catch (error) {
      this.logger.error('[ListsComponent] Error loading lists', error);
      this.snackBar.open('Failed to load lists', 'Close', { duration: 3000 });
    } finally {
      // clearTimeout(timeoutId); // Clear the timeout if we complete normally
      this.logger.info('[ListsComponent] Setting loading to false');
      this.isLoadingLists = false;
      this.loading.set(false);
    }
  }

  /**
   * Load standard replaceable lists (10000 series)
   */
  private async loadStandardLists(pubkey: string) {
    this.logger.debug(`[ListsComponent] Loading standard lists for ${STANDARD_LISTS.length} types`);

    // Reset to empty map to start fresh
    this.standardListsData.set(new Map<number, ListData>());

    for (const listType of STANDARD_LISTS) {
      try {
        this.logger.debug(`[ListsComponent] Loading standard list kind ${listType.kind}`);

        // Add timeout to prevent hanging on individual fetches
        const record = await this.withTimeout(
          this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
            save: true,
            cache: true,
          }),
          10000, // 10 second timeout per fetch
          `Loading standard list kind ${listType.kind}`
        );

        if (record?.event) {
          this.logger.debug(`[ListsComponent] Found event for kind ${listType.kind}, parsing...`);
          const listData = await this.parseListEvent(record.event, listType);
          if (listData) {
            // Update signal incrementally
            this.standardListsData.update(map => {
              const newMap = new Map(map);
              newMap.set(listType.kind, listData);
              return newMap;
            });
            this.logger.debug(`[ListsComponent] Successfully parsed list for kind ${listType.kind}`);
          }
        } else {
          this.logger.debug(`[ListsComponent] No event found for kind ${listType.kind}`);
        }
      } catch (error) {
        this.logger.debug(`[ListsComponent] Error loading list for kind ${listType.kind}:`, error);
      }
    }
  }

  /**
   * Load parameterized replaceable sets (30000 series)
   */
  private async loadSets(pubkey: string) {
    this.logger.debug(`[ListsComponent] Loading sets for ${LIST_SETS.length} types`);

    // Reset to empty map to start fresh
    this.setsData.set(new Map<number, ListData[]>());

    for (const listType of LIST_SETS) {
      try {
        this.logger.debug(`[ListsComponent] Loading sets for kind ${listType.kind}`);

        // Add timeout to prevent hanging on individual fetches
        const records = await this.withTimeout(
          this.data.getEventsByPubkeyAndKind(pubkey, listType.kind, {
            save: true,
            cache: true,
          }),
          10000, // 10 second timeout per fetch
          `Loading sets for kind ${listType.kind}`
        );

        if (records && records.length > 0) {
          this.logger.debug(`[ListsComponent] Found ${records.length} records for kind ${listType.kind}`);
          const setsMap = new Map<string, ListData>(); // Use map to deduplicate by identifier

          for (const record of records) {
            if (record.event) {
              this.logger.debug(`[ListsComponent] Parsing set event for kind ${listType.kind}`);
              const listData = await this.parseListEvent(record.event, listType);
              if (listData) {
                const identifier = listData.identifier || '';
                const existing = setsMap.get(identifier);

                // For parameterized replaceable events, keep only the newest
                if (!existing || listData.created > existing.created) {
                  setsMap.set(identifier, listData);
                }
              }
            }
          }

          const sets = Array.from(setsMap.values());
          if (sets.length > 0) {
            // Update signal incrementally
            this.setsData.update(map => {
              const newMap = new Map(map);
              newMap.set(listType.kind, sets);
              return newMap;
            });
            this.logger.debug(`[ListsComponent] Added ${sets.length} sets for kind ${listType.kind} (deduplicated from ${records.length} records)`);
          }
        } else {
          this.logger.debug(`[ListsComponent] No records found for kind ${listType.kind}`);
        }
      } catch (error) {
        this.logger.debug(`[ListsComponent] Error loading sets for kind ${listType.kind}:`, error);
      }
    }
  }

  /**
   * Parse a list event into structured data
   */
  private async parseListEvent(event: Event, type: ListType): Promise<ListData | null> {
    try {
      this.logger.debug(`[ListsComponent] Parsing list event ${event.id} for kind ${type.kind}`);

      // Parse public items from tags
      this.logger.debug(`[ListsComponent] Parsing public items from ${event.tags.length} tags`);
      const publicItems = this.parsePublicItems(event.tags);
      this.logger.debug(`[ListsComponent] Found ${publicItems.length} public items`);

      // Parse private items from encrypted content (if any)
      this.logger.debug(`[ListsComponent] Parsing private items from content: ${event.content.substring(0, 50)}...`);
      const privateItems = await this.parsePrivateItems(event.content);
      this.logger.debug(`[ListsComponent] Found ${privateItems.length} private items`);

      // Extract metadata
      const title = event.tags.find(t => t[0] === 'title')?.[1];
      const description = event.tags.find(t => t[0] === 'description')?.[1];
      const image = event.tags.find(t => t[0] === 'image')?.[1];
      const identifier = event.tags.find(t => t[0] === 'd')?.[1];

      this.logger.debug(`[ListsComponent] Successfully parsed list event ${event.id}`);
      return {
        event,
        type,
        title,
        description,
        image,
        identifier,
        publicItems,
        privateItems,
        created: event.created_at,
      };
    } catch (error) {
      this.logger.error('[ListsComponent] Error parsing list event', error);
      return null;
    }
  }

  /**
   * Parse public items from event tags
   */
  private parsePublicItems(tags: string[][]): ListItem[] {
    const items: ListItem[] = [];

    for (const tag of tags) {
      if (tag.length < 2) continue;

      const [tagName, value, relay, marker, metadata] = tag;

      // Skip metadata tags
      if (['d', 'title', 'description', 'image', 'alt'].includes(tagName)) {
        continue;
      }

      // Skip chat metadata entries (likely application data that shouldn't be displayed)
      if (value?.includes('chats/') && value?.includes('/lastOpened')) {
        this.logger.debug('[ListsComponent] Skipping chat metadata entry:', value);
        continue;
      }

      // Skip other common application metadata patterns
      if (value?.startsWith('app:') || value?.startsWith('metadata:')) {
        this.logger.debug('[ListsComponent] Skipping application metadata entry:', value);
        continue;
      }

      // Parse item based on tag type
      // For 'e' tags: ["e", <event-id>, <relay-url>, <pubkey>]
      // For other tags: ["tag", <value>, <relay>, <marker>, <metadata>]
      if (tagName === 'e') {
        items.push({
          tag: tagName,
          value,
          relay,
          pubkey: marker, // 4th element is pubkey for 'e' tags
        });
      } else {
        items.push({
          tag: tagName,
          value,
          relay,
          marker,
          metadata,
        });
      }
    }

    return items;
  }

  /**
   * Parse private items from encrypted content
   */
  private async parsePrivateItems(content: string): Promise<ListItem[]> {
    if (!content || content.trim() === '') {
      this.logger.debug('[ListsComponent] No content to decrypt');
      return [];
    }

    this.logger.debug('[ListsComponent] Checking if content is encrypted...');
    // Check if content appears to be encrypted before attempting decryption
    try {
      const isEncrypted = this.encryption.isContentEncrypted(content);
      if (!isEncrypted) {
        this.logger.debug('[ListsComponent] Content does not appear to be encrypted, skipping decryption');
        return [];
      }
      this.logger.debug('[ListsComponent] Content appears to be encrypted, attempting decryption');
    } catch (error) {
      this.logger.error('[ListsComponent] Error checking if content is encrypted:', error);
      return [];
    }

    try {
      const pubkey = this.pubkey();
      if (!pubkey) {
        this.logger.debug('[ListsComponent] No pubkey available for decryption');
        return [];
      }

      // Add timeout to prevent hanging
      const decryptionPromise = this.attemptDecryption(content, pubkey);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Decryption timeout')), 10000); // 10 second timeout
      });

      let decrypted: string;
      try {
        decrypted = await Promise.race([decryptionPromise, timeoutPromise]);
        this.logger.debug('[ListsComponent] Successfully decrypted content');
      } catch (error) {
        this.logger.debug('[ListsComponent] Could not decrypt private items:', error);
        return [];
      }

      // Parse the decrypted JSON array of tags
      const privateTags: string[][] = JSON.parse(decrypted);
      const items = this.parsePublicItems(privateTags);
      this.logger.debug(`[ListsComponent] Parsed ${items.length} private items`);
      return items;
    } catch (error) {
      this.logger.error('[ListsComponent] Error parsing private items', error);
      return [];
    }
  }

  /**
   * Attempt to decrypt content with both NIP-44 and NIP-04
   */
  private async attemptDecryption(content: string, pubkey: string): Promise<string> {
    // Try to decrypt the content using NIP-44
    try {
      this.logger.debug('[ListsComponent] Attempting NIP-44 decryption...');
      return await this.encryption.decryptNip44(content, pubkey);
    } catch (nip44Error) {
      this.logger.debug('[ListsComponent] NIP-44 decryption failed, trying NIP-04...', nip44Error);
      // Fallback to NIP-04 for backward compatibility
      try {
        return await this.encryption.decryptNip04(content, pubkey);
      } catch (nip04Error) {
        this.logger.debug('[ListsComponent] NIP-04 decryption also failed', nip04Error);
        throw new Error('Both NIP-44 and NIP-04 decryption failed');
      }
    }
  }

  /**
   * Create a new list
   */
  async createList(listType: ListType) {
    const pubkey = this.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please connect your account first', 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ListEditorDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: {
        listType,
        mode: 'create',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      await this.saveList(result);
    }
  }

  /**
   * Edit an existing list
   */
  async editList(listData: ListData) {
    const pubkey = this.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please connect your account first', 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ListEditorDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: {
        listType: listData.type,
        listData,
        mode: 'edit',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      await this.saveList(result);
    }
  }

  /**
   * Save a list (create or update)
   */
  private async saveList(data: {
    listType: ListType;
    title?: string;
    description?: string;
    image?: string;
    identifier?: string;
    publicItems: ListItem[];
    privateItems: ListItem[];
  }) {
    const pubkey = this.pubkey();
    if (!pubkey) return;

    this.loading.set(true);

    try {
      const { listType, title, description, image, identifier, publicItems, privateItems } = data;

      // Build tags
      const tags: string[][] = [];

      // Add identifier for sets (30000 series)
      if (!listType.isReplaceable && identifier) {
        tags.push(['d', identifier]);
      }

      // Add metadata tags
      if (title) tags.push(['title', title]);
      if (description) tags.push(['description', description]);
      if (image) tags.push(['image', image]);

      // Add public items
      for (const item of publicItems) {
        const tag = [item.tag, item.value];
        if (item.relay) tag.push(item.relay);
        // For 'e' tags, the 4th element is pubkey
        if (item.tag === 'e') {
          if (item.pubkey) tag.push(item.pubkey);
        } else {
          if (item.marker) tag.push(item.marker);
          if (item.metadata) tag.push(item.metadata);
        }
        tags.push(tag);
      }

      // Encrypt private items if any
      let content = '';
      if (privateItems && privateItems.length > 0) {
        const privateTags: string[][] = [];
        for (const item of privateItems) {
          const tag = [item.tag, item.value];
          if (item.relay) tag.push(item.relay);
          // For 'e' tags, the 4th element is pubkey
          if (item.tag === 'e') {
            if (item.pubkey) tag.push(item.pubkey);
          } else {
            if (item.marker) tag.push(item.marker);
            if (item.metadata) tag.push(item.metadata);
          }
          privateTags.push(tag);
        }

        // Encrypt using NIP-44
        const jsonString = JSON.stringify(privateTags);
        content = await this.encryption.encryptNip44(jsonString, pubkey);
      }

      // Create event
      const unsignedEvent = this.nostr.createEvent(listType.kind, content, tags);

      // Sign and publish
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      // Update local state immediately with the new event (optimistic update)
      const newListData = await this.parseListEvent(signedEvent, listType);
      if (newListData) {
        if (listType.isReplaceable) {
          // Update standard list
          const currentLists = new Map(this.standardListsData());
          currentLists.set(listType.kind, newListData);
          this.standardListsData.set(currentLists);
        } else {
          // Update or add to sets (parameterized replaceable events)
          const currentSets = new Map(this.setsData());
          const existingSets = currentSets.get(listType.kind) || [];

          // Find existing set with same identifier and replace it, or add new
          const existingIndex = identifier
            ? existingSets.findIndex(s => s.identifier === identifier)
            : -1;

          let updatedSets: ListData[];
          if (existingIndex >= 0) {
            // Replace existing set with same identifier
            updatedSets = [...existingSets];
            updatedSets[existingIndex] = newListData;
          } else {
            // Add new set
            updatedSets = [...existingSets, newListData];
          }

          currentSets.set(listType.kind, updatedSets);
          this.setsData.set(currentSets);
        }

        // Also save to local database immediately
        await this.database.saveEvent(signedEvent);

        // Invalidate cache so next load gets the fresh data
        await this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
          cache: true,
          invalidateCache: true,
        } as Parameters<typeof this.data.getEventByPubkeyAndKind>[2]);
      }

      // Publish to ALL account relays (not optimized) - important for list persistence
      const publishResult = await this.publish.publish(signedEvent, { useOptimizedRelays: false });

      // Log publish results for debugging
      const successCount = Array.from(publishResult.relayResults.values()).filter(r => r.success).length;
      const failureCount = Array.from(publishResult.relayResults.values()).filter(r => !r.success).length;

      this.logger.info('[ListsComponent] List publish results:', {
        kind: listType.kind,
        identifier,
        eventId: signedEvent.id,
        success: publishResult.success,
        successCount,
        failureCount,
        relayResults: Array.from(publishResult.relayResults.entries()).map(([url, r]) => ({
          url,
          success: r.success,
          error: r.error
        }))
      });

      if (publishResult.success) {
        if (failureCount > 0) {
          this.snackBar.open(`List saved (${successCount}/${successCount + failureCount} relays)`, 'Close', { duration: 3000 });
        } else {
          this.snackBar.open('List saved successfully', 'Close', { duration: 3000 });
        }
      } else {
        this.snackBar.open('List saved locally but failed to publish to relays', 'Close', { duration: 5000 });
      }

      // No need to reload - optimistic update already updated the UI
      // and we saved to storage. Reloading with cache would just get stale data.
    } catch (error) {
      this.logger.error('[ListsComponent] Error saving list', error);
      this.snackBar.open('Failed to save list', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Delete a list
   */
  async deleteList(listData: ListData) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete List',
        message: `Are you sure you want to delete "${listData.title || listData.type.name}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) return;

    this.loading.set(true);

    try {
      // Create a deletion event (kind 5)
      const tags: string[][] = [['e', listData.event.id]];

      if (listData.identifier) {
        // For parameterized replaceable events, include the coordinates
        tags.push(['a', `${listData.type.kind}:${listData.event.pubkey}:${listData.identifier}`]);
      }

      const unsignedEvent = this.nostr.createEvent(
        kinds.EventDeletion,
        'List deleted',
        tags
      );

      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      // Publish to ALL account relays (not optimized) - important for deletion to propagate
      await this.publish.publish(signedEvent, { useOptimizedRelays: false });

      // Immediately remove from local state for responsive UI
      if (!listData.type.isReplaceable && listData.identifier) {
        // For parameterized replaceable sets (30000 series), remove from setsData
        const setKind = listData.type.kind;

        // Special handling for follow sets (kind 30000) - also update FollowSetsService
        if (setKind === 30000) {
          this.followSetsService.followSets.update(sets =>
            sets.filter(set => set.dTag !== listData.identifier)
          );
        }

        // Remove from local setsData signal for all set types
        this.setsData.update(map => {
          const newMap = new Map(map);
          const existingSets = newMap.get(setKind) || [];
          const updatedSets = existingSets.filter(s => s.identifier !== listData.identifier);
          if (updatedSets.length > 0) {
            newMap.set(setKind, updatedSets);
          } else {
            newMap.delete(setKind);
          }
          return newMap;
        });
      } else if (listData.type.isReplaceable) {
        // For standard replaceable lists (10000 series), remove from standardListsData
        this.standardListsData.update(map => {
          const newMap = new Map(map);
          newMap.delete(listData.type.kind);
          return newMap;
        });
      }

      this.snackBar.open('List deleted successfully', 'Close', { duration: 3000 });

      // Don't reload - the deletion event needs time to propagate to database
      // We've already updated the local signals, so the UI is already correct
    } catch (error) {
      this.logger.error('[ListsComponent] Error deleting list', error);
      this.snackBar.open('Failed to delete list', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Get standard lists for a specific kind
   */
  getStandardList(kind: number): ListData | undefined {
    return this.standardListsData().get(kind);
  }

  /**
   * Get sets for a specific kind
   */
  getSets(kind: number): ListData[] {
    return this.setsData().get(kind) || [];
  }

  /**
   * Get filtered list sets based on selectedKind
   */
  getFilteredListSets(): ListType[] {
    const kind = this.selectedKind();
    if (kind === undefined) {
      return this.listSets;
    }
    return this.listSets.filter(listType => listType.kind === kind);
  }

  /**
   * Get count display text
   */
  getCountText(listData: ListData): string {
    const publicCount = listData.publicItems.length;
    const privateCount = listData.privateItems.length;
    const total = publicCount + privateCount;

    if (privateCount === 0) {
      return `${total} items`;
    }

    return `${total} items (${privateCount} private)`;
  }

  /**
   * Format timestamp
   */
  formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString();
  }

  /**
   * Debug method to log all raw list items for troubleshooting
   * Can be called from browser console: window.listComponent?.debugListItems()
   */
  debugListItems(): void {
    this.logger.info('[ListsComponent] Debug - Standard Lists:');
    for (const [kind, listData] of this.standardListsData().entries()) {
      this.logger.info(`Kind ${kind}:`, {
        publicItems: listData.publicItems,
        privateItems: listData.privateItems,
        event: listData.event
      });
    }

    this.logger.info('[ListsComponent] Debug - Sets:');
    for (const [kind, sets] of this.setsData().entries()) {
      this.logger.info(`Kind ${kind} sets:`, sets.map(set => ({
        title: set.title,
        identifier: set.identifier,
        publicItems: set.publicItems,
        privateItems: set.privateItems,
        event: set.event
      })));
    }
  }
}
