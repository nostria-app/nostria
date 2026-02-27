import { Component, inject, OnInit, OnDestroy, computed, ElementRef, viewChild } from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
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
import { getSettingComponent } from '../sections/settings-components.map';
import { getSettingsSectionComponent } from '../settings-section-components.map';

@Component({
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
        <!-- Popular Settings -->
        <div class="popular-section">
          <h3 class="section-title" i18n="@@settings.home.popular">Popular Settings</h3>
          <mat-nav-list>
            @for (item of popularItems(); track item.id) {
              @if (canShowItem(item)) {
                <a mat-list-item (click)="navigateToItem(item)" (keydown.enter)="navigateToItem(item)" tabindex="0" class="settings-item">
                  <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                  <div matListItemTitle>{{ item.title }}</div>
                  <div matListItemLine class="item-description">{{ item.description }}</div>
                </a>
              }
            }
          </mat-nav-list>
        </div>

        <mat-divider></mat-divider>

        <!-- All Categories -->
        <div class="categories-section">
          <h3 class="section-title" i18n="@@settings.home.categories">Categories</h3>
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
export class SettingsHomeComponent implements OnInit, OnDestroy {
  readonly registry = inject(SettingsRegistryService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  private readonly logger = inject(LoggerService);
  private readonly rightPanel = inject(RightPanelService);

  searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  searchPlaceholder = $localize`:@@settings.home.search-placeholder:Search settings...`;
  clearLabel = $localize`:@@settings.home.clear-search:Clear search`;

  // Computed signals
  filteredItems = computed(() => this.registry.filteredItems());
  popularItems = computed(() => this.registry.popularItems());

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

  ngOnInit(): void {
    // Handle URL-based section opening for deep linking
    const sectionId = this.route.snapshot.paramMap.get('section');
    if (sectionId && !this.rightPanel.hasContent()) {
      this.openSectionInRightPanel(sectionId);
    }

    // Focus search input on init (only if no section is open)
    if (!sectionId) {
      setTimeout(() => {
        this.searchInput()?.nativeElement?.focus();
      }, 100);
    }
  }

  ngOnDestroy(): void {
    // Component cleanup - no panel actions to clear anymore
  }

  canShowItem(item: SettingsItem): boolean {
    const authenticated = this.app.authenticated();
    const hasPremium = this.accountState.hasActiveSubscription();

    if (item.premium && !hasPremium) return false;
    if (item.authenticated && !authenticated) return false;
    return true;
  }

  /**
   * Opens a settings section in the right panel.
   * NOTE: We intentionally do NOT pass the section.route URL to rightPanel.open()
   * because using window.history.pushState to change the URL without Angular Router
   * knowing about it causes the router state tree to get corrupted. When the user
   * navigates away and back to settings, Angular's setRouterState enters infinite
   * recursion trying to reconcile the browser URL with its internal state.
   * See: https://github.com/angular/angular/issues - Maximum call stack size exceeded
   */
  async openSectionInRightPanel(sectionId: string): Promise<void> {
    const section = this.registry.sections.find(s => s.id === sectionId);
    if (!section) return;

    const componentLoader = getSettingsSectionComponent(sectionId);
    if (!componentLoader) return;

    try {
      const component = await componentLoader();
      this.rightPanel.open({
        component,
        title: section.title,
      });
    } catch (error) {
      this.logger.error(`Failed to load settings section component: ${sectionId}`, error);
    }
  }

  async navigateToItem(item: SettingsItem): Promise<void> {
    // Extract section from route (e.g., /settings/general -> general)
    const sectionMatch = item.route.match(/\/settings\/([^?#/]+)/);
    if (sectionMatch && sectionMatch[1]) {
      await this.openSectionInRightPanel(sectionMatch[1]);
      return;
    }

    this.rightPanel.close();
    await this.router.navigateByUrl(item.route);
  }

  async navigateToSection(section: SettingsSection): Promise<void> {
    await this.openSectionInRightPanel(section.id);
  }

  clearSearch(): void {
    this.registry.clearSearch();
    this.searchInput()?.nativeElement?.focus();
  }
}
