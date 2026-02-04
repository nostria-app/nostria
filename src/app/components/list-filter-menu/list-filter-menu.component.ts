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
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';

export type ListFilterValue = 'all' | 'following' | string;

@Component({
  selector: 'app-list-filter-menu',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  template: `
    <button mat-icon-button [matMenuTriggerFor]="listFilterMenu" [matTooltip]="'Filter by: ' + filterTitle()">
      <mat-icon>{{ menuIcon() }}</mat-icon>
    </button>

    <mat-menu #listFilterMenu="matMenu" class="list-filter-menu">
      <div class="menu-section-header" role="presentation">
        <mat-icon>filter_list</mat-icon>
        <span>Filter</span>
      </div>
      <mat-divider></mat-divider>
      
      @if (showPublicOption()) {
      <button mat-menu-item (click)="selectFilter('all')" [class.active]="selectedFilter() === 'all'">
        <mat-icon>public</mat-icon>
        <span class="menu-item-label">Public</span>
      </button>
      }
      
      <button mat-menu-item (click)="selectFilter('following')" [class.active]="selectedFilter() === 'following'">
        <mat-icon>people</mat-icon>
        <span class="menu-item-label">Following</span>
      </button>
      
      @if (favoritesSet(); as favorites) {
      <button mat-menu-item (click)="selectFilter('nostria-favorites')" [class.active]="selectedFilter() === 'nostria-favorites'">
        <mat-icon>star</mat-icon>
        <span class="menu-item-label">Favorites</span>
        <span class="menu-item-count">{{ favorites.pubkeys.length }}</span>
      </button>
      }
      
      @if (otherFollowSets().length > 0) {
      <mat-divider></mat-divider>
      @for (set of otherFollowSets(); track set.id) {
      <button mat-menu-item (click)="selectFilter(set.dTag)" [class.active]="selectedFilter() === set.dTag">
        <mat-icon>{{ set.isPrivate ? 'lock' : 'group' }}</mat-icon>
        <span class="menu-item-label">{{ set.title }}</span>
        <span class="menu-item-count">{{ set.pubkeys.length }}</span>
      </button>
      }
      }
    </mat-menu>
  `,
  styles: [`
    ::ng-deep .list-filter-menu {
      min-width: 240px;
      max-height: 400px;

      .menu-section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background-color: var(--mat-sys-surface-container-low);
        cursor: default;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: var(--mat-sys-primary);
        }

        span {
          font-size: 0.875rem;
          color: var(--mat-sys-on-surface);
        }
      }

      .mat-mdc-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        min-height: 40px;

        .mdc-list-item__primary-text,
        .mat-mdc-menu-item-text {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 8px !important;
          width: 100% !important;
        }

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--mat-sys-on-surface-variant);
          flex-shrink: 0;
        }

        .menu-item-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .menu-item-count {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 18px;
          padding: 0 6px;
          border-radius: 9px;
          background-color: var(--mat-sys-surface-container-highest);
          font-size: 0.7rem;
          color: var(--mat-sys-on-surface-variant);
          flex-shrink: 0;
        }

        &.active {
          background-color: var(--mat-sys-primary-container);

          mat-icon {
            color: var(--mat-sys-primary);
          }

          .menu-item-label {
            color: var(--mat-sys-on-primary-container);
          }

          .menu-item-count {
            background-color: var(--mat-sys-primary);
            color: var(--mat-sys-on-primary);
          }
        }
      }
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
  storageKey = input.required<'streams' | 'articles' | 'summary'>();
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

  // Computed: other follow sets (excluding favorites)
  otherFollowSets = computed(() => this.allFollowSets().filter(set => set.dTag !== 'nostria-favorites'));

  // Computed: selected follow set (null for 'all' or 'following')
  selectedFollowSet = computed(() => {
    const filter = this.selectedFilter();
    if (filter === 'all' || filter === 'following') {
      return null;
    }
    return this.allFollowSets().find(set => set.dTag === filter) || null;
  });

  // Computed: menu icon
  menuIcon = computed(() => {
    const followSet = this.selectedFollowSet();
    if (followSet?.isPrivate) return 'lock';
    const filter = this.selectedFilter();
    if (filter === 'all') return 'public';
    if (filter === 'following') return 'people';
    if (filter === 'nostria-favorites') return 'star';
    return 'group';
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
      }
    }
  }
}
