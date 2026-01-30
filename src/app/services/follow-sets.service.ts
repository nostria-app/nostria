import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Event, UnsignedEvent, kinds } from 'nostr-tools';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { PublishService } from './publish.service';
import { EncryptionService } from './encryption.service';
import { UtilitiesService } from './utilities.service';
import { DeletionFilterService } from './deletion-filter.service';

export interface FollowSet {
  id: string; // Event ID
  dTag: string; // The d tag identifier (prefixed with "nostria-")
  title: string; // Human-readable name
  pubkeys: string[]; // List of pubkeys in this set
  createdAt: number; // Timestamp
  isPrivate: boolean; // Whether this set is encrypted (private)
  decryptionPending?: boolean; // Whether private content is still being decrypted
  event?: Event; // The raw Nostr event
}

const NOSTRIA_PREFIX = 'nostria-';
const FAVORITES_D_TAG = 'nostria-favorites';

@Injectable({
  providedIn: 'root',
})
export class FollowSetsService {
  private readonly dataService = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly publishService = inject(PublishService);
  private readonly encryption = inject(EncryptionService);
  private readonly utilities = inject(UtilitiesService);
  private readonly deletionFilter = inject(DeletionFilterService);

  // Signals for reactive state
  followSets = signal<FollowSet[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  hasInitiallyLoaded = signal<boolean>(false);

  // Track ongoing load to prevent concurrent loads
  private loadingPromise: Promise<void> | null = null;
  private lastLoadedPubkey: string | null = null;
  private lastEffectPubkey: string | null = null;

  // Function to sign events - must be set by NostrService to avoid circular dependency
  private signFunction?: (event: UnsignedEvent) => Promise<Event>;

  /**
   * Set the signing function. Called by NostrService during initialization.
   */
  setSignFunction(signFn: (event: UnsignedEvent) => Promise<Event>): void {
    this.signFunction = signFn;
  }

  constructor() {
    // Load follow sets when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();

      // Only load if pubkey actually changed
      if (pubkey === this.lastEffectPubkey) {
        return;
      }

      this.lastEffectPubkey = pubkey;
      this.logger.debug('[FollowSets] Effect triggered, pubkey:', pubkey?.substring(0, 8), 'initialized:', initialized);

      if (pubkey) {
        this.hasInitiallyLoaded.set(false);

        // Clear any existing loading promise when switching accounts
        // This ensures we don't skip loading due to stale promise state
        this.loadingPromise = null;
        this.lastLoadedPubkey = null;

        // Clear follow sets immediately to prevent showing old account's lists
        // The new account's lists will be loaded below
        this.followSets.set([]);

        // Wait for account to be initialized (relays configured) before loading
        // This prevents race conditions where we try to fetch from relays before they're ready
        if (!initialized) {
          this.logger.debug('[FollowSets] Account not yet initialized, will load on next effect trigger');
          // Reset lastEffectPubkey so the effect will re-run when initialized changes
          this.lastEffectPubkey = null;
          return;
        }

        // For extension accounts, wait for the extension to be available before loading
        // since decryption of private follow sets requires the extension
        if (account?.source === 'extension') {
          this.utilities.waitForNostrExtension().then(available => {
            if (available) {
              this.logger.debug('[FollowSets] Extension available, loading follow sets');
              this.loadFollowSets(pubkey);
            } else {
              this.logger.warn('[FollowSets] Extension not available, loading follow sets anyway (private sets may fail to decrypt)');
              this.loadFollowSets(pubkey);
            }
          });
        } else {
          this.loadFollowSets(pubkey);
        }
      } else {
        this.followSets.set([]);
        this.hasInitiallyLoaded.set(false);
      }
    }, { allowSignalWrites: true });
  }

  /**
   * Load follow sets for a given pubkey from database and relays
   * Uses a two-phase approach:
   * 1. First phase: Parse events quickly without waiting for decryption (shows public content immediately)
   * 2. Second phase: Attempt decryption in background and update follow sets when complete
   */
  async loadFollowSets(pubkey: string): Promise<void> {
    // If already loading for the same pubkey, return existing promise
    if (this.loadingPromise && this.lastLoadedPubkey === pubkey) {
      this.logger.debug('[FollowSets] Already loading for this pubkey, reusing existing load');
      return this.loadingPromise;
    }

    this.lastLoadedPubkey = pubkey;
    this.isLoading.set(true);
    this.error.set(null);

    this.loadingPromise = (async () => {
      try {
        this.logger.debug('[FollowSets] Loading follow sets for pubkey:', pubkey);

        // Ensure database is initialized before querying
        await this.database.init();

        // First, try to load from database - parse immediately without waiting for decryption
        let dbEvents = await this.database.getEventsByPubkeyAndKind(pubkey, 30000);

        // Filter out deleted events
        dbEvents = dbEvents.filter(event => !this.deletionFilter.isDeleted(event));

        let hasDbResults = false;
        if (dbEvents.length > 0) {
          // Parse database events immediately (without decryption)
          const dbSets = dbEvents
            .map(event => this.parseFollowSetEventSync(event))
            .filter((set): set is FollowSet => set !== null);

          // Deduplicate by dTag, keeping only the newest event for each dTag
          const deduplicatedDbSets = this.deduplicateByDTag(dbSets);

          if (deduplicatedDbSets.length > 0) {
            hasDbResults = true;
            // Set follow sets immediately with public data
            this.followSets.set(deduplicatedDbSets);
            this.logger.info(`[FollowSets] Loaded ${deduplicatedDbSets.length} follow sets from database (without decryption)`);

            // Start background decryption for private lists (don't await)
            this.decryptPrivateListsInBackground(deduplicatedDbSets);
          }
        }

        // Then fetch from relays to get any updates
        const events = await this.dataService.getEventsByPubkeyAndKind(
          pubkey,
          30000,
          {
            cache: true,
            save: true,
          }
        );

        // Convert all events to FollowSet objects (without decryption), filtering out deleted events
        const sets = events
          .filter(record => !this.deletionFilter.isDeleted(record.event))
          .map(record => this.parseFollowSetEventSync(record.event))
          .filter((set): set is FollowSet => set !== null);

        // Deduplicate by dTag, keeping only the newest event for each dTag
        const deduplicatedSets = this.deduplicateByDTag(sets);

        // Only update from relay if we got results, or if we had no db results
        // This prevents overwriting good db data with empty relay response
        if (deduplicatedSets.length > 0 || !hasDbResults) {
          // Set follow sets immediately with public data
          this.followSets.set(deduplicatedSets);
          this.logger.info(`[FollowSets] Loaded ${deduplicatedSets.length} follow sets from relays (without decryption)`);

          // Start background decryption for private lists (don't await)
          this.decryptPrivateListsInBackground(deduplicatedSets);
        } else {
          this.logger.debug('[FollowSets] Relay returned empty results, keeping database results');
        }
      } catch (error) {
        this.logger.error('[FollowSets] Failed to load follow sets:', error);
        this.error.set('Failed to load follow sets');
      } finally {
        this.isLoading.set(false);
        this.hasInitiallyLoaded.set(true);
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  /**
   * Decrypt private lists in background and update the follow sets when done
   * This runs asynchronously and doesn't block the initial load
   */
  private async decryptPrivateListsInBackground(sets: FollowSet[]): Promise<void> {
    const privateSets = sets.filter(set => set.isPrivate && set.decryptionPending && set.event);

    if (privateSets.length === 0) {
      return;
    }

    this.logger.debug(`[FollowSets] Starting background decryption for ${privateSets.length} private lists`);

    // Process each private set one at a time to avoid overwhelming the extension
    for (const set of privateSets) {
      try {
        const privatePubkeys = await this.parsePrivatePubkeys(set.event!.content);

        if (privatePubkeys.length > 0) {
          // Update the follow set with decrypted pubkeys
          this.followSets.update(currentSets => {
            return currentSets.map(s => {
              if (s.dTag === set.dTag) {
                return {
                  ...s,
                  pubkeys: [...s.pubkeys, ...privatePubkeys],
                  decryptionPending: false,
                };
              }
              return s;
            });
          });

          this.logger.debug(`[FollowSets] Decrypted ${privatePubkeys.length} private pubkeys for "${set.title}"`);
        } else {
          // No private pubkeys found, just mark as not pending
          this.followSets.update(currentSets => {
            return currentSets.map(s => {
              if (s.dTag === set.dTag) {
                return { ...s, decryptionPending: false };
              }
              return s;
            });
          });
        }
      } catch (error) {
        this.logger.debug(`[FollowSets] Background decryption failed for "${set.title}":`, error);
        // Mark as not pending even on failure - user may have rejected
        this.followSets.update(currentSets => {
          return currentSets.map(s => {
            if (s.dTag === set.dTag) {
              return { ...s, decryptionPending: false };
            }
            return s;
          });
        });
      }
    }
  }

  /**
   * Get the d-tag from an event
   */
  private getDTagFromEvent(event: Event): string | null {
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag ? dTag[1] : null;
  }

  /**
   * Parse a kind 30000 event into a FollowSet object synchronously (without decryption)
   * This allows immediate rendering of lists with public content while decryption happens in background
   */
  private parseFollowSetEventSync(event: Event): FollowSet | null {
    try {
      const dTag = this.getDTagFromEvent(event);
      if (!dTag) {
        this.logger.warn('[FollowSets] Event missing d-tag:', event.id);
        return null;
      }

      // Extract title from tags or use d-tag as fallback
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const title = titleTag ? titleTag[1] : this.formatTitle(dTag);

      // Extract pubkeys from public p tags
      const publicPubkeys = event.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      // Determine if this set is private based on whether content is encrypted
      const isPrivate = this.encryption.isContentEncrypted(event.content);

      // Mark as pending decryption if there's encrypted content
      const decryptionPending = isPrivate && event.content.trim() !== '';

      return {
        id: event.id,
        dTag,
        title,
        pubkeys: publicPubkeys, // Only public pubkeys initially
        createdAt: event.created_at,
        isPrivate,
        decryptionPending,
        event,
      };
    } catch (error) {
      this.logger.error('[FollowSets] Failed to parse follow set event:', error);
      return null;
    }
  }

  /**
   * Parse a kind 30000 event into a FollowSet object
   */
  private async parseFollowSetEvent(event: Event): Promise<FollowSet | null> {
    try {
      const dTag = this.getDTagFromEvent(event);
      if (!dTag) {
        this.logger.warn('[FollowSets] Event missing d-tag:', event.id);
        return null;
      }

      // Extract title from tags or use d-tag as fallback
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const title = titleTag ? titleTag[1] : this.formatTitle(dTag);

      // Extract pubkeys from public p tags
      const publicPubkeys = event.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      // Try to decrypt private content if it exists
      const privatePubkeys = await this.parsePrivatePubkeys(event.content);

      // Determine if this set is private based on whether content is encrypted
      const isPrivate = this.encryption.isContentEncrypted(event.content);

      // Combine public and private pubkeys
      const allPubkeys = [...publicPubkeys, ...privatePubkeys];

      return {
        id: event.id,
        dTag,
        title,
        pubkeys: allPubkeys,
        createdAt: event.created_at,
        isPrivate,
        event,
      };
    } catch (error) {
      this.logger.error('[FollowSets] Failed to parse follow set event:', error);
      return null;
    }
  }

  /**
   * Deduplicate follow sets by dTag, keeping only the newest event for each dTag
   */
  private deduplicateByDTag(sets: FollowSet[]): FollowSet[] {
    const setsByDTag = new Map<string, FollowSet>();

    for (const set of sets) {
      const existing = setsByDTag.get(set.dTag);
      // Keep the newer event (higher createdAt timestamp)
      if (!existing || set.createdAt > existing.createdAt) {
        setsByDTag.set(set.dTag, set);
      }
    }

    return Array.from(setsByDTag.values());
  }

  /**
   * Parse private pubkeys from encrypted content
   */
  private async parsePrivatePubkeys(content: string): Promise<string[]> {
    if (!content || content.trim() === '') {
      return [];
    }

    // Check if content is encrypted
    if (!this.encryption.isContentEncrypted(content)) {
      return [];
    }

    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.debug('[FollowSets] No pubkey available for decryption');
        return [];
      }

      // Decrypt content - try NIP-44 first, fallback to NIP-04
      let decrypted: string;
      try {
        decrypted = await this.encryption.decryptNip44(content, pubkey);
      } catch (nip44Error) {
        this.logger.debug('[FollowSets] NIP-44 decryption failed, trying NIP-04...');
        decrypted = await this.encryption.decryptNip04(content, pubkey);
      }

      // Parse the decrypted JSON array of tags
      const privateTags: string[][] = JSON.parse(decrypted);

      // Extract pubkeys from p tags
      const pubkeys = privateTags
        .filter(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1])
        .map(tag => tag[1]);

      this.logger.debug(`[FollowSets] Decrypted ${pubkeys.length} private pubkeys`);
      return pubkeys;
    } catch (error) {
      this.logger.debug('[FollowSets] Could not decrypt private content:', error);
      return [];
    }
  }

  /**
   * Format a d-tag into a human-readable title
   */
  private formatTitle(dTag: string): string {
    // Remove nostria prefix
    let title = dTag.replace(NOSTRIA_PREFIX, '');

    // Convert hyphens to spaces and capitalize
    title = title
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return title;
  }

  /**
   * Get a follow set by its d-tag
   */
  getFollowSetByDTag(dTag: string): FollowSet | undefined {
    return this.followSets().find(set => set.dTag === dTag);
  }

  /**
   * Get the favorites follow set
   */
  getFavorites(): FollowSet | undefined {
    return this.getFollowSetByDTag(FAVORITES_D_TAG);
  }

  /**
   * Create or update a follow set
   */
  async saveFollowSet(
    dTag: string,
    title: string,
    pubkeys: string[],
    isPrivate = false
  ): Promise<FollowSet | null> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('[FollowSets] Cannot save follow set: no current account');
      return null;
    }

    if (!this.signFunction) {
      this.logger.error('[FollowSets] Sign function not initialized. Ensure NostrService has called setSignFunction() before using this service.');
      return null;
    }

    try {
      // Ensure d-tag has nostria prefix
      const prefixedDTag = dTag.startsWith(NOSTRIA_PREFIX) ? dTag : `${NOSTRIA_PREFIX}${dTag}`;

      // Build tags - only include d and title tags
      const tags: string[][] = [
        ['d', prefixedDTag],
        ['title', title],
      ];

      // Handle encryption for private lists
      let content = '';
      if (isPrivate) {
        // For private lists, encrypt all pubkeys in content
        const privateTags: string[][] = pubkeys.map(pubkey => ['p', pubkey]);
        const jsonString = JSON.stringify(privateTags);
        content = await this.encryption.encryptNip44(jsonString, currentPubkey);
      } else {
        // For public lists, add pubkeys as public tags
        tags.push(...pubkeys.map(pubkey => ['p', pubkey]));
      }

      // Create unsigned event
      const unsignedEvent: UnsignedEvent = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
        pubkey: currentPubkey,
      };

      // Sign and publish
      const publishResult = await this.publishService.signAndPublishAuto(unsignedEvent, this.signFunction);
      const signedEvent = publishResult.event;

      // Save to database to ensure it appears in Lists component immediately
      try {
        await this.database.saveEvent(signedEvent);
        this.logger.debug('[FollowSets] Saved follow set event to database');
      } catch (dbError) {
        this.logger.warn('[FollowSets] Failed to save follow set to database:', dbError);
        // Continue anyway - event was published successfully
      }

      // Create FollowSet object for local update
      const followSet: FollowSet = {
        id: signedEvent.id,
        dTag: prefixedDTag,
        title,
        pubkeys,
        createdAt: signedEvent.created_at,
        isPrivate,
        event: signedEvent,
      };

      // Update local state
      this.updateLocalFollowSet(followSet);

      this.logger.info(`[FollowSets] Saved follow set: ${title} (${isPrivate ? 'private' : 'public'})`);
      return followSet;
    } catch (error) {
      this.logger.error('[FollowSets] Failed to save follow set:', error);
      throw error;
    }
  }

  /**
   * Update local follow set state
   */
  private updateLocalFollowSet(updatedSet: FollowSet): void {
    this.followSets.update(sets => {
      const index = sets.findIndex(set => set.dTag === updatedSet.dTag);
      if (index >= 0) {
        // Update existing
        const newSets = [...sets];
        newSets[index] = updatedSet;
        return newSets;
      } else {
        // Add new
        return [...sets, updatedSet];
      }
    });
  }

  /**
   * Delete a follow set by publishing a kind 5 deletion event (NIP-09)
   */
  async deleteFollowSet(dTag: string): Promise<boolean> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('[FollowSets] Cannot delete follow set: no current account');
      return false;
    }

    if (!this.signFunction) {
      this.logger.error('[FollowSets] Sign function not initialized. Ensure NostrService has called setSignFunction() before using this service.');
      return false;
    }

    // Get the follow set to find its event ID
    const followSet = this.getFollowSetByDTag(dTag);
    if (!followSet) {
      this.logger.warn(`[FollowSets] Follow set not found for deletion: ${dTag}`);
      return false;
    }

    try {
      // Create a deletion event (kind 5) - NIP-09
      // For addressable events (kind 30000), use 'a' tag with format: kind:pubkey:d-tag
      // Include 'k' tag for the kind being deleted as per NIP-09
      const deletionEvent: UnsignedEvent = {
        kind: 5,
        pubkey: currentPubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Deleted follow set',
        tags: [
          ['a', `30000:${currentPubkey}:${dTag}`],
          ['k', '30000']
        ],
      };

      // Sign and publish
      await this.publishService.signAndPublishAuto(deletionEvent, this.signFunction);

      // Delete from local database to prevent it from coming back on reload
      if (followSet.id) {
        await this.database.deleteEvent(followSet.id);
        this.logger.debug(`[FollowSets] Deleted event ${followSet.id} from local database`);
      }

      // Remove from local state
      this.followSets.update(sets => sets.filter(set => set.dTag !== dTag));

      this.logger.info(`[FollowSets] Deleted follow set: ${dTag}`);
      return true;
    } catch (error) {
      this.logger.error('[FollowSets] Failed to delete follow set:', error);
      return false;
    }
  }

  /**
   * Add a pubkey to a follow set
   */
  async addToFollowSet(dTag: string, pubkey: string): Promise<boolean> {
    const followSet = this.getFollowSetByDTag(dTag);
    if (!followSet) {
      this.logger.warn(`[FollowSets] Follow set not found: ${dTag}`);
      return false;
    }

    // Check if already in set
    if (followSet.pubkeys.includes(pubkey)) {
      this.logger.debug(`[FollowSets] Pubkey already in set: ${pubkey}`);
      return true;
    }

    // Add pubkey and save, preserving the isPrivate setting
    const updatedPubkeys = [...followSet.pubkeys, pubkey];
    const result = await this.saveFollowSet(dTag, followSet.title, updatedPubkeys, followSet.isPrivate);
    return result !== null;
  }

  /**
   * Remove a pubkey from a follow set
   */
  async removeFromFollowSet(dTag: string, pubkey: string): Promise<boolean> {
    const followSet = this.getFollowSetByDTag(dTag);
    if (!followSet) {
      this.logger.warn(`[FollowSets] Follow set not found: ${dTag}`);
      return false;
    }

    // Remove pubkey and save, preserving the isPrivate setting
    const updatedPubkeys = followSet.pubkeys.filter(pk => pk !== pubkey);
    const result = await this.saveFollowSet(dTag, followSet.title, updatedPubkeys, followSet.isPrivate);
    return result !== null;
  }

  /**
   * Create a new follow set with a unique d-tag
   */
  async createFollowSet(title: string, pubkeys: string[] = [], isPrivate = false): Promise<FollowSet | null> {
    // Generate a unique d-tag from the title
    const baseDTag = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    let dTag = `${NOSTRIA_PREFIX}${baseDTag}`;
    let counter = 1;

    // Ensure uniqueness
    while (this.getFollowSetByDTag(dTag)) {
      dTag = `${NOSTRIA_PREFIX}${baseDTag}-${counter}`;
      counter++;
    }

    return this.saveFollowSet(dTag, title, pubkeys, isPrivate);
  }

  /**
   * Migrate favorites to a follow set
   */
  async migrateFavorites(favorites: string[]): Promise<FollowSet | null> {
    this.logger.info('[FollowSets] Migrating favorites to follow set');
    return this.saveFollowSet(FAVORITES_D_TAG, 'Favorites', favorites);
  }

  /**
   * Check if a pubkey is in any follow set
   */
  isInAnyFollowSet(pubkey: string): boolean {
    return this.followSets().some(set => set.pubkeys.includes(pubkey));
  }

  /**
   * Get all follow sets that contain a pubkey
   */
  getFollowSetsForPubkey(pubkey: string): FollowSet[] {
    return this.followSets().filter(set => set.pubkeys.includes(pubkey));
  }
}
