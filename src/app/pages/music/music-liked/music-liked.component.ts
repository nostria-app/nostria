import { Component, inject, signal, computed, OnDestroy, ChangeDetectionStrategy, AfterViewInit, ElementRef, viewChild, effect, untracked } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { Event } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { ReportingService } from '../../../services/reporting.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { DataService } from '../../../services/data.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { MediaItem } from '../../../interfaces';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';
import { LoggerService } from '../../../services/logger.service';
import { MusicLikedSongsService } from '../../../services/music-liked-songs.service';

const MUSIC_KINDS = [...UtilitiesService.MUSIC_KINDS];
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-liked',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MusicEventComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back to Music">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@music.liked.title">Liked Songs</h2>
      <button mat-icon-button (click)="toggleSearch()" [matTooltip]="showSearch() ? 'Close search' : 'Search music'" class="hide-small">
        <mat-icon>{{ showSearch() ? 'search_off' : 'search' }}</mat-icon>
      </button>
      <span class="panel-header-spacer"></span>
       <button mat-icon-button [matMenuTriggerFor]="moreOptionsMenu" matTooltip="More options" class="show-small">
         <mat-icon>more_vert</mat-icon>
       </button>
       <mat-menu #moreOptionsMenu="matMenu">
         <button mat-menu-item (click)="toggleSearch()">
           <mat-icon>{{ showSearch() ? 'search_off' : 'search' }}</mat-icon>
           <span>{{ showSearch() ? 'Close Search' : 'Search' }}</span>
         </button>
         <button mat-menu-item (click)="importFromLikes()" [disabled]="importingLikes()">
           <mat-icon>sync</mat-icon>
           <span>Import from likes</span>
         </button>
       </mat-menu>
    </div>

    <div class="music-liked-container">
      <div class="search-bar" [class.hidden]="!showSearch()">
        <mat-icon class="search-icon">search</mat-icon>
        <input #searchInput type="text" class="search-input" placeholder="Search liked songs..."
          [value]="searchQuery()" (input)="onSearchInput($any($event))" />
        <button mat-icon-button class="clear-search-btn" [class.invisible]="!searchQuery()" (click)="clearSearch()"
          aria-label="Clear search">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      @if (showSearch() && searchQuery()) {
        <div class="search-results-info">
          @if (filteredTracks().length > 0) {
            <span>Found {{ filteredTracks().length }} result{{ filteredTracks().length === 1 ? '' : 's' }} for "{{ searchQuery() }}"</span>
          } @else {
            <span>No results found for "{{ searchQuery() }}"</span>
          }
        </div>
      }

      <div class="page-header">
        <div class="header-info">
          <div class="header-icon">
            <mat-icon>favorite</mat-icon>
          </div>
          <div class="header-text">
            <h1 i18n="@@music.liked.title">Liked Songs</h1>
            <p class="subtitle">{{ tracksCount() }} <span i18n="@@music.liked.trackCount">tracks</span></p>
          </div>
        </div>
        <button mat-stroked-button (click)="importFromLikes()" [disabled]="importingLikes()">
          <mat-icon>sync</mat-icon>
          <span>Import from likes</span>
        </button>
        @if (allTracks().length > 0) {
          <button mat-fab extended class="play-all-button" (click)="playAll()" aria-label="Play all">
            <mat-icon>play_arrow</mat-icon>
            <span i18n="@@music.playAll">Play All</span>
          </button>
        }
      </div>

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p i18n="@@music.loading">Loading music...</p>
          </div>
        } @else if (displayedTracks().length === 0) {
          <div class="empty-state">
            <mat-icon>favorite_border</mat-icon>
            <h2 i18n="@@music.liked.empty.title">No liked songs yet</h2>
            <p i18n="@@music.liked.empty.message">Songs you like will appear here. Start exploring and tap the heart icon on songs you enjoy!</p>
            <button mat-flat-button (click)="goBack()">
              <mat-icon>music_note</mat-icon>
              <span i18n="@@music.liked.browseMusic">Browse Music</span>
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
              <app-music-event [event]="track" mode="track-list" [trackNumber]="null"
                [queueTracks]="filteredTracks()" [queueTrackIndex]="i"></app-music-event>
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
    
    .music-liked-container {
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

      .play-all-button {
        margin-left: auto;

        @media (max-width: 600px) {
          margin-left: 0;
          width: 100%;
          margin-top: 0.5rem;
        }
      }
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .header-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: var(--mat-sys-corner-medium);
      background: linear-gradient(135deg, #e91e63, #9c27b0);

      mat-icon {
        font-size: 2rem;
        width: 2rem;
        height: 2rem;
        color: white;
      }
    }

    .header-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;

      h1 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--mat-sys-on-surface);
      }

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
export class MusicLikedComponent implements OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private mediaPlayer = inject(MediaPlayerService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);
  private readonly logger = inject(LoggerService);
  private likedSongsService = inject(MusicLikedSongsService);

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  importingLikes = signal(false);
  displayLimit = signal(PAGE_SIZE);

  // Search functionality
  searchQuery = signal('');
  showSearch = signal(false);

  private trackMap = new Map<string, Event>();
  private intersectionObserver: IntersectionObserver | null = null;

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');
  searchInput = viewChild<ElementRef>('searchInput');

  isAuthenticated = computed(() => this.app.authenticated());

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

  filteredTracks = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return this.allTracks();
    return this.allTracks().filter(track => this.trackMatchesSearch(track, query));
  });

  displayedTracks = computed(() => {
    return this.filteredTracks().slice(0, this.displayLimit());
  });

  tracksCount = computed(() => this.filteredTracks().length);

  hasMore = computed(() => {
    return this.filteredTracks().length > this.displayLimit();
  });

  constructor() {
    effect(() => {
      this.likedSongsService.likedSongRefs();
      untracked(() => {
        void this.loadLikedTracks();
      });
    });
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
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

  private async loadLikedTracks(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.loading.set(false);
      return;
    }

    await this.likedSongsService.ensureInitialized(pubkey);

    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      this.logger.warn('No relays available for loading liked songs');
      this.loading.set(false);
      return;
    }

    const likedTrackRefs = this.likedSongsService.likedSongRefs()
      .map(item => item.ref)
      .filter(ref => !!this.utilities.parseMusicTrackCoordinate(ref));

    if (likedTrackRefs.length === 0) {
      this.trackMap.clear();
      this.allTracks.set([]);
      this.loading.set(false);
      this.tryObserveSentinel();
      return;
    }

    await this.fetchLikedTracksSnapshot(relayUrls, likedTrackRefs, []);
  }

  private async fetchLikedTracksSnapshot(
    relayUrls: string[],
    aTagCoordinates: string[],
    eventIds: string[],
  ): Promise<void> {
    if (aTagCoordinates.length === 0 && eventIds.length === 0) {
      this.loading.set(false);
      this.tryObserveSentinel();
      return;
    }

    const parsedCoordinates = aTagCoordinates
      .map(coord => this.utilities.parseMusicTrackCoordinate(coord))
      .filter((coord): coord is { kind: number; pubkey: string; identifier: string } => coord !== null);

    const authorKindGroups = new Map<string, { kind: number; pubkey: string; identifiers: Set<string> }>();
    for (const coordinate of parsedCoordinates) {
      const key = `${coordinate.kind}:${coordinate.pubkey}`;
      if (!authorKindGroups.has(key)) {
        authorKindGroups.set(key, {
          kind: coordinate.kind,
          pubkey: coordinate.pubkey,
          identifiers: new Set<string>(),
        });
      }
      authorKindGroups.get(key)!.identifiers.add(coordinate.identifier);
    }

    const upsertTrack = (event: Event): void => {
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      const uniqueId = this.getTrackUniqueId(event);
      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;

      this.trackMap.set(uniqueId, event);
    };

    const queryTasks: Promise<Event[]>[] = [];

    const groupedFilters = Array.from(authorKindGroups.values()).map(group => ({
      kinds: [group.kind],
      authors: [group.pubkey],
      '#d': Array.from(group.identifiers),
      limit: Math.max(group.identifiers.size * 2, group.identifiers.size),
    }));

    const groupedBatchSize = 20;
    for (let i = 0; i < groupedFilters.length; i += groupedBatchSize) {
      const batch = groupedFilters.slice(i, i + groupedBatchSize);
      batch.forEach(filter => {
        queryTasks.push(this.pool.query(relayUrls, filter, 5000));
      });
    }

    const eventIdBatchSize = 100;
    for (let i = 0; i < eventIds.length; i += eventIdBatchSize) {
      queryTasks.push(this.pool.query(relayUrls, {
        kinds: MUSIC_KINDS,
        ids: eventIds.slice(i, i + eventIdBatchSize),
      }, 5000));
    }

    const results = await Promise.all(queryTasks);
    results.flat().forEach(upsertTrack);

    this.allTracks.set(
      Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
    );

    this.loading.set(false);
    this.tryObserveSentinel();
  }

  loadMore(): void {
    this.loadingMore.set(true);
    this.displayLimit.update(limit => limit + PAGE_SIZE);
    setTimeout(() => {
      this.loadingMore.set(false);
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  async playAll(): Promise<void> {
    const tracks = this.allTracks();
    if (tracks.length === 0) return;

    // Create media items for all tracks and play the first one
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const url = this.utilities.getMusicAudioUrl(track);
      if (!url) continue;

      const title = this.utilities.getMusicTitle(track) || 'Untitled Track';
      const imageTag = this.utilities.getMusicImage(track);
      const videoTag = track.tags.find(t => t[0] === 'video');
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      // Get artist name - check artist tag first, then fall back to profile
      let artistName = this.utilities.getMusicArtist(track);
      if (!artistName) {
        const profile = await this.dataService.getProfile(track.pubkey);
        artistName = profile?.data?.display_name || profile?.data?.name || 'Unknown Artist';
      }

      const mediaItem: MediaItem = {
        source: url,
        title,
        artist: artistName || 'Unknown Artist',
        artwork: imageTag || '/icons/icon-192x192.png',
        video: videoTag?.[1] || undefined,
        type: 'Music',
        eventPubkey: track.pubkey,
        eventIdentifier: dTag,
        eventKind: track.kind,
        lyrics: this.utilities.extractLyricsFromEvent(track),
      };

      if (i === 0) {
        this.mediaPlayer.play(mediaItem);
      } else {
        this.mediaPlayer.enque(mediaItem);
      }
    }
  }

  async importFromLikes(): Promise<void> {
    if (this.importingLikes()) {
      return;
    }

    this.importingLikes.set(true);

    try {
      await this.likedSongsService.importExistingLikes();
      await this.loadLikedTracks();
    } finally {
      this.importingLikes.set(false);
    }
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
