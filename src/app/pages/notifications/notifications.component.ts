import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import {
  NotificationService,
  NotificationType,
  RelayPublishingNotification
} from '../../services/notification.service';
import { RelayPublishStatusComponent } from '../../components/relay-publish-status/relay-publish-status.component';
import { RelayService } from '../../services/relay.service';
import { MatMenuModule } from '@angular/material/menu';

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
    MatMenuModule
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss']
})
export class NotificationsComponent {
  private notificationService = inject(NotificationService);
  private relayService = inject(RelayService);

  notifications = this.notificationService.notifications;
  notificationType = NotificationType;

  async onRetryPublish(notificationId: string): Promise<void> {
    await this.notificationService.retryFailedRelays(
      notificationId,
      (relayUrl, event) => this.relayService.publishToRelay(relayUrl, event)
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

  isRelayPublishingNotification(notification: any): notification is RelayPublishingNotification {
    return notification.type === NotificationType.RELAY_PUBLISHING;
  }
}
