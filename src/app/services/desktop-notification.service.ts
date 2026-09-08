import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Options } from '@tauri-apps/plugin-notification';
import { AccountStateService } from './account-state.service';
import { ContentNotification, NotificationType } from './database.service';
import {
  DEFAULT_DESKTOP_NOTIFICATIONS,
  DesktopNotificationSettings,
  LocalSettingsService,
} from './local-settings.service';
import { LoggerService } from './logger.service';

type NotificationCategory = 'messages' | 'mentions' | 'replies' | 'reposts' | 'reactions' | 'zaps';

export interface DesktopNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  timestamp: number;
  recipientPubkey: string;
  authorPubkey: string;
}

@Injectable({ providedIn: 'root' })
export class DesktopNotificationService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly localSettings = inject(LocalSettingsService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);
  readonly isNative = this.isBrowser && isTauri();
  // Mobile WebViews may be suspended by the OS; background polling is desktop-only.
  readonly isDesktop = this.isNative && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  readonly preferences = computed(() => ({
    ...DEFAULT_DESKTOP_NOTIFICATIONS,
    ...this.localSettings.settings().desktopNotifications,
  }));
  private readonly _permission = signal<NotificationPermission | 'unsupported' | 'error'>('default');
  readonly permission = this._permission.asReadonly();
  private readonly sessionStartedAt = Date.now();
  private readonly delivered = new Map<string, number>();
  private readonly pending = new Set<string>();

  updatePreferences(updates: Partial<DesktopNotificationSettings>): void {
    this.localSettings.updateSettings({ desktopNotifications: { ...this.preferences(), ...updates } });
  }

  async refreshPermission(): Promise<void> {
    try {
      if (this.isNative) {
        // Read native state directly: the plugin's Notification.permission can be cached.
        const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted');
        this._permission.set(granted === null ? 'default' : granted ? 'granted' : 'denied');
      } else {
        this._permission.set(this.isBrowser && 'Notification' in window
          ? Notification.permission : 'unsupported');
      }
    } catch {
      this._permission.set('error');
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      if (this.isNative) {
        const permission = await invoke<string>('plugin:notification|request_permission');
        this._permission.set(permission === 'granted' || permission === 'denied'
          ? permission : 'default');
      } else if (this.isBrowser && 'Notification' in window) {
        this._permission.set(await Notification.requestPermission());
      } else {
        this._permission.set('unsupported');
      }
    } catch {
      this._permission.set('error');
    }
    return this.permission() === 'granted';
  }

  async sendTest(): Promise<boolean> {
    await this.refreshPermission();
    if (this.permission() !== 'granted') return false;
    try {
      await this.send({
        title: 'Nostria',
        body: $localize`:@@notifications.desktop.test-body:Notifications are ready on this device.`,
      });
      return true;
    } catch {
      return false;
    }
  }

  async notifyContent(notification: ContentNotification): Promise<void> {
    if (notification.read) return;
    const categories: Partial<Record<NotificationType, NotificationCategory>> = {
      [NotificationType.MENTION]: 'mentions',
      [NotificationType.REPLY]: 'replies',
      [NotificationType.REPOST]: 'reposts',
      [NotificationType.REACTION]: 'reactions',
      [NotificationType.ZAP]: 'zaps',
    };
    const category = categories[notification.type];
    if (!category || !notification.recipientPubkey) return;
    await this.notify({
      id: notification.id,
      category,
      title: notification.title,
      body: notification.message,
      timestamp: notification.timestamp,
      recipientPubkey: notification.recipientPubkey,
      authorPubkey: notification.authorPubkey,
    });
  }

  async notify(notification: DesktopNotification): Promise<void> {
    if (!this.isNative || !this.shouldNotify(notification)) return;
    const key = `${notification.recipientPubkey}:${notification.id}`;
    if (this.pending.has(key) || this.delivered.has(key)) return;
    this.pending.add(key);
    try {
      await this.refreshPermission();
      // Account, focus, mutes and preferences may change while permission is being checked.
      if (this.permission() !== 'granted' || !this.shouldNotify(notification)) return;
      const preview = this.preferences().showPreview;
      await this.send({
        title: preview ? notification.title.slice(0, 120) : 'Nostria',
        body: preview ? notification.body?.slice(0, 240)
          : $localize`:@@notifications.desktop.new-activity:You have new activity in Nostria.`,
      });
      this.delivered.set(key, Date.now());
      for (const [id, timestamp] of this.delivered) {
        if (Date.now() - timestamp > 10 * 60 * 1000) this.delivered.delete(id);
      }
    } catch {
      // Never log message contents or decrypted payloads.
      this.logger.warn('Native notification delivery failed');
    } finally {
      this.pending.delete(key);
    }
  }

  private shouldNotify(notification: DesktopNotification): boolean {
    const preferences = this.preferences();
    const now = Date.now();
    return preferences.enabled && preferences[notification.category]
      && notification.recipientPubkey === this.accountState.pubkey()
      && notification.authorPubkey !== notification.recipientPubkey
      && !this.accountState.mutedAccounts().includes(notification.authorPubkey)
      // Ignore startup history, reconciliation backfills and future-dated relay events.
      && notification.timestamp >= this.sessionStartedAt
      && notification.timestamp >= now - 10 * 60 * 1000
      && notification.timestamp <= now
      && (preferences.whenFocused || document.hidden || !document.hasFocus());
  }

  private async send(options: Options): Promise<void> {
    if (this.isNative) {
      // sendNotification() returns void; awaiting IPC lets settings report delivery failures.
      await invoke('plugin:notification|notify', { options });
    } else if (this.isBrowser) {
      new Notification(options.title, { body: options.body, icon: '/icons/icon-128x128.png' });
    }
  }
}
