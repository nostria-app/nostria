import { Injectable, inject, signal } from '@angular/core';
import { kinds } from 'nostr-tools';
import { DatabaseService } from './database.service';
import { AccountRelayService } from './relays/account-relay';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { SearchRelayListKind } from './relays/search-relay';
import { TRUST_PROVIDER_LIST_KIND } from './trust-provider.service';

/**
 * Important event kinds that should be republished when user edits their relays
 * to ensure their data is accessible on all their relays.
 */
export const IMPORTANT_EVENT_KINDS = [
  kinds.Metadata,            // 0 - Profile
  kinds.Contacts,            // 3 - Following list
  kinds.Mutelist,            // 10000 - Mute list
  kinds.RelayList,           // 10002 - Relay list
  kinds.BookmarkList,        // 10003 - Bookmark list
  SearchRelayListKind,       // 10007 - Search relays list
  TRUST_PROVIDER_LIST_KIND,  // 10040 - NIP-85 Trusted Service Providers
  kinds.DirectMessageRelaysList, // 10050 - DM Relays list
  10063,                     // Media server list (BUD-03)
];

/**
 * Service responsible for republishing important user events to all account relays.
 * This ensures that when a user modifies their relay list, all critical data
 * (profile, following, mutes, bookmarks, etc.) is synced to the new relays.
 */
@Injectable({
  providedIn: 'root',
})
export class EventRepublishService {
  private readonly database = inject(DatabaseService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);

  // Track republishing state
  isRepublishing = signal(false);
  republishProgress = signal<{ current: number; total: number; kind?: number }>({ current: 0, total: 0 });
  lastRepublishResult = signal<{ success: number; failed: number; notFound: number } | null>(null);

  /**
   * Republish all important events to all account relays.
   * This should be called when user modifies their relay list.
   * 
   * @param pubkey The user's pubkey (optional, defaults to current account)
   * @returns Summary of republishing results
   */
  async republishImportantEvents(pubkey?: string): Promise<{
    success: number;
    failed: number;
    notFound: number;
    details: { kind: number; status: 'success' | 'failed' | 'notFound' }[];
  }> {
    const userPubkey = pubkey || this.accountState.pubkey();

    if (!userPubkey) {
      this.logger.warn('Cannot republish events: no active account');
      return { success: 0, failed: 0, notFound: 0, details: [] };
    }

    this.isRepublishing.set(true);
    this.republishProgress.set({ current: 0, total: IMPORTANT_EVENT_KINDS.length });

    const results = {
      success: 0,
      failed: 0,
      notFound: 0,
      details: [] as { kind: number; status: 'success' | 'failed' | 'notFound' }[],
    };

    this.logger.info(`Starting republish of ${IMPORTANT_EVENT_KINDS.length} important event kinds`, {
      pubkey: userPubkey,
      kinds: IMPORTANT_EVENT_KINDS,
    });

    try {
      for (let i = 0; i < IMPORTANT_EVENT_KINDS.length; i++) {
        const kind = IMPORTANT_EVENT_KINDS[i];
        this.republishProgress.set({ current: i + 1, total: IMPORTANT_EVENT_KINDS.length, kind });

        try {
          const event = await this.database.getEventByPubkeyAndKind(userPubkey, kind);

          if (event) {
            this.logger.debug(`Republishing event kind ${kind}`, { eventId: event.id });

            await this.accountRelay.publish(event);

            results.success++;
            results.details.push({ kind, status: 'success' });
            this.logger.debug(`Successfully republished event kind ${kind}`);
          } else {
            results.notFound++;
            results.details.push({ kind, status: 'notFound' });
            this.logger.debug(`Event kind ${kind} not found for user`);
          }
        } catch (error) {
          results.failed++;
          results.details.push({ kind, status: 'failed' });
          this.logger.error(`Failed to republish event kind ${kind}`, error);
        }
      }
    } finally {
      this.isRepublishing.set(false);
      this.lastRepublishResult.set({
        success: results.success,
        failed: results.failed,
        notFound: results.notFound,
      });
    }

    this.logger.info('Republish complete', results);
    return results;
  }

  /**
   * Get the event kinds that are considered important for republishing
   */
  getImportantEventKinds(): number[] {
    return [...IMPORTANT_EVENT_KINDS];
  }

  /**
   * Get a human-readable name for an event kind
   */
  getEventKindName(kind: number): string {
    switch (kind) {
      case kinds.Metadata:
        return 'Profile';
      case kinds.Contacts:
        return 'Following List';
      case kinds.Mutelist:
        return 'Mute List';
      case kinds.RelayList:
        return 'Relay List';
      case kinds.BookmarkList:
        return 'Bookmark List';
      case SearchRelayListKind:
        return 'Search Relays';
      case TRUST_PROVIDER_LIST_KIND:
        return 'Trust Providers';
      case kinds.DirectMessageRelaysList:
        return 'DM Relays';
      case 10063:
        return 'Media Servers';
      default:
        return `Kind ${kind}`;
    }
  }
}
