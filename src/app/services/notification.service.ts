import { Injectable, effect, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import {
  GeneralNotification,
  type Notification,
  NotificationType,
  RelayPublishingNotification,
  RelayPublishPromise,
  StorageService,
} from './storage.service';
import { Event } from 'nostr-tools';
import { WebPushService } from './webpush.service';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private logger = inject(LoggerService);
  private storage = inject(StorageService);
  private webPush = inject(WebPushService);

  // Store all notifications
  private _notifications = signal<Notification[]>([]);

  // Store action callbacks in memory (cannot be persisted to IndexedDB)
  private actionCallbacks = new Map<string, () => void>();

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
        this.logger.warn('Storage not initialized yet, delaying notification loading');
        return;
      }

      const storedNotifications = await this.storage.getAllNotifications();

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
  private async persistNotificationToStorage(notification: Notification): Promise<void> {
    if (!this.storage.initialized()) {
      this.logger.warn('Storage not initialized, skipping notification persistence');
      return;
    }

    try {
      await this.storage.saveNotification(notification);
    } catch (error) {
      this.logger.error(`Failed to persist notification ${notification.id} to storage`, error);
    }
  }

  /**
   * Add a notification
   */
  addNotification(notification: Notification): void {
    this._notifications.update(notifications => [notification, ...notifications]);
    this.logger.debug('Added notification', notification);
  }

  /**
   * Add a simple notification with optional action
   * Also sends push notification to all registered devices
   */
  notify(
    title: string,
    message?: string,
    type: NotificationType = NotificationType.GENERAL,
    actionLabel?: string,
    actionCallback?: () => void
  ): string {
    const id = `notification-${Date.now()}`;

    // Store callback in memory if provided
    if (actionLabel && actionCallback) {
      this.actionCallbacks.set(id, actionCallback);
    }

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
    
    // Create a version without the callback for storage
    // IndexedDB cannot store functions, so we strip the action.callback
    const notificationForStorage: Notification = {
      id,
      type,
      timestamp: Date.now(),
      read: false,
      title,
      message,
    };
    
    this.persistNotificationToStorage(notificationForStorage);
    
    // Send push notification to all registered devices
    this.sendPushNotification(title, message, type);
    
    // Show browser notification immediately (in addition to push)
    this.showBrowserNotification(title, message, type);
    
    return id;
  }

  /**
   * Send push notification to all registered devices
   * @param title Notification title
   * @param body Notification body/message
   * @param type Notification type for additional context
   */
  private async sendPushNotification(
    title: string,
    body?: string,
    type: NotificationType = NotificationType.GENERAL
  ): Promise<void> {
    try {
      // Check if webPush service is available and user has devices registered
      if (!this.webPush || this.webPush.deviceList().length === 0) {
        this.logger.debug('No devices registered for push notifications');
        return;
      }

      // Prepare notification data
      const data = {
        type: type,
        timestamp: Date.now(),
        url: window.location.origin, // URL to open when notification is clicked
      };

      // Send push notification via WebPushService
      await this.webPush.self(title, body || '', data);
      
      this.logger.debug(`Push notification sent: ${title}`);
    } catch (error) {
      // Don't throw error, just log it - push notifications are supplementary
      this.logger.warn('Failed to send push notification:', error);
    }
  }

  /**
   * Show browser notification using Notification API
   * This displays notifications immediately without requiring backend push
   * @param title Notification title
   * @param body Notification body/message
   * @param type Notification type for styling
   */
  private async showBrowserNotification(
    title: string,
    body?: string,
    type: NotificationType = NotificationType.GENERAL
  ): Promise<void> {
    // Only show browser notifications in browser environment
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    try {
      // Check permission
      let permission = Notification.permission;

      // Request permission if not granted or denied
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      // Only show if permission granted
      if (permission !== 'granted') {
        this.logger.debug('Browser notification permission not granted');
        return;
      }

      // Determine icon based on notification type
      const icon = '/icons/icon-192x192.png';
      const badge = '/icons/icon-96x96.png';

      // Show notification using service worker if available
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, {
          body: body || '',
          icon: icon,
          badge: badge,
          tag: `nostria-${type}-${Date.now()}`,
          requireInteraction: false,
          data: {
            type: type,
            url: window.location.origin,
          },
        });
        this.logger.debug(`Browser notification shown via service worker: ${title}`);
      } else {
        // Fallback to direct Notification API
        const notification = new Notification(title, {
          body: body || '',
          icon: icon,
          badge: badge,
          tag: `nostria-${type}-${Date.now()}`,
          requireInteraction: false,
          data: {
            type: type,
            url: window.location.origin,
          },
        });

        // Auto-close after 5 seconds
        setTimeout(() => {
          notification.close();
        }, 5000);

        this.logger.debug(`Browser notification shown: ${title}`);
      }
    } catch (error) {
      // Don't throw error, just log it - browser notifications are supplementary
      this.logger.debug('Failed to show browser notification:', error);
    }
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
   * Execute action callback for a notification
   * @param id Notification ID
   */
  executeAction(id: string): void {
    const callback = this.actionCallbacks.get(id);
    if (callback) {
      try {
        callback();
      } catch (error) {
        this.logger.error(`Error executing action callback for notification ${id}`, error);
      }
    } else {
      this.logger.warn(`No action callback found for notification ${id}`);
    }
  }

  /**
   * Get action label for a notification (if it exists)
   * @param id Notification ID
   */
  getActionLabel(id: string): string | undefined {
    const notification = this._notifications().find(n => n.id === id);
    if (notification && 'action' in notification) {
      const generalNotification = notification as GeneralNotification;
      return generalNotification.action?.label;
    }
    return undefined;
  }

  /**
   * Check if notification has an action
   * @param id Notification ID
   */
  hasAction(id: string): boolean {
    return this.actionCallbacks.has(id);
  }

  /**
   * Remove a notification
   */
  removeNotification(id: string): void {
    this._notifications.update(notifications =>
      notifications.filter(notification => notification.id !== id)
    );

    // Remove action callback from memory
    this.actionCallbacks.delete(id);

    // Also remove from storage directly
    this.storage
      .deleteNotification(id)
      .catch(error => this.logger.error(`Failed to delete notification ${id} from storage`, error));
  }

  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    this._notifications.set([]);

    // Clear all action callbacks
    this.actionCallbacks.clear();

    // Clear from storage
    this.storage
      .clearAllNotifications()
      .catch(error => this.logger.error('Failed to clear notifications from storage', error));
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

      // Use the same promise-handling approach as in addRelayPublishingNotification
      try {
        this.logger.debug(`Awaiting retry promise for relay ${relayUrl}...`);

        // Create a promise for this retry attempt and await it
        await retryFunction(relayNotification.event, relayUrl);
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
  private updateRelayPromiseStatus(
    notificationId: string,
    relayUrl: string,
    status: 'pending' | 'success' | 'failed',
    error?: unknown
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
            
            // Send push notification when publishing is complete
            this.sendRelayPublishingCompletePushNotification(
              successCount,
              failedCount,
              relayNotification.event
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

  /**
   * Send push notification when relay publishing completes
   */
  private async sendRelayPublishingCompletePushNotification(
    successCount: number,
    failedCount: number,
    event: Event
  ): Promise<void> {
    try {
      // Check if webPush service is available and user has devices registered
      if (!this.webPush || this.webPush.deviceList().length === 0) {
        this.logger.debug('No devices registered for relay publishing push notifications');
        return;
      }

      let title: string;
      let body: string;
      let notificationType: NotificationType;

      if (failedCount === 0) {
        // All successful
        title = 'Publishing Complete';
        body = `Successfully published to all ${successCount} relays`;
        notificationType = NotificationType.SUCCESS;
      } else if (successCount === 0) {
        // All failed
        title = 'Publishing Failed';
        body = `Failed to publish to all ${failedCount} relays`;
        notificationType = NotificationType.ERROR;
      } else {
        // Partial success
        title = 'Publishing Partially Complete';
        body = `Published to ${successCount} relays, ${failedCount} failed`;
        notificationType = NotificationType.WARNING;
      }

      // Prepare notification data
      const data = {
        type: notificationType,
        timestamp: Date.now(),
        url: window.location.origin,
        eventId: event.id,
        successCount,
        failedCount,
      };

      // Send push notification via WebPushService
      await this.webPush.self(title, body, data);
      
      this.logger.debug(`Relay publishing push notification sent: ${title}`);
      
      // Also show browser notification immediately
      await this.showBrowserNotification(title, body, notificationType);
    } catch (error) {
      // Don't throw error, just log it - push notifications are supplementary
      this.logger.warn('Failed to send relay publishing push notification:', error);
    }
  }
}
