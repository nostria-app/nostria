import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FilterButtonComponent } from '../filter-button/filter-button.component';

export type ListFilterValue = 'all' | 'following' | string;

@Component({
  selector: 'app-list-filter-menu',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    FilterButtonComponent,
  ],
  template: `
    <app-filter-button [active]="isFilterActive()" [tooltip]="'Filter by: ' + filterTitle()">
      <div class="filter-panel" (click)="$event.stopPropagation()">
        <!-- Filter Options -->
        @if (showPublicOption()) {
        <button
          class="filter-option-chip"
          [class.selected]="selectedFilter() === 'all'"
          (click)="selectFilter('all')">
          <mat-icon class="chip-icon">public</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Public</span>
            <span class="chip-description">All public content</span>
          </div>
        </button>
        }

        <button
          class="filter-option-chip"
          [class.selected]="selectedFilter() === 'following'"
          (click)="selectFilter('following')">
          <mat-icon class="chip-icon">people</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Following</span>
            <span class="chip-description">People you follow</span>
          </div>
        </button>

        @if (favoritesSet(); as favorites) {
        <button
          class="filter-option-chip"
          [class.selected]="selectedFilter() === 'nostria-favorites'"
          (click)="selectFilter('nostria-favorites')">
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
          [class.selected]="selectedFilter() === set.dTag"
          (click)="selectFilter(set.dTag)">
          <mat-icon class="chip-icon">{{ set.isPrivate ? 'lock' : 'group' }}</mat-icon>
          <div class="chip-text">
            <span class="chip-label">{{ set.title }}</span>
            <span class="chip-description">{{ set.pubkeys.length }} people</span>
          </div>
        </button>
        }
        }

        <!-- Actions Row -->
        <div class="actions-row">
          <button mat-stroked-button class="action-btn" (click)="selectFilter(defaultFilter())">
            Reset
          </button>
        </div>
      </div>
    </app-filter-button>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      width: calc(100vw - 2rem);
      max-width: 300px;
      max-height: 400px;
      overflow-y: auto;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      box-sizing: border-box;
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
    }

    .filter-option-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .filter-option-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .chip-icon {
      color: var(--mat-sys-on-surface-variant);
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
    }

    .filter-option-chip.selected .chip-icon {
      color: var(--mat-sys-on-primary-container);
    }

    .chip-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
    }

    .chip-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.875rem;
    }

    .filter-option-chip.selected .chip-label {
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
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListFilterMenuComponent implements OnInit {
  private followSetsService = inject(FollowSetsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);

  // Inputs
  showPublicOption = input<boolean>(false);
  defaultFilter = input<ListFilterValue>('following');
  storageKey = input.required<'streams' | 'articles' | 'summary' | 'music'>();
  initialFilter = input<ListFilterValue | undefined>(undefined); // Override from URL query params

  // Outputs
  filterChanged = output<ListFilterValue>();
  followSetChanged = output<FollowSet | null>();

  // Internal state
  selectedFilter = signal<ListFilterValue>('following');

  // Computed: all follow sets
  private allFollowSets = computed(() => this.followSetsService.followSets());

  // Computed: favorites set
  favoritesSet = computed(() => this.allFollowSets().find(set => set.dTag === 'nostria-favorites'));

  // Computed: other follow sets (excluding favorites), sorted alphabetically by title
  otherFollowSets = computed(() =>
    this.allFollowSets()
      .filter(set => set.dTag !== 'nostria-favorites')
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  // Computed: selected follow set (null for 'all' or 'following')
  selectedFollowSet = computed(() => {
    const filter = this.selectedFilter();
    if (filter === 'all' || filter === 'following') {
      return null;
    }
    return this.allFollowSets().find(set => set.dTag === filter) || null;
  });

  // Computed: whether filter is active (different from default)
  isFilterActive = computed(() => {
    return this.selectedFilter() !== this.defaultFilter();
  });

  // Computed: filter title for tooltip
  filterTitle = computed(() => {
    const filter = this.selectedFilter();
    if (filter === 'all') return 'Public';
    if (filter === 'following') return 'Following';
    const followSet = this.selectedFollowSet();
    return followSet?.title || 'Filter';
  });

  constructor() {
    // Effect to emit followSet changes
    effect(() => {
      this.followSetChanged.emit(this.selectedFollowSet());
    });
  }

  ngOnInit() {
    // Check for initial filter from URL query params first (takes precedence)
    const urlFilter = this.initialFilter();
    if (urlFilter) {
      this.selectedFilter.set(urlFilter);
      this.filterChanged.emit(urlFilter);
      return;
    }

    // Load persisted filter from storage
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const key = this.storageKey();
      let savedFilter: string;

      switch (key) {
        case 'streams':
          savedFilter = this.accountLocalState.getStreamsListFilter(pubkey);
          break;
        case 'articles':
          savedFilter = this.accountLocalState.getArticlesListFilter(pubkey);
          break;
        case 'summary':
          savedFilter = this.accountLocalState.getSummaryListFilter(pubkey);
          break;
        case 'music':
          savedFilter = this.accountLocalState.getMusicListFilter(pubkey);
          break;
        default:
          savedFilter = this.defaultFilter();
      }

      this.selectedFilter.set(savedFilter as ListFilterValue);
      this.filterChanged.emit(savedFilter as ListFilterValue);
    } else {
      this.selectedFilter.set(this.defaultFilter());
    }
  }

  selectFilter(filter: ListFilterValue) {
    this.selectedFilter.set(filter);
    this.filterChanged.emit(filter);

    // Persist to storage
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const key = this.storageKey();
      switch (key) {
        case 'streams':
          this.accountLocalState.setStreamsListFilter(pubkey, filter);
          break;
        case 'articles':
          this.accountLocalState.setArticlesListFilter(pubkey, filter);
          break;
        case 'summary':
          this.accountLocalState.setSummaryListFilter(pubkey, filter);
          break;
        case 'music':
          this.accountLocalState.setMusicListFilter(pubkey, filter);
          break;
      }
    }
  }
}
