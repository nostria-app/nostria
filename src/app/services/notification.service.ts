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

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private logger = inject(LoggerService);
  private storage = inject(StorageService);

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
  }

  /**
   * Load notifications from storage
   */
  async loadNotifications(): Promise<void> {
    try {
      this.logger.info('Loading notifications from storage');

      // Ensure storage is initialized
      if (!this.storage.initialized()) {
        this.logger.warn(
          'Storage not initialized yet, delaying notification loading'
        );
        return;
      }

      const storedNotifications = await this.storage.getAllNotifications();

      if (storedNotifications && storedNotifications.length > 0) {
        // Sort by timestamp (newest first)
        storedNotifications.sort((a, b) => b.timestamp - a.timestamp);

        this.logger.info(
          `Loaded ${storedNotifications.length} notifications from storage`
        );
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
   * Persist all notifications to storage
   */
  // private async persistNotifications(): Promise<void> {
  //   try {
  //     const currentNotifications = this._notifications();
  //     this.logger.debug(`Persisting ${currentNotifications.length} notifications to storage`);

  //     // Clear existing notifications and save all current ones
  //     // await this.storage.clearAllNotifications();

  //     for (const notification of currentNotifications) {
  //       await this.storage.saveNotification(notification);
  //     }
  //   } catch (error) {
  //     this.logger.error('Failed to persist notifications to storage', error);
  //   }
  // }

  /**
   * Add a new relay publishing notification
   */
  addRelayPublishingNotification(
    event: Event,
    relayPromises: Map<Promise<string>, string>
  ): string {
    const notificationId = `publish-${event.id}-${Date.now()}`;

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
    relayPromiseObjects.forEach(async (relayPromise, i) => {
      this.logger.debug(
        `Starting promise monitoring for relay ${relayPromise.relayUrl}`
      );
      try {
        this.logger.debug(
          `Awaiting promise for relay ${relayPromise.relayUrl}...`
        );

        await relayPromise.promise;
        this.logger.debug(
          `Promise resolved successfully for relay ${relayPromise.relayUrl}`
        );
        this.updateRelayPromiseStatus(
          notificationId,
          relayPromise.relayUrl,
          'success'
        );
      } catch (error) {
        this.logger.error(
          `Promise failed for relay ${relayPromise.relayUrl}:`,
          error
        );
        this.updateRelayPromiseStatus(
          notificationId,
          relayPromise.relayUrl,
          'failed',
          error
        );
      }
    });

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
    };

    const notificationForStorage: RelayPublishingNotification = {
      id: notificationId,
      type: NotificationType.RELAY_PUBLISHING,
      timestamp: Date.now(),
      read: false,
      title: 'Publishing to relays',
      message: `Publishing event ${event.id.substring(0, 8)}... to ${relayPromises.size} relays`,
      event,
      complete: false,
    };

    this.addNotification(notification);

    this.persistNotificationToStorage(notificationForStorage);
    return notificationId;
  }

  /**
   * Persist a single notification to storage
   */
  private async persistNotificationToStorage(
    notification: Notification
  ): Promise<void> {
    if (!this.storage.initialized()) {
      this.logger.warn(
        'Storage not initialized, skipping notification persistence'
      );
      return;
    }

    try {
      await this.storage.saveNotification(notification);
    } catch (error) {
      this.logger.error(
        `Failed to persist notification ${notification.id} to storage`,
        error
      );
    }
  }

  /**
   * Add a notification
   */
  addNotification(notification: Notification): void {
    this._notifications.update(notifications => [
      notification,
      ...notifications,
    ]);
    this.logger.debug('Added notification', notification);
  }

  /**
   * Add a simple notification with optional action
   */
  notify(
    title: string,
    message?: string,
    type: NotificationType = NotificationType.GENERAL,
    actionLabel?: string,
    actionCallback?: () => void
  ): string {
    const id = `notification-${Date.now()}`;

    const notification: GeneralNotification = {
      id,
      type,
      timestamp: Date.now(),
      read: false,
      title,
      message,
      ...(actionLabel &&
        actionCallback && {
          action: {
            label: actionLabel,
            callback: actionCallback,
          },
        }),
    };

    this.addNotification(notification);
    this.persistNotificationToStorage(notification);
    return id;
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    this._notifications.update(notifications => {
      return notifications.map(notification => {
        if (notification.id === id) {
          return { ...notification, read: true };
        }
        return notification;
      });
    });

    // Storage will be updated via the effect
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
      .catch(error =>
        this.logger.error(
          `Failed to delete notification ${id} from storage`,
          error
        )
      );
  }

  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    this._notifications.set([]);

    // Clear from storage
    this.storage
      .clearAllNotifications()
      .catch(error =>
        this.logger.error('Failed to clear notifications from storage', error)
      );
  }

  /**
   * Retry publishing to failed relays
   */
  async retryFailedRelays(
    notificationId: string,
    retryFunction: (event: Event, relayUrl: string) => Promise<any>
  ): Promise<void> {
    this.logger.info(
      `Attempting to retry failed relays for notification ${notificationId}`
    );

    const notification = this._notifications().find(
      n => n.id === notificationId
    );

    if (
      !notification ||
      notification.type !== NotificationType.RELAY_PUBLISHING
    ) {
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
      const retryPromise = await retryFunction(
        relayNotification.event,
        relayUrl
      );

      // Use the same promise-handling approach as in addRelayPublishingNotification
      try {
        this.logger.debug(`Awaiting retry promise for relay ${relayUrl}...`);

        // Since this retry only does a single relay URL, we can get the first promise directly.
        await retryPromise[0];
        this.logger.debug(`Retry successful for relay ${relayUrl}`);
        this.updateRelayPromiseStatus(notificationId, relayUrl, 'success');
      } catch (error) {
        this.logger.error(`Retry failed for relay ${relayUrl}:`, error);
        this.updateRelayPromiseStatus(
          notificationId,
          relayUrl,
          'failed',
          error
        );
      }
    }

    this.logger.info(
      `Retry attempts completed for notification ${notificationId}`
    );
  }

  /**
   * Update the status of a relay publish promise
   */
  private updateRelayPromiseStatus(
    notificationId: string,
    relayUrl: string,
    status: 'pending' | 'success' | 'failed',
    error?: any
  ): void {
    this.logger.debug(
      `Updating relay promise status for notification ${notificationId}, relay ${relayUrl} to ${status}`
    );
    if (error) {
      this.logger.debug('Error details:', error);
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
                this.logger.debug(
                  `Changed status for ${relayUrl} from ${rp.status} to ${status}`
                );
                return { ...rp, status, error };
              }
              return rp;
            }) || [];

          // Check if all promises are resolved (success or failed)
          const allResolved = updatedRelayPromises.every(
            rp => rp.status === 'success' || rp.status === 'failed'
          );

          const successCount = updatedRelayPromises.filter(
            rp => rp.status === 'success'
          ).length;
          const failedCount = updatedRelayPromises.filter(
            rp => rp.status === 'failed'
          ).length;
          const pendingCount = updatedRelayPromises.filter(
            rp => rp.status === 'pending'
          ).length;

          this.logger.debug(
            `Relay status summary for ${notificationId}: success=${successCount}, failed=${failedCount}, pending=${pendingCount}`
          );

          if (allResolved) {
            this.logger.info(
              `Publishing notification ${notificationId} complete with ${successCount} successes and ${failedCount} failures`
            );
          }

          return {
            ...relayNotification,
            relayPromises: updatedRelayPromises,
            complete: allResolved,
          };
        }
        return notification;
      });
    });

    // Storage will be updated via the effect
  }
}
