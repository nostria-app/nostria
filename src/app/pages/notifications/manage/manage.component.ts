import { Component, computed, effect, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { WebPushService, Device } from '../../../services/webpush.service';
import { UserNotificationType } from '../../../services/database.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-manage',
  imports: [
    CommonModule,
    MatCardModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTableModule,
    MatTooltipModule,
    FormsModule,
    RouterModule,
  ],
  templateUrl: './manage.component.html',
  styleUrl: './manage.component.scss',
})
export class NotificationManageComponent implements OnInit, OnDestroy {
  webPush = inject(WebPushService);
  accountState = inject(AccountStateService);
  snackBar = inject(MatSnackBar);
  logger = inject(LoggerService);

  devices = this.webPush.deviceList;
  devicesLoaded = this.webPush.devicesLoaded;
  isLoading = signal(true);
  isSaving = signal(false);

  // All notification types
  notificationTypes = [
    {
      key: UserNotificationType.DIRECT_MESSAGES,
      label: 'Direct Messages',
      icon: 'email',
    },
    { key: UserNotificationType.REPLIES, label: 'Replies', icon: 'reply' },
    {
      key: UserNotificationType.MENTIONS,
      label: 'Mentions',
      icon: 'alternate_email',
    },
    { key: UserNotificationType.REPOSTS, label: 'Reposts', icon: 'repeat' },
    { key: UserNotificationType.ZAPS, label: 'Zaps', icon: 'flash_on' },
    { key: UserNotificationType.NEWS, label: 'News', icon: 'newspaper' },
    {
      key: UserNotificationType.APP_UPDATES,
      label: 'App Updates',
      icon: 'system_update',
    },
  ];

  // Device preferences state
  devicePreferences = computed(() => {
    const devices = this.devices();

    return devices.map(device => ({
      device,
      preferences: this.webPush.getDevicePreferences(device.deviceId),
    }));
  });

  async ngOnInit() {
    if (this.accountState.initialized()) {
      await this.loadDevices();
    } else {
      // Wait for account to be initialized
      effect(() => {
        if (this.accountState.initialized()) {
          this.loadDevices();
        }
      });
    }
  }
  async loadDevices() {
    this.isLoading.set(true);
    try {
      await this.webPush.loadDevices();
      // Start editing mode with current preferences
      this.webPush.startEditing();
    } catch (error) {
      this.logger.error('Failed to load devices:', error as Error);
      this.snackBar.open('Failed to load devices', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  updatePreference(deviceId: string, notificationType: UserNotificationType, enabled: boolean) {
    const currentPrefs = this.webPush.getDevicePreferences(deviceId);
    const updatedPrefs = { ...currentPrefs, [notificationType]: enabled };
    this.webPush.updateDevicePreferences(deviceId, updatedPrefs);
  }
  async saveAllPreferences() {
    this.isSaving.set(true);
    try {
      // Commit temporary preferences to permanent storage and save to server
      await this.webPush.commitPreferences();
      this.snackBar.open('Preferences saved successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.logger.error('Failed to save preferences:', error as Error);
      this.snackBar.open('Failed to save preferences', 'Close', {
        duration: 3000,
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  // Helper method to check if a device has any notifications enabled
  hasAnyEnabled(deviceId: string): boolean {
    const prefs = this.webPush.getDevicePreferences(deviceId);
    return Object.values(prefs).some(enabled => enabled);
  }

  // Helper method to check if all notifications are enabled for a device
  hasAllEnabled(deviceId: string): boolean {
    const prefs = this.webPush.getDevicePreferences(deviceId);
    return Object.values(prefs).every(enabled => enabled);
  }
  // Toggle all notifications for a device
  toggleAllForDevice(deviceId: string, enabled: boolean) {
    const updatedPrefs = this.notificationTypes.reduce(
      (prefs, type) => {
        prefs[type.key] = enabled;
        return prefs;
      },
      {} as Record<UserNotificationType, boolean>
    );

    this.webPush.updateDevicePreferences(deviceId, updatedPrefs);
  }

  // Check if there are unsaved changes
  hasUnsavedChanges(): boolean {
    return this.webPush.hasUnsavedChanges();
  }

  ngOnDestroy() {
    // Reset unsaved changes when component is destroyed
    if (this.webPush.hasUnsavedChanges()) {
      this.webPush.resetPreferences();
    }
  }
}
