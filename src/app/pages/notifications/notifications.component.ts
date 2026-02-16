import { Component, inject, signal, OnInit, OnDestroy, computed, effect, ElementRef, ViewChild, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RelayPublishStatusComponent } from '../../components/relay-publish-status/relay-publish-status.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NotificationService } from '../../services/notification.service';
import {
  NotificationType,
  Notification,
  RelayPublishingNotification,
} from '../../services/database.service';
import { RouterModule } from '@angular/router';
import { AccountRelayService } from '../../services/relays/account-relay';
import { Router } from '@angular/router';
import { ContentNotification } from '../../services/database.service';
import { NostrRecord } from '../../interfaces';
import { nip19 } from 'nostr-tools';
import { AgoPipe } from '../../pipes/ago.pipe';
import { LocalStorageService } from '../../services/local-storage.service';
import { ContentNotificationService } from '../../services/content-notification.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { NotificationsFilterPanelComponent } from './notifications-filter-panel/notifications-filter-panel.component';
import { ResolveNostrPipe } from '../../pipes/resolve-nostr.pipe';
import { UtilitiesService } from '../../services/utilities.service';

/**
 * Local storage key for notification filter preferences
 */
const NOTIFICATION_FILTERS_KEY = 'nostria-notification-filters';

@Component({
  selector: 'app-notifications',
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    ScrollingModule,
    RelayPublishStatusComponent,
    MatMenuModule,
    MatTooltipModule,
    RouterModule,
    AgoPipe,
    UserProfileComponent,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    OverlayModule,
    NotificationsFilterPanelComponent,
    ResolveNostrPipe
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit, OnDestroy {
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private router = inject(Router);
  private localStorage = inject(LocalStorageService);
  private contentNotificationService = inject(ContentNotificationService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private logger = inject(LoggerService);
  private twoColumnLayout = inject(TwoColumnLayoutService);

  @ViewChild('searchInputElement') searchInputElement?: ElementRef<HTMLInputElement>;

  notifications = this.notificationService.notifications;

  // Search query for filtering notifications
  searchQuery = signal('');
  // Whether to show the search input
  showSearch = signal(false);
  // Whether to show system notifications view
  showSystemNotifications = signal(false);
  // Whether to show only unread notifications
  showUnreadOnly = signal(false);
  notificationType = NotificationType;

  // Filter panel state
  filterPanelOpen = signal(false);
  filterPanelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  // Check if any filters are active (not all enabled)
  hasActiveFilters = computed(() => {
    const filters = this.notificationFilters();
    const contentTypes = [
      NotificationType.NEW_FOLLOWER,
      NotificationType.MENTION,
      NotificationType.REPOST,
      NotificationType.REPLY,
      NotificationType.REACTION,
      NotificationType.ZAP,
    ];
    // Return true if any content filter is disabled OR if showing system notifications OR if showing unread only
    return contentTypes.some(type => !filters[type]) || this.showSystemNotifications() || this.showUnreadOnly();
  });

  // State for loading older notifications
  isLoadingMore = signal(false);
  oldestTimestamp = signal<number | null>(null);
  hasMoreNotifications = signal(true);
  consecutiveEmptyLoads = signal(0);
  // State for refreshing notifications
  isRefreshing = signal(false);
  // Default lookback period in days
  private readonly DEFAULT_LOOKBACK_DAYS = 2;
  // How many more days to load when scrolling
  private readonly LOAD_MORE_DAYS = 7;
  // Require multiple empty windows before declaring true end of history
  private readonly MAX_CONSECUTIVE_EMPTY_WINDOWS = 8;
  // How many days to look back when refreshing
  private readonly REFRESH_LOOKBACK_DAYS = 7;

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

  // Cache for prefetched profiles - updated when batch loading completes
  private prefetchedProfiles = signal<Map<string, NostrRecord>>(new Map());

  constructor() {
    this.twoColumnLayout.setSplitView();
    // Save notification filters to localStorage whenever they change
    effect(() => {
      const filters = this.notificationFilters();
      this.localStorage.setItem(NOTIFICATION_FILTERS_KEY, JSON.stringify(filters));
    });

    // Batch preload profiles when notifications change
    // This ensures profiles are loaded efficiently in a single request
    // instead of individual requests per notification
    effect(() => {
      const notifications = this.contentNotifications();

      // Use untracked to avoid circular dependency with prefetchedProfiles
      untracked(() => {
        this.batchPreloadProfiles(notifications as ContentNotification[]);
      });
    });
  }

  /**
   * Batch preload profiles for all notification authors
   * This triggers a single batched relay request instead of individual requests
   */
  private async batchPreloadProfiles(notifications: ContentNotification[]): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    // Extract unique author pubkeys
    const pubkeys = [...new Set(
      notifications
        .map(n => (n as ContentNotification).authorPubkey)
        .filter((p): p is string => !!p)
    )];

    if (pubkeys.length === 0) {
      return;
    }

    // Batch load profiles - this checks cache first, then storage, then relays
    const profiles = await this.dataService.batchLoadProfiles(pubkeys);

    // Update the prefetched profiles signal to trigger UI updates
    this.prefetchedProfiles.set(profiles);
  }

  /**
   * Get a cached/prefetched profile for a notification author
   * Used by the template to pass prefetched profiles to child components
   */
  getPrefetchedProfile(notification: Notification): NostrRecord | null {
    const contentNotif = notification as ContentNotification;
    if (!contentNotif.authorPubkey) {
      return null;
    }

    // First check our prefetched profiles map (from batch loading)
    const prefetched = this.prefetchedProfiles().get(contentNotif.authorPubkey);
    if (prefetched) {
      return prefetched;
    }

    // Fall back to DataService cache (might have been loaded elsewhere)
    return this.dataService.getCachedProfile(contentNotif.authorPubkey) ?? null;
  }

  /**
   * Get display name for notification author with a stable fallback.
   * Uses prefetched/cached profile data first, then truncated npub.
   */
  getNotificationAuthorDisplayName(notification: Notification): string {
    const pubkey = this.getAuthorPubkey(notification);
    if (!pubkey) {
      return '';
    }

    const profile = this.getPrefetchedProfile(notification) ?? this.dataService.getCachedProfile(pubkey) ?? null;
    const profileData = profile?.data as Record<string, unknown> | undefined;

    const displayName = this.getProfileFieldAsString(profileData?.['display_name']);
    if (displayName) {
      return displayName;
    }

    const name = this.getProfileFieldAsString(profileData?.['name']);
    if (name) {
      return name;
    }

    return this.utilities.getTruncatedNpub(pubkey);
  }

  private getProfileFieldAsString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }
    return '';
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
    // Convert to Set for O(1) lookups instead of O(n) array.includes()
    const mutedAccountsSet = new Set(mutedAccounts);
    const query = this.searchQuery().toLowerCase().trim();
    const unreadOnly = this.showUnreadOnly();

    return this.notifications()
      .filter(n => {
        // Filter by notification type
        if (!this.isContentNotification(n.type) || !filters[n.type]) {
          return false;
        }

        // Filter by read status if unread only is enabled
        if (unreadOnly && n.read) {
          return false;
        }

        // CRITICAL: Filter out notifications from muted/blocked accounts
        const contentNotif = n as ContentNotification;
        if (contentNotif.authorPubkey && mutedAccountsSet.has(contentNotif.authorPubkey)) {
          return false;
        }

        // Apply search filter if query exists
        if (query) {
          if (!this.matchesSearchQuery(contentNotif, query)) {
            return false;
          }
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

  ngOnDestroy(): void {
    // Component cleanup
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
      this.logger.error('Failed to load notification filters from localStorage', error);
    }
  }

  /**
   * Check if a notification matches the search query
   * Searches in: author name, display name, message content, notification title
   */
  private matchesSearchQuery(notification: ContentNotification, query: string): boolean {
    // Check message content
    if (notification.message?.toLowerCase().includes(query)) {
      return true;
    }

    // Check notification title
    if (notification.title?.toLowerCase().includes(query)) {
      return true;
    }

    // Check zap content from metadata
    if (notification.metadata?.content?.toLowerCase().includes(query)) {
      return true;
    }

    // Check author profile name (synchronously from cache)
    if (notification.authorPubkey) {
      const cachedProfile = this.dataService.getCachedProfile(notification.authorPubkey);
      if (cachedProfile?.data) {
        const profileData = cachedProfile.data as { name?: string; display_name?: string; nip05?: string };
        if (profileData.name?.toLowerCase().includes(query)) {
          return true;
        }
        if (profileData.display_name?.toLowerCase().includes(query)) {
          return true;
        }
        const nip05Value = profileData.nip05;
        const nip05 = Array.isArray(nip05Value) ? nip05Value[0] : nip05Value;
        if (nip05?.toLowerCase().includes(query)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Toggle the search input visibility
   */
  toggleSearch(): void {
    const isCurrentlyShown = this.showSearch();
    this.showSearch.set(!isCurrentlyShown);
    // Clear search query when hiding
    if (isCurrentlyShown) {
      this.searchQuery.set('');
    }
  }

  /**
   * Clear the search query
   */
  clearSearch(): void {
    this.searchQuery.set('');
  }

  async onRetryPublish(notificationId: string): Promise<void> {
    await this.notificationService.retryFailedRelays(notificationId, (event, relayUrl) =>
      this.accountRelay.publishToRelay(event, relayUrl)
    );
  }

  async onRepublish(notificationId: string): Promise<void> {
    const notification = this.notifications().find(n => n.id === notificationId);

    if (!notification || notification.type !== NotificationType.RELAY_PUBLISHING) {
      this.logger.error('Cannot republish: notification not found or wrong type');
      return;
    }

    const relayNotification = notification as RelayPublishingNotification;
    const allRelayUrls = relayNotification.relayPromises?.map(rp => rp.relayUrl) || [];

    if (allRelayUrls.length === 0) {
      this.logger.error('Cannot republish: no relay URLs found');
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

  /**
   * Refresh recent notifications by re-fetching from relays
   * This helps catch any notifications that may have been missed due to relay issues
   */
  async refreshNotifications(): Promise<void> {
    if (this.isRefreshing()) {
      return;
    }

    this.isRefreshing.set(true);

    try {
      await this.contentNotificationService.refreshRecentNotifications(this.REFRESH_LOOKBACK_DAYS);
      this.snackBar.open('Notifications refreshed', 'Close', {
        duration: 2000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      this.logger.error('Failed to refresh notifications:', error);
      this.snackBar.open('Failed to refresh notifications', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } finally {
      this.isRefreshing.set(false);
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
      this.layout.openProfile(contentNotif.authorPubkey);
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
      this.layout.openProfile(contentNotif.authorPubkey);
      return;
    }

    // For zap notifications, open the zap detail page
    if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.zapReceiptId) {
      this.layout.openZapDetail(contentNotif.metadata.zapReceiptId);
      return;
    }

    // Handle navigation based on notification type
    if (contentNotif.eventId) {
      // Determine the correct author for the nevent encoding
      // - For reactions: eventId is the event being reacted to (your note), author is YOU
      // - For replies/mentions/reposts: eventId is the triggering event, author is the person who triggered it
      let eventAuthor: string | undefined;

      if (contentNotif.type === NotificationType.REACTION) {
        // For reactions, the eventId refers to YOUR note that was reacted to
        // So the author should be the current user
        eventAuthor = this.accountState.pubkey() ?? undefined;
      } else {
        // For replies, mentions, reposts - the eventId is the event created by the other person
        eventAuthor = contentNotif.authorPubkey;
      }

      const neventId = nip19.neventEncode({
        id: contentNotif.eventId,
        author: eventAuthor,
        kind: contentNotif.kind,
      });

      // Open event in right panel
      if (contentNotif.kind === 30023) {
        this.layout.openArticle(neventId);
      } else {
        this.layout.openGenericEvent(neventId);
      }
      return;
    }

    // For profile zaps without zapReceiptId (legacy), navigate to recipient's profile
    if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.recipientPubkey) {
      this.layout.openProfile(contentNotif.metadata.recipientPubkey);
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
   * Get the author npub from a content notification for linking
   */
  getAuthorNpub(notification: Notification): string | undefined {
    const pubkey = this.getAuthorPubkey(notification);
    if (pubkey) {
      return nip19.npubEncode(pubkey);
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
   * Format notification title for display after username
   * - Lowercase first character since it follows the username in a sentence
   * - Replace '+' reaction with heart emoji
   * - For custom emojis, return text without the emoji (it will be rendered separately as an image)
   */
  getFormattedNotificationTitle(notification: Notification): string {
    if (!notification.title) return '';

    // Check if this is a reaction with a custom emoji
    if (this.isContentNotificationWithData(notification)) {
      const contentNotif = notification as ContentNotification;
      if (contentNotif.type === NotificationType.REACTION && contentNotif.metadata?.customEmojiUrl) {
        // For custom emojis, return "reacted" without the emoji shortcode (image will be shown separately)
        return 'reacted';
      }
    }

    // Replace 'Reacted +' with 'reacted ❤️' and lowercase first character
    let title = notification.title.replace(/Reacted \+/g, 'reacted ❤️');
    // Lowercase the first character since it comes after the username
    if (title.length > 0) {
      title = title.charAt(0).toLowerCase() + title.slice(1);
    }
    return title;
  }

  /**
   * Get custom emoji URL from a reaction notification (NIP-30)
   * Returns the image URL if the notification has a custom emoji, undefined otherwise
   */
  getCustomEmojiUrl(notification: Notification): string | undefined {
    if (this.isContentNotificationWithData(notification)) {
      const contentNotif = notification as ContentNotification;
      if (contentNotif.type === NotificationType.REACTION) {
        return contentNotif.metadata?.customEmojiUrl;
      }
    }
    return undefined;
  }

  /**
   * Get the alt text for a custom emoji (the shortcode)
   * Returns the shortcode from the reaction content, e.g., ":custom_emoji:" becomes "custom_emoji"
   */
  getCustomEmojiAlt(notification: Notification): string {
    if (this.isContentNotificationWithData(notification)) {
      const contentNotif = notification as ContentNotification;
      const reactionContent = contentNotif.metadata?.reactionContent;
      if (reactionContent && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
        return reactionContent.slice(1, -1); // Remove colons
      }
    }
    return 'custom emoji';
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

  /**
   * Copy notification event data to clipboard for debugging
   */
  copyNotificationData(notification: Notification): void {
    const data = JSON.stringify(notification, null, 2);
    this.clipboard.copy(data);
    this.snackBar.open('Notification data copied to clipboard', 'Close', {
      duration: 2000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom'
    });
  }

  /**
   * Handle virtual scroll viewport reaching end - load more notifications
   */
  onScrolledIndexChange(index: number): void {
    const notifications = this.contentNotifications();
    // Load more when user scrolls near the end (within last 5 items)
    if (notifications.length > 0 && index >= notifications.length - 5) {
      this.loadMoreNotifications();
    }
  }

  /**
   * Load older notifications by extending the lookback period
   */
  async loadMoreNotifications(): Promise<void> {
    if (this.isLoadingMore() || !this.hasMoreNotifications()) {
      return;
    }

    this.isLoadingMore.set(true);

    try {
      // Get the paging window end (cursor). If unset, start from current oldest notification.
      const notifications = this.contentNotifications();
      const currentOldest = notifications.length > 0
        ? Math.min(...notifications.map(n => n.timestamp))
        : Date.now();

      const windowEnd = this.oldestTimestamp() !== null
        ? Math.floor(this.oldestTimestamp()! / 1000)
        : Math.floor(currentOldest / 1000);
      const windowStart = windowEnd - (this.LOAD_MORE_DAYS * 24 * 60 * 60);

      // Track how many notifications we had before
      const countBefore = notifications.length;

      // Fetch notifications for the next older week window
      await this.contentNotificationService.checkForOlderNotifications(windowStart, windowEnd);

      // Check if we got any new notifications
      const countAfter = this.contentNotifications().length;
      if (countAfter === countBefore) {
        // No new notifications in this window; continue paging until several consecutive empty windows
        const emptyWindows = this.consecutiveEmptyLoads() + 1;
        this.consecutiveEmptyLoads.set(emptyWindows);

        if (emptyWindows >= this.MAX_CONSECUTIVE_EMPTY_WINDOWS) {
          this.hasMoreNotifications.set(false);
        }
      } else {
        this.consecutiveEmptyLoads.set(0);
      }

      // Move cursor to older time regardless of whether this window contained notifications
      this.oldestTimestamp.set(windowStart * 1000);
    } catch (error) {
      this.logger.error('Failed to load more notifications:', error);
    } finally {
      this.isLoadingMore.set(false);
    }
  }

  /**
   * Toggle the filter panel visibility
   */
  toggleFilterPanel(): void {
    this.filterPanelOpen.update(v => !v);
  }

  /**
   * Close the filter panel
   */
  closeFilterPanel(): void {
    this.filterPanelOpen.set(false);
  }

  /**
   * Handle filter changes from the filter panel
   */
  onFiltersChanged(changes: Partial<Record<NotificationType, boolean>>): void {
    this.notificationFilters.update(current => ({ ...current, ...changes }));
  }

  /**
   * Handle system notifications toggle from the filter panel
   */
  onSystemNotificationsChanged(show: boolean): void {
    this.showSystemNotifications.set(show);
  }

  /**
   * Handle unread only toggle from the filter panel
   */
  onUnreadOnlyChanged(show: boolean): void {
    this.showUnreadOnly.set(show);
  }
}
