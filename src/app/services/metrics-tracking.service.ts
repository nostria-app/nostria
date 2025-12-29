import { Injectable, inject } from '@angular/core';
import { kinds, Event } from 'nostr-tools';
import { PublishEventBus } from './publish-event-bus.service';
import { Metrics } from './metrics';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { AccountRelayService } from './relays/account-relay';

/**
 * Service that tracks outgoing events from the current account
 * and updates engagement metrics accordingly.
 *
 * Supported event kinds:
 * - Reaction (kind 7): Like/reaction to kind 1 notes - 1 point
 * - External reaction (kind 17): Reaction to non-Nostr content (NIP-25) - 1 point
 * - Repost (kind 6): Repost of kind 1 notes - 3 points
 * - Generic repost (kind 16): Repost of non-kind-1 events (NIP-18) - 3 points
 * - Zap request (kind 9734): Zap to a user - 5 points
 * - Reply (kind 1 with reply marker): Reply to someone - 10 points
 */
@Injectable({
  providedIn: 'root',
})
export class MetricsTrackingService {
  private readonly eventBus = inject(PublishEventBus);
  private readonly metrics = inject(Metrics);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly accountRelay = inject(AccountRelayService);

  private initialized = false;
  private historicalScanInProgress = false;
  /** Track which accounts have already been scanned in this session */
  private scannedAccounts = new Set<string>();
  /** Track the pending scan timeout so it can be cancelled */
  private pendingScanTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize the metrics tracking service.
   * Call this once during app initialization.
   */
  initialize(): void {
    if (this.initialized) {
      this.logger.debug('MetricsTrackingService already initialized');
      return;
    }

    this.subscribeToPublishEvents();
    this.initialized = true;
    this.logger.info('MetricsTrackingService initialized');
  }

  /**
   * Schedule a historical scan to run after a delay.
   * Cancels any previously scheduled scan.
   * @param delayMs Delay in milliseconds before running the scan (default: 2 minutes)
   */
  scheduleHistoricalScan(delayMs: number = 2 * 60 * 1000): void {
    // Cancel any pending scan
    if (this.pendingScanTimeout) {
      clearTimeout(this.pendingScanTimeout);
      this.pendingScanTimeout = null;
      this.logger.debug('Cancelled pending historical scan');
    }

    this.pendingScanTimeout = setTimeout(() => {
      this.pendingScanTimeout = null;
      this.scanHistoricalEvents().catch(error => {
        this.logger.error('Error scanning historical events for metrics:', error);
      });
    }, delayMs);

    this.logger.debug(`Scheduled historical scan in ${delayMs / 1000} seconds`);
  }

  /**
   * Cancel any pending historical scan.
   * Should be called when account changes.
   */
  cancelPendingScan(): void {
    if (this.pendingScanTimeout) {
      clearTimeout(this.pendingScanTimeout);
      this.pendingScanTimeout = null;
      this.logger.debug('Cancelled pending historical scan');
    }
  }

  /**
   * Scan historical events from relays for the current account and calculate metrics.
   * This should be called when a user logs in to process their existing interactions.
   * Events that have already been processed will be skipped (duplicate prevention).
   * Each account is only scanned once per session.
   */
  async scanHistoricalEvents(): Promise<void> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.warn('No current account, cannot scan historical events');
      return;
    }

    // Check if this account has already been scanned in this session
    if (this.scannedAccounts.has(currentPubkey)) {
      this.logger.debug(`Account ${currentPubkey.substring(0, 8)} already scanned in this session, skipping`);
      return;
    }

    if (this.historicalScanInProgress) {
      this.logger.debug('Historical scan already in progress, skipping');
      return;
    }

    this.historicalScanInProgress = true;
    this.logger.info(`Starting historical metrics scan for account ${currentPubkey.substring(0, 8)}...`);

    try {
      // Fetch reactions (kind 7 and 17)
      const reactions = await this.accountRelay.getMany({
        kinds: [kinds.Reaction, 17],
        authors: [currentPubkey],
        limit: 1000,
      });
      this.logger.debug(`Found ${reactions.length} historical reactions`);

      // Fetch reposts (kind 6 and 16)
      const reposts = await this.accountRelay.getMany({
        kinds: [kinds.Repost, 16],
        authors: [currentPubkey],
        limit: 1000,
      });
      this.logger.debug(`Found ${reposts.length} historical reposts`);

      // Fetch zap requests (kind 9734)
      const zapRequests = await this.accountRelay.getMany({
        kinds: [9734],
        authors: [currentPubkey],
        limit: 1000,
      });
      this.logger.debug(`Found ${zapRequests.length} historical zap requests`);

      // Fetch notes that could be replies (kind 1)
      const notes = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        authors: [currentPubkey],
        limit: 1000,
      });
      // Filter to only replies (have e tag with reply/root marker)
      const replies = notes.filter(event =>
        event.tags.some(tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root'))
      );
      this.logger.debug(`Found ${replies.length} historical replies out of ${notes.length} notes`);

      // Process all events
      let processedCount = 0;
      let skippedCount = 0;

      const allEvents = [...reactions, ...reposts, ...zapRequests, ...replies];
      for (const event of allEvents) {
        const wasProcessed = await this.processReceivedEvent(event);
        if (wasProcessed) {
          processedCount++;
        } else {
          skippedCount++;
        }
      }

      // Mark this account as scanned so we don't scan again in this session
      this.scannedAccounts.add(currentPubkey);

      this.logger.info(
        `Historical metrics scan complete: ${processedCount} events processed, ${skippedCount} skipped (already processed or invalid)`
      );
    } catch (error) {
      this.logger.error('Failed to scan historical events', error);
    } finally {
      this.historicalScanInProgress = false;
    }
  }

  private subscribeToPublishEvents(): void {
    // Listen for completed publish events
    this.eventBus.on('completed').subscribe(async publishEvent => {
      if (publishEvent.type === 'completed' && publishEvent.success) {
        await this.processPublishedEvent(publishEvent.event);
      }
    });
  }

  /**
   * Process a successfully published event and update metrics
   */
  private async processPublishedEvent(event: Event): Promise<void> {
    await this.processEvent(event);
  }

  /**
   * Process a received event (from relay) and update metrics
   * Returns true if the event was processed, false if skipped
   */
  private async processReceivedEvent(event: Event): Promise<boolean> {
    return await this.processEvent(event);
  }

  /**
   * Core event processing logic
   * Returns true if the event was processed, false if skipped
   */
  private async processEvent(event: Event): Promise<boolean> {
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.debug('No current account, skipping metrics tracking');
      return false;
    }

    // Only process events authored by the current user
    if (event.pubkey !== currentPubkey) {
      return false;
    }

    try {
      switch (event.kind) {
        case kinds.Reaction: // kind 7
        case 17: // kind 17 - External content reaction (NIP-25)
          return await this.handleReaction(event, currentPubkey);
        case kinds.Repost: // kind 6
        case 16: // kind 16 - Generic repost (NIP-18)
          return await this.handleRepost(event, currentPubkey);
        case 9734: // Zap request
          return await this.handleZapRequest(event, currentPubkey);
        case kinds.ShortTextNote: // kind 1
          return await this.handleNote(event, currentPubkey);
        default:
          // Other event types are not tracked for engagement points
          return false;
      }
    } catch (error) {
      this.logger.error(`Failed to process event ${event.id} for metrics`, error);
      return false;
    }
  }

  /**
   * Handle reaction events (likes)
   * Supports kind 7 (standard reactions) and kind 17 (external content reactions per NIP-25)
   * Reactions reference the target event via 'e' tag and author via 'p' tag
   */
  private async handleReaction(event: Event, currentPubkey: string): Promise<boolean> {
    // Get the author of the event we reacted to
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Reaction event missing p tag, skipping metrics');
      return false;
    }

    const targetPubkey = pTag[1];

    // Don't track self-reactions
    if (targetPubkey === currentPubkey) {
      return false;
    }
    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in reaction, skipping metrics');
      return false;
    }

    const added = await this.metrics.addEngagementPoints(
      targetPubkey,
      'LIKE',
      event.id,
      currentPubkey
    );

    if (added) {
      this.logger.debug(`Tracked LIKE (1 point) for ${targetPubkey}`);
    }

    return added;
  }

  /**
   * Handle repost events
   * Supports kind 6 (standard reposts of kind 1) and kind 16 (generic reposts per NIP-18)
   * Reposts reference the original event via 'e' tag and author via 'p' tag
   */
  private async handleRepost(event: Event, currentPubkey: string): Promise<boolean> {
    // Get the author of the event we reposted
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Repost event missing p tag, skipping metrics');
      return false;
    }

    const targetPubkey = pTag[1];

    // Don't track self-reposts
    if (targetPubkey === currentPubkey) {
      return false;
    }

    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in repost, skipping metrics');
      return false;
    }

    const added = await this.metrics.addEngagementPoints(
      targetPubkey,
      'REPOST',
      event.id,
      currentPubkey
    );

    if (added) {
      this.logger.debug(`Tracked REPOST (3 points) for ${targetPubkey}`);
    }

    return added;
  }

  /**
   * Handle zap request events
   * Zap requests reference the recipient via 'p' tag
   */
  private async handleZapRequest(event: Event, currentPubkey: string): Promise<boolean> {
    // Get the zap recipient
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Zap request missing p tag, skipping metrics');
      return false;
    }

    const targetPubkey = pTag[1];

    // Don't track self-zaps
    if (targetPubkey === currentPubkey) {
      return false;
    }

    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in zap request, skipping metrics');
      return false;
    }

    const added = await this.metrics.addEngagementPoints(
      targetPubkey,
      'ZAP',
      event.id,
      currentPubkey
    );

    if (added) {
      this.logger.debug(`Tracked ZAP (5 points) for ${targetPubkey}`);
    }

    return added;
  }

  /**
   * Handle note events (replies)
   * Only tracks notes that are replies (have 'e' tag with reply/root marker)
   */
  private async handleNote(event: Event, currentPubkey: string): Promise<boolean> {
    // Check if this is a reply (has 'e' tag with reply or root marker)
    const isReply = event.tags.some(
      tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root')
    );

    if (!isReply) {
      // Not a reply, just a regular note - don't track
      return false;
    }

    // Get the author of the original note we're replying to
    // The 'p' tags contain authors we're referencing
    const pTags = event.tags.filter(tag => tag[0] === 'p');
    if (pTags.length === 0) {
      this.logger.debug('Reply event missing p tags, skipping metrics');
      return false;
    }

    let anyAdded = false;

    // Track engagement for all referenced authors (usually the original author)
    for (const pTag of pTags) {
      const targetPubkey = pTag[1];

      // Skip self-references
      if (targetPubkey === currentPubkey) {
        continue;
      }

      // Validate target pubkey
      if (!this.utilities.isValidPubkey(targetPubkey)) {
        this.logger.debug('Invalid target pubkey in reply, skipping');
        continue;
      }

      // Use a unique ID combining event ID and target pubkey for deduplication
      const trackingId = `${event.id}:reply:${targetPubkey}`;

      const added = await this.metrics.addEngagementPoints(
        targetPubkey,
        'REPLY',
        trackingId,
        currentPubkey
      );

      if (added) {
        this.logger.debug(`Tracked REPLY (10 points) for ${targetPubkey}`);
        anyAdded = true;
      }
    }

    return anyAdded;
  }
}
