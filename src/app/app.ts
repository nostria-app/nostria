import {
  Component,
  inject,
  effect,
  ViewChild,
  afterNextRender,
  computed,
  signal,
  PLATFORM_ID,
  DOCUMENT,
  OnInit,
  ElementRef,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, RouteReuseStrategy, ActivatedRoute, NavigationEnd } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { ThemeService } from './services/theme.service';
import { PwaUpdateService } from './services/pwa-update.service';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { NostrService } from './services/nostr.service';
import { FeatureLevel, LoggerService } from './services/logger.service';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import {
  NotificationType,
} from './services/database.service';
import { LayoutService } from './services/layout.service';
import { ApplicationStateService } from './services/application-state.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { QrcodeScanDialogComponent } from './components/qrcode-scan-dialog/qrcode-scan-dialog.component';
import { ApplicationService } from './services/application.service';
import { NPubPipe } from './pipes/npub.pipe';
import { AgoPipe } from './pipes/ago.pipe';
import { MatBadgeModule } from '@angular/material/badge';
import { nip19, kinds } from 'nostr-tools';
import { NotificationService } from './services/notification.service';
import { ContentNotificationService } from './services/content-notification.service';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { CreateOptionsSheetComponent } from './components/create-options-sheet/create-options-sheet.component';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { WelcomeComponent } from './components/welcome/welcome.component';
import { SearchService } from './services/search.service';
import { MediaPlayerComponent } from './components/media-player/media-player.component';
import { MediaPlayerService } from './services/media-player.service';
import { LocalSettingsService } from './services/local-settings.service';
import { SettingsService } from './services/settings.service';
import { AccountStateService } from './services/account-state.service';
import { RelaysService } from './services/relays/relays';
import { SearchResultsComponent } from './components/search-results/search-results.component';
import { NostrProtocolService } from './services/nostr-protocol.service';
import { StateService } from './services/state.service';
import { PublishQueueService } from './services/publish-queue';
import { NavigationComponent } from './components/navigation/navigation';
import { NavigationContextMenuComponent } from './components/navigation-context-menu/navigation-context-menu.component';
import { Wallets } from './services/wallets';
import { NwcService } from './services/nwc.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventService } from './services/event';
import { SleepModeService } from './services/sleep-mode.service';
import { SleepModeOverlayComponent } from './components/sleep-mode-overlay/sleep-mode-overlay.component';
import { WhatsNewDialogComponent } from './components/whats-new-dialog/whats-new-dialog.component';
import { FeedsCollectionService } from './services/feeds-collection.service';
import { FollowSetsService } from './services/follow-sets.service';
import { NewFeedDialogComponent } from './pages/feeds/new-feed-dialog/new-feed-dialog.component';
import { EditPeopleListDialogComponent, EditPeopleListDialogResult } from './pages/people/edit-people-list-dialog.component';
import { FeedConfig } from './services/feed.service';
import { FavoritesOverlayComponent } from './components/favorites-overlay/favorites-overlay.component';
import { ShoutoutOverlayComponent } from './components/shoutout-overlay/shoutout-overlay.component';
import { NostrRecord } from './interfaces';
import { DatabaseErrorDialogComponent } from './components/database-error-dialog/database-error-dialog.component';
import { RouteDataService } from './services/route-data.service';
import { InstallService } from './services/install.service';
import { ImageCacheService } from './services/image-cache.service';
import { CacheCleanupService } from './services/cache-cleanup.service';
import { AccountLocalStateService, ANONYMOUS_PUBKEY } from './services/account-local-state.service';
import { filter } from 'rxjs/operators';
import { WebPushService } from './services/webpush.service';
import { PushNotificationPromptComponent } from './components/push-notification-prompt/push-notification-prompt.component';
import { CredentialsBackupPromptComponent } from './components/credentials-backup-prompt/credentials-backup-prompt.component';
import { isPlatformBrowser } from '@angular/common';
import { StandaloneLoginDialogComponent } from './components/standalone-login-dialog/standalone-login-dialog.component';
import { StandaloneTermsDialogComponent } from './components/standalone-terms-dialog/standalone-terms-dialog.component';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { CreateMenuComponent } from './components/create-menu/create-menu.component';
import { AiService } from './services/ai.service';
import { CustomDialogService } from './services/custom-dialog.service';
import { SpeechService } from './services/speech.service';
import { CommandPaletteDialogComponent } from './components/command-palette-dialog/command-palette-dialog.component';
import { DatabaseService } from './services/database.service';
import { MetricsTrackingService } from './services/metrics-tracking.service';
import { FollowingBackupService } from './services/following-backup.service';
import { ShortcutsDialogComponent } from './components/shortcuts-dialog/shortcuts-dialog.component';
import { MessagingService } from './services/messaging.service';
import { FeedsComponent } from './pages/feeds/feeds.component';
import { RightPanelService } from './services/right-panel.service';
import { RightPanelContainerComponent } from './components/right-panel-container/right-panel-container.component';
import { TwoColumnLayoutService } from './services/two-column-layout.service';
import { PanelNavigationService } from './services/panel-navigation.service';
import { CustomReuseStrategy } from './services/custom-reuse-strategy';
import { PanelActionsService } from './services/panel-actions.service';
import { PlatformService } from './services/platform.service';
import { NgTemplateOutlet } from '@angular/common';
import { RightPanelHeaderService } from './services/right-panel-header.service';
import { LeftPanelHeaderService } from './services/left-panel-header.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  level?: FeatureLevel;
  authenticated?: boolean;
  hideOnSubscribed?: boolean;
  action?: () => void;
  expandable?: boolean;
  children?: NavItem[];
  expanded?: boolean;
  feedId?: string;
  followSetId?: string;
  mediaSettings?: boolean;
  badge?: () => number | null; // Function that returns badge count or null
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
    CommonModule,
    NgTemplateOutlet,
    MatTooltipModule,
    MatDialogModule,
    MatDividerModule,
    MatMenuModule,
    FormsModule,
    MatFormFieldModule,
    NPubPipe,
    MatBadgeModule,
    MatBottomSheetModule,
    WelcomeComponent,
    MediaPlayerComponent,
    SearchResultsComponent,
    NavigationComponent,
    NavigationContextMenuComponent,
    SleepModeOverlayComponent,
    FavoritesOverlayComponent,
    ShoutoutOverlayComponent,
    StandaloneLoginDialogComponent,
    StandaloneTermsDialogComponent,
    NewFeedDialogComponent,
    FeedsComponent,
    RightPanelContainerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(window:keydown)': 'onWindowKeyDown($event)',
  },
})
export class App implements OnInit {
  // Translated labels for use in templates
  createLabel = $localize`:@@app.create.label:Create`;
  publishingEventLabel = $localize`:@@app.tooltip.publishing-event:Publishing event...`;

  // Computed tooltip for profile caching progress
  cachingTooltip = computed(() => {
    const progress = this.accountState.processingProgress();
    const processed = this.accountState.profileProcessingState().processed;
    const total = this.accountState.profileProcessingState().total;
    return $localize`:@@app.tooltip.caching-profiles:Caching profiles: ${progress}:PROGRESS:% (${processed}:PROCESSED:/${total}:TOTAL:)`;
  });

  // Computed signal to check if any processing is happening
  isProcessing = computed(() => {
    return this.appState.isPublishing() || this.ai.processingState().isProcessing;
  });

  themeService = inject(ThemeService);
  pwaUpdateService = inject(PwaUpdateService);
  dialog = inject(MatDialog);
  nostrService = inject(NostrService);
  relaysService = inject(RelaysService);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  layout = inject(LayoutService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  notificationService = inject(NotificationService);
  contentNotificationService = inject(ContentNotificationService);
  bottomSheet = inject(MatBottomSheet);
  logger = inject(LoggerService);
  search = inject(SearchService);
  media = inject(MediaPlayerService);
  localSettings = inject(LocalSettingsService);
  settings = inject(SettingsService);
  accountState = inject(AccountStateService);
  imageCacheService = inject(ImageCacheService);
  state = inject(StateService);
  nostrProtocol = inject(NostrProtocolService);
  publishQueue = inject(PublishQueueService);
  sleepModeService = inject(SleepModeService);
  snackBar = inject(MatSnackBar);
  eventService = inject(EventService);
  feedsCollectionService = inject(FeedsCollectionService);
  routeDataService = inject(RouteDataService);
  installService = inject(InstallService);
  cacheCleanup = inject(CacheCleanupService);
  ai = inject(AiService);
  customDialog = inject(CustomDialogService);
  database = inject(DatabaseService);
  metricsTracking = inject(MetricsTrackingService);
  protected readonly wallets = inject(Wallets);
  private readonly nwcService = inject(NwcService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly webPushService = inject(WebPushService);
  private readonly overlay = inject(Overlay);
  private readonly followingBackupService = inject(FollowingBackupService);
  private readonly messagingService = inject(MessagingService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly platformService = inject(PlatformService);

  // Two-column layout services
  twoColumnLayout = inject(TwoColumnLayoutService);
  panelNav = inject(PanelNavigationService);
  rightPanel = inject(RightPanelService);
  panelActions = inject(PanelActionsService);
  rightPanelHeader = inject(RightPanelHeaderService);
  leftPanelHeader = inject(LeftPanelHeaderService);
  private readonly customReuseStrategy = inject(RouteReuseStrategy) as CustomReuseStrategy;

  // Right panel routing state - use PanelNavigationService as source of truth
  // hasRightContent checks both router-based content AND RightPanelService content
  hasRightContent = computed(() => this.panelNav.hasRightContent() || this.rightPanel.hasContent());
  // Show back button whenever there's content - clicking it will either go back in history or close the panel
  // Also show when RightPanelService has content (so user can close it)
  canGoBackRight = computed(() => this.panelNav.canGoBackRight() || this.rightPanel.hasContent());

  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild(SearchResultsComponent) searchResults!: SearchResultsComponent;
  @ViewChild(FavoritesOverlayComponent) favoritesOverlay?: FavoritesOverlayComponent;
  @ViewChild('searchInputElement') searchInputElement?: ElementRef<HTMLInputElement>;

  // Create menu overlay
  private createMenuOverlayRef?: OverlayRef;

  // Track if push notification prompt has been shown
  private pushPromptShown = signal(false);

  // Track if credentials backup prompt has been shown
  private credentialsBackupPromptShown = signal(false);

  // Voice search - using SpeechService
  private readonly speechService = inject(SpeechService);
  isSearchListening = signal(false);
  isSearchTranscribing = signal(false);

  // Track search focus state for mobile full-width mode
  searchFocused = signal(false);

  // Track shortcuts dialog reference for toggle behavior
  private shortcutsDialogRef: MatDialogRef<ShortcutsDialogComponent> | null = null;

  // Use local settings for sidenav state
  opened = computed(() => this.localSettings.menuOpen());
  displayLabels = computed(() => this.localSettings.menuExpanded());

  // User's preference for whether to collapse left panel when right panel has content
  preferLeftPanelCollapsed = computed(() => {
    const pubkey = this.accountState.pubkey() || ANONYMOUS_PUBKEY;
    return this.accountLocalState.getLeftPanelCollapsed(pubkey);
  });

  // Actual visual collapsed state: only collapse if user prefers AND right panel has content
  leftPanelCollapsed = computed(() => {
    return this.preferLeftPanelCollapsed() && this.hasRightContent();
  });

  // Track when toggle button should be hidden (during panel transitions)
  toggleButtonAnimating = signal(false);

  // Track previous hasRightContent state to detect transitions
  private previousHasRightContent = false;

  // Signal to track expanded menu items
  expandedMenuItems = signal<Record<string, boolean>>({});

  // Signal to track if accounts list is expanded in sidenav
  accountsExpanded = signal(false);

  // Feed edit dialog state
  showFeedEditDialog = signal(false);
  editingFeed = signal<FeedConfig | undefined>(undefined);
  feedIconOptions = [
    'dynamic_feed',
    'bookmark',
    'explore',
    'trending_up',
    'star',
    'favorite',
    'rss_feed',
  ];

  // Track if we've already restored the route for the current session
  private hasRestoredRoute = false;

  // Capture the initial URL from window.location before Angular navigation
  // This is used to determine if we should restore the last route
  private readonly initialUrl: string = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';

  // Computed signal for account profiles with reactive updates
  accountProfilesMap = computed(() => {
    // This will reactively update when accountProfiles signal changes
    return this.accountState.accountProfiles();
  });

  // Computed signal for accounts with their profiles for the UI, sorted by last usage (most recent first)
  accountsWithProfiles = computed(() => {
    const accounts = this.accountState.accounts();
    const currentPubkey = this.accountState.account()?.pubkey;
    // Access accountProfiles to track reactivity when profiles are loaded
    void this.accountState.accountProfiles();

    return accounts
      .filter(account => account.pubkey !== currentPubkey)
      .map(account => ({
        account,
        profile: this.accountState.getAccountProfileSync(account.pubkey)
      }))
      .sort((a, b) => (b.account.lastUsed ?? 0) - (a.account.lastUsed ?? 0));
  });

  // Computed signal to count unread content notifications only (excludes technical/system notifications)
  // Content notification types for badge count (social interactions that users care about)
  private readonly contentNotificationTypes = [
    NotificationType.NEW_FOLLOWER,
    NotificationType.MENTION,
    NotificationType.REPOST,
    NotificationType.REPLY,
    NotificationType.REACTION,
    NotificationType.ZAP,
  ];

  // Computed signal to count unread content notifications only (excludes technical/system notifications)
  unreadNotificationsCount = computed(() => {
    return this.notificationService
      .notifications()
      .filter(
        notification =>
          !notification.read && this.contentNotificationTypes.includes(notification.type)
      ).length;
  });

  /**
   * Get unread messages count - tries messaging service first, falls back to cached value
   */
  getUnreadMessagesCount(): number | null {
    // First try to get live count from messaging service (if loaded)
    const liveCount = this.messagingService.totalUnreadCount();
    if (liveCount > 0) {
      return liveCount;
    }

    // Fall back to cached count from local state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const cachedCount = this.accountLocalState.getUnreadMessagesCount(pubkey);
      return cachedCount > 0 ? cachedCount : null;
    }

    return null;
  }

  /**
   * Get total wallet balance across all wallets
   * Returns formatted string with total sats, or masked if hideWalletAmounts is enabled
   */
  getTotalWalletBalance(): string {
    const walletEntries = Object.entries(this.wallets.wallets());
    let totalMsats = 0;
    let hasData = false;

    for (const [pubkey] of walletEntries) {
      const walletData = this.nwcService.getWalletData(pubkey);
      if (walletData?.balance) {
        totalMsats += walletData.balance.balance;
        hasData = true;
      }
    }

    if (!hasData) {
      return '...';
    }

    // Check if amounts should be hidden
    if (this.settings.settings().hideWalletAmounts) {
      return '**** sats';
    }

    const sats = Math.floor(totalMsats / 1000);
    return `${sats.toLocaleString()} sats`;
  }

  /**
   * Toggle wallet balance hiding setting
   */
  toggleHideWalletAmounts(): void {
    const current = this.settings.settings().hideWalletAmounts;
    this.settings.updateSettings({ hideWalletAmounts: !current });
  }

  navigationItems = computed(() => {
    const subscription = this.accountState.subscription();
    const feeds = this.feedsCollectionService.feeds();
    const followSets = this.followSetsService.followSets();
    const expandedItems = this.expandedMenuItems();
    const menuConfig = this.localSettings.menuItems();

    // Get the base items to display based on menu configuration
    let baseItems: NavItem[];
    if (menuConfig.length === 0) {
      // Use default menu items when no custom config is set
      baseItems = this.navItems.filter(item => this.defaultMenuIds.includes(item.path));
      // Sort by default order
      baseItems.sort((a, b) => this.defaultMenuIds.indexOf(a.path) - this.defaultMenuIds.indexOf(b.path));
    } else {
      // Use custom menu configuration, deduplicating any duplicate IDs
      const seenIds = new Set<string>();
      const visibleIds = menuConfig
        .filter(config => {
          if (!config.visible || seenIds.has(config.id)) {
            return false;
          }
          seenIds.add(config.id);
          return true;
        })
        .map(config => config.id);

      // Create a map for quick lookup
      const navItemMap = new Map(this.navItems.map(item => [item.path, item]));

      // Build items in the order specified by config
      baseItems = visibleIds
        .map(id => navItemMap.get(id))
        .filter((item): item is NavItem => item !== undefined);
    }

    return baseItems.map(item => {
      // For the Home item, change label to "Introduction" when not authenticated
      if (item.path === '/') {
        if (!this.app.authenticated()) {
          return {
            ...item,
            label: $localize`:@@app.nav.introduction:Introduction`,
            icon: 'waving_hand',
          };
        }
        return item;
      }

      // For the Feeds item, add feed boards as children
      if (item.path === '/f') {
        const feedChildren: NavItem[] = feeds.map(feed => ({
          path: `/?feed=${feed.id}`, // Add feed parameter to navigate to specific feed
          label: feed.label,
          icon: feed.icon,
          authenticated: false,
          feedId: feed.id,
        }));

        return {
          ...item,
          expandable: true,
          expanded: expandedItems['/f'] || false,
          children: feedChildren,
        };
      }

      // For the People item, add follow sets as children
      if (item.path === 'people') {
        // Sort follow sets alphabetically by title for user control (users can prefix with numbers)
        const sortedFollowSets = [...followSets]
          .sort((a, b) => a.title.localeCompare(b.title));

        const followSetChildren: NavItem[] = sortedFollowSets.map(set => ({
          path: `/people/list/${set.dTag}`,
          label: set.title,
          icon: set.isPrivate ? 'lock' : (set.dTag === 'nostria-favorites' ? 'star' : 'group'),
          authenticated: false,
          followSetId: set.dTag,
        }));

        return {
          ...item,
          expandable: true,
          expanded: expandedItems['people'] || false,
          children: followSetChildren,
        };
      }

      // For the Collections item, add collection types as children
      if (item.path === 'collections') {
        const collectionChildren: NavItem[] = [

          {
            path: '/collections/media',
            label: $localize`:@@app.nav.media:Media`,
            icon: 'photo_library',
            authenticated: false,
            mediaSettings: true,
          },
          {
            path: '/collections/bookmarks',
            label: $localize`:@@app.nav.collections.bookmarks:Bookmarks`,
            icon: 'bookmark',
            authenticated: false,
          },
          // {
          //   path: '/lists?tab=sets&kind=30005',
          //   label: $localize`:@@app.nav.collections.curated-videos:Videos`,
          //   icon: 'video_library',
          //   authenticated: false,
          // },
          // {
          //   path: '/lists?tab=sets&kind=30006',
          //   label: $localize`:@@app.nav.collections.curated-pictures:Pictures`,
          //   icon: 'photo_library',
          //   authenticated: false,
          // },
          {
            path: '/collections/relays',
            label: $localize`:@@app.nav.collections.relays:Relays`,
            icon: 'dns',
            authenticated: false,
          },
          {
            path: '/collections/emojis',
            label: $localize`:@@app.nav.collections.emojis:Emojis`,
            icon: 'emoji_emotions',
            authenticated: false,
          },
          {
            path: '/collections/interests',
            label: $localize`:@@app.nav.collections.interests:Interests`,
            icon: 'tag',
            authenticated: false,
          },
        ];

        return {
          ...item,
          expandable: true,
          expanded: expandedItems['collections'] || false,
          children: collectionChildren,
        };
      }

      return item;
    }).filter(item => {
      // Filter out items that are not authenticated if user is not logged in
      if (item.authenticated && !this.app.authenticated()) {
        return false;
      }
      // Filter out items that require a specific feature level if the feature is not enabled
      if (item.level && !this.app.enabledFeature(item.level)) {
        return false;
      }

      // Filter out items that should be hidden when subscribed
      // Only hide if there's a valid subscription with an expiry date
      if (item.hideOnSubscribed && subscription?.expires) {
        this.logger.info('Hiding item due to subscription:', item.label);
        return false;
      }

      return true;
    });
  });

  navItems: NavItem[] = [
    { path: '/', label: $localize`:@@app.nav.home:Home`, icon: 'home', authenticated: false },
    { path: '/f', label: $localize`:@@app.nav.feeds:Feeds`, icon: 'stacks', authenticated: false },
    {
      path: 'messages',
      label: $localize`:@@app.nav.messages:Messages`,
      icon: 'mail',
      authenticated: true,
      badge: () => this.getUnreadMessagesCount(),
    },
    {
      path: 'articles',
      label: $localize`:@@app.nav.articles:Articles`,
      icon: 'article',
    },
    { path: 'summary', label: $localize`:@@app.nav.summary:Summary`, icon: 'dashboard', authenticated: true },
    { path: 'discover', label: $localize`:@@app.nav.discover:Discover`, icon: 'explore', authenticated: true },
    { path: 'search', label: $localize`:@@app.nav.search:Search`, icon: 'manage_search', authenticated: false },
    { path: 'people', label: $localize`:@@app.nav.people:People`, icon: 'people', authenticated: true },
    { path: 'collections', label: $localize`:@@app.nav.collections:Collections`, icon: 'bookmarks', authenticated: true },
    {
      path: 'music',
      label: $localize`:@@app.nav.music:Music`,
      icon: 'music_note',
    },
    {
      path: 'streams',
      label: $localize`:@@app.nav.streams:Streams`,
      icon: 'live_tv',
    },
    {
      path: 'premium',
      label: $localize`:@@app.nav.premium:Premium`,
      icon: 'diamond',
      authenticated: true,
      hideOnSubscribed: true,
    },
    // Additional items available for menu customization
    { path: 'notifications', label: $localize`:@@menu.notifications:Notifications`, icon: 'notifications', authenticated: true },
    { path: 'collections/media', label: $localize`:@@menu.media:Media`, icon: 'photo_library', authenticated: true },
    { path: 'lists', label: $localize`:@@menu.lists:Lists`, icon: 'lists', authenticated: true },
    { path: 'polls', label: $localize`:@@menu.polls:Polls`, icon: 'poll', authenticated: false },
    { path: 'playlists', label: $localize`:@@menu.playlists:Playlists`, icon: 'playlist_play', authenticated: false },
    { path: 'queue', label: $localize`:@@menu.queue:Queue`, icon: 'queue_music', authenticated: false },
    { path: 'meetings', label: $localize`:@@menu.meetings:Live Meetings`, icon: 'adaptive_audio_mic', authenticated: false },
    { path: 'memos', label: $localize`:@@menu.memos:Memos`, icon: 'sticky_note_2', authenticated: true },
    { path: 'calendar', label: $localize`:@@menu.calendar:Calendar`, icon: 'calendar_month', authenticated: true },
    { path: 'analytics', label: $localize`:@@menu.analytics:Analytics`, icon: 'bar_chart', authenticated: true },
    { path: 'settings', label: $localize`:@@menu.settings:Settings`, icon: 'settings', authenticated: false },
    { path: 'wallet', label: $localize`:@@menu.wallet:Wallet`, icon: 'account_balance_wallet', authenticated: true },
  ];

  /** Default menu item IDs that show when no custom config is set */
  private readonly defaultMenuIds = [
    '/',
    '/f',
    'articles',
    'summary',
    'messages',
    'people',
    'collections',
    'music',
    'streams',
  ];

  constructor() {
    this.logger.info('[App] ==> AppComponent constructor started');
    this.logger.debug('[App] Services injection status:');
    this.logger.debug('[App] - NostrProtocolService injected:', !!this.nostrProtocol);
    this.logger.debug('[App] - ApplicationService injected:', !!this.app);
    this.logger.debug('[App] - LoggerService injected:', !!this.logger);

    // Wire up route reuse cache clearing with panel navigation
    if (this.customReuseStrategy && typeof this.customReuseStrategy.clearCache === 'function') {
      this.panelNav.setClearCacheCallback(() => this.customReuseStrategy.clearCache());
    }

    // Wire up right panel clearing with panel navigation
    // When switching sections, fully close the right panel (both RightPanelService and router outlet)
    this.panelNav.setClearRightPanelCallback(() => {
      this.rightPanel.clearHistory();
      this.panelActions.clearRightPanelActions();
      // Navigate to clear the right outlet, preserving query params (e.g., /f?t=bitcoin for dynamic hashtag feeds)
      this.layout.closeRightPanel();
    });

    // Track sidenav size changes to update floating toolbar position
    effect(() => {
      // Read signals to establish dependency
      const displayLabels = this.displayLabels();
      const opened = this.opened();
      const isHandset = this.layout.isHandset();
      // Update toolbar position when any of these change
      this.updateFloatingToolbarPosition();
    });

    // Detect when right panel appears/disappears to animate the toggle button
    effect(() => {
      const hasRight = this.hasRightContent();

      // When right panel first appears, hide button until panels settle
      if (hasRight && !this.previousHasRightContent) {
        this.toggleButtonAnimating.set(true);
        // Show button after panels have animated into place
        setTimeout(() => {
          this.toggleButtonAnimating.set(false);
        }, 450);
      }

      this.previousHasRightContent = hasRight;
    });

    // Ensure mobile search full-width state resets when search closes
    effect(() => {
      if (!this.layout.search()) {
        this.searchFocused.set(false);
      }
    });

    if (!this.app.isBrowser()) {
      this.logger.info('[App] Not in browser environment, skipping browser-specific setup');
      return;
    }

    if ('launchQueue' in window) {
      this.logger.info('[App] LaunchQueue is available, setting up consumer');
      const launchQueue = (window as any).launchQueue;

      launchQueue.setConsumer(async (launchParams: any) => {
        this.logger.info('[App] LaunchQueue consumer triggered');
        this.logger.info('[App] LaunchParams received:', launchParams);
        this.logger.info('[App] LaunchParams type:', typeof launchParams);

        if (launchParams?.targetURL) {
          this.logger.info('[App] Target URL found in launch params');
          this.logger.info('[App] Target URL:', launchParams.targetURL);
          this.logger.info('[App] Target URL type:', typeof launchParams.targetURL);
          this.logger.info(
            '[App] Target URL length:',
            launchParams.targetURL?.length || 'undefined'
          );

          // Handle nostr protocol links
          const url = launchParams.targetURL;
          this.logger.debug('[App] Checking if URL contains nostr or nwc parameter');

          if (url.includes('nostr=') || url.includes('nwc=')) {
            this.logger.info('[App] *** NOSTR/NWC PROTOCOL DETECTED IN LAUNCH QUEUE ***');
            this.logger.info('[App] Processing protocol from launch queue');
            this.logger.info('[App] URL with parameter:', url);

            try {
              await this.nostrProtocol.handleNostrProtocol(url);
              this.logger.info('[App] *** PROTOCOL HANDLING COMPLETED SUCCESSFULLY ***');
            } catch (error) {
              this.logger.error('[App] *** PROTOCOL HANDLING FAILED ***');
              this.logger.error('[App] Launch queue protocol error:', error);

              if (error instanceof Error) {
                this.logger.error('[App] Launch queue error name:', error.name);
                this.logger.error('[App] Launch queue error message:', error.message);
                this.logger.error('[App] Launch queue error stack:', error.stack);
              }
            }
          } else {
            this.logger.debug('[App] No nostr parameter found in launch queue URL');
            this.logger.debug('[App] URL content for analysis:', url);

            // Check for other patterns that might indicate nostr content
            if (url.includes('nostr')) {
              this.logger.warn('[App] URL contains "nostr" but not as expected parameter:', url);
            }
          }
        } else {
          this.logger.warn('[App] LaunchQueue consumer triggered but no targetURL found');
          this.logger.warn('[App] LaunchParams structure:', Object.keys(launchParams || {}));
        }
      });

      this.logger.info('[App] LaunchQueue consumer setup completed');
    } else {
      this.logger.info('[App] LaunchQueue not available in this environment');
      this.logger.debug(
        '[App] Window object keys containing "launch":',
        Object.keys(window).filter(key => key.toLowerCase().includes('launch'))
      );
    }

    // Track previous handset state to detect transitions
    let previousIsHandset = this.layout.isHandset();
    let isFirstRun = true;

    // Single effect to handle responsive behavior and sidenav sync
    effect(() => {
      const isHandset = this.layout.isHandset();

      // On mobile (over mode), ensure menu starts closed on initial app load
      // Also close when transitioning FROM desktop TO mobile
      if (isHandset) {
        if (isFirstRun || (!isFirstRun && !previousIsHandset)) {
          this.localSettings.setMenuOpen(false);
          // When transitioning to mobile, explicitly close the sidenav
          // This ensures the backdrop is properly reset for the new mode
          if (this.sidenav?.opened) {
            this.sidenav.close();
          }
        }
      }

      // Update previous state for next comparison
      previousIsHandset = isHandset;
      isFirstRun = false;

      // Sync sidenav state with local settings (only after view is initialized)
      if (this.sidenav) {
        const shouldBeOpen = this.localSettings.menuOpen();
        if (shouldBeOpen !== this.sidenav.opened) {
          if (shouldBeOpen) {
            this.sidenav.open();
          } else {
            this.sidenav.close();
          }
        }
      }
    });

    if (this.app.isBrowser()) {
      // Show login dialog if user is not logged in - with debugging
      effect(() => {
        // if (this.app.initialized() && !this.app.authenticated()) {
        //   this.showLoginDialog();
        // }
        // const isLoggedIn = this.app.authenticated()
        // const isInitialized = this.app.initialized();
        // if (isInitialized && !isLoggedIn) {
        //   this.logger.debug('Showing login dialog');
        //   this.showLoginDialog();
        // } else if (isInitialized && isLoggedIn) {
        //   const user = this.nostrService.activeAccount();
        //   // Whenever the user changes, ensure that we have the correct relays
        //   if (user) {
        //     this.logger.debug('User changed, updating relays', { pubkey: user.pubkey });
        //     // Data load will happen automatically in nostr service.
        //     //this.dataLoadingService.loadData();
        //     // Also load the user metadata for the profile panel
        //     // this.nostrService.loadAllUsersMetadata().catch(err =>
        //     //   this.logger.error('Failed to load metadata after user change', err));
        //   } else {
        //     this.logger.debug('No user logged in, not updating relays');
        //   }
        // }
      });

      // Effect to load metadata again after data loading completes
      effect(() => {
        const showSuccess = this.appState.showSuccess();
        if (showSuccess) {
          this.logger.debug('Data loading completed, refreshing user metadata');
          // this.nostrService.loadUsersMetadata().catch(err =>
          //   this.logger.error('Failed to reload metadata after data loading', err));
        }
      });

      // effect(() => {

      //   // When nostr and storage is initialized, set the pubkey.
      //   if (this.app.initialized() && this.nostrService.account()) {
      //     this.accountState.currentProfilePubkey.set(this.nostrService.account()!.pubkey);
      //   }

      // });

      // Additional effect to make sure we have metadata for the current user
      // effect(() => {
      //   const currentUser = this.nostrService.activeAccount();
      //   const isInitialized = this.app.initialized();

      //   if (currentUser && isInitialized && this.storage.initialized()) {
      //     // Ensure we have the latest metadata for the current user
      //     // this.nostrService.loadUsersMetadata().catch(err =>
      //     //   this.logger.error('Failed to load user metadata on user change', err));
      //   }
      // });
    }

    // Track route changes to save last route for each account
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        const pubkey = this.accountState.pubkey();
        if (pubkey && event.urlAfterRedirects) {
          this.accountLocalState.setLastRoute(pubkey, event.urlAfterRedirects);
          this.logger.debug(`[App] Saved last route for account: ${event.urlAfterRedirects}`);
        }
      });

    // Track account changes to reset the restoration flag
    let lastPubkey: string | undefined = undefined;
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey !== lastPubkey) {
        this.logger.debug(`[App] Account changed from ${lastPubkey?.substring(0, 8)} to ${pubkey?.substring(0, 8)}, resetting route restoration flag`);
        lastPubkey = pubkey;
        this.hasRestoredRoute = false;
      }
    });

    // Effect to restore last route when account is loaded
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();
      const startOnLastRoute = this.localSettings.startOnLastRoute();

      this.logger.debug(`[App] Route restoration effect triggered - authenticated: ${authenticated}, initialized: ${initialized}, pubkey: ${pubkey?.substring(0, 8)}, hasRestored: ${this.hasRestoredRoute}, startOnLastRoute: ${startOnLastRoute}`);

      // Only restore if the setting is enabled
      if (authenticated && initialized && pubkey && !this.hasRestoredRoute && startOnLastRoute) {
        // Mark as restored immediately to prevent re-triggering
        this.hasRestoredRoute = true;

        // Use the initial URL captured at app startup (before Angular navigation)
        // This prevents restoring last route when user directly navigated to a specific URL
        const isRootOrFeeds = this.initialUrl === '/' || this.initialUrl.startsWith('/?') || this.initialUrl === '';

        this.logger.debug(`[App] Route restoration check - initialUrl: ${this.initialUrl}, isRootOrFeeds: ${isRootOrFeeds}`);

        if (isRootOrFeeds) {
          const lastRoute = this.accountLocalState.getLastRoute(pubkey);
          this.logger.debug(`[App] Last route from storage: ${lastRoute}`);

          const currentUrl = this.router.url;
          if (lastRoute && lastRoute !== '/' && lastRoute !== currentUrl) {
            this.logger.info(`[App] Restoring last route: ${lastRoute}`);
            // Use setTimeout to avoid navigation during change detection
            setTimeout(() => {
              this.router.navigateByUrl(lastRoute).catch(err => {
                this.logger.error('[App] Failed to restore last route', err);
              });
            }, 100);
          } else {
            this.logger.debug('[App] No last route to restore or already on that route');
          }
        } else {
          this.logger.debug(`[App] Not restoring last route - user navigated directly to: ${this.initialUrl}`);
        }
      } else if (authenticated && initialized && pubkey && !this.hasRestoredRoute && !startOnLastRoute) {
        // Mark as "restored" even though we're not restoring, to prevent checking again
        this.hasRestoredRoute = true;
        this.logger.debug('[App] Start on last route is disabled, not restoring');
      }
    }, { allowSignalWrites: true });

    // Handle launch counter and prompts for authenticated users
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();
      const account = this.accountState.account();

      if (authenticated && initialized && pubkey) {
        // Only increment launch count once per session
        if (!this.pushPromptShown() && !this.credentialsBackupPromptShown()) {
          const launchCount = this.accountLocalState.incrementLaunchCount(pubkey);
          this.logger.info(`[App] Launch count for user: ${launchCount}`);

          // Show push notification prompt after 5 launches (only once per session and if not previously dismissed)
          const pushDismissed = this.accountLocalState.getDismissedPushNotificationDialog(pubkey);
          if (launchCount >= 5 && !this.isPushNotificationEnabled() && !pushDismissed) {
            setTimeout(() => {
              this.showPushNotificationPrompt();
            }, 3000);
          }

          // Show credentials backup prompt after 10 launches (only for accounts with private keys)
          const backupDismissed = this.accountLocalState.getDismissedCredentialsBackupDialog(pubkey);
          const hasPrivateKey = account?.privkey && account.source === 'nsec';
          if (launchCount >= 10 && hasPrivateKey && !backupDismissed) {
            setTimeout(() => {
              this.showCredentialsBackupPrompt();
            }, 5000); // 5 second delay (after push notification prompt if shown)
          }
        }
      }
    });

    this.logger.debug('AppComponent constructor completed'); // Register a one-time callback after the first render
    afterNextRender(() => {
      this.logger.debug('AppComponent first render completed');

      // Initialize sidenav state after view is ready
      this.initializeSidenavState();
    });
  }

  async ngOnInit() {
    this.logger.info('[App] ==> ngOnInit started');
    this.logger.debug('[App] Platform check - isBrowser:', this.app.isBrowser());

    if (!this.app.isBrowser()) {
      this.logger.info('[App] Not in browser environment, skipping initialization');
      return;
    }

    try {
      this.logger.info('[App] Initializing storage');

      // Add timeout for storage initialization
      // const storageInitPromise = this.storage.init();
      // const timeoutPromise = new Promise<never>((_, reject) => {
      //   setTimeout(() => {
      //     reject(new Error('Storage initialization timeout after 15 seconds'));
      //   }, 15000);
      // });

      // await Promise.race([storageInitPromise, timeoutPromise]);
      // this.logger.info('[App] Storage initialized successfully');

      // Initialize the new DatabaseService
      this.logger.info('[App] Initializing database');
      const databaseInitPromise = this.database.init();
      const databaseTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Database initialization timeout after 15 seconds'));
        }, 15000);
      });

      await Promise.race([databaseInitPromise, databaseTimeoutPromise]);
      this.logger.info('[App] Database initialized successfully');

      // Persist relay statistics that were added during initialization
      try {
        await this.relaysService.persistInitialRelayStats();
        this.logger.info('[App] Initial relay statistics persisted successfully');
      } catch (error) {
        this.logger.warn('[App] Failed to persist initial relay statistics:', error);
      }

      // Get diagnostic info if there were any issues
      if (!this.database.initialized()) {
        this.logger.warn('[App] Database not properly initialized');
      }
    } catch (error: any) {
      this.logger.error('[App] Database initialization failed', {
        error: error?.message || 'Unknown error',
        name: error?.name || 'Unknown',
      });

      // Show user-friendly error message
      this.showStorageError(error, null);

      // Stop initialization - do not continue without working database
      this.logger.error('[App] Halting initialization due to database failure');
      return;
    }

    // Check for nostr protocol parameter in current URL
    this.logger.info('[App] Checking for nostr protocol in current URL');
    await this.checkForNostrProtocolInUrl();

    // Initialize content notification service
    // This also starts periodic polling for new notifications with visibility awareness
    this.logger.info('[App] Initializing content notification service');
    try {
      await this.contentNotificationService.initialize();
      this.logger.info('[App] Content notification service initialized successfully');
      // Note: Periodic polling is now handled internally by ContentNotificationService
      // with visibility awareness (pauses when hidden, checks immediately when visible)
    } catch (error) {
      this.logger.error('[App] Failed to initialize content notification service', error);
    }

    // Initialize metrics tracking service
    this.logger.info('[App] Initializing metrics tracking service');
    try {
      this.metricsTracking.initialize();
      this.logger.info('[App] Metrics tracking service initialized successfully');
    } catch (error) {
      this.logger.error('[App] Failed to initialize metrics tracking service', error);
    }

    // Start cache cleanup service
    this.logger.info('[App] Starting cache cleanup service');
    try {
      this.cacheCleanup.start();
      this.logger.info('[App] Cache cleanup service started successfully');
    } catch (error) {
      this.logger.error('[App] Failed to start cache cleanup service', error);
    }

    this.logger.info('[App] ==> ngOnInit completed');
  }

  private showStorageError(error: any, diagnostics: any): void {
    // Always show critical error dialog with backdrop since we're halting the app
    this.dialog.open(DatabaseErrorDialogComponent, {
      disableClose: true,
      hasBackdrop: true,
      width: '90vw',
      maxWidth: '550px',
    });
  }

  /**
   * Initialize sidenav state after the view is ready
   */
  private initializeSidenavState(): void {
    if (this.sidenav) {
      const shouldBeOpen = this.localSettings.menuOpen();
      if (shouldBeOpen) {
        this.sidenav.open();
      } else {
        this.sidenav.close();
      }
    }
    // Set initial floating toolbar position
    this.updateFloatingToolbarPosition();

    // Add manual backdrop click handler as fallback
    // This fixes the issue where backdrop click doesn't work after mode transition
    this.setupBackdropClickHandler();
  }

  /**
   * Set up a manual click/touch handler on the backdrop element.
   * This provides a fallback for cases where Angular Material's
   * backdrop click event doesn't fire properly (e.g., after mode transition).
   */
  private setupBackdropClickHandler(): void {
    if (!this.app.isBrowser()) return;

    // Use event delegation on document to catch backdrop clicks
    // This handles both click and touch events
    const handleBackdropInteraction = (event: Event) => {
      const target = event.target as HTMLElement;

      // Check if the click/touch is on the backdrop
      if (target && target.classList.contains('mat-drawer-backdrop')) {
        // Only close if sidenav is open and we're in mobile (over) mode
        if (this.sidenav?.opened && this.layout.isHandset()) {
          event.preventDefault();
          event.stopPropagation();
          this.sidenav.close();
        }
      }
    };

    // Listen for both click and touchend events
    this.document.addEventListener('click', handleBackdropInteraction, { capture: true });
    this.document.addEventListener('touchend', handleBackdropInteraction, { capture: true });
  }

  qrScan() {
    const dialogRef = this.dialog.open(QrcodeScanDialogComponent, {
      data: { did: '' },
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'qr-scan-dialog',
      hasBackdrop: true,
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result) {
        this.logger.info('QR scan result received:', result);
        this.layout.toggleSearch();

        try {
          // Handle special protocols first
          if (result.startsWith('bunker://')) {
            await this.nostrService.loginWithNostrConnect(result);
            return;
          }

          if (result.startsWith('nostr+walletconnect://')) {
            // Handle WalletConnect URL
            try {
              const parsed = this.wallets.parseConnectionString(result);

              this.wallets.addWallet(parsed.pubkey, result, {
                relay: parsed.relay,
                secret: parsed.secret,
              });

              this.snackBar.open($localize`:@@app.snackbar.wallet-added:Wallet added successfully`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
              });
            } catch (error) {
              console.error('Failed to add wallet:', error);
              this.snackBar.open(
                $localize`:@@app.snackbar.wallet-failed:Failed to add wallet. Please check the connection string.`,
                $localize`:@@app.snackbar.dismiss:Dismiss`,
                {
                  duration: 3000,
                  horizontalPosition: 'center',
                  verticalPosition: 'bottom',
                }
              );
            }
            return;
          }

          // Handle Nostr entities (npub, nprofile, note, nevent, naddr, etc.)
          if (this.isNostrEntity(result)) {
            this.logger.debug('Handling Nostr entity from QR code:', result);
            await this.handleNostrEntityFromQR(result);
            return;
          }

          // Handle any other formats - show a generic message
          this.logger.info('Unrecognized QR code format:', result);
          this.snackBar.open($localize`:@@app.snackbar.qr-unrecognized:QR code scanned, but format not recognized.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });

        } catch (error) {
          this.logger.error('Error processing QR code result:', error);
          this.snackBar.open($localize`:@@app.snackbar.qr-error:Error processing QR code.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
        }
      }
    });
  }

  /**
   * Check if a value is a Nostr entity (npub, nprofile, nevent, note, naddr, etc.)
   */
  private isNostrEntity(value: string): boolean {
    return (
      value.startsWith('npub') ||
      value.startsWith('nprofile') ||
      value.startsWith('nevent') ||
      value.startsWith('note') ||
      value.startsWith('naddr') ||
      value.startsWith('nsec')
    );
  }

  /**
   * Handle Nostr entities scanned from QR codes
   */
  private async handleNostrEntityFromQR(entity: string): Promise<void> {
    try {
      if (entity.startsWith('npub') || entity.startsWith('nprofile')) {
        // Handle profile entities
        if (entity.startsWith('npub')) {
          this.layout.openProfile(entity);
        } else {
          // nprofile - decode to get pubkey, then encode as npub for URL
          const decoded = nip19.decode(entity);
          if (decoded.type === 'nprofile' && typeof decoded.data === 'object' && decoded.data && 'pubkey' in decoded.data) {
            this.layout.openProfile(decoded.data.pubkey);
          } else {
            throw new Error('Invalid nprofile data');
          }
        }

        this.snackBar.open($localize`:@@app.snackbar.opening-profile:Opening profile...`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
          duration: 2000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });

      } else if (entity.startsWith('note') || entity.startsWith('nevent')) {
        // Handle note/event entities - use the layout service
        this.layout.openGenericEvent(entity);

        this.snackBar.open($localize`:@@app.snackbar.opening-event:Opening event...`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
          duration: 2000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });

      } else if (entity.startsWith('naddr')) {
        // Handle address entities - check kind to decide route
        try {
          const decoded = nip19.decode(entity).data as { kind: number; pubkey: string; identifier: string };

          if (decoded.kind === kinds.LongFormArticle) {
            // Route to article page for long-form articles
            this.layout.openArticle(entity);
            this.snackBar.open($localize`:@@app.snackbar.opening-article:Opening article...`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
              duration: 2000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
            });
          } else {
            // Route to event page for other addressable events (starter packs, etc.)
            this.layout.openGenericEvent(entity);
            this.snackBar.open($localize`:@@app.snackbar.opening-event:Opening event...`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
              duration: 2000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
            });
          }
        } catch (error) {
          this.logger.error('Error decoding naddr:', error);
          this.snackBar.open($localize`:@@app.snackbar.entity-error:Error processing Nostr entity.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
        }

      } else if (entity.startsWith('nsec')) {
        // Warn about private key
        this.snackBar.open($localize`:@@app.snackbar.private-key-warning:Warning: This appears to be a private key! Do not share it.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'error-snackbar'
        });

      } else {
        this.logger.warn('Unhandled Nostr entity type:', entity);
        this.snackBar.open($localize`:@@app.snackbar.unsupported-entity:Unsupported Nostr entity type.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
      }

    } catch (error) {
      this.logger.error('Error handling Nostr entity from QR:', error);
      this.snackBar.open($localize`:@@app.snackbar.entity-error:Error processing Nostr entity.`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  toggleSidenav() {
    const newState = !this.localSettings.menuOpen();
    this.localSettings.setMenuOpen(newState);

    // Immediately sync with the sidenav component
    if (this.sidenav) {
      if (newState) {
        this.sidenav.open();
      } else {
        this.sidenav.close();
      }
    }
  }

  /** Toggle the accounts list expansion in sidenav */
  toggleAccountsExpanded() {
    this.accountsExpanded.update(v => !v);
  }

  /** Close sidenav on mobile (overlay mode) after navigation */
  closeSidenavOnMobile() {
    if (this.layout.isHandset() && this.sidenav?.opened) {
      this.sidenav.close();
    }
  }

  /**
   * Handle backdrop click on sidenav container.
   * This explicitly closes the sidenav when backdrop is clicked,
   * which ensures proper handling especially after mode transitions
   * from 'side' to 'over' when resizing the window.
   */
  onBackdropClick() {
    if (this.sidenav?.opened) {
      this.sidenav.close();
    }
  }

  onSidenavClosed() {
    // Sync local settings when sidenav is closed (e.g., via backdrop click)
    if (this.localSettings.menuOpen()) {
      this.localSettings.setMenuOpen(false);
    }
    // Collapse accounts when sidenav closes
    this.accountsExpanded.set(false);
    this.updateFloatingToolbarPosition();
  }

  onSidenavOpened() {
    // Sync local settings when sidenav is opened
    if (!this.localSettings.menuOpen()) {
      this.localSettings.setMenuOpen(true);
    }
    this.updateFloatingToolbarPosition();
  }

  /** Update CSS variables for floating toolbar position based on sidenav state */
  private updateFloatingToolbarPosition() {
    if (!this.app.isBrowser()) return;

    const isOpen = this.opened();
    const isSideMode = !this.layout.isHandset();

    if (isOpen && isSideMode) {
      // Sidenav is open in side mode - it pushes content
      const sidenavWidth = this.displayLabels() ? 220 : 56;
      document.documentElement.style.setProperty('--floating-toolbar-left', `${72 + sidenavWidth}px`);
    } else {
      // Sidenav closed or in overlay mode - no offset needed
      document.documentElement.style.setProperty('--floating-toolbar-left', '72px');
    }
  }

  /**
   * Open search and focus the input.
   * The input is always in the DOM (hidden via CSS) for iOS Safari focus compatibility.
   * This allows us to focus immediately within the user gesture context.
   */
  openSearch(): void {
    if (this.layout.search()) {
      // Already open, just toggle off
      this.layout.toggleSearch();
      return;
    }

    // Focus the input BEFORE toggling search state
    // This is critical for iOS Safari - focus must happen in user gesture context
    // Since the input is always in DOM (just hidden), we can focus it immediately
    const input = this.searchInputElement?.nativeElement;
    if (input) {
      // Focus immediately while still in user gesture context
      input.focus();
    }

    // Then open search (removes the hidden class)
    this.layout.toggleSearch();
  }

  /**
   * Handle search input focus event.
   * Opens the search results panel when the always-visible search input is focused.
   */
  onSearchFocus(): void {
    this.searchFocused.set(true);
    if (!this.layout.search()) {
      this.layout.toggleSearch();
    }
  }

  /**
   * Handle search container blur event.
   * Closes the search when focus leaves the search container entirely.
   */
  onSearchBlur(event: FocusEvent): void {
    // Check if the new focus target is still within the search container
    const searchContainer = (event.currentTarget as HTMLElement);
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    // If focus is moving to another element within the search container, don't close
    if (relatedTarget && searchContainer.contains(relatedTarget)) {
      return;
    }

    // Focus left the search container
    this.searchFocused.set(false);

    // Dismiss search when focus leaves the container
    this.clearSearchInput(false);
    this.layout.closeSearch();
  }

  /**
   * Clear the search input and search results.
   */
  clearSearchInput(keepFocus = true): void {
    this.layout.searchInput = '';
    this.layout.query.set('');
    this.search.clearResults();
    if (keepFocus) {
      // Keep focus on search input after clearing
      this.searchInputElement?.nativeElement?.focus();
    }
  }

  toggleMediaPlayer() {
    this.layout.showMediaPlayer.set(!this.layout.showMediaPlayer());
  }
  toggleMenuSize() {
    this.localSettings.toggleMenuExpanded();
  }

  toggleMenuExpansion(itemKey: string) {
    const currentExpandedItems = this.expandedMenuItems();
    this.expandedMenuItems.set({
      ...currentExpandedItems,
      [itemKey]: !currentExpandedItems[itemKey]
    });
  }

  async navigateToFeed(feedId: string) {
    try {
      // Close sidenav on mobile
      if (this.layout.isHandset()) {
        this.localSettings.setMenuOpen(false);
      }

      // Set the active feed and navigate to feeds view
      this.feedsCollectionService.setActiveFeed(feedId);
      this.router.navigate(['/f']);
    } catch (error) {
      this.logger.error('Error navigating to feed:', error);
      // Fallback: just navigate to home page
      this.router.navigate(['/']);
    }
  }

  navigateToChildItem(child: NavItem) {
    // Close sidenav on mobile
    if (this.layout.isHandset()) {
      this.localSettings.setMenuOpen(false);
    }

    if (child.feedId) {
      // Navigate to feed
      const feedId = child.path.split('=')[1];
      this.navigateToFeed(feedId);
    } else if (child.followSetId) {
      // Navigate to people page with follow set using clean URL
      this.router.navigate(['/people/list', child.followSetId]);
    } else {
      // Default navigation
      this.router.navigate([child.path]);
    }
  }

  onNavItemClick(event: MouseEvent, item: NavItem) {
    // If the item has an action, execute it
    if (item.action) {
      event.preventDefault();
      item.action();
      return;
    }

    // For main navigation items (with path), reset navigation stack and navigate
    if (item.path) {
      event.preventDefault();
      this.twoColumnLayout.resetNavigation(item.path);
    }

    // For expandable items, we still want navigation to work
    // The expand button handles expansion separately with stopPropagation

    // Close sidenav on mobile after navigation
    if (this.layout.isHandset()) {
      this.toggleSidenav();
    }
  }

  onMobileNavClick(path: string) {
    this.twoColumnLayout.resetNavigation(path);
  }

  async addAccount() {
    this.layout.showLoginDialog();
  }

  async logout(): Promise<void> {
    this.nostrService.logout();
  }

  async switchAccount(pubkey: string): Promise<void> {
    await this.nostrService.switchToUser(pubkey);

    if (this.layout.isHandset()) {
      this.toggleSidenav();
    }
  }

  onWindowKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }

    // Check if user is typing in an input field
    const target = event.target as HTMLElement;
    const isInputField = target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.closest('mat-form-field') !== null;

    // Video playback shortcuts (only when media player is active in footer/mini mode and not typing)
    // Skip when fullscreen audio player is active - it has its own keyboard handler
    if (this.layout.showMediaPlayer() && !this.layout.fullscreenMediaPlayer() && !isInputField) {
      // Space or K to toggle play/pause
      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (this.media.paused) {
          this.media.resume();
        } else {
          this.media.pause();
        }
        return;
      }

      // J or Left Arrow to rewind 10 seconds
      if (event.key.toLowerCase() === 'j' || event.key === 'ArrowLeft') {
        event.preventDefault();
        this.media.rewind(10);
        return;
      }

      // L or Right Arrow to fast forward 10 seconds
      if (event.key.toLowerCase() === 'l' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.media.forward(10);
        return;
      }
    }

    // ALT+S (Windows/Linux) or CMD+S (Mac) shortcut to toggle search (global shortcut)
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.layout.toggleSearch();
    }

    // ALT+N (Windows/Linux) or CMD+N (Mac) shortcut to open create options (global shortcut)
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.openCreateOptions();
    }

    // Alt+C (Windows/Linux) or Cmd+C (Mac) to open command palette
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.openCommandPalette();
    }

    // Ctrl+K (all platforms) to open command palette - common in web apps
    if (event.ctrlKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openCommandPalette();
    }

    // Alt+V (Windows/Linux) or Option+V (Mac) to open command palette in listening mode (voice command)
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.openCommandPalette(true);
    }

    // Alt+P (Windows/Linux) or Option+P (Mac) to show keyboard shortcuts dialog
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      this.openShortcutsDialog();
    }
  }

  openCommandPalette(listening = false): void {
    this.layout.openCommandPalette(listening);
  }

  openShortcutsDialog(): void {
    // If dialog is already open, close it (toggle behavior)
    if (this.shortcutsDialogRef) {
      this.shortcutsDialogRef.close();
      return;
    }

    this.shortcutsDialogRef = this.dialog.open(ShortcutsDialogComponent);
    this.shortcutsDialogRef.afterClosed().subscribe(() => {
      this.shortcutsDialogRef = null;
    });
  }

  // Voice search methods - using SpeechService
  async startSearchVoiceInput(): Promise<void> {
    // Check if AI transcription is enabled first
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) {
      this.snackBar.open('AI transcription is disabled in settings', 'Open Settings', { duration: 5000 })
        .onAction().subscribe(() => {
          this.router.navigate(['/ai/settings']);
        });
      return;
    }

    this.isSearchListening.set(true);

    await this.speechService.startRecording({
      silenceDuration: 2000,
      onRecordingStateChange: (isRecording) => {
        this.isSearchListening.set(isRecording);
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isSearchTranscribing.set(isTranscribing);
      },
      onTranscription: (text) => {
        // Remove punctuation but keep # for hashtags and @ for mentions
        const cleanText = text.replace(/[.,/!$%^&*;:{}=\-_`~()]/g, "");

        // Set the search input value
        this.layout.searchInput = cleanText;

        // Trigger search
        setTimeout(() => {
          const searchInput = this.document.querySelector('.search-input') as HTMLInputElement;
          if (searchInput) {
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 100);
      }
    });
  }

  stopSearchRecording(): void {
    this.speechService.stopRecording();
  }

  openCreateOptions(): void {
    this.bottomSheet.open(CreateOptionsSheetComponent, {
      panelClass: 'glass-bottom-sheet',
    });
  }

  openCreateMenu(event: MouseEvent): void {
    if (this.createMenuOverlayRef) {
      this.closeCreateMenu();
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(target)
      .withPositions([
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'bottom',
          offsetY: -8,
        },
      ]);

    this.createMenuOverlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });

    const portal = new ComponentPortal(CreateMenuComponent);
    const componentRef = this.createMenuOverlayRef.attach(portal);

    // Listen for close event from the component
    componentRef.instance.closed.subscribe(() => {
      this.closeCreateMenu();
    });

    // Close when clicking backdrop
    this.createMenuOverlayRef.backdropClick().subscribe(() => {
      this.closeCreateMenu();
    });
  }

  closeCreateMenu(): void {
    if (this.createMenuOverlayRef) {
      this.createMenuOverlayRef.dispose();
      this.createMenuOverlayRef = undefined;
    }
  }

  openInstallDialog(): void {
    this.installService.openInstallDialog();
  }

  openFeedEditDialog(feedId: string): void {
    const feed = this.feedsCollectionService.getFeedById(feedId);
    if (!feed) {
      this.logger.error('Feed not found:', feedId);
      return;
    }

    this.editingFeed.set(feed);
    this.showFeedEditDialog.set(true);
  }

  openFollowSetEditDialog(followSetId: string): void {
    // Get the follow set
    const followSet = this.followSetsService.getFollowSetByDTag(followSetId);
    if (!followSet) {
      this.logger.error('Follow set not found:', followSetId);
      return;
    }

    // Open the edit dialog
    const dialogRef = this.dialog.open(EditPeopleListDialogComponent, {
      data: {
        followSet: followSet,
      },
      width: '500px',
      maxWidth: '90vw',
    });

    dialogRef.afterClosed().subscribe((result: EditPeopleListDialogResult | null) => {
      if (result) {
        this.logger.info('Follow set updated, removed pubkeys:', result.removedPubkeys);
      }
    });

    // Close sidenav on mobile
    if (this.layout.isHandset()) {
      this.localSettings.setMenuOpen(false);
    }
  }

  openMediaSettings(): void {
    // Navigate to media page with servers tab
    this.router.navigate(['/collections/media'], {
      queryParams: { tab: 'servers' }
    });

    // Close sidenav on mobile
    if (this.layout.isHandset()) {
      this.localSettings.setMenuOpen(false);
    }
  }

  openCollectionsSettings(): void {
    // Navigate to collections/lists page
    this.router.navigate(['/lists']);

    // Close sidenav on mobile
    if (this.layout.isHandset()) {
      this.localSettings.setMenuOpen(false);
    }
  }

  async onFeedEditDialogClosed(result: FeedConfig | null): Promise<void> {
    this.showFeedEditDialog.set(false);
    const feed = this.editingFeed();
    this.editingFeed.set(undefined);

    if (result && feed) {
      await this.feedsCollectionService.updateFeed(feed.id, {
        label: result.label,
        icon: result.icon,
      });
    }
  }

  showLoginDialog(): void {
    this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog',
    });
  }

  /**
   * Navigate to feeds and clear navigation history
   */
  navigateToHome(): void {
    this.routeDataService.clearHistory();
    this.panelNav.clearHistory();
    this.router.navigate(['/f']);
  }

  /**
   * Go back in left panel navigation stack.
   * Navigates to previous entry or shows feeds if at root.
   */
  goBackLeft(): void {
    this.panelNav.goBackLeft();
  }

  /**
   * Navigate to a route and close the right panel.
   * Used when navigating from sidebar to ensure right panel content is cleared.
   */
  navigateAndClearRightPanel(path: string): void {
    this.closeSidenavOnMobile();
    this.closeRightPanel();
    this.router.navigate([path]);
  }

  /**
   * Close the left panel and return to home/feeds.
   * When X is clicked on a list component, all left history is cleared
   * and the user is taken back to home.
   */
  closeLeftPanel(): void {
    // Clear left stack
    this.panelNav.clearLeftStack();

    // Clear panel actions immediately
    this.panelActions.clearLeftPanelActions();
    this.panelActions.clearRightPanelActions();

    // Clear right panel state (without navigating yet)
    const pubkey = this.accountState.pubkey() || ANONYMOUS_PUBKEY;
    this.accountLocalState.setLeftPanelCollapsed(pubkey, false);
    this.panelNav.clearRightStack();

    // Navigate to feeds and clear right outlet in one navigation
    this.router.navigateByUrl('/f');
  }

  /**
   * Toggle left panel collapsed preference for focusing on right content.
   * The left panel slides behind the right panel with a smooth animation.
   * The toggle button fades out during the animation and fades back in when complete.
   */
  toggleLeftPanelCollapse(): void {
    const pubkey = this.accountState.pubkey() || ANONYMOUS_PUBKEY;
    // Fade out the toggle button
    this.toggleButtonAnimating.set(true);

    // Toggle the collapsed state
    this.accountLocalState.setLeftPanelCollapsed(pubkey, !this.preferLeftPanelCollapsed());

    // Fade button back in after animation completes
    setTimeout(() => {
      this.toggleButtonAnimating.set(false);
    }, 450);
  }

  /**
   * Go back in right panel navigation stack
   */
  goBackRight(): void {
    // First check if RightPanelService has content to go back from
    if (this.rightPanel.hasContent()) {
      this.rightPanel.goBack();
      return;
    }

    // Otherwise, delegate to PanelNavigationService which handles all the logic
    // including back navigation flags and proper routing
    this.panelNav.goBackRight();
  }

  /**
   * Close the right panel and clear navigation history.
   * When X is clicked, the panel is fully closed and history forgotten.
   * Note: The collapse preference is preserved - left panel auto-expands because
   * leftPanelCollapsed depends on hasRightContent.
   */
  closeRightPanel(): void {
    // Close RightPanelService content if any
    if (this.rightPanel.hasContent()) {
      this.rightPanel.close();
    }

    // Clear right panel actions immediately
    this.panelActions.clearRightPanelActions();
    // Close the panel navigation right stack - this handles navigation via callback
    this.panelNav.closeRight();
  }

  /**
   * Open event in right panel using routing
   */
  openEventInRightPanel(eventId: string): void {
    this.layout.openGenericEvent(eventId);
  }

  /**
   * Open article in right panel using routing
   */
  openArticleInRightPanel(naddr: string): void {
    this.layout.openArticle(naddr);
  }

  /**
   * Open profile in right panel using routing
   */
  openProfileInRightPanel(pubkey: string): void {
    this.layout.openProfile(pubkey);
  }

  /**
   * Get the title for the right panel based on current content
   */
  getRightPanelTitle(): string {
    return this.panelNav.getRightTitle();
  }

  /**
   * Get the title for the left panel based on current content
   */
  getLeftPanelTitle(): string {
    return this.panelNav.getLeftTitle();
  }

  /**
   * Handle scroll events on the left panel
   * Each panel has its own scroll container with scrollbar at the panel edge
   */
  onLeftPanelScroll(event: Event): void {
    this.layout.handlePanelScroll(event, 'left');
  }

  /**
   * Handle scroll events on the right panel
   * Each panel has its own scroll container with scrollbar at the panel edge
   */
  onRightPanelScroll(event: Event): void {
    this.layout.handlePanelScroll(event, 'right');
  }

  /**
   * @deprecated Use onLeftPanelScroll or onRightPanelScroll instead
   * Handle scroll events on the main layout container (kept for backward compatibility)
   */
  onLayoutScroll(event: Event): void {
    this.layout.handleLayoutScroll(event);
  }

  exitFullscreen(): void {
    // Check if we're on a stream route before exiting
    const currentUrl = this.router.url;
    const isStreamRoute = currentUrl.startsWith('/stream/');

    console.log('[App] exitFullscreen called, currentUrl:', currentUrl, 'isStreamRoute:', isStreamRoute);

    this.media.exitFullscreen();
    // Also turn off fullscreen media player mode so it doesn't auto-open next time
    if (this.layout.fullscreenMediaPlayer()) {
      this.layout.fullscreenMediaPlayer.set(false);
    }

    // Navigate to streams page if we were on a stream route
    if (isStreamRoute) {
      console.log('[App] Navigating to /streams');
      this.router.navigate(['/streams']);
    }
  }

  onSearchInputKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      // Execute the first search action if available
      const actions = this.search.searchActions();
      if (actions.length > 0) {
        event.preventDefault();
        actions[0].callback();
        return;
      }
      // If no actions but there are results, select the first result
      const results = this.search.searchResults();
      if (results.length > 0) {
        event.preventDefault();
        this.layout.openProfile(results[0].event.pubkey);
        this.search.clearResults();
        this.layout.toggleSearch();
        return;
      }
    } else if (event.key === 'Tab' && !event.shiftKey) {
      // Check if search results are visible
      if (this.search.searchResults().length > 0) {
        event.preventDefault();
        // Focus the search results container after a short delay to ensure it's rendered
        setTimeout(() => {
          const searchResultsContainer = this.document.querySelector(
            '.search-results'
          ) as HTMLElement;
          if (searchResultsContainer) {
            searchResultsContainer.focus();
          }
        }, 0);
      }
    } else if (event.key === 'Escape') {
      // Clear search results and close search when Escape is pressed
      this.search.clearResults();
      this.layout.toggleSearch();
    }
  }

  onSearchInputPaste(event: ClipboardEvent): void {
    // Handle paste events for nostr URLs
    event.preventDefault();
    let pastedText = event.clipboardData?.getData('text')?.trim();

    if (pastedText) {
      // Check if it's a Nostr client URL and extract the entity
      const nostrEntity = this.extractNostrEntityFromUrl(pastedText);
      if (nostrEntity) {
        pastedText = nostrEntity;
      }

      // Set the input value
      this.layout.searchInput = pastedText;

      // Trigger the search handling
      this.layout.onSearchInput({ target: { value: pastedText } });
    }
  }

  /**
   * Extract nostr entity from Nostr client URLs
   * Supports formats from various clients:
   * - Nostria: https://nostria.app/e/nevent1..., /p/npub1..., /u/username, /a/naddr1...
   * - Primal: https://primal.net/e/nevent1..., /p/npub1...
   * - Snort: https://snort.social/e/nevent1..., /p/npub1...
   * - Iris: https://iris.to/npub1..., /nevent1...
   * - Coracle: https://coracle.social/npub1..., /nevent1...
   * - Satellite: https://satellite.earth/n/nevent1..., /p/npub1...
   * Also handles URLs with trailing paths like:
   * - https://nostria.app/p/npub1.../notes
   * - https://primal.net/p/npub1.../notes
   */
  private extractNostrEntityFromUrl(url: string): string | null {
    // Check if URL ends with a file extension that indicates it's not a Nostr profile link
    // This prevents RSS feeds, JSON files, etc. from being treated as Nostr entities
    const feedExtensions = /\.(xml|rss|json|atom|txt|csv|pdf|zip|tar|gz)(\?.*)?$/i;
    if (feedExtensions.test(url)) {
      return null;
    }

    // First, try to extract a nostr entity directly from the URL path
    // This handles most Nostr clients that include the entity in the URL
    const entityPattern = /(npub1[a-z0-9]+|nprofile1[a-z0-9]+|nevent1[a-z0-9]+|note1[a-z0-9]+|naddr1[a-z0-9]+)/i;
    const entityMatch = url.match(entityPattern);

    if (entityMatch) {
      return entityMatch[1];
    }

    // Handle Nostria-specific /u/ username routes
    const nostriaUsernamePattern = /^https?:\/\/(?:www\.)?nostria\.app\/u\/([^/]+)/i;
    const usernameMatch = url.match(nostriaUsernamePattern);

    if (usernameMatch) {
      const username = usernameMatch[1];
      // If it looks like a NIP-05 identifier (contains @), return as-is
      if (username.includes('@')) {
        return username;
      }
      // For simple usernames, append @nostria.app for NIP-05 lookup
      return `${username}@nostria.app`;
    }

    return null;
  }

  /**
   * Check if the current URL contains a nostr protocol parameter and handle it
   */
  private async checkForNostrProtocolInUrl(): Promise<void> {
    this.logger.info('[App] ==> Checking for nostr protocol in current URL');

    try {
      this.logger.debug('[App] Getting current URL from window.location');
      const currentUrl = window.location.href;

      this.logger.info('[App] Current URL:', currentUrl);
      this.logger.info('[App] Current URL length:', currentUrl?.length || 'undefined');
      this.logger.debug('[App] Current URL breakdown:', {
        href: window.location.href,
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });

      this.logger.debug('[App] Checking if current URL contains nostr parameter');

      if (currentUrl.includes('nostr=')) {
        this.logger.info('[App] *** NOSTR PARAMETER DETECTED IN CURRENT URL ***');
        this.logger.info('[App] URL with nostr parameter:', currentUrl);

        // Extract and log the nostr parameter value
        try {
          const urlObj = new URL(currentUrl);
          const nostrParam = urlObj.searchParams.get('nostr');
          this.logger.info('[App] Extracted nostr parameter value:', nostrParam);
          this.logger.debug('[App] All URL parameters:', Array.from(urlObj.searchParams.entries()));
        } catch (urlParseError) {
          this.logger.error(
            '[App] Failed to parse current URL for parameter extraction:',
            urlParseError
          );
        }

        this.logger.info('[App] Calling nostr protocol handler for current URL');
        await this.nostrProtocol.handleNostrProtocol(currentUrl);
        this.logger.info('[App] *** NOSTR PROTOCOL HANDLING FROM URL COMPLETED ***');
      } else {
        this.logger.debug('[App] No nostr parameter found in current URL');

        // Check for other nostr-related patterns
        if (currentUrl.includes('nostr')) {
          this.logger.info('[App] URL contains "nostr" but not as parameter:', currentUrl);
        }

        // Check for direct nostr protocol in hash or other locations
        if (window.location.hash && window.location.hash.includes('nostr')) {
          this.logger.info('[App] Found nostr reference in URL hash:', window.location.hash);
        }
      }

      this.logger.info('[App] ==> URL check completed');
    } catch (error) {
      this.logger.error('[App] ==> ERROR: Failed to check for nostr protocol in URL');
      this.logger.error('[App] URL check error:', error);

      if (error instanceof Error) {
        this.logger.error('[App] URL check error name:', error.name);
        this.logger.error('[App] URL check error message:', error.message);
        this.logger.error('[App] URL check error stack:', error.stack);
      }

      this.logger.error('[App] URL check error context:', {
        currentUrl: window?.location?.href || 'unavailable',
        userAgent: navigator?.userAgent || 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  }

  openWhatsNewDialog(): void {
    this.dialog.open(WhatsNewDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: 'whats-new-dialog-container',
    });
  }

  /**
   * Get account profile with fallback handling
   * This method ensures we always try to get a profile, even if it wasn't pre-loaded
   */
  getAccountProfile(pubkey: string): NostrRecord | undefined {
    return this.accountState.getAccountProfileSync(pubkey);
  }

  /**
   * Gets the optimized image URL using the image cache service
   */
  getOptimizedImageUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';

    return this.imageCacheService.getOptimizedImageUrl(originalUrl);
  }

  /**
   * Check if push notifications are enabled
   */
  isPushNotificationEnabled(): boolean {
    if (!isPlatformBrowser(this.platform)) {
      return false;
    }

    // Check if service worker push is supported and enabled
    return this.webPushService.push.isEnabled;
  }

  /**
   * Navigate to notification settings to enable push notifications
   */
  enablePushNotifications(): void {
    this.router.navigate(['/notifications/settings']);
  }

  /**
   * Show push notification prompt bottom sheet
   */
  private showPushNotificationPrompt(): void {
    this.pushPromptShown.set(true);

    this.bottomSheet.open(PushNotificationPromptComponent, {
      disableClose: false,
      hasBackdrop: true,
    });
  }

  /**
   * Show credentials backup prompt bottom sheet
   */
  private showCredentialsBackupPrompt(): void {
    this.credentialsBackupPromptShown.set(true);

    this.bottomSheet.open(CredentialsBackupPromptComponent, {
      disableClose: false,
      hasBackdrop: true,
    });
  }
}
