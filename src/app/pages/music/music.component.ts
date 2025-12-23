import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { MusicEventComponent } from '../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../components/music-playlist-card/music-playlist-card.component';
import { CreateMusicPlaylistDialogComponent, CreateMusicPlaylistDialogData } from './create-music-playlist-dialog/create-music-playlist-dialog.component';

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
  private dialog = inject(MatDialog);

  allTracks = signal<Event[]>([]);
  allPlaylists = signal<Event[]>([]);
  loading = signal(true);

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
    // TODO: Implement upload track dialog
    console.log('Upload track - coming soon');
  }

  openCreatePlaylist(): void {
    const dialogRef = this.dialog.open(CreateMusicPlaylistDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: {} as CreateMusicPlaylistDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.playlist) {
        // Refresh to show the new playlist
        this.refresh();
      }
    });
  }

  openImportFromRss(): void {
    // TODO: Implement RSS import dialog
    console.log('Import from RSS - coming soon');
  }
}
