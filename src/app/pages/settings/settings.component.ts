import { Component, inject, signal, effect, OnInit, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule, RouterOutlet, ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
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
  keywords?: string[];
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
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
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
  searchQuery = signal('');

  // Define settings sections with searchable keywords
  sections: SettingsSection[] = [
    { 
      id: 'general', 
      title: $localize`:@@settings.sections.general:General`, 
      icon: 'settings',
      keywords: ['general', 'dark mode', 'theme', 'language', 'locale', 'relays', 'max relays', 'authentication', 'auto relay auth', 'client tags', 'media', 'blur', 'privacy', 'calendar', 'time format', 'short form', 'autoplay', 'repeat', 'placeholder', 'external links', 'domains', 'event expiration', 'emoji', 'cache', 'wipe data', 'delete', 'storage']
    },
    { 
      id: 'algorithm', 
      title: $localize`:@@settings.sections.algorithm:Algorithm`, 
      icon: 'model_training',
      keywords: ['algorithm', 'feed', 'ranking', 'scoring', 'sort', 'filter', 'boost', 'penalty', 'weights', 'engagement', 'personalization']
    },
    { 
      id: 'relays', 
      title: $localize`:@@settings.sections.relays:Relays`, 
      icon: 'dns', 
      authenticated: true,
      keywords: ['relays', 'connections', 'servers', 'websocket', 'nip-65', 'relay list', 'user relays', 'discovery relays', 'bootstrap', 'inbox', 'outbox', 'dm relays', 'messaging', 'relay info', 'ping', 'latency', 'status', 'authentication', 'cleanup']
    },
    { 
      id: 'search', 
      title: $localize`:@@settings.sections.search:Search`, 
      icon: 'search', 
      authenticated: true,
      keywords: ['search', 'index', 'elasticsearch', 'find', 'query', 'lookup', 'discover']
    },
    {
      id: 'privacy',
      title: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'security',
      authenticated: true,
      keywords: ['privacy', 'safety', 'security', 'mute', 'block', 'hide', 'filter', 'reports', 'nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'image cache', 'social sharing', 'preview', 'tracking', 'parameters', 'trusted media', 'delete account', 'delete event', 'muted words', 'muted tags', 'muted threads', 'muted accounts']
    },
    { 
      id: 'trust', 
      title: $localize`:@@settings.sections.trust:Trust`, 
      icon: 'verified_user', 
      authenticated: true,
      keywords: ['trust', 'web of trust', 'wot', 'reputation', 'score', 'trusted', 'follows', 'network', 'verification']
    },
    { 
      id: 'wallet', 
      title: $localize`:@@settings.sections.wallet:Wallet`, 
      icon: 'account_balance_wallet', 
      authenticated: true,
      keywords: ['wallet', 'lightning', 'bitcoin', 'zap', 'payments', 'nwc', 'nostr wallet connect', 'alby', 'balance', 'transactions', 'lightning address', 'lnurl']
    },
    { 
      id: 'backup', 
      title: $localize`:@@settings.sections.backup:Backup`, 
      icon: 'archive', 
      authenticated: true, 
      premium: true,
      keywords: ['backup', 'restore', 'export', 'import', 'data', 'download', 'save', 'recovery', 'archive']
    },
    { 
      id: 'premium', 
      title: $localize`:@@settings.sections.premium:Premium`, 
      icon: 'diamond', 
      authenticated: true,
      keywords: ['premium', 'subscription', 'paid', 'features', 'upgrade', 'pro', 'benefits', 'support']
    },
    { 
      id: 'logs', 
      title: $localize`:@@settings.sections.logs:Logs`, 
      icon: 'article', 
      authenticated: false,
      keywords: ['logs', 'debug', 'console', 'errors', 'warnings', 'diagnostics', 'troubleshooting', 'developer']
    },
    { 
      id: 'about', 
      title: $localize`:@@settings.sections.about:About`, 
      icon: 'info',
      keywords: ['about', 'version', 'info', 'information', 'app', 'nostria', 'credits', 'license', 'terms', 'privacy policy', 'contact', 'support', 'help']
    },
  ];

  // Filtered sections based on search query
  filteredSections = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    
    if (!query) {
      return this.sections;
    }

    return this.sections.filter(section => {
      // Search in title
      if (section.title.toLowerCase().includes(query)) {
        return true;
      }
      
      // Search in keywords
      if (section.keywords?.some(keyword => keyword.toLowerCase().includes(query))) {
        return true;
      }
      
      return false;
    });
  });

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

  clearSearch(): void {
    this.searchQuery.set('');
  }
}
