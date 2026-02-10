import { inject, Injectable } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';

/**
 * Service that checks deletion events (NIP-09) on demand.
 *
 * No data is pre-loaded at startup. Instead, when a consumer needs to filter
 * out deleted events it calls one of the on-demand methods which scan the
 * local database for matching kind 5 deletion events.
 *
 * Consumers:
 * - FollowSetsService, CollectionSetsService, CurationSetsService,
 *   FollowPacksService — call filterDeletedEventsFromDatabase() after
 *   loading their lists from DB / relays.
 * - EventService — has its own checkDeletionRequest() for individual
 *   events opened by the user.
 */
@Injectable({
  providedIn: 'root',
})
export class DeletionFilterService {
  private readonly logger = inject(LoggerService);
  private readonly database = inject(DatabaseService);
  private readonly accountState = inject(AccountStateService);

  /**
   * Check if an addressable event has been deleted by scanning the local
   * database for deletion events.
   *
   * @param kind The event kind
   * @param pubkey The event pubkey
   * @param dTag The d-tag value
   * @param createdAt The event timestamp to compare against deletion time
   * @returns true if a matching deletion event is found in the local database
   */
  async checkDeletionFromDatabase(kind: number, pubkey: string, dTag: string, createdAt: number): Promise<boolean> {
    const currentPubkey = this.accountState.pubkey();
    if (pubkey !== currentPubkey) {
      return false;
    }

    try {
      await this.database.init();
      const deletionEvents = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.EventDeletion);

      const addressableIdentifier = `${kind}:${pubkey}:${dTag}`;

      for (const event of deletionEvents) {
        // Check a-tags for addressable event deletion
        for (const tag of event.tags) {
          if (tag[0] === 'a' && tag[1] === addressableIdentifier) {
            if (createdAt <= event.created_at) {
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error('[DeletionFilter] Error checking deletion from database:', error);
      return false;
    }
  }

  /**
   * Filter an array of events, removing those that have been deleted.
   * Checks the local database for deletion events targeting the given events.
   *
   * @param events The events to filter
   * @returns The events that have not been deleted
   */
  async filterDeletedEventsFromDatabase(events: Event[]): Promise<Event[]> {
    const currentPubkey = this.accountState.pubkey();
    if (events.length === 0 || !currentPubkey) {
      return events;
    }

    // Only check events from the current user
    const userEvents = events.filter(e => e.pubkey === currentPubkey);
    if (userEvents.length === 0) {
      return events;
    }

    try {
      await this.database.init();
      const deletionEvents = await this.database.getEventsByPubkeyAndKind(currentPubkey, kinds.EventDeletion);

      if (deletionEvents.length === 0) {
        return events;
      }

      // Build a map of deleted addressable identifiers with their deletion timestamps
      const deletedAddressables = new Map<string, number>();
      const deletedEventIds = new Map<string, number>();

      for (const delEvent of deletionEvents) {
        for (const tag of delEvent.tags) {
          if (tag[0] === 'a' && tag[1]) {
            const existing = deletedAddressables.get(tag[1]);
            if (!existing || delEvent.created_at > existing) {
              deletedAddressables.set(tag[1], delEvent.created_at);
            }
          } else if (tag[0] === 'e' && tag[1]) {
            const existing = deletedEventIds.get(tag[1]);
            if (!existing || delEvent.created_at > existing) {
              deletedEventIds.set(tag[1], delEvent.created_at);
            }
          }
        }
      }

      return events.filter(event => {
        // Check by event ID
        const deletedAtById = deletedEventIds.get(event.id);
        if (deletedAtById !== undefined && event.created_at <= deletedAtById) {
          return false;
        }

        // Check by addressable identifier
        if (this.isAddressableEvent(event.kind)) {
          const dTag = this.extractDTag(event);
          if (dTag !== null) {
            const identifier = `${event.kind}:${event.pubkey}:${dTag}`;
            const deletedAt = deletedAddressables.get(identifier);
            if (deletedAt !== undefined && event.created_at <= deletedAt) {
              return false;
            }
          }
        }

        return true;
      });
    } catch (error) {
      this.logger.error('[DeletionFilter] Error filtering deleted events from database:', error);
      return events;
    }
  }

  /**
   * Check if a kind is an addressable (replaceable) event kind.
   * Addressable events: 30000-39999 (parameterized replaceable)
   * Also includes 0, 3, 10000-19999 (replaceable)
   */
  private isAddressableEvent(kind: number): boolean {
    // Parameterized replaceable events (have d-tag)
    if (kind >= 30000 && kind <= 39999) {
      return true;
    }
    // Regular replaceable events (no d-tag, but use empty string)
    if (kind === 0 || kind === 3 || (kind >= 10000 && kind <= 19999)) {
      return true;
    }
    return false;
  }

  /**
   * Extract the d-tag value from an event.
   */
  private extractDTag(event: Event): string | null {
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag && dTag.length > 1 ? dTag[1] : '';
  }
}
