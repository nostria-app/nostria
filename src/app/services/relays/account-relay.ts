import { Injectable, inject } from '@angular/core';
import { kinds } from 'nostr-tools';
import { DatabaseService } from '../database.service';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';
import { PoolService } from './pool.service';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService extends RelayServiceBase {
  private database = inject(DatabaseService);
  private discoveryRelay = inject(DiscoveryRelayService);

  constructor() {
    // Use the application-wide shared pool so that connections to the user's
    // relays are reused across AccountRelayService, RelayPoolService and
    // SharedRelayService instead of opening duplicate WebSockets.
    // destroy()/init() will not recreate or close the shared pool.
    super(inject(PoolService).pool);
    // Ensure we always connect to all account relays to maximise data availability
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

    // Get the relays URLs from storage, if available.
    let event = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (event) {
      this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);

      // Check if event has malformed 'relay' tags instead of 'r' tags
      const hasRelayTags = event.tags.some(tag => tag[0] === 'relay');
      const hasRTags = event.tags.some(tag => tag[0] === 'r');

      if (hasRelayTags && !hasRTags) {
        this.logger.warn(`Found malformed kind 10002 event with 'relay' tags instead of 'r' tags`);
        hasMalformedRelayList = true;
        malformedEvent = event;
        // Don't use malformed relays - leave relayUrls empty to force user to repair
        relayUrls = [];
      } else {
        // Keep the user's relay list intact in account settings, including known dead/ignored domains.
        relayUrls = this.utilities.getRelayUrls(event, true);
      }
    } else {
      event = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (event) {
        // Preserve relays from legacy contacts relay maps as-is for account ownership visibility.
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event, true);
      }
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
