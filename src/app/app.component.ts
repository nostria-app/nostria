import { Component, inject, signal, effect } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ThemeService } from './services/theme.service';
import { PwaUpdateService } from './services/pwa-update.service';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { NostrService } from './services/nostr.service';

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
    MatDialogModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Nostria';
  themeService = inject(ThemeService);
  breakpointObserver = inject(BreakpointObserver);
  pwaUpdateService = inject(PwaUpdateService);
  dialog = inject(MatDialog);
  nostrService = inject(NostrService);

  isHandset = signal(false);
  opened = signal(true);
  displayLabels = signal(true);

  navItems = [
    { path: 'home', label: 'Home', icon: 'home' },
    { path: 'settings', label: 'Settings', icon: 'settings' },
    { path: 'about', label: 'About', icon: 'info' }
  ];

  constructor() {
    // Monitor only mobile devices (not tablets)
    this.breakpointObserver.observe('(max-width: 599px)').subscribe(result => {
      this.isHandset.set(result.matches);
      // Close sidenav automatically on mobile screens only
      if (result.matches) {
        this.opened.set(false);
      } else {
        this.opened.set(true);
      }
    });// Show login dialog if user is not logged in
    effect(() => {
      if (!this.nostrService.isLoggedIn()) {
        // Add a small delay to ensure the app is fully loaded
        setTimeout(() => this.showLoginDialog(), 500);
      }
    });


    // Show login dialog if user is not logged in
    effect(() => {
      if (!this.nostrService.isLoggedIn()) {
        // Add a small delay to ensure the app is fully loaded
        setTimeout(() => this.showLoginDialog(), 500);
      }
    });


    // Show login dialog if user is not logged in
    effect(() => {
      if (!this.nostrService.isLoggedIn()) {
        // Add a small delay to ensure the app is fully loaded
        setTimeout(() => this.showLoginDialog(), 500);
      }
    });
  }

  toggleSidenav() {
    this.opened.update(value => !value);
  }

  toggleMenuSize() {
    this.displayLabels.set(!this.displayLabels());

  }

  showLoginDialog(): void {
    this.dialog.open(LoginDialogComponent, {
      width: '500px',
      disableClose: true
    });
  }
}
