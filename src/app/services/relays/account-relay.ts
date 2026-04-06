import { Injectable, inject, signal } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { DatabaseService } from '../database.service';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';
import { PoolService } from './pool.service';
import { RelayEntry } from '../utilities.service';
import { DEFAULT_ACCOUNT_RELAYS } from './default-account-relays';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService extends RelayServiceBase {
  private database = inject(DatabaseService);
  private discoveryRelay = inject(DiscoveryRelayService);
  readonly activeAccountPubkey = signal<string>('');
  readonly loadingAccountPubkey = signal<string>('');

  private getRelayListState(event: Event): {
    relayUrls: string[];
    relayEntries: RelayEntry[];
    hasMalformedRelayList: boolean;
    malformedEvent?: Event;
  } {
    const hasRelayTags = event.tags.some(tag => tag[0] === 'relay');
    const hasRTags = event.tags.some(tag => tag[0] === 'r');

    if (hasRelayTags && !hasRTags) {
      this.logger.warn(`Found malformed kind 10002 event with 'relay' tags instead of 'r' tags`);
      return {
        relayUrls: [],
        relayEntries: [],
        hasMalformedRelayList: true,
        malformedEvent: event,
      };
    }

    const relayEntries = this.utilities.getRelayEntries(event, true);
    return {
      relayUrls: relayEntries.map(entry => entry.url),
      relayEntries,
      hasMalformedRelayList: false,
    };
  }

  constructor() {
    // Use the application-wide shared pool so that connections to the user's
    // relays are reused across AccountRelayService, RelayPoolService and
    // SharedRelayService instead of opening duplicate WebSockets.
    // destroy()/init() will not recreate or close the shared pool.
    super(inject(PoolService).pool);
    // Ensure we always connect to all account relays to maximise data availability
    this.useOptimizedRelays = false;
    // Preserve user-configured relay domains (including known dead/ignored) in account relay state.
    this.keepIgnoredRelayDomains = true;
  }

  async setAccount(pubkey: string, destroy = false): Promise<{
    relayUrls: string[];
    hasMalformedRelayList: boolean;
    malformedEvent?: any;
  }> {
    this.loadingAccountPubkey.set(pubkey);
    this.activeAccountPubkey.set('');

    if (destroy) {
      this.destroy();
    }

    // When the active user is changed, we need to discover their relay urls
    this.logger.debug(`Setting account relays for pubkey: ${pubkey}`);

    let relayUrls: string[] = [];
    let relayEntries: RelayEntry[] = [];
    let hasMalformedRelayList = false;
    let malformedEvent: any = undefined;

    try {
      // Get the relays URLs from storage, if available.
      let event = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

      if (event) {
        this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);

        const relayListState = this.getRelayListState(event);
        relayUrls = relayListState.relayUrls;
        relayEntries = relayListState.relayEntries;
        hasMalformedRelayList = relayListState.hasMalformedRelayList;
        malformedEvent = relayListState.malformedEvent;
      } else {
        event = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

        if (event) {
          // Preserve relays from legacy contacts relay maps as-is for account ownership visibility.
          relayUrls = this.utilities.getRelayUrlsFromFollowing(event, true);
        }
      }

      if (relayUrls.length === 0 && relayEntries.length === 0) {
        relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
      }

      if (relayUrls.length === 0 && relayEntries.length === 0) {
        const fallbackRelayListEvent = await this.getWithRelays<Event>(
          {
            authors: [pubkey],
            kinds: [kinds.RelayList],
            limit: 1,
          },
          [...DEFAULT_ACCOUNT_RELAYS],
          { timeout: 2500 },
        );

        if (fallbackRelayListEvent) {
          this.logger.info('Found relay list via default account relays during account bootstrap', {
            pubkey,
            relayCount: fallbackRelayListEvent.tags.length,
          });

          try {
            await this.database.saveReplaceableEvent(fallbackRelayListEvent);
          } catch (error) {
            this.logger.warn(`Failed to save fallback relay list event for pubkey ${pubkey}:`, error);
          }

          const relayListState = this.getRelayListState(fallbackRelayListEvent);
          relayUrls = relayListState.relayUrls;
          relayEntries = relayListState.relayEntries;
          hasMalformedRelayList = relayListState.hasMalformedRelayList;
          malformedEvent = relayListState.malformedEvent;
        }
      }

      // Use initWithEntries if we have relay entries with markers, otherwise fall back to init
      if (relayEntries.length > 0) {
        this.initWithEntries(relayEntries);
      } else {
        this.init(relayUrls);
      }
      this.activeAccountPubkey.set(pubkey);

      return {
        relayUrls,
        hasMalformedRelayList,
        malformedEvent,
      };
    } finally {
      // Clear loading state only if we are still loading the same account.
      if (this.loadingAccountPubkey() === pubkey) {
        this.loadingAccountPubkey.set('');
      }
    }
  }

  clear() {
    this.activeAccountPubkey.set('');
    this.loadingAccountPubkey.set('');
  }
}
