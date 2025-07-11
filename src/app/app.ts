import { Component, inject, signal, effect, ViewChild, afterNextRender, computed, PLATFORM_ID, DOCUMENT } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule, MatSelectionListChange } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ThemeService } from './services/theme.service';
import { PwaUpdateService } from './services/pwa-update.service';
import { CommonModule, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NostrService } from './services/nostr.service';
import { LoadingOverlayComponent } from './components/loading-overlay/loading-overlay.component';
import { FeatureLevel, LoggerService } from './services/logger.service';
import { MatMenuModule } from '@angular/material/menu';
import { FormGroup, FormsModule } from '@angular/forms';
import { NotificationType, RelayPublishingNotification, StorageService } from './services/storage.service';
import { NostrEventData, UserMetadata } from './services/storage.service';
import { LayoutService } from './services/layout.service';
import { ApplicationStateService } from './services/application-state.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { QrcodeScanDialogComponent } from './components/qrcode-scan-dialog/qrcode-scan-dialog.component';
import { ApplicationService } from './services/application.service';
import { NPubPipe } from './pipes/npub.pipe';
import { MatBadgeModule } from '@angular/material/badge';
import { NotificationService } from './services/notification.service';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { CreateOptionsSheetComponent } from './components/create-options-sheet/create-options-sheet.component';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { WelcomeComponent } from './components/welcome/welcome.component';
import { DebugOverlayComponent } from './components/debug-overlay/debug-overlay.component';
import { SearchService } from './services/search.service';
import { MediaPlayerComponent } from './components/media-player/media-player.component';
import { MediaPlayerService } from './services/media-player.service';
import { LocalSettingsService } from './services/local-settings.service';
import { AccountStateService } from './services/account-state.service';
import { SearchResultsComponent } from './components/search-results/search-results.component';
import { NostrProtocolService } from './services/nostr-protocol.service';
import { StateService } from './services/state.service';
import { PublishQueueService } from './services/publish-queue';
import { NavigationComponent } from './components/navigation/navigation';
import { NavigationContextMenuComponent } from './components/navigation-context-menu/navigation-context-menu.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  level?: FeatureLevel;
  authenticated?: boolean;
  hideOnSubscribed?: boolean;
  action?: () => void;
}

@Component({
  selector: 'app-root',
  standalone: true, imports: [
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
    LoadingOverlayComponent,
    FormsModule,
    MatFormFieldModule,
    NPubPipe, MatBadgeModule, MatBottomSheetModule,
    WelcomeComponent,
    DebugOverlayComponent,
    MediaPlayerComponent,
    SearchResultsComponent,
    NavigationComponent,
    NavigationContextMenuComponent
  ], templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  title = 'Nostria';
  themeService = inject(ThemeService);
  pwaUpdateService = inject(PwaUpdateService);
  dialog = inject(MatDialog);
  nostrService = inject(NostrService);
  storage = inject(StorageService);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  layout = inject(LayoutService);
  router = inject(Router);
  notificationService = inject(NotificationService);
  notificationType = NotificationType;
  bottomSheet = inject(MatBottomSheet);
  logger = inject(LoggerService);
  search = inject(SearchService);
  media = inject(MediaPlayerService);
  localSettings = inject(LocalSettingsService);
  accountState = inject(AccountStateService);
  state = inject(StateService);
  nostrProtocol = inject(NostrProtocolService);
  publishQueue = inject(PublishQueueService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild('profileSidenav') profileSidenav!: MatSidenav;
  @ViewChild('appsSidenav') appsSidenav!: MatSidenav;
  @ViewChild(SearchResultsComponent) searchResults!: SearchResultsComponent;

  // Use local settings for sidenav state
  opened = computed(() => this.localSettings.menuOpen());
  displayLabels = computed(() => this.localSettings.menuExpanded());

  // Computed signal to count unread notifications
  unreadNotificationsCount = computed(() => {
    return this.notificationService.notifications().filter(notification => !notification.read).length;
  });

  // Computed signal to check if there are any active pending notifications
  hasActivePendingNotifications = computed(() => {
    return this.notificationService.notifications().some(notification => {
      // Check if it's a RelayPublishingNotification with pending promises
      if (notification.type === NotificationType.RELAY_PUBLISHING) {
        const relayNotification = notification as RelayPublishingNotification;
        return !relayNotification.complete &&
          relayNotification.relayPromises?.some(relay => relay.status === 'pending');
      }
      return false;
    });
  });

  navigationItems = computed(() => {
    const subscription = this.accountState.subscription();
    console.log('navigationItems recomputing, subscription:', subscription);

    return this.navItems.filter(item => {
      // Filter out items that are not authenticated if user is not logged in
      if (item.authenticated && !this.app.authenticated()) {
        return false;
      }
      // Filter out items that require a specific feature level if the feature is not enabled
      if (item.level && !this.app.enabledFeature(item.level)) {
        return false;
      }

      // Filter out items that should be hidden when subscribed
      if (item.hideOnSubscribed && subscription) {
        console.log('Hiding item due to subscription:', item.label);
        return false;
      }

      return true;
    });
  });

  navItems: NavItem[] = [
    { path: '', label: 'Feeds', icon: 'stacks', authenticated: true },
    // { path: 'feed', label: 'Feed', icon: 'notes', showInMobile: true },
    { path: 'articles', label: 'Articles', icon: 'article', authenticated: true },
    // { path: 'podcasts', label: 'Podcasts', icon: 'podcasts', showInMobile: false },
    { path: 'people', label: 'People', icon: 'people', authenticated: true },
    { path: 'messages', label: 'Messages', icon: 'mail', level: 'beta', authenticated: true },
    { path: 'media', label: 'Media', icon: 'photo_library', authenticated: true },
    { path: 'bookmarks', label: 'Bookmarks', icon: 'bookmarks', level: 'preview', authenticated: true },
    { path: 'badges', label: 'Badges', icon: 'badge', level: 'beta', authenticated: true },
    // { path: 'relays', label: 'Relays', icon: 'dns', showInMobile: false },
    // { path: 'backup', label: 'Backup', icon: 'archive', showInMobile: false },
    { path: 'settings', label: 'Settings', icon: 'settings' },
    { path: 'premium', label: 'Premium', icon: 'diamond', level: 'preview', authenticated: true, hideOnSubscribed: true },
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
          this.logger.info('[App] Target URL length:', launchParams.targetURL?.length || 'undefined');
          
          // Handle nostr protocol links
          const url = launchParams.targetURL;
          this.logger.debug('[App] Checking if URL contains nostr parameter');
          
          if (url.includes('nostr=')) {
            this.logger.info('[App] *** NOSTR PROTOCOL DETECTED IN LAUNCH QUEUE ***');
            this.logger.info('[App] Processing nostr protocol from launch queue');
            this.logger.info('[App] URL with nostr parameter:', url);
            
            try {
              await this.nostrProtocol.handleNostrProtocol(url);
              this.logger.info('[App] *** NOSTR PROTOCOL HANDLING COMPLETED SUCCESSFULLY ***');
            } catch (error) {
              this.logger.error('[App] *** NOSTR PROTOCOL HANDLING FAILED ***');
              this.logger.error('[App] Launch queue nostr protocol error:', error);
              
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
      this.logger.debug('[App] Window object keys containing "launch":', 
        Object.keys(window).filter(key => key.toLowerCase().includes('launch')));
    }

    // Track previous handset state to detect transitions
    let previousIsHandset = this.layout.isHandset();

    // Single effect to handle responsive behavior and sidenav sync
    effect(() => {
      const isHandset = this.layout.isHandset();

      // Only close sidenav when transitioning FROM desktop TO mobile (not when already on mobile)
      if (isHandset && !previousIsHandset) {
        this.localSettings.setMenuOpen(false);
      }

      // Update previous state for next comparison
      previousIsHandset = isHandset;

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


    this.logger.debug('AppComponent constructor completed');    // Register a one-time callback after the first render
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
      const storageInitPromise = this.storage.init();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Storage initialization timeout after 15 seconds'));
        }, 15000);
      });

      await Promise.race([storageInitPromise, timeoutPromise]);
      this.logger.info('[App] Storage initialized successfully');

      // Get diagnostic info if there were any issues
      if (!this.storage.initialized()) {
        const diagnostics = await this.storage.getDiagnosticInfo();
        this.logger.warn('[App] Storage not properly initialized, diagnostic info:', diagnostics);
      }

    } catch (error: any) {
      this.logger.error('[App] Storage initialization failed', {
        error: error?.message || 'Unknown error',
        name: error?.name || 'Unknown'
      });

      // Get diagnostic information
      try {
        const diagnostics = await this.storage.getDiagnosticInfo();
        this.logger.error('[App] Storage diagnostic info after failure:', diagnostics);
        
        // Show user-friendly error message
        this.showStorageError(error, diagnostics);
      } catch (diagError) {
        this.logger.error('[App] Failed to collect diagnostic info', diagError);
      }

      // Don't completely block the app, continue with limited functionality
      this.logger.warn('[App] Continuing with limited functionality due to storage failure');
    }

    // Check for nostr protocol parameter in current URL
    this.logger.info('[App] Checking for nostr protocol in current URL');
    await this.checkForNostrProtocolInUrl();
    this.logger.info('[App] ==> ngOnInit completed');
  }

  private showStorageError(error: any, diagnostics: any): void {
    let errorMessage = 'Storage initialization failed. ';
    
    if (diagnostics.platform.isIOS && diagnostics.platform.isWebView) {
      errorMessage += 'This appears to be an iOS WebView which may have IndexedDB restrictions. ';
    } else if (diagnostics.isPrivateMode) {
      errorMessage += 'Private browsing mode detected which may limit storage capabilities. ';
    } else if (!diagnostics.indexedDBSupported) {
      errorMessage += 'IndexedDB is not supported in this browser. ';
    }
    
    errorMessage += 'The app will continue with limited functionality.';
    
    this.logger.warn('[App] User-friendly error message:', errorMessage);
    
    // You could show a toast/snackbar here if needed
    // this.snackBar.open(errorMessage, 'OK', { duration: 10000 });
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
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        console.log('The dialog was closed', result);
        this.layout.toggleSearch();

        if (result.startsWith('bunker://')) {
          await this.nostrService.loginWithNostrConnect(result);
        } else if (result.startsWith('npub:')) {
          this.router.navigate(['/p', result]);
        }
      }
    });
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

  openCreateOptions(): void {
    this.bottomSheet.open(CreateOptionsSheetComponent);
  }

  showLoginDialog(): void {
    this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog'
    });
  }

  exitFullscreen(): void {
    this.media.exitFullscreen();
  }

  onSearchInputKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab' && !event.shiftKey) {
      // Check if search results are visible
      if (this.search.searchResults().length > 0) {
        event.preventDefault();
        // Focus the search results container after a short delay to ensure it's rendered
        setTimeout(() => {
          const searchResultsContainer = this.document.querySelector('.search-results') as HTMLElement;
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
        hash: window.location.hash
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
          this.logger.error('[App] Failed to parse current URL for parameter extraction:', urlParseError);
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
        timestamp: new Date().toISOString()
      });
    }
  }

}
