import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { ThemeService } from './services/theme.service';

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
    MatListModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Nostria';
  themeService = inject(ThemeService);
  breakpointObserver = inject(BreakpointObserver);

  isHandset = signal(false);
  opened = signal(true);

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
    });
  }

  toggleSidenav() {
    this.opened.update(value => !value);
  }
}
