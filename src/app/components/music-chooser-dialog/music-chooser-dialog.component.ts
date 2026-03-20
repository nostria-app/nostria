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
import { MusicPlaylistService, MusicPlaylist } from '../../services/music-playlist.service';
import { AccountStateService } from '../../services/account-state.service';
import { LoggerService } from '../../services/logger.service';

const MUSIC_KIND = UtilitiesService.PRIMARY_MUSIC_KIND;
const MUSIC_PLAYLIST_KIND = 34139;

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
  private readonly playlistService = inject(MusicPlaylistService);
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);

  activeTab = signal<'tracks' | 'albums'>('tracks');
  searchQuery = signal('');
  isLoading = signal(false);

  /** All tracks fetched from relays */
  readonly allTracks = signal<Event[]>([]);
  private trackMap = new Map<string, Event>();
  private trackSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

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
    this.closeTrackSubscription();
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

  selectAlbum(album: MusicPlaylist): void {
    if (!album.event) return;
    const naddr = this.utilities.encodeEventForUrl(album.event);
    this.dialogRef?.close({ naddr, type: 'playlist', title: album.title });
  }

  cancel(): void {
    this.dialogRef?.close(undefined);
  }

  private loadTracks(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) {
      return;
    }

    this.isLoading.set(true);

    const timeout = setTimeout(() => {
      this.isLoading.set(false);
    }, 6000);

    const filter: Filter = {
      kinds: [MUSIC_KIND],
      limit: 300,
    };

    this.trackSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;

      this.trackMap.set(uniqueId, event);
      this.allTracks.set(
        Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
      );

      if (this.isLoading()) {
        clearTimeout(timeout);
        this.isLoading.set(false);
      }
    });
  }

  private async loadAlbums(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      await this.playlistService.fetchUserPlaylists(pubkey);
    }
  }

  private closeTrackSubscription(): void {
    if (this.trackSubscription) {
      if (this.trackSubscription.close) {
        this.trackSubscription.close();
      } else if (this.trackSubscription.unsubscribe) {
        this.trackSubscription.unsubscribe();
      }
      this.trackSubscription = null;
    }
  }
}
