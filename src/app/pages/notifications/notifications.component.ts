import { Component, inject, signal, OnInit, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { RelayPublishStatusComponent } from '../../components/relay-publish-status/relay-publish-status.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrService } from '../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { NotificationService } from '../../services/notification.service';
import {
  NotificationType,
  Notification,
  RelayPublishingNotification,
} from '../../services/storage.service';
import { RouterModule } from '@angular/router';
import { AccountRelayService } from '../../services/relays/account-relay';
import { Router } from '@angular/router';
import { ContentNotification } from '../../services/storage.service';
import { nip19 } from 'nostr-tools';
import { AgoPipe } from '../../pipes/ago.pipe';
import { LocalStorageService } from '../../services/local-storage.service';

/**
 * Local storage key for notification filter preferences
 */
const NOTIFICATION_FILTERS_KEY = 'nostria-notification-filters';

@Component({
  selector: 'app-notifications',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    RelayPublishStatusComponent,
    MatMenuModule,
    MatTooltipModule,
    RouterModule,
    AgoPipe,
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private nostrService = inject(NostrService);
  private router = inject(Router);
  private localStorage = inject(LocalStorageService);

  notifications = this.notificationService.notifications;
  notificationType = NotificationType;
  lastViewedTimestamp = signal<number | null>(null);

  // Notification type filter preferences
  notificationFilters = signal<Record<NotificationType, boolean>>({
    [NotificationType.NEW_FOLLOWER]: true,
    [NotificationType.MENTION]: true,
    [NotificationType.REPOST]: true,
    [NotificationType.REPLY]: true,
    [NotificationType.REACTION]: true,
    [NotificationType.ZAP]: true,
    // System notifications are not filtered
    [NotificationType.RELAY_PUBLISHING]: true,
    [NotificationType.GENERAL]: true,
    [NotificationType.ERROR]: true,
    [NotificationType.SUCCESS]: true,
    [NotificationType.WARNING]: true,
  });

  constructor() {
    // Save notification filters to localStorage whenever they change
    effect(() => {
      const filters = this.notificationFilters();
      this.localStorage.setItem(NOTIFICATION_FILTERS_KEY, JSON.stringify(filters));
    });
  }

  // Helper to check if notification is a system notification (technical)
  private isSystemNotification(type: NotificationType): boolean {
    return [
      NotificationType.RELAY_PUBLISHING,
      NotificationType.GENERAL,
      NotificationType.ERROR,
      NotificationType.SUCCESS,
      NotificationType.WARNING,
    ].includes(type);
  }

  // Helper to check if notification is a content notification (social)
  private isContentNotification(type: NotificationType): boolean {
    return [
      NotificationType.NEW_FOLLOWER,
      NotificationType.MENTION,
      NotificationType.REPOST,
      NotificationType.REPLY,
      NotificationType.REACTION,
      NotificationType.ZAP,
    ].includes(type);
  }

  // Separate system and content notifications, sorted by timestamp (newest first)
  systemNotifications = computed(() => {
    return this.notifications()
      .filter(n => this.isSystemNotification(n.type))
      .sort((a, b) => b.timestamp - a.timestamp);
  });

  contentNotifications = computed(() => {
    const filters = this.notificationFilters();
    return this.notifications()
      .filter(n => this.isContentNotification(n.type) && filters[n.type])
      .sort((a, b) => b.timestamp - a.timestamp);
  });

  // Count only content notifications (not system/technical ones)
  newNotificationCount = computed(() => {
    const lastViewed = this.lastViewedTimestamp();
    const contentNotifs = this.contentNotifications();

    if (!lastViewed) return contentNotifs.length;

    return contentNotifs.filter(n => n.timestamp > lastViewed && !n.read).length;
  });

  async ngOnInit(): Promise<void> {
    // Load saved notification filters from localStorage
    this.loadNotificationFilters();

    await this.recordNotificationsView();
    await this.getLastViewedTimestamp();
  }

  /**
   * Load notification filter preferences from localStorage
   */
  private loadNotificationFilters(): void {
    try {
      const savedFilters = this.localStorage.getItem(NOTIFICATION_FILTERS_KEY);
      if (savedFilters) {
        const filters = JSON.parse(savedFilters) as Record<NotificationType, boolean>;
        this.notificationFilters.set(filters);
      }
    } catch (error) {
      console.error('Failed to load notification filters from localStorage', error);
    }
  }

  async recordNotificationsView(): Promise<void> {
    const tags = [['d', 'client:notifications:seen']];

    const unsignedEvent = this.nostrService.createEvent(kinds.Application, '', tags);
    const signedEvent = await this.nostrService.signEvent(unsignedEvent);

    // We don't want to show in notifications the app settings publishing.
    await this.accountRelay.publish(signedEvent);
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
    await this.notificationService.retryFailedRelays(notificationId, (event, relayUrl) =>
      this.accountRelay.publishToRelay(event, relayUrl)
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

  isRelayPublishingNotification(notification: Notification): notification is RelayPublishingNotification {
    return notification.type === NotificationType.RELAY_PUBLISHING;
  }

  formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) {
      return 'Just now';
    } else if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else if (days < 7) {
      return `${days}d ago`;
    } else {
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: '2-digit',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
  }

  /**
   * Navigate to the author's profile page
   */
  viewAuthorProfile(notification: Notification): void {
    const contentNotif = notification as ContentNotification;
    if (contentNotif.authorPubkey) {
      this.router.navigate(['/p', contentNotif.authorPubkey]);
    }
  }

  /**
   * Navigate to the event details page
   */
  viewEvent(notification: Notification): void {
    const contentNotif = notification as ContentNotification;

    // For zaps with a specific event, navigate to that event
    if (contentNotif.eventId && contentNotif.authorPubkey) {
      const neventId = nip19.neventEncode({
        id: contentNotif.eventId,
        author: contentNotif.authorPubkey,
      });
      this.router.navigate(['/e', neventId]);
      return;
    }

    // For profile zaps (no specific event), navigate to recipient's profile
    if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.recipientPubkey) {
      const npubId = nip19.npubEncode(contentNotif.metadata.recipientPubkey);
      this.router.navigate(['/p', npubId]);
    }
  }

  /**
   * Check if notification is a content notification with author/event info
   */
  isContentNotificationWithData(notification: Notification): notification is ContentNotification {
    return this.isContentNotification(notification.type);
  }

  /**
   * Get the author pubkey from a content notification
   */
  getAuthorPubkey(notification: Notification): string | undefined {
    if (this.isContentNotificationWithData(notification)) {
      return (notification as ContentNotification).authorPubkey;
    }
    return undefined;
  }

  /**
   * Get the event ID from a content notification
   * For profile zaps without an event, returns a placeholder to indicate it's clickable
   */
  getEventId(notification: Notification): string | undefined {
    if (this.isContentNotificationWithData(notification)) {
      const contentNotif = notification as ContentNotification;

      // If there's an eventId, return it
      if (contentNotif.eventId) {
        return contentNotif.eventId;
      }

      // For profile zaps without an eventId, return a placeholder to indicate it's clickable
      if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.recipientPubkey) {
        return 'profile-zap'; // Placeholder to indicate clickable
      }
    }
    return undefined;
  }

  /**
   * Toggle a notification type filter
   */
  toggleNotificationFilter(type: NotificationType): void {
    const currentFilters = this.notificationFilters();
    this.notificationFilters.set({
      ...currentFilters,
      [type]: !currentFilters[type]
    });
  }

  /**
   * Get user-friendly label for notification type
   */
  getNotificationTypeLabel(type: NotificationType): string {
    const labels: Record<NotificationType, string> = {
      [NotificationType.NEW_FOLLOWER]: 'Following events',
      [NotificationType.MENTION]: 'Mentions',
      [NotificationType.REPOST]: 'Reposts',
      [NotificationType.REPLY]: 'Replies',
      [NotificationType.REACTION]: 'Reactions',
      [NotificationType.ZAP]: 'Zap events',
      [NotificationType.RELAY_PUBLISHING]: 'Relay Publishing',
      [NotificationType.GENERAL]: 'General',
      [NotificationType.ERROR]: 'Errors',
      [NotificationType.SUCCESS]: 'Success',
      [NotificationType.WARNING]: 'Warnings',
    };
    return labels[type] || type;
  }

  /**
   * Get icon for notification type
   */
  getNotificationTypeIcon(type: NotificationType): string {
    const icons: Record<NotificationType, string> = {
      [NotificationType.NEW_FOLLOWER]: 'person_add',
      [NotificationType.MENTION]: 'alternate_email',
      [NotificationType.REPOST]: 'repeat',
      [NotificationType.REPLY]: 'reply',
      [NotificationType.REACTION]: 'favorite',
      [NotificationType.ZAP]: 'bolt',
      [NotificationType.RELAY_PUBLISHING]: 'sync',
      [NotificationType.GENERAL]: 'info',
      [NotificationType.ERROR]: 'error',
      [NotificationType.SUCCESS]: 'check_circle',
      [NotificationType.WARNING]: 'warning',
    };
    return icons[type] || 'notifications';
  }

  /**
   * Get content notification types that can be filtered
   */
  getFilterableNotificationTypes(): NotificationType[] {
    return [
      NotificationType.NEW_FOLLOWER,
      NotificationType.MENTION,
      NotificationType.REPOST,
      NotificationType.REPLY,
      NotificationType.REACTION,
      NotificationType.ZAP,
    ];
  }
}
