import { Component, inject, signal, effect, ViewChild, OnInit, afterNextRender } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
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
import { DataLoadingService } from './services/data-loading.service';
import { LoggerService } from './services/logger.service';
import { MatMenuModule } from '@angular/material/menu';
import { FormGroup } from '@angular/forms';

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
    LoadingOverlayComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'Nostria';
  themeService = inject(ThemeService);
  breakpointObserver = inject(BreakpointObserver);
  pwaUpdateService = inject(PwaUpdateService);
  dialog = inject(MatDialog);
  nostrService = inject(NostrService);
  dataLoadingService = inject(DataLoadingService);
  private logger = inject(LoggerService);

  @ViewChild('profileSidenav') profileSidenav!: MatSidenav;

  isHandset = signal(false);
  opened = signal(true);
  displayLabels = signal(true);

  navItems: NavItem[] = [
    { path: 'home', label: 'Home', icon: 'home', showInMobile: true },
    { path: 'settings', label: 'Settings', icon: 'settings', showInMobile: true },
    { path: 'relays', label: 'Relays', icon: 'dns', showInMobile: false },
    { path: 'about', label: 'About', icon: 'info', showInMobile: true },
    // { path: '', label: 'Logout', icon: 'logout', action: () => this.logout(), showInMobile: false }
  ];

  constructor() {
    this.logger.debug('AppComponent constructor started');

    // Monitor only mobile devices (not tablets)
    this.breakpointObserver.observe('(max-width: 599px)').subscribe(result => {
      this.logger.debug('Breakpoint observer update', { isMobile: result.matches });
      this.isHandset.set(result.matches);
      // Close sidenav automatically on mobile screens only
      if (result.matches) {
        this.opened.set(false);
      } else {
        this.opened.set(true);
      }
    });

    // Show login dialog if user is not logged in - with debugging
    effect(() => {
      const isLoggedIn = this.nostrService.isLoggedIn();
      this.logger.debug('Login status effect triggered', { isLoggedIn });

      if (!isLoggedIn) {
        this.logger.debug('Showing login dialog');
        this.showLoginDialog();
      }
    });

    this.logger.debug('AppComponent constructor completed');

    // Register a one-time callback after the first render
    afterNextRender(() => {
      this.logger.debug('AppComponent first render completed');
    });
  }

  ngOnInit(): void {
    this.logger.debug('AppComponent ngOnInit');


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
      if (this.isHandset()) {
        this.toggleSidenav();
      }

      debugger;
      // Load data for the switched account
      await this.dataLoadingService.loadData();
    }
  }

  getTruncatedNpub(pubkey: string): string {
    const npub = this.nostrService.getNpubFromPubkey(pubkey);
    // Show first 6 and last 6 characters
    return npub.length > 12
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
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
        debugger;
        await this.dataLoadingService.loadData();
      } else {
        this.logger.debug('User not logged in after dialog closed');
      }
    });
  }
}
