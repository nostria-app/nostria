import { Component, inject, signal, computed, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
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
import { MediaItem } from '../../interfaces';
import { MusicEventComponent } from '../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../components/music-playlist-card/music-playlist-card.component';
import { CreateMusicPlaylistDialogComponent } from './create-music-playlist-dialog/create-music-playlist-dialog.component';
import { MusicTrackDialogComponent } from './music-track-dialog/music-track-dialog.component';
import { ImportRssDialogComponent } from './import-rss-dialog/import-rss-dialog.component';
import { MusicSettingsDialogComponent } from './music-settings-dialog/music-settings-dialog.component';
import { MusicPlaylist } from '../../services/music-playlist.service';
import { MusicDataService } from '../../services/music-data.service';
import { ListFilterMenuComponent, ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { LoggerService } from '../../services/logger.service';

const MUSIC_KIND = 36787;
const PLAYLIST_KIND = 34139;
const SECTION_LIMIT = 12;

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
    MusicTrackDialogComponent,
    ImportRssDialogComponent,
    MusicSettingsDialogComponent,
    ListFilterMenuComponent,
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
  private musicData = inject(MusicDataService);
  followSetsService = inject(FollowSetsService);
  private readonly logger = inject(LoggerService);

  allTracks = signal<Event[]>([]);
  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  isLoadingLikedSongs = signal(false);

  // Search functionality
  searchQuery = signal('');
  showSearch = signal(false);

  // "Yours" section collapsed state
  yoursSectionCollapsed = signal(false);

  // Container width for dynamic rendering
  containerWidth = signal(0);

  // Offline music track count
  offlineTrackCount = computed(() => this.offlineMusicService.offlineTracks().length);

  // Dialog visibility
  showUploadDialog = signal(false);
  showCreatePlaylistDialog = signal(false);
  showImportRssDialog = signal(false);
  showSettingsDialog = signal(false);

  // Music relay set state
  musicRelaySet = signal<Event | null>(null);
  musicRelays = signal<string[]>([]);

  private trackSubscription: { close: () => void } | null = null;
  private playlistSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();
  private playlistMap = new Map<string, Event>();

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
    const titleTag = track.tags.find(t => t[0] === 'title');
    if (titleTag?.[1]?.toLowerCase().includes(lowerQuery)) return true;

    // Check artist tag
    const artistTag = track.tags.find(t => t[0] === 'artist');
    if (artistTag?.[1]?.toLowerCase().includes(lowerQuery)) return true;

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
  // Playlists filtered by list filter (excluding user's own)
  listFilteredPlaylists = computed(() => {
    const myPubkey = this.currentPubkey();
    const pubkeys = this.filterPubkeys();

    let playlists = this.filteredPlaylists()
      .filter(p => p.pubkey !== myPubkey);

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

    return tracks.sort((a, b) => b.created_at - a.created_at);
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
      .sort((a, b) => b.created_at - a.created_at);
  });

  // === SONGS (FOLLOWING) - for "Show all" navigation ===
  followingTracks = computed(() => {
    const following = this.followingPubkeys();
    if (following.length === 0) return [];
    return this.filteredTracks()
      .filter(track => following.includes(track.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
  });

  // === PLAYLISTS (PUBLIC) - for "Show all" navigation ===
  publicPlaylists = computed(() => {
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    return this.filteredPlaylists()
      .filter(p => !following.includes(p.pubkey) && p.pubkey !== myPubkey)
      .sort((a, b) => b.created_at - a.created_at);
  });

  // === SONGS (PUBLIC) - for "Show all" navigation ===
  publicTracks = computed(() => {
    const following = this.followingPubkeys();
    return this.filteredTracks()
      .filter(track => !following.includes(track.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
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
      const artistTag = track.tags.find(t => t[0] === 'artist');
      if (artistTag?.[1]) {
        const artistName = artistTag[1].trim();
        if (artistName) {
          // Apply search filter if active
          if (!query || artistName.toLowerCase().includes(query)) {
            // Use the first pubkey we find for each artist name
            if (!artistMap.has(artistName)) {
              artistMap.set(artistName, { name: artistName, pubkey: track.pubkey });
            }
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

  // Search results indicator
  hasSearchResults = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return true;
    return this.filteredTracks().length > 0 || this.filteredPlaylists().length > 0;
  });

  totalSearchResults = computed(() => {
    const query = this.searchQuery().trim();
    if (!query) return 0;
    return this.filteredTracks().length + this.filteredPlaylists().length;
  });

  // Music relay set constant
  private readonly RELAY_SET_KIND = 30002;
  private readonly MUSIC_RELAY_SET_D_TAG = 'music';

  constructor() {
    this.twoColumnLayout.setWideLeft();
    // Load collapsed state from storage
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.yoursSectionCollapsed.set(this.accountLocalState.getMusicYoursSectionCollapsed(pubkey));
    }
    this.initializeMusic();

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

    // Playlist cards are minmax(180px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 180;
    const gap = 16;
    const itemsPerRow = Math.floor((width + gap) / (cardMinWidth + gap));

    // Return at least 1 item, max items per row to prevent wrapping
    return Math.max(1, itemsPerRow);
  }

  /**
   * Calculate how many tracks can fit in one row
   */
  private calculateTrackLimit(): number {
    const width = this.containerWidth();
    if (width === 0) return SECTION_LIMIT;

    // Track cards are minmax(180px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 180;
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

    // Artist cards are minmax(180px, 1fr) with 1rem (16px) gap
    const cardMinWidth = 180;
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

    // Then load relay set and start subscriptions for fresh data
    await this.loadMusicRelaySet();
    this.startSubscriptions();
  }

  /**
   * Load tracks and playlists from local database for instant display
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      this.logger.debug('[Music] Loading from database...');

      // Load tracks from database
      const cachedTracks = await this.database.getEventsByKind(MUSIC_KIND);
      for (const track of cachedTracks) {
        if (this.reporting.isUserBlocked(track.pubkey)) continue;
        if (this.reporting.isContentBlocked(track)) continue;

        const dTag = track.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${track.pubkey}:${dTag}`;

        const existing = this.trackMap.get(uniqueId);
        if (!existing || track.created_at > existing.created_at) {
          this.trackMap.set(uniqueId, track);
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
    this.trackSubscription?.close();
    this.playlistSubscription?.close();
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
      if (relayUrls.length === 0) return;

      const filter: Filter = {
        kinds: [this.RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [this.MUSIC_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, 2000);
      });

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
      kinds: [MUSIC_KIND],
      limit: 500,
    };

    this.trackSubscription = this.pool.subscribe(allRelayUrls, trackFilter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

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

    this.trackSubscription?.close();
    this.playlistSubscription?.close();

    this.startSubscriptions();
  }

  // Navigation methods
  // List views navigate in left panel (router), individual items open in right panel (layout)
  goToLikedSongs(): void {
    this.layout.openMusicLiked();
  }

  goToLikedPlaylists(): void {
    this.layout.openMusicLikedPlaylists();
  }

  goToMyMusic(): void {
    const pubkey = this.currentPubkey();
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      this.layout.openMusicArtist(npub);
    }
  }

  goToOfflineMusic(): void {
    this.router.navigate(['/music/offline']);
  }

  /**
   * Handle filter change from ListFilterMenuComponent
   */
  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
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
      this.router.navigate(['/music/playlists'], { queryParams: { list: filter } });
      return;
    }
    this.router.navigate(['/music/playlists'], { queryParams: { source } });
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
      this.router.navigate(['/music/tracks'], { queryParams: { list: filter } });
      return;
    }
    this.router.navigate(['/music/tracks'], { queryParams: { source } });
  }

  // Legacy navigation methods (keep for backward compatibility)
  goToAllFollowingPlaylists(): void {
    this.musicData.setPreloadedPlaylists(this.followingPlaylists());
    this.router.navigate(['/music/playlists'], { queryParams: { source: 'following' } });
  }

  goToAllFollowingTracks(): void {
    this.musicData.setPreloadedTracks(this.followingTracks());
    this.router.navigate(['/music/tracks'], { queryParams: { source: 'following' } });
  }

  goToAllPublicPlaylists(): void {
    this.musicData.setPreloadedPlaylists(this.publicPlaylists());
    this.router.navigate(['/music/playlists'], { queryParams: { source: 'public' } });
  }

  goToAllPublicTracks(): void {
    this.musicData.setPreloadedTracks(this.publicTracks());
    this.router.navigate(['/music/tracks'], { queryParams: { source: 'public' } });
  }

  goToAllArtists(): void {
    // Convert to ArtistData format with track counts
    const artistsWithCount = this.allArtists().map(artist => ({
      name: artist.name,
      pubkey: artist.pubkey,
      trackCount: this.allTracks().filter(track => {
        const artistTag = track.tags.find(t => t[0] === 'artist');
        return artistTag?.[1]?.trim() === artist.name;
      }).length,
    }));
    this.musicData.setPreloadedArtists(artistsWithCount);
    this.musicData.setPreloadedTracks(this.allTracks());
    this.router.navigate(['/music/artists']);
  }

  goToArtist(pubkey: string): void {
    const npub = nip19.npubEncode(pubkey);
    this.layout.openMusicArtist(npub);
  }

  /**
   * Get profile picture URL for an artist's pubkey
   */
  getArtistPicture(pubkey: string): string | null {
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

  // Toggle "Yours" section collapsed state
  toggleYoursSection(): void {
    const newState = !this.yoursSectionCollapsed();
    this.yoursSectionCollapsed.set(newState);
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountLocalState.setMusicYoursSectionCollapsed(pubkey, newState);
    }
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

  onCreatePlaylistDialogClosed(result: { playlist: MusicPlaylist; trackAdded: boolean } | null): void {
    this.showCreatePlaylistDialog.set(false);
    if (result?.playlist) {
      this.refresh();
    }
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
      // Use account relays + custom music relays
      const accountRelays = this.accountRelay.getRelayUrls();
      const customMusicRelays = this.musicRelays();
      const relayUrls = [...new Set([...accountRelays, ...customMusicRelays])];

      // First, fetch reactions (kind 7) from the user for music tracks
      const reactionsFilter: Filter = {
        kinds: [kinds.Reaction],
        authors: [pubkey],
        '#k': [String(MUSIC_KIND)],
        limit: 500,
      };

      const reactions: Event[] = [];
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        const sub = this.pool.subscribe(relayUrls, reactionsFilter, (event: Event) => {
          if (event.content === '+' || event.content === '❤️' || event.content === '🤙' || event.content === '👍') {
            reactions.push(event);
          }
        });
        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, 3000);
      });

      if (reactions.length === 0) {
        this.isLoadingLikedSongs.set(false);
        return;
      }

      // Extract unique track addresses from reactions
      const trackAddresses = new Set<string>();
      for (const reaction of reactions) {
        const aTag = reaction.tags.find(t => t[0] === 'a');
        if (aTag && aTag[1]) {
          trackAddresses.add(aTag[1]);
        }
      }

      if (trackAddresses.size === 0) {
        this.isLoadingLikedSongs.set(false);
        return;
      }

      // Build individual filters for each address
      const addressFilters: Filter[] = [];
      for (const addr of Array.from(trackAddresses).slice(0, 100)) {
        const parts = addr.split(':');
        if (parts.length >= 3) {
          addressFilters.push({
            kinds: [MUSIC_KIND],
            authors: [parts[1]],
            '#d': [parts[2]],
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
            const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
            const uniqueId = `${event.pubkey}:${dTag}`;

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
        const urlTag = track.tags.find(t => t[0] === 'url');
        if (!urlTag?.[1]) continue;

        const titleTag = track.tags.find(t => t[0] === 'title');
        const imageTag = track.tags.find(t => t[0] === 'image');
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
          source: urlTag[1],
          title: titleTag?.[1] || 'Untitled Track',
          artist: artistName,
          artwork: imageTag?.[1] || '',
          type: 'Music',
          eventPubkey: track.pubkey,
          eventIdentifier: dTag,
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
}
