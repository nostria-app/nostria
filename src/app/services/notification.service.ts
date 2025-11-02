import { Injectable, effect, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import {
  GeneralNotification,
  Notification,
  NotificationType,
  RelayPublishingNotification,
  RelayPublishPromise,
  StorageService,
} from './storage.service';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private logger = inject(LoggerService);
  private storage = inject(StorageService);
  private accountState = inject(AccountStateService);

  // Store all notifications
  private _notifications = signal<Notification[]>([]);

  // Read-only signal exposing notifications
  readonly notifications = this._notifications.asReadonly();

  // Signal to track if notifications have been loaded from storage
  private _notificationsLoaded = signal(false);
  readonly notificationsLoaded = this._notificationsLoaded.asReadonly();

  constructor() {
    this.logger.info('NotificationService initialized');

    // Set up effect to persist notifications when they change
    effect(() => {
      // Don't save until initial load is complete
      if (this._notificationsLoaded()) {
        // this.persistNotifications();
      }
    });

    // Set up effect to reload notifications when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && this._notificationsLoaded()) {
        this.logger.info(`Account changed to ${pubkey}, reloading notifications`);
        this.loadNotifications();
      }
    });
  }

  /**
   * Load notifications from storage for the current account
   */
  async loadNotifications(): Promise<void> {
    try {
      this.logger.info('Loading notifications from storage');

      // Ensure storage is initialized
      if (!this.storage.initialized()) {
        this.logger.warn('Storage not initialized yet, delaying notification loading');
        return;
      }

      const pubkey = this.accountState.pubkey();
      let storedNotifications: Notification[];

      if (pubkey) {
        // Load notifications for the current account
        this.logger.info(`Loading notifications for account: ${pubkey}`);
        storedNotifications = await this.storage.getAllNotificationsForPubkey(pubkey);
        this.logger.info(`Found ${storedNotifications.length} notifications for account ${pubkey}`);
      } else {
        // No account logged in, load all notifications (for backward compatibility)
        this.logger.info('No account logged in, loading all notifications');
        storedNotifications = await this.storage.getAllNotifications();
      }

      if (storedNotifications && storedNotifications.length > 0) {
        // Sort by timestamp (newest first)
        storedNotifications.sort((a, b) => b.timestamp - a.timestamp);

        this.logger.info(`Loaded ${storedNotifications.length} notifications from storage`);
        this._notifications.set(storedNotifications);
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
    if (!this.storage.initialized()) {
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

      await this.storage.saveNotification(notificationToStore);
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
    this.storage
      .deleteNotification(id)
      .catch(error => this.logger.error(`Failed to delete notification ${id} from storage`, error));
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
      this.storage.getAllNotificationsForPubkey(pubkey)
        .then(notifications => {
          return Promise.all(
            notifications.map(n => this.storage.deleteNotification(n.id))
          );
        })
        .catch(error => this.logger.error('Failed to clear notifications from storage', error));
    } else {
      // No account, clear all (legacy behavior)
      this._notifications.set([]);
      this.storage
        .clearAllNotifications()
        .catch(error => this.logger.error('Failed to clear notifications from storage', error));
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
  private async updateRelayPromiseStatus(
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
      const storedNotification = await this.storage.getNotification(notificationId);
      if (storedNotification) {
        readStatusFromStorage = storedNotification.read;
      }
    } catch (error) {
      this.logger.warn('Could not fetch notification from storage, using in-memory version', error);
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
}
