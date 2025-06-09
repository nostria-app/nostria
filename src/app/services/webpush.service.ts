import { inject, Injectable, isDevMode, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, nip98 } from 'nostr-tools';
import { SwPush } from '@angular/service-worker';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UserNotificationType, DeviceNotificationPreferences } from './storage.service';

export interface Device {
  deviceId: string;
  endpoint: string;
  auth: string;
  lastUpdated: string;
  createdAt: string;
  userAgent?: string;
}

// export interface Device {
//   deviceId: string;
//   endpoint: string;
//   // lastUpdated: string;
//   // createdAt: string;
//   auth?: string;
//   // subscriptionId?: string;
//   userAgent?: string;
// }

@Injectable({
  providedIn: 'root'
})
export class WebPushService {
  private server: string = isDevMode() ? 'http://localhost:3000' : 'https://notification.nostria.app';
  private nostr = inject(NostrService);
  accountState = inject(AccountStateService);
  push = inject(SwPush);
  logger = inject(LoggerService);  // Centralized device management  
  deviceList = signal<Device[]>([]);
  devicePreferences = signal<DeviceNotificationPreferences[]>([]);
  devicesLoaded = signal(false);

  constructor() {
    // Load preferences from storage on service initialization
    this.loadPreferencesFromStorage();
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

  // Get device preferences for a specific device
  getDevicePreferences(deviceId: string): Record<UserNotificationType, boolean> {
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
      [UserNotificationType.APP_UPDATES]: true
    };
  }

  // Update device preferences
  updateDevicePreferences(deviceId: string, preferences: Record<UserNotificationType, boolean>): void {
    this.devicePreferences.update(currentPrefs => {
      const existingIndex = currentPrefs.findIndex(pref => pref.deviceId === deviceId);
      const newPreference: DeviceNotificationPreferences = { deviceId, preferences };
      
      if (existingIndex >= 0) {
        // Update existing preferences
        const updated = [...currentPrefs];
        updated[existingIndex] = newPreference;
        return updated;
      } else {
        // Add new preferences
        return [...currentPrefs, newPreference];
      }
    });
    
    // TODO: Save to server/localStorage
    this.savePreferencesToStorage();
  }

  // Save preferences to localStorage (temporary until server implementation)
  private savePreferencesToStorage(): void {
    try {
      const prefs = this.devicePreferences();
      localStorage.setItem('device-notification-preferences', JSON.stringify(prefs));
    } catch (error) {
      this.logger.error('Failed to save preferences:', error);
    }
  }
  // Load preferences from localStorage
  loadPreferencesFromStorage(): void {
    try {
      const saved = localStorage.getItem('device-notification-preferences');
      if (saved) {
        const preferences = JSON.parse(saved) as DeviceNotificationPreferences[];
        this.devicePreferences.set(preferences);
      }
    } catch (error) {
      this.logger.error('Failed to load preferences:', error);
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
    this.deviceList.update(devices => 
      devices.filter(d => d.deviceId !== deviceId)
    );
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

  /** Implements the NIP-98 HTTP Auth */
  private async getAuthHeaders(url: string, method: string | 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH', sha256?: string): Promise<Record<string, string>> {
    const currentUser = this.accountState.account();
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    const headers: Record<string, string> = {};

    // Don't attempt to add auth headers if the user is using the preview account
    if (currentUser.source !== 'preview') {
      const tags = [
        ['u', url],
        ["method", method]
      ];

      if (sha256) {
        tags.push(['payload', sha256]);
      }

      const authEvent = this.nostr.createEvent(kinds.HTTPAuth, '', tags);
      const signedEvent = await this.nostr.signEvent(authEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign event for authorization headers');
      }

      // Convert signed event to base64 string for Authorization header
      const base64Event = btoa(JSON.stringify(signedEvent));
      headers['Authorization'] = `Nostr ${base64Event}`
    }

    return headers;
  }

  async devices(deviceId?: string): Promise<Device[]> {
    try {
      try {
        const url = `${this.server}/api/subscription/devices/${this.accountState.pubkey()}?deviceId=${deviceId || ''}`;
        const headers = await this.getAuthHeaders(url, 'GET');

        const response = await fetch(`${url}`, {
          method: 'GET',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to get devices: ${response.status}`);
        }

        debugger;

        const jsonResult = await response.json();
        return jsonResult.devices || [];
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
      const url = `${this.server}/api/subscription/send/${this.accountState.pubkey()}`;
      const headers = await this.getAuthHeaders(url, 'POST');
      const payload: any = {
        title: title,
        body: body,
        data: data || {}
      };

      const response = await fetch(`${url}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to send notification: ${response.status}`);
      }

    } catch (error) {
      this.logger.error('Failed to send self notification:', error);
    }
  }

  async subscribe() {
    const result = await fetch(`${this.server}/api/key`);

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
      const pushSubscription = await this.push.requestSubscription({ serverPublicKey });
      const subscription = JSON.stringify(pushSubscription);      try {
        const url = `${this.server}/api/subscription/webpush/${this.accountState.pubkey()}`;
        const headers = await this.getAuthHeaders(url, 'POST');

        // Parse subscription to add userAgent
        const subscriptionData = JSON.parse(subscription);
        const subscriptionWithUserAgent = {
          ...subscriptionData,
          userAgent: navigator.userAgent
        };

        const response = await fetch(`${url}`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(subscriptionWithUserAgent)
        });

        if (!response.ok) {
          throw new Error(`Failed to register subscription: ${response.status}`);
        }        // Only log success once
        this.logger.info('Push subscription registered successfully');

        const newDevice = {
          deviceId: subscriptionData.keys.p256dh,
          endpoint: subscriptionData.endpoint,
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          auth: subscriptionData.keys.auth,
          userAgent: navigator.userAgent
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
      const url = `${this.server}/api/subscription/webpush/${this.accountState.pubkey()}/${deviceId}`;
      const headers = await this.getAuthHeaders(url, 'DELETE');

      const response = await fetch(`${url}`, {
        method: 'DELETE',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        }
      });      if (!response.ok) {
        throw new Error(`Failed to unregister device: ${response.status}`);
      }

      // Remove the device from the signal
      this.removeDevice(deviceId);

      // Single log for successful operation
      this.logger.info('Device unregistered successfully');
      
    } catch (error) {
      this.logger.error('Failed to unregister device:', error);
    }
  }
}