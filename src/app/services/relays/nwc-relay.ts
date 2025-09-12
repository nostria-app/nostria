import { Injectable, inject } from '@angular/core';
import { SimplePool, Event, Filter } from 'nostr-tools';
import { RelayServiceBase } from './relay';
import { LoggerService } from '../logger.service';

/**
 * Dedicated relay service for Nostr Wallet Connect (NWC) operations
 * This service manages connections to specific NWC relays mentioned in connection strings
 */
@Injectable({
  providedIn: 'root',
})
export class NwcRelayService extends RelayServiceBase {
  protected override logger = inject(LoggerService);
  private connectionPools = new Map<string, SimplePool>();

  constructor() {
    super(new SimplePool());
  }

  /**
   * Get or create a pool for specific NWC relays
   */
  private getPoolForRelays(relayUrls: string[]): SimplePool {
    const key = relayUrls.sort().join(',');

    if (!this.connectionPools.has(key)) {
      const pool = new SimplePool();
      this.connectionPools.set(key, pool);
      this.logger.debug('Created new NWC pool for relays:', relayUrls);
    }

    return this.connectionPools.get(key)!;
  }

  /**
   * Publish a NWC request to specific relays from the connection string
   */
  async publishNwcRequest(event: Event, nwcRelayUrls: string[]): Promise<Promise<string>[]> {
    try {
      this.logger.debug('Publishing NWC request to relays:', nwcRelayUrls);
      this.logger.debug('NWC request event:', event);

      if (!nwcRelayUrls || nwcRelayUrls.length === 0) {
        throw new Error('No NWC relay URLs provided');
      }

      const pool = this.getPoolForRelays(nwcRelayUrls);
      const publishResults = pool.publish(nwcRelayUrls, event);

      this.logger.debug('NWC publish results:', publishResults);
      return publishResults;
    } catch (error) {
      this.logger.error('Error publishing NWC request:', error);
      throw error;
    }
  }

  /**
   * Subscribe to NWC responses on specific relays
   */
  subscribeToNwcResponse(
    filters: Filter[],
    nwcRelayUrls: string[],
    onEvent: (event: Event) => void,
    onEose?: () => void,
  ): { unsubscribe: () => void } {
    try {
      this.logger.debug('Subscribing to NWC responses on relays:', nwcRelayUrls);
      this.logger.debug('Using filters:', filters);

      if (!nwcRelayUrls || nwcRelayUrls.length === 0) {
        throw new Error('No NWC relay URLs provided for subscription');
      }

      const pool = this.getPoolForRelays(nwcRelayUrls);

      const subscription = pool.subscribeMany(nwcRelayUrls, filters, {
        onevent: (event: Event) => {
          this.logger.debug('Received NWC response event:', event);
          onEvent(event);
        },
        oneose: () => {
          this.logger.debug('NWC subscription EOSE received');
          if (onEose) onEose();
        },
        onclose: (reasons: string[]) => {
          this.logger.debug('NWC subscription closed:', reasons);
        },
      });

      return {
        unsubscribe: () => {
          this.logger.debug('Unsubscribing from NWC responses');
          subscription.close();
        },
      };
    } catch (error) {
      this.logger.error('Error subscribing to NWC responses:', error);
      throw error;
    }
  }

  /**
   * Clean up all NWC pools
   */
  override destroy(): void {
    this.logger.debug('Destroying NWC relay service');

    for (const [key, pool] of this.connectionPools) {
      pool.destroy();
      this.logger.debug('Destroyed NWC pool for:', key);
    }

    this.connectionPools.clear();
    super.destroy();
  }

  /**
   * Get connection status for NWC relays
   */
  getConnectionStatus(relayUrls: string[]): Record<string, boolean> {
    const status: Record<string, boolean> = {};

    for (const url of relayUrls) {
      // Check if relay is in the pool's relay connections
      // Note: SimplePool doesn't expose connection status directly,
      // so we'll assume connected if pool exists
      status[url] = this.connectionPools.has(relayUrls.sort().join(','));
    }

    return status;
  }
}
