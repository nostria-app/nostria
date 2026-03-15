import { Injectable, inject, signal } from '@angular/core';
import { kinds } from 'nostr-tools';
import { DatabaseService } from '../database.service';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';
import { PoolService } from './pool.service';
import { RelayEntry } from '../utilities.service';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService extends RelayServiceBase {
  private database = inject(DatabaseService);
  private discoveryRelay = inject(DiscoveryRelayService);
  readonly activeAccountPubkey = signal<string>('');
  readonly loadingAccountPubkey = signal<string>('');

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
          // Load relay entries with read/write markers from NIP-65
          relayEntries = this.utilities.getRelayEntries(event, true);
          relayUrls = relayEntries.map(e => e.url);
        }
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
