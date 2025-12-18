import { inject, Injectable, signal, PLATFORM_ID } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds } from 'nostr-tools';
import { SwPush } from '@angular/service-worker';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { UserNotificationType, DeviceNotificationPreferences } from './database.service';
import { environment } from './../../environments/environment';
import { WebRequest } from './web-request';
import { isPlatformBrowser } from '@angular/common';

export interface Device {
  deviceId: string;
  endpoint: string;
  auth: string;
  modified?: string;
  created: string;
  userAgent?: string;
}

@Injectable({
  providedIn: 'root',
})
export class WebPushService {
  private server: string = environment.backendUrl;
  accountState = inject(AccountStateService);
  accountLocalState = inject(AccountLocalStateService);
  push = inject(SwPush);
  logger = inject(LoggerService);
  deviceList = signal<Device[]>([]);
  devicePreferences = signal<DeviceNotificationPreferences[]>([]);
  // Temporary preferences for editing (before saving)
  tempDevicePreferences = signal<DeviceNotificationPreferences[]>([]);
  devicesLoaded = signal(false);
  webRequest = inject(WebRequest);
  private platformId = inject(PLATFORM_ID);
  // Cache duration: 3 days in milliseconds
  private readonly PREFERENCES_CACHE_DURATION = 3 * 24 * 60 * 60 * 1000;

  constructor() {
    // Only load preferences in browser environment when user is authenticated
    if (isPlatformBrowser(this.platformId)) {
      // Delay to ensure account state is initialized
      setTimeout(() => {
        if (this.accountState.pubkey()) {
          this.loadPreferencesFromServer();
        }
      }, 100);
    }
  }

  // Load devices when needed (on-demand)
  async loadDevices(deviceId?: string): Promise<Device[]> {
    try {
      this.logger.debug('Loading devices from server...');
      const devices = await this.devices(deviceId);
      this.deviceList.set(devices);
      this.devicesLoaded.set(true);
      return devices;
    } catch (error) {
      this.logger.error('Failed to load devices:', error);
      return [];
    }
  }
  // Get device preferences for a specific device (uses temp preferences if available)
  getDevicePreferences(deviceId: string): Record<UserNotificationType, boolean> {
    // First check temp preferences (for unsaved changes)
    const tempPreferences = this.tempDevicePreferences().find(pref => pref.deviceId === deviceId);
    if (tempPreferences) {
      return tempPreferences.preferences;
    }

    // Fall back to saved preferences
    const preferences = this.devicePreferences().find(pref => pref.deviceId === deviceId);
    if (preferences) {
      return preferences.preferences;
    }

    // Return default preferences (all enabled)
    return {
      [UserNotificationType.DIRECT_MESSAGES]: true,
      [UserNotificationType.REPLIES]: true,
      [UserNotificationType.MENTIONS]: true,
      [UserNotificationType.REPOSTS]: true,
      [UserNotificationType.ZAPS]: true,
      [UserNotificationType.NEWS]: true,
      [UserNotificationType.APP_UPDATES]: true,
    };
  }
  // Update device preferences (temporary, not saved until commitPreferences is called)
  updateDevicePreferences(
    deviceId: string,
    preferences: Record<UserNotificationType, boolean>
  ): void {
    this.tempDevicePreferences.update(currentPrefs => {
      const existingIndex = currentPrefs.findIndex(pref => pref.deviceId === deviceId);
      const newPreference: DeviceNotificationPreferences = {
        deviceId,
        preferences,
      };

      if (existingIndex >= 0) {
        // Update existing temp preferences
        const updated = [...currentPrefs];
        updated[existingIndex] = newPreference;
        return updated;
      } else {
        // Add new temp preferences
        return [...currentPrefs, newPreference];
      }
    });
  }
  // Save preferences to server
  async savePreferencesToServer(): Promise<void> {
    try {
      const prefs = this.devicePreferences();
      const pubkey = this.accountState.pubkey();
      const url = `${this.server}api/subscription/settings/${pubkey}`;

      const response = await this.webRequest.fetchJson(
        url,
        { method: 'POST', body: JSON.stringify(prefs) },
        { kind: kinds.HTTPAuth }
      );
      console.log('Response from savePreferencesToServer:', response);

      // Update cache timestamp and settings after successful save
      const now = Date.now();
      this.accountLocalState.setSubscriptionSettingsLastFetch(pubkey, now);
      this.accountLocalState.setSubscriptionSettings(pubkey, prefs);

      this.logger.info('Device notification preferences saved successfully');
    } catch (error) {
      this.logger.error('Failed to save preferences to server:', error);
    }
  } // Load preferences from server (with localStorage fallback)
  async loadPreferencesFromServer(): Promise<void> {
    // Only load preferences if we have an authenticated user
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    // Load from local state first to ensure we have something to show
    const savedPrefs = this.accountLocalState.getSubscriptionSettings(pubkey);
    if (savedPrefs) {
      this.devicePreferences.set(savedPrefs);
    }

    const lastFetch = this.accountLocalState.getSubscriptionSettingsLastFetch(pubkey);

    // Check if we have recent cached data (within 3 days)
    const now = Date.now();
    if (lastFetch > 0 && (now - lastFetch) < this.PREFERENCES_CACHE_DURATION) {
      this.logger.debug('Using cached subscription settings (fetched less than 3 days ago)');
      return;
    }

    try {
      const url = `${this.server}api/subscription/settings/${pubkey}`;

      const result = await this.webRequest.fetchJson(
        url,
        { method: 'GET' },
        { kind: kinds.HTTPAuth }
      );

      // Always update the cache timestamp to avoid repeated fetches
      this.accountLocalState.setSubscriptionSettingsLastFetch(pubkey, now);

      if (result && result.settings) {
        const settings = JSON.parse(result.settings);
        this.devicePreferences.set(settings);

        // Update settings in cache
        this.accountLocalState.setSubscriptionSettings(pubkey, settings);

        this.logger.info('Device notification preferences loaded from server');
      } else {
        this.logger.debug('No subscription settings found on server');
      }
    } catch (error) {
      this.logger.error('Failed to load preferences from server:', error);

      // If it fails, also don't try again for another 3 days
      this.accountLocalState.setSubscriptionSettingsLastFetch(pubkey, now);
    }
  }

  // Add device to the signal when a new subscription is created
  addDevice(device: Device): void {
    this.deviceList.update(devices => {
      // Check if device already exists to avoid duplicates
      const exists = devices.some(d => d.deviceId === device.deviceId);
      if (!exists) {
        return [...devices, device];
      }
      return devices;
    });
  }
  // Remove device from the signal when unsubscribed
  removeDevice(deviceId: string): void {
    this.deviceList.update(devices => devices.filter(d => d.deviceId !== deviceId));
  }

  // Helper method to parse userAgent into a readable device name
  getDeviceDisplayName(device: Device): string {
    if (device.userAgent) {
      // Parse userAgent to extract browser and OS info
      const userAgent = device.userAgent;

      // Extract OS
      let os = 'Unknown OS';
      if (userAgent.includes('Windows NT')) {
        os = 'Windows';
      } else if (userAgent.includes('Mac OS X')) {
        os = 'macOS';
      } else if (userAgent.includes('Linux')) {
        os = 'Linux';
      } else if (userAgent.includes('Android')) {
        os = 'Android';
      } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        os = 'iOS';
      }

      // Extract browser
      let browser = 'Unknown Browser';
      if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
        browser = 'Chrome';
      } else if (userAgent.includes('Firefox')) {
        browser = 'Firefox';
      } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        browser = 'Safari';
      } else if (userAgent.includes('Edg')) {
        browser = 'Edge';
      }

      return `${browser} on ${os}`;
    }

    // Fallback to device ID if no userAgent
    return `Device ${device.deviceId.slice(0, 8)}...`;
  }

  async devices(deviceId?: string): Promise<Device[]> {
    try {
      try {
        // const url = `${this.server}/api/subscription/devices/${this.accountState.pubkey()}?deviceId=${deviceId || ''}`;
        const url = `${this.server}api/subscription/devices/${this.accountState.pubkey()}`;
        console.log('Fetching devices from:', url);

        const result = await this.webRequest.fetchJson(
          url,
          { method: 'GET' },
          { kind: kinds.HTTPAuth }
        );

        return result.devices || [];
      } catch (error) {
        this.logger.error('Error fetching devices:', error);
        return [];
      }
    } catch (error) {
      this.logger.error('Error in devices():', error);
      return [];
    }
  }

  /** Sends a notification to all the registered devices for this user. */
  async self(title: string, body: string, data?: any) {
    try {
      const url = `${this.server}api/subscription/send/${this.accountState.pubkey()}`;

      const payload: any = {
        title: title,
        body: body,
        data: data || {},
      };

      const result = await this.webRequest.fetchJson(
        url,
        { method: 'POST', body: JSON.stringify(payload) },
        { kind: kinds.HTTPAuth }
      );
      console.log('Response from self notification:', result);
    } catch (error) {
      this.logger.error('Failed to send self notification:', error);
    }
  }

  async subscribe() {
    const result = await fetch(`${this.server}api/key`);

    if (!result.ok) {
      this.logger.error('Failed to fetch server key:', result.statusText);
      return;
    }

    const apiResult = await result.json();
    const serverPublicKey = apiResult.key;

    if (!serverPublicKey) {
      this.logger.error('Server public key is not available');
      return;
    }

    try {
      const pushSubscription = await this.push.requestSubscription({
        serverPublicKey,
      });
      const subscription = JSON.stringify(pushSubscription);
      try {
        const url = `${this.server}api/subscription/webpush/${this.accountState.pubkey()}`;

        // Parse subscription to add userAgent
        const subscriptionData = JSON.parse(subscription);
        const subscriptionWithUserAgent = {
          ...subscriptionData,
          userAgent: navigator.userAgent,
        };

        const result = await this.webRequest.fetchJson(
          url,
          { method: 'POST', body: JSON.stringify(subscriptionWithUserAgent) },
          { kind: kinds.HTTPAuth }
        );

        this.logger.info('Push subscription registered successfully', result);

        const newDevice = {
          deviceId: subscriptionData.keys.p256dh,
          endpoint: subscriptionData.endpoint,
          created: new Date().toISOString(),
          auth: subscriptionData.keys.auth,
          userAgent: navigator.userAgent,
        } as Device;

        // Add the device to the signal
        this.addDevice(newDevice);

        return newDevice;
      } catch (error) {
        this.logger.error('Failed to register push subscription with server:', error);
      }
    } catch (error) {
      this.logger.error('Failed to request push subscription:', error);
    }

    return null;
  }

  async unsubscribe(deviceId: string, endpoint: string) {
    // If the subscription being deleted is the current one, unsubscribe from it
    try {
      this.push.subscription.subscribe(s => {
        if (s && s.endpoint === endpoint) {
          // Removed excessive logging
          return this.push.unsubscribe();
        }
        return null;
      });
    } catch (error) {
      this.logger.error('Failed to unsubscribe from push:', error);
    }

    try {
      const url = `${this.server}api/subscription/webpush/${this.accountState.pubkey()}/${deviceId}`;

      const result = await this.webRequest.fetchJson(
        url,
        { method: 'DELETE' },
        { kind: kinds.HTTPAuth }
      );

      console.log('Response from unsubscribe:', result);

      // Remove the device from the signal
      this.removeDevice(deviceId);

      // Single log for successful operation
      this.logger.info('Device unregistered successfully');
    } catch (error) {
      this.logger.error('Failed to unregister device:', error);
    }
  }

  // Commit temporary preferences to permanent storage and save to server
  async commitPreferences(): Promise<void> {
    // Copy temp preferences to permanent storage
    this.devicePreferences.set([...this.tempDevicePreferences()]);
    // Clear temp preferences
    this.tempDevicePreferences.set([]);
    // Save to server
    await this.savePreferencesToServer();
  }

  // Reset temporary preferences (cancel changes)
  resetPreferences(): void {
    this.tempDevicePreferences.set([]);
  }

  // Initialize temporary preferences for editing (copy current saved preferences)
  startEditing(): void {
    // Copy current saved preferences to temp for editing
    this.tempDevicePreferences.set([...this.devicePreferences()]);
  }

  // Check if there are unsaved changes
  hasUnsavedChanges(): boolean {
    return this.tempDevicePreferences().length > 0;
  }
}
