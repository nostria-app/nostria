import { Injectable, inject } from '@angular/core';
import { SimplePool, Event, Filter } from 'nostr-tools';
import { RelaysService, RelayStats } from './relays';

@Injectable({
  providedIn: 'root'
})
export class RelayPoolService {
  #pool = new SimplePool();
  private readonly relaysService = inject(RelaysService);

  /**
   * Add relays to the pool and register them with RelaysService
   */
  private addRelays(relayUrls: string[]): void {
    // Get current relays from RelaysService
    const allRelayStats = this.relaysService.getAllRelayStats();
    const currentRelays = Array.from(allRelayStats.keys());
    const newRelays = relayUrls.filter(url => !currentRelays.includes(url));

    if (newRelays.length > 0) {
      // Register each new relay with the RelaysService for tracking
      newRelays.forEach(url => {
        this.relaysService.addRelay(url);
      });
    }
  }

  /**
   * Get event from relays
   */
  async get(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event | null> {
    if (relayUrls.length === 0) {
      return null;
    }

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    try {
      const event = await this.#pool.get(relayUrls, filter, { maxWait: timeoutMs });

      // Track successful event retrieval
      if (event) {
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
        });
      }

      return event;
    } catch (error) {
      console.error('Error fetching events:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
      });

      return null;
    }
  }

  /**
 * Get events from relays
 */
  async query(relayUrls: string[], filter: Filter, timeoutMs = 5000): Promise<Event[]> {
    if (relayUrls.length === 0) {
      return [];
    }

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    try {
      const events = await this.#pool.querySync(relayUrls, filter, { maxWait: timeoutMs });

      // Track successful event retrieval
      if (events.length > 0) {
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
        });
      }

      return events;
    } catch (error) {
      console.error('Error fetching events:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
      });

      return [];
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(relayUrls: string[], filter: Filter, onEvent: (event: Event) => void) {
    // Add any new relays to the pool
    this.addRelays(relayUrls);

    const sub = this.#pool.subscribe(relayUrls, filter, {
      onevent: (event) => {
        // Track event received for all relays in this subscription
        // Note: We don't know which specific relay sent this event, so we increment all
        relayUrls.forEach(url => {
          this.relaysService.incrementEventCount(url);
        });
        onEvent(event);
      },
      onclose: (reason) => {
        console.log('Subscription closed:', reason);
      }
    });

    return sub;
  }

  /**
   * Publish an event to relays
   */
  async publish(relayUrls: string[], event: Event): Promise<void> {
    if (relayUrls.length === 0) {
      throw new Error('No relays provided');
    }

    // Add any new relays to the pool
    this.addRelays(relayUrls);

    try {
      const results = await Promise.allSettled(
        this.#pool.publish(relayUrls, event)
      );

      // Track publish results
      results.forEach((result, index) => {
        const relayUrl = relayUrls[index];
        if (result.status === 'fulfilled') {
          // Successful publish - update connection status
          this.relaysService.updateRelayConnection(relayUrl, true);
        } else {
          // Failed publish - record retry attempt
          this.relaysService.recordConnectionRetry(relayUrl);
          this.relaysService.updateRelayConnection(relayUrl, false);
        }
      });

    } catch (error) {
      console.error('Error publishing event:', error);

      // Record connection issues for all relays
      relayUrls.forEach(url => {
        this.relaysService.recordConnectionRetry(url);
        this.relaysService.updateRelayConnection(url, false);
      });

      throw error;
    }
  }

  /**
   * Get a single event by ID
   */
  async getEventById(relayUrls: string[], id: string, timeoutMs = 3000): Promise<Event | null> {
    const filter: Filter = { ids: [id] };
    const event = await this.get(relayUrls, filter, timeoutMs);
    return event;
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    // Get all relay URLs from RelaysService to close connections
    const allRelayStats = this.relaysService.getAllRelayStats();
    const relayUrls = Array.from(allRelayStats.keys());
    this.#pool.close(relayUrls);
  }

  /**
   * Get relay statistics for all tracked relays
   */
  getRelayStats(): Map<string, RelayStats> {
    return this.relaysService.getAllRelayStats();
  }

  /**
   * Get performance score for a specific relay
   */
  getRelayPerformanceScore(url: string): number {
    return this.relaysService.getRelayPerformanceScore(url);
  }

  /**
   * Get optimal relays from the current pool based on performance
   */
  getOptimalRelays(limit?: number): string[] {
    // Get current relays from RelaysService
    const allRelayStats = this.relaysService.getAllRelayStats();
    const currentRelays = Array.from(allRelayStats.keys());
    return this.relaysService.getOptimalRelays(currentRelays, limit);
  }

  /**
   * Get connected relays
   */
  getConnectedRelays(): string[] {
    return this.relaysService.getConnectedRelays();
  }

  /**
   * Update connection status for a relay
   */
  updateRelayConnectionStatus(url: string, isConnected: boolean): void {
    this.relaysService.updateRelayConnection(url, isConnected);
  }

  /**
   * Record a connection retry attempt for a relay
   */
  recordConnectionRetry(url: string): void {
    this.relaysService.recordConnectionRetry(url);
  }

  /**
   * Monitor relay connection status
   */
  private monitorConnections(): void {
    // Note: SimplePool doesn't expose connection events directly
    // This is a placeholder for connection monitoring logic
    // You might need to implement custom connection tracking
  }
}