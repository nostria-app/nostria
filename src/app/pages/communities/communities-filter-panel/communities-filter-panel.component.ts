import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { CommunityListFilters, CommunitySortOption } from '../../../interfaces/community-filters';
import { FollowSetsService } from '../../../services/follow-sets.service';

interface SortOptionDef {
  id: CommunitySortOption;
  label: string;
}

const SORT_OPTIONS: SortOptionDef[] = [
  { id: 'default', label: 'Newest first' },
  { id: 'name-asc', label: 'Name (A-Z)' },
  { id: 'name-desc', label: 'Name (Z-A)' },
  { id: 'oldest', label: 'Oldest first' },
];

@Component({
  selector: 'app-communities-filter-panel',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatIconModule,
  ],
  template: `
    <div class="filter-panel" role="dialog" aria-label="Community filters" (click)="$event.stopPropagation()">
      <div class="filter-column community-filter-column">
        <div class="combined-filter-header">
          <span class="combined-filter-title">Community options</span>
          @if (hasActiveCommunityFilters()) {
          <span class="combined-filter-status">Active</span>
          }
        </div>

        <div class="section-label">Sort</div>
        <div class="sort-options-grid" role="radiogroup" aria-label="Community sort options">
          @for (option of sortOptions; track option.id) {
            <button
              class="sort-option-chip"
              [class.selected]="sortOption() === option.id"
              [attr.aria-pressed]="sortOption() === option.id"
              (click)="sortOptionChanged.emit(option.id)">
              <span class="chip-label">{{ option.label }}</span>
            </button>
          }
        </div>

        <mat-divider></mat-divider>

        <div class="section-label">Show only</div>
        <div class="filter-options">
          <mat-checkbox
            [checked]="filters().joinedOnly"
            (change)="filtersChanged.emit({ joinedOnly: $event.checked })">
            Joined communities
          </mat-checkbox>
          <mat-checkbox
            [checked]="filters().hasImage"
            (change)="filtersChanged.emit({ hasImage: $event.checked })">
            Communities with artwork
          </mat-checkbox>
          <mat-checkbox
            [checked]="filters().hasRules"
            (change)="filtersChanged.emit({ hasRules: $event.checked })">
            Communities with rules
          </mat-checkbox>
        </div>

        <div class="actions-row single-action-row">
          <button mat-stroked-button class="action-btn" (click)="resetRequested.emit()">
            Reset
          </button>
        </div>
      </div>

      <div class="combined-filter-divider"></div>

      <div class="filter-column list-filter-column">
        <div class="combined-filter-header">
          <span class="combined-filter-title">List filter</span>
          @if (currentListFilter() !== defaultListFilter()) {
          <span class="combined-filter-status">Active</span>
          }
        </div>

        @if (showPublicOption()) {
        <button
          class="filter-option-chip"
          [class.selected]="currentListFilter() === 'all'"
          (click)="listFilterChanged.emit('all')">
          <mat-icon class="chip-icon">public</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Public</span>
            <span class="chip-description">All public communities</span>
          </div>
        </button>
        }

        <button
          class="filter-option-chip"
          [class.selected]="currentListFilter() === 'following'"
          (click)="listFilterChanged.emit('following')">
          <mat-icon class="chip-icon">people</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Following</span>
            <span class="chip-description">Communities from people you follow</span>
          </div>
        </button>

        @if (favoritesSet(); as favorites) {
        <button
          class="filter-option-chip"
          [class.selected]="currentListFilter() === 'nostria-favorites'"
          (click)="listFilterChanged.emit('nostria-favorites')">
          <mat-icon class="chip-icon">star</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Favorites</span>
            <span class="chip-description">{{ favorites.pubkeys.length }} people</span>
          </div>
        </button>
        }

        @if (otherFollowSets().length > 0) {
        <mat-divider></mat-divider>
        @for (set of otherFollowSets(); track set.id) {
        <button
          class="filter-option-chip"
          [class.selected]="currentListFilter() === set.dTag"
          (click)="listFilterChanged.emit(set.dTag)">
          <mat-icon class="chip-icon">{{ set.isPrivate ? 'lock' : 'group' }}</mat-icon>
          <div class="chip-text">
            <span class="chip-label">{{ set.title }}</span>
            <span class="chip-description">{{ set.pubkeys.length }} people</span>
          </div>
        </button>
        }
        }

        <div class="actions-row single-action-row">
          <button mat-stroked-button class="action-btn" (click)="listFilterChanged.emit(defaultListFilter())">
            Reset
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: row;
      gap: 1rem;
      padding: 1rem;
      width: min(720px, calc(100vw - 2rem));
      max-width: calc(100vw - 2rem);
      max-height: 75vh;
      overflow: hidden;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      box-sizing: border-box;
      align-items: stretch;
    }

    .filter-column {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .combined-filter-divider {
      width: 1px;
      background: var(--mat-sys-outline-variant);
      flex-shrink: 0;
    }

    .combined-filter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .combined-filter-title {
      color: var(--mat-sys-on-surface);
      font-size: 0.95rem;
    }

    .combined-filter-status {
      color: var(--mat-sys-on-primary-container);
      background: var(--mat-sys-primary-container);
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
    }

    .section-label {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .filter-option-chip {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
      width: 100%;
      box-sizing: border-box;
    }

    .filter-option-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .filter-option-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .sort-options-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
    }

    .sort-option-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0.625rem 0.75rem;
      border-radius: 10px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
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

    .chip-icon {
      color: var(--mat-sys-on-surface-variant);
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
    }

    .chip-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
    }

    .filter-option-chip.selected .chip-icon,
    .filter-option-chip.selected .chip-label,
    .sort-option-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .chip-description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .filter-option-chip.selected .chip-description {
      color: var(--mat-sys-on-primary-container);
      opacity: 0.8;
    }

    .sort-option-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .filter-options {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
    }

    .single-action-row {
      margin-top: auto;
    }

    .action-btn {
      flex: 1;
    }

    @media (max-width: 640px) {
      .filter-panel {
        flex-direction: column;
      }

      .combined-filter-divider {
        width: 100%;
        height: 1px;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunitiesFilterPanelComponent {
  private readonly followSetsService = inject(FollowSetsService);

  filters = input.required<CommunityListFilters>();
  sortOption = input<CommunitySortOption>('default');
  currentListFilter = input<string>('all');
  defaultListFilter = input<string>('all');
  showPublicOption = input(true);

  filtersChanged = output<Partial<CommunityListFilters>>();
  sortOptionChanged = output<CommunitySortOption>();
  resetRequested = output<void>();
  listFilterChanged = output<string>();

  sortOptions = SORT_OPTIONS;

  favoritesSet = computed(() =>
    this.followSetsService.followSets().find(set => set.dTag === 'nostria-favorites') ?? null
  );

  otherFollowSets = computed(() =>
    this.followSetsService.followSets()
      .filter(set => set.dTag !== 'nostria-favorites')
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  hasActiveCommunityFilters = computed(() => {
    const currentFilters = this.filters();
    return currentFilters.joinedOnly || currentFilters.hasImage || currentFilters.hasRules || this.sortOption() !== 'default';
  });
}
