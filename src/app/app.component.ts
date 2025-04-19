import { Component, inject, signal, effect, ViewChild, OnInit, afterNextRender, computed } from '@angular/core';
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
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { NostrService } from './services/nostr.service';
import { LoadingOverlayComponent } from './components/loading-overlay/loading-overlay.component';
import { LoggerService } from './services/logger.service';
import { MatMenuModule } from '@angular/material/menu';
import { FormGroup, FormsModule } from '@angular/forms';
import { StorageService } from './services/storage.service';
import { NostrEventData, UserMetadata } from './services/storage.service';
import { LayoutService } from './services/layout.service';
import { ApplicationStateService } from './services/application-state.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { QrcodeScanDialogComponent } from './components/qrcode-scan-dialog/qrcode-scan-dialog.component';
import { ApplicationService } from './services/application.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  showInMobile: boolean;
  action?: () => void;
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
    LoadingOverlayComponent,
    FormsModule,
    MatFormFieldModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
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

  private logger = inject(LoggerService);

  @ViewChild('profileSidenav') profileSidenav!: MatSidenav;

  opened = signal(true);
  displayLabels = signal(true);

  // We'll compute the current user metadata from the nostrService's metadata array
  accountMetadata = computed(() => {
    const pubkey = this.nostrService.activeAccount()?.pubkey;
    if (!pubkey) return undefined;

    // First check from accountsMetadata (which should be synchronized)
    const metadata = this.nostrService.getMetadataForAccount(pubkey);
    return metadata;
  });

  navItems: NavItem[] = [
    { path: 'home', label: 'Home', icon: 'home', showInMobile: true },
    { path: 'relays', label: 'Relays', icon: 'dns', showInMobile: false },
    { path: 'media', label: 'Media', icon: 'photo_library', showInMobile: false },
    { path: 'backup', label: 'Backup', icon: 'archive', showInMobile: false },
    { path: 'settings', label: 'Settings', icon: 'settings', showInMobile: true },
    { path: 'premium', label: 'Premium', icon: 'diamond', showInMobile: false },
    { path: 'about', label: 'About', icon: 'info', showInMobile: true },
    // { path: '', label: 'Logout', icon: 'logout', action: () => this.logout(), showInMobile: false }
  ];

  constructor() {
    this.logger.debug('AppComponent constructor started');

    effect(() => {
      const isHandset = this.layout.isHandset();
      // Close sidenav automatically on mobile screens only
      if (isHandset) {
        this.opened.set(false);
      } else {
        this.opened.set(true);
      }
    });

    // Show login dialog if user is not logged in - with debugging
    effect(() => {
      const isLoggedIn = this.nostrService.isLoggedIn();
      const isInitialized = this.app.initialized();

      if (isInitialized && !isLoggedIn) {
        this.logger.debug('Showing login dialog');
        this.showLoginDialog();
      } else if (isInitialized && isLoggedIn) {
        const user = this.nostrService.activeAccount();

        // Whenever the user changes, ensure that we have the correct relays
        if (user) {
          this.logger.debug('User changed, updating relays', { pubkey: user.pubkey });
          
          // Data load will happen automatically in nostr service.
          //this.dataLoadingService.loadData();

          // Also load the user metadata for the profile panel
          // this.nostrService.loadAllUsersMetadata().catch(err => 
          //   this.logger.error('Failed to load metadata after user change', err));
        } else {
          this.logger.debug('No user logged in, not updating relays');
        }
      }
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
    effect(() => {
      const currentUser = this.nostrService.activeAccount();
      const isInitialized = this.app.initialized();

      if (currentUser && isInitialized && this.storage.initialized()) {
        // Ensure we have the latest metadata for the current user
        // this.nostrService.loadUsersMetadata().catch(err =>
        //   this.logger.error('Failed to load user metadata on user change', err));
      }
    });

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

  async logout(): Promise<void> {
    this.nostrService.logout();
  }

  async switchAccount(pubkey: string): Promise<void> {
    if (this.nostrService.switchToUser(pubkey)) {
      // Close sidenav on mobile after switching
      if (this.layout.isHandset()) {
        this.toggleSidenav();
      }
    }
  }

  async showLoginDialog(): Promise<void> {
    this.logger.debug('showLoginDialog called');
    // Apply the blur class to the document body before opening the dialog
    document.body.classList.add('blur-backdrop');

    const dialogRef = this.dialog.open(LoginDialogComponent, {
      width: '500px',
      disableClose: true,
    });

    this.logger.debug('Login dialog opened');

    // Handle login completion and data loading
    dialogRef.afterClosed().subscribe(async () => {
      this.logger.debug('Login dialog closed');
      document.body.classList.remove('blur-backdrop');

      // If user is logged in after dialog closes, simulate data loading
      if (this.nostrService.isLoggedIn()) {
        this.logger.debug('User logged in, loading data');
      } else {
        this.logger.debug('User not logged in after dialog closed');
      }
    });
  }
}
