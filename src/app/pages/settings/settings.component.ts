import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { filter } from 'rxjs/operators';
import { LayoutService } from '../../services/layout.service';
import { PanelActionsService } from '../../services/panel-actions.service';
import { SettingsRegistryService, SettingsItem, SettingsSection } from '../../services/settings-registry.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';

@Component({
  selector: 'app-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterModule,
    RouterOutlet,
    MatListModule,
    MatDividerModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly panelActions = inject(PanelActionsService);
  readonly registry = inject(SettingsRegistryService);
  private readonly accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);

  /** Current active section from URL */
  activeSection = signal<string>('');

  /** Whether we're on the home/root settings page */
  isHome = computed(() => {
    const section = this.activeSection();
    return !section || section === 'settings';
  });

  /** Visible sections based on auth state */
  visibleSections = computed(() => {
    const authenticated = this.app.authenticated();
    const hasPremium = this.accountState.hasActiveSubscription();

    return this.registry.sections.filter(section => {
      if (section.premium && !hasPremium) return false;
      if (section.authenticated && !authenticated) return false;
      return true;
    });
  });

  constructor() {
    // Listen to route changes to update active section
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      this.updateActiveSection();
      this.layout.scrollToTop();
    });

    // Set initial active section
    this.updateActiveSection();
  }

  private updateActiveSection(): void {
    const url = this.router.url;
    const parts = url.split('/');
    // URL like /settings/general -> parts = ['', 'settings', 'general']
    const section = parts.length > 2 ? parts[2].split('?')[0] : '';
    this.activeSection.set(section);
  }

  ngOnInit(): void {
    this.layout.scrollToTop();
  }

  ngOnDestroy(): void {
    this.panelActions.clearLeftPanelActions();
    this.panelActions.clearPageTitle();
  }

  navigateToSection(section: SettingsSection): void {
    this.router.navigateByUrl(section.route);
  }

  navigateToItem(item: SettingsItem): void {
    this.router.navigateByUrl(item.route);
  }

  navigateHome(): void {
    this.router.navigate(['/settings']);
  }

  canShowItem(item: SettingsItem): boolean {
    const authenticated = this.app.authenticated();
    const hasPremium = this.accountState.hasActiveSubscription();

    if (item.premium && !hasPremium) return false;
    if (item.authenticated && !authenticated) return false;
    return true;
  }

  clearSearch(): void {
    this.registry.clearSearch();
  }
}
