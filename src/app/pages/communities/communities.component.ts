import { DatePipe } from '@angular/common';
import { Component, ChangeDetectionStrategy, inject, signal, computed, OnDestroy, OnInit, effect } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { CommunityService, Community, COMMUNITY_DEFINITION_KIND } from '../../services/community.service';
import { CommunityListService } from '../../services/community-list.service';
import { ApplicationService } from '../../services/application.service';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { LoggerService } from '../../services/logger.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { ListFilterMenuComponent, ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { FilterButtonComponent } from '../../components/filter-button/filter-button.component';
import { CommunitiesFilterPanelComponent } from './communities-filter-panel/communities-filter-panel.component';
import {
  CommunityListFilters,
  CommunitySortOption,
  DEFAULT_COMMUNITY_LIST_FILTERS,
} from '../../interfaces/community-filters';

const PAGE_SIZE = 30;

@Component({
  selector: 'app-communities',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    DatePipe,
    RouterLink,
    UserProfileComponent,
    ListFilterMenuComponent,
    FilterButtonComponent,
    CommunitiesFilterPanelComponent,
  ],
  templateUrl: './communities.component.html',
  styleUrls: ['./communities.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunitiesComponent implements OnInit, OnDestroy {
  private communityService = inject(CommunityService);
  private communityListService = inject(CommunityListService);
  private app = inject(ApplicationService);
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);
  private followSetsService = inject(FollowSetsService);
  private readonly logger = inject(LoggerService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  allCommunities = signal<Community[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  searchQuery = signal('');
  selectedListFilter = signal<string>('all');
  urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);
  communityFilters = signal<CommunityListFilters>({ ...DEFAULT_COMMUNITY_LIST_FILTERS });
  sortOption = signal<CommunitySortOption>('default');

  // Dedup map: coordinate -> Community
  private communityMap = new Map<string, Community>();

  // Pagination
  displayCount = signal(PAGE_SIZE);

  private readonly filterPubkeys = computed<string[] | null>(() => {
    const filter = this.selectedListFilter();
    if (filter === 'all') {
      return null;
    }
    if (filter === 'following') {
      return this.accountState.followingList();
    }

    const followSet = this.followSetsService.followSets().find(set => set.dTag === filter);
    return followSet?.pubkeys || [];
  });

  filteredCommunities = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const { joinedOnly, hasImage, hasRules } = this.communityFilters();
    const joinedSet = this.communityListService.communityCoordinateSet();
    const filterPubkeys = this.filterPubkeys();

    return this.allCommunities().filter(community => {
      if (filterPubkeys !== null && !filterPubkeys.includes(community.creatorPubkey)) {
        return false;
      }

      if (joinedOnly && !joinedSet.has(community.coordinate)) {
        return false;
      }

      if (hasImage && !community.image && !community.avatar) {
        return false;
      }

      if (hasRules && !community.rules.trim()) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableText = [
        community.name,
        community.id,
        community.description,
        community.rules,
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    });
  });

  // Sorted communities
  sortedCommunities = computed(() => {
    const joinedSet = this.communityListService.communityCoordinateSet();
    const communities = [...this.filteredCommunities()];

    switch (this.sortOption()) {
      case 'name-asc':
        return communities.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return communities.sort((a, b) => b.name.localeCompare(a.name));
      case 'oldest':
        return communities.sort((a, b) => a.event.created_at - b.event.created_at);
      default:
        return communities.sort((a, b) => {
          const aJoined = joinedSet.has(a.coordinate) ? 1 : 0;
          const bJoined = joinedSet.has(b.coordinate) ? 1 : 0;
          if (aJoined !== bJoined) {
            return bJoined - aJoined;
          }
          return b.event.created_at - a.event.created_at;
        });
    }
  });

  // Paginated communities for display
  currentCommunities = computed(() => {
    return this.sortedCommunities().slice(0, this.displayCount());
  });

  hasMore = computed(() => {
    return this.sortedCommunities().length > this.displayCount();
  });

  hasVisibleCommunities = computed(() => {
    return this.sortedCommunities().length > 0;
  });

  hasAnyCommunities = computed(() => {
    return this.allCommunities().length > 0;
  });

  isAuthenticated = computed(() => this.app.authenticated());
  hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  hasActiveCommunityFilters = computed(() => {
    const filters = this.communityFilters();
    return (
      filters.joinedOnly ||
      filters.hasImage ||
      filters.hasRules ||
      this.sortOption() !== 'default'
    );
  });
  showingFilteredResults = computed(() => {
    return (
      this.hasSearchQuery() ||
      this.selectedListFilter() !== 'all' ||
      this.hasActiveCommunityFilters()
    );
  });

  /** Check if a community is in the user's joined list */
  isCommunityJoined(coordinate: string): boolean {
    return this.communityListService.isCommunityInList(coordinate);
  }

  private subscription: { close: () => void } | null = null;

  // Scroll-based pagination
  private wasScrolledToBottom = false;
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000;

  constructor() {
    effect(() => {
      const isAtBottom = this.layout.leftPanelScrolledToBottom();
      const isReady = this.layout.leftPanelScrollReady();

      const justScrolledToBottom = isReady && isAtBottom && !this.wasScrolledToBottom;
      this.wasScrolledToBottom = isAtBottom;

      if (!justScrolledToBottom) return;
      if (this.loadingMore() || !this.hasMore()) return;

      const now = Date.now();
      if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) return;
      this.lastLoadTime = now;

      this.loadMore();
    });

    effect(() => {
      this.searchQuery();
      this.selectedListFilter();
      this.communityFilters();
      this.sortOption();
      this.displayCount.set(PAGE_SIZE);
    });
  }

  ngOnInit(): void {
    this.startSubscription();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.close();
    }
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);

    setTimeout(() => {
      this.displayCount.update(count => count + PAGE_SIZE);
      this.loadingMore.set(false);
    }, 100);
  }

  refresh(): void {
    this.communityMap.clear();
    this.allCommunities.set([]);
    this.loading.set(true);
    this.displayCount.set(PAGE_SIZE);

    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    this.startSubscription();
  }

  getCommunityLink(community: Community): string {
    const naddr = nip19.naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: community.creatorPubkey,
      identifier: community.id,
    });
    return `/n/${naddr}`;
  }

  navigateToCommunity(community: Community, event: MouseEvent): void {
    event.preventDefault();
    const naddr = nip19.naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: community.creatorPubkey,
      identifier: community.id,
    });
    this.router.navigate(['/n', naddr], {
      state: { communityEvent: community.event },
    });
  }

  updateSearchQuery(value: string): void {
    this.searchQuery.set(value);
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.updateSearchQuery(input?.value || '');
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { list: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
    });
  }

  onCommunityFiltersChanged(filters: Partial<CommunityListFilters>): void {
    this.communityFilters.update(current => ({ ...current, ...filters }));
  }

  onSortOptionChanged(sortOption: CommunitySortOption): void {
    this.sortOption.set(sortOption);
  }

  resetCommunityFilters(): void {
    this.communityFilters.set({ ...DEFAULT_COMMUNITY_LIST_FILTERS });
    this.sortOption.set('default');
  }

  private startSubscription(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    const loadingTimeout = setTimeout(() => {
      if (this.loading()) {
        this.logger.debug('[Communities] No events received within timeout');
        this.loading.set(false);
      }
    }, 8000);

    this.subscription = this.communityService.subscribeCommunities(
      (community: Community) => {
        this.handleCommunity(community);

        if (this.loading()) {
          clearTimeout(loadingTimeout);
          this.loading.set(false);
        }
      },
      { limit: 200 }
    );
  }

  private handleCommunity(community: Community): void {
    const existing = this.communityMap.get(community.coordinate);

    // Only keep the latest version of each community
    if (existing && existing.event.created_at >= community.event.created_at) {
      return;
    }

    this.communityMap.set(community.coordinate, community);
    this.updateCommunitiesList();
  }

  private updateCommunitiesList(): void {
    this.allCommunities.set(Array.from(this.communityMap.values()));
  }
}
