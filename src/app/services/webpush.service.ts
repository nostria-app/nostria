import { inject, Injectable, isDevMode, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, nip98 } from 'nostr-tools';
import { SwPush } from '@angular/service-worker';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UserNotificationType, DeviceNotificationPreferences } from './storage.service';
import { environment } from './../../environments/environment';
import { WebRequest } from './web-request';

export interface Device {
  deviceId: string;
  endpoint: string;
  auth: string;
  modified?: string;
  created: string;
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
  private server: string = environment.backendUrl;
  private nostr = inject(NostrService);
  accountState = inject(AccountStateService);
  push = inject(SwPush);
  logger = inject(LoggerService);  // Centralized device management  
  deviceList = signal<Device[]>([]);
  devicePreferences = signal<DeviceNotificationPreferences[]>([]);
  // Temporary preferences for editing (before saving)
  tempDevicePreferences = signal<DeviceNotificationPreferences[]>([]);
  devicesLoaded = signal(false);
  webRequest = inject(WebRequest);
  constructor() {
    // Load preferences from server/storage on service initialization
    this.loadPreferencesFromServer();
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
      [UserNotificationType.APP_UPDATES]: true
    };
  }
  // Update device preferences (temporary, not saved until commitPreferences is called)
  updateDevicePreferences(deviceId: string, preferences: Record<UserNotificationType, boolean>): void {
    this.tempDevicePreferences.update(currentPrefs => {
      const existingIndex = currentPrefs.findIndex(pref => pref.deviceId === deviceId);
      const newPreference: DeviceNotificationPreferences = { deviceId, preferences };

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
      const url = `${this.server}/api/subscription/settings/${this.accountState.pubkey()}`;

      debugger;

      const response = await this.webRequest.fetchJson(url, { method: 'POST', body: JSON.stringify(prefs) }, { kind: kinds.HTTPAuth });
      console.log('Response from savePreferencesToServer:', response);
      // const headers = await this.nostr.getNIP98AuthToken({ url, method: 'POST' });

      // debugger;

      // const response = await fetch(url, {
      //   method: 'POST',
      //   headers: {
      //     ...headers,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify(prefs)
      // });

      // if (!response.ok) {
      //   throw new Error(`Failed to save preferences: ${response.status}`);
      // }

      this.logger.info('Device notification preferences saved successfully');
    } catch (error) {
      this.logger.error('Failed to save preferences to server:', error);
      // Fallback to localStorage if server fails
      // try {
      //   const prefs = this.devicePreferences();
      //   localStorage.setItem('device-notification-preferences', JSON.stringify(prefs));
      //   this.logger.info('Preferences saved to localStorage as fallback');
      // } catch (storageError) {
      //   this.logger.error('Failed to save preferences to localStorage fallback:', storageError);
      // }
    }
  }  // Load preferences from server (with localStorage fallback)
  async loadPreferencesFromServer(): Promise<void> {
    try {
      const url = `${this.server}/api/subscription/settings/${this.accountState.pubkey()}`;

      const result = await this.webRequest.fetchJson(url, { method: 'GET' }, { kind: kinds.HTTPAuth });

      if (result && result.settings) {
        const settings = JSON.parse(result.settings);
        debugger;
        this.devicePreferences.set(settings);
        this.logger.info('Device notification preferences loaded from server');
        return;
      }
    } catch (error) {
      this.logger.error('Failed to load preferences from server:', error);
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
  // private async getAuthHeaders(url: string, method: string | 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH', sha256?: string): Promise<Record<string, string>> {
  //   const currentUser = this.accountState.account();
  //   if (!currentUser) {
  //     throw new Error('User not logged in');
  //   }

  //   const headers: Record<string, string> = {};

  //   // Don't attempt to add auth headers if the user is using the preview account
  //   if (currentUser.source !== 'preview') {
  //     const tags = [
  //       ['u', url],
  //       ["method", method]
  //     ];

  //     if (sha256) {
  //       tags.push(['payload', sha256]);
  //     }

  //     const authEvent = this.nostr.createEvent(kinds.HTTPAuth, '', tags);
  //     const signedEvent = await this.nostr.signEvent(authEvent);

  //     if (!signedEvent) {
  //       throw new Error('Failed to sign event for authorization headers');
  //     }

  //     // Convert signed event to base64 string for Authorization header
  //     const base64Event = btoa(JSON.stringify(signedEvent));
  //     headers['Authorization'] = `Nostr ${base64Event}`
  //   }

  //   return headers;
  // }

  async devices(deviceId?: string): Promise<Device[]> {
    try {
      try {
        // const url = `${this.server}/api/subscription/devices/${this.accountState.pubkey()}?deviceId=${deviceId || ''}`;
        const url = `${this.server}/api/subscription/devices/${this.accountState.pubkey()}`;

        debugger;
        console.log('Fetching devices from:', url);

        const result = await this.webRequest.fetchJson(url, { method: 'GET' }, { kind: kinds.HTTPAuth });

        debugger;

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
      const url = `${this.server}/api/subscription/send/${this.accountState.pubkey()}`;

      const payload: any = {
        title: title,
        body: body,
        data: data || {}
      };

      const result = await this.webRequest.fetchJson(url, { method: 'POST', body: JSON.stringify(payload) }, { kind: kinds.HTTPAuth });
      console.log('Response from self notification:', result);

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
      const subscription = JSON.stringify(pushSubscription); try {
        const url = `${this.server}/api/subscription/webpush/${this.accountState.pubkey()}`;

        
        // Parse subscription to add userAgent
        const subscriptionData = JSON.parse(subscription);
        const subscriptionWithUserAgent = {
          ...subscriptionData,
          userAgent: navigator.userAgent
        };
        
        const result = await this.webRequest.fetchJson(url, { method: 'POST', body: JSON.stringify(subscriptionWithUserAgent) }, { kind: kinds.HTTPAuth });
        
        this.logger.info('Push subscription registered successfully', result);

        const newDevice = {
          deviceId: subscriptionData.keys.p256dh,
          endpoint: subscriptionData.endpoint,
          created: new Date().toISOString(),
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
    
       const result = await this.webRequest.fetchJson(url, { method: 'DELETE' }, { kind: kinds.HTTPAuth });
        
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