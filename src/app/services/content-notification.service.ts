import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { AccountRelayService } from './relays/account-relay';
import { ContentNotification, NotificationType } from './storage.service';
import { LocalStorageService } from './local-storage.service';
import { kinds } from 'nostr-tools';
import { AccountStateService } from './account-state.service';

/**
 * Local storage key for tracking the last notification check timestamp
 */
const LAST_NOTIFICATION_CHECK_KEY = 'nostria-notification-lastcheck';

/**
 * Query limits for fetching notifications from relays
 * These are set high to catch all recent activity for active accounts.
 * For extremely active accounts with viral posts, consider implementing pagination.
 */
const NOTIFICATION_QUERY_LIMITS = {
  FOLLOWERS: 200,   // New followers
  MENTIONS: 500,    // Mentions in posts
  REPOSTS: 300,     // Reposts/quotes
  REPLIES: 500,     // Replies to your posts
  REACTIONS: 500,   // Likes/reactions
  ZAPS: 1000,       // Zap receipts (often the highest volume)
};

/**
 * Service for managing content notifications (social interactions)
 * These are notifications about follows, mentions, reposts, replies, reactions, and zaps
 * that happen on the Nostr network.
 */
@Injectable({
  providedIn: 'root',
})
export class ContentNotificationService {
  private logger = inject(LoggerService);
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private localStorage = inject(LocalStorageService);
  private accountState = inject(AccountStateService);

  // Track the last check timestamp to avoid duplicate notifications
  private lastCheckTimestamp = signal<number>(0);

  resetLastCheckTimestamp(): void {
    this.lastCheckTimestamp.set(0);
    this.localStorage.removeItem(LAST_NOTIFICATION_CHECK_KEY);
    this.logger.info('ContentNotificationService last check timestamp reset');
  }

  // Track if we're currently checking for new content
  private isChecking = signal<boolean>(false);

  constructor() {
    this.logger.info('ContentNotificationService initialized');
  }

  /**
   * Initialize the service and load the last check timestamp
   */
  async initialize(): Promise<void> {
    try {
      const timestamp = await this.getLastCheckTimestamp();
      this.lastCheckTimestamp.set(timestamp);
      this.logger.debug(`Initialized with last check timestamp: ${timestamp}`);
    } catch (error) {
      this.logger.error('Failed to initialize ContentNotificationService', error);
    }
  }

  /**
   * Check for new content notifications since last check
   */
  async checkForNewNotifications(): Promise<void> {
    debugger;
    if (this.isChecking()) {
      this.logger.debug('Already checking for notifications, skipping');
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('No active account, skipping notification check');
      return;
    }

    this.isChecking.set(true);

    try {
      this.logger.info('Checking for new content notifications');
      const since = this.lastCheckTimestamp();
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds

      // Check for all notification types in parallel
      await Promise.all([
        this.checkForNewFollowers(pubkey, since),
        this.checkForMentions(pubkey, since),
        this.checkForReposts(pubkey, since),
        this.checkForReplies(pubkey, since),
        this.checkForReactions(pubkey, since),
        this.checkForZaps(pubkey, since),
      ]);

      // Update the last check timestamp
      await this.updateLastCheckTimestamp(now);
      this.lastCheckTimestamp.set(now);

      this.logger.info('Completed checking for new content notifications');
    } catch (error) {
      this.logger.error('Failed to check for new notifications', error);
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Check for new followers (kind 3 events mentioning the user)
   */
  private async checkForNewFollowers(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for new followers since ${since}`);

      // Query for kind 3 (contact list) events that include this user's pubkey
      const events = await this.accountRelay.getMany({
        kinds: [kinds.Contacts],
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.FOLLOWERS,
      });

      this.logger.debug(`Found ${events.length} potential follow events`);

      for (const event of events) {
        // Check if this user's pubkey is in the tags
        const isFollowing = event.tags.some(
          tag => tag[0] === 'p' && tag[1] === pubkey
        );

        if (isFollowing) {
          await this.createContentNotification({
            type: NotificationType.NEW_FOLLOWER,
            title: 'New follower',
            message: 'Someone started following you',
            authorPubkey: event.pubkey,
            eventId: event.id,
            timestamp: event.created_at * 1000, // Convert to milliseconds
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to check for new followers', error);
    }
  }

  /**
   * Check for mentions (kind 1 events with 'p' tag pointing to user)
   */
  private async checkForMentions(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for mentions since ${since}`);

      const events = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.MENTIONS,
      });

      this.logger.debug(`Found ${events.length} potential mention events`);

      for (const event of events) {
        // Filter out replies (which have 'e' tags referencing the original note)
        // and only keep pure mentions
        const hasReplyTag = event.tags.some(
          tag => tag[0] === 'e' && tag[3] === 'reply'
        );

        if (!hasReplyTag) {
          await this.createContentNotification({
            type: NotificationType.MENTION,
            title: 'Mentioned you',
            message: event.content.substring(0, 100), // Preview of content
            authorPubkey: event.pubkey,
            eventId: event.id,
            timestamp: event.created_at * 1000,
            metadata: {
              content: event.content,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to check for mentions', error);
    }
  }

  /**
   * Check for reposts (kind 6 events)
   */
  private async checkForReposts(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for reposts since ${since}`);

      const events = await this.accountRelay.getMany({
        kinds: [kinds.Repost],
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.REPOSTS,
      });

      this.logger.debug(`Found ${events.length} repost events`);

      for (const event of events) {
        await this.createContentNotification({
          type: NotificationType.REPOST,
          title: 'Reposted your note',
          authorPubkey: event.pubkey,
          eventId: event.id,
          timestamp: event.created_at * 1000,
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for reposts', error);
    }
  }

  /**
   * Check for replies (kind 1 events with 'e' tag marked as 'reply')
   */
  private async checkForReplies(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for replies since ${since}`);

      const events = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.REPLIES,
      });

      this.logger.debug(`Found ${events.length} potential reply events`);

      for (const event of events) {
        // Only include events that have a reply marker
        const hasReplyTag = event.tags.some(
          tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root')
        );

        if (hasReplyTag) {
          await this.createContentNotification({
            type: NotificationType.REPLY,
            title: 'Replied to your note',
            message: event.content.substring(0, 100),
            authorPubkey: event.pubkey,
            eventId: event.id,
            timestamp: event.created_at * 1000,
            metadata: {
              content: event.content,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to check for replies', error);
    }
  }

  /**
   * Check for reactions (kind 7 events)
   */
  private async checkForReactions(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for reactions since ${since}`);

      const events = await this.accountRelay.getMany({
        kinds: [kinds.Reaction],
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.REACTIONS,
      });

      this.logger.debug(`Found ${events.length} reaction events`);

      for (const event of events) {
        const reactionContent = event.content || '👍';

        await this.createContentNotification({
          type: NotificationType.REACTION,
          title: `Reacted ${reactionContent}`,
          message: 'Someone reacted to your note',
          authorPubkey: event.pubkey,
          eventId: event.id,
          timestamp: event.created_at * 1000,
          metadata: {
            reactionContent,
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for reactions', error);
    }
  }

  /**
   * Check for zaps (kind 9735 events)
   */
  private async checkForZaps(pubkey: string, since: number): Promise<void> {
    try {
      this.logger.debug(`Checking for zaps since ${since}`);

      const events = await this.accountRelay.getMany({
        kinds: [9735], // Zap receipt
        '#p': [pubkey],
        since,
        limit: NOTIFICATION_QUERY_LIMITS.ZAPS,
      });

      this.logger.debug(`Found ${events.length} zap events`);

      for (const event of events) {
        // Extract the zap sender's pubkey from the description tag (zap request)
        const descriptionTag = event.tags.find(tag => tag[0] === 'description');
        let zapperPubkey = event.pubkey; // Fallback to LNURL service pubkey
        let zapRequestEventId: string | undefined;

        if (descriptionTag && descriptionTag[1]) {
          try {
            const zapRequest = JSON.parse(descriptionTag[1]);
            if (zapRequest && zapRequest.pubkey) {
              zapperPubkey = zapRequest.pubkey; // This is the actual zapper

              // Extract the event that was zapped (if any)
              const eTag = zapRequest.tags?.find((t: string[]) => t[0] === 'e');
              if (eTag && eTag[1]) {
                zapRequestEventId = eTag[1];
              }
            }
          } catch (err) {
            this.logger.warn('Failed to parse zap request description', err);
          }
        }

        // Extract zap amount from bolt11 tag if available
        const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
        let zapAmount = 0;

        if (bolt11Tag) {
          // Parse amount from bolt11 invoice (simplified)
          // In production, you'd want a proper bolt11 decoder
          const bolt11 = bolt11Tag[1];
          const amountMatch = bolt11.match(/lnbc(\d+)/);
          if (amountMatch) {
            zapAmount = parseInt(amountMatch[1], 10);
          }
        }

        await this.createContentNotification({
          type: NotificationType.ZAP,
          title: 'Zapped you',
          message: zapAmount > 0 ? `${zapAmount} sats` : undefined,
          authorPubkey: zapperPubkey, // Use the actual zapper's pubkey
          eventId: zapRequestEventId, // Use the zapped event ID (undefined for profile zaps)
          timestamp: event.created_at * 1000,
          metadata: {
            zapAmount,
            zappedEventId: zapRequestEventId, // Store which event was zapped
            zapReceiptId: event.id, // Store the zap receipt ID for reference
            recipientPubkey: pubkey, // Store recipient for profile zap navigation
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for zaps', error);
    }
  }

  /**
   * Create a content notification
   */
  private async createContentNotification(data: {
    type: NotificationType;
    title: string;
    message?: string;
    authorPubkey: string;
    eventId?: string;
    timestamp: number;
    metadata?: {
      content?: string;
      reactionContent?: string;
      zapAmount?: number;
      zappedEventId?: string; // The event that was zapped (if any)
      zapReceiptId?: string; // The zap receipt event ID (kind 9735)
      recipientPubkey?: string; // For profile zaps, the recipient's pubkey
    };
  }): Promise<void> {
    // Use eventId in the notification ID to ensure uniqueness (especially important for zaps)
    // For profile zaps without eventId, use zapReceiptId instead
    // Fall back to timestamp-based ID if neither is available
    const notificationId = data.eventId
      ? `content-${data.type}-${data.eventId}`
      : data.metadata?.zapReceiptId
        ? `content-${data.type}-${data.metadata.zapReceiptId}`
        : `content-${data.type}-${data.authorPubkey}-${data.timestamp}`;

    const notification: ContentNotification = {
      id: notificationId,
      type: data.type,
      title: data.title,
      message: data.message,
      timestamp: data.timestamp,
      read: false,
      authorPubkey: data.authorPubkey,
      eventId: data.eventId,
      metadata: data.metadata,
    };

    // Add to notification service (which handles storage)
    this.notificationService.addNotification(notification);
    await this.notificationService.persistNotificationToStorage(notification);

    this.logger.debug(`Created content notification: ${notification.id}`);
  }

  /**
   * Get the last check timestamp from storage, or 1 month ago if never checked
   * This prevents loading the entire notification history on first run
   */
  private async getLastCheckTimestamp(): Promise<number> {
    try {
      const data = this.localStorage.getItem(LAST_NOTIFICATION_CHECK_KEY);
      if (data) {
        return parseInt(data, 10);
      }

      // Default to 1 month ago instead of 0 (epoch time)
      // This prevents loading years of notification history on first run
      const oneMonthAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // 30 days in seconds
      this.logger.debug(`No previous check found, defaulting to 1 month ago: ${oneMonthAgo}`);
      return oneMonthAgo;
    } catch (error) {
      this.logger.error('Failed to get last check timestamp', error);
      // Return 1 month ago as fallback
      return Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    }
  }

  /**
   * Update the last check timestamp in storage
   */
  private async updateLastCheckTimestamp(timestamp: number): Promise<void> {
    try {
      this.localStorage.setItem(LAST_NOTIFICATION_CHECK_KEY, timestamp.toString());
      this.logger.debug(`Updated last check timestamp to ${timestamp}`);
    } catch (error) {
      this.logger.error('Failed to update last check timestamp', error);
    }
  }

  /**
   * Get the current checking status
   */
  get checking(): boolean {
    return this.isChecking();
  }
}
