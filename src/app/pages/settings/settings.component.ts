import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule, RouterOutlet, ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { filter } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ApplicationService } from '../../services/application.service';
import { WebRequest } from '../../services/web-request';
import { AccountStateService } from '../../services/account-state.service';

interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  authenticated?: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    RouterModule,
    RouterOutlet,
    MatListModule,
    MatDividerModule
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private breakpointObserver = inject(BreakpointObserver);
  app = inject(ApplicationService);
  router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  web = inject(WebRequest);
  accountState = inject(AccountStateService);

  // Track active section
  activeSection = signal('general');
  isMobile = signal(false);
  showDetails = signal(false);

  // Define settings sections
  sections: SettingsSection[] = [
    { id: 'general', title: 'General', icon: 'settings' },
    { id: 'algorithm', title: 'Algorithm', icon: 'model_training' },
    { id: 'relays', title: 'Relays', icon: 'dns', authenticated: true },
    { id: 'privacy', title: 'Privacy & Safety', icon: 'security', authenticated: true },
    { id: 'backup', title: 'Backup', icon: 'archive', authenticated: true },
    { id: 'premium', title: 'Premium', icon: 'diamond', authenticated: true },
    { id: 'logs', title: 'Logs', icon: 'article', authenticated: true },
    { id: 'about', title: 'About', icon: 'info' }
  ];

  constructor() {
    // Check if the screen is mobile-sized
    this.breakpointObserver.observe(['(max-width: 768px)']).subscribe(result => {
      this.isMobile.set(result.matches);
      this.showDetails.set(!result.matches);
    });

    // Listen to route changes to update active section
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      const currentRoute = this.router.url.split('/').pop() || 'general';
      this.activeSection.set(currentRoute);
    });

    // Set initial active section
    const currentRoute = this.router.url.split('/').pop() || 'general';
    this.activeSection.set(currentRoute);
  }

  selectSection(sectionId: string): void {
    this.router.navigate(['/settings', sectionId]);

    if (this.isMobile()) {
      this.showDetails.set(true);
    }
  }

  goBack(): void {
    if (this.isMobile()) {
      this.showDetails.set(false);
      this.router.navigate(['/settings']);
    }
  }

  getTitle() {
    return this.sections.find(section => section.id === this.activeSection())?.title || 'Settings';
  }

  async loadSettings() {
    const result = await this.web.fetchJson(`http://localhost:3000/api/settings/${this.accountState.pubkey()}`, { method: 'GET' }, { kind: 27235 });
    console.log('Loaded settings:', result);
  }

  async saveSettings() {
    const settings = {
      releaseChannel: "alpha",
      socialSharing: true
    };

    const json = JSON.stringify(settings);

    const result = await this.web.fetchJson(`http://localhost:3000/api/settings/${this.accountState.pubkey()}`, { method: 'POST', body: json }, { kind: 27235 });
    console.log('Loaded settings:', result);
  }

}
