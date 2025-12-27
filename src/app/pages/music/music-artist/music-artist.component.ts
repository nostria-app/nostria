import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, Filter, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { ReportingService } from '../../../services/reporting.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../music-track-dialog/music-track-dialog.component';

const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

@Component({
  selector: 'app-music-artist',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatMenuModule,
    MatSnackBarModule,
    MusicPlaylistCardComponent,
    MusicTrackDialogComponent,
  ],
  templateUrl: './music-artist.component.html',
  styleUrls: ['./music-artist.component.scss'],
})
export class MusicArtistComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private reporting = inject(ReportingService);
  private mediaPlayer = inject(MediaPlayerService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);

  pubkey = signal<string>('');
  loading = signal(true);
  authorProfile = signal<NostrRecord | undefined>(undefined);

  tracks = signal<Event[]>([]);
  playlists = signal<Event[]>([]);

  // Edit dialog state
  showEditDialog = signal(false);
  editDialogData = signal<MusicTrackDialogData | null>(null);

  private subscriptions: { close: () => void }[] = [];
  private trackMap = new Map<string, Event>();
  private playlistMap = new Map<string, Event>();

  // Check if viewing own profile
  isOwnProfile = computed(() => {
    const currentPubkey = this.accountState.pubkey();
    const viewingPubkey = this.pubkey();
    return !!currentPubkey && currentPubkey === viewingPubkey;
  });

  // Profile data
  artistName = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';
  });

  artistAvatar = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.picture || null;
  });

  artistBanner = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.banner || null;
  });

  artistBio = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.about || null;
  });

  artistNpub = computed(() => {
    const pk = this.pubkey();
    if (!pk) return '';
    try {
      return nip19.npubEncode(pk);
    } catch {
      return pk;
    }
  });

  trackCount = computed(() => this.tracks().length);
  playlistCount = computed(() => this.playlists().length);

  selectedTabIndex = signal(0);

  constructor() {
    // Load author profile
    effect(() => {
      const pk = this.pubkey();
      if (pk) {
        this.data.getProfile(pk).then(profile => {
          this.authorProfile.set(profile);
        });
      }
    });
  }

  ngOnInit(): void {
    const pubkeyParam = this.route.snapshot.paramMap.get('pubkey');

    if (pubkeyParam) {
      let decodedPubkey = pubkeyParam;
      if (pubkeyParam.startsWith('npub')) {
        try {
          const decoded = nip19.decode(pubkeyParam);
          if (decoded.type === 'npub') {
            decodedPubkey = decoded.data;
          }
        } catch (e) {
          console.error('Failed to decode npub:', e);
        }
      }

      this.pubkey.set(decodedPubkey);
      this.loadArtistContent(decodedPubkey);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.close());
  }

  private loadArtistContent(pubkey: string): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available');
      this.loading.set(false);
      return;
    }

    let receivedAny = false;

    const timeout = setTimeout(() => {
      if (this.loading()) {
        this.loading.set(false);
      }
    }, 5000);

    // Load tracks
    const trackFilter: Filter = {
      kinds: [MUSIC_KIND],
      authors: [pubkey],
      limit: 500,
    };

    const trackSub = this.pool.subscribe(relayUrls, trackFilter, (event: Event) => {
      if (!receivedAny) {
        receivedAny = true;
        clearTimeout(timeout);
      }

      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;

      if (this.reporting.isContentBlocked(event)) return;

      this.trackMap.set(uniqueId, event);
      this.updateTracks();
      this.loading.set(false);
    });

    this.subscriptions.push(trackSub);

    // Load playlists
    const playlistFilter: Filter = {
      kinds: [MUSIC_PLAYLIST_KIND],
      authors: [pubkey],
      limit: 100,
    };

    const playlistSub = this.pool.subscribe(relayUrls, playlistFilter, (event: Event) => {
      if (!receivedAny) {
        receivedAny = true;
        clearTimeout(timeout);
      }

      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.playlistMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;

      this.playlistMap.set(uniqueId, event);
      this.updatePlaylists();
      this.loading.set(false);
    });

    this.subscriptions.push(playlistSub);
  }

  private updateTracks(): void {
    const tracks = Array.from(this.trackMap.values())
      .sort((a, b) => b.created_at - a.created_at);
    this.tracks.set(tracks);
  }

  private updatePlaylists(): void {
    const playlists = Array.from(this.playlistMap.values())
      .sort((a, b) => b.created_at - a.created_at);
    this.playlists.set(playlists);
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }

  goToProfile(): void {
    const npub = this.artistNpub();
    if (npub) {
      this.router.navigate(['/p', npub]);
    }
  }

  playArtist(): void {
    const artistTracks = this.tracks();
    if (artistTracks.length === 0) {
      this.snackBar.open('No tracks available to play', 'OK', { duration: 3000 });
      return;
    }

    const profile = this.authorProfile();
    const artistName = this.artistName();

    // Convert tracks to MediaItems
    const mediaItems: MediaItem[] = artistTracks.map(track => {
      const titleTag = track.tags.find(t => t[0] === 'title' || t[0] === 'subject');
      const title = titleTag?.[1] || track.content?.substring(0, 50) || 'Unknown Track';
      const streamUrl = track.tags.find(t => t[0] === 'url')?.[1] || '';
      const coverTag = track.tags.find(t => t[0] === 'image' || t[0] === 'cover' || t[0] === 'thumb');
      const cover = coverTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png';
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      return {
        title,
        artist: artistName,
        source: streamUrl,
        artwork: cover,
        type: 'Music' as const,
        eventPubkey: this.artistNpub(),
        eventIdentifier: dTag,
      };
    }).filter(item => item.source); // Only include tracks with valid stream URLs

    if (mediaItems.length === 0) {
      this.snackBar.open('No playable tracks found', 'OK', { duration: 3000 });
      return;
    }

    // Play first track immediately, enqueue the rest
    this.mediaPlayer.play(mediaItems[0]);
    for (let i = 1; i < mediaItems.length; i++) {
      this.mediaPlayer.enque(mediaItems[i]);
    }
  }

  // Helper methods for track display
  getTrackTitle(track: Event): string {
    const titleTag = track.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Track';
  }

  getTrackImage(track: Event): string | null {
    const imageTag = track.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  }

  getTrackArtist(track: Event): string {
    // First check for artist tag in the event
    const artistTag = track.tags.find(t => t[0] === 'artist');
    if (artistTag?.[1]) {
      return artistTag[1];
    }
    // Fall back to profile name
    return this.artistName();
  }

  getTrackAlbum(track: Event): string {
    const albumTag = track.tags.find(t => t[0] === 'album');
    return albumTag?.[1] || '';
  }

  getTrackDate(track: Event): string {
    const date = new Date(track.created_at * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  getTrackDuration(track: Event): string {
    const durationTag = track.tags.find(t => t[0] === 'duration');
    if (durationTag?.[1]) {
      const seconds = parseInt(durationTag[1], 10);
      if (!isNaN(seconds)) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }
    return '--:--';
  }

  playTrack(index: number): void {
    const artistTracks = this.tracks();
    if (index < 0 || index >= artistTracks.length) return;

    const artistName = this.artistName();
    const profile = this.authorProfile();

    // Play from this track and queue the rest
    for (let i = index; i < artistTracks.length; i++) {
      const track = artistTracks[i];
      const urlTag = track.tags.find(t => t[0] === 'url');
      const url = urlTag?.[1];
      if (!url) continue;

      const titleTag = track.tags.find(t => t[0] === 'title');
      const imageTag = track.tags.find(t => t[0] === 'image');
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      const mediaItem: MediaItem = {
        source: url,
        title: titleTag?.[1] || 'Untitled Track',
        artist: this.getTrackArtist(track),
        artwork: imageTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png',
        type: 'Music',
        eventPubkey: track.pubkey,
        eventIdentifier: dTag,
      };

      if (i === index) {
        this.mediaPlayer.play(mediaItem);
      } else {
        this.mediaPlayer.enque(mediaItem);
      }
    }
  }

  addTrackToQueue(track: Event): void {
    const urlTag = track.tags.find(t => t[0] === 'url');
    const url = urlTag?.[1];
    if (!url) return;

    const titleTag = track.tags.find(t => t[0] === 'title');
    const imageTag = track.tags.find(t => t[0] === 'image');
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    const profile = this.authorProfile();

    const mediaItem: MediaItem = {
      source: url,
      title: titleTag?.[1] || 'Untitled Track',
      artist: this.getTrackArtist(track),
      artwork: imageTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  goToTrackDetails(track: Event): void {
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    try {
      const npub = nip19.npubEncode(track.pubkey);
      this.router.navigate(['/music/song', npub, dTag]);
    } catch {
      // Ignore
    }
  }

  copyTrackLink(track: Event): void {
    try {
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: track.kind,
        pubkey: track.pubkey,
        identifier: dTag,
      });
      this.clipboard.copy(`nostr:${naddr}`);
      this.snackBar.open('Track link copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy link', 'Close', { duration: 2000 });
    }
  }

  editTrack(track: Event): void {
    if (!this.isOwnProfile()) return;
    this.editDialogData.set({ track });
    this.showEditDialog.set(true);
  }

  onEditDialogClosed(result: { published: boolean; updated?: boolean; event?: Event } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated && result?.event) {
      // Update the track in the local map
      const event = result.event;
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;
      this.trackMap.set(uniqueId, event);
      this.updateTracks();
      this.snackBar.open('Track updated', 'Close', { duration: 2000 });
    }
  }
}
