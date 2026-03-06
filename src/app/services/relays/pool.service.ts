import { Injectable } from '@angular/core';
import { SimplePool } from 'nostr-tools';

/**
 * Provides the single shared SimplePool instance for the application.
 *
 * All services that query or publish to arbitrary relay sets at call-time
 * (RelayPoolService, SharedRelayService, AccountRelayService,
 * DiscoveryRelayService, UserRelayService) share this pool so that only one
 * WebSocket connection per relay URL is maintained.
 *
 * Services that need their own connection lifecycle (SearchRelayService,
 * NwcRelayService) create their own pools independently.
 */
@Injectable({ providedIn: 'root' })
export class PoolService {
  readonly pool = new SimplePool({ enablePing: true, enableReconnect: true });

  /**
   * Gracefully close connections to all provided relay URLs.
   * With enableReconnect:true the pool will reopen them on the next request.
   */
  closeAll(relayUrls: string[]): void {
    if (relayUrls.length > 0) {
      this.pool.close(relayUrls);
    }
  }
}
