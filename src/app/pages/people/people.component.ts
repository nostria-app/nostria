import { Component, inject, signal, computed, effect, viewChild, ElementRef, OnDestroy } from '@angular/core';
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
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { PeopleFilterPanelComponent } from './people-filter-panel/people-filter-panel.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { LoggerService } from '../../services/logger.service';
import { debounceTime } from 'rxjs/operators';
import { Subject, firstValueFrom } from 'rxjs';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { Router } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { FavoritesService } from '../../services/favorites.service';
import { MatDialog } from '@angular/material/dialog';
import { AddPersonDialogComponent } from './add-person-dialog.component';
import { EditPeopleListDialogComponent, EditPeopleListDialogResult } from './edit-people-list-dialog.component';
import { CreateListDialogComponent, CreateListDialogResult } from '../../components/create-list-dialog/create-list-dialog.component';
import {
  Interest,
  SuggestedProfile,
} from '../../components/followset/followset.component';
import { Followset } from '../../services/followset';
import { NotificationService } from '../../services/notification.service';
import { FeedsCollectionService } from '../../services/feeds-collection.service';
import { AccountLocalStateService, PeopleFilters } from '../../services/account-local-state.service';
import { FollowingService, FollowingProfile } from '../../services/following.service';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { ProfileHoverCardService } from '../../services/profile-hover-card.service';
import { UtilitiesService } from '../../services/utilities.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';

// Re-export for local use
type FilterOptions = PeopleFilters;

// Define sorting options
type SortOption = 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc' | 'name-asc' | 'name-desc';

// View modes in cycling order
const VIEW_MODES = ['comfortable', 'medium', 'small', 'details'] as const;
type ViewModeType = typeof VIEW_MODES[number];

@Component({
  selector: 'app-people',
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
    OverlayModule,
    PeopleFilterPanelComponent,
  ],
  templateUrl: './people.component.html',
  styleUrls: ['./people.component.scss'],
})
export class PeopleComponent implements OnDestroy {
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
  private hoverCardService = inject(ProfileHoverCardService);
  private utilities = inject(UtilitiesService);
  private twoColumnLayout = inject(TwoColumnLayoutService);

  // Search functionality
  searchTerm = signal<string>('');
  private searchChanged = new Subject<string>();

  // Scroll container reference
  peopleContent = viewChild<ElementRef>('peopleContent');
  scrollSentinel = viewChild<ElementRef>('scrollSentinel');

  // Alphabet navigation
  showAlphabetNav = computed(() => {
    const sort = this.sortOption();
    return sort === 'name-asc' || sort === 'name-desc';
  });
  selectedLetter = signal<string | null>(null);
  availableLetters = computed(() => {
    if (!this.showAlphabetNav()) return [];

    const profiles = this.filteredAndSortedProfiles();
    const letters = new Set<string>();

    profiles.forEach(p => {
      const displayName = ((p.profile?.data?.['display_name'] as string) || '').trim();
      const nameField = ((p.profile?.data?.['name'] as string) || '').trim();
      const name = displayName || nameField;

      if (name) {
        const firstChar = name.charAt(0).toUpperCase();
        if (/[A-Z]/.test(firstChar)) {
          letters.add(firstChar);
        } else if (/[0-9]/.test(firstChar)) {
          letters.add('#');
        }
      }
    });

    const sorted = Array.from(letters).sort();
    // Move # to the end if it exists
    const hashIndex = sorted.indexOf('#');
    if (hashIndex !== -1) {
      sorted.splice(hashIndex, 1);
      sorted.push('#');
    }
    return sorted;
  });

  // Intersection observer for infinite scroll
  private scrollObserver?: IntersectionObserver;

  // View mode
  viewMode = signal<ViewModeType>('medium');

  // Filter panel state
  filterPanelOpen = signal(false);
  filterPanelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

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
  followSetProfiles = signal<FollowingProfile[]>([]);
  loadingFollowSetProfiles = signal(false);

  // All follow sets (no limit for dropdown in People component)
  allFollowSets = computed(() => {
    const sets = this.followSetsService.followSets();
    return [...sets].sort((a, b) => a.title.localeCompare(b.title));
  });

  // Read query parameters
  private queryParams = toSignal(this.route.queryParams);

  // Computed signal for filtered and sorted people using FollowingService
  filteredAndSortedProfiles = computed(() => {
    const search = this.searchTerm();
    const filters = this.filters();
    const sortOption = this.sortOption();
    const selectedSet = this.selectedFollowSet();
    const followSetProfiles = this.followSetProfiles();

    // If a follow set is selected, use ONLY the loaded follow set profiles
    if (selectedSet) {
      // Apply search if applicable
      let profiles = search
        ? followSetProfiles.filter(p => {
          const name = (p.profile?.data?.['name'] as string)?.toLowerCase?.() || '';
          const displayName = (p.profile?.data?.['display_name'] as string)?.toLowerCase?.() || '';
          const nip05 = (p.profile?.data?.['nip05'] as string)?.toLowerCase?.() || '';
          const searchLower = search.toLowerCase();
          return name.includes(searchLower) ||
            displayName.includes(searchLower) ||
            nip05.includes(searchLower);
        })
        : followSetProfiles;

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
      filters,
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
      case 'comfortable':
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
    // Set wide left panel (1400px) like Music component
    this.twoColumnLayout.setWideLeft();

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
        if (savedViewMode && VIEW_MODES.includes(savedViewMode as ViewModeType)) {
          this.viewMode.set(savedViewMode as ViewModeType);
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

    // Setup infinite scroll when sentinel becomes available
    effect(() => {
      const sentinel = this.scrollSentinel();
      if (sentinel) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => this.setupInfiniteScroll(), 100);
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

  private setupInfiniteScroll(): void {
    const sentinel = this.scrollSentinel();
    if (!sentinel) return;

    // Disconnect existing observer
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    // Create intersection observer for infinite scrolling
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && this.hasMorePeople() && !this.isLoading()) {
          this.loadMore();
        }
      },
      {
        root: null, // Use viewport as root
        rootMargin: '400px', // Load more when user is 400px from the bottom
        threshold: 0,
      }
    );

    // Observe the sentinel element
    this.scrollObserver.observe(sentinel.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }
  }

  changeViewMode(mode: ViewModeType) {
    this.viewMode.set(mode);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setPeopleViewMode(pubkey, mode);
    }
  }

  /**
   * Cycle through view modes on button click
   */
  cycleViewMode() {
    const currentIndex = VIEW_MODES.indexOf(this.viewMode());
    const nextIndex = (currentIndex + 1) % VIEW_MODES.length;
    this.changeViewMode(VIEW_MODES[nextIndex]);
  }

  /**
   * Get icon for current view mode
   */
  getViewModeIcon(): string {
    switch (this.viewMode()) {
      case 'comfortable':
        return 'view_agenda';
      case 'medium':
        return 'view_module';
      case 'small':
        return 'apps';
      case 'details':
        return 'view_list';
      default:
        return 'view_module';
    }
  }

  /**
   * Toggle filter panel visibility
   */
  toggleFilterPanel(): void {
    this.filterPanelOpen.update(v => !v);
  }

  /**
   * Close filter panel
   */
  closeFilterPanel(): void {
    this.filterPanelOpen.set(false);
  }

  /**
   * Handle filter changes from filter panel
   */
  onFiltersChanged(changes: Partial<FilterOptions>): void {
    this.filters.update(current => ({
      ...current,
      ...changes,
    }));
    // Reset display limit when filters change
    this.displayLimit.set(this.PAGE_SIZE);
  }

  /**
   * Handle sort option changes from filter panel
   */
  onSortOptionChanged(option: SortOption): void {
    this.changeSortOption(option);
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

  /**
   * Select a contact to view in the right panel
   */
  selectContact(pubkey: string) {
    // Close any open hover card to prevent interference
    this.hoverCardService.closeHoverCard();
    // Navigate to profile in right panel
    this.router.navigate([{ outlets: { right: ['p', pubkey] } }]);
  }

  /**
   * Scroll to a specific letter in the alphabet navigation
   */
  scrollToLetter(letter: string) {
    this.selectedLetter.set(letter);

    const profiles = this.filteredAndSortedProfiles();
    const index = profiles.findIndex(p => {
      const displayName = ((p.profile?.data?.display_name as string) || '').trim();
      const nameField = ((p.profile?.data?.name as string) || '').trim();
      const name = displayName || nameField;

      if (!name) return false;

      const firstChar = name.charAt(0).toUpperCase();
      if (letter === '#') {
        return /[0-9]/.test(firstChar);
      }
      return firstChar === letter;
    });

    if (index !== -1) {
      // Ensure we have loaded enough items to reach this index
      if (index >= this.displayLimit()) {
        this.displayLimit.set(Math.min(index + 50, this.sortedPeople().length));
        // Wait for the DOM to update
        setTimeout(() => this.scrollToLetterElement(index), 100);
      } else {
        this.scrollToLetterElement(index);
      }
    }
  }

  /**
   * Helper to scroll to a specific element by index
   */
  private scrollToLetterElement(index: number) {
    const sortedPeople = this.sortedPeople();
    if (index < 0 || index >= sortedPeople.length) return;

    const pubkey = sortedPeople[index];
    const container = this.peopleContent();
    if (!container) return;

    const element = container.nativeElement.querySelector(`[data-pubkey="${pubkey}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Select a follow set to filter people
   */
  async selectFollowSet(followSet: FollowSet | null) {
    // Reset display limit when follow set changes
    this.displayLimit.set(this.PAGE_SIZE);

    // Clear search when selecting a follow set
    if (followSet) {
      this.updateSearch('');

      // Load profiles for all pubkeys in the follow set
      this.loadingFollowSetProfiles.set(true);
      try {
        const profiles = await this.followingService.loadProfilesForPubkeys(followSet.pubkeys);
        // Only update the selected set and profiles after loading is complete
        // This prevents the flicker where "All Following" shows during loading
        this.selectedFollowSet.set(followSet);
        this.followSetProfiles.set(profiles);
      } catch (error) {
        console.error('Failed to load follow set profiles:', error);
        // On error, still set the follow set but with empty profiles
        this.selectedFollowSet.set(followSet);
        this.followSetProfiles.set([]);
      } finally {
        this.loadingFollowSetProfiles.set(false);
      }

      // Update URL query parameter to maintain selection
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { set: followSet.dTag },
        queryParamsHandling: 'merge'
      });
    } else {
      // When clearing selection, update immediately
      this.selectedFollowSet.set(null);
      this.followSetProfiles.set([]);

      // Clear the query parameter when deselecting
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { set: null },
        queryParamsHandling: 'merge'
      });
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
      data: {
        followSet: this.selectedFollowSet(), // Pass the currently selected follow set (null if "All Following")
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.logger.info('Person added:', result);
        // FollowingService will automatically reload when following list changes
        // If a follow set was selected, reload it
        const selectedSet = this.selectedFollowSet();
        if (selectedSet) {
          this.selectFollowSet(selectedSet);
        }
      }
    });
  }

  async createNewList(): Promise<void> {
    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      data: {
        initialPrivate: false,
      },
      width: '450px',
    });

    const result: CreateListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());

    if (!result || !result.title.trim()) {
      return;
    }

    try {
      // Create new list with empty array (will be encrypted if private)
      const newSet = await this.followSetsService.createFollowSet(
        result.title.trim(),
        [], // Empty array - will be encrypted if isPrivate is true
        result.isPrivate
      );

      if (newSet) {
        this.notificationService.notify(`List "${newSet.title}" created successfully`);
      } else {
        this.notificationService.notify('Failed to create list');
      }
    } catch (error) {
      this.logger.error('Failed to create list:', error);
      this.notificationService.notify('Failed to create list');
    }
  }

  async openEditListDialog(): Promise<void> {
    const selectedSet = this.selectedFollowSet();
    if (!selectedSet) {
      this.logger.warn('No follow set selected for editing');
      return;
    }

    const dialogRef = this.dialog.open(EditPeopleListDialogComponent, {
      data: {
        followSet: selectedSet,
      },
      width: '500px',
      maxWidth: '90vw',
    });

    const result: EditPeopleListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());

    if (result) {
      if (result.deleted) {
        // List was deleted, clear selection and go back to "All Following"
        this.logger.info('List deleted:', selectedSet.title);
        this.selectFollowSet(null);
      } else if (result.removedPubkeys.length > 0) {
        this.logger.info('List updated, removed pubkeys:', result.removedPubkeys);
        // Reload the profiles for the updated follow set
        await this.selectFollowSet(result.followSet);
      }
    }
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
