import { Component, inject, computed, ElementRef, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, PRIMARY_OUTLET } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatRippleModule } from '@angular/material/core';
import { MatCardModule } from '@angular/material/card';
import { SettingsRegistryService, SettingsItem, SettingsSection } from '../../../services/settings-registry.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { LoggerService } from '../../../services/logger.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { LayoutService } from '../../../services/layout.service';
import { getSettingComponent } from '../sections/settings-components.map';
import { getSettingsSectionComponent } from '../settings-section-components.map';

type RelaySettingsTab = 'account' | 'discovery' | 'observed';

const RELAY_SETTINGS_ROUTE_TABS: Record<string, RelaySettingsTab> = {
  'account-relays': 'account',
  'dm-relays': 'account',
  'discovery-relays': 'discovery',
  'observed-relays': 'observed',
};

const ROUTED_SETTINGS_ITEM_IDS = new Set([
  'account-relays',
  'dm-relays',
  'discovery-relays',
  'observed-relays',
  'search-relays',
  'app-logs',
  'simulate-platform',
]);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-settings-home',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatDividerModule,
    MatRippleModule,
    MatCardModule,
    NgComponentOutlet,
  ],
  template: `
    <div class="settings-home">
      <!-- Search Section -->
      <div class="search-section">
        <mat-form-field appearance="outline" class="search-field">
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            #searchInput
            type="text"
            [placeholder]="searchPlaceholder"
            [ngModel]="registry.searchQuery()"
            (ngModelChange)="registry.setSearchQuery($event)"
            (keydown.escape)="clearSearch()"
          />
          @if (registry.isSearching()) {
            <button mat-icon-button matSuffix (click)="clearSearch()" [attr.aria-label]="clearLabel">
              <mat-icon>close</mat-icon>
            </button>
          }
        </mat-form-field>
      </div>

      <!-- Search Results - Inline Components -->
      @if (registry.isSearching()) {
        <div class="search-results">
          @if (searchResultComponents().length > 0) {
            <!-- Render matching setting components inline -->
            @for (result of searchResultComponents(); track result.item.id) {
              @if (canShowItem(result.item)) {
                <mat-card class="setting-result-card" appearance="outlined">
                  <mat-card-header>
                    <mat-icon mat-card-avatar>{{ result.item.icon }}</mat-icon>
                    <mat-card-title>{{ result.item.title }}</mat-card-title>
                    <mat-card-subtitle>
                      <span class="section-badge">{{ result.item.sectionTitle }}</span>
                    </mat-card-subtitle>
                  </mat-card-header>
                  <mat-card-content>
                    @if (result.component) {
                      <ng-container *ngComponentOutlet="result.component" />
                    } @else {
                      <!-- Fallback for items without dedicated components -->
                      <div class="fallback-link">
                        <p class="item-description">{{ result.item.description }}</p>
                        <button mat-stroked-button (click)="navigateToItem(result.item)">
                          <mat-icon>open_in_new</mat-icon>
                          @if (result.item.id === 'media-servers') {
                            <span>Manage Servers</span>
                          } @else {
                            <span i18n="@@settings.home.open-settings">Open Settings</span>
                          }
                        </button>
                      </div>
                    }
                  </mat-card-content>
                </mat-card>
              }
            }
          } @else if (registry.hasSearchResults()) {
            <!-- Items found but no matching components - show list fallback -->
            <h3 class="section-title" i18n="@@settings.home.search-results">Search Results</h3>
            <mat-nav-list>
              @for (item of filteredItems(); track item.id) {
                @if (canShowItem(item)) {
                  <a mat-list-item (click)="navigateToItem(item)" (keydown.enter)="navigateToItem(item)" tabindex="0" class="settings-item">
                    <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                    <div matListItemTitle>{{ item.title }}</div>
                    <div matListItemLine class="item-meta">
                      <span class="section-badge">{{ item.sectionTitle }}</span>
                      @if (item.description) {
                        <span class="item-description">{{ item.description }}</span>
                      }
                    </div>
                  </a>
                }
              }
            </mat-nav-list>
          } @else {
            <div class="no-results">
              <mat-icon>search_off</mat-icon>
              <p i18n="@@settings.home.no-results">No settings found for "{{ registry.searchQuery() }}"</p>
            </div>
          }
        </div>
      } @else {
        <!-- All Categories -->
        <div class="categories-section">
          <mat-nav-list>
            @for (section of visibleSections(); track section.id) {
              <a mat-list-item (click)="navigateToSection(section)" (keydown.enter)="navigateToSection(section)" tabindex="0" class="section-item">
                <mat-icon matListItemIcon>{{ section.icon }}</mat-icon>
                <div matListItemTitle>{{ section.title }}</div>
              </a>
            }
          </mat-nav-list>
        </div>
      }
    </div>
  `,
  styles: [`
    .settings-home {
      padding: 16px;
      width: 100%;
      box-sizing: border-box;

      @media (max-width: 768px) {
        padding-bottom: 72px;
      }
    }

    .search-section {
      margin-bottom: 16px;
    }

    .search-field {
      width: 100%;

      mat-icon[matPrefix] {
        margin-right: 8px;
        color: var(--mat-sys-on-surface-variant);
      }

      ::ng-deep .mat-mdc-form-field-infix {
        min-height: 40px;
      }

      input[matInput] {
        min-height: 40px;
        font-size: 16px;
      }
    }

    .section-title {
      margin: 16px 0 8px;
      padding: 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .settings-item, .section-item {
      border-radius: var(--mat-sys-corner-medium);
      margin-bottom: 4px;

      &:hover {
        background-color: var(--mat-sys-surface-container-high);
      }
    }

    .item-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .section-badge {
      font-size: 0.75rem;
      color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
      padding: 2px 8px;
      border-radius: var(--mat-sys-corner-full);
      width: fit-content;
    }

    .item-description {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .no-results {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      p {
        text-align: center;
      }
    }

    mat-divider {
      margin: 16px 0;
    }

    .setting-result-card {
      margin-bottom: 16px;
      border-radius: var(--mat-sys-corner-large);

      mat-card-header {
        padding: 12px 16px 8px;

        mat-icon[mat-card-avatar] {
          color: var(--mat-sys-primary);
        }
      }

      mat-card-content {
        padding: 0 16px 16px;
      }

      .section-badge {
        font-size: 0.75rem;
        color: var(--mat-sys-primary);
        background: var(--mat-sys-primary-container);
        padding: 2px 8px;
        border-radius: var(--mat-sys-corner-full);
      }
    }

    .fallback-link {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .item-description {
        color: var(--mat-sys-on-surface-variant);
        margin: 0;
      }

      button {
        align-self: flex-start;
      }
    }
  `],
})
export class SettingsHomeComponent {
  readonly registry = inject(SettingsRegistryService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  private readonly logger = inject(LoggerService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly layout = inject(LayoutService);

  searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  searchPlaceholder = $localize`:@@settings.home.search-placeholder:Search settings...`;
  clearLabel = $localize`:@@settings.home.clear-search:Clear search`;

  constructor() {
    // Subscribe to route param changes for deep linking and section-to-section navigation.
    this.route.paramMap.pipe(
      takeUntilDestroyed()
    ).subscribe(params => {
      const routeId = params.get('section');

      if (routeId) {
        void this.openSettingsRoute(routeId);
      } else {
        // Close right panel when returning to settings home (e.g., browser back)
        this.rightPanel.close();
        setTimeout(() => this.searchInput()?.nativeElement?.focus(), 100);
      }
    });
  }

  // Computed signals
  filteredItems = computed(() => this.registry.filteredItems());

  /**
   * Maps filtered items to their components for inline rendering.
   * Only returns items that have a dedicated component.
   */
  searchResultComponents = computed(() => {
    const items = this.filteredItems();
    return items.map(item => ({
      item,
      component: getSettingComponent(item.id),
    }));
  });

  visibleSections = computed(() => {
    const authenticated = this.app.authenticated();
    const hasPremium = this.accountState.hasActiveSubscription();

    return this.registry.sections.filter(section => {
      if (section.premium && !hasPremium) return false;
      if (section.authenticated && !authenticated) return false;
      return true;
    });
  });

  canShowItem(item: SettingsItem): boolean {
    const authenticated = this.app.authenticated();
    const hasPremium = this.accountState.hasActiveSubscription();

    if (item.premium && !hasPremium) return false;
    if (item.authenticated && !authenticated) return false;
    return true;
  }

  /**
   * Opens a settings route in the right panel.
   * URL is managed by Angular Router (navigating to /settings/:section),
   * while the panel content is still component-based.
   */
  async openSettingsRoute(routeId: string): Promise<void> {
    if (routeId === 'wallet') {
      void this.router.navigate(['/wallet']);
      return;
    }

    if (routeId === 'premium') {
      void this.router.navigate(['/accounts'], { queryParams: { tab: 'premium' } });
      return;
    }

    if (routeId === 'profile') {
      await this.openProfileEditorInRightPanel();
      return;
    }

    if (routeId === 'wallet-subscriptions') {
      await this.openWalletInRightPanel();
      return;
    }

    const relayTab = RELAY_SETTINGS_ROUTE_TABS[routeId];
    if (relayTab) {
      await this.openLazySettingsComponent('relays', this.getItemTitle(routeId), { tab: relayTab });
      return;
    }

    if (routeId === 'search-relays') {
      await this.openLazySettingsComponent('search', this.getItemTitle(routeId));
      return;
    }

    if (routeId === 'app-logs') {
      await this.openLazySettingsComponent('logs', this.getItemTitle(routeId));
      return;
    }

    if (routeId === 'simulate-platform') {
      await this.openLazySettingsComponent('debug', this.getItemTitle(routeId));
      return;
    }

    if (routeId === 'delete-event') {
      await this.openLazySettingsComponent('delete-event', $localize`:@@settings.privacy.event-management.delete-event:Delete Specific Event`);
      return;
    }

    if (routeId === 'delete-account') {
      await this.openLazySettingsComponent(
        'delete-account',
        $localize`:@@settings.privacy.event-management.delete-account:Delete All Account Data`,
        { source: this.route.snapshot.queryParamMap.get('source') ?? undefined }
      );
      return;
    }

    const settingComponent = getSettingComponent(routeId);
    if (settingComponent) {
      await this.openResolvedSettingsComponent(settingComponent, this.getItemTitle(routeId));
      return;
    }

    await this.openLazySettingsComponent(routeId, this.getRouteTitle(routeId));
  }

  private async openLazySettingsComponent(
    componentId: string,
    title: string,
    inputs?: Record<string, unknown>
  ): Promise<void> {
    const componentLoader = getSettingsSectionComponent(componentId);
    if (!componentLoader) {
      this.logger.warn(`No settings component route found for: ${componentId}`);
      return;
    }

    try {
      await this.clearRouterRightPanelIfNeeded();

      const component = await componentLoader();
      await this.openResolvedSettingsComponent(component, title, inputs);
    } catch (error) {
      this.logger.error(`Failed to load settings component: ${componentId}`, error);
    }
  }

  private async openResolvedSettingsComponent(
    component: NonNullable<ReturnType<typeof getSettingComponent>>,
    title: string,
    inputs?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.clearRouterRightPanelIfNeeded();

      this.rightPanel.clearHistory();
      this.rightPanel.open({
        component,
        title,
        inputs,
        useBrowserHistory: true,
      });
      this.scheduleScrollReset();
    } catch (error) {
      this.logger.error(`Failed to open settings component: ${title}`, error);
    }
  }

  async navigateToItem(item: SettingsItem): Promise<void> {
    const routeId = this.getSettingsRouteIdForItem(item);
    if (routeId) {
      await this.navigateToSettingsRoute(routeId);
      return;
    }

    this.rightPanel.close();
    await this.router.navigateByUrl(item.route);
  }

  async navigateToSection(section: SettingsSection): Promise<void> {
    await this.navigateToSettingsRoute(section.id);
  }

  clearSearch(): void {
    this.registry.clearSearch();
    this.searchInput()?.nativeElement?.focus();
  }

  private scheduleScrollReset(): void {
    requestAnimationFrame(() => {
      this.layout.scrollToTop('.right-panel');

      if (this.layout.isHandset()) {
        this.layout.scrollToTop('.left-panel');
      }
    });
  }

  private async openWalletInRightPanel(): Promise<void> {
    try {
      await this.clearRouterRightPanelIfNeeded();

      const { WalletComponent } = await import('../../wallet/wallet.component');
      this.rightPanel.clearHistory();
      this.rightPanel.open({
        component: WalletComponent,
        title: $localize`:@@settings.sections.wallet-subscriptions:Wallet & subscriptions`,
        useBrowserHistory: true,
      });
      this.scheduleScrollReset();
    } catch (error) {
      this.logger.error('Failed to load wallet settings panel', error);
    }
  }

  private async openProfileEditorInRightPanel(): Promise<void> {
    try {
      await this.clearRouterRightPanelIfNeeded();

      const { ProfileEditComponent } = await import('../../profile/profile-edit/profile-edit.component');
      await this.openResolvedSettingsComponent(
        ProfileEditComponent,
        $localize`:@@settings.profile.edit:Edit Profile`
      );
    } catch (error) {
      this.logger.error('Failed to load profile edit settings panel', error);
    }
  }

  private async clearRouterRightPanelIfNeeded(): Promise<void> {
    const tree = this.router.parseUrl(this.router.url);
    if (!tree.root.children['right']) {
      return;
    }

    const primaryPath = tree.root.children[PRIMARY_OUTLET]?.toString() ?? '';
    const commands = primaryPath ? ['/', ...primaryPath.split('/')] : ['/'];
    const targetTree = this.router.createUrlTree(commands, {
      queryParams: tree.queryParams,
      fragment: tree.fragment ?? undefined,
    });

    await this.router.navigateByUrl(targetTree, { replaceUrl: true });
  }

  private async navigateToSettingsRoute(routeId: string): Promise<void> {
    if (this.route.snapshot.paramMap.get('section') === routeId) {
      await this.openSettingsRoute(routeId);
      return;
    }

    await this.router.navigate(['/settings', routeId]);
  }

  private getSettingsRouteIdForItem(item: SettingsItem): string | null {
    if (getSettingComponent(item.id) || ROUTED_SETTINGS_ITEM_IDS.has(item.id)) {
      return item.id;
    }

    return item.route.match(/\/settings\/([^?#/]+)/)?.[1] ?? null;
  }

  private getRouteTitle(routeId: string): string {
    return this.registry.sections.find(section => section.id === routeId)?.title
      ?? this.getItemTitle(routeId);
  }

  private getItemTitle(routeId: string): string {
    return this.registry.items.find(item => item.id === routeId)?.title
      ?? $localize`:@@settings.title:Settings`;
  }
}
