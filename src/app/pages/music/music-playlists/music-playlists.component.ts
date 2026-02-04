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
import { FollowSetsService } from '../../../services/follow-sets.service';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';
import { ListFilterMenuComponent, ListFilterValue } from '../../../components/list-filter-menu/list-filter-menu.component';

const PLAYLIST_KIND = 34139;
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-playlists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MusicPlaylistCardComponent,
    ListFilterMenuComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back to Music">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@music.playlists.title">Playlists</h2>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <app-list-filter-menu storageKey="music" [showPublicOption]="true" defaultFilter="all"
          [initialFilter]="urlListFilter()"
          (filterChanged)="onFilterChanged($event)" />
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

    <div class="music-playlists-container">
      <div class="page-header">
        <div class="header-info">
          <p class="subtitle">{{ playlistsCount() }} <span i18n="@@music.playlists.count">playlists</span></p>
        </div>
      </div>

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p i18n="@@music.loading">Loading playlists...</p>
          </div>
        } @else if (displayedPlaylists().length === 0) {
          <div class="empty-state">
            <mat-icon>queue_music</mat-icon>
            <h2 i18n="@@music.playlists.empty.title">No playlists found</h2>
            <p>
              @if (selectedListFilter() === 'following') {
                <span i18n="@@music.playlists.empty.following">People you follow haven't created any playlists yet. Switch to Public to discover playlists from the wider Nostr network.</span>
              } @else {
                <span i18n="@@music.playlists.empty.public">No playlists have been created yet.</span>
              }
            </p>
            <button mat-flat-button (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              <span i18n="@@music.refresh">Refresh</span>
            </button>
          </div>
        } @else {
          <div class="playlists-grid">
            @for (playlist of displayedPlaylists(); track playlist.id) {
              <app-music-playlist-card [event]="playlist"></app-music-playlist-card>
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
    
    .music-playlists-container {
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

    .playlists-grid {
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
export class MusicPlaylistsComponent implements OnInit, OnDestroy, AfterViewInit {
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

  // Input kept for potential future use with RightPanelService
  sourceInput = input<'following' | 'public' | undefined>(undefined);

  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);
  sortBy = signal<'recents' | 'alphabetical' | 'artist'>('recents');

  // List filter state - 'all', 'following', or follow set d-tag
  selectedListFilter = signal<ListFilterValue>('all');

  // URL query param for list filter
  urlListFilter = signal<string | undefined>(undefined);

  private playlistSubscription: { close: () => void } | null = null;
  private playlistMap = new Map<string, Event>();

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

  filteredPlaylists = computed(() => {
    const playlists = this.allPlaylists();
    const myPubkey = this.currentPubkey();
    const pubkeys = this.filterPubkeys();
    const sort = this.sortBy();

    // Filter out user's own playlists
    let filtered = playlists.filter(p => p.pubkey !== myPubkey);

    // Apply pubkey filter
    if (pubkeys !== null) {
      if (pubkeys.length === 0) return [];
      filtered = filtered.filter(p => pubkeys.includes(p.pubkey));
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
          // Sort by pubkey as a proxy for artist
          return a.pubkey.localeCompare(b.pubkey);
        });

      case 'recents':
      default:
        return filtered;
    }
  });

  displayedPlaylists = computed(() => {
    return this.filteredPlaylists().slice(0, this.displayLimit());
  });

  playlistsCount = computed(() => this.filteredPlaylists().length);

  hasMore = computed(() => {
    return this.filteredPlaylists().length > this.displayLimit();
  });

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');
  private intersectionObserver: IntersectionObserver | null = null;

  ngOnInit(): void {
    // Get filter from query params - check for list (follow set) or source (following/public)
    const queryParams = this.route.snapshot.queryParams;

    if (queryParams['list']) {
      // Follow set d-tag passed
      this.urlListFilter.set(queryParams['list']);
      this.selectedListFilter.set(queryParams['list']);
    } else if (queryParams['source']) {
      // Legacy source parameter - map to new filter
      const sourceParam = queryParams['source'];
      if (sourceParam === 'following') {
        this.urlListFilter.set('following');
        this.selectedListFilter.set('following');
      } else if (sourceParam === 'public') {
        this.urlListFilter.set('all');
        this.selectedListFilter.set('all');
      }
    }

    // Check for input (when opened via RightPanelService)
    const sourceFromInput = this.sourceInput();
    if (sourceFromInput) {
      if (sourceFromInput === 'following') {
        this.selectedListFilter.set('following');
      } else {
        this.selectedListFilter.set('all');
      }
    }

    this.initializePlaylists();
  }

  /**
   * Handle filter change from ListFilterMenuComponent
   */
  onFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
  }

  /**
   * Initialize playlists - use preloaded data if available, otherwise fetch from relays
   */
  private initializePlaylists(): void {
    // Check if we have preloaded playlists from the music page
    const preloadedPlaylists = this.musicData.consumePreloadedPlaylists();
    if (preloadedPlaylists && preloadedPlaylists.length > 0) {
      // Use preloaded data - populate playlist map and signal
      for (const playlist of preloadedPlaylists) {
        const dTag = playlist.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${playlist.pubkey}:${dTag}`;
        this.playlistMap.set(uniqueId, playlist);
      }
      this.allPlaylists.set(
        Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at)
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
    this.playlistSubscription?.close();
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

    setTimeout(() => this.observeSentinel(), 100);
  }

  private tryObserveSentinel(): void {
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
      console.warn('No relays available for loading playlists');
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
      kinds: [PLAYLIST_KIND],
      limit: 500,
    };

    this.playlistSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.playlistMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.playlistMap.set(uniqueId, event);
      this.allPlaylists.set(
        Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at)
      );

      if (!loaded) {
        clearTimeout(timeout);
        loaded = true;
        this.loading.set(false);
        this.tryObserveSentinel();
      }
    });
  }

  loadMore(): void {
    this.loadingMore.set(true);
    this.displayLimit.update(limit => limit + PAGE_SIZE);
    setTimeout(() => {
      this.loadingMore.set(false);
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  refresh(): void {
    this.playlistMap.clear();
    this.allPlaylists.set([]);
    this.loading.set(true);
    this.displayLimit.set(PAGE_SIZE);
    this.playlistSubscription?.close();
    this.startSubscription();
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
