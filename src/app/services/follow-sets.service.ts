import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Event, UnsignedEvent, kinds } from 'nostr-tools';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { PublishService } from './publish.service';

export interface FollowSet {
  id: string; // Event ID
  dTag: string; // The d tag identifier (prefixed with "nostria-")
  title: string; // Human-readable name
  pubkeys: string[]; // List of pubkeys in this set
  createdAt: number; // Timestamp
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

  // Signals for reactive state
  followSets = signal<FollowSet[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

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
      if (pubkey) {
        this.loadFollowSets(pubkey);
      } else {
        this.followSets.set([]);
      }
    });
  }

  /**
   * Load follow sets for a given pubkey from database and relays
   */
  async loadFollowSets(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      this.logger.debug('[FollowSets] Loading follow sets for pubkey:', pubkey);

      // Fetch kind 30000 events from database and relays
      const events = await this.dataService.getEventsByPubkeyAndKind(
        pubkey,
        30000,
        {
          cache: true,
          save: true,
        }
      );

      // Filter to only nostria-prefixed follow sets
      const nostriaEvents = events.filter(record => {
        const dTag = this.getDTagFromEvent(record.event);
        return dTag?.startsWith(NOSTRIA_PREFIX);
      });

      // Convert events to FollowSet objects
      const sets = nostriaEvents
        .map(record => this.parseFollowSetEvent(record.event))
        .filter((set): set is FollowSet => set !== null);

      this.followSets.set(sets);
      this.logger.info(`[FollowSets] Loaded ${sets.length} follow sets`);
    } catch (error) {
      this.logger.error('[FollowSets] Failed to load follow sets:', error);
      this.error.set('Failed to load follow sets');
    } finally {
      this.isLoading.set(false);
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
   * Parse a kind 30000 event into a FollowSet object
   */
  private parseFollowSetEvent(event: Event): FollowSet | null {
    try {
      const dTag = this.getDTagFromEvent(event);
      if (!dTag) {
        this.logger.warn('[FollowSets] Event missing d-tag:', event.id);
        return null;
      }

      // Extract title from tags or use d-tag as fallback
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const title = titleTag ? titleTag[1] : this.formatTitle(dTag);

      // Extract pubkeys from p tags
      const pubkeys = event.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      return {
        id: event.id,
        dTag,
        title,
        pubkeys,
        createdAt: event.created_at,
        event,
      };
    } catch (error) {
      this.logger.error('[FollowSets] Failed to parse follow set event:', error);
      return null;
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
    pubkeys: string[]
  ): Promise<FollowSet | null> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('[FollowSets] Cannot save follow set: no current account');
      return null;
    }

    if (!this.signFunction) {
      this.logger.error('[FollowSets] Sign function not set. Cannot save follow set.');
      return null;
    }

    try {
      // Ensure d-tag has nostria prefix
      const prefixedDTag = dTag.startsWith(NOSTRIA_PREFIX) ? dTag : `${NOSTRIA_PREFIX}${dTag}`;

      // Build tags
      const tags: string[][] = [
        ['d', prefixedDTag],
        ['title', title],
        ...pubkeys.map(pubkey => ['p', pubkey]),
      ];

      // Create unsigned event
      const unsignedEvent: UnsignedEvent = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
        pubkey: currentPubkey,
      };

      // Sign and publish
      await this.publishService.signAndPublishAuto(unsignedEvent, this.signFunction);

      // Create FollowSet object for local update
      const followSet: FollowSet = {
        id: '', // Will be set after signing
        dTag: prefixedDTag,
        title,
        pubkeys,
        createdAt: unsignedEvent.created_at,
      };

      // Update local state
      this.updateLocalFollowSet(followSet);

      this.logger.info(`[FollowSets] Saved follow set: ${title}`);
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
   * Delete a follow set
   */
  async deleteFollowSet(dTag: string): Promise<boolean> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('[FollowSets] Cannot delete follow set: no current account');
      return false;
    }

    if (!this.signFunction) {
      this.logger.error('[FollowSets] Sign function not set. Cannot delete follow set.');
      return false;
    }

    try {
      // To delete a replaceable event, publish an empty version
      const tags: string[][] = [
        ['d', dTag],
      ];

      const unsignedEvent: UnsignedEvent = {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
        pubkey: currentPubkey,
      };

      // Sign and publish
      await this.publishService.signAndPublishAuto(unsignedEvent, this.signFunction);

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

    // Add pubkey and save
    const updatedPubkeys = [...followSet.pubkeys, pubkey];
    const result = await this.saveFollowSet(dTag, followSet.title, updatedPubkeys);
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

    // Remove pubkey and save
    const updatedPubkeys = followSet.pubkeys.filter(pk => pk !== pubkey);
    const result = await this.saveFollowSet(dTag, followSet.title, updatedPubkeys);
    return result !== null;
  }

  /**
   * Create a new follow set with a unique d-tag
   */
  async createFollowSet(title: string, pubkeys: string[] = []): Promise<FollowSet | null> {
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

    return this.saveFollowSet(dTag, title, pubkeys);
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
