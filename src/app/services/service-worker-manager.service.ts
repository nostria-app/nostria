import { Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Service Worker Manager
 * 
 * Manages the custom service worker for push notifications.
 * This service ensures that push notifications are properly handled
 * and displayed by the service worker, even when the app is closed.
 */
@Injectable({
  providedIn: 'root',
})
export class ServiceWorkerManager {
  private logger = inject(LoggerService);
  private swRegistration: ServiceWorkerRegistration | null = null;

  constructor() {
    if (this.isSupported()) {
      this.registerServiceWorker();
    } else {
      this.logger.warn('Service Workers are not supported in this browser');
    }
  }

  /**
   * Check if Service Workers are supported
   */
  private isSupported(): boolean {
    return 'serviceWorker' in navigator;
  }

  /**
   * Register the custom service worker for push notifications
   */
  private async registerServiceWorker(): Promise<void> {
    try {
      this.logger.info('Registering custom service worker for push notifications');

      // Wait for the page to load
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          window.addEventListener('load', resolve);
        });
      }

      // Register the service worker
      const registration = await navigator.serviceWorker.register(
        '/notification-sw.js',
        { scope: '/' }
      );

      this.swRegistration = registration;

      this.logger.info('Service worker registered successfully:', registration.scope);

      // Listen for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          this.logger.info('New service worker found, installing...');

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.logger.info('New service worker installed, ready to use');
              
              // Optionally notify user about the update
              this.notifyUpdate();
            }
          });
        }
      });

      // Check if there's an active service worker
      if (registration.active) {
        this.logger.info('Service worker is active and controlling the page');
      }

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.logger.debug('Message received from service worker:', event.data);
        this.handleServiceWorkerMessage(event.data);
      });

    } catch (error) {
      this.logger.error('Failed to register service worker:', error);
    }
  }

  /**
   * Get the current service worker registration
   */
  async getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (this.swRegistration) {
      return this.swRegistration;
    }

    if (!this.isSupported()) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      this.swRegistration = registration || null;
      return this.swRegistration;
    } catch (error) {
      this.logger.error('Failed to get service worker registration:', error);
      return null;
    }
  }

  /**
   * Check if service worker is ready
   */
  async isReady(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      await navigator.serviceWorker.ready;
      return true;
    } catch (error) {
      this.logger.error('Service worker is not ready:', error);
      return false;
    }
  }

  /**
   * Send a message to the service worker
   */
  async sendMessage(message: unknown): Promise<unknown> {
    if (!navigator.serviceWorker.controller) {
      this.logger.warn('No active service worker to send message to');
      return null;
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        if (event.data.error) {
          reject(event.data.error);
        } else {
          resolve(event.data);
        }
      };

      // We checked above that controller is not null
      navigator.serviceWorker.controller!.postMessage(message, [messageChannel.port2]);
    });
  }

  /**
   * Show a notification via the service worker
   */
  async showNotification(title: string, options?: NotificationOptions): Promise<void> {
    try {
      const response = await this.sendMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        options: options || {},
      }) as { success?: boolean };

      if (response?.success) {
        this.logger.debug('Notification shown successfully via service worker');
      } else {
        throw new Error('Failed to show notification');
      }
    } catch (error) {
      this.logger.error('Failed to show notification via service worker:', error);
      
      // Fallback: try to show notification directly
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, options);
      }
    }
  }

  /**
   * Handle messages from service worker
   */
  private handleServiceWorkerMessage(data: { type?: string; notificationData?: unknown; payload?: unknown }): void {
    this.logger.debug('Handling service worker message:', data);

    // Handle different message types
    switch (data.type) {
      case 'NOTIFICATION_CLICKED':
        this.logger.info('Notification was clicked:', data.notificationData);
        // Could trigger navigation or other actions
        break;

      case 'NOTIFICATION_CLOSED':
        this.logger.info('Notification was closed:', data.notificationData);
        break;

      case 'PUSH_RECEIVED':
        this.logger.info('Push notification received:', data.payload);
        break;

      default:
        this.logger.debug('Unknown message type:', data.type);
    }
  }

  /**
   * Notify user about service worker update
   */
  private notifyUpdate(): void {
    this.logger.info('Service worker has been updated');
    
    // Could show a snackbar or notification to user
    // For now, just log it
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Nostria Updated', {
        body: 'A new version of Nostria is available. Refresh to update.',
        icon: '/icons/icon-192x192.png',
        tag: 'app-update',
      });
    }
  }

  /**
   * Unregister the service worker
   */
  async unregister(): Promise<boolean> {
    const registration = await this.getRegistration();
    
    if (!registration) {
      this.logger.warn('No service worker registration to unregister');
      return false;
    }

    try {
      const success = await registration.unregister();
      this.logger.info('Service worker unregistered:', success);
      this.swRegistration = null;
      return success;
    } catch (error) {
      this.logger.error('Failed to unregister service worker:', error);
      return false;
    }
  }

  /**
   * Update the service worker
   */
  async update(): Promise<void> {
    const registration = await this.getRegistration();
    
    if (!registration) {
      this.logger.warn('No service worker registration to update');
      return;
    }

    try {
      await registration.update();
      this.logger.info('Service worker update triggered');
    } catch (error) {
      this.logger.error('Failed to update service worker:', error);
    }
  }
}
