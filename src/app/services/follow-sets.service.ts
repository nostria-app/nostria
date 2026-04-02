import { Injectable, inject, signal, effect, untracked } from '@angular/core';
import { Event, UnsignedEvent, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { DatabaseService } from './database.service';
import { PublishService } from './publish.service';
import { EncryptionService } from './encryption.service';
import { DeletionFilterService } from './deletion-filter.service';
import { AccountRelayService } from './relays/account-relay';
import type { DeleteEventReferenceMode } from '../components/delete-confirmation-dialog/delete-confirmation-dialog.component';

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

interface DecryptedFollowSetData {
  pubkeys: string[];
  title: string | null;
}

interface DecryptedFollowSetPayload {
  title?: unknown;
  name?: unknown;
  label?: unknown;
  pubkeys?: unknown;
  people?: unknown;
  p?: unknown;
  tags?: unknown;
  items?: unknown;
}

const NOSTRIA_PREFIX = 'nostria-';
const FAVORITES_D_TAG = 'nostria-favorites';

@Injectable({
  providedIn: 'root',
})
export class FollowSetsService {
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly database = inject(DatabaseService);
  private readonly publishService = inject(PublishService);
  private readonly encryption = inject(EncryptionService);
  private readonly deletionFilter = inject(DeletionFilterService);

  // Signals for reactive state
  followSets = signal<FollowSet[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  hasInitiallyLoaded = signal<boolean>(false);

  // Track ongoing load to prevent concurrent loads
  private lastEffectPubkey: string | null = null;
  // Track the pubkey we last loaded data for, to avoid clearing on re-initialization
  private lastDataPubkey: string | null = null;
  private liveFollowSetsSubscription: { close: () => void } | { unsubscribe: () => void } | null = null;
  private liveFollowSetsSubscriptionPubkey: string | null = null;

  // Function to sign events - must be set by NostrService to avoid circular dependency
  private signFunction?: (event: UnsignedEvent) => Promise<Event>;

  /**
   * Set the signing function. Called by NostrService during initialization.
   */
  setSignFunction(signFn: (event: UnsignedEvent) => Promise<Event>): void {
    this.signFunction = signFn;
  }

  constructor() {
    // Load follow sets from cache when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();

      // Only load if pubkey actually changed
      if (pubkey === this.lastEffectPubkey) {
        return;
      }

      this.lastEffectPubkey = pubkey;
      this.logger.debug('[FollowSets] Effect triggered, pubkey:', pubkey?.substring(0, 8));

      if (pubkey) {
        this.hasInitiallyLoaded.set(false);

        // Only clear follow sets when switching to a DIFFERENT account
        // to prevent showing the old account's data.
        // When re-initializing the same account (e.g., after relays connect),
        // keep existing data to prevent flickering.
        if (this.lastDataPubkey !== null && this.lastDataPubkey !== pubkey) {
          this.followSets.set([]);
        }
        this.lastDataPubkey = pubkey;

        // FAST PATH: Load from database immediately, don't wait for initialized
        // This makes follow sets available faster for UI rendering
        // Relay fetch is handled by the live subscription (startLiveFollowSetsSubscription)
        this.loadFollowSetsFromCache(pubkey);
      } else {
        this.followSets.set([]);
        this.hasInitiallyLoaded.set(false);
        this.lastDataPubkey = null;
        this.stopLiveFollowSetsSubscription();
      }
    });

    effect(() => {
      const account = this.accountState.account();
      const initialized = this.accountState.initialized();
      const pubkey = this.accountState.pubkey();

      if (!account || !initialized || !pubkey) {
        this.stopLiveFollowSetsSubscription();
        return;
      }

      if (this.liveFollowSetsSubscriptionPubkey === pubkey) {
        return;
      }

      untracked(() => {
        this.stopLiveFollowSetsSubscription();
        this.startLiveFollowSetsSubscription(pubkey);
      });
    });
  }

  /**
   * FAST PATH: Load follow sets from local database only (no network).
   * This is called immediately when account changes to show cached data quickly.
   */
  async loadFollowSetsFromCache(pubkey: string): Promise<boolean> {
    try {
      const startTime = Date.now();
      this.logger.debug('[FollowSets] Loading follow sets from cache for pubkey:', pubkey?.substring(0, 8));

      // Ensure database is initialized before querying
      await this.database.init();

      // Load from database - parse immediately without waiting for decryption
      let dbEvents = await this.database.getEventsByPubkeyAndKind(pubkey, 30000);

      // Filter out deleted events
      dbEvents = await this.deletionFilter.filterDeletedEventsFromDatabase(dbEvents);

      if (dbEvents.length > 0) {
        // Parse database events immediately (without decryption)
        const dbSets = dbEvents
          .map(event => this.parseFollowSetEventSync(event))
          .filter((set): set is FollowSet => set !== null);

        // Deduplicate by dTag, keeping only the newest event for each dTag
        const deduplicatedDbSets = this.deduplicateByDTag(dbSets);

        if (deduplicatedDbSets.length > 0) {
          // Apply decrypted cache to private sets so they are fully resolved
          // without needing background decryption on every startup
          const resolvedSets = await this.applyCachedDecryption(deduplicatedDbSets);

          // Only update if data has actually changed to prevent UI flickering
          const currentSets = this.followSets();
          if (!this.followSetsEqual(currentSets, resolvedSets)) {
            this.followSets.set(resolvedSets);
            this.logger.info(`[FollowSets] Loaded ${resolvedSets.length} follow sets from cache in ${Date.now() - startTime}ms`);

            // Only start background decryption for sets that still need it (cache misses)
            const uncachedSets = resolvedSets.filter(set => set.isPrivate && set.decryptionPending && set.event);
            if (uncachedSets.length > 0) {
              this.decryptPrivateListsInBackground(resolvedSets);
            }
          } else {
            this.logger.debug(`[FollowSets] Cache data unchanged in ${Date.now() - startTime}ms, skipping update`);
          }
          return true;
        }
      }

      this.logger.debug(`[FollowSets] No cached follow sets found in ${Date.now() - startTime}ms`);
      return false;
    } catch (error) {
      this.logger.error('[FollowSets] Failed to load follow sets from cache:', error);
      return false;
    }
  }


  /**
   * Compare two FollowSet arrays to see if they have the same content.
   * Returns true if the sets are equivalent (same dTags with same pubkeys).
   */
  private followSetsEqual(a: FollowSet[], b: FollowSet[]): boolean {
    if (a.length !== b.length) return false;

    for (const setA of a) {
      const setB = b.find(s => s.dTag === setA.dTag);
      if (!setB) return false;
      if (setA.title !== setB.title) return false;
      if (setA.pubkeys.length !== setB.pubkeys.length) return false;
      if (setA.createdAt !== setB.createdAt) return false;
      if (setA.isPrivate !== setB.isPrivate) return false;
      if ((setA.decryptionPending ?? false) !== (setB.decryptionPending ?? false)) return false;
      for (let i = 0; i < setA.pubkeys.length; i++) {
        if (setA.pubkeys[i] !== setB.pubkeys[i]) return false;
      }
    }

    return true;
  }

  private async handleLiveFollowSetEvent(event: Event): Promise<void> {
    if (event.kind === kinds.EventDeletion) {
      await this.handleLiveFollowSetDeletion(event);
      return;
    }

    const followSet = this.parseFollowSetEventSync(event);
    if (!followSet) {
      return;
    }

    try {
      await this.persistPreferredFollowSetEvent(event);
      const wasDeleted = await this.deletionFilter.checkDeletionFromDatabase(
        event.kind,
        event.pubkey,
        followSet.dTag,
        event.created_at
      );

      if (wasDeleted) {
        this.removeLocalFollowSet(followSet.dTag);
        return;
      }

      const existingFollowSet = this.getFollowSetByDTag(followSet.dTag);
      if (existingFollowSet && existingFollowSet.createdAt > followSet.createdAt) {
        return;
      }

      const wasUpdated = this.updateLocalFollowSet(followSet);

      if (wasUpdated) {
        this.logger.info('[FollowSets] Applied live follow set update', {
          dTag: followSet.dTag,
          createdAt: followSet.createdAt,
        });
      }

      if (followSet.isPrivate && followSet.decryptionPending) {
        this.decryptPrivateListsInBackground([followSet]);
      }
    } catch (error) {
      this.logger.warn('[FollowSets] Failed to handle live follow set update:', error);
    }
  }

  private async handleLiveFollowSetDeletion(event: Event): Promise<void> {
    const dTag = this.getDeletedFollowSetDTag(event);
    if (!dTag) {
      return;
    }

    try {
      await this.database.saveEvent(event);
      const existingFollowSet = this.getFollowSetByDTag(dTag);
      const removed = !existingFollowSet || existingFollowSet.createdAt <= event.created_at
        ? this.removeLocalFollowSet(dTag)
        : false;

      if (removed) {
        this.logger.info('[FollowSets] Applied live follow set deletion', {
          dTag,
          createdAt: event.created_at,
        });
      }
    } catch (error) {
      this.logger.warn('[FollowSets] Failed to handle live follow set deletion:', error);
    }
  }

  private getDeletedFollowSetDTag(event: Event): string | null {
    if (event.kind !== kinds.EventDeletion) {
      return null;
    }

    const identifierPrefix = `30000:${event.pubkey}:`;
    const addressTag = event.tags.find(tag => tag[0] === 'a' && tag[1]?.startsWith(identifierPrefix));
    if (!addressTag?.[1]) {
      return null;
    }

    return addressTag[1].slice(identifierPrefix.length);
  }

  private startLiveFollowSetsSubscription(pubkey: string): void {
    // Calculate since filter: use last sync timestamp with 60-second overlap buffer, capped at 7 days
    const lastSync = this.accountLocalState.getFollowSetsLastSync(pubkey);
    const now = Math.floor(Date.now() / 1000);
    const OVERLAP_BUFFER = 60; // 60 seconds overlap to avoid missing events near boundary
    const MAX_CAP = 7 * 24 * 60 * 60; // 7 days maximum lookback

    const filter: {
      kinds: number[];
      authors: string[];
      limit: number;
      since?: number;
    } = {
      kinds: [30000, kinds.EventDeletion],
      authors: [pubkey],
      limit: 200,
    };

    if (lastSync > 0) {
      const sinceValue = Math.max(lastSync - OVERLAP_BUFFER, now - MAX_CAP);
      filter.since = sinceValue;
      this.logger.debug('[FollowSets] Using since filter for follow sets subscription:', sinceValue);
    }

    this.liveFollowSetsSubscriptionPubkey = pubkey;
    this.liveFollowSetsSubscription = this.accountRelay.subscribe(
      filter,
      (event) => {
        void this.handleLiveFollowSetEvent(event);
      },
      () => {
        // On EOSE: mark initial load complete and save sync timestamp
        this.logger.debug('[FollowSets] Live follow sets subscription reached EOSE');
        this.isLoading.set(false);
        this.hasInitiallyLoaded.set(true);

        // Save the current timestamp for subsequent since-filtered loads
        this.accountLocalState.setFollowSetsLastSync(pubkey, now);
      }
    );
  }

  private stopLiveFollowSetsSubscription(): void {
    if (this.liveFollowSetsSubscription) {
      if ('close' in this.liveFollowSetsSubscription) {
        this.liveFollowSetsSubscription.close();
      } else {
        this.liveFollowSetsSubscription.unsubscribe();
      }
    }

    this.liveFollowSetsSubscription = null;
    this.liveFollowSetsSubscriptionPubkey = null;
  }

  /**
   * Load follow sets for a given pubkey from database and relays
   * Uses a two-phase approach:
   * 1. First phase: Parse events quickly without waiting for decryption (shows public content immediately)
   * 2. Second phase: Attempt decryption in background and update follow sets when complete
   * @deprecated Use loadFollowSetsFromCache() for cache loading; relay fetching is handled by the live subscription
   */
  async loadFollowSets(pubkey: string): Promise<void> {
    await this.loadFollowSetsFromCache(pubkey);
  }

  /**
   * Apply cached decrypted data to private follow sets during initial load.
   * For each private set with encrypted content, checks the persistent cache
   * for previously decrypted data. On cache hit, merges the decrypted pubkeys
   * and title into the set and marks it as resolved (decryptionPending: false).
   * Sets with cache misses are returned unchanged for background decryption.
   */
  private async applyCachedDecryption(sets: FollowSet[]): Promise<FollowSet[]> {
    const result: FollowSet[] = [];

    for (const set of sets) {
      if (!set.isPrivate || !set.decryptionPending || !set.event) {
        result.push(set);
        continue;
      }

      const cached = await this.database.getDecryptedFollowSetCache(set.dTag, set.event.id);
      if (cached) {
        this.logger.debug(`[FollowSets] Restored cached decrypted data for "${cached.title || set.title}" (${cached.pubkeys.length} private pubkeys)`);
        result.push({
          ...set,
          title: cached.title || set.title,
          pubkeys: [...set.pubkeys, ...cached.pubkeys],
          decryptionPending: false,
        });
      } else {
        // No cache or event changed — needs real decryption
        result.push(set);
      }
    }

    return result;
  }

  /**
   * Decrypt private lists in background and update the follow sets when done.
   * Uses a persistent cache (IndexedDB info store) keyed by event ID to avoid
   * redundant decryption requests on every startup. Only performs actual
   * decryption when the underlying event has changed (different event ID).
   */
  private async decryptPrivateListsInBackground(sets: FollowSet[]): Promise<void> {
    const privateSets = sets.filter(set => set.isPrivate && set.decryptionPending && set.event);

    if (privateSets.length === 0) {
      return;
    }

    const runDecryption = async () => {
      this.logger.debug(`[FollowSets] Starting background decryption for ${privateSets.length} private lists`);

      // Process each private set one at a time to avoid overwhelming the extension
      for (const set of privateSets) {
        try {
          // Try loading from decrypted cache first (avoids extension/bunker decryption calls)
          const cached = await this.database.getDecryptedFollowSetCache(set.dTag, set.event!.id);

          let privatePubkeys: string[];
          let decryptedTitle: string | null;

          if (cached) {
            // Cache hit: use cached decrypted data without asking the extension
            privatePubkeys = cached.pubkeys;
            decryptedTitle = cached.title;
            this.logger.debug(`[FollowSets] Using cached decrypted data for "${decryptedTitle || set.title}" (${privatePubkeys.length} private pubkeys)`);
          } else {
            // Cache miss: decrypt and then persist the result
            const privateData = await this.parsePrivateFollowSetData(set.event!.content);
            privatePubkeys = privateData.pubkeys;
            decryptedTitle = privateData.title;

            // Persist decrypted data to cache for next startup
            await this.database.saveDecryptedFollowSetCache(
              set.dTag,
              set.event!.id,
              privatePubkeys,
              decryptedTitle
            );
            this.logger.debug(`[FollowSets] Decrypted and cached private follow set data for "${decryptedTitle || set.title}"`);
          }

          if (privatePubkeys.length > 0 || decryptedTitle) {
            // Update the follow set with decrypted data
            this.followSets.update(currentSets => {
              return currentSets.map(s => {
                if (s.dTag === set.dTag) {
                  return {
                    ...s,
                    title: decryptedTitle || s.title,
                    pubkeys: [...s.pubkeys, ...privatePubkeys],
                    decryptionPending: false,
                  };
                }
                return s;
              });
            });
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
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        void runDecryption();
      }, { timeout: 2000 });
      return;
    }

    setTimeout(() => {
      void runDecryption();
    }, 2000);
  }

  /**
   * Get the d-tag from an event
   */
  private getDTagFromEvent(event: Event): string | null {
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag ? dTag[1] : null;
  }

  /**
   * Extract a human-readable follow set title from supported NIP-51 metadata tags.
   * Some clients use `title`, while others use `name`.
   */
  private getTitleFromEvent(event: Event, dTag: string): string {
    return event.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')?.[1] || this.formatTitle(dTag);
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
      const title = this.getTitleFromEvent(event, dTag);

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

      // Extract pubkeys from public p tags
      const publicPubkeys = event.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      // Try to decrypt private content if it exists
      const privateData = await this.parsePrivateFollowSetData(event.content);
      const privatePubkeys = privateData.pubkeys;

      // Determine if this set is private based on whether content is encrypted
      const isPrivate = this.encryption.isContentEncrypted(event.content);

      // Combine public and private pubkeys
      const allPubkeys = [...publicPubkeys, ...privatePubkeys];
      const title = privateData.title || this.getTitleFromEvent(event, dTag);

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
   * Deduplicate follow sets by dTag.
   * When relays disagree, prefer the event id seen most often, then fall back
   * to timestamp/id priority.
   */
  private deduplicateByDTag(sets: FollowSet[]): FollowSet[] {
    const setsByDTag = new Map<string, Map<string, { set: FollowSet; count: number }>>();

    for (const set of sets) {
      let versions = setsByDTag.get(set.dTag);
      if (!versions) {
        versions = new Map<string, { set: FollowSet; count: number }>();
        setsByDTag.set(set.dTag, versions);
      }

      const existingVersion = versions.get(set.id);
      if (existingVersion) {
        existingVersion.count += 1;
      } else {
        versions.set(set.id, { set, count: 1 });
      }
    }

    return Array.from(setsByDTag.values()).map(versions => {
      const preferred = Array.from(versions.values()).reduce((currentBest, candidate) => {
        if (!currentBest) {
          return candidate;
        }

        if (candidate.count !== currentBest.count) {
          return candidate.count > currentBest.count ? candidate : currentBest;
        }

        return this.compareFollowSetPriority(candidate.set, currentBest.set) > 0 ? candidate : currentBest;
      }, null as { set: FollowSet; count: number } | null);

      return preferred!.set;
    });
  }

  private compareFollowSetPriority(a: FollowSet, b: FollowSet): number {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }

    return a.id.localeCompare(b.id);
  }

  private async persistPreferredFollowSetVersions(events: Event[], preferredSets: FollowSet[]): Promise<void> {
    const preferredByDTag = new Map(preferredSets.map(set => [set.dTag, set.id]));
    const processedDTags = new Set<string>();

    for (const event of events) {
      const dTag = this.getDTagFromEvent(event);
      if (!dTag || processedDTags.has(dTag)) {
        continue;
      }

      processedDTags.add(dTag);
      const preferredId = preferredByDTag.get(dTag);
      if (!preferredId) {
        continue;
      }

      const preferredEvent = events.find(candidate =>
        this.getDTagFromEvent(candidate) === dTag && candidate.id === preferredId
      );

      if (preferredEvent) {
        await this.persistPreferredFollowSetEvent(preferredEvent);
      }
    }
  }

  private async persistPreferredFollowSetEvent(event: Event): Promise<void> {
    const dTag = this.getDTagFromEvent(event);

    await this.database.saveEvent(event);

    if (!dTag) {
      return;
    }

    const existingEvents = await this.database.getEventsByPubkeyKindAndDTag(event.pubkey, event.kind, dTag);
    const conflictingIds = existingEvents
      .filter(existingEvent => existingEvent.id !== event.id)
      .map(existingEvent => existingEvent.id);

    if (conflictingIds.length > 0) {
      await this.database.deleteEvents(conflictingIds);
    }
  }

  /**
   * Parse private pubkeys from encrypted content
   */
  private async parsePrivatePubkeys(content: string): Promise<string[]> {
    const privateData = await this.parsePrivateFollowSetData(content);
    return privateData.pubkeys;
  }

  /**
   * Parse decrypted follow set data from encrypted content.
   * Some clients may include `title`/`name` tags in the encrypted payload for private lists.
   */
  private async parsePrivateFollowSetData(content: string): Promise<DecryptedFollowSetData> {
    if (!content || content.trim() === '') {
      return { pubkeys: [], title: null };
    }

    // Check if content is encrypted
    if (!this.encryption.isContentEncrypted(content)) {
      return { pubkeys: [], title: null };
    }

    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.debug('[FollowSets] No pubkey available for decryption');
        return { pubkeys: [], title: null };
      }

      // Decrypt content - try NIP-44 first, fallback to NIP-04
      let decrypted: string;
      try {
        decrypted = await this.encryption.decryptNip44(content, pubkey);
      } catch (nip44Error) {
        this.logger.debug('[FollowSets] NIP-44 decryption failed, trying NIP-04...');
        decrypted = await this.encryption.decryptNip04(content, pubkey);
      }

      const parsedPayload = JSON.parse(decrypted) as unknown;
      const { pubkeys, title } = this.extractPrivateFollowSetData(parsedPayload);

      this.logger.debug(`[FollowSets] Decrypted ${pubkeys.length} private pubkeys`);
      return { pubkeys, title };
    } catch (error) {
      this.logger.debug('[FollowSets] Could not decrypt private content:', error);
      return { pubkeys: [], title: null };
    }
  }

  private extractPrivateFollowSetData(payload: unknown): DecryptedFollowSetData {
    if (Array.isArray(payload)) {
      const privateTags = payload.filter((tag): tag is string[] => Array.isArray(tag));

      const pubkeys = privateTags
        .filter(tag => tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].trim() !== '')
        .map(tag => tag[1]);

      const title = privateTags.find(tag =>
        (tag[0] === 'title' || tag[0] === 'name') &&
        typeof tag[1] === 'string' &&
        tag[1].trim() !== ''
      )?.[1] || null;

      return { pubkeys, title };
    }

    if (payload && typeof payload === 'object') {
      const data = payload as DecryptedFollowSetPayload;
      const title = [data.title, data.name, data.label].find(
        (value): value is string => typeof value === 'string' && value.trim() !== ''
      ) || null;

      const candidateArrays = [data.pubkeys, data.people, data.p]
        .filter(Array.isArray) as unknown[][];

      const objectPubkeys = candidateArrays
        .flatMap(array => array)
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '');

      const nestedTagData = [data.tags, data.items].find(Array.isArray);
      const nested = nestedTagData ? this.extractPrivateFollowSetData(nestedTagData) : { pubkeys: [], title: null };

      return {
        pubkeys: Array.from(new Set([...objectPubkeys, ...nested.pubkeys])),
        title: title || nested.title,
      };
    }

    return { pubkeys: [], title: null };
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
      // IMPORTANT: Preserve the original d-tag exactly as provided.
      // Do NOT modify the d-tag here - this prevents creating duplicates when:
      // 1. Editing lists created by other clients (e.g., "followset-favorites")
      // 2. Toggling between private and public
      // The prefix is only added in createFollowSet() for NEW lists.

      // Build tags - only include d and title tags
      const tags: string[][] = [
        ['d', dTag],
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

        // Update decrypted cache so the next startup won't need to decrypt again
        if (isPrivate) {
          await this.database.saveDecryptedFollowSetCache(dTag, signedEvent.id, pubkeys, title);
        }
      } catch (dbError) {
        this.logger.warn('[FollowSets] Failed to save follow set to database:', dbError);
        // Continue anyway - event was published successfully
      }

      // Create FollowSet object for local update
      const followSet: FollowSet = {
        id: signedEvent.id,
        dTag,
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
  private updateLocalFollowSet(updatedSet: FollowSet): boolean {
    let wasUpdated = false;

    this.followSets.update(sets => {
      const index = sets.findIndex(set => set.dTag === updatedSet.dTag);
      if (index >= 0) {
        if (this.followSetsEqual([sets[index]], [updatedSet])) {
          return sets;
        }

        // Update existing
        const newSets = [...sets];
        newSets[index] = updatedSet;
        wasUpdated = true;
        return newSets;
      } else {
        // Add new
        wasUpdated = true;
        return [...sets, updatedSet];
      }
    });

    return wasUpdated;
  }

  private removeLocalFollowSet(dTag: string): boolean {
    let removed = false;

    this.followSets.update(sets => {
      const filteredSets = sets.filter(set => set.dTag !== dTag);
      removed = filteredSets.length !== sets.length;
      return removed ? filteredSets : sets;
    });

    return removed;
  }

  /**
   * Delete a follow set by publishing a kind 5 deletion event (NIP-09)
   */
  async deleteFollowSet(dTag: string, referenceMode: DeleteEventReferenceMode = 'a'): Promise<boolean> {
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
      const deletionEvent: UnsignedEvent = {
        kind: kinds.EventDeletion,
        pubkey: currentPubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Deleted follow set',
        tags: this.buildDeletionTags(followSet.event!, referenceMode),
      };

      // Sign and publish
      await this.publishService.signAndPublishAuto(deletionEvent, this.signFunction);

      // Delete from local database to prevent it from coming back on reload
      if (followSet.id) {
        await this.database.deleteEvent(followSet.id);
        this.logger.debug(`[FollowSets] Deleted event ${followSet.id} from local database`);
      }

      // Clean up decrypted cache for this follow set
      await this.database.deleteDecryptedFollowSetCache(dTag);

      // Remove from local state
      this.followSets.update(sets => sets.filter(set => set.dTag !== dTag));

      this.logger.info(`[FollowSets] Deleted follow set: ${dTag}`);
      return true;
    } catch (error) {
      this.logger.error('[FollowSets] Failed to delete follow set:', error);
      return false;
    }
  }

  private buildDeletionTags(event: Event, referenceMode: DeleteEventReferenceMode): string[][] {
    const dTag = event.tags.find(tag => tag[0] === 'd' && tag[1]?.trim())?.[1]?.trim();

    if (referenceMode === 'a' && dTag) {
      return [
        ['a', `${event.kind}:${event.pubkey}:${dTag}`],
        ['k', String(event.kind)],
      ];
    }

    return [
      ['e', event.id],
      ['k', String(event.kind)],
    ];
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
