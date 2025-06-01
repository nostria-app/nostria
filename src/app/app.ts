import { Component, inject, signal, effect, ViewChild, afterNextRender, computed, PLATFORM_ID } from '@angular/core';
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
import { CommonModule, DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
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
import { VideoPlayerComponent } from './components/video-player/video-player.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  level?: FeatureLevel;
  authenticated?: boolean;
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
    NPubPipe,
    MatBadgeModule,
    MatBottomSheetModule,
    WelcomeComponent,
    DebugOverlayComponent,
    MediaPlayerComponent,
    VideoPlayerComponent
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
  app = inject(ApplicationService); layout = inject(LayoutService);
  router = inject(Router);
  notificationService = inject(NotificationService);
  notificationType = NotificationType;
  bottomSheet = inject(MatBottomSheet);
  logger = inject(LoggerService);
  search = inject(SearchService);

  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  @ViewChild('profileSidenav') profileSidenav!: MatSidenav;

  opened = signal(true);
  displayLabels = signal(true);

  // We'll compute the current user metadata from the nostrService's metadata array
  accountMetadata = computed(() => {
    if (this.nostrService.account()) {
      // First check from accountsMetadata (which should be synchronized)
      const metadata = this.nostrService.getMetadataForAccount(this.nostrService.pubkey());
      return metadata;
    }

    return undefined;
  });

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

  navItems: NavItem[] = [
    { path: '', label: 'Feeds', icon: 'stacks' },
    // { path: 'feed', label: 'Feed', icon: 'notes', showInMobile: true },
    { path: 'articles', label: 'Articles', icon: 'article' },
    // { path: 'podcasts', label: 'Podcasts', icon: 'podcasts', showInMobile: false },
    { path: 'people', label: 'People', icon: 'people', authenticated: true },
    { path: 'messages', label: 'Messages', icon: 'mail', level: 'beta', authenticated: true },
    { path: 'media', label: 'Media', icon: 'photo_library', authenticated: true },
    { path: 'bookmarks', label: 'Bookmarks', icon: 'bookmarks', level: 'preview', authenticated: true },
    { path: 'badges', label: 'Badges', icon: 'badge', level: 'beta', authenticated: true },
    // { path: 'relays', label: 'Relays', icon: 'dns', showInMobile: false },
    // { path: 'backup', label: 'Backup', icon: 'archive', showInMobile: false },
    { path: 'settings', label: 'Settings', icon: 'settings' },
    { path: 'premium', label: 'Premium', icon: 'diamond', level: 'preview', authenticated: true },
    // { path: 'about', label: 'About', icon: 'info', showInMobile: true },
    // { path: '', label: 'Logout', icon: 'logout', action: () => this.logout(), showInMobile: false }
  ];

  constructor() {
    this.logger.debug('AppComponent constructor started');

    if ('launchQueue' in window) {
      const launchQueue = (window as any).launchQueue;
      launchQueue.setConsumer((launchParams: any) => {
        if (launchParams.targetURL) {
          console.log('launchParams.targetURL:', launchParams.targetURL);
        }
      });
    }

    if (isPlatformBrowser(this.platform)) {
      console.warn("browser");
      // Safe to use document, window, localStorage, etc. :-)
      // console.log(document);
    }

    if (isPlatformServer(this.platform)) {
      console.warn("server");
      // Not smart to use document here, however, we can inject it ;-)
      // console.log(this.document);
    }

    effect(() => {
      const isHandset = this.layout.isHandset();
      // Close sidenav automatically on mobile screens only
      if (isHandset) {
        this.opened.set(false);
      } else {
        this.opened.set(true);
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

        // debugger;

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


    this.logger.debug('AppComponent constructor completed');

    // Register a one-time callback after the first render
    afterNextRender(() => {
      this.logger.debug('AppComponent first render completed');
    });
  }

  async ngOnInit() {
    this.logger.debug('AppComponent ngOnInit');

    // Initialize storage, then nostr initialized and then app state.
    await this.storage.init();
  }


  qrScan() {
    const dialogRef = this.dialog.open(QrcodeScanDialogComponent, {
      data: { did: '' },
      width: '100vw',
      height: '100vh',
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        console.log('The dialog was closed', result);
        this.layout.toggleSearch();

        if (result.startsWith('bunker://')) {
          await this.nostrService.loginWithNostrConnect(result);
        } else if (result.startsWith('npub:')) {
          this.router.navigate(['/profile', result]);
        }
      }
    });
  }

  toggleSidenav() {
    this.opened.update(value => !value);
  }

  toggleProfileSidenav() {
    this.profileSidenav.toggle();
  }

  toggleMenuSize() {
    this.displayLabels.set(!this.displayLabels());
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

}
