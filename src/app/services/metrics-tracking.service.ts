import { Injectable, inject } from '@angular/core';
import { kinds, Event } from 'nostr-tools';
import { PublishEventBus } from './publish-event-bus.service';
import { Metrics } from './metrics';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';

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

  private initialized = false;

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
    const currentPubkey = this.accountState.pubkey();
    if (!currentPubkey) {
      this.logger.debug('No current account, skipping metrics tracking');
      return;
    }

    // Only process events authored by the current user
    if (event.pubkey !== currentPubkey) {
      return;
    }

    try {
      switch (event.kind) {
        case kinds.Reaction: // kind 7
        case 17: // kind 17 - External content reaction (NIP-25)
          await this.handleReaction(event, currentPubkey);
          break;
        case kinds.Repost: // kind 6
        case 16: // kind 16 - Generic repost (NIP-18)
          await this.handleRepost(event, currentPubkey);
          break;
        case 9734: // Zap request
          await this.handleZapRequest(event, currentPubkey);
          break;
        case kinds.ShortTextNote: // kind 1
          await this.handleNote(event, currentPubkey);
          break;
        default:
          // Other event types are not tracked for engagement points
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to process event ${event.id} for metrics`, error);
    }
  }

  /**
   * Handle reaction events (likes)
   * Supports kind 7 (standard reactions) and kind 17 (external content reactions per NIP-25)
   * Reactions reference the target event via 'e' tag and author via 'p' tag
   */
  private async handleReaction(event: Event, currentPubkey: string): Promise<void> {
    // Get the author of the event we reacted to
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Reaction event missing p tag, skipping metrics');
      return;
    }

    const targetPubkey = pTag[1];

    // Don't track self-reactions
    if (targetPubkey === currentPubkey) {
      return;
    }

    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in reaction, skipping metrics');
      return;
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
  }

  /**
   * Handle repost events
   * Supports kind 6 (standard reposts of kind 1) and kind 16 (generic reposts per NIP-18)
   * Reposts reference the original event via 'e' tag and author via 'p' tag
   */
  private async handleRepost(event: Event, currentPubkey: string): Promise<void> {
    // Get the author of the event we reposted
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Repost event missing p tag, skipping metrics');
      return;
    }

    const targetPubkey = pTag[1];

    // Don't track self-reposts
    if (targetPubkey === currentPubkey) {
      return;
    }

    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in repost, skipping metrics');
      return;
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
  }

  /**
   * Handle zap request events
   * Zap requests reference the recipient via 'p' tag
   */
  private async handleZapRequest(event: Event, currentPubkey: string): Promise<void> {
    // Get the zap recipient
    const pTag = event.tags.find(tag => tag[0] === 'p');
    if (!pTag || !pTag[1]) {
      this.logger.debug('Zap request missing p tag, skipping metrics');
      return;
    }

    const targetPubkey = pTag[1];

    // Don't track self-zaps
    if (targetPubkey === currentPubkey) {
      return;
    }

    // Validate target pubkey
    if (!this.utilities.isValidPubkey(targetPubkey)) {
      this.logger.debug('Invalid target pubkey in zap request, skipping metrics');
      return;
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
  }

  /**
   * Handle note events (replies)
   * Only tracks notes that are replies (have 'e' tag with reply/root marker)
   */
  private async handleNote(event: Event, currentPubkey: string): Promise<void> {
    // Check if this is a reply (has 'e' tag with reply or root marker)
    const isReply = event.tags.some(
      tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root')
    );

    if (!isReply) {
      // Not a reply, just a regular note - don't track
      return;
    }

    // Get the author of the original note we're replying to
    // The 'p' tags contain authors we're referencing
    const pTags = event.tags.filter(tag => tag[0] === 'p');
    if (pTags.length === 0) {
      this.logger.debug('Reply event missing p tags, skipping metrics');
      return;
    }

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
      }
    }
  }
}
