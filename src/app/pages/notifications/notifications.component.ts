import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { RelayPublishStatusComponent } from '../../components/relay-publish-status/relay-publish-status.component';
import { MatMenuModule } from '@angular/material/menu';
import { NostrService } from '../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { NotificationService } from '../../services/notification.service';
import {
  NotificationType,
  Notification,
  RelayPublishingNotification,
} from '../../services/storage.service';
import { RouterModule } from '@angular/router';
import { AccountRelayServiceEx } from '../../services/relays/account-relay';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    RelayPublishStatusComponent,
    MatMenuModule,
    RouterModule,
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayServiceEx);
  private nostrService = inject(NostrService);

  notifications = this.notificationService.notifications;
  notificationType = NotificationType;
  lastViewedTimestamp = signal<number | null>(null);

  async ngOnInit(): Promise<void> {
    await this.recordNotificationsView();
    await this.getLastViewedTimestamp();
  }

  async recordNotificationsView(): Promise<void> {
    const content = JSON.stringify({});
    const tags = [['d', 'client:notifications:seen']];

    const unsignedEvent = this.nostrService.createEvent(
      kinds.Application,
      '',
      tags
    );
    const signedEvent = await this.nostrService.signEvent(unsignedEvent);

    // We don't want to show in notifications the app settings publishing.
    const publishResult = await this.accountRelay.publish(signedEvent);
  }

  async getLastViewedTimestamp(): Promise<void> {
    try {
      const filter = {
        kinds: [kinds.Application],
        '#d': ['client:notifications:seen'],
        limit: 1,
      };

      const event = await this.accountRelay.get(filter);
      if (event) {
        this.lastViewedTimestamp.set(event.created_at * 1000); // Convert to milliseconds
      }
    } catch (error) {
      console.error('Failed to get last notifications view', error);
    }
  }

  isNewNotification(notification: Notification): boolean {
    const lastViewed = this.lastViewedTimestamp();
    if (!lastViewed) return true;

    // Compare notification timestamp with last viewed timestamp
    return notification.timestamp > lastViewed;
  }

  shouldShowSeparator(index: number, notifications: Notification[]): boolean {
    if (index === 0) return false;

    const current = notifications[index];
    const previous = notifications[index - 1];

    // Return true if this is the first new notification after old ones
    return this.isNewNotification(current) && !this.isNewNotification(previous);
  }

  async onRetryPublish(notificationId: string): Promise<void> {
    await this.notificationService.retryFailedRelays(
      notificationId,
      (event, relayUrl) => this.accountRelay.publishToRelay(event, relayUrl)
    );
  }

  clearNotifications(): void {
    this.notificationService.clearNotifications();
  }

  removeNotification(id: string): void {
    this.notificationService.removeNotification(id);
  }

  markAsRead(id: string): void {
    this.notificationService.markAsRead(id);
  }

  markAllAsRead(): void {
    for (const notification of this.notifications()) {
      if (!notification.read) {
        this.markAsRead(notification.id);
      }
    }
  }

  isRelayPublishingNotification(
    notification: any
  ): notification is RelayPublishingNotification {
    return notification.type === NotificationType.RELAY_PUBLISHING;
  }
}
