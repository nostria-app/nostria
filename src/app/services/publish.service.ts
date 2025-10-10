import { Injectable, inject } from '@angular/core';
import { Event, UnsignedEvent, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { AccountRelayService } from './relays/account-relay';
import { UserRelaysService } from './relays/user-relays';

/**
 * Options for publishing events
 */
export interface PublishOptions {
  /** Relay URLs to publish to. If not provided, defaults to account relays */
  relayUrls?: string[];

  /** Whether to use optimized relay selection (default: true) */
  useOptimizedRelays?: boolean;

  /** For kind 3 (follow list), whether to also publish to newly followed users' relays (default: true) */
  notifyFollowed?: boolean;

  /** For kind 3 events: specific pubkeys that were newly followed (for targeted notification) */
  newlyFollowedPubkeys?: string[];

  /** Timeout for publish operation in milliseconds (default: 10000) */
  timeout?: number;
}/**
 * Result of a publish operation
 */
export interface PublishResult {
  success: boolean;
  relayResults: Map<string, { success: boolean; error?: string }>;
  event: Event;
}

/**
 * Service responsible for publishing Nostr events with fine-grained control.
 * 
 * This service provides:
 * - Direct publishing methods with control over relay selection
 * - Special handling for different event kinds (e.g., kind 3 follows)
 * - Backwards compatibility with signal-based publishing pattern
 * - Avoids circular dependencies by being a standalone service
 * 
 * Usage:
 * 1. Direct: await publishService.publish(signedEvent, options)
 * 2. With signing: await publishService.signAndPublish(unsignedEvent, options)
 * 3. Legacy signal: accountState.publish.set(event) - automatically handled
 */
@Injectable({
  providedIn: 'root',
})
export class PublishService {
  private readonly logger = inject(LoggerService);
  private readonly relaysService = inject(RelaysService);
  private readonly pool = inject(RelayPoolService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly userRelaysService = inject(UserRelaysService);

  /**
   * Publish a signed event to relays.
   * This is the main publishing method with full control over options.
   * 
   * @param event The signed event to publish
   * @param options Publishing options (relay selection, optimization, etc.)
   * @returns Promise with publish results
   */
  async publish(
    event: Event,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    debugger;
    
    this.logger.debug('[PublishService] Publishing event', {
      kind: event.kind,
      id: event.id,
      options,
    });

    const result: PublishResult = {
      success: false,
      relayResults: new Map(),
      event,
    };

    try {
      // Determine which relays to use
      const relayUrls = await this.getRelayUrlsForPublish(event, options);

      if (relayUrls.length === 0) {
        this.logger.warn('[PublishService] No relays available for publishing');
        return result;
      }

      // Get the appropriate relay service to use
      const publishPromises = await this.executePublish(event, relayUrls);

      // Process results
      const settledResults = await Promise.allSettled(publishPromises);

      settledResults.forEach((promiseResult, index) => {
        const relayUrl = relayUrls[index] || 'unknown';
        if (promiseResult.status === 'fulfilled') {
          result.relayResults.set(relayUrl, { success: true });
        } else {
          result.relayResults.set(relayUrl, {
            success: false,
            error: promiseResult.reason?.message || 'Unknown error',
          });
        }
      });

      // Consider success if at least one relay accepted the event
      result.success = Array.from(result.relayResults.values()).some(r => r.success);

      this.logger.debug('[PublishService] Publish completed', {
        kind: event.kind,
        id: event.id,
        success: result.success,
        relayCount: relayUrls.length,
        successCount: Array.from(result.relayResults.values()).filter(r => r.success).length,
      });

      return result;
    } catch (error) {
      this.logger.error('[PublishService] Error during publish', error);
      return result;
    }
  }

  /**
   * Sign an unsigned event and publish it.
   * This method requires a signing function to avoid circular dependencies.
   * 
   * @param event The unsigned event to sign and publish
   * @param signFn Function that signs the event
   * @param options Publishing options
   * @returns Promise with publish results
   */
  async signAndPublish(
    event: UnsignedEvent,
    signFn: (event: UnsignedEvent) => Promise<Event>,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    try {
      const signedEvent = await signFn(event);
      return this.publish(signedEvent, options);
    } catch (error) {
      this.logger.error('[PublishService] Error signing event', error);
      return {
        success: false,
        relayResults: new Map(),
        event: event as Event, // Type assertion for error case
      };
    }
  }

  /**
   * Determine which relay URLs to use for publishing based on event type and options.
   * 
   * Special handling:
   * - Kind 3 (follow list): Publishes to account relays + followed users' relays
   * - Other kinds: Uses account relays or provided relay URLs
   */
  private async getRelayUrlsForPublish(
    event: Event,
    options: PublishOptions
  ): Promise<string[]> {
    // If explicit relay URLs provided, use those
    if (options.relayUrls && options.relayUrls.length > 0) {
      return this.applyRelayOptimization(options.relayUrls, options.useOptimizedRelays);
    }

    const accountRelayUrls = this.accountRelay.getRelayUrls();

    // Special handling for kind 3 (follow list) events
    if (event.kind === kinds.Contacts && options.notifyFollowed !== false) {
      const followedRelayUrls = await this.getFollowedUsersRelays(event, options.newlyFollowedPubkeys);

      // Combine account relays with followed users' relays
      const allRelayUrls = new Set([...accountRelayUrls, ...followedRelayUrls]);

      this.logger.debug('[PublishService] Kind 3 event - publishing to account + newly followed relays', {
        accountRelays: accountRelayUrls.length,
        newlyFollowedUsers: options.newlyFollowedPubkeys?.length || 0,
        followedRelays: followedRelayUrls.length,
        totalUnique: allRelayUrls.size,
      });

      // For kind 3, we DON'T optimize - we want to reach all relays of newly followed users
      return Array.from(allRelayUrls);
    }    // For other events, use account relays with optional optimization
    return this.applyRelayOptimization(accountRelayUrls, options.useOptimizedRelays);
  }

  /**
   * Get relay URLs for newly followed users in a follow list (kind 3) event.
   * This ensures followed users can receive follow notifications.
   * 
   * @param event The follow list event
   * @param newlyFollowedPubkeys Optional list of specific pubkeys that were newly followed.
   *                             If provided, only these users' relays are retrieved.
   *                             If not provided, falls back to all p tags in the event.
   */
  private async getFollowedUsersRelays(event: Event, newlyFollowedPubkeys?: string[]): Promise<string[]> {
    // Use the specific newly followed pubkeys if provided, otherwise use all p tags
    const followedPubkeys = newlyFollowedPubkeys && newlyFollowedPubkeys.length > 0
      ? newlyFollowedPubkeys
      : event.tags
        .filter(tag => tag[0] === 'p' && tag[1])
        .map(tag => tag[1]);

    if (followedPubkeys.length === 0) {
      return [];
    }

    this.logger.debug('[PublishService] Getting relays for newly followed users', {
      count: followedPubkeys.length,
      pubkeys: followedPubkeys.map(pk => pk.slice(0, 16)),
    });

    const allRelayUrls = new Set<string>();

    // Get relay URLs for each newly followed user
    // We'll do this in batches to avoid overwhelming the system
    const batchSize = 20;
    for (let i = 0; i < followedPubkeys.length; i += batchSize) {
      const batch = followedPubkeys.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async pubkey => {
          try {
            const relayUrls = this.userRelaysService.getRelaysForPubkey(pubkey);
            relayUrls.forEach(url => allRelayUrls.add(url));
          } catch (error) {
            this.logger.warn('[PublishService] Failed to get relays for newly followed user', {
              pubkey: pubkey.slice(0, 16),
              error,
            });
          }
        })
      );
    }

    return Array.from(allRelayUrls);
  }

  /**
   * Apply relay optimization if requested
   */
  private applyRelayOptimization(
    relayUrls: string[],
    useOptimized = true
  ): string[] {
    if (!useOptimized) {
      return relayUrls;
    }

    return this.relaysService.getOptimalRelays(relayUrls);
  }

  /**
   * Execute the actual publish operation to relays
   */
  private async executePublish(event: Event, relayUrls: string[]): Promise<Promise<void>[]> {
    // Use the pool to publish
    // Note: pool.publish returns void but internally handles Promise.allSettled
    // We'll wrap it to return individual promises for each relay
    const publishPromises = relayUrls.map(async relayUrl => {
      try {
        await this.pool.publish([relayUrl], event);
      } catch (error) {
        // Re-throw to be caught by Promise.allSettled
        throw new Error(`Failed to publish to ${relayUrl}: ${error}`);
      }
    });

    return publishPromises;
  }
}
