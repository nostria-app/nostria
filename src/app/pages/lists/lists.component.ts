import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { NostrService } from '../../services/nostr.service';
import { PublishService } from '../../services/publish.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { EncryptionService } from '../../services/encryption.service';
import { StorageService } from '../../services/storage.service';
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
  marker?: string;
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
    kind: 30007,
    name: 'Kind Mute Sets',
    description: 'Mute pubkeys by event kinds',
    icon: 'notifications_off',
    isReplaceable: false,
    expectedTags: ['p'],
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
    kind: 30063,
    name: 'Release Artifact Sets',
    description: 'Software release artifacts',
    icon: 'package',
    isReplaceable: false,
    expectedTags: ['e', 'a'],
  },
  {
    kind: 30267,
    name: 'App Curation Sets',
    description: 'Curated software applications',
    icon: 'apps',
    isReplaceable: false,
    expectedTags: ['a'],
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
    CommonModule,
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
    MatTooltipModule,
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
  private readonly storage = inject(StorageService);

  // Available list types
  standardLists = STANDARD_LISTS;
  listSets = LIST_SETS;

  // State
  loading = signal(false);
  selectedTab = signal(0); // 0 = standard lists, 1 = sets

  // Loaded lists data
  standardListsData = signal<Map<number, ListData>>(new Map());
  setsData = signal<Map<number, ListData[]>>(new Map()); // Multiple sets per kind

  // Computed
  pubkey = computed(() => this.accountState.pubkey());

  async ngOnInit() {
    await this.loadAllLists();
  }

  /**
   * Load all lists for the current user
   */
  async loadAllLists() {
    const pubkey = this.pubkey();
    if (!pubkey) {
      this.logger.warn('[ListsComponent] No pubkey available');
      return;
    }

    this.loading.set(true);

    try {
      // Load standard lists (10000 series)
      await this.loadStandardLists(pubkey);

      // Load sets (30000 series)
      await this.loadSets(pubkey);
    } catch (error) {
      this.logger.error('[ListsComponent] Error loading lists', error);
      this.snackBar.open('Failed to load lists', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Load standard replaceable lists (10000 series)
   */
  private async loadStandardLists(pubkey: string) {
    const listsMap = new Map<number, ListData>();

    for (const listType of STANDARD_LISTS) {
      try {
        const record = await this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
          save: true,
          cache: true,
        });

        if (record?.event) {
          const listData = await this.parseListEvent(record.event, listType);
          if (listData) {
            listsMap.set(listType.kind, listData);
          }
        }
      } catch {
        this.logger.debug(`[ListsComponent] No list found for kind ${listType.kind}`);
      }
    }

    this.standardListsData.set(listsMap);
  }

  /**
   * Load parameterized replaceable sets (30000 series)
   */
  private async loadSets(pubkey: string) {
    const setsMap = new Map<number, ListData[]>();

    for (const listType of LIST_SETS) {
      try {
        const records = await this.data.getEventsByPubkeyAndKind(pubkey, listType.kind, {
          save: true,
          cache: true,
        });

        if (records && records.length > 0) {
          const sets: ListData[] = [];
          for (const record of records) {
            if (record.event) {
              const listData = await this.parseListEvent(record.event, listType);
              if (listData) {
                sets.push(listData);
              }
            }
          }

          if (sets.length > 0) {
            setsMap.set(listType.kind, sets);
          }
        }
      } catch {
        this.logger.debug(`[ListsComponent] No sets found for kind ${listType.kind}`);
      }
    }

    this.setsData.set(setsMap);
  }

  /**
   * Parse a list event into structured data
   */
  private async parseListEvent(event: Event, type: ListType): Promise<ListData | null> {
    try {
      // Parse public items from tags
      const publicItems = this.parsePublicItems(event.tags);

      // Parse private items from encrypted content (if any)
      const privateItems = await this.parsePrivateItems(event.content);

      // Extract metadata
      const title = event.tags.find(t => t[0] === 'title')?.[1];
      const description = event.tags.find(t => t[0] === 'description')?.[1];
      const image = event.tags.find(t => t[0] === 'image')?.[1];
      const identifier = event.tags.find(t => t[0] === 'd')?.[1];

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

      items.push({
        tag: tagName,
        value,
        relay,
        marker,
        metadata,
      });
    }

    return items;
  }

  /**
   * Parse private items from encrypted content
   */
  private async parsePrivateItems(content: string): Promise<ListItem[]> {
    if (!content || content.trim() === '') {
      return [];
    }

    try {
      const pubkey = this.pubkey();
      if (!pubkey) return [];

      // Try to decrypt the content using NIP-44
      let decrypted: string;
      try {
        decrypted = await this.encryption.decryptNip44(content, pubkey);
      } catch {
        // Fallback to NIP-04 for backward compatibility
        try {
          decrypted = await this.encryption.decryptNip04(content, pubkey);
        } catch {
          this.logger.debug('[ListsComponent] Could not decrypt private items');
          return [];
        }
      }

      // Parse the decrypted JSON array of tags
      const privateTags: string[][] = JSON.parse(decrypted);
      return this.parsePublicItems(privateTags);
    } catch (error) {
      this.logger.error('[ListsComponent] Error parsing private items', error);
      return [];
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
        if (item.marker) tag.push(item.marker);
        if (item.metadata) tag.push(item.metadata);
        tags.push(tag);
      }

      // Encrypt private items if any
      let content = '';
      if (privateItems && privateItems.length > 0) {
        const privateTags: string[][] = [];
        for (const item of privateItems) {
          const tag = [item.tag, item.value];
          if (item.relay) tag.push(item.relay);
          if (item.marker) tag.push(item.marker);
          if (item.metadata) tag.push(item.metadata);
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
          // Update or add to sets
          const currentSets = new Map(this.setsData());
          const existingSets = currentSets.get(listType.kind) || [];
          
          // Find and replace existing set with same identifier, or add new
          const updatedSets = identifier
            ? existingSets.map(s => s.identifier === identifier ? newListData : s)
            : [...existingSets, newListData];
          
          // If no existing set was found with this identifier, add it
          if (identifier && !existingSets.some(s => s.identifier === identifier)) {
            updatedSets.push(newListData);
          }
          
          currentSets.set(listType.kind, updatedSets);
          this.setsData.set(currentSets);
        }
        
        // Also save to local database immediately
        await this.storage.saveEvent(signedEvent);
      }
      
      // Publish to relays (happens in background)
      await this.publish.publish(signedEvent, { useOptimizedRelays: true });

      this.snackBar.open('List saved successfully', 'Close', { duration: 3000 });

      // Reload lists
      await this.loadAllLists();
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
    const confirmed = confirm(
      `Are you sure you want to delete "${listData.title || listData.type.name}"?`
    );
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
      await this.publish.publish(signedEvent, { useOptimizedRelays: true });

      this.snackBar.open('List deleted successfully', 'Close', { duration: 3000 });

      // Reload lists
      await this.loadAllLists();
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
}
