import { Component, input, output, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { Router } from '@angular/router';
import { PeopleFilters } from '../../../services/account-local-state.service';
import { TrustProviderService } from '../../../services/trust-provider.service';

// Sort option type
type SortOption = 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc' | 'name-asc' | 'name-desc';

/**
 * Sort option definition
 */
interface SortOptionDef {
  id: SortOption;
  label: string;
  icon: string;
}

/**
 * All available sort options
 */
const SORT_OPTIONS: SortOptionDef[] = [
  { id: 'default', label: 'Default', icon: 'format_list_numbered' },
  { id: 'name-asc', label: 'Name (A-Z)', icon: 'sort_by_alpha' },
  { id: 'name-desc', label: 'Name (Z-A)', icon: 'sort_by_alpha' },
  { id: 'trust-desc', label: 'Trust (High)', icon: 'verified' },
  { id: 'trust-asc', label: 'Trust (Low)', icon: 'verified' },
];

@Component({
  selector: 'app-people-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
  ],
  template: `
    <div class="filter-panel" role="dialog" aria-label="Filter and sort options">
      <!-- Sort Options -->
      <div class="section-label">Sort By</div>
      <div class="sort-options-grid" role="radiogroup" aria-label="Sort options">
        @for (option of sortOptions; track option.id) {
          <button
            class="sort-option-chip"
            [class.selected]="currentSortOption() === option.id"
            [attr.aria-pressed]="currentSortOption() === option.id"
            (click)="selectSortOption(option.id)">
            <span class="chip-label">{{ option.label }}</span>
          </button>
        }
      </div>

      <mat-divider></mat-divider>

      <!-- Filter Options -->
      <div class="section-label">Filters</div>
      <div class="filter-options">
        <mat-checkbox
          [checked]="filters()?.hasRelayList ?? false"
          (change)="onFilterChange('hasRelayList', $event.checked)">
          Has Relay List
        </mat-checkbox>
        <mat-checkbox
          [checked]="filters()?.hasFollowingList ?? false"
          (change)="onFilterChange('hasFollowingList', $event.checked)">
          Has Following List
        </mat-checkbox>
        <mat-checkbox
          [checked]="filters()?.hasNip05 ?? false"
          (change)="onFilterChange('hasNip05', $event.checked)">
          NIP-05 Verified
        </mat-checkbox>
        <mat-checkbox
          [checked]="filters()?.favoritesOnly ?? false"
          (change)="onFilterChange('favoritesOnly', $event.checked)">
          Favorites Only
        </mat-checkbox>
        @if (isCachedListSelected()) {
        <mat-checkbox
          [checked]="filters()?.hideFollowing ?? false"
          (change)="onFilterChange('hideFollowing', $event.checked)">
          Hide Following
        </mat-checkbox>
        }
      </div>

      <mat-divider></mat-divider>

      <!-- Display Options -->
      <div class="section-label">Display</div>
      <div class="filter-options">
        @if (hasProviders()) {
          <mat-checkbox
            [checked]="filters()?.showRank ?? true"
            (change)="onFilterChange('showRank', $event.checked)">
            Show Trust Rank
          </mat-checkbox>
        }
      </div>

      <!-- Actions Row -->
      <div class="actions-row">
        @if (hasProviders()) {
          <button mat-stroked-button class="action-btn" (click)="onRefreshTrustRanks()">
            Refresh Trust Ranks
          </button>
        } @else {
          <button mat-stroked-button class="action-btn configure-trust-btn" (click)="goToTrustSettings()">
            <mat-icon>settings</mat-icon>
            Configure Trust
          </button>
        }
      </div>
      <div class="actions-row">
        <button mat-stroked-button class="action-btn" (click)="reset()">
          Reset All
        </button>
      </div>
    </div>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      min-width: 260px;
      max-width: 320px;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .section-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 0.25rem;
    }

    .sort-options-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    .sort-option-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
    }

    .sort-option-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .sort-option-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .chip-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.8125rem;
    }

    .sort-option-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .filter-options {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .filter-options mat-checkbox {
      --mdc-checkbox-selected-checkmark-color: var(--mat-sys-on-primary);
    }

    mat-divider {
      margin: 0.25rem 0;
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }

    .action-btn {
      flex: 1;
      font-size: 0.8125rem;
    }

    .configure-trust-btn {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--mat-sys-primary);
    }

    .configure-trust-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `]
})
export class PeopleFilterPanelComponent {
  private router = inject(Router);
  private trustProviderService = inject(TrustProviderService);

  filters = input<PeopleFilters | null>(null);
  sortOption = input<SortOption>('default');
  isCachedListSelected = input<boolean>(false);

  // Output events for changes
  filtersChanged = output<Partial<PeopleFilters>>();
  sortOptionChanged = output<SortOption>();
  refreshTrustRanks = output<void>();

  // Expose sort options
  sortOptions = SORT_OPTIONS;

  currentSortOption = computed(() => this.sortOption());

  /** Whether the user has any trust providers configured (kind 10040 event) */
  hasProviders = computed(() => this.trustProviderService.hasProviders());

  /**
   * Select a sort option
   */
  selectSortOption(option: SortOption): void {
    this.sortOptionChanged.emit(option);
  }

  /**
   * Handle filter checkbox change
   */
  onFilterChange(filterName: keyof PeopleFilters, checked: boolean): void {
    this.filtersChanged.emit({ [filterName]: checked });
  }

  /**
   * Reset all filters and sort to defaults
   */
  reset(): void {
    this.filtersChanged.emit({
      hasRelayList: false,
      hasFollowingList: false,
      hasNip05: false,
      favoritesOnly: false,
      hideFollowing: false,
      showRank: true,
    });
    this.sortOptionChanged.emit('default');
  }

  /**
   * Trigger refresh of trust ranks for all people in current list
   */
  onRefreshTrustRanks(): void {
    this.refreshTrustRanks.emit();
  }

  /**
   * Navigate to Trust settings page so the user can configure trust providers
   */
  goToTrustSettings(): void {
    this.router.navigate(['/settings/trust']);
  }
}
