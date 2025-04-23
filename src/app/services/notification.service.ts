import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { NostrEvent } from '../interfaces';

// Notification types
export enum NotificationType {
  RELAY_PUBLISHING = 'relay-publishing',
  GENERAL = 'general',
  ERROR = 'error',
  SUCCESS = 'success',
  WARNING = 'warning'
}

// Base notification interface
export interface Notification {
  id: string;
  type: NotificationType;
  timestamp: number;
  read: boolean;
  title: string;
  message?: string;
}

// Relay publishing notification with promises for tracking status
export interface RelayPublishingNotification extends Notification {
  event: NostrEvent;
  relayPromises: RelayPublishPromise[];
  complete: boolean;
}

// Track status of publishing to an individual relay
export interface RelayPublishPromise {
  relayUrl: string;
  status: 'pending' | 'success' | 'failed';
  promise?: Promise<any>;
  error?: any;
}

// General notification
export interface GeneralNotification extends Notification {
  action?: {
    label: string;
    callback: () => void;
  };
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private logger = inject(LoggerService);
  
  // Store all notifications
  private _notifications = signal<Notification[]>([]);
  
  // Read-only signal exposing notifications
  readonly notifications = this._notifications.asReadonly();
  
  constructor() {
    this.logger.info('NotificationService initialized');
  }
  
  /**
   * Add a new relay publishing notification
   */
  addRelayPublishingNotification(
    event: NostrEvent, 
    relayPromises: Promise<any>[],
    relayUrls: string[]
  ): string {
    const notificationId = `publish-${event.id}-${Date.now()}`;
    this.logger.debug(`Creating relay publishing notification ${notificationId} for event ${event.id}`);
    this.logger.debug(`Publishing to ${relayUrls.length} relays: ${relayUrls.join(', ')}`);
    
    // Create relay promise tracking objects
    const relayPromiseObjects: RelayPublishPromise[] = relayUrls.map((url, index) => {
      this.logger.debug(`Setting up promise tracking for relay: ${url}`);
      return {
        relayUrl: url,
        status: 'pending',
        promise: relayPromises[index]
      };
    });
    
    // Process each promise to update its status
    relayPromiseObjects.forEach(async (relayPromise, i) => {
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
      message: `Publishing event ${event.id.substring(0, 8)}... to ${relayUrls.length} relays`,
      event,
      relayPromises: relayPromiseObjects,
      complete: false
    };
    
    this.addNotification(notification);
    return notificationId;
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
    this.logger.debug(`Updating relay promise status for notification ${notificationId}, relay ${relayUrl} to ${status}`);
    if (error) {
      this.logger.debug('Error details:', error);
    }
    
    this._notifications.update(notifications => {
      return notifications.map(notification => {
        if (notification.id === notificationId && notification.type === NotificationType.RELAY_PUBLISHING) {
          const relayNotification = notification as RelayPublishingNotification;
          
          // Update the specific relay's status
          const updatedRelayPromises = relayNotification.relayPromises.map(rp => {
            if (rp.relayUrl === relayUrl) {
              this.logger.debug(`Changed status for ${relayUrl} from ${rp.status} to ${status}`);
              return { ...rp, status, error };
            }
            return rp;
          });
          
          // Check if all promises are resolved (success or failed)
          const allResolved = updatedRelayPromises.every(rp => 
            rp.status === 'success' || rp.status === 'failed'
          );
          
          const successCount = updatedRelayPromises.filter(rp => rp.status === 'success').length;
          const failedCount = updatedRelayPromises.filter(rp => rp.status === 'failed').length;
          const pendingCount = updatedRelayPromises.filter(rp => rp.status === 'pending').length;
          
          this.logger.debug(`Relay status summary for ${notificationId}: success=${successCount}, failed=${failedCount}, pending=${pendingCount}`);
          
          if (allResolved) {
            this.logger.info(`Publishing notification ${notificationId} complete with ${successCount} successes and ${failedCount} failures`);
          }
          
          return {
            ...relayNotification,
            relayPromises: updatedRelayPromises,
            complete: allResolved
          };
        }
        return notification;
      });
    });
  }
  
  /**
   * Add a general notification
   */
  addNotification(notification: Notification): void {
    this._notifications.update(notifications => [notification, ...notifications]);
    this.logger.debug('Added notification', notification);
  }
  
  /**
   * Add a simple notification with optional action
   */
  notify(title: string, message?: string, type: NotificationType = NotificationType.GENERAL, 
         actionLabel?: string, actionCallback?: () => void): string {
    const id = `notification-${Date.now()}`;
    
    const notification: GeneralNotification = {
      id,
      type,
      timestamp: Date.now(),
      read: false,
      title,
      message,
      ...(actionLabel && actionCallback && { 
        action: { 
          label: actionLabel, 
          callback: actionCallback 
        } 
      })
    };
    
    this.addNotification(notification);
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
  }
  
  /**
   * Remove a notification
   */
  removeNotification(id: string): void {
    this._notifications.update(notifications => 
      notifications.filter(notification => notification.id !== id)
    );
  }
  
  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    this._notifications.set([]);
  }
  
  /**
   * Retry publishing to failed relays
   */
  async retryFailedRelays(notificationId: string, retryFunction: (relayUrl: string, event: NostrEvent) => Promise<any>): Promise<void> {
    this.logger.info(`Attempting to retry failed relays for notification ${notificationId}`);
    
    const notification = this._notifications().find(n => n.id === notificationId);
    
    if (!notification || notification.type !== NotificationType.RELAY_PUBLISHING) {
      this.logger.error('Cannot retry: notification not found or wrong type');
      return;
    }
    
    const relayNotification = notification as RelayPublishingNotification;
    const failedRelays = relayNotification.relayPromises
      .filter(rp => rp.status === 'failed')
      .map(rp => rp.relayUrl);
    
    this.logger.debug(`Found ${failedRelays.length} failed relays to retry: ${failedRelays.join(', ')}`);
    
    // Update status of failed relays back to pending
    failedRelays.forEach(relayUrl => {
      this.logger.debug(`Resetting status to pending for relay ${relayUrl}`);
      this.updateRelayPromiseStatus(notificationId, relayUrl, 'pending');
    });
    
    // Retry publishing to each failed relay
    for (const relayUrl of failedRelays) {
      this.logger.debug(`Retrying publish to relay ${relayUrl}`);
      try {
        this.logger.debug(`Executing retry function for relay ${relayUrl}`);
        await retryFunction(relayUrl, relayNotification.event);
        this.logger.debug(`Retry successful for relay ${relayUrl}`);
        this.updateRelayPromiseStatus(notificationId, relayUrl, 'success');
      } catch (error) {
        this.logger.error(`Retry failed for relay ${relayUrl}:`, error);
        this.updateRelayPromiseStatus(notificationId, relayUrl, 'failed', error);
      }
    }
    
    this.logger.info(`Retry attempts completed for notification ${notificationId}`);
  }
}
