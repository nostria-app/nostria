import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
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
import { MediaItem } from '../../interfaces';
import { MusicEventComponent } from '../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../components/music-playlist-card/music-playlist-card.component';
import { CreateMusicPlaylistDialogComponent } from './create-music-playlist-dialog/create-music-playlist-dialog.component';
import { MusicTrackDialogComponent } from './music-track-dialog/music-track-dialog.component';
import { ImportRssDialogComponent } from './import-rss-dialog/import-rss-dialog.component';
import { MusicSettingsDialogComponent } from './music-settings-dialog/music-settings-dialog.component';
import { MusicPlaylist } from '../../services/music-playlist.service';

const MUSIC_KIND = 36787;
const PLAYLIST_KIND = 34139;
const SECTION_LIMIT = 12;

@Component({
  selector: 'app-music',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MusicEventComponent,
    MusicPlaylistCardComponent,
    CreateMusicPlaylistDialogComponent,
    MusicTrackDialogComponent,
    ImportRssDialogComponent,
    MusicSettingsDialogComponent,
  ],
  templateUrl: './music.component.html',
  styleUrls: ['./music.component.scss'],
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
  private mediaPlayer = inject(MediaPlayerService);
  private dataService = inject(DataService);
  private database = inject(DatabaseService);
  private offlineMusicService = inject(OfflineMusicService);

  allTracks = signal<Event[]>([]);
  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  isLoadingLikedSongs = signal(false);

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

  // Following pubkeys for filtering
  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  // Current user pubkey
  private currentPubkey = computed(() => {
    return this.accountState.pubkey();
  });

  isAuthenticated = computed(() => this.app.authenticated());

  // === YOUR SECTION ===
  // User's own playlists
  myPlaylists = computed(() => {
    const pubkey = this.currentPubkey();
    if (!pubkey) return [];
    return this.allPlaylists()
      .filter(p => p.pubkey === pubkey)
      .sort((a, b) => b.created_at - a.created_at);
  });

  myPlaylistsPreview = computed(() => this.myPlaylists().slice(0, SECTION_LIMIT));
  hasMoreMyPlaylists = computed(() => this.myPlaylists().length > SECTION_LIMIT);

  // === PLAYLISTS (FOLLOWING) ===
  followingPlaylists = computed(() => {
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    if (following.length === 0) return [];
    return this.allPlaylists()
      .filter(p => following.includes(p.pubkey) && p.pubkey !== myPubkey)
      .sort((a, b) => b.created_at - a.created_at);
  });

  followingPlaylistsPreview = computed(() => this.followingPlaylists().slice(0, SECTION_LIMIT));
  hasMoreFollowingPlaylists = computed(() => this.followingPlaylists().length > SECTION_LIMIT);

  // === SONGS (FOLLOWING) ===
  followingTracks = computed(() => {
    const following = this.followingPubkeys();
    if (following.length === 0) return [];
    return this.allTracks()
      .filter(track => following.includes(track.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
  });

  followingTracksPreview = computed(() => this.followingTracks().slice(0, SECTION_LIMIT));
  hasMoreFollowingTracks = computed(() => this.followingTracks().length > SECTION_LIMIT);

  // === PLAYLISTS (PUBLIC) ===
  publicPlaylists = computed(() => {
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    return this.allPlaylists()
      .filter(p => !following.includes(p.pubkey) && p.pubkey !== myPubkey)
      .sort((a, b) => b.created_at - a.created_at);
  });

  publicPlaylistsPreview = computed(() => this.publicPlaylists().slice(0, SECTION_LIMIT));
  hasMorePublicPlaylists = computed(() => this.publicPlaylists().length > SECTION_LIMIT);

  // === SONGS (PUBLIC) ===
  publicTracks = computed(() => {
    const following = this.followingPubkeys();
    return this.allTracks()
      .filter(track => !following.includes(track.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
  });

  publicTracksPreview = computed(() => this.publicTracks().slice(0, SECTION_LIMIT));
  hasMorePublicTracks = computed(() => this.publicTracks().length > SECTION_LIMIT);

  // Counts for display
  followingPlaylistsCount = computed(() => this.followingPlaylists().length);
  followingTracksCount = computed(() => this.followingTracks().length);
  publicPlaylistsCount = computed(() => this.publicPlaylists().length);
  publicTracksCount = computed(() => this.publicTracks().length);

  // Music relay set constant
  private readonly RELAY_SET_KIND = 30002;
  private readonly MUSIC_RELAY_SET_D_TAG = 'music';

  constructor() {
    this.initializeMusic();
  }

  /**
   * Initialize music by first loading relay set, then starting subscriptions
   */
  private async initializeMusic(): Promise<void> {
    await this.loadMusicRelaySet();
    this.startSubscriptions();
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
        console.log('[Music] Loaded relay set from database:', cachedEvent);
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
          console.log('[Music] Found newer relay set from relays, updating...');
          this.musicRelaySet.set(event);
          const relays = event.tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1]);
          this.musicRelays.set(relays);

          // Persist to database
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
          console.log('[Music] Saved relay set to database');
        }
      }
    } catch (error) {
      console.error('Error loading music relay set:', error);
    }
  }

  private startSubscriptions(): void {
    // Get the user's account relays directly (no fallback)
    const accountRelays = this.accountRelay.getRelayUrls();

    // Combine with music-specific relays from the user's relay set
    const customMusicRelays = this.musicRelays();
    const allRelayUrls = [...new Set([...accountRelays, ...customMusicRelays])];

    console.log('[Music] Account relays:', accountRelays);
    console.log('[Music] Custom music relays:', customMusicRelays);
    console.log('[Music] All relays:', allRelayUrls);

    if (allRelayUrls.length === 0) {
      console.warn('No relays available for loading music');
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
  goToLikedSongs(): void {
    this.router.navigate(['/music/liked']);
  }

  goToLikedPlaylists(): void {
    this.router.navigate(['/music/liked-playlists']);
  }

  goToYourRecords(): void {
    const pubkey = this.currentPubkey();
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      this.router.navigate(['/music/artist', npub]);
    }
  }

  goToOfflineMusic(): void {
    this.router.navigate(['/music/offline']);
  }

  goToAllFollowingPlaylists(): void {
    this.router.navigate(['/music/playlists'], { queryParams: { source: 'following' } });
  }

  goToAllFollowingTracks(): void {
    this.router.navigate(['/music/tracks'], { queryParams: { source: 'following' } });
  }

  goToAllPublicPlaylists(): void {
    this.router.navigate(['/music/playlists'], { queryParams: { source: 'public' } });
  }

  goToAllPublicTracks(): void {
    this.router.navigate(['/music/tracks'], { queryParams: { source: 'public' } });
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
      console.error('Error playing liked songs:', error);
    } finally {
      this.isLoadingLikedSongs.set(false);
    }
  }
}
