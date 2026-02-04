import { Component, inject, signal, computed, effect, viewChild, ElementRef, OnDestroy, untracked, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
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
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { TrustService } from '../../services/trust.service';

// Re-export for local use
type FilterOptions = PeopleFilters;

// Define sorting options
type SortOption = 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc' | 'name-asc' | 'name-desc';

// View modes in cycling order
const VIEW_MODES = ['comfortable', 'medium', 'small', 'details'] as const;
type ViewModeType = typeof VIEW_MODES[number];

@Component({
  selector: 'app-people',
  host: { 'class': 'panel-with-sticky-header' },
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private trustService = inject(TrustService);
  private destroyRef = inject(DestroyRef);

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
  alphabetNavElement = viewChild<ElementRef>('alphabetNav');
  private isTouchSwiping = false;

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
  selectedFollowSetDTag = signal<string | null>(null);
  followSetProfiles = signal<FollowingProfile[]>([]);

  // All follow sets (no limit for dropdown in People component)
  allFollowSets = computed(() => {
    const sets = this.followSetsService.followSets();
    return [...sets].sort((a, b) => a.title.localeCompare(b.title));
  });

  // Computed: Get the favorites set (if exists)
  favoritesSet = computed(() => {
    return this.allFollowSets().find(set => set.dTag === 'nostria-favorites') || null;
  });

  // Computed: Get all follow sets except favorites (sorted alphabetically)
  otherFollowSets = computed(() => {
    return this.allFollowSets().filter(set => set.dTag !== 'nostria-favorites');
  });

  // Computed: Get the selected follow set reactively from the service
  // This ensures we always have the latest version with updated pubkeys
  selectedFollowSet = computed(() => {
    const dTag = this.selectedFollowSetDTag();
    if (!dTag) return null;
    return this.followSetsService.getFollowSetByDTag(dTag) ?? null;
  });

  // Read route parameters for setId
  private routeParams = toSignal(this.route.paramMap);

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

  // Extract pubkeys for rendering (deduplicated to avoid @for track errors)
  sortedPeople = computed(() => {
    const pubkeys = this.filteredAndSortedProfiles().map(p => p.pubkey);
    // Remove duplicates while preserving order
    return [...new Set(pubkeys)];
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
  // Note: Follow set list loading is non-blocking - the list renders immediately with pubkeys,
  // and individual user-profile components load their own data via intersection observer
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
    this.searchChanged.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(term => {
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

    // Watch for 'setId' route parameter and select the corresponding follow set
    // This effect ONLY handles route-driven selection (e.g., deep linking, back/forward navigation)
    // It should NOT interfere with user-initiated selection from the dropdown menu
    effect(() => {
      const params = this.routeParams();
      const setDTag = params?.get('setId');
      const followSets = this.allFollowSets();
      const hasInitiallyLoaded = this.followSetsService.hasInitiallyLoaded();

      // Only proceed if params have been initialized (not undefined)
      if (params === undefined) {
        return;
      }

      // Wait for follow sets to be initially loaded before making decisions
      if (!hasInitiallyLoaded) {
        return;
      }

      // If there's a setId in the URL, try to select that list
      if (setDTag && followSets.length > 0) {
        const matchingSet = followSets.find(s => s.dTag === setDTag);
        if (matchingSet) {
          // Only update if the selection actually needs to change
          // Use untracked to avoid creating a dependency on selectedFollowSet
          const currentDTag = untracked(() => this.selectedFollowSet()?.dTag);
          if (currentDTag !== setDTag) {
            this.selectFollowSetFromRoute(matchingSet);
          }
        }
      } else if (!setDTag) {
        // No setId in URL - clear selection if we have one
        // Use untracked to avoid creating a dependency on selectedFollowSet
        const hasSelection = untracked(() => this.selectedFollowSet() !== null);
        if (hasSelection) {
          this.clearFollowSetSelection();
        }
      }
    });

    // Effect to watch for changes in the selected follow set's pubkeys
    // This enables instant UI updates when a user is added to or removed from a list
    effect(() => {
      const selectedSet = this.selectedFollowSet();
      if (!selectedSet) return;

      // Track pubkeys - when these change, we need to reload profiles
      const pubkeys = selectedSet.pubkeys;
      const currentProfiles = untracked(() => this.followSetProfiles());
      const currentPubkeys = new Set(currentProfiles.map(p => p.pubkey));

      // Check if pubkeys have changed
      const pubkeysChanged = pubkeys.length !== currentPubkeys.size ||
        pubkeys.some(pk => !currentPubkeys.has(pk));

      if (pubkeysChanged) {
        this.logger.debug('[People] Follow set pubkeys changed, reloading profiles');
        untracked(() => {
          // Immediately update with minimal profiles for new pubkeys
          this.setMinimalFollowSetProfiles(pubkeys);
          // Background load full profile data
          this.loadFollowSetProfilesInBackground(pubkeys);
        });
      }
    }, { allowSignalWrites: true });

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
   * Get icon for current view mode - computed signal for better change detection
   */
  viewModeIcon = computed(() => {
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
  });

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
    const currentShowRank = this.filters().showRank;
    this.filters.update(current => ({
      ...current,
      ...changes,
    }));
    // Reset display limit when filters change
    this.displayLimit.set(this.PAGE_SIZE);

    // If showRank was toggled ON, trigger trust rank download for current list
    if (changes.showRank === true && !currentShowRank) {
      this.downloadTrustRanksForCurrentList();
    }
  }

  /**
   * Handle refresh trust ranks button click
   */
  onRefreshTrustRanks(): void {
    this.downloadTrustRanksForCurrentList();
  }

  /**
   * Download trust ranks for all people in the current filtered list
   */
  private async downloadTrustRanksForCurrentList(): Promise<void> {
    const pubkeys = this.sortedPeople();
    if (pubkeys.length === 0) {
      return;
    }

    this.logger.info(`[People] Downloading trust ranks for ${pubkeys.length} people`);

    try {
      // Use batch fetch from TrustService for efficiency
      await this.trustService.fetchMetricsBatch(pubkeys);
      this.logger.info(`[People] Trust ranks download completed for ${pubkeys.length} people`);
    } catch (error) {
      this.logger.error('[People] Failed to download trust ranks:', error);
    }
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
    // Use two-column layout service to open profile in right panel
    this.twoColumnLayout.openProfile(pubkey);
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
   * Handle touch start on alphabet navigation for swipe gesture
   */
  onAlphabetTouchStart(event: TouchEvent) {
    this.isTouchSwiping = true;
    this.handleAlphabetTouch(event);
  }

  /**
   * Handle touch move on alphabet navigation for swipe gesture
   */
  onAlphabetTouchMove(event: TouchEvent) {
    if (!this.isTouchSwiping) return;
    event.preventDefault(); // Prevent page scrolling while swiping
    this.handleAlphabetTouch(event);
  }

  /**
   * Handle touch end on alphabet navigation
   */
  onAlphabetTouchEnd() {
    this.isTouchSwiping = false;
  }

  /**
   * Determine which letter is under the touch point and scroll to it
   */
  private handleAlphabetTouch(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    const alphabetNav = this.alphabetNavElement();
    if (!alphabetNav) return;

    // Get the element under the touch point
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;

    // Check if the element is a letter button (or get its parent if it's a child)
    const letterButton = element.closest('.letter-button') as HTMLElement;
    if (letterButton) {
      const letter = letterButton.textContent?.trim();
      if (letter && this.availableLetters().includes(letter)) {
        // Only trigger if it's a different letter than currently selected
        if (letter !== this.selectedLetter()) {
          this.scrollToLetter(letter);
        }
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

      // Set the selected follow set dTag immediately to prevent the route effect
      // from re-triggering selectFollowSet when the URL changes
      this.selectedFollowSetDTag.set(followSet.dTag);

      // Update URL to the clean path format (do this early so URL reflects selection)
      this.router.navigate(['/people/list', followSet.dTag]);

      // Immediately set minimal profiles from pubkeys so the UI renders instantly
      // The individual user-profile components will load their own data via intersection observer
      this.setMinimalFollowSetProfiles(followSet.pubkeys);

      // Background load full profile data for sorting/filtering purposes (non-blocking)
      this.loadFollowSetProfilesInBackground(followSet.pubkeys);
    } else {
      // When clearing selection, update immediately
      this.selectedFollowSetDTag.set(null);
      this.followSetProfiles.set([]);

      // Navigate back to the main people page
      this.router.navigate(['/people']);
    }
  }

  /**
   * Select a follow set from route navigation (deep link, back/forward)
   * This doesn't navigate since we're responding to a route change
   */
  private async selectFollowSetFromRoute(followSet: FollowSet) {
    this.displayLimit.set(this.PAGE_SIZE);
    this.updateSearch('');
    this.selectedFollowSetDTag.set(followSet.dTag);

    // Immediately set minimal profiles from pubkeys so the UI renders instantly
    this.setMinimalFollowSetProfiles(followSet.pubkeys);

    // Background load full profile data for sorting/filtering purposes (non-blocking)
    this.loadFollowSetProfilesInBackground(followSet.pubkeys);
  }

  /**
   * Clear follow set selection from route navigation
   * This doesn't navigate since we're responding to a route change
   */
  private clearFollowSetSelection() {
    this.displayLimit.set(this.PAGE_SIZE);
    this.selectedFollowSetDTag.set(null);
    this.followSetProfiles.set([]);
  }

  /**
   * Set minimal profiles from pubkeys for immediate UI rendering.
   * This allows the list to render instantly without waiting for profile data.
   * The individual user-profile components will load their own data via intersection observer.
   */
  private setMinimalFollowSetProfiles(pubkeys: string[]): void {
    const minimalProfiles: FollowingProfile[] = pubkeys.map(pubkey => ({
      pubkey,
      event: null,
      profile: null,
      info: null,
      trust: null,
      metric: null,
      lastUpdated: Date.now(),
    }));
    this.followSetProfiles.set(minimalProfiles);
  }

  /**
   * Background load full profile data for sorting/filtering purposes.
   * This runs in the background without blocking the UI.
   */
  private loadFollowSetProfilesInBackground(pubkeys: string[]): void {
    // Don't await - let it run in background
    this.followingService.loadProfilesForPubkeys(pubkeys).then(profiles => {
      // Only update if the profiles are for the currently selected set
      // (user might have navigated away)
      const currentProfiles = this.followSetProfiles();
      if (currentProfiles.length === pubkeys.length &&
        currentProfiles[0]?.pubkey === pubkeys[0]) {
        this.followSetProfiles.set(profiles);
      }
    }).catch(error => {
      console.error('Failed to load follow set profiles in background:', error);
    });
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

  /**
   * Navigate to Summary page filtered by the selected list
   */
  goToSummary(): void {
    const selectedSet = this.selectedFollowSet();
    if (selectedSet) {
      this.router.navigate(['/summary'], {
        queryParams: { list: selectedSet.dTag }
      });
    } else {
      this.router.navigate(['/summary']);
    }
  }

  /**
   * Navigate to Feeds page with the list feed
   */
  goToFeeds(): void {
    const selectedSet = this.selectedFollowSet();
    if (selectedSet) {
      this.router.navigate(['/f'], {
        queryParams: { l: selectedSet.dTag }
      });
    } else {
      this.router.navigate(['/f']);
    }
  }

  /**
   * Navigate to Streams page filtered by the selected list
   */
  goToStreams(): void {
    const selectedSet = this.selectedFollowSet();
    if (selectedSet) {
      this.router.navigate(['/streams'], {
        queryParams: { list: selectedSet.dTag }
      });
    } else {
      this.router.navigate(['/streams']);
    }
  }

  /**
   * Navigate to Articles page filtered by the selected list
   */
  goToArticles(): void {
    const selectedSet = this.selectedFollowSet();
    if (selectedSet) {
      this.router.navigate(['/articles'], {
        queryParams: { list: selectedSet.dTag }
      });
    } else {
      this.router.navigate(['/articles']);
    }
  }

  /**
   * Navigate to Music page filtered by the selected list
   */
  goToMusic(): void {
    const selectedSet = this.selectedFollowSet();
    if (selectedSet) {
      this.router.navigate(['/music'], {
        queryParams: { list: selectedSet.dTag }
      });
    } else {
      this.router.navigate(['/music']);
    }
  }

  openAddPersonDialog() {
    const selectedSet = this.selectedFollowSet();
    this.logger.debug('[People] Opening add person dialog with follow set:', selectedSet?.title ?? 'None (All Following)');

    const dialogRef = this.dialog.open(AddPersonDialogComponent, {
      width: '600px',
      // maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: false,
      autoFocus: true,
      data: {
        followSet: selectedSet, // Pass the currently selected follow set (null if "All Following")
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.logger.info('Person added:', result);
        // The effect watching selectedFollowSet pubkeys will automatically
        // reload profiles when the follow set is updated in the service
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
        // Auto-select the newly created list
        await this.selectFollowSet(newSet);
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
