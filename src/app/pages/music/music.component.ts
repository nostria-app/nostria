import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { DataService } from '../../services/data.service';
import { MediaItem } from '../../interfaces';
import { MusicEventComponent } from '../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../components/music-playlist-card/music-playlist-card.component';
import { CreateMusicPlaylistDialogComponent } from './create-music-playlist-dialog/create-music-playlist-dialog.component';
import { MusicTrackDialogComponent } from './music-track-dialog/music-track-dialog.component';
import { ImportRssDialogComponent } from './import-rss-dialog/import-rss-dialog.component';
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
  ],
  templateUrl: './music.component.html',
  styleUrls: ['./music.component.scss'],
})
export class MusicComponent implements OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private mediaPlayer = inject(MediaPlayerService);
  private dataService = inject(DataService);

  allTracks = signal<Event[]>([]);
  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  isLoadingLikedSongs = signal(false);

  // Dialog visibility
  showUploadDialog = signal(false);
  showCreatePlaylistDialog = signal(false);
  showImportRssDialog = signal(false);

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

  constructor() {
    this.startSubscriptions();
  }

  ngOnDestroy(): void {
    this.trackSubscription?.close();
    this.playlistSubscription?.close();
  }

  private startSubscriptions(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
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

    this.trackSubscription = this.pool.subscribe(relayUrls, trackFilter, (event: Event) => {
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

    this.playlistSubscription = this.pool.subscribe(relayUrls, playlistFilter, (event: Event) => {
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

  async playLikedSongs(event: MouseEvent): Promise<void> {
    event.stopPropagation(); // Prevent navigation to liked songs page

    const pubkey = this.currentPubkey();
    if (!pubkey) return;

    this.isLoadingLikedSongs.set(true);

    try {
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

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
