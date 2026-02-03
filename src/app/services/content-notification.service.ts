import { Injectable, inject, signal, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { AccountRelayService } from './relays/account-relay';
import { ContentNotification, NotificationType } from './database.service';
import { DatabaseService } from './database.service';
import { kinds, nip57, Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { LocalSettingsService } from './local-settings.service';

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
 * 
 * This service also manages periodic polling for new notifications with visibility awareness:
 * - Checks for new notifications every 5 minutes when the app is visible
 * - Immediately checks when the app returns to visibility after being hidden
 * - Pauses polling when the app is hidden to conserve resources
 */
@Injectable({
  providedIn: 'root',
})
export class ContentNotificationService implements OnDestroy {
  private logger = inject(LoggerService);
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);
  private database = inject(DatabaseService);
  private platformId = inject(PLATFORM_ID);
  private localSettings = inject(LocalSettingsService);

  // Polling configuration
  private readonly POLLING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MIN_TIME_BETWEEN_CHECKS_MS = 30 * 1000; // 30 seconds minimum between checks
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheckTime = 0;
  private visibilityChangeHandler: (() => void) | null = null;
  private isPollingEnabled = false;

  // Track the last check timestamp to avoid duplicate notifications
  private _lastCheckTimestamp = signal<number>(0);

  // Public readonly accessor for lastCheckTimestamp
  readonly lastCheckTimestamp = this._lastCheckTimestamp.asReadonly();

  // Track if the service has been initialized
  private _initialized = signal<boolean>(false);
  readonly initialized = this._initialized.asReadonly();

  resetLastCheckTimestamp(): void {
    this._lastCheckTimestamp.set(0);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setNotificationLastCheck(pubkey, 0);
    }
    this.logger.info('ContentNotificationService last check timestamp reset for account');
  }

  // Track if we're currently checking for new content
  private isChecking = signal<boolean>(false);

  constructor() {
    this.logger.info('ContentNotificationService initialized');
  }

  /**
   * Clean up resources when service is destroyed
   */
  ngOnDestroy(): void {
    this.stopPolling();
  }

  /**
   * Initialize the service and load the last check timestamp
   * Also starts periodic polling for new notifications
   */
  async initialize(): Promise<void> {
    try {
      const timestamp = await this.getLastCheckTimestamp();
      this._lastCheckTimestamp.set(timestamp);
      this._initialized.set(true);
      this.logger.debug(`Initialized with last check timestamp: ${timestamp}`);

      // Start periodic polling after initialization
      this.startPolling();
    } catch (error) {
      this.logger.error('Failed to initialize ContentNotificationService', error);
    }
  }

  /**
   * Check if an event should be filtered out due to having too many tagged accounts.
   * This is a spam prevention measure - mass-tagging events are often spam.
   * @param event The Nostr event to check
   * @returns true if the event should be filtered out (not create notification)
   */
  private shouldFilterMassTaggedEvent(event: Event): boolean {
    const maxTags = this.localSettings.maxTaggedAccountsFilter();

    // If no filter is set, allow all events
    if (maxTags === 'none') {
      return false;
    }

    // Count the number of 'p' tags (tagged accounts) in the event
    const pTagCount = event.tags.filter(tag => tag[0] === 'p').length;

    if (pTagCount > maxTags) {
      this.logger.debug(`Filtering notification from mass-tagged event: ${event.id} (${pTagCount} tags, limit: ${maxTags})`);
      return true;
    }

    return false;
  }

  /**
   * Start periodic polling for new notifications
   * This sets up:
   * 1. An interval that checks every 5 minutes
   * 2. A visibility change handler that checks immediately when returning to the app
   */
  startPolling(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.debug('[Polling] Not in browser, skipping polling setup');
      return;
    }

    if (this.isPollingEnabled) {
      this.logger.debug('[Polling] Polling already enabled');
      return;
    }

    this.isPollingEnabled = true;
    this.logger.info('[Polling] Starting notification polling (5 minute interval)');

    // Set up visibility change handler
    this.visibilityChangeHandler = () => this.handleVisibilityChange();
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    // Start the polling interval
    this.startPollingInterval();
  }

  /**
   * Stop periodic polling for notifications
   */
  stopPolling(): void {
    this.isPollingEnabled = false;

    // Clear the polling interval
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
      this.logger.debug('[Polling] Cleared polling interval');
    }

    // Remove visibility change handler
    if (this.visibilityChangeHandler && isPlatformBrowser(this.platformId)) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
      this.logger.debug('[Polling] Removed visibility change handler');
    }

    this.logger.info('[Polling] Notification polling stopped');
  }

  /**
   * Start or restart the polling interval
   */
  private startPollingInterval(): void {
    // Clear any existing interval
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }

    // Only start if polling is enabled and document is visible
    if (!this.isPollingEnabled) {
      return;
    }

    if (isPlatformBrowser(this.platformId) && document.hidden) {
      this.logger.debug('[Polling] Document is hidden, not starting interval');
      return;
    }

    this.pollingIntervalId = setInterval(async () => {
      await this.performPollingCheck();
    }, this.POLLING_INTERVAL_MS);

    this.logger.debug('[Polling] Started polling interval');
  }

  /**
   * Handle visibility change events
   * When the app becomes visible after being hidden, immediately check for new notifications
   */
  private handleVisibilityChange(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (document.hidden) {
      // App is now hidden - stop the polling interval to conserve resources
      this.logger.debug('[Polling] App hidden, pausing polling interval');
      if (this.pollingIntervalId) {
        clearInterval(this.pollingIntervalId);
        this.pollingIntervalId = null;
      }
    } else {
      // App is now visible - check immediately and restart polling
      this.logger.debug('[Polling] App visible, checking for notifications and resuming polling');

      // Immediately check for new notifications (with rate limiting)
      this.performPollingCheck();

      // Restart the polling interval
      this.startPollingInterval();
    }
  }

  /**
   * Perform a polling check for new notifications
   * This is rate-limited to prevent excessive checks
   */
  private async performPollingCheck(): Promise<void> {
    // Check if user is authenticated
    if (!this.accountState.pubkey()) {
      this.logger.debug('[Polling] No authenticated user, skipping check');
      return;
    }

    // Rate limit: don't check more frequently than MIN_TIME_BETWEEN_CHECKS_MS
    const now = Date.now();
    if (now - this.lastCheckTime < this.MIN_TIME_BETWEEN_CHECKS_MS) {
      this.logger.debug('[Polling] Rate limited, skipping check');
      return;
    }

    this.lastCheckTime = now;

    try {
      await this.checkForNewNotifications();
      this.logger.debug('[Polling] Periodic notification check completed');
    } catch (error) {
      this.logger.error('[Polling] Periodic notification check failed', error);
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
      // CRITICAL: Always read from storage for the current account, not from in-memory signal
      // The signal is not account-specific and can be stale after account switches
      let since = await this.getLastCheckTimestamp();
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds

      // Default to 7 days back maximum to avoid loading too much history
      // This applies when: since is 0 (first time), since is very old, or cache was cleared
      const defaultMaxDays = 7;
      const defaultLimitTimestamp = Math.floor((Date.now() - defaultMaxDays * 24 * 60 * 60 * 1000) / 1000);
      
      // Always ensure we don't go further back than the default limit
      since = Math.max(since, defaultLimitTimestamp);

      // If limitDays is specified and is more restrictive, use it instead
      // This is useful for first-time users to avoid loading too much history
      if (limitDays !== undefined && limitDays > 0) {
        const limitTimestamp = Math.floor((Date.now() - limitDays * 24 * 60 * 60 * 1000) / 1000);
        since = Math.max(since, limitTimestamp);
        this.logger.info(`Limiting notification fetch to last ${limitDays} days (since ${new Date(since * 1000).toISOString()})`);
      }

      this.logger.debug(`Fetching notifications since timestamp: ${since} (${new Date(since * 1000).toISOString()})`);

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
        // Skip if the follower is the current user (don't notify yourself)
        if (event.pubkey === pubkey) {
          continue;
        }

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
              kind: 3,
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
        // Skip if the author is the current user (don't notify yourself)
        if (event.pubkey === pubkey) {
          continue;
        }

        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) {
          continue;
        }

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
            kind: 1,
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
        // Skip if the reposter is the current user (don't notify yourself)
        if (event.pubkey === pubkey) {
          continue;
        }

        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) {
          continue;
        }

        await this.createContentNotification({
          type: NotificationType.REPOST,
          title: 'Reposted your note',
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: event.id,
          kind: 6,
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
        // Skip if the replier is the current user (don't notify yourself)
        if (event.pubkey === pubkey) {
          continue;
        }

        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) {
          continue;
        }

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
            kind: 1,
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
        // Skip if the reactor is the current user (don't notify yourself)
        if (event.pubkey === pubkey) {
          continue;
        }

        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) {
          continue;
        }

        // Convert '+' to heart emoji for better display, otherwise use the actual reaction
        const rawContent = event.content || '+';
        const reactionContent = (!rawContent || rawContent === '+') ? '❤️' : rawContent;

        // Extract custom emoji URL from tags (NIP-30)
        // Custom emojis have content in :shortcode: format and an emoji tag with the URL
        let customEmojiUrl: string | undefined;
        if (rawContent.startsWith(':') && rawContent.endsWith(':')) {
          const shortcode = rawContent.slice(1, -1); // Remove colons
          const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
          if (emojiTag?.[2]) {
            customEmojiUrl = emojiTag[2];
          }
        }

        // Extract the event being reacted to from the 'e' tag
        const eTag = event.tags.find(tag => tag[0] === 'e');
        const reactedEventId = eTag?.[1];

        // Try to fetch the original event content to show in the notification
        let reactedEventContent = '';
        if (reactedEventId) {
          try {
            // First try to get from local database
            let reactedEvent = await this.database.getEventById(reactedEventId);

            // If not found locally, try from relay
            if (!reactedEvent) {
              reactedEvent = await this.accountRelay.get({
                ids: [reactedEventId],
              });
            }

            if (reactedEvent?.content) {
              reactedEventContent = reactedEvent.content.substring(0, 100);
            }
          } catch (error) {
            this.logger.debug('Failed to fetch reacted event content', error);
          }
        }

        await this.createContentNotification({
          type: NotificationType.REACTION,
          title: `Reacted ${reactionContent}`,
          message: reactedEventContent || 'Reacted to your note',
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: reactedEventId, // Use the event being reacted to, not the reaction event
          timestamp: event.created_at * 1000,
          metadata: {
            reactionContent,
            reactionEventId: event.id, // Store the reaction event ID for reference
            customEmojiUrl, // Store custom emoji URL for NIP-30 emojis
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
        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) {
          continue;
        }

        // Extract the zap sender's pubkey from the description tag (zap request)
        const descriptionTag = event.tags.find(tag => tag[0] === 'description');
        let zapperPubkey = event.pubkey; // Fallback to LNURL service pubkey
        let zapRequestEventId: string | undefined;
        let zapContent: string | undefined;

        if (descriptionTag && descriptionTag[1]) {
          try {
            const zapRequest = JSON.parse(descriptionTag[1]);
            if (zapRequest && zapRequest.pubkey) {
              zapperPubkey = zapRequest.pubkey; // This is the actual zapper

              // Extract the content/message from the zap request
              if (zapRequest.content && typeof zapRequest.content === 'string') {
                zapContent = zapRequest.content.trim();
              }

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

        // Skip if the zapper is the current user (don't notify yourself)
        if (zapperPubkey === pubkey) {
          continue;
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
            content: zapContent, // Store the zap message/comment
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
    kind?: number;
    timestamp: number;
    metadata?: {
      content?: string;
      reactionContent?: string;
      reactionEventId?: string; // For reactions, the reaction event ID (kind 7)
      customEmojiUrl?: string; // For reactions, the custom emoji image URL (NIP-30)
      zapAmount?: number;
      zappedEventId?: string; // The event that was zapped (if any)
      zapReceiptId?: string; // The zap receipt event ID (kind 9735)
      recipientPubkey?: string; // For profile zaps, the recipient's pubkey
    };
  }): Promise<void> {
    // CRITICAL: Filter out notifications from muted/blocked accounts
    // Don't create or store notifications from muted users at all
    const mutedAccounts = this.accountState.mutedAccounts();
    if (mutedAccounts.includes(data.authorPubkey)) {
      this.logger.debug(`Skipping notification from muted account: ${data.authorPubkey}`);
      return;
    }

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

    // Check if notification already exists to prevent duplicates
    // This prevents re-parsed events from marking already-read notifications as unread

    // First check in-memory notifications (fastest)
    const existingInMemory = this.notificationService.notifications().find(n => n.id === notificationId);
    if (existingInMemory) {
      this.logger.debug(`Skipping duplicate notification: ${notificationId} (already exists in memory)`);
      return;
    }

    // Also check storage as a fallback (in case notification was cleared from memory but still in storage)
    const existingInStorage = await this.database.getNotification(notificationId);
    if (existingInStorage) {
      this.logger.debug(`Skipping duplicate notification: ${notificationId} (already exists in storage)`);
      return;
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
      kind: data.kind,
      metadata: data.metadata,
    };

    // Add to notification service (which handles storage)
    this.notificationService.addNotification(notification);
    await this.notificationService.persistNotificationToStorage(notification);

    this.logger.debug(`Created content notification: ${notification.id}`);
  }

  /**
   * Get the last check timestamp from storage for the current account
   * Returns 0 if never checked before (first-time user)
   */
  private async getLastCheckTimestamp(): Promise<number> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey available, returning 0 for last check timestamp');
        return 0;
      }

      const timestamp = this.accountLocalState.getNotificationLastCheck(pubkey);
      this.logger.info(`[getLastCheckTimestamp] Loaded last check timestamp for account ${pubkey.slice(0, 8)}: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
      return timestamp;
    } catch (error) {
      this.logger.error('Failed to get last check timestamp', error);
      // Return 0 as fallback for first-time detection
      return 0;
    }
  }

  /**
   * Update the last check timestamp in storage for the current account
   */
  private async updateLastCheckTimestamp(timestamp: number): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey available, cannot update last check timestamp');
        return;
      }

      this.accountLocalState.setNotificationLastCheck(pubkey, timestamp);
      this.logger.info(`[updateLastCheckTimestamp] Updated last check timestamp for account ${pubkey.slice(0, 8)} to ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
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

  /**
   * Refresh recent notifications by re-fetching from relays
   * This does NOT reset the last check timestamp - it just re-checks recent activity
   * to catch any notifications that may have been missed due to relay issues.
   * @param days Number of days to look back (default: 7 days)
   */
  async refreshRecentNotifications(days = 7): Promise<void> {
    if (this.isChecking()) {
      this.logger.debug('Already checking for notifications, skipping refresh');
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('No active account, skipping notification refresh');
      return;
    }

    this.isChecking.set(true);

    try {
      this.logger.info(`Refreshing notifications for the last ${days} days`);
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
      const since = now - (days * 24 * 60 * 60);

      this.logger.debug(`Fetching notifications from ${new Date(since * 1000).toISOString()} to now`);

      // Check for all notification types in parallel
      await Promise.all([
        this.checkForNewFollowers(pubkey, since),
        this.checkForMentions(pubkey, since),
        this.checkForReposts(pubkey, since),
        this.checkForReplies(pubkey, since),
        this.checkForReactions(pubkey, since),
        this.checkForZaps(pubkey, since),
      ]);

      // Note: We deliberately do NOT update the lastCheckTimestamp here
      // This is a refresh operation, not a regular check
      // The regular checkForNewNotifications will still work normally

      this.logger.info('Completed refreshing recent notifications');
    } catch (error) {
      this.logger.error('Failed to refresh recent notifications', error);
      throw error; // Re-throw so the UI can show an error message
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Check for older notifications within a specific time range
   * Used for "load more" functionality when scrolling
   * @param since Unix timestamp (seconds) - start of range
   * @param until Unix timestamp (seconds) - end of range
   */
  async checkForOlderNotifications(since: number, until: number): Promise<void> {
    if (this.isChecking()) {
      this.logger.debug('Already checking for notifications, skipping');
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('No active account, skipping older notification check');
      return;
    }

    this.isChecking.set(true);

    try {
      this.logger.info(`Loading older notifications from ${new Date(since * 1000).toISOString()} to ${new Date(until * 1000).toISOString()}`);

      // Check for all notification types in parallel with the specific time range
      await Promise.all([
        this.checkForNewFollowersInRange(pubkey, since, until),
        this.checkForMentionsInRange(pubkey, since, until),
        this.checkForRepostsInRange(pubkey, since, until),
        this.checkForRepliesInRange(pubkey, since, until),
        this.checkForReactionsInRange(pubkey, since, until),
        this.checkForZapsInRange(pubkey, since, until),
      ]);

      this.logger.info('Completed loading older notifications');
    } catch (error) {
      this.logger.error('Failed to check for older notifications', error);
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Check for new followers within a specific time range
   */
  private async checkForNewFollowersInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [kinds.Contacts],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.FOLLOWERS,
      });

      for (const event of events) {
        if (event.pubkey === pubkey) continue;

        const pTags = event.tags.filter(tag => tag[0] === 'p');
        if (pTags.length > 0) {
          const lastPTag = pTags[pTags.length - 1];
          if (lastPTag[1] === pubkey) {
            await this.createContentNotification({
              type: NotificationType.NEW_FOLLOWER,
              title: 'New follower',
              message: 'Someone started following you',
              authorPubkey: event.pubkey,
              recipientPubkey: pubkey,
              eventId: event.id,
              kind: 3,
              timestamp: event.created_at * 1000,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to check for new followers in range', error);
    }
  }

  /**
   * Check for mentions within a specific time range
   */
  private async checkForMentionsInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.MENTIONS,
      });

      for (const event of events) {
        if (event.pubkey === pubkey) continue;
        if (this.shouldFilterMassTaggedEvent(event)) continue;

        const isReply = event.tags.some(tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root'));
        if (isReply) continue;

        await this.createContentNotification({
          type: NotificationType.MENTION,
          title: 'Mentioned you',
          message: event.content.substring(0, 100) + (event.content.length > 100 ? '...' : ''),
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: event.id,
          kind: 1,
          timestamp: event.created_at * 1000,
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for mentions in range', error);
    }
  }

  /**
   * Check for reposts within a specific time range
   */
  private async checkForRepostsInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [kinds.Repost, 16],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.REPOSTS,
      });

      for (const event of events) {
        if (event.pubkey === pubkey) continue;
        if (this.shouldFilterMassTaggedEvent(event)) continue;

        const eTag = event.tags.find(tag => tag[0] === 'e');
        await this.createContentNotification({
          type: NotificationType.REPOST,
          title: 'Reposted your note',
          message: '',
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: eTag?.[1] || event.id,
          kind: event.kind,
          timestamp: event.created_at * 1000,
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for reposts in range', error);
    }
  }

  /**
   * Check for replies within a specific time range
   */
  private async checkForRepliesInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [kinds.ShortTextNote],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.REPLIES,
      });

      for (const event of events) {
        if (event.pubkey === pubkey) continue;
        if (this.shouldFilterMassTaggedEvent(event)) continue;

        const isReply = event.tags.some(tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root'));
        if (!isReply) continue;

        const replyToTag = event.tags.find(tag => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root'));
        await this.createContentNotification({
          type: NotificationType.REPLY,
          title: 'Replied to your note',
          message: event.content.substring(0, 100) + (event.content.length > 100 ? '...' : ''),
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: replyToTag?.[1] || event.id,
          kind: 1,
          timestamp: event.created_at * 1000,
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for replies in range', error);
    }
  }

  /**
   * Check for reactions within a specific time range
   */
  private async checkForReactionsInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [kinds.Reaction],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.REACTIONS,
      });

      for (const event of events) {
        if (event.pubkey === pubkey) continue;
        if (this.shouldFilterMassTaggedEvent(event)) continue;

        const eTag = event.tags.find(tag => tag[0] === 'e');
        const reactedEventId = eTag?.[1];
        const rawContent = event.content || '+';
        const reactionContent = (!rawContent || rawContent === '+') ? '❤️' : rawContent;

        // Extract custom emoji URL from tags (NIP-30)
        // Custom emojis have content in :shortcode: format and an emoji tag with the URL
        let customEmojiUrl: string | undefined;
        if (rawContent.startsWith(':') && rawContent.endsWith(':')) {
          const shortcode = rawContent.slice(1, -1); // Remove colons
          const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
          if (emojiTag?.[2]) {
            customEmojiUrl = emojiTag[2];
          }
        }

        // Try to fetch the original event content to show in the notification
        let reactedEventContent = '';
        if (reactedEventId) {
          try {
            // First try to get from local database
            let reactedEvent = await this.database.getEventById(reactedEventId);

            // If not found locally, try from relay
            if (!reactedEvent) {
              reactedEvent = await this.accountRelay.get({
                ids: [reactedEventId],
              });
            }

            if (reactedEvent?.content) {
              reactedEventContent = reactedEvent.content.substring(0, 100);
            }
          } catch (error) {
            this.logger.debug('Failed to fetch reacted event content', error);
          }
        }

        await this.createContentNotification({
          type: NotificationType.REACTION,
          title: `Reacted ${reactionContent}`,
          message: reactedEventContent || 'Reacted to your note',
          authorPubkey: event.pubkey,
          recipientPubkey: pubkey,
          eventId: reactedEventId || event.id,
          kind: 7,
          timestamp: event.created_at * 1000,
          metadata: {
            reactionContent,
            reactionEventId: event.id,
            customEmojiUrl, // Store custom emoji URL for NIP-30 emojis
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for reactions in range', error);
    }
  }

  /**
   * Check for zaps within a specific time range
   */
  private async checkForZapsInRange(pubkey: string, since: number, until: number): Promise<void> {
    try {
      const events = await this.accountRelay.getMany({
        kinds: [9735],
        '#p': [pubkey],
        since,
        until,
        limit: NOTIFICATION_QUERY_LIMITS.ZAPS,
      });

      for (const event of events) {
        // Skip events with too many tagged accounts (spam prevention)
        if (this.shouldFilterMassTaggedEvent(event)) continue;

        // Parse the zap request from the description tag
        const descriptionTag = event.tags.find(tag => tag[0] === 'description');
        let zapperPubkey = event.pubkey;
        let zapContent = '';
        let zapRequestEventId: string | undefined;

        if (descriptionTag && descriptionTag[1]) {
          try {
            const zapRequest = JSON.parse(descriptionTag[1]);
            if (zapRequest && zapRequest.pubkey) {
              zapperPubkey = zapRequest.pubkey;
              if (zapRequest.content && typeof zapRequest.content === 'string') {
                zapContent = zapRequest.content.trim();
              }
              const eTag = zapRequest.tags?.find((t: string[]) => t[0] === 'e');
              if (eTag && eTag[1]) {
                zapRequestEventId = eTag[1];
              }
            }
          } catch (err) {
            this.logger.warn('Failed to parse zap request description', err);
          }
        }

        // Skip if the zapper is the current user
        if (zapperPubkey === pubkey) continue;

        // Extract zap amount from bolt11 tag
        const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
        let zapAmount = 0;

        if (bolt11Tag && bolt11Tag[1]) {
          try {
            const amountSats = nip57.getSatoshisAmountFromBolt11(bolt11Tag[1]);
            if (amountSats) {
              zapAmount = amountSats;
            }
          } catch (error) {
            this.logger.warn('Failed to parse bolt11 amount from zap receipt', error);
          }
        }

        await this.createContentNotification({
          type: NotificationType.ZAP,
          title: 'Zapped you',
          message: zapAmount > 0 ? `${zapAmount} sats` : undefined,
          authorPubkey: zapperPubkey,
          recipientPubkey: pubkey,
          eventId: zapRequestEventId,
          kind: 9735,
          timestamp: event.created_at * 1000,
          metadata: {
            zapAmount,
            zappedEventId: zapRequestEventId,
            zapReceiptId: event.id,
            recipientPubkey: pubkey,
            content: zapContent,
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to check for zaps in range', error);
    }
  }
}
