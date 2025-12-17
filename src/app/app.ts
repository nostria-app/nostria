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
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
import { AccountStateService } from './services/account-state.service';
import { RelaysService } from './services/relays/relays';
import { SearchResultsComponent } from './components/search-results/search-results.component';
import { NostrProtocolService } from './services/nostr-protocol.service';
import { StateService } from './services/state.service';
import { PublishQueueService } from './services/publish-queue';
import { NavigationComponent } from './components/navigation/navigation';
import { NavigationContextMenuComponent } from './components/navigation-context-menu/navigation-context-menu.component';
import { Wallets } from './services/wallets';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventService } from './services/event';
import { SleepModeService } from './services/sleep-mode.service';
import { SleepModeOverlayComponent } from './components/sleep-mode-overlay/sleep-mode-overlay.component';
import { WhatsNewDialogComponent } from './components/whats-new-dialog/whats-new-dialog.component';
import { FeedsCollectionService } from './services/feeds-collection.service';
import { NewFeedDialogComponent } from './pages/feeds/new-feed-dialog/new-feed-dialog.component';
import { FavoritesOverlayComponent } from './components/favorites-overlay/favorites-overlay.component';
import { NostrRecord } from './interfaces';
import { DatabaseErrorDialogComponent } from './components/database-error-dialog/database-error-dialog.component';
import { RouteDataService } from './services/route-data.service';
import { InstallService } from './services/install.service';
import { CacheCleanupService } from './services/cache-cleanup.service';
import { AccountLocalStateService } from './services/account-local-state.service';
import { NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { WebPushService } from './services/webpush.service';
import { PushNotificationPromptComponent } from './components/push-notification-prompt/push-notification-prompt.component';
import { isPlatformBrowser } from '@angular/common';
import { StandaloneLoginDialogComponent } from './components/standalone-login-dialog/standalone-login-dialog.component';
import { StandaloneTermsDialogComponent } from './components/standalone-terms-dialog/standalone-terms-dialog.component';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AppsMenuComponent } from './components/apps-menu/apps-menu.component';
import { AiService } from './services/ai.service';
import { CustomDialogService } from './services/custom-dialog.service';
import { CommandPaletteDialogComponent } from './components/command-palette-dialog/command-palette-dialog.component';
import { DatabaseService } from './services/database.service';
import { MetricsTrackingService } from './services/metrics-tracking.service';
import { FollowingBackupService } from './services/following-backup.service';

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
    MatTooltipModule,
    MatDialogModule,
    MatDividerModule,
    MatMenuModule,
    FormsModule,
    MatFormFieldModule,
    NPubPipe,
    AgoPipe,
    MatBadgeModule,
    MatBottomSheetModule,
    WelcomeComponent,
    MediaPlayerComponent,
    SearchResultsComponent,
    NavigationComponent,
    NavigationContextMenuComponent,
    SleepModeOverlayComponent,
    FavoritesOverlayComponent,
    StandaloneLoginDialogComponent,
    StandaloneTermsDialogComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(window:keydown)': 'onWindowKeyDown($event)',
  },
})
export class App implements OnInit {
  title = 'Nostria';

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
  notificationService = inject(NotificationService);
  contentNotificationService = inject(ContentNotificationService);
  bottomSheet = inject(MatBottomSheet);
  logger = inject(LoggerService);
  search = inject(SearchService);
  media = inject(MediaPlayerService);
  localSettings = inject(LocalSettingsService);
  accountState = inject(AccountStateService);
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
  private readonly wallets = inject(Wallets);
  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly webPushService = inject(WebPushService);
  private readonly overlay = inject(Overlay);
  private readonly followingBackupService = inject(FollowingBackupService);

  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild('profileSidenav') profileSidenav!: MatSidenav;
  @ViewChild('appsSidenav') appsSidenav!: MatSidenav;
  @ViewChild(SearchResultsComponent) searchResults!: SearchResultsComponent;
  @ViewChild(FavoritesOverlayComponent) favoritesOverlay?: FavoritesOverlayComponent;

  // Apps menu overlay
  private appsMenuOverlayRef?: OverlayRef;

  // Track if push notification prompt has been shown
  private pushPromptShown = signal(false);

  // Use local settings for sidenav state
  opened = computed(() => this.localSettings.menuOpen());
  displayLabels = computed(() => this.localSettings.menuExpanded());

  // Signal to track expanded menu items
  expandedMenuItems = signal<Record<string, boolean>>({});

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

  // Computed signal for accounts with their profiles for the UI
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
      }));
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

  navigationItems = computed(() => {
    const subscription = this.accountState.subscription();
    const feeds = this.feedsCollectionService.feeds();
    const expandedItems = this.expandedMenuItems();

    this.logger.info('navigationItems recomputing, subscription:', subscription);

    return this.navItems.map(item => {
      // For the Feeds item, add feed boards as children
      if (item.label === 'Feeds') {
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
          expanded: expandedItems['feeds'] || false,
          children: feedChildren,
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
    { path: '', label: $localize`:@@app.nav.feeds:Feeds`, icon: 'stacks', authenticated: false },
    { path: 'summary', label: $localize`:@@app.nav.summary:Summary`, icon: 'dashboard', authenticated: true },
    // { path: 'feed', label: 'Feed', icon: 'notes', showInMobile: true },
    // {
    //   path: 'articles',
    //   label: 'Articles',
    //   icon: 'article',
    //   level: 'preview',
    //   authenticated: true,
    // },
    // { path: 'podcasts', label: 'Podcasts', icon: 'podcasts', showInMobile: false },
    { path: 'people', label: $localize`:@@app.nav.people:People`, icon: 'people', authenticated: true },
    {
      path: 'messages',
      label: $localize`:@@app.nav.messages:Messages`,
      icon: 'mail',
      authenticated: true,
    },
    {
      path: 'media',
      label: $localize`:@@app.nav.media:Media`,
      icon: 'photo_library',
      authenticated: true,
    },
    {
      path: 'streams',
      label: $localize`:@@app.nav.streams:Streams`,
      icon: 'live_tv',
    },
    // {
    //   path: 'analytics',
    //   label: $localize`:@@app.nav.analytics:Analytics`,
    //   icon: 'insights',
    //   authenticated: true,
    // },
    // {
    //   path: 'bookmarks',
    //   label: 'Bookmarks',
    //   icon: 'bookmarks',
    //   authenticated: true,
    // },
    // { path: 'badges', label: 'Badges', icon: 'badge', level: 'beta', authenticated: true },
    // { path: 'relays', label: 'Relays', icon: 'dns', showInMobile: false },
    // { path: 'backup', label: 'Backup', icon: 'archive', showInMobile: false },
    {
      path: 'premium',
      label: $localize`:@@app.nav.premium:Premium`,
      icon: 'diamond',
      authenticated: true,
      hideOnSubscribed: true,
    },
    // { path: 'about', label: 'About', icon: 'info', showInMobile: true },
    // { path: '', label: 'Logout', icon: 'logout', action: () => this.logout(), showInMobile: false }
  ];

  constructor() {
    this.logger.info('[App] ==> AppComponent constructor started');
    this.logger.debug('[App] Services injection status:');
    this.logger.debug('[App] - NostrProtocolService injected:', !!this.nostrProtocol);
    this.logger.debug('[App] - ApplicationService injected:', !!this.app);
    this.logger.debug('[App] - LoggerService injected:', !!this.logger);

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

    // Handle launch counter and push notification prompt for authenticated users
    effect(() => {
      const authenticated = this.app.authenticated();
      const initialized = this.app.initialized();
      const pubkey = this.accountState.pubkey();

      if (authenticated && initialized && pubkey && !this.pushPromptShown()) {
        const launchCount = this.accountLocalState.incrementLaunchCount(pubkey);
        this.logger.info(`[App] Launch count for user: ${launchCount}`);

        // Check if user has already dismissed the dialog
        const hasBeenDismissed = this.accountLocalState.getDismissedPushNotificationDialog(pubkey);

        // Show push notification prompt after 5 launches (only once per session and if not previously dismissed)
        if (launchCount > 3 && !this.isPushNotificationEnabled() && !hasBeenDismissed) {
          // Delay showing the prompt to avoid overwhelming the user on startup
          setTimeout(() => {
            this.showPushNotificationPrompt();
          }, 3000); // 3 second delay
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
    this.logger.info('[App] Initializing content notification service');
    try {
      await this.contentNotificationService.initialize();
      this.logger.info('[App] Content notification service initialized successfully');

      // Set up periodic checks every 5 minutes for authenticated users
      setInterval(async () => {
        if (this.app.authenticated()) {
          try {
            await this.contentNotificationService.checkForNewNotifications();
            this.logger.debug('[App] Periodic content notification check completed');
          } catch (error) {
            this.logger.error('[App] Periodic content notification check failed', error);
          }
        }
      }, 5 * 60 * 1000); // 5 minutes
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
          this.router.navigate(['/p', entity]);
        } else {
          // nprofile - decode to get pubkey
          const decoded = nip19.decode(entity);
          if (decoded.type === 'nprofile' && typeof decoded.data === 'object' && decoded.data && 'pubkey' in decoded.data) {
            this.router.navigate(['/p', decoded.data.pubkey]);
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

  onSidenavClosed() {
    // Sync local settings when sidenav is closed (e.g., via backdrop click)
    if (this.localSettings.menuOpen()) {
      this.localSettings.setMenuOpen(false);
    }
  }

  onSidenavOpened() {
    // Sync local settings when sidenav is opened
    if (!this.localSettings.menuOpen()) {
      this.localSettings.setMenuOpen(true);
    }
  }

  toggleProfileSidenav() {
    this.profileSidenav.toggle();
  }

  toggleAppsSidenav() {
    this.appsSidenav.toggle();
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

      // Set the active feed and navigate to home
      this.feedsCollectionService.setActiveFeed(feedId);
      this.router.navigate(['/']);
    } catch (error) {
      this.logger.error('Error navigating to feed:', error);
      // Fallback: just navigate to home page
      this.router.navigate(['/']);
    }
  }

  onNavItemClick(event: MouseEvent, item: NavItem) {
    // If the item has an action, execute it
    if (item.action) {
      event.preventDefault();
      item.action();
      return;
    }

    // For expandable items, we still want navigation to work
    // The expand button handles expansion separately with stopPropagation

    // Close sidenav on mobile after navigation
    if (this.layout.isHandset()) {
      this.toggleSidenav();
    }

    // Let the default routerLink behavior handle navigation
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

    // ALT+N shortcut to open create options (global shortcut)
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.openCreateOptions();
    }

    // Alt+P to open command palette
    if (event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      this.openCommandPalette();
    }

    // Alt+C to open command palette in listening mode
    if (event.altKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.openCommandPalette(true);
    }
  }

  openCommandPalette(listening = false): void {
    const dialogRef = this.customDialog.open(CommandPaletteDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      panelClass: 'command-palette-dialog',
      showCloseButton: false,
      disableEnterSubmit: true
    });

    if (listening) {
      // Start recording immediately if opened in listening mode
      if (dialogRef.componentInstance) {
        dialogRef.componentInstance.startRecording();
      }
    }
  }

  openCreateOptions(): void {
    this.bottomSheet.open(CreateOptionsSheetComponent, {
      panelClass: 'glass-bottom-sheet',
    });
  }

  toggleAppsMenu(event: MouseEvent): void {
    if (this.appsMenuOverlayRef) {
      this.closeAppsMenu();
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(target)
      .withPositions([
        {
          originX: 'end',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom',
          offsetY: -8,
        },
      ]);

    this.appsMenuOverlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });

    const portal = new ComponentPortal(AppsMenuComponent);
    const componentRef = this.appsMenuOverlayRef.attach(portal);

    // Listen for close event from the component
    componentRef.instance.closed.subscribe(() => {
      this.closeAppsMenu();
    });

    // Close when clicking backdrop
    this.appsMenuOverlayRef.backdropClick().subscribe(() => {
      this.closeAppsMenu();
    });
  }

  closeAppsMenu(): void {
    if (this.appsMenuOverlayRef) {
      this.appsMenuOverlayRef.dispose();
      this.appsMenuOverlayRef = undefined;
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

    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '900px',
      // maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      data: {
        icons: [
          'dynamic_feed',
          'bookmark',
          'explore',
          'trending_up',
          'star',
          'favorite',
          'rss_feed',
        ],
        feed: feed,
      },
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result && feed) {
        await this.feedsCollectionService.updateFeed(feed.id, {
          label: result.label,
          icon: result.icon,
          description: result.description,
          path: result.path,
        });
      }
    });
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
   * Navigate to home and clear navigation history
   */
  navigateToHome(): void {
    this.routeDataService.clearHistory();
    this.router.navigate(['/']);
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
    if (event.key === 'Tab' && !event.shiftKey) {
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
      // Check if it's a Nostria URL and extract the entity
      const nostriaEntity = this.extractNostriaEntity(pastedText);
      if (nostriaEntity) {
        pastedText = nostriaEntity;
      }

      // Set the input value
      this.layout.searchInput = pastedText;

      // Trigger the search handling
      this.layout.onSearchInput({ target: { value: pastedText } });
    }
  }

  /**
   * Extract nostr entity from Nostria URLs
   * Supports formats like:
   * - https://nostria.app/e/nevent1...
   * - https://nostria.app/e/note1...
   * - https://nostria.app/p/npub1...
   * - https://nostria.app/p/nprofile1...
   * - https://nostria.app/u/username
   * - https://nostria.app/a/naddr1...
   */
  private extractNostriaEntity(url: string): string | null {
    // Match nostria.app URLs with various paths
    const nostriaPattern = /^https?:\/\/(?:www\.)?nostria\.app\/(e|p|u|a)\/(.+)$/i;
    const match = url.match(nostriaPattern);

    if (!match) {
      return null;
    }

    const [, pathType, entity] = match;

    // For /u/ (username) routes, we need to handle NIP-05 lookup
    // Return the username as-is and let the search handler deal with it
    if (pathType === 'u') {
      // If it looks like a NIP-05 identifier (contains @), return as-is
      if (entity.includes('@')) {
        return entity;
      }
      // For simple usernames, append @nostria.app for NIP-05 lookup
      return `${entity}@nostria.app`;
    }

    // For /e/, /p/, /a/ routes, return the nostr entity directly
    // These should be nevent, note, npub, nprofile, naddr, etc.
    return entity;
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
}
