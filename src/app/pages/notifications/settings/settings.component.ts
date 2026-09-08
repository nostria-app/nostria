import { ChangeDetectionStrategy, Component, computed, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DesktopNotificationService } from '../../../services/desktop-notification.service';
import { DesktopNotificationSettingsComponent } from './desktop-notification-settings.component';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwPush } from '@angular/service-worker';
import { NostrService } from '../../../services/nostr.service';
import { Device, WebPushService } from '../../../services/webpush.service';
import { ApplicationService } from '../../../services/application.service';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { LoggerService } from '../../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountStateService } from '../../../services/account-state.service';
import { RouterModule } from '@angular/router';
import { PanelHeaderComponent } from '../../../components/panel-header/panel-header.component';

@Component({
  selector: 'app-settings',
  imports: [
    DesktopNotificationSettingsComponent,
    MatButtonModule,
    CommonModule,
    MatCardModule,
    MatDividerModule,
    MatListModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterModule,
    PanelHeaderComponent,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:focus)': 'desktopNotifications.refreshPermission()' },
})
export class NotificationSettingsComponent {
  private readonly location = inject(Location);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly desktopNotifications = inject(DesktopNotificationService);
  app = inject(ApplicationService);
  accountState = inject(AccountStateService);
  nostr = inject(NostrService);
  webPush = inject(WebPushService);
  push = inject(SwPush);
  snackBar = inject(MatSnackBar);
  dialog = inject(MatDialog);
  logger = inject(LoggerService);

  goBack(): void {
    this.location.back();
  }

  // Use devices from WebPushService
  devices = this.webPush.deviceList;
  devicesLoaded = this.webPush.devicesLoaded;

  currentDevice = signal<Device | null>(null);
  isLoading = signal(true);

  // notificationsSupported = computed(() => 'PushManager' in window && 'serviceWorker' in navigator);
  pushSupported = computed(() => this.push.isEnabled);

  // Add this computed signal to your component
  notificationPermission = this.desktopNotifications.permission;

  isNotificationEnabled = computed(() => this.notificationPermission() === 'granted');

  // Add this computed signal to get subscription details from native APIs
  subscriptionDetails = computed(() => {
    if (!this.isNotificationEnabled() || !this.pushSupported()) {
      return null;
    }

    // This will be populated when we get the subscription
    const current = this.currentDevice();
    return current;
  });

  constructor() {
    void this.desktopNotifications.refreshPermission();
    if (!this.isBrowser || this.desktopNotifications.isNative) {
      this.isLoading.set(false);
      return;
    }
    // Only log push status once
    this.logger.debug('Push enabled status:', this.push.isEnabled);

    this.push.subscription.pipe(takeUntilDestroyed()).subscribe(sub => {
      if (!sub) {
        this.currentDevice.set(null);
        return;
      }
      const subJson = sub.toJSON();
      this.currentDevice.set({
        deviceId: subJson.keys?.['p256dh'] || '',
        endpoint: subJson.endpoint || '',
        created: new Date().toISOString(),
        auth: subJson.keys?.['auth'] || '',
      });
    });

    effect(async () => {
      if (this.accountState.initialized()) {
        this.logger.debug('Account loaded:', this.accountState.account());

        this.isLoading.set(true);

        try {
          // Check for existing subscription first using native API
          if (this.isNotificationEnabled()) {
            this.logger.info('Notifications is enabled');

            const nativeSubscription = await this.getSubscriptionFromNativeAPI();

            if (nativeSubscription) {
              const subJson = nativeSubscription.toJSON();

              this.currentDevice.set({
                deviceId: subJson.keys?.['p256dh'] || '',
                endpoint: subJson.endpoint || '',
                created: new Date().toISOString(),
                // Add additional subscription details
                auth: subJson.keys?.['auth'] || '',
                // subscriptionId: btoa(subJson.endpoint || ''), // Create unique ID from endpoint
              } as Device);
            }
          }

          // Load devices using WebPushService on-demand
          await this.webPush.loadDevices(this.currentDevice()?.deviceId);
        } catch (error) {
          this.logger.error('Error loading notification data:', error);
          this.snackBar.open('Failed to load notification data', 'Close', {
            duration: 3000,
          });
        } finally {
          this.isLoading.set(false);
        }
      } else {
        // If account is not initialized, set loading to false to prevent infinite loading
        this.isLoading.set(false);
      }
    });
  }

  async getSubscriptionInfo(): Promise<Device | null> {
    const subscription = await this.getSubscriptionFromNativeAPI();

    if (!subscription) {
      return null;
    }

    const subJson = subscription.toJSON();

    return {
      // subscriptionId: btoa(subJson.endpoint || ''), // Base64 encoded endpoint as unique ID
      endpoint: subJson.endpoint || '',
      deviceId: subJson.keys?.['p256dh'] || '',
      auth: subJson.keys?.['auth'] || '',
      userAgent: navigator.userAgent,
      created: new Date().toISOString(),
    };
  }

  // Add this method to get subscription from native APIs
  async getSubscriptionFromNativeAPI(): Promise<PushSubscription | null> {
    if (!this.isBrowser || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      this.logger.error('Push messaging is not supported');
      return null;
    }

    // Helper function to add timeout to any promise
    function timeoutPromise<T>(promise: Promise<T>, ms: number): Promise<T | null> {
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
          value => {
            clearTimeout(timer);
            resolve(value);
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          }
        );
      });
    }

    try {
      // Wait up to 3 seconds for serviceWorker.ready
      const registration = await timeoutPromise(navigator.serviceWorker.ready, 3000);
      if (!registration) {
        this.logger.warn('Service worker not ready after timeout, skipping subscription check');
        return null;
      }

      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        this.logger.debug('Found existing subscription:', subscription);

        // Extract all the subscription details
        const subscriptionJson = subscription.toJSON();

        this.logger.debug('Subscription details:', {
          endpoint: subscriptionJson.endpoint,
          p256dh: subscriptionJson.keys?.['p256dh'],
          auth: subscriptionJson.keys?.['auth'],
          applicationServerKey: subscription.options?.applicationServerKey,
        });

        return subscription;
      }

      return null;
    } catch (error) {
      this.logger.error('Error getting subscription:', error);
      return null;
    }
  }

  isRemotelyEnabled(deviceId?: string) {
    if (!deviceId) {
      return false;
    }

    // Check if the device is enabled remotely
    return this.devices().some(device => device.deviceId === deviceId);
  }

  async enableNotifications() {
    this.isLoading.set(true);
    // Single log for important user action
    this.logger.info('User requested to enable notifications');

    try {
      await this.askPermission();
    } catch (e) {
      this.logger.error('Notification permission denied:', e);
      this.isLoading.set(false);
      return;
    }

    try {
      await this.createSubscription();

      this.snackBar.open('Device registered successfully', 'Close', {
        duration: 3000,
      });
    } catch (e) {
      this.logger.error('Failed to create subscription:', e);
      this.snackBar.open('Failed to enable notifications', 'Close', {
        duration: 3000,
      });
      return;
    } finally {
      this.isLoading.set(false);
    }
  }

  async createLocalNotification() {
    const sent = await this.desktopNotifications.sendTest();
    this.snackBar.open(sent
      ? $localize`:@@notifications.desktop.test-sent:Test submitted to your operating system.`
      : $localize`:@@notifications.desktop.test-failed:Could not send the test notification. Check permission and try again.`,
      undefined, { duration: 5000 });
  }

  async createRemoteNotification() {
    this.logger.debug('Creating remote test notification');
    this.webPush.self('Remote test notification', 'This is a remote notification test!');
  }

  // async createNotification() {
  //   const notification = {
  //     "notification": {
  //       "body": "New message from Sondre",
  //       "data": {
  //         "onActionClick": {
  //           "default": { "operation": "navigateLastFocusedOrOpen", "url": "/" },
  //           "open": { "operation": "navigateLastFocusedOrOpen", "url": "/" },
  //           "focus": { "operation": "navigateLastFocusedOrOpen", "url": "/specific-path" }
  //         }
  //       },
  //       "icon": "https://r2a.primal.net/uploads2/4/01/6a/4016aabafa184e41f1a4d1dbcf34381fedec3e03fb8bd899c7949ff43dc24737.jpg",
  //       "title": "Message received",
  //       "tag": "nostria-notification"
  //     }
  //   };

  //   // Send notification if permissions are granted
  //   if ("Notification" in window && Notification.permission === "granted") {
  //     if (navigator.serviceWorker.controller) {
  //       // Send to service worker to display notification
  //       navigator.serviceWorker.controller.postMessage({
  //         type: 'SHOW_NOTIFICATION',
  //         notification: notification.notification
  //       });
  //     }
  //   }
  // }
  async createSubscription() {
    if (!this.pushSupported()) {
      throw new Error('Push notifications are not supported in this browser');
    }

    const sub = await this.webPush.subscribe();

    if (!sub) throw new Error('Push subscription registration failed');

    if (sub) {
      // Device is automatically added to WebPushService deviceList signal
      this.logger.debug('Device subscription created and added to service');
    }
  }

  async askPermission() {
    if (!await this.desktopNotifications.requestPermission()) {
      throw new Error('Notification permission was not granted');
    }
  }

  async deleteDevice(deviceId: string, endpoint: string) {
    // Only log important user action
    this.logger.info('User requested to delete a device');
    this.isLoading.set(true);

    // Show confirmation dialog before deleting
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Unregister Device',
        message:
          'Are you sure you want to unregister this device? You can always re-enable notifications on your device later.',
        confirmText: 'Unregister',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    });

    // Wait for user confirmation
    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) {
      this.isLoading.set(false);
      return;
    }
    try {
      await this.webPush.unsubscribe(deviceId, endpoint);

      // Device is automatically removed from WebPushService deviceList signal

      // Show a success message
      this.snackBar.open('Device unregistered successfully', 'Close', {
        duration: 3000,
      });

    } catch (error) {
      this.logger.error('Failed to delete device:', error);
      this.snackBar.open('Failed to unregister device', 'Close', {
        duration: 3000,
      });
    } finally {
      this.isLoading.set(false);
    }
  }
}
