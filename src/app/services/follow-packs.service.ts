import { Injectable, inject } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { DeletionFilterService } from './deletion-filter.service';

const FOLLOW_PACK_KIND = 39089;

export interface FollowPack {
  identifier: string; // d-tag
  title: string;
  description?: string;
  image?: string;
  pubkeys: string[];
  eventId: string;
  created_at: number;
}

@Injectable({
  providedIn: 'root',
})
export class FollowPacksService {
  private logger = inject(LoggerService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private publishService = inject(PublishService);
  private accountRelay = inject(AccountRelayService);
  private deletionFilter = inject(DeletionFilterService);

  /**
   * Get all follow packs for a given pubkey.
   * Database-first strategy with relay fallback.
   */
  async getFollowPacks(pubkey: string): Promise<FollowPack[]> {
    try {
      await this.database.init();

      // Try local database first
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, FOLLOW_PACK_KIND);

      // Filter out deleted events (on-demand check from local database)
      events = await this.deletionFilter.filterDeletedEventsFromDatabase(events);

      // If no local data, fetch from relays
      if (events.length === 0) {
        const relayEvents = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, FOLLOW_PACK_KIND);
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

      // Convert to FollowPack objects
      const packs: FollowPack[] = [];
      for (const [identifier, event] of eventsByDTag) {
        const pack = this.parseFollowPackEvent(event, identifier);
        if (pack) {
          packs.push(pack);
        }
      }

      return packs;
    } catch (error) {
      this.logger.error('Error loading follow packs:', error);
      return [];
    }
  }

  /**
   * Create a new follow pack.
   */
  async createFollowPack(
    title: string,
    pubkeys: string[],
    description?: string,
    image?: string
  ): Promise<FollowPack | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    const identifier = `follow-pack-${Date.now()}`;
    const success = await this.saveFollowPack(identifier, title, pubkeys, description, image);

    if (success) {
      return {
        identifier,
        title,
        description,
        image,
        pubkeys,
        eventId: '',
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    return null;
  }

  /**
   * Save (create or update) a follow pack.
   */
  async saveFollowPack(
    identifier: string,
    title: string,
    pubkeys: string[],
    description?: string,
    image?: string
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

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

      for (const pk of pubkeys) {
        tags.push(['p', pk]);
      }

      const event = this.nostrService.createEvent(FOLLOW_PACK_KIND, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveEvent(signedEvent);

      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving follow pack:', error);
      return false;
    }
  }

  /**
   * Delete a follow pack using a kind 5 deletion event (NIP-09).
   */
  async deleteFollowPack(identifier: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const tags: string[][] = [
        ['a', `${FOLLOW_PACK_KIND}:${pubkey}:${identifier}`],
      ];

      const event = this.nostrService.createEvent(kinds.EventDeletion, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveEvent(signedEvent);

      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error deleting follow pack:', error);
      return false;
    }
  }

  /**
   * Parse a follow pack event into a FollowPack object.
   */
  private parseFollowPackEvent(event: Event, identifier: string): FollowPack | null {
    try {
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const descriptionTag = event.tags.find(tag => tag[0] === 'description');
      const imageTag = event.tags.find(tag => tag[0] === 'image');
      const pubkeyTags = event.tags.filter(tag => tag[0] === 'p');

      return {
        identifier,
        title: titleTag?.[1] || identifier,
        description: descriptionTag?.[1],
        image: imageTag?.[1],
        pubkeys: pubkeyTags.map(tag => tag[1]),
        eventId: event.id,
        created_at: event.created_at,
      };
    } catch (error) {
      this.logger.error('Failed to parse follow pack event:', error);
      return null;
    }
  }
}
