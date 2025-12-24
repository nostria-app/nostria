import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Event, Filter, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { ReportingService } from '../../../services/reporting.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';

const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

@Component({
  selector: 'app-music-artist',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatSnackBarModule,
    MusicEventComponent,
    MusicPlaylistCardComponent,
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
  private snackBar = inject(MatSnackBar);

  pubkey = signal<string>('');
  loading = signal(true);
  authorProfile = signal<NostrRecord | undefined>(undefined);

  tracks = signal<Event[]>([]);
  playlists = signal<Event[]>([]);

  private subscriptions: { close: () => void }[] = [];
  private trackMap = new Map<string, Event>();
  private playlistMap = new Map<string, Event>();

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
}
