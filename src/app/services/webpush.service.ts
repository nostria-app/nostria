import { inject, Injectable, isDevMode } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, nip98 } from 'nostr-tools';
import { SwPush } from '@angular/service-worker';
import { LoggerService } from './logger.service';

export interface Device {
  deviceId: string;
  endpoint: string;
  lastUpdated: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class WebPushService {
  private server: string = isDevMode() ? 'http://localhost:3000' : 'http://notification.nostria.app';
  private nostr = inject(NostrService);
  push = inject(SwPush);
  logger = inject(LoggerService);

  constructor() { }

  /** Implements the NIP-98 HTTP Auth */
  private async getAuthHeaders(url: string, method: string | 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH', sha256?: string): Promise<Record<string, string>> {
    const currentUser = this.nostr.account();
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

  async devices(): Promise<Device[]> {
    try {
      try {
        const url = `${this.server}/api/subscription/devices/${this.nostr.pubkey()}`;
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
      const url = `${this.server}/api/subscription/send/${this.nostr.pubkey()}`;
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
      const subscription = JSON.stringify(pushSubscription);

      try {
        const url = `${this.server}/api/subscription/webpush/${this.nostr.pubkey()}`;
        const headers = await this.getAuthHeaders(url, 'POST');

        const response = await fetch(`${url}`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: subscription
        });

        if (!response.ok) {
          throw new Error(`Failed to register subscription: ${response.status}`);
        }

        // Only log success once
        this.logger.info('Push subscription registered successfully');

        const subscriptionPayload = JSON.parse(subscription);

        return {
          deviceId: subscriptionPayload.keys.p256dh,
          endpoint: subscriptionPayload.endpoint,
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as Device;
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
      const url = `${this.server}/api/subscription/webpush/${this.nostr.pubkey()}/${deviceId}`;
      const headers = await this.getAuthHeaders(url, 'DELETE');

      const response = await fetch(`${url}`, {
        method: 'DELETE',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to unregister device: ${response.status}`);
      }

      // Single log for successful operation
      this.logger.info('Device unregistered successfully');
      
    } catch (error) {
      this.logger.error('Failed to unregister device:', error);
    }
  }
}