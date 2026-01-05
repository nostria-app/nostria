import { Component, inject, signal, computed, OnInit, OnDestroy, effect, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ReactionService } from '../../../services/reaction.service';
import { MusicPlaylistService, MusicPlaylist } from '../../../services/music-playlist.service';
import { EventService } from '../../../services/event';
import { LayoutService } from '../../../services/layout.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import {
  EditMusicPlaylistDialogComponent,
  EditMusicPlaylistDialogData,
} from '../edit-music-playlist-dialog/edit-music-playlist-dialog.component';
import { MusicTrackMenuComponent } from '../../../components/music-track-menu/music-track-menu.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../music-track-dialog/music-track-dialog.component';

const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

@Component({
  selector: 'app-music-playlist',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatMenuModule,
    MatSnackBarModule,
    EditMusicPlaylistDialogComponent,
    MusicTrackMenuComponent,
    MusicTrackDialogComponent,
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
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);
  private accountState = inject(AccountStateService);
  private musicPlaylistService = inject(MusicPlaylistService);
  private reactionService = inject(ReactionService);
  private eventService = inject(EventService);
  private layout = inject(LayoutService);
  private imageCache = inject(ImageCacheService);

  playlist = signal<Event | null>(null);
  tracks = signal<Event[]>([]);
  loading = signal(true);
  loadingTracks = signal(false);
  authorProfile = signal<NostrRecord | undefined>(undefined);
  isLiked = signal(false);
  isLiking = signal(false);

  // Edit dialog state
  showEditDialog = signal(false);
  editDialogData = signal<EditMusicPlaylistDialogData | null>(null);

  // Track edit dialog state
  showTrackEditDialog = signal(false);
  trackEditDialogData = signal<MusicTrackDialogData | null>(null);

  private subscriptions: { close: () => void }[] = [];
  private likeSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();
  private tracksLoaded = false; // Prevent multiple loadPlaylistTracks calls
  private likeChecked = false;

  // Cache for artist profiles
  private artistProfiles = signal<Map<string, NostrRecord>>(new Map());

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

  // Get gradient background (alternative to image)
  gradient = computed(() => {
    const event = this.playlist();
    if (!event) return null;
    const gradientTag = event.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      const colors = gradientTag[2];
      return `linear-gradient(135deg, ${colors})`;
    }
    return null;
  });

  trackRefs = computed(() => {
    const event = this.playlist();
    if (!event) return [];
    return event.tags
      .filter(t => t[0] === 'a' && t[1]?.startsWith('36787:'))
      .map(t => t[1]);
  });

  trackCount = computed(() => this.trackRefs().length);

  // Check if the current user owns this playlist
  isOwnPlaylist = computed(() => {
    const event = this.playlist();
    const currentPubkey = this.accountState.pubkey();
    return event && currentPubkey === event.pubkey;
  });

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
        untracked(() => {
          this.data.getProfile(event.pubkey).then(profile => {
            this.authorProfile.set(profile);
          });
        });
      }
    });

    // Load tracks when playlist loads
    effect(() => {
      const refs = this.trackRefs();
      // Only load if we have refs and haven't started loading yet
      if (refs.length > 0 && !this.tracksLoaded) {
        this.tracksLoaded = true;
        untracked(() => {
          this.loadPlaylistTracks(refs);
        });
      }
    });

    // Check if user has already liked this playlist
    effect(() => {
      const event = this.playlist();
      const userPubkey = this.accountState.pubkey();
      if (event && userPubkey && !this.likeChecked) {
        this.likeChecked = true;
        untracked(() => {
          this.checkExistingLike(event, userPubkey);
        });
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
    this.likeSubscription?.close();
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
      this.logger.warn('No relays available to load playlist tracks');
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

    this.logger.debug('Loading playlist tracks', { refs, trackKeys });

    if (trackKeys.length === 0) {
      this.loadingTracks.set(false);
      return;
    }

    // Create a single filter with all authors and d-tags (deduplicated)
    const uniqueAuthors = [...new Set(trackKeys.map(k => k.author))];
    const uniqueDTags = [...new Set(trackKeys.map(k => k.dTag))];
    const filter: Filter = {
      kinds: [MUSIC_KIND],
      authors: uniqueAuthors,
      '#d': uniqueDTags,
      limit: trackKeys.length * 2, // Allow for duplicates
    };

    this.logger.debug('Playlist tracks filter', { filter, relayUrls });

    let receivedAny = false;

    // Set a shorter timeout since we're using a single subscription
    const timeout = setTimeout(() => {
      if (this.loadingTracks()) {
        this.logger.warn('Playlist tracks load timeout - no events received');
        this.loadingTracks.set(false);
      }
    }, 5000);

    const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      receivedAny = true;
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      this.logger.debug('Received track event', { uniqueId, dTag, pubkey: event.pubkey });

      // Check if this track is in our refs list
      const isInPlaylist = trackKeys.some(k => k.author === event.pubkey && k.dTag === dTag);
      if (!isInPlaylist) {
        this.logger.debug('Track not in playlist refs, skipping', { uniqueId });
        return;
      }

      const existing = this.trackMap.get(uniqueId);
      if (!existing || existing.created_at < event.created_at) {
        this.trackMap.set(uniqueId, event);
        this.logger.debug('Added track to map', { uniqueId, mapSize: this.trackMap.size });
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
        this.logger.debug('Shorter timeout - found some tracks', { mapSize: this.trackMap.size });
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
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      const mediaItem: MediaItem = {
        source: url,
        title: titleTag?.[1] || 'Untitled Track',
        artist: this.getTrackArtist(track),
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
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

  copyEventLink(): void {
    const ev = this.playlist();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const npub = nip19.npubEncode(ev.pubkey);
      const link = `https://nostria.app/music/playlist/${npub}/${encodeURIComponent(dTag)}`;
      this.clipboard.copy(link);
      this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy link', 'Close', { duration: 2000 });
    }
  }

  copyEventId(): void {
    const ev = this.playlist();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
      });
      this.clipboard.copy(`nostr:${naddr}`);
      this.snackBar.open('Event ID copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy event ID', 'Close', { duration: 3000 });
    }
  }

  shareNative(): void {
    const ev = this.playlist();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const npub = nip19.npubEncode(ev.pubkey);
      const link = `https://nostria.app/music/playlist/${npub}/${encodeURIComponent(dTag)}`;
      const playlistTitle = this.title();

      if (navigator.share) {
        navigator.share({
          title: playlistTitle,
          text: `Check out ${playlistTitle}`,
          url: link,
        }).catch(() => {
          // User cancelled or error - fallback to copy
          this.clipboard.copy(link);
          this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
        });
      } else {
        // Fallback for browsers without native share
        this.clipboard.copy(link);
        this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
      }
    } catch {
      this.snackBar.open('Failed to share playlist', 'Close', { duration: 3000 });
    }
  }

  sharePlaylist(): void {
    const ev = this.playlist();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
      });

      // Create content with nostr: reference to the playlist
      const content = `nostr:${naddr}`;

      // Open note editor with the playlist reference
      this.eventService.createNote({ content });
    } catch {
      this.snackBar.open('Failed to generate playlist reference', 'Close', { duration: 3000 });
    }
  }

  copyEventData(): void {
    const ev = this.playlist();
    if (!ev) return;

    this.clipboard.copy(JSON.stringify(ev, null, 2));
    this.snackBar.open('Event data copied!', 'Close', { duration: 2000 });
  }

  publishPlaylist(): void {
    const ev = this.playlist();
    if (!ev) return;

    this.layout.publishEvent(ev);
  }

  editPlaylist(): void {
    const ev = this.playlist();
    if (!ev) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    const titleTag = ev.tags.find(t => t[0] === 'title');
    const descTag = ev.tags.find(t => t[0] === 'description');
    const imageTag = ev.tags.find(t => t[0] === 'image');
    const publicTag = ev.tags.find(t => t[0] === 'public');
    const collaborativeTag = ev.tags.find(t => t[0] === 'collaborative');
    const trackRefs = ev.tags
      .filter(t => t[0] === 'a' && t[1]?.startsWith('36787:'))
      .map(t => t[1]);

    const playlist: MusicPlaylist = {
      id: dTag,
      title: titleTag?.[1] || 'Untitled Playlist',
      description: descTag?.[1] || ev.content || undefined,
      image: imageTag?.[1] || undefined,
      pubkey: ev.pubkey,
      isPublic: publicTag?.[1] === 'true',
      isCollaborative: collaborativeTag?.[1] === 'true',
      trackRefs,
      created_at: ev.created_at,
      event: ev,
    };

    this.editDialogData.set({ playlist });
    this.showEditDialog.set(true);
  }

  onEditDialogClosed(result: { updated: boolean; playlist?: MusicPlaylist } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated && result?.playlist) {
      // Reload the page to show updated data
      const pubkey = this.route.snapshot.paramMap.get('pubkey');
      const identifier = this.route.snapshot.paramMap.get('identifier');
      if (pubkey && identifier) {
        // Reset state and reload
        this.tracksLoaded = false;
        this.trackMap.clear();
        this.tracks.set([]);
        this.loadPlaylist(pubkey, identifier);
      }
    }
  }

  // Check if the current user owns a specific track
  isOwnTrack(track: Event): boolean {
    const currentPubkey = this.accountState.pubkey();
    return !!currentPubkey && currentPubkey === track.pubkey;
  }

  editTrack(track: Event): void {
    if (!this.isOwnTrack(track)) return;
    this.trackEditDialogData.set({ track });
    this.showTrackEditDialog.set(true);
  }

  onTrackEditDialogClosed(result: { published: boolean; updated?: boolean; event?: Event } | null): void {
    this.showTrackEditDialog.set(false);
    this.trackEditDialogData.set(null);

    if (result?.updated && result?.event) {
      // Update the track in the local map
      const event = result.event;
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;
      this.trackMap.set(uniqueId, event);
      this.updateTracks(this.trackRefs());
      this.snackBar.open('Track updated', 'Close', { duration: 2000 });
    }
  }

  private checkExistingLike(ev: Event, userPubkey: string): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    const aTagValue = `${ev.kind}:${ev.pubkey}:${dTag}`;

    const filter: Filter = {
      kinds: [kinds.Reaction],
      authors: [userPubkey],
      '#a': [aTagValue],
      limit: 1,
    };

    let found = false;
    const timeout = setTimeout(() => {
      if (!found) {
        this.likeSubscription?.close();
      }
    }, 3000);

    this.likeSubscription = this.pool.subscribe(relayUrls, filter, (reaction: Event) => {
      if (reaction.content === '+') {
        found = true;
        this.isLiked.set(true);
        clearTimeout(timeout);
        this.likeSubscription?.close();
      }
    });
  }

  likePlaylist(): void {
    if (this.isLiked() || this.isLiking()) return;

    const ev = this.playlist();
    if (!ev) return;

    this.isLiking.set(true);
    this.reactionService.addLike(ev).then(success => {
      this.isLiking.set(false);
      if (success) {
        this.isLiked.set(true);
        this.snackBar.open('Playlist liked!', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to like playlist', 'Close', { duration: 3000 });
      }
    });
  }

  // Helper methods for track display
  getTrackTitle(track: Event): string {
    const titleTag = track.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Track';
  }

  getTrackImage(track: Event): string | null {
    const imageTag = track.tags.find(t => t[0] === 'image');
    const rawUrl = imageTag?.[1] || null;
    if (!rawUrl) return null;
    return this.imageCache.getOptimizedImageUrlWithSize(rawUrl, 64, 64);
  }

  getTrackGradient(track: Event): string | null {
    const gradientTag = track.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      return `linear-gradient(135deg, ${gradientTag[2]})`;
    }
    return null;
  }

  getTrackArtist(track: Event): string {
    const profile = this.artistProfiles().get(track.pubkey);
    if (profile) {
      return profile.data?.name || profile.data?.display_name || 'Unknown Artist';
    }
    // Trigger async fetch if not cached
    this.fetchArtistProfile(track.pubkey);
    return 'Unknown Artist';
  }

  private async fetchArtistProfile(pubkey: string): Promise<void> {
    const profiles = this.artistProfiles();
    if (profiles.has(pubkey)) return;

    const profile = await this.data.getProfile(pubkey);
    if (profile) {
      this.artistProfiles.update(map => {
        const newMap = new Map(map);
        newMap.set(pubkey, profile);
        return newMap;
      });
    }
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
    const allTracks = this.tracks();
    if (index < 0 || index >= allTracks.length) return;

    // Play from this track and queue the rest
    for (let i = index; i < allTracks.length; i++) {
      const track = allTracks[i];
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
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
        type: 'Music',
        eventPubkey: track.pubkey,
        eventIdentifier: dTag,
        lyrics: this.utilities.extractLyricsFromEvent(track),
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

    const mediaItem: MediaItem = {
      source: url,
      title: titleTag?.[1] || 'Untitled Track',
      artist: this.getTrackArtist(track),
      artwork: imageTag?.[1] || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
      lyrics: this.utilities.extractLyricsFromEvent(track),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  goToTrackArtist(track: Event, event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    try {
      const npub = nip19.npubEncode(track.pubkey);
      this.router.navigate(['/music/artist', npub]);
    } catch {
      // Ignore
    }
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
      const link = `https://nostria.app/a/${naddr}`;
      this.clipboard.copy(link);
      this.snackBar.open('Track link copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy link', 'Close', { duration: 2000 });
    }
  }

  downloadAsM3u8(): void {
    const allTracks = this.tracks();
    if (allTracks.length === 0) {
      this.snackBar.open('No tracks to download', 'Close', { duration: 2000 });
      return;
    }

    // Build M3U8 content (Extended M3U format with UTF-8 BOM for unicode support)
    const lines: string[] = ['#EXTM3U'];

    for (const track of allTracks) {
      const urlTag = track.tags.find(t => t[0] === 'url');
      const url = urlTag?.[1];
      if (!url) continue;

      const title = this.getTrackTitle(track);
      const artist = this.getTrackArtist(track);
      const artwork = this.getTrackImage(track);
      const durationTag = track.tags.find(t => t[0] === 'duration');
      const duration = durationTag?.[1] ? parseInt(durationTag[1], 10) : -1;

      // EXTINF format: #EXTINF:duration,Artist - Title
      lines.push(`#EXTINF:${duration},${artist} - ${title}`);
      // EXTALBUMARTURL for album art (supported by VLC and Jamendo)
      if (artwork) {
        lines.push(`#EXTALBUMARTURL:${artwork}`);
      }
      lines.push(url);
    }

    const content = lines.join('\n');

    // Create blob with UTF-8 BOM for proper unicode support
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const textEncoder = new TextEncoder();
    const textData = textEncoder.encode(content);
    const combinedData = new Uint8Array(bom.length + textData.length);
    combinedData.set(bom, 0);
    combinedData.set(textData, bom.length);

    const blob = new Blob([combinedData], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Create a safe filename from the playlist title
    const safeTitle = this.title()
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length

    const filename = `${safeTitle || 'playlist'}.m3u8`;

    // Create download link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.snackBar.open('Playlist downloaded!', 'Close', { duration: 2000 });
  }
}
