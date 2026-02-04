import { Injectable, inject } from '@angular/core';
import { kinds, SimplePool } from 'nostr-tools';
import { DatabaseService } from '../database.service';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService extends RelayServiceBase {
  private database = inject(DatabaseService);
  private discoveryRelay = inject(DiscoveryRelayService);

  constructor() {
    // TODO: We always create a new instance here that will be immediately destroyed by setAccount.
    super(new SimplePool({ enablePing: true, enableReconnect: true }));
    // Ensure we always connect to all account relays to maximize data availability
    this.useOptimizedRelays = false;
  }

  async setAccount(pubkey: string, destroy = false): Promise<{
    relayUrls: string[];
    hasMalformedRelayList: boolean;
    malformedEvent?: any;
  }> {
    if (destroy) {
      this.destroy();
    }

    // When the active user is changed, we need to discover their relay urls
    this.logger.debug(`Setting account relays for pubkey: ${pubkey}`);

    let relayUrls: string[] = [];
    let hasMalformedRelayList = false;
    let malformedEvent: any = undefined;

    // OPTIMIZATION: Query both RelayList (10002) and Contacts (3) in parallel
    // This reduces initialization time when RelayList is not found
    const [relayListEvent, contactsEvent] = await Promise.all([
      this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList),
      this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts),
    ]);

    // Prefer RelayList (kind 10002) over Contacts (kind 3)
    if (relayListEvent) {
      this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);

      // Check if event has malformed 'relay' tags instead of 'r' tags
      const hasRelayTags = relayListEvent.tags.some(tag => tag[0] === 'relay');
      const hasRTags = relayListEvent.tags.some(tag => tag[0] === 'r');

      if (hasRelayTags && !hasRTags) {
        this.logger.warn(`Found malformed kind 10002 event with 'relay' tags instead of 'r' tags`);
        hasMalformedRelayList = true;
        malformedEvent = relayListEvent;
        // Don't use malformed relays - leave relayUrls empty to force user to repair
        relayUrls = [];
      } else {
        relayUrls = this.utilities.getRelayUrls(relayListEvent);
      }
    } else if (contactsEvent) {
      // Fall back to Contacts event (already fetched in parallel)
      this.logger.debug(`Using contacts event for relay URLs for pubkey ${pubkey}`);
      relayUrls = this.utilities.getRelayUrlsFromFollowing(contactsEvent);
    }

    if (relayUrls.length === 0) {
      relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    }

    this.init(relayUrls);

    return {
      relayUrls,
      hasMalformedRelayList,
      malformedEvent,
    };
  }

  clear() { }
}
