import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule, RouterOutlet, ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { filter } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Title } from '@angular/platform-browser';
import { ApplicationService } from '../../services/application.service';
import { WebRequest } from '../../services/web-request';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  authenticated?: boolean;
  premium?: boolean;
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
    MatDividerModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private breakpointObserver = inject(BreakpointObserver);
  private titleService = inject(Title);
  app = inject(ApplicationService);
  router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  web = inject(WebRequest);
  accountState = inject(AccountStateService);
  private layout = inject(LayoutService);

  // Track active section
  activeSection = signal('general');
  isMobile = signal(false);
  showDetails = signal(false);

  // Define settings sections
  sections: SettingsSection[] = [
    { id: 'general', title: $localize`:@@settings.sections.general:General`, icon: 'settings' },
    { id: 'algorithm', title: $localize`:@@settings.sections.algorithm:Algorithm`, icon: 'model_training' },
    { id: 'relays', title: $localize`:@@settings.sections.relays:Relays`, icon: 'dns', authenticated: true },
    { id: 'search', title: $localize`:@@settings.sections.search:Search`, icon: 'search', authenticated: true },
    {
      id: 'privacy',
      title: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'security',
      authenticated: true,
    },
    { id: 'trust', title: $localize`:@@settings.sections.trust:Trust`, icon: 'verified_user', authenticated: true },
    { id: 'wallet', title: $localize`:@@settings.sections.wallet:Wallet`, icon: 'account_balance_wallet', authenticated: true },
    { id: 'backup', title: $localize`:@@settings.sections.backup:Backup`, icon: 'archive', authenticated: true, premium: true },
    { id: 'premium', title: $localize`:@@settings.sections.premium:Premium`, icon: 'diamond', authenticated: true },
    { id: 'logs', title: $localize`:@@settings.sections.logs:Logs`, icon: 'article', authenticated: false },
    { id: 'about', title: $localize`:@@settings.sections.about:About`, icon: 'info' },
  ];

  constructor() {
    // Check if the screen is mobile-sized
    this.breakpointObserver.observe(['(max-width: 768px)']).subscribe(result => {
      this.isMobile.set(result.matches);
      this.showDetails.set(!result.matches);
    });

    // Listen to route changes to update active section
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      const currentRoute = this.router.url.split('/').pop() || 'general';
      this.activeSection.set(currentRoute);
      // Scroll to top when navigating between settings sections
      this.layout.scrollToTop();
    });

    // Set initial active section
    const currentRoute = this.router.url.split('/').pop() || 'general';
    this.activeSection.set(currentRoute);

    // Update page title based on mobile state and active section
    effect(() => {
      const mobile = this.isMobile();
      const details = this.showDetails();
      const section = this.activeSection();

      // On mobile, when showing menu (not details), show "Settings" as title
      // When showing details or on desktop, show the section title
      if (mobile && !details) {
        this.titleService.setTitle('Settings');
      } else {
        const sectionTitle = this.sections.find(s => s.id === section)?.title || 'Settings';
        this.titleService.setTitle(sectionTitle);
      }
    });
  }

  ngOnInit(): void {
    // Scroll to top when settings page is opened
    this.layout.scrollToTop();
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
}
