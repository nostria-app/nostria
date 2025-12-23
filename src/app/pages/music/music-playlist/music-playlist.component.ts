import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { Event, Filter, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';

const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

@Component({
  selector: 'app-music-playlist',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MusicEventComponent,
  ],
  templateUrl: './music-playlist.component.html',
  styleUrls: ['./music-playlist.component.scss'],
})
export class MusicPlaylistComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);

  playlist = signal<Event | null>(null);
  tracks = signal<Event[]>([]);
  loading = signal(true);
  loadingTracks = signal(false);
  authorProfile = signal<NostrRecord | undefined>(undefined);

  private subscriptions: { close: () => void }[] = [];
  private trackMap = new Map<string, Event>();

  // Playlist data
  title = computed(() => {
    const event = this.playlist();
    if (!event) return 'Untitled Playlist';
    const titleTag = event.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Playlist';
  });

  description = computed(() => {
    const event = this.playlist();
    if (!event) return null;
    const descTag = event.tags.find(t => t[0] === 'description');
    return descTag?.[1] || event.content || null;
  });

  isPublic = computed(() => {
    const event = this.playlist();
    if (!event) return false;
    const publicTag = event.tags.find(t => t[0] === 'public');
    return publicTag?.[1] === 'true';
  });

  coverImage = computed(() => {
    const event = this.playlist();
    if (!event) return null;
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  trackRefs = computed(() => {
    const event = this.playlist();
    if (!event) return [];
    return event.tags
      .filter(t => t[0] === 'a' && t[1]?.startsWith('36787:'))
      .map(t => t[1]);
  });

  trackCount = computed(() => this.trackRefs().length);

  artistName = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.name || profile?.data?.display_name || 'Unknown';
  });

  artistAvatar = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.picture || null;
  });

  artistNpub = computed(() => {
    const event = this.playlist();
    if (!event) return '';
    try {
      return nip19.npubEncode(event.pubkey);
    } catch {
      return event.pubkey;
    }
  });

  publishedDate = computed(() => {
    const event = this.playlist();
    if (!event) return '';
    const date = new Date(event.created_at * 1000);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  });

  constructor() {
    // Load author profile when playlist loads
    effect(() => {
      const event = this.playlist();
      if (event?.pubkey) {
        this.data.getProfile(event.pubkey).then(profile => {
          this.authorProfile.set(profile);
        });
      }
    });

    // Load tracks when playlist loads
    effect(() => {
      const refs = this.trackRefs();
      const currentTracks = this.tracks();
      // Only load if we have refs and haven't loaded any tracks yet
      if (refs.length > 0 && currentTracks.length === 0 && !this.loadingTracks()) {
        this.loadPlaylistTracks(refs);
      }
    });
  }

  ngOnInit(): void {
    const pubkey = this.route.snapshot.paramMap.get('pubkey');
    const identifier = this.route.snapshot.paramMap.get('identifier');

    if (pubkey && identifier) {
      this.loadPlaylist(pubkey, identifier);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.close());
  }

  private loadPlaylist(pubkey: string, identifier: string): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available');
      this.loading.set(false);
      return;
    }

    // Decode pubkey if it's an npub
    let decodedPubkey = pubkey;
    if (pubkey.startsWith('npub')) {
      try {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === 'npub') {
          decodedPubkey = decoded.data;
        }
      } catch (e) {
        console.error('Failed to decode npub:', e);
      }
    }

    const filter: Filter = {
      kinds: [MUSIC_PLAYLIST_KIND],
      authors: [decodedPubkey],
      '#d': [identifier],
      limit: 1,
    };

    const timeout = setTimeout(() => {
      if (this.loading()) {
        this.loading.set(false);
      }
    }, 5000);

    const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      clearTimeout(timeout);
      this.playlist.set(event);
      this.loading.set(false);
    });

    this.subscriptions.push(sub);
  }

  private loadPlaylistTracks(refs: string[]): void {
    this.loadingTracks.set(true);
    this.trackMap.clear();

    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) {
      this.loadingTracks.set(false);
      return;
    }

    // Parse the a-tag references to get authors and d-tags
    const trackKeys: { author: string; dTag: string }[] = [];
    for (const ref of refs) {
      const parts = ref.split(':');
      if (parts.length >= 3) {
        const author = parts[1];
        const dTag = parts.slice(2).join(':');
        trackKeys.push({ author, dTag });
      }
    }

    if (trackKeys.length === 0) {
      this.loadingTracks.set(false);
      return;
    }

    // Create a single filter with all authors (deduplicated)
    const uniqueAuthors = [...new Set(trackKeys.map(k => k.author))];
    const filter: Filter = {
      kinds: [MUSIC_KIND],
      authors: uniqueAuthors,
      limit: trackKeys.length * 2, // Allow for duplicates
    };

    let receivedAny = false;

    // Set a shorter timeout since we're using a single subscription
    const timeout = setTimeout(() => {
      if (this.loadingTracks()) {
        this.loadingTracks.set(false);
      }
    }, 5000);

    const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      receivedAny = true;
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      // Check if this track is in our refs list
      const isInPlaylist = trackKeys.some(k => k.author === event.pubkey && k.dTag === dTag);
      if (!isInPlaylist) return;

      const existing = this.trackMap.get(uniqueId);
      if (!existing || existing.created_at < event.created_at) {
        this.trackMap.set(uniqueId, event);
        this.updateTracks(refs);
      }

      // Check if we have all tracks
      if (this.trackMap.size >= trackKeys.length) {
        clearTimeout(timeout);
        this.loadingTracks.set(false);
      }
    });

    this.subscriptions.push(sub);

    // Also set a shorter timeout for the "found some" case
    setTimeout(() => {
      if (this.loadingTracks() && receivedAny) {
        this.loadingTracks.set(false);
      }
    }, 3000);
  }

  private updateTracks(refs: string[]): void {
    // Sort tracks according to playlist order
    const orderedTracks: Event[] = [];
    for (const ref of refs) {
      const parts = ref.split(':');
      if (parts.length >= 3) {
        const author = parts[1];
        const dTag = parts.slice(2).join(':');
        const key = `${author}:${dTag}`;
        const track = this.trackMap.get(key);
        if (track) {
          orderedTracks.push(track);
        }
      }
    }
    this.tracks.set(orderedTracks);
  }

  playAll(): void {
    const allTracks = this.tracks();
    if (allTracks.length === 0) return;

    // Create media items for all tracks and play the first one
    for (let i = 0; i < allTracks.length; i++) {
      const track = allTracks[i];
      const urlTag = track.tags.find(t => t[0] === 'url');
      const url = urlTag?.[1];
      if (!url) continue;

      const titleTag = track.tags.find(t => t[0] === 'title');
      const imageTag = track.tags.find(t => t[0] === 'image');

      const mediaItem: MediaItem = {
        source: url,
        title: titleTag?.[1] || 'Untitled Track',
        artist: this.artistName(),
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
        type: 'Music',
      };

      if (i === 0) {
        this.mediaPlayer.play(mediaItem);
      } else {
        this.mediaPlayer.enque(mediaItem);
      }
    }
  }

  goToArtist(): void {
    const npub = this.artistNpub();
    if (npub) {
      this.router.navigate(['/music/artist', npub]);
    }
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
