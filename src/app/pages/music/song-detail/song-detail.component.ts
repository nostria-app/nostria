import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { Event, Filter, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { NostrRecord, MediaItem } from '../../../interfaces';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-song-detail',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
  ],
  templateUrl: './song-detail.component.html',
  styleUrls: ['./song-detail.component.scss'],
})
export class SongDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);

  song = signal<Event | null>(null);
  loading = signal(true);
  authorProfile = signal<NostrRecord | undefined>(undefined);

  private subscription: { close: () => void } | null = null;

  // Extracted song data
  title = computed(() => {
    const event = this.song();
    if (!event) return 'Untitled Track';
    const titleTag = event.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Track';
  });

  audioUrl = computed(() => {
    const event = this.song();
    if (!event) return '';
    const urlTag = event.tags.find(t => t[0] === 'url');
    if (urlTag?.[1]) return urlTag[1];
    const match = event.content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a))/i);
    return match ? match[0] : '';
  });

  image = computed(() => {
    const event = this.song();
    if (!event) return null;
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  lyrics = computed(() => {
    const event = this.song();
    if (!event) return null;
    // Check for lyrics tag first
    const lyricsTag = event.tags.find(t => t[0] === 'lyrics');
    if (lyricsTag?.[1]) return lyricsTag[1];
    // Check content if it's not a URL
    const content = event.content;
    if (content && !content.match(/^https?:\/\//)) {
      return content;
    }
    return null;
  });

  description = computed(() => {
    const event = this.song();
    if (!event) return null;
    const descTag = event.tags.find(t => t[0] === 'description' || t[0] === 'summary');
    return descTag?.[1] || null;
  });

  genres = computed(() => {
    const event = this.song();
    if (!event) return [];
    return event.tags
      .filter(t => t[0] === 't')
      .map(t => t[1])
      .filter(Boolean);
  });

  isAiGenerated = computed(() => {
    const event = this.song();
    if (!event) return false;
    const aiTag = event.tags.find(t => t[0] === 'ai-generated');
    return aiTag?.[1] === 'true';
  });

  artistName = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';
  });

  artistAvatar = computed(() => {
    const profile = this.authorProfile();
    return profile?.data?.picture || null;
  });

  artistNpub = computed(() => {
    const event = this.song();
    if (!event) return '';
    try {
      return nip19.npubEncode(event.pubkey);
    } catch {
      return event.pubkey;
    }
  });

  publishedDate = computed(() => {
    const event = this.song();
    if (!event) return '';
    const date = new Date(event.created_at * 1000);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  });

  constructor() {
    // Load author profile when song loads
    effect(() => {
      const event = this.song();
      if (event?.pubkey) {
        this.data.getProfile(event.pubkey).then(profile => {
          this.authorProfile.set(profile);
        });
      }
    });
  }

  ngOnInit(): void {
    const pubkey = this.route.snapshot.paramMap.get('pubkey');
    const identifier = this.route.snapshot.paramMap.get('identifier');

    if (pubkey && identifier) {
      this.loadSong(pubkey, identifier);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.close();
    }
  }

  private loadSong(pubkey: string, identifier: string): void {
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
      kinds: [MUSIC_KIND],
      authors: [decodedPubkey],
      '#d': [identifier],
      limit: 1,
    };

    const timeout = setTimeout(() => {
      if (this.loading()) {
        this.loading.set(false);
      }
    }, 5000);

    this.subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      clearTimeout(timeout);
      this.song.set(event);
      this.loading.set(false);
    });
  }

  playTrack(): void {
    const url = this.audioUrl();
    if (!url) return;

    const mediaItem: MediaItem = {
      source: url,
      title: this.title(),
      artist: this.artistName(),
      artwork: this.image() || '/icons/icon-192x192.png',
      type: 'Music',
    };

    this.mediaPlayer.play(mediaItem);
  }

  goToArtist(): void {
    const event = this.song();
    if (event) {
      this.router.navigate(['/music/artist', this.artistNpub()]);
    }
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
