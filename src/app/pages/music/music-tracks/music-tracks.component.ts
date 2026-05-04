import { Component, inject, signal, computed, OnDestroy, OnInit, ChangeDetectionStrategy, AfterViewInit, ElementRef, viewChild, input } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { ReportingService } from '../../../services/reporting.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { MusicDataService } from '../../../services/music-data.service';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { ListFilterValue, MusicTrackSortValue } from '../../../components/list-filter-menu/list-filter-menu.component';
import { MusicListFilterComponent } from '../../../components/music-list-filter/music-list-filter.component';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { LoggerService } from '../../../services/logger.service';
import { parseMusicReleasedTag } from '../music-release-date.util';

const MUSIC_KINDS = [...UtilitiesService.MUSIC_KINDS];
const PAGE_SIZE = 24;
const COLLAPSED_GENRE_LIMIT = 16;

interface MusicGenreOption {
  key: string;
  label: string;
  count: number;
}

@Component({
  selector: 'app-music-tracks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MusicEventComponent,
    MusicListFilterComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back to Music">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@music.tracks.title">Songs</h2>
      <button mat-icon-button (click)="toggleSearch()" [matTooltip]="showSearch() ? 'Close search' : 'Search songs'" class="hide-small">
        <mat-icon>{{ showSearch() ? 'search_off' : 'search' }}</mat-icon>
      </button>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <app-music-list-filter
          [initialFilter]="urlListFilter()"
          (filterChanged)="onFilterChanged($event)" />
      }
      <button mat-icon-button [matMenuTriggerFor]="sortMenu" matTooltip="Sort" class="hide-small">
        <mat-icon>sort</mat-icon>
      </button>
      <button mat-icon-button [matMenuTriggerFor]="moreOptionsMenu" matTooltip="More options" class="show-small">
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #moreOptionsMenu="matMenu">
        <button mat-menu-item (click)="toggleSearch()">
          <mat-icon>{{ showSearch() ? 'search_off' : 'search' }}</mat-icon>
          <span>{{ showSearch() ? 'Close Search' : 'Search' }}</span>
        </button>
        <button mat-menu-item [matMenuTriggerFor]="sortMenu">
          <mat-icon>sort</mat-icon>
          <span>Sort</span>
        </button>
      </mat-menu>
      <mat-menu #sortMenu="matMenu">
        <button mat-menu-item (click)="setSort('released')">
          <mat-icon>{{ sortBy() === 'released' ? 'check' : '' }}</mat-icon>
          <span>Released</span>
        </button>
        <button mat-menu-item (click)="setSort('published')">
          <mat-icon>{{ sortBy() === 'published' ? 'check' : '' }}</mat-icon>
          <span>Published</span>
        </button>
        <button mat-menu-item (click)="setSort('alphabetical')">
          <mat-icon>{{ sortBy() === 'alphabetical' ? 'check' : '' }}</mat-icon>
          <span>Alphabetical</span>
        </button>
      </mat-menu>
    </div>

    <div class="music-tracks-container">
      <div class="search-bar" [class.hidden]="!showSearch()">
        <mat-icon class="search-icon">search</mat-icon>
        <input #searchInput type="text" class="search-input" placeholder="Search songs..."
          [value]="searchQuery()" (input)="onSearchInput($any($event))" />
        <button mat-icon-button class="clear-search-btn" [class.invisible]="!searchQuery()" (click)="clearSearch()"
          aria-label="Clear search">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      @if (showSearch() && searchQuery()) {
        <div class="search-results-info">
          @if (searchedTracks().length > 0) {
            <span>Found {{ searchedTracks().length }} result{{ searchedTracks().length === 1 ? '' : 's' }} for "{{ searchQuery() }}"</span>
          } @else {
            <span>No results found for "{{ searchQuery() }}"</span>
          }
        </div>
      }

      @if (availableGenres().length > 0) {
        <div class="genre-filters-section">
          <div class="genre-filters" aria-label="Filter songs by genre">
            <button
              type="button"
              class="genre-filter-button"
              [class.active]="!hasGenreFilters()"
              [attr.aria-pressed]="!hasGenreFilters()"
              (click)="clearGenreFilters()">
              <span class="genre-filter-label">All</span>
              <span class="genre-filter-count">{{ pubkeyFilteredTracks().length }}</span>
            </button>

            @for (genre of visibleGenres(); track genre.key) {
              <button
                type="button"
                class="genre-filter-button"
                [class.active]="isGenreSelected(genre.key)"
                [attr.aria-pressed]="isGenreSelected(genre.key)"
                (click)="toggleGenre(genre.key)">
                <span class="genre-filter-label">{{ genre.label }}</span>
                <span class="genre-filter-count">{{ genre.count }}</span>
              </button>
            }
          </div>

          @if (shouldShowGenreToggle()) {
            <button
              type="button"
              mat-button
              class="genre-expand-button"
              (click)="toggleGenresExpanded()">
              <span>{{ genresExpanded() ? 'Show less' : 'Show ' + hiddenGenreCount() + ' more' }}</span>
              <mat-icon>{{ genresExpanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
          }
        </div>
      }

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p i18n="@@music.loading">Loading music...</p>
          </div>
        } @else if (displayedTracks().length === 0) {
          <div class="empty-state">
            <mat-icon>music_note</mat-icon>
            <h2 i18n="@@music.tracks.empty.title">No songs found</h2>
            <p>
              @if (searchQuery() && hasGenreFilters()) {
                <span>No songs match your search and selected genres.</span>
              } @else if (searchQuery()) {
                <span>No songs match your search.</span>
              } @else if (hasGenreFilters()) {
                <span>No songs match the selected genres.</span>
              } @else if (selectedListFilter() === 'following') {
                <span i18n="@@music.tracks.empty.following">People you follow haven't shared any music yet. Switch to Public to discover music from the wider Nostr network.</span>
              } @else if (selectedFollowSet()) {
                <span>No songs from people in "{{ selectedFollowSet()?.title || 'this list' }}".</span>
              } @else {
                <span i18n="@@music.tracks.empty.public">No music tracks have been shared yet.</span>
              }
            </p>
            <button mat-flat-button (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              <span i18n="@@music.refresh">Refresh</span>
            </button>
          </div>
        } @else {
          <div class="track-list-header hide-small">
            <span class="track-list-header-number">#</span>
            <span class="track-list-header-title">Title</span>
            <span class="track-list-header-album">Album</span>
            <span class="track-list-header-duration">
              <mat-icon>schedule</mat-icon>
            </span>
          </div>
          <div class="track-list">
            @for (track of displayedTracks(); track track.id; let i = $index) {
              <app-music-event [event]="track" mode="track-list" [trackNumber]="getTrackDisplayNumber(track)"
                [queueTracks]="searchedTracks()" [queueTrackIndex]="i"></app-music-event>
            }
          </div>

          @if (hasMore()) {
            <div #loadMoreSentinel class="load-more-container">
              @if (loadingMore()) {
                <mat-spinner diameter="24"></mat-spinner>
              } @else {
                <button mat-button (click)="loadMore()">
                  <mat-icon>expand_more</mat-icon>
                  <span i18n="@@music.loadMore">Load More</span>
                </button>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .panel-header {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 56px;
      padding: 0 16px;
      flex-shrink: 0;
      background-color: rgba(255, 255, 255, 0.92);
      -webkit-backdrop-filter: blur(20px) saturate(1.8);
      backdrop-filter: blur(20px) saturate(1.8);
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);

      .panel-title {
        margin: 0;
        font-size: 1.25rem;
      }

      .panel-header-spacer {
        flex: 1;
      }
    }

    :host-context(.dark) .panel-header {
      background-color: rgba(18, 18, 18, 0.92);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background-color: var(--mat-sys-surface-container);
      border-radius: var(--mat-sys-corner-large);
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;

      &.hidden {
        display: none;
      }

      .search-icon {
        color: var(--mat-sys-on-surface-variant);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .search-input {
        flex: 1;
        min-width: 0;
        border: none;
        background: transparent;
        font-size: 1rem;
        color: var(--mat-sys-on-surface);
        outline: none;
        padding: 0;

        &::placeholder {
          color: var(--mat-sys-on-surface-variant);
        }
      }

      .clear-search-btn {
        width: 32px;
        height: 32px;
        padding: 0;
        flex-shrink: 0;

        &.invisible {
          visibility: hidden;
        }

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }
    }

    .search-results-info {
      padding: 0.5rem 0;
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .genre-filters-section {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.125rem;
      padding-top: 0.375rem;
    }

    .genre-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding: 0.125rem 0;
    }

    .genre-filter-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      gap: 0.25rem;
      height: 1.7rem;
      padding: 0 0.5rem;
      margin: 0;
      border-radius: 999px;
      border-width: 1px;
      border-style: solid;
      border-color: color-mix(in srgb, var(--mat-sys-outline) 65%, transparent);
      background-color: color-mix(in srgb, var(--mat-sys-surface-container-low) 92%, transparent);
      color: var(--mat-sys-on-surface);
      font-size: 0.75rem;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;

      &.active {
        background-color: var(--mat-sys-primary-container);
        border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent);
        color: var(--mat-sys-on-primary-container);
      }
    }

    .genre-filter-label,
    .genre-filter-count {
      line-height: 1;
    }

    .genre-filter-label {
      white-space: nowrap;
    }

    .genre-filter-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1rem;
      min-height: 1rem;
      padding: 0 0.1875rem;
      border-radius: 999px;
      background-color: color-mix(in srgb, var(--mat-sys-surface-container-highest) 85%, transparent);
      color: inherit;
      font-size: 0.5625rem;
    }

    .genre-filter-button.active .genre-filter-count {
      background-color: color-mix(in srgb, var(--mat-sys-primary) 24%, transparent);
    }

    .genre-expand-button {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      min-height: 1.75rem;
      padding: 0;
      color: var(--mat-sys-primary);
      font-size: 0.875rem;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }
    
    .music-tracks-container {
      display: flex;
      flex-direction: column;
      padding: 0;
      padding-bottom: 120px;
      gap: 1rem;
    }

    .page-content {
      padding: 0;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      gap: 1rem;

      p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      gap: 1rem;
      text-align: center;

      mat-icon {
        font-size: 4rem;
        width: 4rem;
        height: 4rem;
        color: var(--mat-sys-on-surface-variant);
        opacity: 0.5;
      }

      h2 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--mat-sys-on-surface);
      }

      p {
        margin: 0;
        max-width: 400px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.5;
      }

      button mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .track-list {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
    }

    .track-list-header {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr) minmax(8rem, 20vw) 3.25rem;
      align-items: center;
      gap: 0.625rem;
      padding: 0 0.75rem 0.35rem;
      border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 78%, transparent);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .track-list-header-number,
    .track-list-header-duration {
      text-align: right;
    }

    .track-list-header-duration {
      display: flex;
      justify-content: flex-end;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    @media (max-width: 780px) {
      .track-list-header {
        grid-template-columns: minmax(0, 1fr) 3.25rem;
      }

      .track-list-header-number,
      .track-list-header-album {
        display: none;
      }
    }

    @media (max-width: 520px) {
      .track-list-header {
        grid-template-columns: minmax(0, 1fr) 3rem;
        gap: 0.5rem;
        padding-left: 0.5rem;
        padding-right: 0.5rem;
      }
    }

    .search-bar,
    .genre-filters-section,
    .search-results-info,
    .loading-container,
    .empty-state,
    .load-more-container {
      margin-left: 0.75rem;
      margin-right: 0.75rem;
    }

    @media (max-width: 600px) {
      .music-tracks-container {
        padding: 0;
        padding-bottom: 120px;
      }

      .search-bar,
      .genre-filters-section,
      .search-results-info,
      .loading-container,
      .empty-state,
      .load-more-container {
        margin-left: 0.5rem;
        margin-right: 0.5rem;
      }
    }

    .load-more-container {
      display: flex;
      justify-content: center;
      padding: 2rem;

      button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    }
  `],
})
export class MusicTracksComponent implements OnInit, OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private accountLocalState = inject(AccountLocalStateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private musicData = inject(MusicDataService);
  private followSetsService = inject(FollowSetsService);
  private panelNav = inject(PanelNavigationService);
  private readonly logger = inject(LoggerService);
  sourceInput = input<'following' | 'public' | undefined>(undefined);

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');
  searchInput = viewChild<ElementRef>('searchInput');

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);
  sortBy = signal<'released' | 'published' | 'alphabetical'>('released');

  // Search functionality
  searchQuery = signal('');
  showSearch = signal(false);
  selectedGenres = signal<string[]>([]);
  genresExpanded = signal(false);

  // List filter state - 'all', 'following', or follow set d-tag
  selectedListFilter = signal<ListFilterValue>('all');

  // URL query param for list filter
  urlListFilter = signal<string | undefined>(undefined);

  private trackSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();
  private intersectionObserver: IntersectionObserver | null = null;

  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  private currentPubkey = computed(() => {
    return this.accountState.pubkey();
  });

  // Computed: get all follow sets
  private allFollowSets = computed(() => this.followSetsService.followSets());

  // Computed: get the currently selected follow set (if any)
  selectedFollowSet = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === 'all' || filter === 'following') {
      return null;
    }
    return this.allFollowSets().find(set => set.dTag === filter) || null;
  });

  // Computed: get the pubkeys to filter by based on current selection
  private filterPubkeys = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === 'all') {
      return null; // No filtering
    }
    if (filter === 'following') {
      return this.followingPubkeys();
    }
    // Filter by a specific follow set
    const followSet = this.selectedFollowSet();
    return followSet?.pubkeys || [];
  });

  isAuthenticated = computed(() => this.app.authenticated());
  hasGenreFilters = computed(() => this.selectedGenres().length > 0);
  shouldShowGenreToggle = computed(() => this.availableGenres().length > COLLAPSED_GENRE_LIMIT);
  hiddenGenreCount = computed(() => Math.max(0, this.availableGenres().length - this.visibleGenres().length));

  availableGenres = computed<MusicGenreOption[]>(() => {
    const genreMap = new Map<string, MusicGenreOption>();

    for (const track of this.pubkeyFilteredTracks()) {
      for (const genre of this.getTrackGenres(track)) {
        const existing = genreMap.get(genre);
        if (existing) {
          existing.count += 1;
          continue;
        }

        genreMap.set(genre, {
          key: genre,
          label: this.formatGenreLabel(genre),
          count: 1,
        });
      }
    }

    for (const genre of this.selectedGenres()) {
      if (!genreMap.has(genre)) {
        genreMap.set(genre, {
          key: genre,
          label: this.formatGenreLabel(genre),
          count: 0,
        });
      }
    }

    return Array.from(genreMap.values()).sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }

      return a.label.localeCompare(b.label);
    });
  });

  visibleGenres = computed<MusicGenreOption[]>(() => {
    const genres = this.availableGenres();
    if (this.genresExpanded() || genres.length <= COLLAPSED_GENRE_LIMIT) {
      return genres;
    }

    const prioritizedKeys = new Set(genres.slice(0, COLLAPSED_GENRE_LIMIT).map(genre => genre.key));
    for (const selectedGenre of this.selectedGenres()) {
      prioritizedKeys.add(selectedGenre);
    }

    return genres.filter(genre => prioritizedKeys.has(genre.key));
  });

  private trackMatchesSearch(track: Event, query: string): boolean {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const title = this.utilities.getMusicTitle(track);
    if (title?.toLowerCase().includes(lowerQuery)) return true;
    const artist = this.utilities.getMusicArtist(track);
    if (artist?.toLowerCase().includes(lowerQuery)) return true;
    const hashtags = track.tags.filter(t => t[0] === 't').map(t => t[1]?.toLowerCase());
    if (hashtags.some(tag => tag?.includes(lowerQuery))) return true;
    return false;
  }

  private getTrackUniqueId(track: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string {
    const dTag = track.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
    return `${track.kind}:${track.pubkey}:${dTag}`;
  }

  private getTrackGenres(track: Event): string[] {
    const genres = new Set<string>();

    for (const tag of track.tags) {
      if (tag[0] !== 't') {
        continue;
      }

      const genre = this.normalizeGenreTag(tag[1]);
      if (genre) {
        genres.add(genre);
      }
    }

    return Array.from(genres);
  }

  private normalizeGenreTag(value: string | undefined): string {
    const normalizedValue = value?.trim().toLocaleLowerCase() || '';
    if (!normalizedValue || normalizedValue === 'music') {
      return '';
    }

    return normalizedValue;
  }

  private formatGenreLabel(value: string): string {
    return value
      .replace(/_/g, ' ')
      .split(' ')
      .filter(segment => segment.length > 0)
      .map(segment => segment
        .split('-')
        .map(part => this.formatGenreLabelPart(part))
        .join('-'))
      .join(' ');
  }

  private formatGenreLabelPart(value: string): string {
    const lowerValue = value.toLocaleLowerCase();

    if (lowerValue === 'ai') {
      return 'AI';
    }

    if (!/^[a-z]+$/i.test(value)) {
      return lowerValue;
    }

    return `${lowerValue.charAt(0).toLocaleUpperCase()}${lowerValue.slice(1)}`;
  }

  pubkeyFilteredTracks = computed(() => {
    const tracks = this.allTracks();
    const myPubkey = this.currentPubkey();
    const pubkeys = this.filterPubkeys();
    const sort = this.sortBy();

    let filtered = [...tracks];

    // Apply pubkey filter
    if (pubkeys !== null) {
      const allowedPubkeys = new Set(pubkeys);
      if (myPubkey) {
        allowedPubkeys.add(myPubkey);
      }

      if (allowedPubkeys.size === 0) return [];
      filtered = filtered.filter(t => allowedPubkeys.has(t.pubkey));
    }

    const albumSortValues = this.buildAlbumSortValues(filtered, sort);

    // Apply sorting
    switch (sort) {
      case 'released':
        return [...filtered].sort((a, b) => this.compareTracksForDisplay(a, b, 'released', albumSortValues));

      case 'published':
        return [...filtered].sort((a, b) => this.compareTracksForDisplay(a, b, 'published', albumSortValues));

      case 'alphabetical':
        return [...filtered].sort((a, b) => this.compareTracksForDisplay(a, b, 'alphabetical', albumSortValues));

      default:
        return filtered;
    }
  });

  filteredTracks = computed(() => {
    const selectedGenres = this.selectedGenres();
    if (selectedGenres.length === 0) {
      return this.pubkeyFilteredTracks();
    }

    const selectedGenreSet = new Set(selectedGenres);
    return this.pubkeyFilteredTracks().filter(track =>
      this.getTrackGenres(track).some(genre => selectedGenreSet.has(genre))
    );
  });

  searchedTracks = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return this.filteredTracks();
    return this.filteredTracks().filter(track => this.trackMatchesSearch(track, query));
  });

  displayedTracks = computed(() => {
    return this.searchedTracks().slice(0, this.displayLimit());
  });

  tracksCount = computed(() => this.searchedTracks().length);

  hasMore = computed(() => {
    return this.searchedTracks().length > this.displayLimit();
  });

  ngOnInit(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.sortBy.set(this.accountLocalState.getMusicTrackSort(pubkey) as MusicTrackSortValue);
    }

    // Check for input first (when opened via RightPanelService)
    const sourceFromInput = this.sourceInput();
    if (sourceFromInput) {
      // Map legacy source to new filter
      this.selectedListFilter.set(sourceFromInput === 'public' ? 'all' : sourceFromInput);
      this.initializeTracks();
      return;
    }

    // Get list filter from query params
    const queryParams = this.route.snapshot.queryParams;

    // Check for new 'list' query param (follow set d-tag)
    if (queryParams['list']) {
      this.urlListFilter.set(queryParams['list']);
      this.selectedListFilter.set(queryParams['list']);
    }
    // Check for legacy 'source' query param for backward compatibility
    else if (queryParams['source']) {
      const sourceParam = queryParams['source'];
      if (sourceParam === 'following') {
        this.selectedListFilter.set('following');
      } else if (sourceParam === 'public') {
        this.selectedListFilter.set('all');
      }
    }

    this.initializeTracks();
  }

  /**
   * Initialize tracks - use preloaded data if available, otherwise fetch from relays
   */
  private initializeTracks(): void {
    // Check if we have preloaded tracks from the music page
    const preloadedTracks = this.musicData.consumePreloadedTracks();
    if (preloadedTracks && preloadedTracks.length > 0) {
      // Use preloaded data - populate track map and signal
      for (const track of preloadedTracks) {
        const uniqueId = this.getTrackUniqueId(track);
        this.trackMap.set(uniqueId, track);
      }
      this.allTracks.set(
        Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
      );
      this.loading.set(false);
      // Still start subscription to get fresh/additional data
      this.startSubscription();
      return;
    }

    // No preloaded data - start fresh subscription
    this.startSubscription();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.trackSubscription?.close();
    this.intersectionObserver?.disconnect();
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && this.hasMore() && !this.loadingMore() && !this.loading()) {
            this.loadMore();
          }
        });
      },
      { rootMargin: '200px' }
    );

    // Initial observation attempt - also re-observed when loading completes
    setTimeout(() => this.observeSentinel(), 100);
  }

  private tryObserveSentinel(): void {
    // Re-attempt observation when data loads - sentinel may not exist initially
    setTimeout(() => this.observeSentinel(), 100);
  }

  private observeSentinel(): void {
    const sentinel = this.loadMoreSentinel();
    if (sentinel && this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver.observe(sentinel.nativeElement);
      this.checkSentinelProximity();
    }
  }

  private checkSentinelProximity(): void {
    const sentinel = this.loadMoreSentinel()?.nativeElement as HTMLElement | undefined;
    if (!sentinel || !this.hasMore() || this.loadingMore() || this.loading()) {
      return;
    }

    const rect = sentinel.getBoundingClientRect();
    const preloadOffset = 240;
    if (rect.top <= window.innerHeight + preloadOffset) {
      this.loadMore();
    }
  }

  private startSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for loading tracks');
      this.loading.set(false);
      return;
    }

    let loaded = false;
    const timeout = setTimeout(() => {
      loaded = true;
      this.loading.set(false);
      this.tryObserveSentinel();
    }, 5000);

    const filter: Filter = {
      kinds: MUSIC_KINDS,
      limit: 500,
    };

    this.trackSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const uniqueId = this.getTrackUniqueId(event);

      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.trackMap.set(uniqueId, event);
      this.allTracks.set(
        Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
      );

      if (!loaded) {
        clearTimeout(timeout);
        loaded = true;
        this.loading.set(false);
        this.tryObserveSentinel();
      }
    });
  }

  onFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
    this.displayLimit.set(PAGE_SIZE);
    // Update URL query params
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { list: filter },
      queryParamsHandling: 'merge',
    });
  }

  setSort(sort: 'released' | 'published' | 'alphabetical'): void {
    this.sortBy.set(sort);
    this.displayLimit.set(PAGE_SIZE);

    if (sort === 'released' || sort === 'published') {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setMusicTrackSort(pubkey, sort);
      }
    }
  }

  isGenreSelected(genre: string): boolean {
    return this.selectedGenres().includes(genre);
  }

  toggleGenre(genre: string): void {
    this.selectedGenres.update(selectedGenres => {
      if (selectedGenres.includes(genre)) {
        return selectedGenres.filter(selectedGenre => selectedGenre !== genre);
      }

      return [...selectedGenres, genre];
    });
    this.displayLimit.set(PAGE_SIZE);
  }

  clearGenreFilters(): void {
    this.selectedGenres.set([]);
    this.displayLimit.set(PAGE_SIZE);
  }

  toggleGenresExpanded(): void {
    this.genresExpanded.update(expanded => !expanded);
  }

  private getTrackSortValue(track: Event, mode: MusicTrackSortValue): number {
    if (mode === 'published') {
      return this.getTrackPublishedSortValue(track);
    }

    return this.getTrackReleaseSortValue(track) ?? this.getTrackPublishedSortValue(track);
  }

  private compareTracksForDisplay(
    a: Event,
    b: Event,
    mode: 'released' | 'published' | 'alphabetical',
    albumSortValues: Map<string, number>
  ): number {
    const groupKeyA = this.getTrackAlbumGroupKey(a);
    const groupKeyB = this.getTrackAlbumGroupKey(b);

    if (groupKeyA === groupKeyB) {
      return this.compareTracksWithinGroup(a, b, mode);
    }

    switch (mode) {
      case 'released':
      case 'published': {
        const sortA = albumSortValues.get(groupKeyA) ?? this.getTrackSortValue(a, mode);
        const sortB = albumSortValues.get(groupKeyB) ?? this.getTrackSortValue(b, mode);
        if (sortA !== sortB) {
          return sortB - sortA;
        }
        break;
      }

      case 'alphabetical':
        break;
    }

    const albumCompare = this.getTrackAlbumSortValue(a).localeCompare(this.getTrackAlbumSortValue(b));
    if (albumCompare !== 0) {
      return albumCompare;
    }

    const artistCompare = this.getTrackArtistSortValue(a).localeCompare(this.getTrackArtistSortValue(b));
    if (artistCompare !== 0) {
      return artistCompare;
    }

    const titleCompare = this.getTrackTitleSortValue(a).localeCompare(this.getTrackTitleSortValue(b));
    if (titleCompare !== 0) {
      return titleCompare;
    }

    return b.created_at - a.created_at;
  }

  private compareTracksWithinGroup(
    a: Event,
    b: Event,
    mode: 'released' | 'published' | 'alphabetical'
  ): number {
    const trackNumberA = this.getTrackNumberSortValue(a);
    const trackNumberB = this.getTrackNumberSortValue(b);

    if (trackNumberA !== null && trackNumberB !== null && trackNumberA !== trackNumberB) {
      return trackNumberA - trackNumberB;
    }

    if (trackNumberA !== null && trackNumberB === null) {
      return -1;
    }

    if (trackNumberA === null && trackNumberB !== null) {
      return 1;
    }

    if (mode === 'released' || mode === 'published') {
      const sortA = this.getTrackSortValue(a, mode);
      const sortB = this.getTrackSortValue(b, mode);
      if (sortA !== sortB) {
        return sortB - sortA;
      }
    }

    const titleCompare = this.getTrackTitleSortValue(a).localeCompare(this.getTrackTitleSortValue(b));
    if (titleCompare !== 0) {
      return titleCompare;
    }

    return b.created_at - a.created_at;
  }

  private buildAlbumSortValues(
    tracks: Event[],
    mode: 'released' | 'published' | 'alphabetical'
  ): Map<string, number> {
    const albumSortValues = new Map<string, number>();

    if (mode !== 'released' && mode !== 'published') {
      return albumSortValues;
    }

    for (const track of tracks) {
      const albumKey = this.getTrackAlbumGroupKey(track);
      const trackSortValue = this.getTrackSortValue(track, mode);
      const existing = albumSortValues.get(albumKey);

      if (existing === undefined || trackSortValue > existing) {
        albumSortValues.set(albumKey, trackSortValue);
      }
    }

    return albumSortValues;
  }

  private getTrackArtistSortValue(track: Event): string {
    const taggedArtist = this.utilities.getMusicArtist(track)?.trim();
    if (taggedArtist) {
      return taggedArtist.toLocaleLowerCase();
    }

    return this.getCachedProfileNameSortValue(track.pubkey);
  }

  private getCachedProfileNameSortValue(pubkey: string): string {
    const profile = this.accountState.getAccountProfileSync(pubkey);
    const profileData = profile?.data as Record<string, unknown> | undefined;
    const displayName = this.getProfileFieldAsString(profileData?.['display_name']);
    if (displayName) {
      return displayName.toLocaleLowerCase();
    }

    const name = this.getProfileFieldAsString(profileData?.['name']);
    if (name) {
      return name.toLocaleLowerCase();
    }

    return '';
  }

  private getProfileFieldAsString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private getTrackAlbumSortValue(track: Event): string {
    return track.tags.find(tag => tag[0] === 'album')?.[1]?.trim().toLocaleLowerCase() || '';
  }

  private getTrackTitleSortValue(track: Event): string {
    return (this.utilities.getMusicTitle(track) || '').trim().toLocaleLowerCase();
  }

  private getTrackNumberSortValue(track: Event): number | null {
    const trackNumber = track.tags.find(tag => tag[0] === 'track_number')?.[1]?.trim();
    if (!trackNumber) {
      return null;
    }

    const parsed = Number.parseInt(trackNumber, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private getTrackAlbumGroupKey(track: Event): string {
    const album = this.getTrackAlbumSortValue(track);
    const artist = this.getTrackArtistSortValue(track);
    if (album) {
      return `album:${artist}:${album}`;
    }

    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1]?.trim();
    return `single:${track.pubkey}:${dTag || track.id}`;
  }

  getTrackDisplayNumber(track: Event): string | null {
    return track.tags.find(tag => tag[0] === 'track_number')?.[1]?.trim() || null;
  }

  private getTrackPublishedSortValue(track: Event): number {
    const publishedAt = this.utilities.getMusicPublishedAt(track);
    if (publishedAt) {
      return publishedAt * 1000;
    }

    return track.created_at * 1000;
  }

  private getTrackReleaseSortValue(track: Event): number | null {
    return parseMusicReleasedTag(track.tags.find(tag => tag[0] === 'released')?.[1]);
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.displayLimit.update(limit => limit + PAGE_SIZE);
    setTimeout(() => {
      this.loadingMore.set(false);
      // Re-observe sentinel after DOM updates
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  refresh(): void {
    this.trackMap.clear();
    this.allTracks.set([]);
    this.loading.set(true);
    this.displayLimit.set(PAGE_SIZE);
    this.trackSubscription?.close();
    this.startSubscription();
  }

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
    } else {
      this.router.navigate(['/music']);
    }
  }

  toggleSearch(): void {
    const wasVisible = this.showSearch();
    this.showSearch.set(!wasVisible);
    if (!wasVisible) {
      setTimeout(() => {
        this.searchInput()?.nativeElement?.focus();
      }, 0);
    } else {
      this.searchQuery.set('');
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  onSearchInput(event: InputEvent): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }
}
