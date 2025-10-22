import { Injectable, inject } from '@angular/core';
import { kinds, SimplePool } from 'nostr-tools';
import { StorageService } from '../storage.service';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayService extends RelayServiceBase {
  private storage = inject(StorageService);
  private discoveryRelay = inject(DiscoveryRelayService);

  constructor() {
    // TODO: We always create a new instance here that will be immediately destroyed by setAccount.
    super(new SimplePool());
  }

  async setAccount(pubkey: string, destroy = false) {
    if (destroy) {
      this.destroy();
    }

    // When the active user is changed, we need to discover their relay urls
    this.logger.debug(`Setting account relays for pubkey: ${pubkey}`);

    let relayUrls: string[] = [];

    // Get the relays URLs from storage, if available.
    let event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (event) {
      this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);
      relayUrls = this.utilities.getRelayUrls(event);
    } else {
      event = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
      }
    }

    if (relayUrls.length === 0) {
      relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    }

    this.init(relayUrls);
  }

  clear() {}
}
