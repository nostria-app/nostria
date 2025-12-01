import { Component, inject, signal, OnInit, computed, effect } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RelayPublishStatusComponent } from '../../components/relay-publish-status/relay-publish-status.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
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
import { ContentNotificationService } from '../../services/content-notification.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

/**
 * Local storage key for notification filter preferences
 */
const NOTIFICATION_FILTERS_KEY = 'nostria-notification-filters';

@Component({
  selector: 'app-notifications',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTabsModule,
    ScrollingModule,
    RelayPublishStatusComponent,
    MatMenuModule,
    MatTooltipModule,
    RouterModule,
    AgoPipe,
    UserProfileComponent
],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private router = inject(Router);
  private localStorage = inject(LocalStorageService);
  private contentNotificationService = inject(ContentNotificationService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);

  notifications = this.notificationService.notifications;
  notificationType = NotificationType;

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
    const mutedAccounts = this.accountState.mutedAccounts();

    return this.notifications()
      .filter(n => {
        // Filter by notification type
        if (!this.isContentNotification(n.type) || !filters[n.type]) {
          return false;
        }

        // CRITICAL: Filter out notifications from muted/blocked accounts
        const contentNotif = n as ContentNotification;
        if (contentNotif.authorPubkey && mutedAccounts.includes(contentNotif.authorPubkey)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  });

  // Count unread content notifications
  newNotificationCount = computed(() => {
    const contentNotifs = this.contentNotifications();
    return contentNotifs.filter(n => !n.read).length;
  });

  async ngOnInit(): Promise<void> {
    // Load saved notification filters from localStorage
    this.loadNotificationFilters();
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

  async onRetryPublish(notificationId: string): Promise<void> {
    await this.notificationService.retryFailedRelays(notificationId, (event, relayUrl) =>
      this.accountRelay.publishToRelay(event, relayUrl)
    );
  }

  async onRepublish(notificationId: string): Promise<void> {
    const notification = this.notifications().find(n => n.id === notificationId);

    if (!notification || notification.type !== NotificationType.RELAY_PUBLISHING) {
      console.error('Cannot republish: notification not found or wrong type');
      return;
    }

    const relayNotification = notification as RelayPublishingNotification;
    const allRelayUrls = relayNotification.relayPromises?.map(rp => rp.relayUrl) || [];

    if (allRelayUrls.length === 0) {
      console.error('Cannot republish: no relay URLs found');
      return;
    }

    // Reset all relay statuses to pending
    for (const relayUrl of allRelayUrls) {
      await this.notificationService.updateRelayPromiseStatus(notificationId, relayUrl, 'pending');
    }

    // Republish to all relays
    for (const relayUrl of allRelayUrls) {
      try {
        await this.accountRelay.publishToRelay(relayNotification.event, relayUrl);
        await this.notificationService.updateRelayPromiseStatus(notificationId, relayUrl, 'success');
      } catch (error) {
        await this.notificationService.updateRelayPromiseStatus(notificationId, relayUrl, 'failed', error);
      }
    }
  }

  clearNotifications(): void {
    this.notificationService.clearNotifications();

    // Update the notification last check timestamp to now to prevent re-fetching cleared notifications
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
      this.accountLocalState.setNotificationLastCheck(pubkey, now);
    }
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

    // Update the notification last check timestamp to now to prevent re-showing read notifications
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
      this.accountLocalState.setNotificationLastCheck(pubkey, now);
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
      // Mark notification as read
      this.markAsRead(notification.id);
      this.router.navigate(['/p', contentNotif.authorPubkey]);
    }
  }

  /**
   * Navigate to the event details page
   */
  viewEvent(notification: Notification): void {
    const contentNotif = notification as ContentNotification;

    // Mark notification as read
    this.markAsRead(notification.id);

    // For new follower notifications, navigate to the follower's profile
    if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
      this.router.navigate(['/p', contentNotif.authorPubkey]);
      return;
    }

    // For zaps with a specific event, navigate to that event
    if (contentNotif.eventId && contentNotif.authorPubkey) {
      const neventId = nip19.neventEncode({
        id: contentNotif.eventId,
        author: contentNotif.authorPubkey,
        kind: contentNotif.kind,
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
   * For profile zaps and new followers without an event, returns a placeholder to indicate it's clickable
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

      // For new follower notifications, always clickable (navigate to follower's profile)
      if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
        return 'new-follower'; // Placeholder to indicate clickable
      }
    }
    return undefined;
  }

  /**
   * TrackBy function for virtual scrolling performance
   * Returns unique notification ID for Angular change detection
   */
  trackByNotificationId(_index: number, notification: Notification): string {
    return notification.id;
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

  /**
   * Format notification title by replacing '+' with heart emoji
   */
  getFormattedNotificationTitle(notification: Notification): string {
    if (!notification.title) return '';
    // Replace 'Reacted +' with 'Reacted ❤️'
    return notification.title.replace(/Reacted \+/g, 'Reacted ❤️');
  }

  /**
   * Get the zap content/message from a notification's metadata (only for zaps)
   * Returns undefined for non-zap notifications to avoid showing duplicate content
   */
  getZapContent(notification: Notification): string | undefined {
    if (this.isContentNotificationWithData(notification)) {
      const contentNotif = notification as ContentNotification;
      // Only show metadata content for ZAP notifications
      // For other notification types, the message field already contains the content
      if (contentNotif.type === NotificationType.ZAP) {
        const content = contentNotif.metadata?.content;
        if (content) {
          // Truncate long zap messages to 200 characters
          return content.length > 200 ? content.substring(0, 200) + '...' : content;
        }
      }
    }
    return undefined;
  }
}
