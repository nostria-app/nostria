import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { AccountRelayService } from './relays/account-relay';
import { ContentNotification, NotificationType } from './storage.service';
import { LocalStorageService } from './local-storage.service';
import { kinds, nip57 } from 'nostr-tools';
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
  private _lastCheckTimestamp = signal<number>(0);

  // Public readonly accessor for lastCheckTimestamp
  readonly lastCheckTimestamp = this._lastCheckTimestamp.asReadonly();

  // Track if the service has been initialized
  private _initialized = signal<boolean>(false);
  readonly initialized = this._initialized.asReadonly();

  resetLastCheckTimestamp(): void {
    this._lastCheckTimestamp.set(0);
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
      this._lastCheckTimestamp.set(timestamp);
      this._initialized.set(true);
      this.logger.debug(`Initialized with last check timestamp: ${timestamp}`);
    } catch (error) {
      this.logger.error('Failed to initialize ContentNotificationService', error);
    }
  }

  /**
   * Check for new content notifications since last check
   * @param limitDays If provided, only fetch notifications from the last N days (for initial load)
   */
  async checkForNewNotifications(limitDays?: number): Promise<void> {
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
      let since = this._lastCheckTimestamp();
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds

      // If limitDays is specified, use it to limit how far back we look
      // This is useful for first-time users to avoid loading too much history
      if (limitDays !== undefined && limitDays > 0) {
        const limitTimestamp = Math.floor((Date.now() - limitDays * 24 * 60 * 60 * 1000) / 1000);
        since = Math.max(since, limitTimestamp);
        this.logger.info(`Limiting notification fetch to last ${limitDays} days (since ${new Date(since * 1000).toISOString()})`);
      }

      // Check for all notification types in parallel
      // Pass the pubkey to each check function
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
      this._lastCheckTimestamp.set(now);

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
        // Get all 'p' tags (follows) from the contact list
        const pTags = event.tags.filter(tag => tag[0] === 'p');

        // Only create notification if this user's pubkey is the LAST 'p' tag
        // This indicates it's the most recent follow, not an old one
        if (pTags.length > 0) {
          const lastPTag = pTags[pTags.length - 1];
          const isLastFollow = lastPTag[1] === pubkey;

          if (isLastFollow) {
            await this.createContentNotification({
              type: NotificationType.NEW_FOLLOWER,
              title: 'New follower',
              message: 'Someone started following you',
              authorPubkey: event.pubkey,
              recipientPubkey: pubkey, // The account that received this notification
              eventId: event.id,
              timestamp: event.created_at * 1000, // Convert to milliseconds
            });
          }
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
            recipientPubkey: pubkey,
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
          recipientPubkey: pubkey,
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
            recipientPubkey: pubkey,
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
          recipientPubkey: pubkey,
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

        if (bolt11Tag && bolt11Tag[1]) {
          try {
            // Use nostr-tools to properly decode bolt11 invoice amount
            const amountSats = nip57.getSatoshisAmountFromBolt11(bolt11Tag[1]);
            if (amountSats) {
              zapAmount = amountSats; // Amount is already in satoshis
            }
          } catch (error) {
            this.logger.warn('Failed to parse bolt11 amount from zap receipt', error);
            // Fallback: try to get amount from the zap request
            try {
              const zapRequest = descriptionTag && descriptionTag[1] ? JSON.parse(descriptionTag[1]) : null;
              if (zapRequest) {
                const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === 'amount');
                if (amountTag && amountTag[1]) {
                  zapAmount = Math.round(parseInt(amountTag[1], 10) / 1000); // Convert msats to sats
                }
              }
            } catch (fallbackError) {
              this.logger.warn('Fallback amount parsing also failed', fallbackError);
            }
          }
        }

        await this.createContentNotification({
          type: NotificationType.ZAP,
          title: 'Zapped you',
          message: zapAmount > 0 ? `${zapAmount} sats` : undefined,
          authorPubkey: zapperPubkey, // Use the actual zapper's pubkey
          recipientPubkey: pubkey, // The account that received this zap
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
    recipientPubkey: string; // The account that received this notification
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
    // Generate unique notification ID
    // For zaps, always use the zap receipt ID (unique per zap) to avoid duplicates
    // For other notification types, use eventId if available
    let notificationId: string;

    if (data.type === NotificationType.ZAP && data.metadata?.zapReceiptId) {
      // For zaps, use the zap receipt ID (unique for each zap)
      notificationId = `content-${data.type}-${data.metadata.zapReceiptId}`;
    } else if (data.eventId) {
      // For other notifications, use the event ID
      notificationId = `content-${data.type}-${data.eventId}`;
    } else {
      // Fallback to timestamp-based ID
      notificationId = `content-${data.type}-${data.authorPubkey}-${data.timestamp}`;
    }

    const notification: ContentNotification = {
      id: notificationId,
      type: data.type,
      title: data.title,
      message: data.message,
      timestamp: data.timestamp,
      read: false,
      recipientPubkey: data.recipientPubkey, // Store which account received this notification
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

      // Return 0 for first-time users (no previous check)
      // The 30-day limit for first-time users is handled by the limitDays parameter
      this.logger.debug('No previous check found, returning 0 for first-time user');
      return 0;
    } catch (error) {
      this.logger.error('Failed to get last check timestamp', error);
      // Return 0 as fallback for first-time detection
      return 0;
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
