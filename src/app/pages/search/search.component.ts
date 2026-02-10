import { Component, OnInit, OnDestroy, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Subscription } from 'rxjs';
import { Event, kinds } from 'nostr-tools';
import { DatabaseService } from '../../services/database.service';
import { SearchRelayService } from '../../services/relays/search-relay';
import { FollowingService } from '../../services/following.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { NostrRecord } from '../../interfaces';
import { EventComponent } from '../../components/event/event.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

export type SearchSource = 'all' | 'local' | 'relays';
export type SearchType = 'all' | 'profiles' | 'notes' | 'articles' | 'hashtags';

export interface SearchProgress {
  currentStep: number;
  totalSteps: number;
  message: string;
  elapsedSeconds: number;
  resultsFoundSoFar: number;
}

interface SearchResultItem {
  event: Event;
  source: 'local' | 'relay';
  type: 'profile' | 'note' | 'article';
}

@Component({
  selector: 'app-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatCardModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatDividerModule,
    EventComponent,
    UserProfileComponent,
  ],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private database = inject(DatabaseService);
  private searchRelay = inject(SearchRelayService);
  private followingService = inject(FollowingService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private logger = inject(LoggerService);
  protected utilities = inject(UtilitiesService);

  private queryParamsSubscription?: Subscription;

  // Search state
  searchQuery = signal('');
  searchSource = signal<SearchSource>('all');
  searchType = signal<SearchType>('all');
  isSearching = signal(false);
  hasSearched = signal(false);
  searchProgress = signal<SearchProgress | null>(null);

  // Timer for elapsed time tracking
  private searchStartTime = 0;
  private elapsedTimerHandle: ReturnType<typeof setInterval> | null = null;

  // Results
  profileResults = signal<SearchResultItem[]>([]);
  noteResults = signal<SearchResultItem[]>([]);
  articleResults = signal<SearchResultItem[]>([]);

  // Computed counts
  totalResults = computed(() =>
    this.profileResults().length + this.noteResults().length + this.articleResults().length
  );

  profileCount = computed(() => this.profileResults().length);
  noteCount = computed(() => this.noteResults().length);
  articleCount = computed(() => this.articleResults().length);

  // Sorted profile results - followed accounts appear first
  sortedProfileResults = computed(() => {
    const results = this.profileResults();
    const isFollowing = this.accountState.isFollowing();

    return [...results].sort((a, b) => {
      const aFollowing = isFollowing(a.event.pubkey);
      const bFollowing = isFollowing(b.event.pubkey);

      // Followed accounts come first
      if (aFollowing && !bFollowing) return -1;
      if (!aFollowing && bFollowing) return 1;

      // Within same group, sort by created_at (newest first)
      return b.event.created_at - a.event.created_at;
    });
  });

  // Tab index
  selectedTabIndex = signal(0);

  // Search options
  searchOptions = {
    includeExpired: false,
    maxResults: 100,
  };

  ngOnInit() {
    // Subscribe to query param changes to react when URL changes
    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      const newQuery = params['q'] || '';
      const newType = params['type'] as SearchType || 'all';
      const newSource = params['source'] as SearchSource || 'all';

      // Only update and search if the query changed
      const queryChanged = newQuery !== this.searchQuery();
      const typeChanged = newType !== this.searchType();
      const sourceChanged = newSource !== this.searchSource();

      if (newQuery) {
        this.searchQuery.set(newQuery);
      }
      if (params['type']) {
        this.searchType.set(newType);
      }
      if (params['source']) {
        this.searchSource.set(newSource);
      }

      // Perform search if query is provided and something changed
      if (newQuery && (queryChanged || typeChanged || sourceChanged)) {
        this.performSearch();
      }
    });
  }

  ngOnDestroy() {
    this.queryParamsSubscription?.unsubscribe();
    this.stopElapsedTimer();
  }

  /**
   * Helper to create a SearchProgress object with elapsed time and results count.
   */
  private makeProgress(currentStep: number, totalSteps: number, message: string): SearchProgress {
    return {
      currentStep,
      totalSteps,
      message,
      elapsedSeconds: Math.floor((Date.now() - this.searchStartTime) / 1000),
      resultsFoundSoFar: this.totalResults(),
    };
  }

  /**
   * Starts a timer that updates the elapsed time in the progress display every second.
   */
  private startElapsedTimer(): void {
    this.searchStartTime = Date.now();
    this.stopElapsedTimer();
    this.elapsedTimerHandle = setInterval(() => {
      const current = this.searchProgress();
      if (current) {
        this.searchProgress.set(this.makeProgress(
          current.currentStep, current.totalSteps, current.message
        ));
      }
    }, 1000);
  }

  /**
   * Stops the elapsed time timer.
   */
  private stopElapsedTimer(): void {
    if (this.elapsedTimerHandle !== null) {
      clearInterval(this.elapsedTimerHandle);
      this.elapsedTimerHandle = null;
    }
  }

  onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.performSearch();
    }
  }

  updateQueryParams() {
    const queryParams: Record<string, string> = {};
    if (this.searchQuery()) {
      queryParams['q'] = this.searchQuery();
    }
    if (this.searchType() !== 'all') {
      queryParams['type'] = this.searchType();
    }
    if (this.searchSource() !== 'all') {
      queryParams['source'] = this.searchSource();
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  async performSearch() {
    const query = this.searchQuery().trim();
    if (!query) {
      return;
    }

    this.isSearching.set(true);
    this.hasSearched.set(true);
    this.updateQueryParams();

    // Clear previous results
    this.profileResults.set([]);
    this.noteResults.set([]);
    this.articleResults.set([]);

    try {
      const source = this.searchSource();
      const type = this.searchType();
      const isHashtagSearch = query.startsWith('#');

      // Parse kind filter from query (e.g., "kind:30030")
      const { cleanQuery, kindFilter } = this.parseSearchQuery(query);

      // Calculate total search steps for progress tracking
      const totalSteps = this.calculateTotalSteps(source, type, kindFilter);
      let currentStep = 0;

      // Start elapsed time tracking
      this.startElapsedTimer();

      // Search based on source preference
      if (source === 'all' || source === 'local') {
        this.searchProgress.set(this.makeProgress(currentStep, totalSteps, 'Searching local database...'));
        await this.searchLocal(cleanQuery, type, isHashtagSearch, kindFilter);
        currentStep++;
      }

      if (source === 'all' || source === 'relays') {
        currentStep = await this.searchRelaysWithProgress(
          cleanQuery, type, isHashtagSearch, kindFilter, currentStep, totalSteps
        );
      }

      this.searchProgress.set(this.makeProgress(totalSteps, totalSteps, 'Search complete'));

      // Set appropriate tab based on results
      this.selectBestTab();
    } catch (error) {
      this.logger.error('Search failed', error);
      this.layout.toast('Search failed. Please try again.');
    } finally {
      this.isSearching.set(false);
      this.searchProgress.set(null);
      this.stopElapsedTimer();
    }
  }

  /**
   * Parse search query to extract kind filter according to NIP-50
   * Example: "kind:30030" -> { cleanQuery: "", kindFilter: [30030] }
   * Example: "kind:30030 emoji" -> { cleanQuery: "emoji", kindFilter: [30030] }
   */
  private parseSearchQuery(query: string): { cleanQuery: string; kindFilter?: number[] } {
    const kindMatch = query.match(/kind:(\d+)/i);

    if (kindMatch) {
      const kind = parseInt(kindMatch[1], 10);
      // Remove the kind:XXXX part from the query
      const cleanQuery = query.replace(/kind:\d+/gi, '').trim();
      return { cleanQuery, kindFilter: [kind] };
    }

    return { cleanQuery: query };
  }

  private async searchLocal(query: string, type: SearchType, isHashtagSearch: boolean, kindFilter?: number[]) {
    this.logger.debug(`Searching local database for: ${query}`, { kindFilter });

    // If kind filter is specified, only search for those kinds
    if (kindFilter) {
      const localEvents = await this.searchLocalEvents(query, kindFilter, isHashtagSearch);

      // Categorize results based on kind
      for (const event of localEvents) {
        if (event.kind === 0) {
          this.profileResults.update(current => [...current, {
            event,
            source: 'local' as const,
            type: 'profile' as const,
          }]);
        } else if (event.kind === kinds.ShortTextNote) {
          this.noteResults.update(current => [...current, {
            event,
            source: 'local' as const,
            type: 'note' as const,
          }]);
        } else if (event.kind === kinds.LongFormArticle) {
          this.articleResults.update(current => [...current, {
            event,
            source: 'local' as const,
            type: 'article' as const,
          }]);
        } else {
          // For other kinds (like 30030), add to notes tab
          this.noteResults.update(current => [...current, {
            event,
            source: 'local' as const,
            type: 'note' as const,
          }]);
        }
      }
      return;
    }

    // Search profiles locally
    if (type === 'all' || type === 'profiles') {
      const followingProfiles = this.followingService.searchProfiles(query);
      const profileRecords = this.followingService.toNostrRecords(followingProfiles);

      const profileItems: SearchResultItem[] = profileRecords.map(record => ({
        event: record.event,
        source: 'local' as const,
        type: 'profile' as const,
      }));

      this.profileResults.update(current => [...current, ...profileItems]);
    }

    // Search notes locally by content or tags
    if (type === 'all' || type === 'notes' || type === 'hashtags') {
      const localNotes = await this.searchLocalEvents(query, [kinds.ShortTextNote], isHashtagSearch);
      const noteItems: SearchResultItem[] = localNotes.map(event => ({
        event,
        source: 'local' as const,
        type: 'note' as const,
      }));

      this.noteResults.update(current => [...current, ...noteItems]);
    }

    // Search articles locally
    if (type === 'all' || type === 'articles') {
      const localArticles = await this.searchLocalEvents(query, [kinds.LongFormArticle], isHashtagSearch);
      const articleItems: SearchResultItem[] = localArticles.map(event => ({
        event,
        source: 'local' as const,
        type: 'article' as const,
      }));

      this.articleResults.update(current => [...current, ...articleItems]);
    }
  }

  private async searchLocalEvents(query: string, eventKinds: number[], isHashtagSearch: boolean): Promise<Event[]> {
    const results: Event[] = [];
    const queryLower = query.toLowerCase();
    const hashtag = isHashtagSearch ? query.slice(1).toLowerCase() : null;

    for (const kind of eventKinds) {
      try {
        const events = await this.database.getEventsByKind(kind);

        for (const event of events) {
          // Skip expired events unless option is enabled
          if (!this.searchOptions.includeExpired && this.utilities.isEventExpired(event)) {
            continue;
          }

          let matches = false;

          if (isHashtagSearch && hashtag) {
            // Search by hashtag tag
            matches = event.tags.some(tag =>
              tag[0] === 't' && tag[1]?.toLowerCase() === hashtag
            );
          } else {
            // Search by content
            matches = event.content.toLowerCase().includes(queryLower);
          }

          if (matches) {
            results.push(event);
          }

          // Limit results
          if (results.length >= this.searchOptions.maxResults) {
            break;
          }
        }
      } catch (error) {
        this.logger.error(`Failed to search local events for kind ${kind}`, error);
      }
    }

    // Sort by created_at descending
    return results.sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * Calculate the total number of search steps for progress tracking.
   * Steps depend on the source and type filters.
   */
  calculateTotalSteps(source: SearchSource, type: SearchType, kindFilter?: number[]): number {
    let steps = 0;

    // Local search is always 1 step
    if (source === 'all' || source === 'local') {
      steps += 1;
    }

    // Relay search steps depend on type and kind filter
    if (source === 'all' || source === 'relays') {
      if (kindFilter) {
        steps += 1; // Single relay search for specific kind
      } else if (type === 'all') {
        steps += 3; // Profiles + Notes + Articles
      } else {
        steps += 1; // Single type search
      }
    }

    return steps;
  }

  /**
   * Search relays with progress tracking, updating the searchProgress signal
   * as each sub-search completes.
   */
  private async searchRelaysWithProgress(
    query: string, type: SearchType, isHashtagSearch: boolean,
    kindFilter: number[] | undefined, currentStep: number, totalSteps: number,
  ): Promise<number> {
    this.logger.debug(`Searching relays for: ${query}`, { kindFilter });

    try {
      if (kindFilter) {
        this.searchProgress.set(this.makeProgress(
          currentStep, totalSteps,
          `Querying relays for kind ${kindFilter.join(', ')} events...`,
        ));
        const events = await this.searchRelay.search(query, kindFilter, 50);
        const existingIds = new Set(this.noteResults().map(r => r.event.id));

        const newResults: SearchResultItem[] = events
          .filter(event => !existingIds.has(event.id))
          .map(event => ({
            event,
            source: 'relay' as const,
            type: 'note' as const,
          }));

        this.noteResults.update(current => [...current, ...newResults]);
        return currentStep + 1;
      }

      // Search profiles on relays
      if (type === 'all' || type === 'profiles') {
        this.searchProgress.set(this.makeProgress(
          currentStep, totalSteps,
          'Searching relays for profiles...',
        ));
        const profileEvents = await this.searchRelay.searchProfiles(query, 20);
        const existingPubkeys = new Set(this.profileResults().map(r => r.event.pubkey));

        const newProfiles: SearchResultItem[] = profileEvents
          .filter(event => !existingPubkeys.has(event.pubkey))
          .map(event => ({
            event,
            source: 'relay' as const,
            type: 'profile' as const,
          }));

        this.profileResults.update(current => [...current, ...newProfiles]);
        currentStep++;
      }

      // Search notes on relays
      if (type === 'all' || type === 'notes' || type === 'hashtags') {
        this.searchProgress.set(this.makeProgress(
          currentStep, totalSteps,
          'Searching relays for notes...',
        ));
        const searchQuery = isHashtagSearch ? query : query;
        const noteEvents = await this.searchRelay.search(searchQuery, [kinds.ShortTextNote], 50);
        const existingIds = new Set(this.noteResults().map(r => r.event.id));

        const newNotes: SearchResultItem[] = noteEvents
          .filter(event => !existingIds.has(event.id))
          .map(event => ({
            event,
            source: 'relay' as const,
            type: 'note' as const,
          }));

        this.noteResults.update(current => [...current, ...newNotes]);
        currentStep++;
      }

      // Search articles on relays
      if (type === 'all' || type === 'articles') {
        this.searchProgress.set(this.makeProgress(
          currentStep, totalSteps,
          'Searching relays for articles...',
        ));
        const articleEvents = await this.searchRelay.search(query, [kinds.LongFormArticle], 20);
        const existingIds = new Set(this.articleResults().map(r => r.event.id));

        const newArticles: SearchResultItem[] = articleEvents
          .filter(event => !existingIds.has(event.id))
          .map(event => ({
            event,
            source: 'relay' as const,
            type: 'article' as const,
          }));

        this.articleResults.update(current => [...current, ...newArticles]);
        currentStep++;
      }
    } catch (error) {
      this.logger.error('Failed to search relays', error);
    }

    return currentStep;
  }

  private selectBestTab() {
    // Select the tab with the most results
    const counts = [
      { index: 0, count: this.profileCount() + this.noteCount() + this.articleCount() }, // All
      { index: 1, count: this.profileCount() },
      { index: 2, count: this.noteCount() },
      { index: 3, count: this.articleCount() },
    ];

    // If current tab has results, keep it
    const currentCount = counts[this.selectedTabIndex()].count;
    if (currentCount > 0) {
      return;
    }

    // Otherwise, find first tab with results
    for (const { index, count } of counts) {
      if (count > 0) {
        this.selectedTabIndex.set(index);
        return;
      }
    }
  }

  openProfile(pubkey: string) {
    this.layout.openProfile(pubkey);
  }

  openEvent(eventId: string) {
    this.layout.openGenericEvent(eventId);
  }

  clearSearch() {
    this.searchQuery.set('');
    this.profileResults.set([]);
    this.noteResults.set([]);
    this.articleResults.set([]);
    this.hasSearched.set(false);
    this.searchProgress.set(null);

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  getProfileData(event: Event): NostrRecord['data'] | null {
    try {
      return JSON.parse(event.content);
    } catch {
      return null;
    }
  }

  getArticleTitle(event: Event): string {
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Untitled Article';
  }

  getArticleSummary(event: Event): string {
    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    if (summaryTag?.[1]) {
      return summaryTag[1];
    }
    // Fallback to first 200 chars of content
    return event.content.slice(0, 200) + (event.content.length > 200 ? '...' : '');
  }

  getArticleImage(event: Event): string | null {
    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
  }

  trackByEventId(index: number, item: SearchResultItem): string {
    return `${item.source}-${item.event.id}-${index}`;
  }
}
