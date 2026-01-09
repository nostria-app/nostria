import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { LoggerService } from './logger.service';
import {
  GeneralNotification,
  Notification,
  NotificationType,
  RelayPublishingNotification,
  RelayPublishPromise,
  ContentNotification,
} from './database.service';
import { DatabaseService } from './database.service';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { PublishEventBus } from './publish-event-bus.service';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private logger = inject(LoggerService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private eventBus = inject(PublishEventBus);

  // Store all notifications
  private _notifications = signal<Notification[]>([]);

  // Read-only signal exposing notifications
  readonly notifications = this._notifications.asReadonly();

  // Signal to track if notifications have been loaded from storage
  private _notificationsLoaded = signal(false);
  readonly notificationsLoaded = this._notificationsLoaded.asReadonly();

  // Track previously seen muted accounts to detect new mutes
  private _previousMutedAccounts = signal<string[]>([]);

  // Track previous pubkey to detect actual account changes
  private _previousPubkey = signal<string | null>(null);

  // Track active publishing notifications by event ID
  private activePublishNotifications = new Map<string, string>(); // eventId -> notificationId

  constructor() {
    this.logger.info('NotificationService initialized');

    // Subscribe to publish events from event bus
    this.subscribeToPublishEvents();

    // Set up effect to persist notifications when they change
    effect(() => {
      // Don't save until initial load is complete
      if (this._notificationsLoaded()) {
        // this.persistNotifications();
      }
    });

    // Set up effect to reload notifications when account ACTUALLY changes (not initial load)
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const previousPubkey = untracked(() => this._previousPubkey());
      
      // Only reload if pubkey actually changed (not initial load)
      if (pubkey && previousPubkey && pubkey !== previousPubkey) {
        this.logger.info(`Account changed from ${previousPubkey.substring(0, 8)}... to ${pubkey.substring(0, 8)}..., reloading notifications`);
        this.loadNotifications();
      }
      
      // Update previous pubkey
      untracked(() => this._previousPubkey.set(pubkey));
    });

    // Set up effect to clean up notifications when accounts are muted
    effect(() => {
      const currentMutedAccounts = this.accountState.mutedAccounts();

      // Use untracked to read previous value without creating dependency
      const previousMutedAccounts = untracked(() => this._previousMutedAccounts());

      // Find newly muted accounts
      const newlyMutedAccounts = currentMutedAccounts.filter(
        pubkey => !previousMutedAccounts.includes(pubkey)
      );

      // Update the previous muted accounts immediately (use untracked to prevent re-triggering)
      untracked(() => {
        this._previousMutedAccounts.set([...currentMutedAccounts]);
      });

      // Clean up notifications from newly muted accounts in the BACKGROUND
      // This prevents blocking initial feed loading for new users
      if (newlyMutedAccounts.length > 0) {
        this.logger.info(`Scheduling cleanup of notifications from ${newlyMutedAccounts.length} newly muted accounts`);

        // Use requestIdleCallback or setTimeout to defer this work
        // This allows the feed to load first before processing notification cleanup
        const performCleanup = () => {
          untracked(() => {
            this.cleanupNotificationsFromMutedAccounts(newlyMutedAccounts);
          });
        };

        // Use requestIdleCallback if available, otherwise setTimeout
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(performCleanup, { timeout: 5000 });
        } else {
          setTimeout(performCleanup, 100);
        }
      }
    });
  }

  /**
   * Subscribe to publish events from the event bus
   */
  private subscribeToPublishEvents(): void {
    // Handle publish started events
    this.eventBus.on('started').subscribe(event => {
      if (event.type === 'started') {
        this.handlePublishStarted(event.event, event.relayUrls);
      }
    });

    // Handle relay result events
    this.eventBus.on('relay-result').subscribe(event => {
      if (event.type === 'relay-result') {
        this.handleRelayResult(event.event.id, event.relayUrl, event.success, event.error);
      }
    });

    // Handle publish completed events
    this.eventBus.on('completed').subscribe(event => {
      if (event.type === 'completed') {
        this.handlePublishCompleted(event.event.id);
      }
    });

    // Handle publish error events
    this.eventBus.on('error').subscribe(event => {
      if (event.type === 'error') {
        this.handlePublishError(event.event.id, event.error);
      }
    });
  }

  /**
   * Handle publish started event
   */
  private handlePublishStarted(event: Event, relayUrls: string[]): void {
    const notificationId = `publish-${event.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.logger.debug(`Creating relay publishing notification ${notificationId} for event ${event.id}`);

    // Create relay promise tracking objects
    const relayPromiseObjects: RelayPublishPromise[] = relayUrls.map(relayUrl => ({
      relayUrl,
      status: 'pending',
    }));

    const pubkey = this.accountState.pubkey();

    const notification: RelayPublishingNotification = {
      id: notificationId,
      type: NotificationType.RELAY_PUBLISHING,
      timestamp: Date.now(),
      read: false,
      title: 'Publishing to relays',
      message: `Publishing event ${event.id.substring(0, 8)}... to ${relayUrls.length} relays`,
      event,
      relayPromises: relayPromiseObjects,
      complete: false,
      recipientPubkey: pubkey,
    };

    this.addNotification(notification);
    this.activePublishNotifications.set(event.id, notificationId);

    this.persistNotificationToStorage(notification);
  }

  /**
   * Handle relay result event
   */
  private handleRelayResult(eventId: string, relayUrl: string, success: boolean, error?: string): void {
    const notificationId = this.activePublishNotifications.get(eventId);
    if (!notificationId) {
      this.logger.warn(`No active notification found for event ${eventId}`);
      return;
    }

    this.updateRelayPromiseStatus(
      notificationId,
      relayUrl,
      success ? 'success' : 'failed',
      error ? new Error(error) : undefined
    );
  }

  /**
   * Handle publish completed event
   */
  private handlePublishCompleted(eventId: string): void {
    const notificationId = this.activePublishNotifications.get(eventId);
    if (!notificationId) {
      this.logger.warn(`No active notification found for event ${eventId}`);
      return;
    }

    // All relay results have already been updated via handleRelayResult
    // The notification complete flag is automatically set by updateRelayPromiseStatus
    this.activePublishNotifications.delete(eventId);
  }

  /**
   * Handle publish error event
   */
  private handlePublishError(eventId: string, error: Error): void {
    const notificationId = this.activePublishNotifications.get(eventId);
    if (notificationId) {
      // Log the error
      this.logger.error(`Publishing error for event ${eventId}: ${error.message}`);

      // The error should have already been handled via relay-result events
      // Just clean up the tracking
      this.activePublishNotifications.delete(eventId);
    }
  }

  /**
   * Load notifications from storage for the current account
   */
  async loadNotifications(): Promise<void> {
    try {
      this.logger.info('Loading notifications from storage');

      // Ensure storage is initialized
      if (!this.database.initialized()) {
        this.logger.warn('Storage not initialized yet, delaying notification loading');
        return;
      }

      const pubkey = this.accountState.pubkey();
      let storedNotifications: Notification[];

      if (pubkey) {
        // Load notifications for the current account
        this.logger.info(`Loading notifications for account: ${pubkey}`);
        storedNotifications = await this.database.getAllNotificationsForPubkey(pubkey) as unknown as Notification[];
        this.logger.info(`Found ${storedNotifications.length} notifications for account ${pubkey}`);
      } else {
        // No account logged in, load all notifications (for backward compatibility)
        this.logger.info('No account logged in, loading all notifications');
        storedNotifications = await this.database.getAllNotifications() as unknown as Notification[];
      }

      if (storedNotifications && storedNotifications.length > 0) {
        // CRITICAL: Filter out notifications from muted/blocked accounts
        // This handles cases where user muted accounts AFTER notifications were stored
        const mutedAccounts = this.accountState.mutedAccounts();
        const filteredNotifications = storedNotifications.filter(notification => {
          // System notifications (relay publishing, errors, etc.) are not filtered
          if (notification.type === NotificationType.RELAY_PUBLISHING ||
            notification.type === NotificationType.GENERAL ||
            notification.type === NotificationType.ERROR ||
            notification.type === NotificationType.SUCCESS ||
            notification.type === NotificationType.WARNING) {
            return true;
          }

          // Content notifications - check if author is muted
          const contentNotification = notification as ContentNotification;
          if (contentNotification.authorPubkey && mutedAccounts.includes(contentNotification.authorPubkey)) {
            this.logger.debug(`Filtering out notification from muted account: ${contentNotification.authorPubkey}`);
            return false;
          }

          return true;
        });

        this.logger.info(`Filtered ${storedNotifications.length - filteredNotifications.length} notifications from muted accounts`);

        // Sort by timestamp (newest first)
        filteredNotifications.sort((a, b) => b.timestamp - a.timestamp);

        this.logger.info(`Loaded ${filteredNotifications.length} notifications from storage`);
        this._notifications.set(filteredNotifications);
      } else {
        this.logger.info('No notifications found in storage');
        this._notifications.set([]);
      }

      this._notificationsLoaded.set(true);
    } catch (error) {
      this.logger.error('Failed to load notifications from storage', error);
      this._notifications.set([]);
      this._notificationsLoaded.set(true);
    }
  }

  /**
   * Add a relay publishing notification
   */
  async addRelayPublishingNotification(
    event: Event,
    relayPromises: Map<Promise<string>, string>
  ): Promise<string> {
    // Use a combination of event ID, timestamp, and random value to ensure uniqueness
    // This prevents collisions when publishing multiple events in quick succession
    const notificationId = `publish-${event.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.logger.debug(
      `Creating relay publishing notification ${notificationId} for event ${event.id}`
    );
    this.logger.debug(`Publishing to ${relayPromises.size} relays`);

    // Create relay promise tracking objects
    const relayPromiseObjects: RelayPublishPromise[] = [];

    // Convert the Map entries to RelayPublishPromise objects
    relayPromises.forEach((relayUrl, promise) => {
      this.logger.debug(`Setting up promise tracking for relay: ${relayUrl}`);
      relayPromiseObjects.push({
        relayUrl,
        status: 'pending',
        promise,
      });
    });

    // Process each promise to update its status
    relayPromiseObjects.forEach(async (relayPromise) => {
      this.logger.debug(`Starting promise monitoring for relay ${relayPromise.relayUrl}`);
      try {
        this.logger.debug(`Awaiting promise for relay ${relayPromise.relayUrl}...`);

        await relayPromise.promise;
        this.logger.debug(`Promise resolved successfully for relay ${relayPromise.relayUrl}`);
        this.updateRelayPromiseStatus(notificationId, relayPromise.relayUrl, 'success');
      } catch (error) {
        this.logger.error(`Promise failed for relay ${relayPromise.relayUrl}:`, error);
        this.updateRelayPromiseStatus(notificationId, relayPromise.relayUrl, 'failed', error);
      }
    });

    const pubkey = this.accountState.pubkey();
    this.logger.debug(
      `Creating relay publishing notification for event ${event.id}, pubkey: ${pubkey || 'undefined'}`
    );

    const notification: RelayPublishingNotification = {
      id: notificationId,
      type: NotificationType.RELAY_PUBLISHING,
      timestamp: Date.now(),
      read: false,
      title: 'Publishing to relays',
      message: `Publishing event ${event.id.substring(0, 8)}... to ${relayPromises.size} relays`,
      event,
      relayPromises: relayPromiseObjects,
      complete: false,
      recipientPubkey: pubkey, // Associate with current account
    };

    const notificationForStorage: RelayPublishingNotification = {
      id: notificationId,
      type: NotificationType.RELAY_PUBLISHING,
      timestamp: Date.now(),
      read: false,
      title: 'Publishing to relays',
      message: `Publishing event ${event.id.substring(0, 8)}... to ${relayPromises.size} relays`,
      event,
      relayPromises: relayPromiseObjects.map(rp => ({
        relayUrl: rp.relayUrl,
        status: rp.status,
        error: rp.error,
        // Don't persist the promise itself, just the metadata
      })),
      complete: false,
      recipientPubkey: pubkey, // Associate with current account
    };

    this.addNotification(notification);

    await this.persistNotificationToStorage(notificationForStorage);
    return notificationId;
  }

  /**
   * Persist a single notification to storage
   */
  async persistNotificationToStorage(notification: Notification): Promise<void> {
    if (!this.database.initialized()) {
      this.logger.warn('Storage not initialized, skipping notification persistence');
      return;
    }

    try {
      this.logger.debug(
        `Persisting notification ${notification.id} with recipientPubkey: ${notification.recipientPubkey || 'undefined'}`
      );

      // Strip out non-serializable data before storing
      let notificationToStore = notification;

      if (notification.type === NotificationType.RELAY_PUBLISHING) {
        // If this is a relay publishing notification, strip out the promise objects
        const relayNotification = notification as RelayPublishingNotification;
        notificationToStore = {
          ...relayNotification,
          relayPromises: relayNotification.relayPromises?.map(rp => ({
            relayUrl: rp.relayUrl,
            status: rp.status,
            error: rp.error,
            // Explicitly exclude the promise property - it cannot be cloned for IndexedDB
          })),
        } as RelayPublishingNotification;
      } else if ('action' in notification && notification.action) {
        // Strip out callback functions from action property
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { action, ...notificationWithoutAction } = notification;
        notificationToStore = notificationWithoutAction;
      }

      await this.database.saveNotification(notificationToStore as unknown as Record<string, unknown>);
      this.logger.debug(`Successfully persisted notification ${notification.id}`);
    } catch (error) {
      this.logger.error(`Failed to persist notification ${notification.id} to storage`, error);
    }
  }

  /**
   * Add a notification
   * Checks for duplicates by ID to prevent duplicate entries
   */
  addNotification(notification: Notification): void {
    this._notifications.update(notifications => {
      // Check if notification with this ID already exists
      const exists = notifications.some(n => n.id === notification.id);
      if (exists) {
        this.logger.debug(`Skipping duplicate notification ${notification.id}`);
        return notifications;
      }
      return [notification, ...notifications];
    });
    this.logger.debug('Added notification', notification);
  }

  /**
   * Add a simple notification with optional action
   */
  async notify(
    title: string,
    message?: string,
    type: NotificationType = NotificationType.GENERAL,
    actionLabel?: string,
    actionCallback?: () => void
  ): Promise<string> {
    const id = `notification-${Date.now()}`;
    const pubkey = this.accountState.pubkey();
    this.logger.debug(`Creating general notification "${title}", pubkey: ${pubkey || 'undefined'}`);

    const notification: GeneralNotification = {
      id,
      type,
      timestamp: Date.now(),
      read: false,
      title,
      message,
      recipientPubkey: pubkey, // Associate with current account
      ...(actionLabel &&
        actionCallback && {
        action: {
          label: actionLabel,
          callback: actionCallback,
        },
      }),
    };

    this.addNotification(notification);
    await this.persistNotificationToStorage(notification);
    return id;
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    const updatedNotification = this._notifications().find(n => n.id === id);

    this._notifications.update(notifications => {
      return notifications.map(notification => {
        if (notification.id === id) {
          return { ...notification, read: true };
        }
        return notification;
      });
    });

    // Persist the updated notification to storage
    if (updatedNotification) {
      this.persistNotificationToStorage({ ...updatedNotification, read: true });
    }
  }

  /**
   * Remove a notification
   */
  removeNotification(id: string): void {
    this._notifications.update(notifications =>
      notifications.filter(notification => notification.id !== id)
    );

    // Also remove from storage directly
    this.database
      .deleteNotification(id)
      .catch((error: unknown) => this.logger.error(`Failed to delete notification ${id} from storage`, error));
  }

  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    const pubkey = this.accountState.pubkey();

    // Clear notifications from in-memory signal
    if (pubkey) {
      // Only clear notifications for the current account
      this._notifications.update(notifications =>
        notifications.filter(n => n.recipientPubkey !== pubkey)
      );

      // Delete each notification for this account from storage
      this.database.getAllNotificationsForPubkey(pubkey)
        .then(notifications => {
          return Promise.all(
            notifications.map(n => this.database.deleteNotification(n['id'] as string))
          );
        })
        .catch((error: unknown) => this.logger.error('Failed to clear notifications from storage', error));
    } else {
      // No account, clear all (legacy behavior)
      this._notifications.set([]);
      this.database
        .clearAllNotifications()
        .catch((error: unknown) => this.logger.error('Failed to clear notifications from storage', error));
    }
  }

  /**
   * Retry publishing to failed relays
   */
  async retryFailedRelays(
    notificationId: string,
    retryFunction: (event: Event, relayUrl: string) => Promise<unknown>
  ): Promise<void> {
    this.logger.info(`Attempting to retry failed relays for notification ${notificationId}`);

    const notification = this._notifications().find(n => n.id === notificationId);

    if (!notification || notification.type !== NotificationType.RELAY_PUBLISHING) {
      this.logger.error('Cannot retry: notification not found or wrong type');
      return;
    }

    const relayNotification = notification as RelayPublishingNotification;

    const failedRelays =
      relayNotification.relayPromises
        ?.filter(rp => rp.status === 'failed')
        .map(rp => rp.relayUrl) || [];

    this.logger.debug(
      `Found ${failedRelays.length} failed relays to retry: ${failedRelays.join(', ')}`
    );

    // Update status of failed relays back to pending
    failedRelays.forEach(relayUrl => {
      this.logger.debug(`Resetting status to pending for relay ${relayUrl}`);
      this.updateRelayPromiseStatus(notificationId, relayUrl, 'pending');
    });

    // Retry publishing to each failed relay
    for (const relayUrl of failedRelays) {
      this.logger.debug(`Retrying publish to relay ${relayUrl}`);

      // Create a promise for this retry attempt
      const retryPromise = await retryFunction(relayNotification.event, relayUrl);

      // Use the same promise-handling approach as in addRelayPublishingNotification
      try {
        this.logger.debug(`Awaiting retry promise for relay ${relayUrl}...`);

        // Since this retry only does a single relay URL, we can get the first promise directly.
        if (Array.isArray(retryPromise)) {
          await retryPromise[0];
        } else {
          await retryPromise;
        }
        this.logger.debug(`Retry successful for relay ${relayUrl}`);
        this.updateRelayPromiseStatus(notificationId, relayUrl, 'success');
      } catch (error) {
        this.logger.error(`Retry failed for relay ${relayUrl}:`, error);
        this.updateRelayPromiseStatus(notificationId, relayUrl, 'failed', error);
      }
    }

    this.logger.info(`Retry attempts completed for notification ${notificationId}`);
  }

  /**
   * Update the status of a relay publish promise
   */
  async updateRelayPromiseStatus(
    notificationId: string,
    relayUrl: string,
    status: 'pending' | 'success' | 'failed',
    error?: unknown
  ): Promise<void> {
    this.logger.debug(
      `Updating relay promise status for notification ${notificationId}, relay ${relayUrl} to ${status}`
    );
    if (error) {
      this.logger.debug('Error details:', error);
    }

    // First, check storage for the most up-to-date version to preserve the read status
    let readStatusFromStorage: boolean | undefined;
    try {
      const storedNotification = await this.database.getNotification(notificationId);
      if (storedNotification) {
        readStatusFromStorage = storedNotification['read'] as boolean | undefined;
      }
    } catch (storageError) {
      this.logger.warn('Could not fetch notification from storage, using in-memory version', storageError);
    }

    this._notifications.update(notifications => {
      return notifications.map(notification => {
        if (
          notification.id === notificationId &&
          notification.type === NotificationType.RELAY_PUBLISHING
        ) {
          const relayNotification = notification as RelayPublishingNotification;

          // Update the specific relay's status
          const updatedRelayPromises =
            relayNotification.relayPromises?.map(rp => {
              if (rp.relayUrl === relayUrl) {
                this.logger.debug(`Changed status for ${relayUrl} from ${rp.status} to ${status}`);
                return { ...rp, status, error };
              }
              return rp;
            }) || [];

          // Check if all promises are resolved (success or failed)
          const allResolved = updatedRelayPromises.every(
            rp => rp.status === 'success' || rp.status === 'failed'
          );

          const successCount = updatedRelayPromises.filter(rp => rp.status === 'success').length;
          const failedCount = updatedRelayPromises.filter(rp => rp.status === 'failed').length;
          const pendingCount = updatedRelayPromises.filter(rp => rp.status === 'pending').length;

          this.logger.debug(
            `Relay status summary for ${notificationId}: success=${successCount}, failed=${failedCount}, pending=${pendingCount}`
          );

          if (allResolved) {
            this.logger.info(
              `Publishing notification ${notificationId} complete with ${successCount} successes and ${failedCount} failures`
            );
          }

          const updatedNotification = {
            ...relayNotification,
            relayPromises: updatedRelayPromises,
            complete: allResolved,
            // Preserve the read status from storage if available, otherwise use current in-memory value
            read: readStatusFromStorage !== undefined ? readStatusFromStorage : relayNotification.read,
          };

          // Persist the updated notification to storage
          this.persistNotificationToStorage(updatedNotification).catch(err => {
            this.logger.error('Failed to persist updated notification', err);
          });

          return updatedNotification;
        }
        return notification;
      });
    });

    // Storage is updated inline above
  }

  /**
   * Remove all notifications from a specific author (used when muting an account)
   * CRITICAL: This removes notifications from both memory and storage
   * @param authorPubkey The pubkey of the author to remove notifications from
   * @param silent If true, skip logging individual removals (used in batch operations)
   */
  async removeNotificationsFromAuthor(authorPubkey: string, silent = false): Promise<number> {
    if (!silent) {
      this.logger.info(`Removing all notifications from author: ${authorPubkey}`);
    }

    // Get current notifications
    const currentNotifications = this._notifications();

    // Find notification IDs to remove
    const notificationIdsToRemove: string[] = [];

    currentNotifications.forEach(notification => {
      // Only check content notifications (not system notifications)
      if (notification.type === NotificationType.RELAY_PUBLISHING ||
        notification.type === NotificationType.GENERAL ||
        notification.type === NotificationType.ERROR ||
        notification.type === NotificationType.SUCCESS ||
        notification.type === NotificationType.WARNING) {
        return; // Skip system notifications
      }

      const contentNotification = notification as ContentNotification;
      if (contentNotification.authorPubkey === authorPubkey) {
        notificationIdsToRemove.push(notification.id);
      }
    });

    if (notificationIdsToRemove.length === 0) {
      return 0;
    }

    if (!silent) {
      this.logger.info(`Found ${notificationIdsToRemove.length} notifications to remove from author ${authorPubkey}`);
    }

    // Remove from memory
    this._notifications.update(notifications =>
      notifications.filter(n => !notificationIdsToRemove.includes(n.id))
    );

    // Remove from storage
    try {
      await Promise.all(
        notificationIdsToRemove.map(id => this.database.deleteNotification(id))
      );
    } catch (error) {
      this.logger.error(`Failed to remove notifications from storage`, error);
    }

    return notificationIdsToRemove.length;
  }

  /**
   * Clean up notifications from multiple muted accounts in a batched, efficient manner
   * This method reduces logging overhead by processing all accounts silently and logging a summary
   */
  private async cleanupNotificationsFromMutedAccounts(mutedPubkeys: string[]): Promise<void> {
    this.logger.info(`[Notification Cleanup] Starting batched cleanup for ${mutedPubkeys.length} muted accounts`);
    const startTime = Date.now();
    let totalRemoved = 0;
    let accountsWithNotifications = 0;

    // Process all accounts in parallel for efficiency
    const results = await Promise.all(
      mutedPubkeys.map(async (pubkey) => {
        const removed = await this.removeNotificationsFromAuthor(pubkey, true);
        return { pubkey, removed };
      })
    );

    // Calculate totals
    for (const result of results) {
      totalRemoved += result.removed;
      if (result.removed > 0) {
        accountsWithNotifications++;
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.info(
      `[Notification Cleanup] Completed in ${elapsed}ms: removed ${totalRemoved} notifications from ${accountsWithNotifications}/${mutedPubkeys.length} accounts`
    );
  }
}
