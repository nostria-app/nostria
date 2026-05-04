import { Component, inject, signal, computed, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy, effect, untracked } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service';
import { OfflineMusicService } from '../../services/offline-music.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { LayoutService } from '../../services/layout.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { ZapService } from '../../services/zap.service';
import { MediaItem } from '../../interfaces';
import { MusicEventComponent } from '../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../components/music-playlist-card/music-playlist-card.component';
import { CreateMusicPlaylistDialogComponent } from './create-music-playlist-dialog/create-music-playlist-dialog.component';
import { CreateMusicBookmarkPlaylistDialogComponent } from './create-music-bookmark-playlist-dialog/create-music-bookmark-playlist-dialog.component';
import { MusicBookmarkPlaylistCardComponent } from '../../components/music-bookmark-playlist-card/music-bookmark-playlist-card.component';
import { MusicTrackDialogComponent } from './music-track-dialog/music-track-dialog.component';
import { ImportRssDialogComponent } from './import-rss-dialog/import-rss-dialog.component';
import { MusicSettingsDialogComponent } from './music-settings-dialog/music-settings-dialog.component';
import { MusicPlaylist } from '../../services/music-playlist.service';
import { MusicBookmarkPlaylist, MusicBookmarkPlaylistService } from '../../services/music-bookmark-playlist.service';
import { MusicDataService } from '../../services/music-data.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { MusicListFilterComponent } from '../../components/music-list-filter/music-list-filter.component';
import { LoggerService } from '../../services/logger.service';
import { MusicLikedSongsService } from '../../services/music-liked-songs.service';
import { DEFAULT_MUSIC_RELAYS } from '../../utils/music-default-relays';
import { parseMusicReleasedTag } from './music-release-date.util';

const MUSIC_KINDS = [...UtilitiesService.MUSIC_KINDS];
const PLAYLIST_KIND = 34139;
const USER_STATUS_KIND = 30315;
const SECTION_LIMIT = 12;
const LIKE_QUERY_TIMEOUT_MS = 3000;
type MusicTrackSortValue = 'released' | 'published';

interface ListeningEntry {
  pubkey: string;
  content: string;
  createdAt: number;
  expiration?: number;
  trackKind?: number;
  trackPubkey?: string;
  trackIdentifier?: string;
  externalUrl?: string;
}

@Component({
  selector: 'app-music',
  host: {
    'class': 'panel-with-sticky-header',
    '(window:resize)': 'updateContainerWidth()',
  },
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    FormsModule,
    MusicEventComponent,
    MusicPlaylistCardComponent,
    CreateMusicPlaylistDialogComponent,
    CreateMusicBookmarkPlaylistDialogComponent,
    MusicBookmarkPlaylistCardComponent,
    MusicTrackDialogComponent,
    ImportRssDialogComponent,
    MusicSettingsDialogComponent,
    MusicListFilterComponent,
  ],
  templateUrl: './music.component.html',
  styleUrls: ['./music.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicComponent implements OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private mediaPlayer = inject(MediaPlayerService);
  private dataService = inject(DataService);
  private database = inject(DatabaseService);
  private offlineMusicService = inject(OfflineMusicService);
  private accountLocalState = inject(AccountLocalStateService);
  private layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private panelNav = inject(PanelNavigationService);
  private musicData = inject(MusicDataService);
  private bookmarkPlaylistService = inject(MusicBookmarkPlaylistService);
  private likedSongsService = inject(MusicLikedSongsService);
  followSetsService = inject(FollowSetsService);
  private readonly logger = inject(LoggerService);
  private zapService = inject(ZapService);

  allTracks = signal<Event[]>([]);
  allPlaylists = signal<Event[]>([]);
  playlists = signal<Event[]>([]);
  recentListening = signal<ListeningEntry[]>([]);
  loading = signal(true);
  isLoadingLikedSongs = signal(false);

  // Search functionality
  searchQuery = signal('');
  showSearch = signal(false);

  // Container width for dynamic rendering
  containerWidth = signal(0);

  // Offline music track count
  offlineTrackCount = computed(() => this.offlineMusicService.offlineTracks().length);

  // Listening party: auto-follow another user's track changes
  listeningPartyPubkey = signal<string | null>(null);

  // Dialog visibility
  showUploadDialog = signal(false);
  showCreatePlaylistDialog = signal(false);
  showCreateAlbumDialog = signal(false);
  showImportRssDialog = signal(false);
  showSettingsDialog = signal(false);

  // Music relay set state
  musicRelaySet = signal<Event | null>(null);
  musicRelays = signal<string[]>([]);
  private profileRenderVersion = signal(0);

  private trackSubscription: { close: () => void } | null = null;
  private playlistSubscription: { close: () => void } | null = null;
  private listeningSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();
  private playlistMap = new Map<string, Event>();
  private listeningMap = new Map<string, ListeningEntry>();
  private latestListeningTimestamps = new Map<string, number>();
  private listeningPruneIntervalId: number | null = null;
  private syncingOwnMusicCache = false;
  private lastSyncedOwnMusicPubkey: string | null = null;
  private requestedProfilePubkeys = new Set<string>();

  // Like/zap state for home page tracks
  private likedReactionByTargetKey = signal(new Map<string, Event>());
  private zappedTargetKeys = signal(new Set<string>());
  private likeZapStatePubkey: string | null = null;
  private likeZapLoaded = false;
  private likeZapLoading = false;

  playlistLikedReactionById = computed(() => {
    const likeMap = this.likedReactionByTargetKey();
    const playlists = this.listFilteredPlaylistsPreview();
    const result = new Map<string, Event>();
    for (const playlist of playlists) {
      const target = this.getTrackReactionTarget(playlist);
      if (!target) continue;
      const reaction = likeMap.get(`${target.type}:${target.value}`);
      if (reaction) result.set(playlist.id, reaction);
    }
    // Debug: log computed result
    if (likeMap.size > 0 && playlists.length > 0) {
      console.warn('[MusicHome] playlistLikedReactionById:', result.size, 'matches from', playlists.length, 'playlists, likeMap has', likeMap.size, 'entries');
    }
    return result;
  });

  // Search input reference for focusing
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('musicContent') musicContent?: ElementRef<HTMLDivElement>;

  // Following pubkeys for filtering
  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  // Current user pubkey
  private currentPubkey = computed(() => {
    return this.accountState.pubkey();
  });

  isAuthenticated = computed(() => this.app.authenticated());

  // URL query param for list filter (for passing to ListFilterMenuComponent)
  urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);

  // List filter state - 'all', 'following', or follow set d-tag
  selectedListFilter = signal<ListFilterValue>('all');
  selectedTrackSort = signal<MusicTrackSortValue>('released');
  // Computed: get all follow sets for the dropdown
  allFollowSets = computed(() => this.followSetsService.followSets());

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

  // Computed: get the display title for the current filter
  filterTitle = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === 'all') return 'All Music';
    if (filter === 'following') return 'Following';
    const followSet = this.selectedFollowSet();
    return followSet?.title || 'Music';
  });

  /**
   * Helper to check if a track matches search query
   * Searches in title, artist tag, and hashtags
   */
  private trackMatchesSearch(track: Event, query: string): boolean {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();

    // Check title
    const title = this.utilities.getMusicTitle(track);
    if (title?.toLowerCase().includes(lowerQuery)) return true;

    // Check artist tag
    const artist = this.utilities.getMusicArtist(track);
    if (artist?.toLowerCase().includes(lowerQuery)) return true;

    // Check hashtags
    const hashtags = track.tags.filter(t => t[0] === 't').map(t => t[1]?.toLowerCase());
    if (hashtags.some(tag => tag?.includes(lowerQuery))) return true;

    return false;
  }

  /**
   * Helper to check if a playlist matches search query
   * Searches in title and description
   */
  private playlistMatchesSearch(playlist: Event, query: string): boolean {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();

    // Check title
    const titleTag = playlist.tags.find(t => t[0] === 'title');
    if (titleTag?.[1]?.toLowerCase().includes(lowerQuery)) return true;

    // Check description
    const descTag = playlist.tags.find(t => t[0] === 'description');
    if (descTag?.[1]?.toLowerCase().includes(lowerQuery)) return true;

    // Check content
    if (playlist.content?.toLowerCase().includes(lowerQuery)) return true;

    return false;
  }

  private isPrivatePlaylist(playlist: Event): boolean {
    return playlist.tags.some(tag => tag[0] === 'private' && tag[1] === 'true');
  }

  private getTrackUniqueId(track: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string {
    const dTag = track.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
    return `${track.kind}:${track.pubkey}:${dTag}`;
  }

  // Filtered tracks and playlists based on search
  private filteredTracks = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return this.allTracks();
    return this.allTracks().filter(track => this.trackMatchesSearch(track, query));
  });

  private filteredPlaylists = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return this.allPlaylists();
    return this.allPlaylists().filter(playlist => this.playlistMatchesSearch(playlist, query));
  });

  // === YOUR SECTION ===
  // User's own playlists
  myPlaylists = computed(() => {
    const pubkey = this.currentPubkey();
    if (!pubkey) return [];
    return this.filteredPlaylists()
      .filter(p => p.pubkey === pubkey)
      .sort((a, b) => b.created_at - a.created_at);
  });

  myPlaylistsPreview = computed(() => this.myPlaylists().slice(0, SECTION_LIMIT));
  hasMoreMyPlaylists = computed(() => this.myPlaylists().length > SECTION_LIMIT);

  // === FILTERED PLAYLISTS (based on list filter) ===
  // Playlists filtered by list filter
  listFilteredPlaylists = computed(() => {
    const pubkeys = this.filterPubkeys();

    let playlists = this.filteredPlaylists()
      .filter(p => !this.isPrivatePlaylist(p));

    // Apply filter
    if (pubkeys !== null) {
      if (pubkeys.length === 0) return [];
      playlists = playlists.filter(p => pubkeys.includes(p.pubkey));
    }

    return playlists.sort((a, b) => b.created_at - a.created_at);
  });

  listFilteredPlaylistsPreview = computed(() => {
    const limit = this.calculatePlaylistLimit();
    return this.listFilteredPlaylists().slice(0, limit);
  });

  hasMoreListFilteredPlaylists = computed(() => {
    const limit = this.calculatePlaylistLimit();
    return this.listFilteredPlaylists().length > limit;
  });

  listFilteredPlaylistsCount = computed(() => this.listFilteredPlaylists().length);

  // === FILTERED SONGS (based on list filter) ===
  // Tracks filtered by list filter
  listFilteredTracks = computed(() => {
    const pubkeys = this.filterPubkeys();

    let tracks = this.filteredTracks();

    // Apply filter
    if (pubkeys !== null) {
      if (pubkeys.length === 0) return [];
      tracks = tracks.filter(t => pubkeys.includes(t.pubkey));
    }

    return this.sortTracks(tracks);
  });

  listFilteredTracksPreview = computed(() => {
    const limit = this.calculateTrackLimit();
    return this.listFilteredTracks().slice(0, limit);
  });

  hasMoreListFilteredTracks = computed(() => {
    const limit = this.calculateTrackLimit();
    return this.listFilteredTracks().length > limit;
  });

  listFilteredTracksCount = computed(() => this.listFilteredTracks().length);

  // Keep legacy computed properties for backward compatibility with navigation
  // === PLAYLISTS (FOLLOWING) - for "Show all" navigation ===
  followingPlaylists = computed(() => {
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    if (following.length === 0) return [];
    return this.filteredPlaylists()
      .filter(p => following.includes(p.pubkey) && p.pubkey !== myPubkey)
      .filter(p => !this.isPrivatePlaylist(p))
      .sort((a, b) => b.created_at - a.created_at);
  });

  // === SONGS (FOLLOWING) - for "Show all" navigation ===
  followingTracks = computed(() => {
    const following = this.followingPubkeys();
    if (following.length === 0) return [];
    return this.sortTracks(this.filteredTracks().filter(track => following.includes(track.pubkey)));
  });

  // === PLAYLISTS (PUBLIC) - for "Show all" navigation ===
  publicPlaylists = computed(() => {
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    return this.filteredPlaylists()
      .filter(p => !following.includes(p.pubkey) && p.pubkey !== myPubkey)
      .filter(p => !this.isPrivatePlaylist(p))
      .sort((a, b) => b.created_at - a.created_at);
  });

  // === SONGS (PUBLIC) - for "Show all" navigation ===
  publicTracks = computed(() => {
    const following = this.followingPubkeys();
    return this.sortTracks(this.filteredTracks().filter(track => !following.includes(track.pubkey)));
  });

  // === ARTISTS ===
  /**
   * Extract all unique artists from tracks with their pubkeys
   * Returns artist data sorted alphabetically by name
   */
  allArtists = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const artistMap = new Map<string, { name: string; pubkey: string }>();

    this.filteredTracks().forEach(track => {
      const artistName = this.utilities.getMusicArtist(track)?.trim();
      if (artistName) {
        // Apply search filter if active
        if (!query || artistName.toLowerCase().includes(query)) {
          // Use the first pubkey we find for each artist name
          if (!artistMap.has(artistName)) {
            artistMap.set(artistName, { name: artistName, pubkey: track.pubkey });
          }
        }
      }
    });

    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  artistsPreview = computed(() => {
    const limit = this.calculateArtistLimit();
    return this.allArtists().slice(0, limit);
  });

  hasMoreArtists = computed(() => {
    const limit = this.calculateArtistLimit();
    return this.allArtists().length > limit;
  });

  artistsCount = computed(() => this.allArtists().length);

  recentListeningEntries = computed(() => {
    return this.recentListening()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  });

  // Search results indicator
  hasSearchResults = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return true;
    return this.filteredTracks().length > 0 || this.filteredPlaylists().length > 0;
  });

  totalSearchResults = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return 0;
    return this.filteredTracks().length + this.filteredPlaylists().length + this.playlists().length;
  });

  playlistPreview = computed(() => this.playlists().slice(0, this.calculateCompactPlaylistLimit()));
  playlistsCount = computed(() => this.playlists().length);
  hasMorePlaylists = computed(() => this.playlists().length > this.calculateCompactPlaylistLimit());

  // Music relay set constant
  private readonly RELAY_SET_KIND = 30002;
  private readonly MUSIC_RELAY_SET_D_TAG = 'music';

  constructor() {
    this.twoColumnLayout.setWideLeft();
    this.playlists.set(this.getVisibleBookmarkPlaylistEvents());
    this.initializeMusic();
    void this.loadBookmarkPlaylists();

    // Auto-open upload dialog if navigated with ?upload=true
    if (this.route.snapshot.queryParams['upload'] === 'true') {
      this.showUploadDialog.set(true);
      // Remove the query param so refreshing doesn't re-open
      this.router.navigate([], { queryParams: { upload: undefined }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    effect(() => {
      const pubkey = this.currentPubkey();
      if (pubkey) {
        this.selectedTrackSort.set(this.accountLocalState.getMusicTrackSort(pubkey) as MusicTrackSortValue);
      }
    });

    effect(() => {
      const artistPubkeys = this.allArtists().map(artist => artist.pubkey);
      const listeningPubkeys = this.recentListeningEntries().map(entry => entry.pubkey);
      void this.prefetchProfiles([...artistPubkeys, ...listeningPubkeys]);
    });

    // Stop listening party when media player is closed
    effect(() => {
      const isOpen = this.layout.showMediaPlayer();
      if (!isOpen) {
        untracked(() => this.listeningPartyPubkey.set(null));
      }
    });

    // Load like/zap state when preview tracks/playlists change or user changes
    effect(() => {
      const userPubkey = this.currentPubkey();
      const tracks = this.listFilteredTracksPreview();
      const playlists = this.listFilteredPlaylistsPreview();
      untracked(() => this.loadLikeZapState(userPubkey, tracks, playlists));
    });

    // Update container width after view init and after CSS transitions complete
    // First update quickly for initial render
    setTimeout(() => this.updateContainerWidth(), 50);
    // Second update after CSS width transitions complete (transition is ~300ms)
    setTimeout(() => this.updateContainerWidth(), 400);
  }

  /**
   * Update the container width for dynamic rendering
   */
  updateContainerWidth(): void {
    if (this.musicContent?.nativeElement) {
      this.containerWidth.set(this.musicContent.nativeElement.offsetWidth);
    }
  }

  /**
   * Calculate how many playlists can fit in one row
   */
  private calculatePlaylistLimit(): number {
    const width = this.containerWidth();
    if (width === 0) return SECTION_LIMIT;

    // Playlist cards are minmax(150px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 150;
    const gap = 16;
    const itemsPerRow = Math.floor((width + gap) / (cardMinWidth + gap));

    // Return at least 1 item, max items per row to prevent wrapping
    return Math.max(1, itemsPerRow);
  }

  private calculateCompactPlaylistLimit(): number {
    const width = this.containerWidth();
    if (width === 0) return SECTION_LIMIT;

    const cardMinWidth = 200;
    const gap = 8;
    const itemsPerRow = Math.floor((width + gap) / (cardMinWidth + gap));

    return Math.max(1, itemsPerRow);
  }

  /**
   * Calculate how many tracks can fit in one row
   */
  private calculateTrackLimit(): number {
    const width = this.containerWidth();
    if (width === 0) return SECTION_LIMIT;

    // Track cards are minmax(150px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 150;
    const gap = 16;
    const itemsPerRow = Math.floor((width + gap) / (cardMinWidth + gap));

    // Return at least 1 item, max items per row to prevent wrapping
    return Math.max(1, itemsPerRow);
  }

  /**
   * Calculate how many artist cards can fit in one row
   */
  private calculateArtistLimit(): number {
    const width = this.containerWidth();
    if (width === 0) return SECTION_LIMIT;

    // Artist cards are minmax(120px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 120;
    const gap = 16;
    const itemsPerRow = Math.floor((width + gap) / (cardMinWidth + gap));

    // Return at least 1 item, max items per row to prevent wrapping
    return Math.max(1, itemsPerRow);
  }

  /**
   * Initialize music by first loading from database, then relay set, then start subscriptions
   */
  private async initializeMusic(): Promise<void> {
    // First, load cached tracks and playlists from database for instant display
    await this.loadFromDatabase();

    await this.likedSongsService.ensureInitialized(this.currentPubkey());

    // Then load relay set and start subscriptions for fresh data
    await this.loadMusicRelaySet();
    await this.refreshListeningSection();
    this.startSubscriptions();

    // Ensure the current account's own catalog is cached for offline playback/navigation.
    void this.syncCurrentAccountMusicCache();
  }

  /**
   * Sync all authored tracks/playlists for the current account into IndexedDB.
   * This runs in the background and keeps offline "My Music" usable.
   */
  private async syncCurrentAccountMusicCache(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey || this.syncingOwnMusicCache || this.lastSyncedOwnMusicPubkey === pubkey) {
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    this.syncingOwnMusicCache = true;

    try {
      const [trackCounts, playlistCount] = await Promise.all([
        Promise.all(MUSIC_KINDS.map(kind => this.fetchAndCacheOwnEvents(pubkey, kind, 300))),
        this.fetchAndCacheOwnEvents(pubkey, PLAYLIST_KIND, 200),
      ]);

      const trackCount = trackCounts.reduce((total, count) => total + count, 0);

      this.lastSyncedOwnMusicPubkey = pubkey;
      if (trackCount > 0 || playlistCount > 0) {
        this.logger.debug(
          `[Music] Synced own authored cache: ${trackCount} tracks, ${playlistCount} playlists`
        );
      }
    } catch (error) {
      this.logger.warn('[Music] Failed to sync own authored music cache:', error);
    } finally {
      this.syncingOwnMusicCache = false;
    }
  }

  /**
   * Fetch authored events in pages and persist them to IndexedDB.
   */
  private async fetchAndCacheOwnEvents(pubkey: string, kind: number, batchSize: number): Promise<number> {
    let until: number | undefined;
    let totalCached = 0;
    const seenIds = new Set<string>();
    const maxPages = 20;

    for (let page = 0; page < maxPages; page++) {
      const filter: Filter = {
        kinds: [kind],
        authors: [pubkey],
        limit: batchSize,
      };
      if (until !== undefined) {
        filter.until = until;
      }

      const events = await this.accountRelay.getMany<Event>(filter, { timeout: 7000 });
      if (events.length === 0) {
        break;
      }

      const targetMap = this.utilities.isMusicKind(kind) ? this.trackMap : this.playlistMap;
      let mapChanged = false;
      let oldestTimestamp = Number.MAX_SAFE_INTEGER;

      for (const event of events) {
        if (seenIds.has(event.id)) {
          continue;
        }
        seenIds.add(event.id);

        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = this.utilities.isMusicKind(kind) ? this.getTrackUniqueId(event) : `${event.pubkey}:${dTag}`;
        const existing = targetMap.get(uniqueId);

        if (!existing || event.created_at > existing.created_at) {
          targetMap.set(uniqueId, event);
          mapChanged = true;
        }

        totalCached++;
        oldestTimestamp = Math.min(oldestTimestamp, event.created_at);

        this.database.saveEvent({ ...event, dTag }).catch((err: unknown) => {
          this.logger.warn('[Music] Failed to save authored music event to database:', err);
        });
      }

      if (mapChanged) {
        if (this.utilities.isMusicKind(kind)) {
          this.allTracks.set(Array.from(this.trackMap.values()));
        } else {
          this.allPlaylists.set(Array.from(this.playlistMap.values()));
        }
      }

      if (events.length < batchSize || oldestTimestamp === Number.MAX_SAFE_INTEGER) {
        break;
      }

      until = oldestTimestamp - 1;
    }

    return totalCached;
  }

  /**
   * Load tracks and playlists from local database for instant display
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      this.logger.debug('[Music] Loading from database...');

      // Load tracks from database
      for (const musicKind of MUSIC_KINDS) {
        const cachedTracks = await this.database.getEventsByKind(musicKind);
        for (const track of cachedTracks) {
          if (this.reporting.isUserBlocked(track.pubkey)) continue;
          if (this.reporting.isContentBlocked(track)) continue;

          const uniqueId = this.getTrackUniqueId(track);

          const existing = this.trackMap.get(uniqueId);
          if (!existing || track.created_at > existing.created_at) {
            this.trackMap.set(uniqueId, track);
          }
        }
      }

      if (this.trackMap.size > 0) {
        this.allTracks.set(Array.from(this.trackMap.values()));
        this.logger.debug(`[Music] Loaded ${this.trackMap.size} tracks from database`);
      }

      // Load playlists from database
      const cachedPlaylists = await this.database.getEventsByKind(PLAYLIST_KIND);
      for (const playlist of cachedPlaylists) {
        if (this.reporting.isUserBlocked(playlist.pubkey)) continue;
        if (this.reporting.isContentBlocked(playlist)) continue;

        const dTag = playlist.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${playlist.pubkey}:${dTag}`;

        const existing = this.playlistMap.get(uniqueId);
        if (!existing || playlist.created_at > existing.created_at) {
          this.playlistMap.set(uniqueId, playlist);
        }
      }

      if (this.playlistMap.size > 0) {
        this.allPlaylists.set(Array.from(this.playlistMap.values()));
        this.logger.debug(`[Music] Loaded ${this.playlistMap.size} playlists from database`);
      }

      // If we have cached data, stop showing loading spinner immediately
      if (this.trackMap.size > 0 || this.playlistMap.size > 0) {
        this.loading.set(false);
      }
    } catch (error) {
      this.logger.error('[Music] Error loading from database:', error);
    }
  }

  ngOnDestroy(): void {
    this.listeningPartyPubkey.set(null);
    this.trackSubscription?.close();
    this.playlistSubscription?.close();
    this.listeningSubscription?.close();

    if (this.listeningPruneIntervalId !== null) {
      clearInterval(this.listeningPruneIntervalId);
      this.listeningPruneIntervalId = null;
    }
  }

  /**
   * Pre-load the user's music relay set (kind 30002 with d tag "music")
   * First checks the local database, then fetches from relays and persists
   */
  private async loadMusicRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) return;

    try {
      // First, try to load from local database for immediate use
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        this.RELAY_SET_KIND,
        this.MUSIC_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.logger.debug('[Music] Loaded relay set from database:', cachedEvent);
        this.musicRelaySet.set(cachedEvent);
        const relays = cachedEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
          .map((tag: string[]) => tag[1]);
        this.musicRelays.set(relays);
      }

      // Then fetch from relays to get the latest version
      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      if (relayUrls.length === 0) {
        if (!cachedEvent) {
          this.musicRelays.set([...DEFAULT_MUSIC_RELAYS]);
        }
        return;
      }

      const filter: Filter = {
        kinds: [this.RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [this.MUSIC_RELAY_SET_D_TAG],
        limit: 1,
      };

      const events = await this.pool.query(relayUrls, filter, 3000);
      const foundEvent = events.length > 0
        ? events.reduce((latest, event) => event.created_at > latest.created_at ? event : latest)
        : null;

      if (foundEvent) {
        const event = foundEvent as Event;
        // Only update if newer than cached
        if (!cachedEvent || event.created_at > cachedEvent.created_at) {
          this.logger.debug('[Music] Found newer relay set from relays, updating...');
          this.musicRelaySet.set(event);
          const relays = event.tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1]);
          this.musicRelays.set(relays);

          // Persist to database
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
          this.logger.debug('[Music] Saved relay set to database');
        }
      } else if (!cachedEvent) {
        this.musicRelays.set([...DEFAULT_MUSIC_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Error loading music relay set:', error);
    }
  }

  private startSubscriptions(): void {
    // Get the user's account relays directly (no fallback)
    const accountRelays = this.accountRelay.getRelayUrls();

    // Combine with music-specific relays from the user's relay set
    const customMusicRelays = this.musicRelays();
    let allRelayUrls = [...new Set([...accountRelays, ...customMusicRelays])];

    // For anonymous users, use default anonymous relays
    if (allRelayUrls.length === 0) {
      allRelayUrls = this.utilities.anonymousRelays;
    }

    if (allRelayUrls.length === 0) {
      this.logger.warn('No relays available for loading music');
      this.loading.set(false);
      return;
    }

    let tracksLoaded = false;
    let playlistsLoaded = false;

    const checkLoaded = () => {
      if (tracksLoaded && playlistsLoaded && this.loading()) {
        this.loading.set(false);
      }
    };

    // Set timeouts
    const trackTimeout = setTimeout(() => {
      tracksLoaded = true;
      checkLoaded();
    }, 5000);

    const playlistTimeout = setTimeout(() => {
      playlistsLoaded = true;
      checkLoaded();
    }, 5000);

    // Subscribe to tracks
    const trackFilter: Filter = {
      kinds: MUSIC_KINDS,
      limit: 500,
    };

    this.trackSubscription = this.pool.subscribe(allRelayUrls, trackFilter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = this.getTrackUniqueId(event);

      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.trackMap.set(uniqueId, event);
      this.allTracks.set(Array.from(this.trackMap.values()));

      // Save to database for caching
      this.database.saveEvent({ ...event, dTag }).catch(err =>
        this.logger.warn('[Music] Failed to save track to database:', err)
      );

      if (!tracksLoaded) {
        clearTimeout(trackTimeout);
        tracksLoaded = true;
        checkLoaded();
      }
    });

    // Subscribe to playlists
    const playlistFilter: Filter = {
      kinds: [PLAYLIST_KIND],
      limit: 200,
    };

    this.playlistSubscription = this.pool.subscribe(allRelayUrls, playlistFilter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.playlistMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.playlistMap.set(uniqueId, event);
      this.allPlaylists.set(Array.from(this.playlistMap.values()));

      // Save to database for caching
      this.database.saveEvent({ ...event, dTag }).catch(err =>
        this.logger.warn('[Music] Failed to save playlist to database:', err)
      );

      if (!playlistsLoaded) {
        clearTimeout(playlistTimeout);
        playlistsLoaded = true;
        checkLoaded();
      }
    });
  }

  refresh(): void {
    this.trackMap.clear();
    this.playlistMap.clear();
    this.allTracks.set([]);
    this.allPlaylists.set([]);
    this.loading.set(true);

    this.resetLikeZapState();

    this.trackSubscription?.close();
    this.playlistSubscription?.close();

    void this.refreshListeningSection();
    this.startSubscriptions();
  }

  private async refreshListeningSection(): Promise<void> {
    this.listeningSubscription?.close();
    this.listeningSubscription = null;
    this.resetListeningState();
    await this.loadRecentListening();
    this.startListeningSubscription();
    this.startListeningPruneTimer();
  }

  private async loadRecentListening(): Promise<void> {
    if (!this.isAuthenticated()) {
      this.resetListeningState();
      return;
    }

    try {
      const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
      const events = await this.accountRelay.getMany<Event>(
        {
          kinds: [USER_STATUS_KIND],
          '#d': ['music'],
          since: oneHourAgo,
          limit: 500,
        },
        { timeout: 5000 },
      );

      for (const event of events) {
        this.applyListeningEvent(event);
      }
    } catch (error) {
      this.logger.warn('[Music] Failed to load recent listening statuses:', error);
      this.resetListeningState();
    }
  }

  private startListeningSubscription(): void {
    if (!this.isAuthenticated()) {
      return;
    }

    const relayUrls = this.accountRelay.getRelayUrls();
    if (relayUrls.length === 0) {
      return;
    }

    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const filter: Filter = {
      kinds: [USER_STATUS_KIND],
      '#d': ['music'],
      since: oneHourAgo,
    };

    this.listeningSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      this.applyListeningEvent(event);
    });
  }

  private startListeningPruneTimer(): void {
    if (!this.app.isBrowser()) {
      return;
    }

    if (this.listeningPruneIntervalId !== null) {
      clearInterval(this.listeningPruneIntervalId);
    }

    this.listeningPruneIntervalId = window.setInterval(() => {
      this.pruneExpiredListeningEntries();
    }, 30_000);
  }

  private resetListeningState(): void {
    this.listeningMap.clear();
    this.latestListeningTimestamps.clear();
    this.recentListening.set([]);
  }

  private applyListeningEvent(event: Event): void {
    if (this.reporting.isUserBlocked(event.pubkey)) return;
    if (this.reporting.isContentBlocked(event)) return;

    const latestTimestamp = this.latestListeningTimestamps.get(event.pubkey);
    if (latestTimestamp !== undefined && latestTimestamp >= event.created_at) {
      return;
    }

    this.latestListeningTimestamps.set(event.pubkey, event.created_at);

    const entry = this.parseListeningEvent(event);
    if (entry) {
      this.listeningMap.set(event.pubkey, entry);
      void this.dataService.getProfiles([entry.pubkey]);
    } else {
      this.listeningMap.delete(event.pubkey);
    }

    this.syncListeningSignal();

    // Auto-play if this user is our listening party target
    if (entry && event.pubkey === this.listeningPartyPubkey() && entry.trackPubkey && entry.trackIdentifier) {
      void this.playListeningEntry(entry);
    }
  }

  private parseListeningEvent(event: Event): ListeningEntry | null {
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (dTag !== 'music') {
      return null;
    }

    const content = event.content.trim();
    if (!content) {
      return null;
    }

    const expirationValue = event.tags.find(tag => tag[0] === 'expiration')?.[1];
    const expiration = expirationValue ? Number.parseInt(expirationValue, 10) : undefined;
    const now = Math.floor(Date.now() / 1000);
    if (expiration && expiration < now) {
      return null;
    }

    const [trackKind, trackPubkey, trackIdentifier] = this.parseMusicTrackReference(
      event.tags.find(tag => tag[0] === 'a')?.[1],
    );
    const externalUrl = this.parseListeningExternalUrl(event.tags.find(tag => tag[0] === 'r')?.[1]);

    return {
      pubkey: event.pubkey,
      content,
      createdAt: event.created_at,
      expiration,
      trackKind,
      trackPubkey,
      trackIdentifier,
      externalUrl,
    };
  }

  private pruneExpiredListeningEntries(): void {
    const now = Math.floor(Date.now() / 1000);
    let changed = false;

    for (const [pubkey, entry] of this.listeningMap.entries()) {
      if (entry.expiration && entry.expiration < now) {
        this.listeningMap.delete(pubkey);
        changed = true;
      }
    }

    if (changed) {
      this.syncListeningSignal();
    }
  }

  private syncListeningSignal(): void {
    this.recentListening.set(
      Array.from(this.listeningMap.values()).sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  private parseMusicTrackReference(aTag?: string): [number | undefined, string | undefined, string | undefined] {
    const parsed = this.utilities.parseMusicTrackCoordinate(aTag);
    if (!parsed) {
      return [undefined, undefined, undefined];
    }

    return [parsed.kind, parsed.pubkey, parsed.identifier];
  }

  private parseListeningExternalUrl(url?: string): string | undefined {
    if (!url) {
      return undefined;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return undefined;
      }

      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  openListeningTrack(entry: ListeningEntry, event?: MouseEvent): void {
    event?.stopPropagation();

    if (entry.trackPubkey && entry.trackIdentifier) {
      this.layout.openSongDetail(entry.trackPubkey, entry.trackIdentifier);
      return;
    }

    if (entry.externalUrl) {
      window.open(entry.externalUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async playListeningEntry(entry: ListeningEntry, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();

    if (!entry.trackPubkey || !entry.trackIdentifier) {
      return;
    }

    const track = await this.resolveTrackEvent(entry.trackPubkey, entry.trackIdentifier, entry.trackKind);
    if (!track) {
      return;
    }

    const mediaItem = await this.createMediaItemFromTrack(track);
    if (!mediaItem) {
      return;
    }

    this.mediaPlayer.play(mediaItem);
  }

  async startListeningParty(entry: ListeningEntry, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    this.listeningPartyPubkey.set(entry.pubkey);
    await this.playListeningEntry(entry);
  }

  stopListeningParty(event?: MouseEvent): void {
    event?.stopPropagation();
    this.listeningPartyPubkey.set(null);
  }

  openListeningProfile(pubkey: string): void {
    this.layout.openProfile(pubkey);
  }

  private async prefetchProfiles(pubkeys: string[]): Promise<void> {
    const uniquePubkeys = [...new Set(pubkeys.filter(pubkey => !!pubkey?.trim()))]
      .filter(pubkey => !this.requestedProfilePubkeys.has(pubkey));

    if (uniquePubkeys.length === 0) {
      return;
    }

    uniquePubkeys.forEach(pubkey => this.requestedProfilePubkeys.add(pubkey));

    await this.dataService.batchLoadProfiles(
      uniquePubkeys,
      () => this.profileRenderVersion.update(version => version + 1),
      true,
    );

    this.profileRenderVersion.update(version => version + 1);
  }

  getListeningPicture(pubkey: string): string | null {
    this.profileRenderVersion();
    const profile = this.dataService.getCachedProfile(pubkey);
    return typeof profile?.data?.picture === 'string' ? profile.data.picture : null;
  }

  getListeningDisplayName(pubkey: string): string {
    this.profileRenderVersion();
    const profile = this.dataService.getCachedProfile(pubkey);
    const displayName = profile?.data?.display_name;
    if (typeof displayName === 'string' && displayName.trim()) {
      return displayName;
    }

    const name = profile?.data?.name;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }

    return this.utilities.getTruncatedNpub(pubkey);
  }

  getListeningTrackArtwork(entry: ListeningEntry): string | null {
    if (!entry.trackPubkey || !entry.trackIdentifier) {
      return null;
    }

    const track = this.findCachedTrackEvent(entry.trackPubkey, entry.trackIdentifier, entry.trackKind);
    const artwork = track ? this.utilities.getMusicImage(track) : undefined;

    if (artwork) {
      return artwork;
    }

    return this.getListeningPicture(entry.trackPubkey);
  }

  private findCachedTrackEvent(pubkey: string, dTag: string, kind?: number): Event | undefined {
    return this.allTracks().find(track => {
      return track.pubkey === pubkey
        && track.tags.find(tag => tag[0] === 'd')?.[1] === dTag
        && (kind === undefined || track.kind === kind);
    });
  }

  private async resolveTrackEvent(pubkey: string, dTag: string, kind?: number): Promise<Event | null> {
    const cachedTrack = this.findCachedTrackEvent(pubkey, dTag, kind);

    if (cachedTrack) {
      return cachedTrack;
    }

    const relayUrls = [...new Set([...this.accountRelay.getRelayUrls(), ...this.musicRelays()])];
    if (relayUrls.length === 0) {
      return null;
    }

    return await new Promise<Event | null>((resolve) => {
      let latestEvent: Event | null = null;
      const filter: Filter = {
        kinds: kind ? [kind] : MUSIC_KINDS,
        authors: [pubkey],
        '#d': [dTag],
        limit: 1,
      };

      const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
        if (!latestEvent || event.created_at > latestEvent.created_at) {
          latestEvent = event;
        }
      });

      setTimeout(() => {
        sub.close();
        resolve(latestEvent);
      }, 2500);
    });
  }

  private async createMediaItemFromTrack(track: Event): Promise<MediaItem | null> {
    const source = this.utilities.getMusicAudioUrl(track);
    if (!source) {
      return null;
    }

    const title = this.utilities.getMusicTitle(track) || 'Untitled Track';
    const artistTag = this.utilities.getMusicArtist(track);
    const imageTag = this.utilities.getMusicImage(track);
    const videoTag = track.tags.find(tag => tag[0] === 'video');
    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';

    let artistName = artistTag?.trim() || 'Unknown Artist';
    let fallbackArtwork = '';

    try {
      const profile = await this.dataService.getProfile(track.pubkey);
      if ((!artistName || artistName === 'Unknown Artist') && profile?.data) {
        artistName = profile.data.display_name || profile.data.name || artistName;
      }
      fallbackArtwork = typeof profile?.data?.picture === 'string' ? profile.data.picture : '';
    } catch {
      // Keep current fallbacks
    }

    return {
      source,
      title,
      artist: artistName,
      artwork: imageTag || fallbackArtwork,
      video: videoTag?.[1] || undefined,
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
      eventKind: track.kind,
      lyrics: this.utilities.extractLyricsFromEvent(track),
    };
  }

  // Navigation methods
  // List views navigate in left panel (router), individual items open in right panel (layout)
  goToLikedSongs(): void {
    this.layout.openMusicLiked();
  }

  goToLikedPlaylists(): void {
    this.layout.openMusicLikedPlaylists();
  }

  goToPlaylists(): void {
    void this.panelNav.navigateLeftPreservingRight('/music/playlists');
  }

  goToMyMusic(): void {
    const pubkey = this.currentPubkey();
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      this.layout.openMusicArtist(npub);
    }
  }

  goToOfflineMusic(): void {
    void this.panelNav.navigateLeftPreservingRight('/music/offline');
  }

  /**
   * Handle filter change from ListFilterMenuComponent
   */
  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
  }

  private sortTracks(tracks: Event[]): Event[] {
    return [...tracks].sort((a, b) => this.getTrackSortValue(b) - this.getTrackSortValue(a));
  }

  private getTrackSortValue(track: Event): number {
    if (this.selectedTrackSort() === 'published') {
      return this.getTrackPublishedSortValue(track);
    }

    return this.getTrackReleaseSortValue(track) ?? this.getTrackPublishedSortValue(track);
  }

  setTrackSort(sort: MusicTrackSortValue): void {
    this.selectedTrackSort.set(sort);

    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountLocalState.setMusicTrackSort(pubkey, sort);
    }
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

  /**
   * Navigate to all playlists with current filter
   */
  goToAllPlaylists(): void {
    const filter = this.selectedListFilter();
    this.musicData.setPreloadedPlaylists(this.listFilteredPlaylists());

    // Map filter to source parameter for sub-component
    let source: string;
    if (filter === 'all') {
      source = 'public';
    } else if (filter === 'following') {
      source = 'following';
    } else {
      // For follow set, pass the d-tag as list parameter
      void this.panelNav.navigateLeftPreservingRight('/music/albums', { queryParams: { list: filter } });
      return;
    }
    void this.panelNav.navigateLeftPreservingRight('/music/albums', { queryParams: { source } });
  }

  /**
   * Navigate to all tracks with current filter
   */
  goToAllTracks(): void {
    const filter = this.selectedListFilter();
    this.musicData.setPreloadedTracks(this.listFilteredTracks());

    // Map filter to source parameter for sub-component
    let source: string;
    if (filter === 'all') {
      source = 'public';
    } else if (filter === 'following') {
      source = 'following';
    } else {
      // For follow set, pass the d-tag as list parameter
      void this.panelNav.navigateLeftPreservingRight('/music/tracks', { queryParams: { list: filter } });
      return;
    }
    void this.panelNav.navigateLeftPreservingRight('/music/tracks', { queryParams: { source } });
  }

  // Legacy navigation methods (keep for backward compatibility)
  goToAllFollowingPlaylists(): void {
    this.musicData.setPreloadedPlaylists(this.followingPlaylists());
    void this.panelNav.navigateLeftPreservingRight('/music/albums', { queryParams: { source: 'following' } });
  }

  goToAllFollowingTracks(): void {
    this.musicData.setPreloadedTracks(this.followingTracks());
    void this.panelNav.navigateLeftPreservingRight('/music/tracks', { queryParams: { source: 'following' } });
  }

  goToAllPublicPlaylists(): void {
    this.musicData.setPreloadedPlaylists(this.publicPlaylists());
    void this.panelNav.navigateLeftPreservingRight('/music/albums', { queryParams: { source: 'public' } });
  }

  goToAllPublicTracks(): void {
    this.musicData.setPreloadedTracks(this.publicTracks());
    void this.panelNav.navigateLeftPreservingRight('/music/tracks', { queryParams: { source: 'public' } });
  }

  goToAllArtists(): void {
    // Convert to ArtistData format with track counts
    const artistsWithCount = this.allArtists().map(artist => ({
      name: artist.name,
      pubkey: artist.pubkey,
      trackCount: this.allTracks().filter(track => this.utilities.getMusicArtist(track)?.trim() === artist.name).length,
    }));
    this.musicData.setPreloadedArtists(artistsWithCount);
    this.musicData.setPreloadedTracks(this.allTracks());
    void this.panelNav.navigateLeftPreservingRight('/music/artists');
  }

  goToArtist(pubkey: string): void {
    const npub = nip19.npubEncode(pubkey);
    this.layout.openMusicArtist(npub);
  }

  /**
   * Get profile picture URL for an artist's pubkey
   */
  getArtistPicture(pubkey: string): string | null {
    this.profileRenderVersion();
    const profile = this.dataService.getCachedProfile(pubkey);
    return profile?.data?.picture || null;
  }

  // Search methods
  toggleSearch(): void {
    const wasVisible = this.showSearch();
    this.showSearch.set(!wasVisible);
    if (!wasVisible) {
      // Focus the search input when opening - use setTimeout for Safari/iOS
      setTimeout(() => {
        this.searchInput?.nativeElement?.focus();
      }, 0);
    } else {
      // Clear search when closing
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

  // Menu actions
  openUploadTrack(): void {
    this.showUploadDialog.set(true);
  }

  onUploadDialogClosed(result: { published: boolean; event?: Event } | null): void {
    this.showUploadDialog.set(false);
    if (result?.published) {
      this.refresh();
    }
  }

  openCreatePlaylist(): void {
    this.showCreatePlaylistDialog.set(true);
  }

  openCreateAlbum(): void {
    this.showCreateAlbumDialog.set(true);
  }

  onCreatePlaylistDialogClosed(result: { playlist: MusicBookmarkPlaylist; trackAdded: boolean } | null): void {
    this.showCreatePlaylistDialog.set(false);
    if (result?.playlist) {
      void this.loadBookmarkPlaylists();
    }
  }

  onCreateAlbumDialogClosed(result: { playlist: MusicPlaylist; trackAdded: boolean } | null): void {
    this.showCreateAlbumDialog.set(false);
    if (result?.playlist) {
      this.refresh();
    }
  }

  private async loadBookmarkPlaylists(): Promise<void> {
    try {
      const cached = this.getVisibleBookmarkPlaylistEvents();
      if (cached.length > 0) {
        this.playlists.set(cached);
      }

      const events = await this.bookmarkPlaylistService.fetchPublicPlaylists(100);
      this.playlists.set(events.filter(event => !this.reporting.isUserBlocked(event.pubkey) && !this.reporting.isContentBlocked(event)));
    } catch (error) {
      this.logger.warn('[Music] Failed to load bookmark playlists:', error);
    }
  }

  private getVisibleBookmarkPlaylistEvents(): Event[] {
    return this.bookmarkPlaylistService
      .userPlaylists()
      .map(playlist => playlist.event)
      .filter((event): event is Event => !!event)
      .filter(event => !this.reporting.isUserBlocked(event.pubkey) && !this.reporting.isContentBlocked(event))
      .sort((a, b) => b.created_at - a.created_at);
  }

  openImportFromRss(): void {
    this.showImportRssDialog.set(true);
  }

  onImportRssDialogClosed(result: { published: boolean; events?: Event[] } | null): void {
    this.showImportRssDialog.set(false);
    if (result?.published) {
      this.refresh();
    }
  }

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  async onSettingsDialogClosed(result: { saved: boolean } | null): Promise<void> {
    this.showSettingsDialog.set(false);
    if (result?.saved) {
      // Reload the music relay set and restart subscriptions with new relays
      await this.loadMusicRelaySet();
      this.refresh();
    }
  }

  async playLikedSongs(event: MouseEvent): Promise<void> {
    event.stopPropagation(); // Prevent navigation to liked songs page

    const pubkey = this.currentPubkey();
    if (!pubkey) return;

    this.isLoadingLikedSongs.set(true);

    try {
      await this.likedSongsService.ensureInitialized(pubkey);

      const likedTrackRefs = this.likedSongsService.likedSongRefs()
        .map(item => item.ref)
        .filter(ref => !!this.utilities.parseMusicTrackCoordinate(ref));

      if (likedTrackRefs.length === 0) {
        this.isLoadingLikedSongs.set(false);
        return;
      }

      // Use account relays + custom music relays
      const accountRelays = this.accountRelay.getRelayUrls();
      const customMusicRelays = this.musicRelays();
      const relayUrls = [...new Set([...accountRelays, ...customMusicRelays])];

      // Build individual filters for each address
      const addressFilters: Filter[] = [];
      for (const addr of likedTrackRefs.slice(0, 500)) {
        const coordinate = this.utilities.parseMusicTrackCoordinate(addr);
        if (coordinate) {
          addressFilters.push({
            kinds: [coordinate.kind],
            authors: [coordinate.pubkey],
            '#d': [coordinate.identifier],
          });
        }
      }

      const trackMap = new Map<string, Event>();

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        let subsFinished = 0;
        const totalSubs = addressFilters.length;

        for (const filter of addressFilters) {
          const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
            const uniqueId = this.getTrackUniqueId(event);

            const existing = trackMap.get(uniqueId);
            if (!existing || event.created_at > existing.created_at) {
              trackMap.set(uniqueId, event);
            }
          });

          setTimeout(() => {
            sub.close();
            subsFinished++;
            if (subsFinished >= totalSubs) {
              clearTimeout(timeout);
              resolve();
            }
          }, 2500);
        }
      });

      const allTracks = Array.from(trackMap.values());

      if (allTracks.length === 0) {
        this.isLoadingLikedSongs.set(false);
        return;
      }

      // Play the tracks
      for (let i = 0; i < allTracks.length; i++) {
        const track = allTracks[i];
        const source = this.utilities.getMusicAudioUrl(track);
        if (!source) continue;

        const title = this.utilities.getMusicTitle(track) || 'Untitled Track';
        const imageTag = this.utilities.getMusicImage(track);
        const videoTag = track.tags.find(t => t[0] === 'video');
        const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

        // Get artist name from profile
        let artistName = 'Unknown Artist';
        try {
          const profile = await this.dataService.getProfile(track.pubkey);
          if (profile?.data) {
            artistName = profile.data.display_name || profile.data.name || artistName;
          }
        } catch {
          // Keep default artist name
        }

        const mediaItem: MediaItem = {
          source,
          title,
          artist: artistName,
          artwork: imageTag || '',
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
    } catch (error) {
      this.logger.error('Error playing liked songs:', error);
    } finally {
      this.isLoadingLikedSongs.set(false);
    }
  }

  // === Like/Zap state for home page tracks ===

  onPlaylistLikedReactionChange(playlist: Event, reaction: Event | null): void {
    const target = this.getTrackReactionTarget(playlist);
    if (!target) return;

    const targetKey = `${target.type}:${target.value}`;
    this.likedReactionByTargetKey.update(existing => {
      const next = new Map(existing);
      if (reaction) {
        next.set(targetKey, reaction);
      } else {
        next.delete(targetKey);
      }
      return next;
    });
  }

  private getTrackReactionTarget(track: Event): { type: 'a' | 'e'; value: string } | null {
    if (this.utilities.isParameterizedReplaceableEvent(track.kind)) {
      const identifier = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
      return { type: 'a', value: `${track.kind}:${track.pubkey}:${identifier}` };
    }
    if (!track.id) return null;
    return { type: 'e', value: track.id };
  }

  private resetLikeZapState(): void {
    this.likedReactionByTargetKey.set(new Map());
    this.zappedTargetKeys.set(new Set());
    this.likeZapLoaded = false;
    this.likeZapLoading = false;
  }

  private loadLikeZapState(userPubkey: string | null, tracks: Event[], playlists: Event[] = []): void {
    // Reset if user changed
    if (this.likeZapStatePubkey !== userPubkey) {
      this.likeZapStatePubkey = userPubkey;
      this.resetLikeZapState();
    }

    if (!userPubkey || (tracks.length === 0 && playlists.length === 0) || this.likeZapLoaded || this.likeZapLoading) {
      return;
    }

    this.likeZapLoading = true;
    void this.fetchLikeZapState(userPubkey, [...tracks, ...playlists]);
  }

  private async fetchLikeZapState(userPubkey: string, events: Event[]): Promise<void> {
    try {
      // Collect targets from all events (tracks + playlists)
      const aTargets: string[] = [];
      const eTargets: string[] = [];
      for (const ev of events) {
        const target = this.getTrackReactionTarget(ev);
        if (!target) continue;
        if (target.type === 'a') {
          aTargets.push(target.value);
        } else {
          eTargets.push(target.value);
        }
      }

      // Load likes
      await this.fetchLikes(userPubkey);

      // Load zaps
      await this.fetchZaps(userPubkey, aTargets, eTargets);
    } catch (error) {
      this.logger.warn('[Music] Failed to load like/zap state for home page:', error);
    } finally {
      this.likeZapLoading = false;
      this.likeZapLoaded = true;
    }
  }

  private async fetchLikes(userPubkey: string): Promise<void> {
    // Use broad query approach (same as music-tracks component) — fetch ALL user
    // reactions and filter locally, since targeted #a/#e filters may miss reactions
    // depending on relay support.
    const reactions = await this.accountRelay.getMany<Event>({
      kinds: [kinds.Reaction],
      authors: [userPubkey],
      limit: 1000,
    }, { timeout: LIKE_QUERY_TIMEOUT_MS });

    if (this.likeZapStatePubkey !== userPubkey) return;

    const newestReactionByKey = new Map<string, Event>();

    for (const reaction of reactions) {
      if (!this.isPositiveReaction(reaction)) continue;
      if (!this.isMusicLikeReaction(reaction)) continue;

      const reactionKey = this.getReactionTargetKeyFromReaction(reaction);
      if (!reactionKey) continue;

      const existing = newestReactionByKey.get(reactionKey);
      if (!existing || reaction.created_at > existing.created_at) {
        newestReactionByKey.set(reactionKey, reaction);
      }
    }

    // Debug: log playlist-like reactions found
    const playlistLikes = [...newestReactionByKey.entries()].filter(([k]) => k.includes(':34139:'));
    if (playlistLikes.length > 0) {
      console.warn('[MusicHome] Found', playlistLikes.length, 'playlist-like reactions:', playlistLikes.map(([k]) => k));
    } else {
      console.warn('[MusicHome] No playlist-like reactions found among', newestReactionByKey.size, 'total music reactions from', reactions.length, 'raw reactions');
    }

    if (newestReactionByKey.size > 0) {
      this.likedReactionByTargetKey.update(existing => {
        const next = new Map(existing);
        for (const [key, reaction] of newestReactionByKey.entries()) {
          next.set(key, reaction);
        }
        return next;
      });
    }
  }

  private async fetchZaps(userPubkey: string, aTargets: string[], eTargets: string[]): Promise<void> {
    const matchedKeys = new Set<string>();

    const loadBatch = async (targetType: 'a' | 'e', targetValues: string[]) => {
      if (targetValues.length === 0) return;
      const targetTag = targetType === 'a' ? '#a' : '#e';

      const [senderFiltered, targetFiltered] = await Promise.all([
        this.accountRelay.getMany<Event>({
          kinds: [9735],
          '#P': [userPubkey],
          [targetTag]: targetValues,
          limit: targetValues.length * 4,
        } as unknown as Filter, { timeout: LIKE_QUERY_TIMEOUT_MS }),
        this.accountRelay.getMany<Event>({
          kinds: [9735],
          [targetTag]: targetValues,
          limit: targetValues.length * 8,
        } as Filter, { timeout: LIKE_QUERY_TIMEOUT_MS }),
      ]);

      const merged = new Map<string, Event>();
      for (const receipt of [...senderFiltered, ...targetFiltered]) {
        merged.set(receipt.id, receipt);
      }

      for (const zapReceipt of merged.values()) {
        const parsed = this.zapService.parseZapReceipt(zapReceipt);
        const zapRequest = parsed.zapRequest;
        if (!zapRequest || zapRequest.pubkey !== userPubkey) continue;

        const target = this.getMusicTrackTargetFromZapRequest(zapRequest);
        if (!target || target.type !== targetType || !targetValues.includes(target.value)) continue;

        matchedKeys.add(`${target.type}:${target.value}`);
      }
    };

    await loadBatch('a', aTargets);
    await loadBatch('e', eTargets);

    if (this.likeZapStatePubkey !== userPubkey) return;

    if (matchedKeys.size > 0) {
      this.zappedTargetKeys.update(existing => {
        const next = new Set(existing);
        for (const key of matchedKeys) {
          next.add(key);
        }
        return next;
      });
    }
  }

  private getMusicTrackTargetFromZapRequest(zapRequest: Event): { type: 'a' | 'e'; value: string } | null {
    const aTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'a')?.[1]?.trim();
    if (aTag && this.utilities.parseMusicTrackCoordinate(aTag)) {
      return { type: 'a', value: aTag };
    }

    const eTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'e')?.[1]?.trim();
    const kindTag = zapRequest.tags.find((tag: string[]) => tag[0] === 'k')?.[1]?.trim();
    if (!eTag || !kindTag) return null;

    const kind = Number.parseInt(kindTag, 10);
    if (Number.isNaN(kind) || !this.utilities.isMusicKind(kind)) return null;

    return { type: 'e', value: eTag };
  }

  private isPositiveReaction(reaction: Event): boolean {
    return reaction.content === '+'
      || reaction.content === '❤️'
      || reaction.content === '🤙'
      || reaction.content === '👍';
  }

  private isMusicLikeReaction(reaction: Event): boolean {
    const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1]?.trim();
    if (aTag) {
      return !!this.utilities.parseMusicTrackCoordinate(aTag) || this.isMusicPlaylistCoordinate(aTag);
    }

    const kindTag = reaction.tags.find(tag => tag[0] === 'k')?.[1]?.trim();
    if (!kindTag) return false;

    const kind = Number.parseInt(kindTag, 10);
    return !Number.isNaN(kind) && (this.utilities.isMusicKind(kind) || kind === 34139);
  }

  private isMusicPlaylistCoordinate(coordinate: string): boolean {
    const parts = coordinate.split(':');
    if (parts.length < 3) return false;
    const kind = Number.parseInt(parts[0], 10);
    return kind === 34139;
  }

  private getReactionTargetKeyFromReaction(reaction: Event): string | null {
    const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1]?.trim();
    if (aTag) return `a:${aTag}`;

    const eTag = reaction.tags.find(tag => tag[0] === 'e')?.[1]?.trim();
    if (eTag) return `e:${eTag}`;

    return null;
  }
}
