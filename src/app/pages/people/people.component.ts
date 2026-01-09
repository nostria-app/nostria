import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { LoggerService } from '../../services/logger.service';
import { debounceTime } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { Router } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { FavoritesService } from '../../services/favorites.service';
import { MatDialog } from '@angular/material/dialog';
import { AddPersonDialogComponent } from './add-person-dialog.component';
import {
  Interest,
  SuggestedProfile,
} from '../../components/followset/followset.component';
import { Followset } from '../../services/followset';
import { NotificationService } from '../../services/notification.service';
import { FeedsCollectionService } from '../../services/feeds-collection.service';
import { AccountLocalStateService, PeopleFilters } from '../../services/account-local-state.service';
import { FollowingService } from '../../services/following.service';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';

// Re-export for local use
type FilterOptions = PeopleFilters;

// Define sorting options
type SortOption = 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatCheckboxModule,
    MatRadioModule,
    RouterModule,
    UserProfileComponent,
    MatMenuModule
  ],
  templateUrl: './people.component.html',
  styleUrls: ['./people.component.scss'],
})
export class PeopleComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private favoritesService = inject(FavoritesService);
  private dialog = inject(MatDialog);
  private followsetService = inject(Followset);
  private notificationService = inject(NotificationService);
  private feedsCollectionService = inject(FeedsCollectionService);
  readonly followingService = inject(FollowingService);
  private followSetsService = inject(FollowSetsService);

  // Search functionality
  searchTerm = signal<string>('');
  private searchChanged = new Subject<string>();

  // View mode
  viewMode = signal<string>('medium');

  // Filter options
  filters = signal<FilterOptions>({
    hasRelayList: false,
    hasFollowingList: false,
    hasNip05: false,
    favoritesOnly: false,
    showRank: true,
  });

  // Sorting options
  sortOption = signal<SortOption>('default');

  // Follow set selection
  selectedFollowSet = signal<FollowSet | null>(null);

  // All follow sets (no limit for dropdown in People component)
  allFollowSets = computed(() => {
    const sets = this.followSetsService.followSets();
    return [...sets].sort((a, b) => b.createdAt - a.createdAt);
  });

  // Read query parameters
  private queryParams = toSignal(this.route.queryParams);

  // Computed signal for filtered and sorted people using FollowingService
  filteredAndSortedProfiles = computed(() => {
    const search = this.searchTerm();
    const filters = this.filters();
    const sortOption = this.sortOption();
    const favorites = this.favoritesService.favorites();
    const selectedSet = this.selectedFollowSet();

    // If a follow set is selected, filter to only those pubkeys
    if (selectedSet) {
      const setProfiles = this.followingService.profiles()
        .filter(p => selectedSet.pubkeys.includes(p.pubkey));

      // Apply search if applicable
      let profiles = search
        ? setProfiles.filter(p => {
          const name = (p.info?.['name'] as string)?.toLowerCase?.() || '';
          const displayName = (p.info?.['display_name'] as string)?.toLowerCase?.() || '';
          const nip05 = (p.info?.['nip05'] as string)?.toLowerCase?.() || '';
          const searchLower = search.toLowerCase();
          return name.includes(searchLower) ||
            displayName.includes(searchLower) ||
            nip05.includes(searchLower);
        })
        : setProfiles;

      // Apply sorting
      profiles = this.followingService.getSortedProfiles(profiles, sortOption);
      return profiles;
    }

    // Normal filtering when no follow set is selected
    let profiles = search
      ? this.followingService.searchProfiles(search)
      : this.followingService.profiles();

    // Apply filters on the search results
    profiles = this.followingService.getFilteredProfiles(
      {
        ...filters,
        favoritesList: favorites,
      },
      profiles
    );

    // Apply sorting
    profiles = this.followingService.getSortedProfiles(profiles, sortOption);

    return profiles;
  });

  // Extract pubkeys for rendering
  sortedPeople = computed(() => {
    return this.filteredAndSortedProfiles().map(p => p.pubkey);
  });

  // Pagination: limit how many items are rendered to avoid thousands of event listeners
  private readonly PAGE_SIZE = 200;
  displayLimit = signal(this.PAGE_SIZE);

  // Visible people (limited for performance)
  visiblePeople = computed(() => {
    const allPeople = this.sortedPeople();
    const limit = this.displayLimit();
    return allPeople.slice(0, limit);
  });

  // Check if there are more people to load
  hasMorePeople = computed(() => {
    return this.sortedPeople().length > this.displayLimit();
  });

  // How many more people are available
  remainingCount = computed(() => {
    return Math.max(0, this.sortedPeople().length - this.displayLimit());
  });

  // Loading and error states from FollowingService
  isLoading = computed(() => this.followingService.isLoading());
  error = signal<string | null>(null);

  // Virtual scrolling settings
  minBufferPx = 800;
  maxBufferPx = 1000;

  // Computed item size based on view mode
  itemSize = computed(() => {
    switch (this.viewMode()) {
      case 'large':
        return 200;
      case 'medium':
        return 150;
      case 'small':
        return 100;
      case 'details':
        return 72;
      default:
        return 150;
    }
  });

  // Check if any filters are active (excluding display options like showRank)
  hasActiveFilters = computed(() => {
    const activeFilters = this.filters();
    // Exclude showRank from filter check as it's a display option, not a filter
    return (
      activeFilters.hasRelayList ||
      activeFilters.hasFollowingList ||
      activeFilters.hasNip05 ||
      activeFilters.favoritesOnly
    );
  });

  // Followset-related properties for new users
  showFollowset = signal<boolean>(false);
  selectedInterests = signal<string[]>([]);
  followingProfiles = signal<string[]>([]);
  detectedRegion = signal('');
  availableInterests = signal<Interest[]>([]);
  isLoadingInterests = signal<boolean>(false);
  suggestedProfiles = signal<SuggestedProfile[]>([]);

  // Check if user has an empty following list
  hasEmptyFollowingList = computed(() => {
    return this.accountState.followingList().length === 0;
  });

  constructor() {
    // Initialize search debounce
    this.searchChanged.pipe(debounceTime(300)).subscribe(term => {
      this.searchTerm.set(term);
    });

    // If user has empty following, automatically show followset and load interests
    effect(async () => {
      if (this.app.initialized() && this.hasEmptyFollowingList() && this.availableInterests().length === 0) {
        this.showFollowset.set(true);
        await this.initializeFollowsetData();
      }
    });

    // Load view mode from centralized state if available
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const savedViewMode = this.accountLocalState.getPeopleViewMode(pubkey);
        if (savedViewMode) {
          this.viewMode.set(savedViewMode);
        }
      }
    });

    // Load filters from centralized state if available
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const savedFilters = this.accountLocalState.getPeopleFilters(pubkey);
        if (savedFilters) {
          this.filters.set(savedFilters);
        }
      }
    });

    // Save filters when they change
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setPeopleFilters(pubkey, this.filters());
      }
    });

    // Load sort option from centralized state if available
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const savedSortOption = this.accountLocalState.getPeopleSortOption(pubkey);
        if (savedSortOption) {
          this.sortOption.set(savedSortOption as SortOption);
        }
      }
    });

    // Save sort option when it changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setPeopleSortOption(pubkey, this.sortOption());
      }
    });

    // Watch for 'set' query parameter and select the corresponding follow set
    effect(() => {
      const params = this.queryParams();
      const setDTag = params?.['set'];
      const followSets = this.allFollowSets();

      if (setDTag && followSets.length > 0) {
        const matchingSet = followSets.find(s => s.dTag === setDTag);
        if (matchingSet && this.selectedFollowSet()?.dTag !== setDTag) {
          this.selectFollowSet(matchingSet);
        }
      } else if (!setDTag && this.selectedFollowSet()) {
        // Clear selection when no set parameter
        this.selectFollowSet(null);
      }
    });
  }



  updateSearch(term: string) {
    this.searchChanged.next(term);
    // Reset display limit when search changes
    this.displayLimit.set(this.PAGE_SIZE);
  }

  // Load more people (pagination)
  loadMore(): void {
    this.displayLimit.update(limit => limit + this.PAGE_SIZE);
  }

  changeViewMode(mode: string) {
    this.viewMode.set(mode);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setPeopleViewMode(pubkey, mode);
    }
  }

  changeSortOption(option: SortOption) {
    this.sortOption.set(option);
    // Reset display limit when sort changes
    this.displayLimit.set(this.PAGE_SIZE);
  }

  toggleFilter(filterName: keyof FilterOptions) {
    this.filters.update(current => ({
      ...current,
      [filterName]: !current[filterName],
    }));
  }

  resetFilters() {
    this.filters.set({
      hasRelayList: false,
      hasFollowingList: false,
      hasNip05: false,
      favoritesOnly: false,
      showRank: true,
    });
    // Reset display limit when filters are reset
    this.displayLimit.set(this.PAGE_SIZE);
  }

  preventPropagation(event: Event) {
    event.stopPropagation();
  }

  viewProfile(pubkey: string) {
    this.router.navigate(['/p', pubkey]);
  }

  /**
   * Select a follow set to filter people
   */
  selectFollowSet(followSet: FollowSet | null) {
    this.selectedFollowSet.set(followSet);
    // Reset display limit when follow set changes
    this.displayLimit.set(this.PAGE_SIZE);
    // Clear search when selecting a follow set
    if (followSet) {
      this.updateSearch('');
    }
  }

  /**
   * Create a feed from the currently selected follow set
   */
  async createFeedFromFollowSet() {
    const selectedSet = this.selectedFollowSet();
    if (!selectedSet) {
      this.logger.warn('[People] No follow set selected for feed creation');
      return;
    }

    try {
      // Navigate to feeds page with the follow set as a parameter
      // The feeds component will handle creating the feed
      await this.router.navigate(['/feeds'], {
        queryParams: {
          createFrom: 'followset',
          dTag: selectedSet.dTag,
          title: selectedSet.title
        }
      });
    } catch (error) {
      this.logger.error('[People] Failed to navigate to feed creation:', error);
    }
  }

  openAddPersonDialog() {
    const dialogRef = this.dialog.open(AddPersonDialogComponent, {
      width: '600px',
      // maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: false,
      autoFocus: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.logger.info('Person added:', result);
        // FollowingService will automatically reload when following list changes
      }
    });
  }

  // Followset methods - moved from FeedsComponent
  /**
   * Initialize followset data for new users
   */
  private async initializeFollowsetData(): Promise<void> {
    try {
      this.logger.debug('Fetching starter packs for followset...');
      this.isLoadingInterests.set(true);

      // Fetch starter packs from the followset service
      const starterPacks = await this.followsetService.fetchStarterPacks();

      if (starterPacks.length > 0) {
        // Convert starter packs to interests
        const interests = this.followsetService.convertStarterPacksToInterests(starterPacks);
        this.availableInterests.set(interests);
        this.logger.debug(`Loaded ${interests.length} interests from starter packs`);
      } else {
        this.logger.warn('No starter packs found, using default interests');
      }
    } catch (error) {
      this.logger.error('Failed to initialize followset data:', error);
    } finally {
      this.isLoadingInterests.set(false);
    }
  }

  /**
   * Toggle followset display manually
   */
  async openFollowsetDialog() {
    this.showFollowset.set(true);

    // Load interests if not already loaded
    if (this.availableInterests().length === 0) {
      await this.initializeFollowsetData();
    }
  }

  /**
   * Handle followset completion
   */
  async onFollowsetComplete(data: {
    selectedInterests: string[];
    followsToAdd: string[];
  }): Promise<void> {
    try {
      const { selectedInterests, followsToAdd } = data;

      this.logger.debug('Followset onboarding completed', {
        selectedInterests,
        followsToAdd,
      });

      // Follow all selected profiles in a single batch operation
      await this.accountState.follow(followsToAdd);

      // this.notificationService.notify(`Welcome! Following ${followsToAdd.length} accounts.`);

      // Update local state
      this.selectedInterests.set(selectedInterests);
      this.followingProfiles.update(current => [...new Set([...current, ...followsToAdd])]);

      // Hide followset UI
      this.showFollowset.set(false);

      // Refresh the people list
      // No need to loadPeople() anymore - FollowingService handles this automatically

      // Only refresh following feeds if we're on the feeds page
      if (this.router.url.startsWith('/feeds')) {
        await this.feedsCollectionService.refreshFollowingFeeds();
      }

      // Reset followset display state
      this.suggestedProfiles.set([]);
    } catch (error) {
      this.logger.error('Failed to complete followset onboarding:', error);
      this.notificationService.notify('Error completing setup. Please try again.');
    }
  }

  /**
   * Toggle interest selection
   */
  async toggleInterest(interestId: string): Promise<void> {
    this.selectedInterests.update(interests => {
      if (interests.includes(interestId)) {
        return interests.filter(id => id !== interestId);
      } else {
        return [...interests, interestId];
      }
    });

    // Fetch suggested profiles based on selected interests
    await this.updateSuggestedProfiles();
  }

  /**
   * Update suggested profiles based on selected interests
   */
  private async updateSuggestedProfiles(): Promise<void> {
    try {
      const selectedInterests = this.selectedInterests();
      if (selectedInterests.length === 0) {
        this.suggestedProfiles.set([]);
        return;
      }

      const starterPacks = this.followsetService.starterPacks();
      const profiles = await this.followsetService.convertStarterPacksToProfiles(
        starterPacks,
        selectedInterests
      );

      this.suggestedProfiles.set(profiles);
      this.logger.debug(`Updated suggested profiles: ${profiles.length} profiles`);
    } catch (error) {
      this.logger.error('Failed to update suggested profiles:', error);
    }
  }
}
