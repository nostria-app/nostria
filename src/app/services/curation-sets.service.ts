import { Injectable, inject } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { DeletionFilterService } from './deletion-filter.service';

export const ARTICLE_CURATION_KIND = 30004;
export const VIDEO_CURATION_KIND = 30005;
export const PICTURE_CURATION_KIND = 30006;

export type CurationKind = typeof ARTICLE_CURATION_KIND | typeof VIDEO_CURATION_KIND | typeof PICTURE_CURATION_KIND;

export interface EventRef {
  id: string;           // 64-char hex event ID
  relay?: string;       // relay hint URL
  pubkey?: string;      // author pubkey
}

export interface AddressableRef {
  coordinates: string;  // kind:pubkey:d-tag
  relay?: string;       // relay hint URL
}

export interface CurationSet {
  identifier: string; // d-tag
  title: string;
  description?: string;
  image?: string;
  eventRefs: EventRef[];           // e tags with relay hints and pubkeys
  addressableRefs: AddressableRef[]; // a tags with relay hints
  kind: CurationKind;
  eventId: string;
  created_at: number;
}

@Injectable({
  providedIn: 'root',
})
export class CurationSetsService {
  private logger = inject(LoggerService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private publishService = inject(PublishService);
  private accountRelay = inject(AccountRelayService);
  private deletionFilter = inject(DeletionFilterService);

  /**
   * Get all curation sets of a given kind for a pubkey.
   * Database-first strategy with relay fallback.
   */
  async getCurationSets(pubkey: string, kind: CurationKind): Promise<CurationSet[]> {
    try {
      await this.database.init();

      // Try local database first
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, kind);

      // Filter out deleted events (on-demand check from local database)
      events = await this.deletionFilter.filterDeletedEventsFromDatabase(events);

      // If no local data, fetch from relays
      if (events.length === 0) {
        const relayEvents = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, kind);
        events = await this.deletionFilter.filterDeletedEventsFromDatabase(relayEvents);

        // Save to local database for next time
        for (const event of events) {
          await this.database.saveEvent(event);
        }
      }

      // Group by d-tag, keep most recent per d-tag
      const eventsByDTag = new Map<string, Event>();
      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!dTag) continue;
        const existing = eventsByDTag.get(dTag);
        if (!existing || event.created_at > existing.created_at) {
          eventsByDTag.set(dTag, event);
        }
      }

      // Convert to CurationSet objects
      const sets: CurationSet[] = [];
      for (const [identifier, event] of eventsByDTag) {
        const set = this.parseCurationSetEvent(event, identifier, kind);
        if (set) {
          sets.push(set);
        }
      }

      return sets;
    } catch (error) {
      this.logger.error('Error loading curation sets:', error);
      return [];
    }
  }

  /**
   * Create a new curation set.
   */
  async createCurationSet(
    kind: CurationKind,
    title: string,
    eventRefs: (EventRef | string)[],
    addressableRefs: (AddressableRef | string)[],
    description?: string,
    image?: string
  ): Promise<CurationSet | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const normalizedEventRefs = this.normalizeEventRefs(eventRefs);
    const normalizedAddressableRefs = this.normalizeAddressableRefs(addressableRefs);

    const identifier = `board-${Date.now()}`;
    const success = await this.saveCurationSet(identifier, kind, title, normalizedEventRefs, normalizedAddressableRefs, description, image);

    if (success) {
      return {
        identifier,
        title,
        description,
        image,
        eventRefs: normalizedEventRefs,
        addressableRefs: normalizedAddressableRefs,
        kind,
        eventId: '',
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    return null;
  }

  /**
   * Save (create or update) a curation set.
   */
  async saveCurationSet(
    identifier: string,
    kind: CurationKind,
    title: string,
    eventRefs: (EventRef | string)[],
    addressableRefs: (AddressableRef | string)[],
    description?: string,
    image?: string
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    const normalizedEventRefs = this.normalizeEventRefs(eventRefs);
    const normalizedAddressableRefs = this.normalizeAddressableRefs(addressableRefs);

    try {
      const tags: string[][] = [
        ['d', identifier],
        ['title', title],
      ];

      if (description) {
        tags.push(['description', description]);
      }

      if (image) {
        tags.push(['image', image]);
      }

      for (const ref of normalizedEventRefs) {
        const tag = ['e', ref.id];
        if (ref.relay || ref.pubkey) {
          tag.push(ref.relay || '');   // index 2: relay
          if (ref.pubkey) {
            tag.push(ref.pubkey);      // index 3: pubkey
          }
        }
        tags.push(tag);
      }

      for (const ref of normalizedAddressableRefs) {
        const tag = ['a', ref.coordinates];
        if (ref.relay) {
          tag.push(ref.relay);         // index 2: relay
        }
        tags.push(tag);
      }

      const event = this.nostrService.createEvent(kind, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveEvent(signedEvent);

      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving curation set:', error);
      return false;
    }
  }

  /**
   * Add a single event reference to an existing curation set.
   * Used when bookmarking to a board.
   * Accepts either a bare string ID or a structured EventRef/AddressableRef.
   */
  async addToCurationSet(
    identifier: string,
    kind: CurationKind,
    itemId: string,
    itemType: 'e' | 'a',
    relay?: string,
    pubkey?: string
  ): Promise<boolean> {
    const accountPubkey = this.accountState.pubkey();
    if (!accountPubkey) return false;

    try {
      // Load current sets to find the one we're adding to
      const sets = await this.getCurationSets(accountPubkey, kind);
      const existingSet = sets.find(s => s.identifier === identifier);

      if (!existingSet) {
        this.logger.error('Curation set not found:', identifier);
        return false;
      }

      // Check if already in the set
      if (itemType === 'e' && existingSet.eventRefs.some(ref => ref.id === itemId)) {
        return true; // Already present
      }
      if (itemType === 'a' && existingSet.addressableRefs.some(ref => ref.coordinates === itemId)) {
        return true; // Already present
      }

      // Add the new reference
      const eventRefs: EventRef[] = [...existingSet.eventRefs];
      const addressableRefs: AddressableRef[] = [...existingSet.addressableRefs];

      if (itemType === 'e') {
        eventRefs.push({ id: itemId, relay, pubkey });
      } else {
        addressableRefs.push({ coordinates: itemId, relay });
      }

      return await this.saveCurationSet(
        identifier,
        kind,
        existingSet.title,
        eventRefs,
        addressableRefs,
        existingSet.description,
        existingSet.image
      );
    } catch (error) {
      this.logger.error('Error adding to curation set:', error);
      return false;
    }
  }

  /**
   * Remove a single event reference from an existing curation set.
   */
  async removeFromCurationSet(
    identifier: string,
    kind: CurationKind,
    itemId: string,
    itemType: 'e' | 'a'
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const sets = await this.getCurationSets(pubkey, kind);
      const existingSet = sets.find(s => s.identifier === identifier);

      if (!existingSet) {
        this.logger.error('Curation set not found:', identifier);
        return false;
      }

      const eventRefs: EventRef[] = itemType === 'e'
        ? existingSet.eventRefs.filter(ref => ref.id !== itemId)
        : [...existingSet.eventRefs];
      const addressableRefs: AddressableRef[] = itemType === 'a'
        ? existingSet.addressableRefs.filter(ref => ref.coordinates !== itemId)
        : [...existingSet.addressableRefs];

      return await this.saveCurationSet(
        identifier,
        kind,
        existingSet.title,
        eventRefs,
        addressableRefs,
        existingSet.description,
        existingSet.image
      );
    } catch (error) {
      this.logger.error('Error removing from curation set:', error);
      return false;
    }
  }

  /**
   * Check if an item is in a specific curation set.
   */
  isInCurationSet(set: CurationSet, itemId: string, itemType: 'e' | 'a'): boolean {
    if (itemType === 'e') {
      return set.eventRefs.some(ref => ref.id === itemId);
    }
    return set.addressableRefs.some(ref => ref.coordinates === itemId);
  }

  /**
   * Delete a curation set using a kind 5 deletion event (NIP-09).
   */
  async deleteCurationSet(identifier: string, kind: CurationKind): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const tags: string[][] = [
        ['a', `${kind}:${pubkey}:${identifier}`],
      ];

      const event = this.nostrService.createEvent(kinds.EventDeletion, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveEvent(signedEvent);

      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error deleting curation set:', error);
      return false;
    }
  }

  /**
   * Get the appropriate curation kind for a given event kind.
   * Returns null if the event kind doesn't map to a curation type.
   */
  getCurationKindForEvent(eventKind: number): CurationKind | null {
    // Articles (kind 30023) and notes (kind 1) -> Article curation (30004)
    if (eventKind === 1 || eventKind === kinds.LongFormArticle) {
      return ARTICLE_CURATION_KIND;
    }
    // Videos (kind 21, 22, 34235, 34236) -> Video curation (30005)
    if (eventKind === 21 || eventKind === 22 || eventKind === 34235 || eventKind === 34236) {
      return VIDEO_CURATION_KIND;
    }
    // Pictures (kind 20) -> Picture curation (30006)
    if (eventKind === 20) {
      return PICTURE_CURATION_KIND;
    }
    return null;
  }

  /**
   * Get human-readable label for a curation kind.
   */
  getCurationLabel(kind: CurationKind): string {
    switch (kind) {
      case ARTICLE_CURATION_KIND:
        return 'Posts & Articles';
      case VIDEO_CURATION_KIND:
        return 'Videos';
      case PICTURE_CURATION_KIND:
        return 'Pictures';
      default:
        return 'Board';
    }
  }

  /**
   * Normalize an array of event refs that may be bare strings or EventRef objects.
   * This allows backward-compatible callers to pass plain string IDs.
   */
  private normalizeEventRefs(refs: (EventRef | string)[]): EventRef[] {
    return refs.map(ref => typeof ref === 'string' ? { id: ref } : ref);
  }

  /**
   * Normalize an array of addressable refs that may be bare strings or AddressableRef objects.
   * This allows backward-compatible callers to pass plain string coordinates.
   */
  private normalizeAddressableRefs(refs: (AddressableRef | string)[]): AddressableRef[] {
    return refs.map(ref => typeof ref === 'string' ? { coordinates: ref } : ref);
  }

  /**
   * Parse a curation set event into a CurationSet object.
   */
  private parseCurationSetEvent(event: Event, identifier: string, kind: CurationKind): CurationSet | null {
    try {
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const descriptionTag = event.tags.find(tag => tag[0] === 'description');
      const imageTag = event.tags.find(tag => tag[0] === 'image');
      const eventRefTags = event.tags.filter(tag => tag[0] === 'e');
      const addressableRefTags = event.tags.filter(tag => tag[0] === 'a');

      this.logger.debug('[CurationSets] Parsing event:', event.id.substring(0, 16), '| identifier:', identifier, '| kind:', kind);
      this.logger.debug('[CurationSets] Raw tags:', JSON.stringify(event.tags));
      this.logger.debug('[CurationSets] Found', eventRefTags.length, 'e-tags,', addressableRefTags.length, 'a-tags');
      for (const tag of eventRefTags) {
        this.logger.debug('[CurationSets]   e-tag:', { id: tag[1]?.substring(0, 16), relay: tag[2], pubkey: tag[3]?.substring(0, 16), fullTag: tag });
      }
      for (const tag of addressableRefTags) {
        this.logger.debug('[CurationSets]   a-tag:', { coordinates: tag[1], relay: tag[2], fullTag: tag });
      }

      return {
        identifier,
        title: titleTag?.[1] || identifier,
        description: descriptionTag?.[1],
        image: imageTag?.[1],
        eventRefs: eventRefTags.map(tag => ({
          id: tag[1],
          relay: tag[2] || undefined,
          pubkey: tag[3] || undefined,
        })),
        addressableRefs: addressableRefTags.map(tag => ({
          coordinates: tag[1],
          relay: tag[2] || undefined,
        })),
        kind,
        eventId: event.id,
        created_at: event.created_at,
      };
    } catch (error) {
      this.logger.error('Failed to parse curation set event:', error);
      return null;
    }
  }
}
