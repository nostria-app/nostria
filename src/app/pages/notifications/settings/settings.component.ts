import { Component, computed, effect, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-settings',
  imports: [MatButtonModule, CommonModule, MatCardModule, MatDividerModule, MatListModule, MatIconModule, MatButtonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class NotificationSettingsComponent {
  app = inject(ApplicationService);
  nostr = inject(NostrService);
  webPush = inject(WebPushService);
  push = inject(SwPush);
  snackBar = inject(MatSnackBar);
  dialog = inject(MatDialog);
  logger = inject(LoggerService);
  devices = signal<Device[]>([]);
  currentDevice = signal<Device | null>(null);

  // notificationsSupported = computed(() => 'PushManager' in window && 'serviceWorker' in navigator);
  pushSupported = computed(() => this.push.isEnabled);

  constructor() {
    // Only log push status once
    this.logger.debug('Push enabled status:', this.push.isEnabled);

    this.push.messages.subscribe((message) => {
      this.logger.info('Push message received:', message);
    });

    this.push.notificationClicks.subscribe((event) => {
      this.logger.info('Notification clicked:', event);
    });

    effect(async () => {
      if (this.app.initialized() && this.app.authenticated()) {

        this.push.subscription.subscribe((sub) => {
          if (!sub) {
            this.currentDevice.set(null);
            return;
          }

          const subJson = JSON.parse(JSON.stringify(sub));

          this.currentDevice.set({
            deviceId: subJson.keys.p256dh,
            endpoint: subJson.endpoint,
            lastUpdated: new Date().toISOString(),
            createdAt: new Date().toISOString()
          } as Device);
          
          // Removed excessive logging
        });

        const devices = await this.webPush.devices();
        this.devices.set(devices);
      }
    });
  }

  isRemotelyEnabled(deviceId?: string) {
    if (!deviceId) {
      return false;
    }

    // Check if the device is enabled remotely
    return this.devices().some(device => device.deviceId === deviceId);
  }

  async enableNotifications() {
    // Single log for important user action
    this.logger.info('User requested to enable notifications');
    
    try {
      await this.askPermission();
    } catch (e) {
      this.logger.error('Notification permission denied:', e);
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
    }
  }

  async createLocalNotification() {
    // Only log when notification is actually created
    if ("Notification" in window && Notification.permission === "granted") {
      this.logger.debug('Creating local test notification');
      
      new Notification("Local test notification",
        {
          body: "This is a local notification test!",
          icon: "/icons/icon-128x128.png",
        });
    }
  }

  async createRemoteNotification() {
    this.logger.debug('Creating remote test notification');
    this.webPush.self('Remote test notification', "This is a remote notification test!");
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
      this.logger.error('Push notifications not supported in this browser');
      return;
    }

    const sub = await this.webPush.subscribe();

    if (sub) {
      this.devices.update(devices => [...devices, sub]);
    }
  }

  async askPermission() {
    // Removed redundant logging
    return new Promise(function (resolve, reject) {
      const permissionResult = Notification.requestPermission(function (result) {
        resolve(result);
      });

      if (permissionResult) {
        permissionResult.then(resolve, reject);
      }
    }).then(function (permissionResult) {
      if (permissionResult !== 'granted') {
        throw new Error("We weren't granted permission.");
      }
    });
  }

  async deleteDevice(deviceId: string, endpoint: string) {
    // Only log important user action
    this.logger.info('User requested to delete a device');
    
    // Show confirmation dialog before deleting
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Unregister Device',
        message: 'Are you sure you want to unregister this device? You can always re-enable notifications on your device later.',
        confirmText: 'Unregister',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    // Wait for user confirmation
    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) return;

    try {
      await this.webPush.unsubscribe(deviceId, endpoint);

      // Update the devices signal by filtering out the deleted device
      this.devices.update(devices => devices.filter(d => d.deviceId !== deviceId));

      // Show a success message
      this.snackBar.open('Device unregistered successfully', 'Close', {
        duration: 3000,
      });

      // After deletion, perform a check if there is subscription left, if not, remove the device one.
      this.push.subscription.subscribe((sub) => {
        if (!sub) {
          this.currentDevice.set(null);
        }
      });

    } catch (error) {
      this.logger.error('Failed to delete device:', error);
      this.snackBar.open('Failed to unregister device', 'Close', {
        duration: 3000,
      });
    }
  }
}
