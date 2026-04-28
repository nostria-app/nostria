import {
  ChangeDetectionStrategy,
  Component,
  inject,
  effect,
  ViewChild,
  afterNextRender,
  runInInjectionContext,
  computed,
  signal,
  PLATFORM_ID,
  DOCUMENT,
  OnInit,
  ElementRef,
  OnDestroy,
  Injector,
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
import { CommonModule, NgOptimizedImage } from '@angular/common';
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
import { DEFAULT_MENU_ITEM_IDS, LocalSettingsService } from './services/local-settings.service';
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
import { WhatsNewDialogComponent } from './components/whats-new-dialog/whats-new-dialog.component';
import { FeedsCollectionService } from './services/feeds-collection.service';
import { FollowSetsService } from './services/follow-sets.service';
import { NewFeedDialogComponent } from './pages/feeds/new-feed-dialog/new-feed-dialog.component';
import { EditPeopleListDialogComponent, EditPeopleListDialogResult } from './pages/people/edit-people-list-dialog.component';
import { FeedConfig } from './services/feed.service';
import { FavoritesOverlayComponent } from './components/favorites-overlay/favorites-overlay.component';
import { RunesSidebarComponent } from './components/runes-sidebar/runes-sidebar.component';
import { NostrRecord } from './interfaces';
import { DatabaseErrorDialogComponent } from './components/database-error-dialog/database-error-dialog.component';
import { RouteDataService } from './services/route-data.service';
import { InstallService } from './services/install.service';
import { ImageCacheService } from './services/image-cache.service';
import { CacheCleanupService } from './services/cache-cleanup.service';
import { AccountLocalStateService, ANONYMOUS_PUBKEY } from './services/account-local-state.service';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { WebPushService } from './services/webpush.service';
import { PushNotificationPromptComponent } from './components/push-notification-prompt/push-notification-prompt.component';
import { CredentialsBackupPromptComponent } from './components/credentials-backup-prompt/credentials-backup-prompt.component';
import { DeadRelaysWarningSheetComponent } from './components/dead-relays-warning-sheet/dead-relays-warning-sheet.component';
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
import { AnalyticsService } from './services/analytics.service';
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
import { EventFocusService } from './services/event-focus.service';
import { RunesSettingsService } from './services/runes-settings.service';
import { TextScaleService } from './services/text-scale.service';
import { UtilitiesService } from './services/utilities.service';
import { AccountRelayService } from './services/relays/account-relay';
import { SettingsQuickCardComponent } from './components/settings-quick-card/settings-quick-card.component';
import { getRuntimeResourceProfile } from './utils/runtime-resource-profile';
import { ColorExtractionService } from './services/color-extraction.service';
import { ChatWidgetComponent } from './components/chat-widget/chat-widget.component';

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
  queryParams?: Record<string, string>; // Query parameters for navigation
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
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
    NgOptimizedImage,
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
    FavoritesOverlayComponent,
    RunesSidebarComponent,
    StandaloneLoginDialogComponent,
    StandaloneTermsDialogComponent,
    NewFeedDialogComponent,
    FeedsComponent,
    RightPanelContainerComponent,
    SettingsQuickCardComponent,
    ChatWidgetComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(window:keydown)': 'onWindowKeyDown($event)',
  },
})
export class App implements OnInit, OnDestroy {
  private readonly runtimeResourceProfile = getRuntimeResourceProfile();
  // Translated labels for use in templates
  createLabel = $localize`:@@app.create.label:Create`;
  publishingEventLabel = $localize`:@@app.tooltip.publishing-event:Publishing event...`;

  // Subject for managing subscription cleanup
  private readonly destroy$ = new Subject<void>();
  private backdropInteractionHandler?: (event: Event) => void;
  private tauriDeepLinkUnlisten?: () => void;

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
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  layout = inject(LayoutService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  notificationService = inject(NotificationService);
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
  snackBar = inject(MatSnackBar);
  eventService = inject(EventService);
  feedsCollectionService = inject(FeedsCollectionService);
  routeDataService = inject(RouteDataService);
  installService = inject(InstallService);
  ai = inject(AiService);
  customDialog = inject(CustomDialogService);
  database = inject(DatabaseService);
  protected readonly wallets = inject(Wallets);
  private readonly nwcService = inject(NwcService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly webPushService = inject(WebPushService);
  private readonly overlay = inject(Overlay);
  private readonly followingBackupService = inject(FollowingBackupService);
  private readonly messagingService = inject(MessagingService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly platformService = inject(PlatformService);
  private readonly eventFocus = inject(EventFocusService);
  private readonly textScale = inject(TextScaleService);
  private readonly utilities = inject(UtilitiesService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly colorExtraction = inject(ColorExtractionService);

  /**
   * Computed toolbar background style when an immersive music page is active.
   * Blends the extracted album/track color into the toolbar's glass effect.
   * Returns null when no immersive background is active (default toolbar style applies via CSS).
   */
  toolbarBackground = computed(() => {
    const colors = this.colorExtraction.activeBackground();
    if (!colors) return null;
    const isDark = this.themeService.darkMode();
    if (isDark) {
      return `hsla(${colors.hue}, ${Math.min(colors.saturation, 40)}%, 12%, 0.9)`;
    } else {
      return `hsla(${colors.hue}, ${Math.min(colors.saturation, 40)}%, 92%, 0.85)`;
    }
  });

  appBackground = computed(() => {
    const colors = this.colorExtraction.activeBackground();
    if (!colors) {
      return 'var(--mat-app-background-color)';
    }

    return `linear-gradient(180deg, ${colors.background} 0%, ${colors.backgroundEnd} 100%)`;
  });

  // Two-column layout services
  twoColumnLayout = inject(TwoColumnLayoutService);
  panelNav = inject(PanelNavigationService);
  rightPanel = inject(RightPanelService);
  panelActions = inject(PanelActionsService);
  rightPanelHeader = inject(RightPanelHeaderService);
  leftPanelHeader = inject(LeftPanelHeaderService);
  runesSettings = inject(RunesSettingsService);
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
  @ViewChild('settingsQuickCardLayer') settingsQuickCardLayer?: ElementRef<HTMLElement>;

  // Create menu overlay
  private createMenuOverlayRef?: OverlayRef;
  private settingsQuickCardOutsideHandler?: (event: Event) => void;
  private settingsQuickCardCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsQuickCardAnchor: HTMLElement | null = null;
  private readonly QUICK_SETTINGS_CARD_WIDTH = 360;
  private readonly QUICK_SETTINGS_CARD_MARGIN = 16;
  private readonly QUICK_SETTINGS_CARD_OFFSET = 12;

  // Track if push notification prompt has been shown
  private pushPromptShown = signal(false);

  // Track if credentials backup prompt has been shown
  private credentialsBackupPromptShown = signal(false);

  // Track dead relay warning state per account for this app session
  private deadRelaysPromptCheckedForPubkey: string | null = null;
  private deadRelaysPromptInFlight = false;

  // Voice search - using SpeechService
  private readonly speechService = inject(SpeechService);
  isSearchListening = signal(false);
  isSearchTranscribing = signal(false);

  // Track search focus state for mobile full-width mode
  searchFocused = signal(false);
  settingsQuickCardOpen = signal(false);
  settingsQuickCardPosition = signal({ top: 16, left: 16 });

  // Track current route for route-aware shell UI behaviors
  currentRouteUrl = signal(this.router.url);

  isClipsMode = computed(() => {
    if (!this.layout.isHandset()) {
      return false;
    }

    const path = this.currentRouteUrl().split('?')[0] ?? '';
    return path === '/clips' || path.startsWith('/clips/');
  });

  hideMobileNavForCurrentRoute = computed(() => {
    if (!this.layout.isHandset()) {
      return false;
    }

    const path = this.currentRouteUrl().split('?')[0] ?? '';
    return path === '/ai' || path.startsWith('/ai/');
  });

  // Track shortcuts dialog reference for toggle behavior
  private shortcutsDialogRef: MatDialogRef<ShortcutsDialogComponent> | null = null;

  // Use local settings for sidenav state
  opened = computed(() => this.localSettings.menuOpen());
  displayLabels = computed(() => this.localSettings.menuExpanded());
  dockedSidenavWidth = computed(() => {
    if (!this.opened() || this.layout.isHandset()) {
      return 0;
    }

    return this.displayLabels() ? 240 : 56;
  });
  settingsQuickCardFullscreen = computed(() => this.layout.isHandset());

  // User's preference for whether to collapse left panel when right panel has content
  preferLeftPanelCollapsed = computed(() => {
    const pubkey = this.accountState.pubkey() || ANONYMOUS_PUBKEY;
    return this.accountLocalState.getLeftPanelCollapsed(pubkey);
  });

  // Actual visual collapsed state: only collapse if user prefers AND right panel has content
  leftPanelCollapsed = computed(() => {
    return this.preferLeftPanelCollapsed() && this.hasRightContent();
  });

  // Signal to track expanded menu items
  expandedMenuItems = signal<Record<string, boolean>>({});

  // Signal to track if accounts list is expanded in sidenav
  accountsExpanded = signal(false);

  // Lazy-mount feeds component only when first needed to reduce initial render cost.
  // Once mounted, keep it mounted to preserve existing feed state behavior.
  feedsMounted = signal(false);

  // Lazy-mount search results only when search is first used.
  // Keep mounted afterward to preserve interaction behavior and state.
  searchResultsMounted = signal(false);

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
    const count = this.messagingService.unreadBadgeCount();
    return count > 0 ? count : null;
  }

  private isEventRoute(url: string): boolean {
    return url.startsWith('/e/');
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
        // Sort follow sets: Favorites first, then alphabetically by title
        const sortedFollowSets = [...followSets]
          .sort((a, b) => {
            if (a.dTag === 'nostria-favorites') return -1;
            if (b.dTag === 'nostria-favorites') return 1;
            return a.title.localeCompare(b.title);
          });

        const followSetChildren: NavItem[] = sortedFollowSets.map(set => ({
          path: `/people/list/${set.dTag}`,
          label: set.title,
          icon: set.isPrivate ? 'lock' : (set.dTag === 'nostria-favorites' ? 'star' : 'group'),
          authenticated: false,
          followSetId: set.dTag,
        }));

        const hasRealFollowingLists = followSetChildren.length > 0;

        return {
          ...item,
          expandable: hasRealFollowingLists,
          expanded: hasRealFollowingLists ? (expandedItems['people'] || false) : false,
          children: hasRealFollowingLists ? followSetChildren : undefined,
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
            path: '/collections/boards',
            label: $localize`:@@app.nav.collections.boards:Boards`,
            icon: 'dashboard',
            authenticated: false,
          },
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
          {
            path: '/collections/follow-packs',
            label: $localize`:@@app.nav.collections.follow-packs:Follow Packs`,
            icon: 'group',
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
    { path: 'ai', label: $localize`:@@menu.ai:AI`, icon: 'smart_toy', authenticated: false },
    { path: 'discover', label: $localize`:@@app.nav.discover:Discover`, icon: 'explore', authenticated: true },
    { path: 'search', label: $localize`:@@app.nav.search:Search`, icon: 'manage_search', authenticated: false },
    { path: 'people', label: $localize`:@@app.nav.people:People`, icon: 'people', authenticated: true },
    { path: 'collections', label: $localize`:@@app.nav.collections:Collections`, icon: 'bookmarks', authenticated: true },
    {
      path: 'clips',
      label: $localize`:@@app.nav.clips:Clips`,
      icon: 'smart_display',
    },
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
      path: 'accounts',
      label: $localize`:@@app.nav.premium:Premium`,
      icon: 'diamond',
      authenticated: true,
      hideOnSubscribed: true,
      queryParams: { tab: 'premium' },
    },
    // Additional items available for menu customization
    { path: 'notifications', label: $localize`:@@menu.notifications:Notifications`, icon: 'notifications', authenticated: true },
    { path: 'collections/media', label: $localize`:@@menu.media:Media`, icon: 'photo_library', authenticated: true },
    // Note: 'lists' is intentionally omitted - it's a power-user feature accessible only via direct URL /lists
    { path: 'n', label: $localize`:@@menu.communities:Communities`, icon: 'diversity_3', authenticated: false },
    { path: 'polls', label: $localize`:@@menu.polls:Polls`, icon: 'poll', authenticated: false },
    { path: 'playlists', label: $localize`:@@menu.playlists:Albums`, icon: 'playlist_play', authenticated: false },
    { path: 'queue', label: $localize`:@@menu.queue:Queue`, icon: 'queue_music', authenticated: false },
    { path: 'meetings', label: $localize`:@@menu.meetings:Live Meetings`, icon: 'adaptive_audio_mic', authenticated: false },
    { path: 'memos', label: $localize`:@@menu.memos:Memos`, icon: 'sticky_note_2', authenticated: true },
    { path: 'calendar', label: $localize`:@@menu.calendar:Calendar`, icon: 'calendar_month', authenticated: true },
    { path: 'analytics', label: $localize`:@@menu.analytics:Analytics`, icon: 'bar_chart', authenticated: true },
    { path: 'newsletter', label: $localize`:@@menu.newsletter:Newsletter`, icon: 'campaign', authenticated: true },
    { path: 'chats', label: $localize`:@@menu.chats:Chats`, icon: 'forum', authenticated: false },
    { path: 'settings', label: $localize`:@@menu.settings:Settings`, icon: 'settings', authenticated: false },
    { path: 'wallet', label: $localize`:@@menu.wallet:Wallet`, icon: 'account_balance_wallet', authenticated: true },
  ];

  /** Default menu item IDs that show when no custom config is set */
  private readonly defaultMenuIds = [...DEFAULT_MENU_ITEM_IDS];

  constructor() {
    // EARLY ROUTE RESTORATION: Check synchronously from localStorage before Angular
    // processes the initial navigation to '/'. This prevents the Home→Feeds flash
    // by navigating to the saved route BEFORE the first render completes.
    if (this.initialUrl === '/' || this.initialUrl.startsWith('/?') || this.initialUrl === '') {
      try {
        const accountJson = localStorage.getItem(this.appState.ACCOUNT_STORAGE_KEY);
        if (accountJson) {
          const account = JSON.parse(accountJson);
          const pubkey = account?.pubkey;
          if (pubkey && this.localSettings.startOnLastRoute()) {
            const lastRoute = this.accountLocalState.getLastRoute(pubkey);
            if (lastRoute && lastRoute !== '/' && lastRoute !== this.initialUrl) {
              this.hasRestoredRoute = true;
              // Navigate immediately — Angular hasn't completed initial navigation yet,
              // so this replaces the default '/' navigation rather than adding a second one.
              this.router.navigateByUrl(lastRoute, { replaceUrl: true });
            }
          }
        }
      } catch (err) {
        this.logger.error('[App] Early route restoration failed:', err);
      }
    }

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

    // Wire up right panel back navigation callback for popstate handling
    // This handles the case where RightPanelService has dynamic content that should be
    // closed first before the router-based right panel content
    this.panelNav.setRightPanelBackCallback(() => {
      if (this.rightPanel.hasContent()) {
        this.rightPanel.goBack();
        return true; // Handled
      }
      return false; // Not handled, let PanelNavigationService handle it
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

    // Ensure mobile search full-width state resets when search closes
    effect(() => {
      if (!this.layout.search()) {
        this.searchFocused.set(false);
      }
    });

    // Apply screen rotation lock preference on startup and whenever it changes.
    effect(() => {
      void this.applyScreenRotationPreference(this.localSettings.lockScreenRotation());
    });

    if (!this.app.isBrowser()) {
      return;
    }

    // Safety net: Auto-reload if the app hasn't initialized after 20 seconds.
    // This handles edge cases where Angular bootstraps but services hang during init.
    // Only attempts once per session to avoid reload loops on truly broken states.
    {
      const AUTO_RELOAD_KEY = 'nostria-app-auto-reload-attempted';
      const initCheckTimeout = setTimeout(() => {
        if (!this.app.initialized()) {
          const hasAutoReloaded = sessionStorage.getItem(AUTO_RELOAD_KEY);
          if (!hasAutoReloaded) {
            this.logger.warn('[App] App not initialized after 20s, attempting automatic reload');
            sessionStorage.setItem(AUTO_RELOAD_KEY, 'true');
            window.location.reload();
          } else {
            this.logger.warn('[App] App not initialized after 20s, auto-reload already attempted this session');
          }
        }
      }, 20000);

      // Clear the timeout and session flag once initialized
      effect(() => {
        if (this.app.initialized()) {
          clearTimeout(initCheckTimeout);
          sessionStorage.removeItem(AUTO_RELOAD_KEY);
        }
      });
    }

    if ('launchQueue' in window) {
      const launchQueue = (window as any).launchQueue;

      launchQueue.setConsumer(async (launchParams: any) => {
        if (launchParams?.targetURL) {
          // Handle nostr protocol links
          const url = launchParams.targetURL;

          if (url.includes('nostr=') || url.includes('nwc=')) {
            try {
              await this.nostrProtocol.handleNostrProtocol(url);
            } catch (error) {
              this.logger.error('[App] Launch queue protocol error:', error);

              if (error instanceof Error) {
                this.logger.error('[App] Launch queue error name:', error.name);
                this.logger.error('[App] Launch queue error message:', error.message);
                this.logger.error('[App] Launch queue error stack:', error.stack);
              }
            }
          } else {
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
    }

    void this.initializeTauriDeepLinks();

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

    // Mount feeds component lazily when the feeds panel is first shown.
    effect(() => {
      if (this.panelNav.showFeeds() && !this.feedsMounted()) {
        this.feedsMounted.set(true);
      }
    });

    // Mount search results lazily when search is first activated or has content/results.
    effect(() => {
      const hasSearchInput = !!this.layout.searchInput?.length;
      if ((this.layout.search() || hasSearchInput || this.search.hasVisibleResults()) && !this.searchResultsMounted()) {
        this.searchResultsMounted.set(true);
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
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event: NavigationEnd) => {
        this.currentRouteUrl.set(event.urlAfterRedirects || this.router.url);

        const pubkey = this.accountState.pubkey();
        if (pubkey && event.urlAfterRedirects) {
          this.accountLocalState.setLastRoute(pubkey, event.urlAfterRedirects);
        }

        if (event.urlAfterRedirects && !this.isEventRoute(event.urlAfterRedirects)) {
          this.eventFocus.deactivateBootstrap();
        }
      });

    if (this.isEventRoute(this.initialUrl)) {
      this.eventFocus.activateBootstrap();
    }

    // Track account changes to reset the restoration flag
    let lastPubkey: string | undefined = undefined;
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey !== lastPubkey) {
        lastPubkey = pubkey;
        this.hasRestoredRoute = false;
        this.deadRelaysPromptCheckedForPubkey = null;
        this.deadRelaysPromptInFlight = false;
      }
    });

    // Warn users when their published relay list contains known dead/defunct relays.
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();
      const accountRelayUrls = this.accountRelay.relaysSignal().map((relay) => relay.url);
      const accountRelayOwnerPubkey = this.accountRelay.activeAccountPubkey();

      if (!authenticated || !initialized || !pubkey) {
        return;
      }

      // Avoid evaluating dead-relay warnings with stale relay URLs from a previously selected account.
      if (accountRelayOwnerPubkey !== pubkey) {
        return;
      }

      if (this.deadRelaysPromptCheckedForPubkey === pubkey || this.deadRelaysPromptInFlight) {
        return;
      }

      this.deadRelaysPromptInFlight = true;

      void this.checkAndShowDeadRelaysWarning(pubkey, accountRelayUrls)
        .then((checked) => {
          if (checked && this.accountState.pubkey() === pubkey) {
            this.deadRelaysPromptCheckedForPubkey = pubkey;
          }
        })
        .finally(() => {
          this.deadRelaysPromptInFlight = false;
        });
    });

    // Effect to restore last route when account is loaded
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();
      const startOnLastRoute = this.localSettings.startOnLastRoute();

      // Only restore if the setting is enabled
      if (authenticated && initialized && pubkey && !this.hasRestoredRoute && startOnLastRoute) {
        // Mark as restored immediately to prevent re-triggering
        this.hasRestoredRoute = true;

        // Use the initial URL captured at app startup (before Angular navigation)
        // This prevents restoring last route when user directly navigated to a specific URL
        const isRootOrFeeds = this.initialUrl === '/' || this.initialUrl.startsWith('/?') || this.initialUrl === '';

        if (isRootOrFeeds) {
          const lastRoute = this.accountLocalState.getLastRoute(pubkey);

          const currentUrl = this.router.url;
          if (lastRoute && lastRoute !== '/' && lastRoute !== currentUrl) {
            // Use setTimeout to avoid navigation during change detection
            setTimeout(() => {
              this.router.navigateByUrl(lastRoute).catch(err => {
                this.logger.error('[App] Failed to restore last route', err);
              });
            }, 100);
          }
        }
      } else if (authenticated && initialized && pubkey && !this.hasRestoredRoute && !startOnLastRoute) {
        // Mark as "restored" even though we're not restoring, to prevent checking again
        this.hasRestoredRoute = true;
      }
    });

    // Handle launch counter and prompts for authenticated users
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();

      if (authenticated && initialized && pubkey) {
        // Only increment launch count once per session
        if (!this.pushPromptShown() && !this.credentialsBackupPromptShown()) {
          const launchCount = this.accountLocalState.incrementLaunchCount(pubkey);

          // Show push notification prompt after 5 launches (only once per session and if not previously dismissed)
          const pushDismissed = this.accountLocalState.getDismissedPushNotificationDialog(pubkey);
          if (launchCount >= 5 && !this.isPushNotificationEnabled() && !pushDismissed) {
            setTimeout(() => {
              this.showPushNotificationPrompt();
            }, 3000);
          }
        }
      }
    });

    // Handle credentials backup prompt based on signing operations count
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();
      const account = this.accountState.account();

      if (authenticated && initialized && pubkey && !this.credentialsBackupPromptShown()) {
        const signingCount = this.accountLocalState.getSigningCountReactive(pubkey, true);
        const backupDismissed = this.accountLocalState.getDismissedCredentialsBackupDialog(pubkey);
        const hasPrivateKey = account?.privkey && account.source === 'nsec';

        if (signingCount >= 20 && hasPrivateKey && !backupDismissed) {
          setTimeout(() => {
            this.showCredentialsBackupPrompt();
          }, 5000);
        }
      }
    });

    // Register a one-time callback after the first render
    afterNextRender(() => {
      // Initialize sidenav state after view is ready
      this.initializeSidenavState();
    });
  }

  private async applyScreenRotationPreference(lockRotation: boolean): Promise<void> {
    if (!this.app.isBrowser() || typeof screen === 'undefined' || !('orientation' in screen)) {
      return;
    }

    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape' | 'landscape-primary' | 'landscape-secondary' | 'natural' | 'any') => Promise<void>;
      unlock?: () => void;
    };

    try {
      if (lockRotation && orientation.lock) {
        await orientation.lock('portrait');
      } else if (!lockRotation && orientation.unlock) {
        orientation.unlock();
      }
    } catch {
      // Screen orientation APIs can fail depending on browser/platform restrictions.
    }
  }

  async ngOnInit() {
    if (!this.app.isBrowser()) {
      return;
    }

    try {
      // Add timeout for storage initialization
      // const storageInitPromise = this.storage.init();
      // const timeoutPromise = new Promise<never>((_, reject) => {
      //   setTimeout(() => {
      //     reject(new Error('Storage initialization timeout after 15 seconds'));
      //   }, 15000);
      // });

      // Initialize the new DatabaseService
      const databaseInitPromise = this.database.init();
      const databaseTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Database initialization timeout after 15 seconds'));
        }, 15000);
      });

      await Promise.race([databaseInitPromise, databaseTimeoutPromise]);

      // Open the per-account database if an account is already known from localStorage
      try {
        const accountJson = localStorage.getItem(this.appState.ACCOUNT_STORAGE_KEY);
        if (accountJson) {
          const account = JSON.parse(accountJson);
          if (account?.pubkey) {
            await this.database.initAccount(account.pubkey);
          } else {
            await this.database.initAnonymous();
          }
        } else {
          await this.database.initAnonymous();
        }
      } catch (accountDbError) {
        this.logger.warn('[App] Failed to open per-account database, continuing in anonymous mode', accountDbError);
        await this.database.initAnonymous();
      }

      // Persist relay statistics that were added during initialization
      try {
        const relaysService = this.injector.get(RelaysService);
        await relaysService.persistInitialRelayStats();
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
    await this.checkForNostrProtocolInUrl();

    this.deferStartupTask('content notifications', async () => {
      // Initialize content notification service
      // This also starts periodic polling for new notifications with visibility awareness
      const contentNotificationService = this.injector.get(ContentNotificationService);
      await contentNotificationService.initialize();
      // Note: Periodic polling is now handled internally by ContentNotificationService
      // with visibility awareness (pauses when hidden, checks immediately when visible)
    });

    this.deferStartupTask('metrics tracking', () => {
      const metricsTracking = this.injector.get(MetricsTrackingService);
      metricsTracking.initialize();
    });

    this.deferStartupTask('optional analytics', () => {
      const analyticsService = this.injector.get(AnalyticsService);
      analyticsService.initialize();
    });

    this.deferStartupTask('cache cleanup', () => {
      const cacheCleanup = this.injector.get(CacheCleanupService);
      cacheCleanup.start();
    });
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    this.tauriDeepLinkUnlisten?.();
    this.tauriDeepLinkUnlisten = undefined;

    this.clearSettingsQuickCardCloseTimer();
    this.unregisterSettingsQuickCardOutsideHandler();

    if (this.app.isBrowser() && this.backdropInteractionHandler) {
      this.document.removeEventListener('click', this.backdropInteractionHandler, { capture: true });
      this.document.removeEventListener('touchend', this.backdropInteractionHandler, { capture: true });
      this.backdropInteractionHandler = undefined;
    }
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

    if (this.backdropInteractionHandler) {
      this.document.removeEventListener('click', this.backdropInteractionHandler, { capture: true });
      this.document.removeEventListener('touchend', this.backdropInteractionHandler, { capture: true });
    }

    // Use event delegation on document to catch backdrop clicks
    // This handles both click and touch events
    this.backdropInteractionHandler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const backdropElement = target?.closest('.mat-drawer-backdrop');

      // Close whenever the actual drawer backdrop is interacted with.
      // This avoids relying on potentially stale breakpoint state after resize transitions.
      if (backdropElement && this.sidenav?.opened) {
        if (this.localSettings.menuOpen()) {
          this.localSettings.setMenuOpen(false);
        }
        this.sidenav.close();
      }
    };

    // Listen for both click and touchend events
    this.document.addEventListener('click', this.backdropInteractionHandler, { capture: true });
    this.document.addEventListener('touchend', this.backdropInteractionHandler, { capture: true });
  }

  private deferStartupTask(taskName: string, task: () => Promise<void> | void): void {
    if (!this.app.isBrowser()) {
      return;
    }

    const runTask = () => {
      try {
        const result = task();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(error => {
            this.logger.error(`[App] Deferred task failed: ${taskName}`, error);
          });
        }
      } catch (error) {
        this.logger.error(`[App] Deferred task failed: ${taskName}`, error);
      }
    };

    runInInjectionContext(this.injector, () => {
      afterNextRender(() => {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          window.requestIdleCallback(() => runTask(), {
            timeout: this.runtimeResourceProfile.idleTaskTimeoutMs,
          });
          return;
        }

        setTimeout(() => runTask(), 0);
      });
    });
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
        this.layout.toggleSearch();

        try {
          // Handle special protocols first
          if (result.startsWith('bunker://')) {
            await this.nostrService.loginWithNostrConnect(result);
            return;
          }

          if (result.startsWith('nostr+walletconnect://') || result.startsWith('web+nostr+walletconnect://')) {
            // Handle WalletConnect URL
            try {
              const walletConnectUri = result.startsWith('web+')
                ? result.substring(4)
                : result;
              const parsed = this.wallets.parseConnectionString(walletConnectUri);

              this.wallets.addWallet(parsed.pubkey, walletConnectUri, {
                relay: parsed.relay,
                secret: parsed.secret,
              });

              this.snackBar.open($localize`:@@app.snackbar.wallet-added:Wallet added successfully`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
              });
            } catch (error) {
              this.logger.error('Failed to add wallet:', error);
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
            await this.handleNostrEntityFromQR(result);
            return;
          }

          // Handle any other formats - show a generic message
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
        try {
          const decoded = nip19.decode(entity);
          if (decoded.type === 'naddr') {
            const data = decoded.data;
            const npub = nip19.npubEncode(data.pubkey);

            if (data.kind === 34139) {
              this.layout.openMusicAlbum(npub, data.identifier);
            } else if (data.kind === 30003) {
              this.layout.openMusicPlaylist(npub, data.identifier);
            } else if (this.utilities.isMusicKind(data.kind)) {
              this.layout.openSongDetail(npub, data.identifier);
            } else {
              this.layout.openArticle(entity);
            }
          } else {
            this.layout.openArticle(entity);
          }
          this.snackBar.open($localize`:@@app.snackbar.opening-event:Opening event...`, $localize`:@@app.snackbar.dismiss:Dismiss`, {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
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
      this.localSettings.setMenuOpen(false);
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
    if (this.localSettings.menuOpen()) {
      this.localSettings.setMenuOpen(false);
    }
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
      const sidenavWidth = this.dockedSidenavWidth();
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
   * Does NOT close when the entire window/app loses focus (e.g., Alt+Tab).
   */
  onSearchBlur(event: FocusEvent): void {
    // Check if the new focus target is still within the search container
    const searchContainer = (event.currentTarget as HTMLElement);
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    // If focus is moving to another element within the search container, don't close
    if (relatedTarget && searchContainer.contains(relatedTarget)) {
      return;
    }

    // If relatedTarget is null, focus may have left the window entirely (e.g.,
    // Alt+Tab or clicking another app). Defer the check so the browser can
    // update document.hasFocus() before we read it.
    if (!relatedTarget) {
      setTimeout(() => {
        if (!document.hasFocus()) {
          // Window lost focus — don't dismiss the search results
          return;
        }
        // Focus moved to an element that doesn't report as relatedTarget
        // (e.g., non-focusable area in the app) — dismiss search
        this.searchFocused.set(false);
        this.clearSearchInput(false);
        this.layout.closeSearch();
      });
      return;
    }

    // Focus moved to another element within the app but outside the search container
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

  onMobilePlayerHomeClick(): void {
    this.layout.setCubePlayerFace(false);
    this.twoColumnLayout.resetNavigation('/');
  }

  // --- Mobile cube swipe handling ---
  private cubeTouchStartX = 0;
  private cubeTouchStartY = 0;
  private cubeSwiping = false;

  onCubeTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    this.cubeTouchStartX = event.touches[0].clientX;
    this.cubeTouchStartY = event.touches[0].clientY;
    this.cubeSwiping = false;
  }

  onCubeTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    const deltaX = event.touches[0].clientX - this.cubeTouchStartX;
    const deltaY = event.touches[0].clientY - this.cubeTouchStartY;

    // Consider horizontal swipes (more horizontal than vertical)
    if (Math.abs(deltaX) > 20 && Math.abs(deltaX) > Math.abs(deltaY)) {
      this.cubeSwiping = true;
    }

    // Consider vertical swipes (more vertical than horizontal)
    if (Math.abs(deltaY) > 20 && Math.abs(deltaY) > Math.abs(deltaX)) {
      this.cubeSwiping = true;
    }
  }

  onCubeTouchEnd(event: TouchEvent): void {
    if (!this.cubeSwiping) return;
    const deltaX = event.changedTouches[0].clientX - this.cubeTouchStartX;
    const deltaY = event.changedTouches[0].clientY - this.cubeTouchStartY;
    const threshold = 50;

    // Vertical swipe-up on player face opens fullscreen
    if (-deltaY > threshold && Math.abs(deltaY) > Math.abs(deltaX)) {
      const showingPlayerFace = this.layout.showCubePlayerFace();
      if (showingPlayerFace && this.layout.showMediaPlayer() && !this.layout.fullscreenMediaPlayer()) {
        this.layout.openFullscreenMediaPlayer();
        this.cubeSwiping = false;
        return;
      }
    }

    if (Math.abs(deltaX) < threshold) {
      this.cubeSwiping = false;
      return;
    }

    const showingPlayerFace = this.layout.showCubePlayerFace();

    // Any horizontal swipe toggles between nav and player/music faces
    if (showingPlayerFace && !this.layout.fullscreenMediaPlayer()) {
      this.layout.setCubePlayerFace(false);
    } else if (!showingPlayerFace) {
      this.layout.setCubePlayerFace(true);
    }

    this.cubeSwiping = false;
  }

  async addAccount() {
    this.layout.showLoginDialog();
  }

  async logout(): Promise<void> {
    this.nostrService.logout();
  }

  async switchAccount(pubkey: string): Promise<void> {
    await this.nostrService.switchToUser(pubkey);
    this.accountsExpanded.set(false);

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

    // Alt+B (Windows/Linux) or Option+B (Mac) to toggle left panel (sidebar)
    if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (this.hasRightContent()) {
        this.toggleLeftPanelCollapse();
      }
    }

    if (event.key === 'Escape' && this.settingsQuickCardOpen()) {
      this.closeSettingsQuickCard();
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
          this.layout.navigateToRightPanel('ai/settings');
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

  onSettingsQuickCardTriggerContextMenu(event: MouseEvent): void {
    event.preventDefault();

    if (this.layout.isHandset()) {
      return;
    }

    if (this.settingsQuickCardOpen()) {
      this.closeSettingsQuickCard();
      return;
    }

    this.openSettingsQuickCard(event.currentTarget as HTMLElement | null);
  }

  onSettingsQuickCardTriggerClick(_event: Event): void {
    this.closeSettingsQuickCard();
  }

  openFullSettingsFromQuickCard(): void {
    this.closeSettingsQuickCard();
    this.closeSidenavOnMobile();
    void this.router.navigate(['/settings']);
  }

  closeSettingsQuickCard(): void {
    this.clearSettingsQuickCardCloseTimer();
    this.unregisterSettingsQuickCardOutsideHandler();
    this.settingsQuickCardOpen.set(false);
    this.settingsQuickCardAnchor = null;
  }

  private openSettingsQuickCard(anchor: HTMLElement | null): void {
    if (!anchor) {
      return;
    }

    this.settingsQuickCardAnchor = anchor;
    this.updateSettingsQuickCardPosition(anchor);
    this.settingsQuickCardOpen.set(true);
    this.registerSettingsQuickCardOutsideHandler();
  }

  private updateSettingsQuickCardPosition(anchor: HTMLElement): void {
    if (!this.app.isBrowser() || this.settingsQuickCardFullscreen()) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.min(
      Math.max(this.QUICK_SETTINGS_CARD_MARGIN, rect.right + this.QUICK_SETTINGS_CARD_OFFSET),
      viewportWidth - this.QUICK_SETTINGS_CARD_WIDTH - this.QUICK_SETTINGS_CARD_MARGIN
    );

    const maxTop = Math.max(this.QUICK_SETTINGS_CARD_MARGIN, viewportHeight - this.QUICK_SETTINGS_CARD_MARGIN - 240);
    const top = Math.max(this.QUICK_SETTINGS_CARD_MARGIN, Math.min(rect.top - 12, maxTop));

    this.settingsQuickCardPosition.set({ top, left });
  }

  private clearSettingsQuickCardCloseTimer(): void {
    if (this.settingsQuickCardCloseTimer) {
      clearTimeout(this.settingsQuickCardCloseTimer);
      this.settingsQuickCardCloseTimer = null;
    }
  }

  private registerSettingsQuickCardOutsideHandler(): void {
    if (!this.app.isBrowser() || this.settingsQuickCardOutsideHandler) {
      return;
    }

    this.settingsQuickCardOutsideHandler = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (this.settingsQuickCardLayer?.nativeElement.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest('[data-settings-quick-trigger="true"]')) {
        return;
      }

      this.closeSettingsQuickCard();
    };

    this.document.addEventListener('mousedown', this.settingsQuickCardOutsideHandler, true);
    this.document.addEventListener('touchstart', this.settingsQuickCardOutsideHandler, true);
  }

  private unregisterSettingsQuickCardOutsideHandler(): void {
    if (!this.app.isBrowser() || !this.settingsQuickCardOutsideHandler) {
      return;
    }

    this.document.removeEventListener('mousedown', this.settingsQuickCardOutsideHandler, true);
    this.document.removeEventListener('touchstart', this.settingsQuickCardOutsideHandler, true);
    this.settingsQuickCardOutsideHandler = undefined;
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
    const dialogRef = this.customDialog.open<EditPeopleListDialogComponent, EditPeopleListDialogResult | undefined>(EditPeopleListDialogComponent, {
      title: 'Edit List',
      headerIcon: 'format_list_bulleted',
      data: {
        followSet: followSet,
      },
      width: 'min(500px, calc(100vw - 24px))',
      maxWidth: 'calc(100vw - 24px)',
    });

    dialogRef.afterClosed$.subscribe(({ result }: { result?: EditPeopleListDialogResult }) => {
      if (result) {
        void result;
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
   * Navigate to notifications, clearing right panel if already on notifications
   */
  navigateToNotifications(): void {
    this.twoColumnLayout.resetNavigation('/notifications');
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
   */
  toggleLeftPanelCollapse(): void {
    const pubkey = this.accountState.pubkey() || ANONYMOUS_PUBKEY;
    this.accountLocalState.setLeftPanelCollapsed(pubkey, !this.preferLeftPanelCollapsed());
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

    this.media.exitFullscreen();
    // Animate close of fullscreen media player
    if (this.layout.fullscreenMediaPlayer()) {
      this.layout.closeFullscreenMediaPlayer();
    }

    // Navigate to streams page if we were on a stream route
    if (isStreamRoute) {
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
    try {
      const currentUrl = window.location.href;

      if (currentUrl.includes('nostr=') || currentUrl.includes('nwc=')) {
        await this.nostrProtocol.handleNostrProtocol(currentUrl);
      }
    } catch (error) {
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

  private async initializeTauriDeepLinks(): Promise<void> {
    try {
      const [{ isTauri }, deepLink] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/plugin-deep-link'),
      ]);

      if (!isTauri()) {
        return;
      }

      const startUrls = await deepLink.getCurrent();
      if (startUrls) {
        await this.handleTauriDeepLinkUrls(startUrls);
      }

      this.tauriDeepLinkUnlisten = await deepLink.onOpenUrl((urls) => {
        void this.handleTauriDeepLinkUrls(urls);
      });
    } catch (error) {
      this.logger.error('[App] Failed to initialize Tauri deep links:', error);
    }
  }

  private async handleTauriDeepLinkUrls(urls: string[]): Promise<void> {
    for (const url of urls) {
      const protocolUrl = this.toNostrProtocolLaunchUrl(url);

      if (!protocolUrl) {
        this.logger.warn('[App] Ignoring unsupported Tauri deep link URL:', url);
        continue;
      }

      try {
        await this.nostrProtocol.handleNostrProtocol(protocolUrl);
      } catch (error) {
        this.logger.error('[App] Tauri deep link protocol error:', error);
      }
    }
  }

  private toNostrProtocolLaunchUrl(url: string): string | null {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.startsWith('nostr+walletconnect:') || lowerUrl.startsWith('web+nostr+walletconnect:')) {
      return `tauri://localhost/?nwc=${encodeURIComponent(url)}`;
    }

    if (lowerUrl.startsWith('nostr:') || lowerUrl.startsWith('web+nostr:')) {
      return `tauri://localhost/?nostr=${encodeURIComponent(url)}`;
    }

    if (url.includes('nostr=') || url.includes('nwc=')) {
      return url;
    }

    return null;
  }

  openWhatsNewDialog(): void {
    this.dialog.open(WhatsNewDialogComponent, {
      panelClass: ['material-custom-dialog-panel'],
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

  private async checkAndShowDeadRelaysWarning(pubkey: string, activeAccountRelayUrls: string[]): Promise<boolean> {
    try {
      const dismissed = this.accountLocalState.getDismissedDeadRelaysWarningDialog(pubkey);
      if (dismissed) {
        return true;
      }

      // Prefer active account relays because they are account-scoped and may be available
      // before replaceable events are persisted to the account database.
      let relayUrls = this.utilities.unique(activeAccountRelayUrls.filter((url) => !!url));

      if (relayUrls.length === 0) {
        const relayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
        relayUrls = this.getRawRelayUrlsFromRelayListEvent(relayListEvent);
      }

      if (relayUrls.length === 0) {
        return false;
      }

      const knownDeadRelayUrls = this.utilities.getKnownDeadRelayUrls(relayUrls);
      if (knownDeadRelayUrls.length === 0) {
        return true;
      }

      this.bottomSheet.open(DeadRelaysWarningSheetComponent, {
        disableClose: false,
        hasBackdrop: true,
        data: {
          relayUrls: knownDeadRelayUrls,
        },
      });

      return true;
    } catch (error) {
      this.logger.warn('[App] Failed to evaluate dead relay warning prompt', error);
      return false;
    }
  }

  private getRawRelayUrlsFromRelayListEvent(event: { tags: string[][] } | null): string[] {
    if (!event) {
      return [];
    }

    const relayUrls = event.tags
      .filter((tag) => tag.length >= 2 && (tag[0] === 'r' || tag[0] === 'relay'))
      .map((tag) => {
        const url = tag[1]?.trim() ?? '';
        const wssIndex = url.indexOf('wss://');
        return wssIndex >= 0 ? url.substring(wssIndex) : url;
      })
      .filter((url) => !!url);

    return this.utilities.unique(relayUrls);
  }
}

