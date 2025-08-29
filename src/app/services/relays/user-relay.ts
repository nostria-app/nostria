import { Injectable, inject } from '@angular/core';
import { SimplePool } from 'nostr-tools';
import { RelayServiceBase } from './relay';
import { DiscoveryRelayService } from './discovery-relay';

@Injectable({
  providedIn: 'root',
})
export class UserRelayService extends RelayServiceBase {
  private discoveryRelay = inject(DiscoveryRelayService);
  private pubkey = '';

  constructor() {
    super(new SimplePool());
    this.useOptimizedRelays = true;
  }

  async initialize(pubkey: string): Promise<void> {
    if (this.pubkey === pubkey) {
      return;
    }

    this.pubkey = pubkey;

    const relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    this.init(relayUrls);
  }
}
