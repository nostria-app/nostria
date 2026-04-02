import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, Filter } from 'nostr-tools';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { UtilitiesService } from '../../services/utilities.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DatabaseService } from '../../services/database.service';
import { AlbumService, Album } from '../../services/music-playlist.service';
import { AccountStateService } from '../../services/account-state.service';
import { LoggerService } from '../../services/logger.service';
import { DEFAULT_MUSIC_RELAYS } from '../../utils/music-default-relays';

const MUSIC_KIND = UtilitiesService.PRIMARY_MUSIC_KIND;
const RELAY_SET_KIND = 30002;
const MUSIC_RELAY_SET_D_TAG = 'music';

export interface MusicChooserResult {
  /** The naddr-encoded reference to the selected music event */
  naddr: string;
  /** The type of music event selected */
  type: 'track' | 'playlist';
  /** Display title for preview purposes */
  title: string;
}

@Component({
  selector: 'app-music-chooser-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './music-chooser-dialog.component.html',
  styleUrl: './music-chooser-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicChooserDialogComponent implements OnDestroy {
  dialogRef?: CustomDialogRef<MusicChooserDialogComponent, MusicChooserResult>;

  private readonly utilities = inject(UtilitiesService);
  private readonly pool = inject(RelayPoolService);
  private readonly relaysService = inject(RelaysService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly database = inject(DatabaseService);
  private readonly playlistService = inject(AlbumService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);

  activeTab = signal<'tracks' | 'albums'>('tracks');
  searchQuery = signal('');
  isLoading = signal(false);

  /** All tracks fetched from relays */
  readonly allTracks = signal<Event[]>([]);
  private trackMap = new Map<string, Event>();

  /** Standalone audio element for preview playback (does not affect the main media player) */
  private previewAudio: HTMLAudioElement | null = null;
  readonly previewingTrackId = signal<string | null>(null);

  /** Current account's albums/playlists from the playlist service */
  readonly allAlbums = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return [];
    return this.playlistService.userPlaylists().filter(p => p.pubkey === pubkey);
  });
  readonly isAlbumsLoading = computed(() => this.playlistService.loading());

  /** Filtered tracks based on search */
  readonly filteredTracks = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const tracks = this.allTracks();
    if (!query) return tracks;
    return tracks.filter(event => {
      const title = (this.utilities.getMusicTitle(event) || '').toLowerCase();
      const artist = (this.utilities.getMusicArtist(event) || '').toLowerCase();
      return title.includes(query) || artist.includes(query);
    });
  });

  /** Filtered albums based on search */
  readonly filteredAlbums = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const albums = this.allAlbums();
    if (!query) return albums;
    return albums.filter(p => {
      const title = (p.title || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      return title.includes(query) || desc.includes(query);
    });
  });

  constructor() {
    this.loadTracks();
    this.loadAlbums();
  }

  ngOnDestroy(): void {
    this.stopPreview();
  }

  getTabIndex(): number {
    return this.activeTab() === 'tracks' ? 0 : 1;
  }

  onTabChange(index: number): void {
    this.activeTab.set(index === 0 ? 'tracks' : 'albums');
  }

  getTrackTitle(event: Event): string {
    return this.utilities.getMusicTitle(event) || 'Untitled Track';
  }

  getTrackArtist(event: Event): string {
    return this.utilities.getMusicArtist(event) || 'Unknown Artist';
  }

  getTrackImage(event: Event): string | undefined {
    return this.utilities.getMusicImage(event);
  }

  /** Check if a track is currently being previewed */
  isTrackPreviewing(event: Event): boolean {
    return this.previewingTrackId() === event.id;
  }

  /** Play or pause a track preview using a standalone Audio element */
  togglePreview(event: Event, $event: MouseEvent): void {
    $event.stopPropagation();

    // If same track, toggle pause/resume
    if (this.previewingTrackId() === event.id && this.previewAudio) {
      if (this.previewAudio.paused) {
        void this.previewAudio.play();
      } else {
        this.previewAudio.pause();
      }
      return;
    }

    // Stop any existing preview
    this.stopPreview();

    const url = this.utilities.getMusicAudioUrl(event);
    if (!url) return;

    this.previewAudio = new Audio(url);
    this.previewAudio.volume = 0.5;
    this.previewingTrackId.set(event.id);

    this.previewAudio.addEventListener('ended', () => {
      this.previewingTrackId.set(null);
    });

    void this.previewAudio.play();
  }

  private stopPreview(): void {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.src = '';
      this.previewAudio = null;
    }
    this.previewingTrackId.set(null);
  }

  selectTrack(event: Event): void {
    const naddr = this.utilities.encodeEventForUrl(event);
    const title = this.getTrackTitle(event);
    this.dialogRef?.close({ naddr, type: 'track', title });
  }

  selectAlbum(album: Album): void {
    if (!album.event) return;
    const naddr = this.utilities.encodeEventForUrl(album.event);
    this.dialogRef?.close({ naddr, type: 'playlist', title: album.title });
  }

  cancel(): void {
    this.dialogRef?.close(undefined);
  }

  /**
   * Load tracks from relays using a one-time query.
   *
   * We use pool.query() (one-shot fetch) instead of pool.subscribe()
   * because the dialog is opened from the chat page which already holds
   * many active subscriptions. subscribe() counts against the per-relay
   * subscription limit (MAX_CONCURRENT_SUBS_PER_RELAY = 10) and gets
   * rejected when all slots are occupied. query() uses a separate
   * "request" tracking path that is not subject to subscription limits.
   *
   * For fast rendering we first load cached tracks from IndexedDB, then
   * fetch fresh data from relays and persist any new tracks back to the DB.
   */
  private async loadTracks(): Promise<void> {
    this.isLoading.set(true);

    // Phase 1: Load cached tracks from IndexedDB for instant display
    try {
      const cachedEvents = await this.database.getEventsByKind(MUSIC_KIND);
      if (cachedEvents.length > 0) {
        for (const event of cachedEvents) {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
          const uniqueId = `${event.pubkey}:${dTag}`;
          this.trackMap.set(uniqueId, event);
        }
        this.allTracks.set(
          Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
        );
        this.isLoading.set(false);
        this.logger.debug(`[MusicChooser] Loaded ${cachedEvents.length} cached tracks from DB`);
      }
    } catch (error) {
      this.logger.warn('[MusicChooser] Failed to load cached tracks from DB:', error);
    }

    // Phase 2: Fetch fresh tracks from relays
    const relayUrls = await this.resolveMusicRelays();

    if (relayUrls.length === 0) {
      this.isLoading.set(false);
      return;
    }

    const filter: Filter = {
      kinds: [MUSIC_KIND],
      limit: 300,
    };

    try {
      const events = await this.pool.query(relayUrls, filter, 8000);
      const newEvents: Event[] = [];

      for (const event of events) {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
        const uniqueId = `${event.pubkey}:${dTag}`;

        const existing = this.trackMap.get(uniqueId);
        if (existing && existing.created_at >= event.created_at) continue;

        this.trackMap.set(uniqueId, event);
        newEvents.push(event);
      }

      if (newEvents.length > 0) {
        this.allTracks.set(
          Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
        );

        // Persist new/updated tracks to IndexedDB for future cache hits
        this.database.saveEvents(newEvents).catch(err =>
          this.logger.warn('[MusicChooser] Failed to save tracks to DB:', err)
        );
      }
    } catch (error) {
      this.logger.error('[MusicChooser] Failed to query tracks from relays:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Resolve the best set of relays for fetching music tracks.
   *
   * 1. Start with the user's account relays (synchronous)
   * 2. Check IndexedDB for a saved music relay set (kind 30002, d:"music")
   * 3. If no custom set exists, use DEFAULT_MUSIC_RELAYS as fallback
   * 4. Merge, deduplicate, and pick optimal relays
   * 5. For anonymous users with no relays, fall back to anonymousRelays + defaults
   */
  private async resolveMusicRelays(): Promise<string[]> {
    const accountRelays = this.accountRelay.getRelayUrls();
    let musicRelays: string[] = [];

    // Fast IndexedDB lookup for the user's custom music relay set
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      try {
        const cachedEvent = await this.database.getParameterizedReplaceableEvent(
          pubkey,
          RELAY_SET_KIND,
          MUSIC_RELAY_SET_D_TAG
        );

        if (cachedEvent) {
          musicRelays = cachedEvent.tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1]);
          this.logger.debug('[MusicChooser] Loaded music relay set from DB:', musicRelays);
        }
      } catch (error) {
        this.logger.warn('[MusicChooser] Failed to load music relay set from DB:', error);
      }
    }

    // If no custom music relay set found, use the default music relays
    if (musicRelays.length === 0) {
      musicRelays = [...DEFAULT_MUSIC_RELAYS];
    }

    // Merge account relays with music relays
    let allRelayUrls = [...new Set([...accountRelays, ...musicRelays])];

    // For anonymous users or users with no relays, add anonymous relays as base
    if (allRelayUrls.length === 0) {
      allRelayUrls = [...new Set([...this.utilities.anonymousRelays, ...DEFAULT_MUSIC_RELAYS])];
    }

    return this.relaysService.getOptimalRelays(allRelayUrls);
  }

  private async loadAlbums(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      await this.playlistService.fetchUserPlaylists(pubkey);
    }
  }
}
