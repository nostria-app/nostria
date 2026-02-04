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
import { MusicDataService } from '../../../services/music-data.service';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { ListFilterMenuComponent, ListFilterValue } from '../../../components/list-filter-menu/list-filter-menu.component';

const MUSIC_KIND = 36787;
const PAGE_SIZE = 24;

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
    ListFilterMenuComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back to Music">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@music.tracks.title">Songs</h2>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <app-list-filter-menu
          storageKey="music"
          [showPublicOption]="true"
          defaultFilter="all"
          [initialFilter]="urlListFilter()"
          (filterChanged)="onFilterChanged($event)"
        />
      }
      <button mat-icon-button [matMenuTriggerFor]="sortMenu" matTooltip="Sort">
        <mat-icon>sort</mat-icon>
      </button>
      <mat-menu #sortMenu="matMenu">
        <button mat-menu-item (click)="sortBy.set('recents')">
          <mat-icon>{{ sortBy() === 'recents' ? 'check' : '' }}</mat-icon>
          <span>Recents</span>
        </button>
        <button mat-menu-item (click)="sortBy.set('alphabetical')">
          <mat-icon>{{ sortBy() === 'alphabetical' ? 'check' : '' }}</mat-icon>
          <span>Alphabetical</span>
        </button>
        <button mat-menu-item (click)="sortBy.set('artist')">
          <mat-icon>{{ sortBy() === 'artist' ? 'check' : '' }}</mat-icon>
          <span>Artist</span>
        </button>
      </mat-menu>
    </div>

    <div class="music-tracks-container">
      <div class="page-header">
        <div class="header-info">
          <p class="subtitle">{{ tracksCount() }} <span i18n="@@music.tracks.trackCount">tracks</span></p>
        </div>
      </div>

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
              @if (selectedListFilter() === 'following') {
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
          <div class="music-grid">
            @for (track of displayedTracks(); track track.id) {
              <app-music-event [event]="track" mode="card"></app-music-event>
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
    
    .music-tracks-container {
      display: flex;
      flex-direction: column;
      padding: 1rem;
      padding-bottom: 120px;
      gap: 1rem;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 0;
      flex-wrap: wrap;
    }

    .header-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;

      .subtitle {
        margin: 0;
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .page-content {
      padding: 1rem 0;
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

    .music-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 1rem;
      padding: 0.5rem 0;
      max-width: 100%;

      @media (max-width: 600px) {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
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
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private musicData = inject(MusicDataService);
  private followSetsService = inject(FollowSetsService);

  // Input for when opened via RightPanelService
  sourceInput = input<'following' | 'public' | undefined>(undefined);

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);
  sortBy = signal<'recents' | 'alphabetical' | 'artist'>('recents');

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

  filteredTracks = computed(() => {
    const tracks = this.allTracks();
    const myPubkey = this.currentPubkey();
    const pubkeys = this.filterPubkeys();
    const sort = this.sortBy();

    // Filter out user's own tracks
    let filtered = tracks.filter(t => t.pubkey !== myPubkey);

    // Apply pubkey filter
    if (pubkeys !== null) {
      if (pubkeys.length === 0) return [];
      filtered = filtered.filter(t => pubkeys.includes(t.pubkey));
    }

    // Apply sorting
    switch (sort) {
      case 'alphabetical':
        return [...filtered].sort((a, b) => {
          const titleA = a.tags.find(t => t[0] === 'title')?.[1] || '';
          const titleB = b.tags.find(t => t[0] === 'title')?.[1] || '';
          return titleA.localeCompare(titleB);
        });

      case 'artist':
        return [...filtered].sort((a, b) => {
          const artistA = a.tags.find(t => t[0] === 'artist')?.[1] || '';
          const artistB = b.tags.find(t => t[0] === 'artist')?.[1] || '';
          return artistA.localeCompare(artistB);
        });

      case 'recents':
      default:
        return filtered;
    }
  });

  displayedTracks = computed(() => {
    return this.filteredTracks().slice(0, this.displayLimit());
  });

  tracksCount = computed(() => this.filteredTracks().length);

  hasMore = computed(() => {
    return this.filteredTracks().length > this.displayLimit();
  });

  ngOnInit(): void {
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
        const dTag = track.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${track.pubkey}:${dTag}`;
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
      this.intersectionObserver.observe(sentinel.nativeElement);
    }
  }

  private startSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading tracks');
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
      kinds: [MUSIC_KIND],
      limit: 500,
    };

    this.trackSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

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

  loadMore(): void {
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
    this.router.navigate(['/music']);
  }
}
