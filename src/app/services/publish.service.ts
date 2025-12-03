import { Injectable, inject } from '@angular/core';
import { Event, UnsignedEvent, kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { AccountRelayService } from './relays/account-relay';
import { UserRelaysService } from './relays/user-relays';
import { ApplicationStateService } from './application-state.service';
import { PublishEventBus } from './publish-event-bus.service';
import { UtilitiesService } from './utilities.service';

/**
 * Options for publishing events
 */
export interface PublishOptions {
  /** Relay URLs to publish to. If not provided, defaults to account relays */
  relayUrls?: string[];

  /** Whether to use optimized relay selection (default: false for publishing) */
  useOptimizedRelays?: boolean;

  /** For kind 3 (follow list), whether to also publish to newly followed users' relays (default: true) */
  notifyFollowed?: boolean;

  /** For kind 3 events: specific pubkeys that were newly followed (for targeted notification) */
  newlyFollowedPubkeys?: string[];

  /** For replies, reactions, reposts: whether to publish to mentioned users' relays (default: true) */
  notifyMentioned?: boolean;

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
 * - Avoids circular dependencies by being a standalone service
 * 
 * Usage:
 * 1. Direct: await publishService.publish(signedEvent, options)
 * 2. With signing: await publishService.signAndPublish(unsignedEvent, signFn, options)
 * 3. Auto-detect: await publishService.signAndPublishAuto(unsignedEvent, signFn, newlyFollowedPubkeys)
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
  private readonly appState = inject(ApplicationStateService);
  private readonly eventBus = inject(PublishEventBus);
  private readonly utilities = inject(UtilitiesService);

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
    this.logger.debug('[PublishService] Publishing event', {
      kind: event.kind,
      id: event.id,
      options,
    });

    // Set publishing state to true
    this.appState.isPublishing.set(true);

    const result: PublishResult = {
      success: false,
      relayResults: new Map(),
      event,
    };

    try {
      // Determine which relays to use
      const relayUrls = await this.getRelayUrlsForPublish(event, options);

      console.log('[PublishService] DEBUG: Publishing to relays:', {
        kind: event.kind,
        totalRelays: relayUrls.length,
        relayUrls: relayUrls,
        options: options,
      });

      if (relayUrls.length === 0) {
        this.logger.warn('[PublishService] No relays available for publishing');
        // Reset publishing state before returning
        this.appState.isPublishing.set(false);
        return result;
      }

      // Emit started event
      this.eventBus.emit({
        type: 'started',
        event,
        relayUrls,
        timestamp: Date.now(),
      });

      // Create relay promises map for notification tracking
      const relayPromises = new Map<Promise<string>, string>();
      const publishPromises: Promise<string>[] = [];

      // Get timeout for individual relay publishes (use half of total timeout per relay)
      const timeout = options.timeout || 10000;
      const perRelayTimeout = Math.max(5000, Math.floor(timeout / 2));

      // Publish to each relay individually so we can track status
      for (const relayUrl of relayUrls) {
        const publishPromise = this.pool.publish([relayUrl], event, perRelayTimeout)
          .then(() => {
            // Emit success for this relay
            this.eventBus.emit({
              type: 'relay-result',
              event,
              relayUrl,
              success: true,
              timestamp: Date.now(),
            });
            return relayUrl;
          })
          .catch(error => {
            // Emit failure for this relay
            this.eventBus.emit({
              type: 'relay-result',
              event,
              relayUrl,
              success: false,
              error: error.message || 'Failed',
              timestamp: Date.now(),
            });
            // Log but don't throw - we want to track partial failures
            this.logger.debug('[PublishService] Relay publish failed', { relayUrl, error });
            throw new Error(`${relayUrl}: ${error.message || 'Failed'}`);
          });

        relayPromises.set(publishPromise, relayUrl);
        publishPromises.push(publishPromise);
      }

      // Create notification for tracking (removed to avoid circular dependency)
      // The NotificationService creates a circular dependency:
      // NotificationService -> AccountStateService -> PublishService -> NotificationService
      // Publishing notifications can be added back through an event bus or other mechanism
      // await this.notificationService.addRelayPublishingNotification(event, relayPromises);

      // Process results with overall timeout
      // Create a proper timeout that we can await
      let settledResults: PromiseSettledResult<string>[];

      const allSettledPromise = Promise.allSettled(publishPromises);
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), timeout)
      );

      const raceResult = await Promise.race([allSettledPromise, timeoutPromise]);

      if (raceResult === 'timeout') {
        // Timeout occurred - collect whatever results we have so far
        this.logger.warn('[PublishService] Publish timed out, collecting current results', { timeout });

        // Give promises a tiny bit more time to settle
        await new Promise(resolve => setTimeout(resolve, 100));
        settledResults = await Promise.allSettled(publishPromises);

        this.logger.debug('[PublishService] Results after timeout', {
          settled: settledResults.length,
          fulfilled: settledResults.filter(r => r.status === 'fulfilled').length,
          rejected: settledResults.filter(r => r.status === 'rejected').length,
        });
      } else {
        // All settled before timeout
        settledResults = raceResult;
        this.logger.debug('[PublishService] All publishes completed before timeout');
      }

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
        relayResults: Array.from(result.relayResults.entries()).map(([url, r]) => ({
          url,
          success: r.success,
          error: r.error
        }))
      });

      // Emit completed event
      this.eventBus.emit({
        type: 'completed',
        event,
        relayResults: result.relayResults,
        success: result.success,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      this.logger.error('[PublishService] Error during publish', error);

      // Emit error event
      this.eventBus.emit({
        type: 'error',
        event,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      });

      // Ensure we still set result.success based on any successful relays
      result.success = Array.from(result.relayResults.values()).some(r => r.success);
      return result;
    } finally {
      // CRITICAL: Always reset publishing state, even if there were errors
      this.appState.isPublishing.set(false);

      this.logger.debug('[PublishService] Publishing state reset', {
        finalSuccess: result.success,
        relayResultsCount: result.relayResults.size
      });
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
   * Convenience method to sign and publish with automatic option detection.
   * Automatically determines the best publishing strategy based on event type.
   * 
   * This is the replacement for the old accountState.publish signal pattern.
   * 
   * @param event The unsigned event to sign and publish
   * @param signFn Function that signs the event
   * @param newlyFollowedPubkeys For kind 3 events, the newly followed pubkeys (optional)
   * @returns Promise with publish results
   */
  async signAndPublishAuto(
    event: UnsignedEvent,
    signFn: (event: UnsignedEvent) => Promise<Event>,
    newlyFollowedPubkeys?: string[]
  ): Promise<PublishResult> {
    // Determine options based on event kind
    const options: PublishOptions = {};

    if (event.kind === kinds.Contacts) {
      // Follow list: notify newly followed users
      options.notifyFollowed = true;
      options.useOptimizedRelays = false;
      if (newlyFollowedPubkeys && newlyFollowedPubkeys.length > 0) {
        options.newlyFollowedPubkeys = newlyFollowedPubkeys;
      }
    } else {
      // All other events: notify mentioned users, use all relays
      options.notifyMentioned = true;
      options.useOptimizedRelays = false;
    }

    return this.signAndPublish(event, signFn, options);
  }

  /**
   * Determine which relay URLs to use for publishing based on event type and options.
   * 
   * Special handling:
   * - Kind 3 (follow list): Publishes to account relays + followed users' relays
   * - Kind 1 (notes with p-tags): Publishes to account relays + mentioned users' relays
   * - Kind 6/16 (reposts): Publishes to account relays + reposted author's relays
   * - Kind 7 (reactions): Publishes to account relays + reacted event author's relays
   * - Other kinds: Uses account relays or provided relay URLs
   */
  private async getRelayUrlsForPublish(
    event: Event,
    options: PublishOptions
  ): Promise<string[]> {
    // If explicit relay URLs provided, use those (deduplicated and normalized)
    if (options.relayUrls && options.relayUrls.length > 0) {
      const normalizedRelays = this.utilities.getUniqueNormalizedRelayUrls(options.relayUrls);
      return this.applyRelayOptimization(normalizedRelays, options.useOptimizedRelays);
    }

    // Normalize account relay URLs to ensure consistent comparison
    const accountRelayUrls = this.utilities.normalizeRelayUrls(this.accountRelay.getRelayUrls());
    const allRelayUrls = new Set<string>(accountRelayUrls);

    console.log('[PublishService] DEBUG getRelayUrlsForPublish:', {
      kind: event.kind,
      accountRelays: accountRelayUrls.length,
      accountRelaysList: accountRelayUrls,
      options: options,
    });

    // Special handling for kind 3 (follow list) events
    if (event.kind === kinds.Contacts && options.notifyFollowed !== false) {
      // Note: getFollowedUsersRelays returns already normalized URLs
      const followedRelayUrls = await this.getFollowedUsersRelays(event, options.newlyFollowedPubkeys);

      followedRelayUrls.forEach(url => allRelayUrls.add(url));

      console.log('[PublishService] DEBUG Kind 3 relay collection:', {
        accountRelays: accountRelayUrls.length,
        accountRelaysList: accountRelayUrls,
        newlyFollowedPubkeys: options.newlyFollowedPubkeys,
        newlyFollowedCount: options.newlyFollowedPubkeys?.length || 0,
        followedRelays: followedRelayUrls.length,
        followedRelaysList: followedRelayUrls,
        totalUnique: allRelayUrls.size,
        allRelaysList: Array.from(allRelayUrls),
      });

      this.logger.debug('[PublishService] Kind 3 event - publishing to account + newly followed relays', {
        accountRelays: accountRelayUrls.length,
        newlyFollowedUsers: options.newlyFollowedPubkeys?.length || 0,
        followedRelays: followedRelayUrls.length,
        totalUnique: allRelayUrls.size,
      });

      // For kind 3, we DON'T optimize - we want to reach all relays of newly followed users
      return Array.from(allRelayUrls);
    }

    // Special handling for replies, reactions, and reposts (kinds 1, 6, 7, 16)
    // These should be published to the relays of all mentioned users (p-tags)
    if (
      (event.kind === kinds.ShortTextNote ||
        event.kind === kinds.Reaction ||
        event.kind === kinds.Repost ||
        event.kind === kinds.GenericRepost) &&
      options.notifyMentioned !== false
    ) {
      const mentionedPubkeys = event.tags
        .filter(tag => tag[0] === 'p' && tag[1])
        .map(tag => tag[1]);

      if (mentionedPubkeys.length > 0) {
        const mentionedRelayUrls = await this.getMentionedUsersRelays(mentionedPubkeys);

        mentionedRelayUrls.forEach(url => allRelayUrls.add(url));

        this.logger.debug('[PublishService] Event with mentions - publishing to account + mentioned users relays', {
          kind: event.kind,
          accountRelays: accountRelayUrls.length,
          mentionedUsers: mentionedPubkeys.length,
          mentionedRelays: mentionedRelayUrls.length,
          totalUnique: allRelayUrls.size,
        });

        // DON'T optimize - we want ALL relays of mentioned users to receive the event
        return Array.from(allRelayUrls);
      }
    }

    // For other events, use account relays with optional optimization (already normalized above)
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
    console.log('[PublishService] DEBUG getFollowedUsersRelays:', {
      newlyFollowedPubkeysProvided: newlyFollowedPubkeys,
      newlyFollowedPubkeysCount: newlyFollowedPubkeys?.length || 0,
    });

    // CRITICAL: Only use newly followed pubkeys if explicitly provided
    // If not provided or empty, return empty array (don't notify anyone)
    if (!newlyFollowedPubkeys || newlyFollowedPubkeys.length === 0) {
      console.log('[PublishService] DEBUG: No newly followed pubkeys - not notifying any users');
      return [];
    }

    this.logger.debug('[PublishService] Getting relays for newly followed users', {
      count: newlyFollowedPubkeys.length,
      pubkeys: newlyFollowedPubkeys.map(pk => pk.slice(0, 16)),
    });

    const relays = await this.getAllRelaysForPubkeys(newlyFollowedPubkeys);

    console.log('[PublishService] DEBUG: Retrieved relays for followed users:', {
      followedUsersCount: newlyFollowedPubkeys.length,
      relaysFound: relays.length,
      relaysList: relays,
    });

    return relays;
  }

  /**
   * Get relay URLs for mentioned users (in replies, reactions, reposts).
   * This ensures mentioned users receive notifications on ALL their relays.
   * 
   * @param mentionedPubkeys Array of pubkeys mentioned in the event
   */
  private async getMentionedUsersRelays(mentionedPubkeys: string[]): Promise<string[]> {
    if (mentionedPubkeys.length === 0) {
      return [];
    }

    this.logger.debug('[PublishService] Getting relays for mentioned users', {
      count: mentionedPubkeys.length,
      pubkeys: mentionedPubkeys.map(pk => pk.slice(0, 16)),
    });

    return await this.getAllRelaysForPubkeys(mentionedPubkeys);
  }

  /**
   * Get ALL relay URLs for a list of pubkeys.
   * This is used for publishing to ensure maximum distribution.
   * Does NOT use optimization - returns ALL known relays.
   * 
   * @param pubkeys Array of pubkeys to get relays for
   */
  private async getAllRelaysForPubkeys(pubkeys: string[]): Promise<string[]> {
    const allRelayUrls = new Set<string>();

    console.log('[PublishService] DEBUG getAllRelaysForPubkeys:', {
      pubkeysCount: pubkeys.length,
      pubkeysList: pubkeys.map(pk => pk.slice(0, 16)),
    });

    // Process in batches to avoid overwhelming the system
    const batchSize = 20;
    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async pubkey => {
          try {
            // Use getUserRelaysForPublishing to get ALL relays for this user
            const relayUrls = await this.userRelaysService.getUserRelaysForPublishing(pubkey);

            console.log('[PublishService] DEBUG: Relays for user:', {
              pubkey: pubkey.slice(0, 16),
              relaysFound: relayUrls.length,
              relaysList: relayUrls,
            });

            relayUrls.forEach(url => allRelayUrls.add(url));
          } catch (error) {
            console.warn('[PublishService] DEBUG: Failed to get relays for user:', {
              pubkey: pubkey.slice(0, 16),
              error: error,
            });
            this.logger.warn('[PublishService] Failed to get relays for user', {
              pubkey: pubkey.slice(0, 16),
              error,
            });
          }
        })
      );
    }

    console.log('[PublishService] DEBUG getAllRelaysForPubkeys result:', {
      totalRelays: allRelayUrls.size,
      relaysList: Array.from(allRelayUrls),
    });

    return Array.from(allRelayUrls);
  }

  /**
   * Apply relay optimization if requested.
   * Always returns deduplicated relay URLs.
   */
  private applyRelayOptimization(
    relayUrls: string[],
    useOptimized = true
  ): string[] {
    // Ensure deduplication in all cases
    const uniqueRelays = Array.from(new Set(relayUrls));

    if (!useOptimized) {
      return uniqueRelays;
    }

    return this.relaysService.getOptimalRelays(uniqueRelays);
  }

  /**
   * Execute the actual publish operation to relays
   */
  private async executePublish(event: Event, relayUrls: string[]): Promise<Promise<void>[]> {
    // Publish to all relays in a single call (more efficient)
    try {
      await this.pool.publish(relayUrls, event);

      // Return resolved promises for all relays
      return relayUrls.map(() => Promise.resolve());
    } catch (error) {
      this.logger.error('[PublishService] Error during batch publish:', error);
      // Return rejected promises for all relays
      return relayUrls.map(url => Promise.reject(new Error(`Failed to publish to ${url}: ${error}`)));
    }
  }
}
