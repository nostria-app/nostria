import { Component, inject, signal, computed, OnInit, OnDestroy, effect, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, Filter, nip19 } from 'nostr-tools';
import { formatDuration } from '../../../utils/format-duration';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { ReportingService } from '../../../services/reporting.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LayoutService } from '../../../services/layout.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../music-track-dialog/music-track-dialog.component';
import { MusicTrackMenuComponent } from '../../../components/music-track-menu/music-track-menu.component';
import { ZapDialogComponent, ZapDialogData } from '../../../components/zap-dialog/zap-dialog.component';
import { ZapService } from '../../../services/zap.service';

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
    MatTooltipModule,
    MusicPlaylistCardComponent,
    MusicTrackDialogComponent,
    MusicTrackMenuComponent,
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
  private layout = inject(LayoutService);
  private panelNav = inject(PanelNavigationService);
  private readonly logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);
  private dialog = inject(MatDialog);
  private userRelaysService = inject(UserRelaysService);
  private zapService = inject(ZapService);

  // Input for when opened via RightPanelService
  npubInput = input<string | undefined>(undefined);

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

  canZapArtist = computed(() => {
    const profileData = this.authorProfile()?.data as Record<string, unknown> | undefined;
    if (!profileData) return false;
    return this.zapService.getLightningAddress(profileData) !== null;
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

  panelTitle = computed(() => this.isOwnProfile() ? $localize`:@@music.myMusic:My Music` : this.artistName());

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
    // Check for input first (when opened via RightPanelService)
    const npubFromInput = this.npubInput();
    const pubkeyParam = npubFromInput || this.route.snapshot.paramMap.get('pubkey');

    if (pubkeyParam) {
      let decodedPubkey = pubkeyParam;
      if (pubkeyParam.startsWith('npub')) {
        try {
          const decoded = nip19.decode(pubkeyParam);
          if (decoded.type === 'npub') {
            decodedPubkey = decoded.data;
          }
        } catch (e) {
          this.logger.error('Failed to decode npub:', e);
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
      this.logger.warn('No relays available');
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
    // Use panel navigation for proper right panel back navigation
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
    } else {
      this.router.navigate(['/music']);
    }
  }

  goToProfile(): void {
    const npub = this.artistNpub();
    if (npub) {
      this.layout.openProfile(npub);
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
      const videoTag = track.tags.find(t => t[0] === 'video');
      const cover = coverTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png';
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      return {
        title,
        artist: artistName,
        source: streamUrl,
        artwork: cover,
        video: videoTag?.[1] || undefined,
        type: 'Music' as const,
        eventPubkey: this.artistNpub(),
        eventIdentifier: dTag,
        lyrics: this.utilities.extractLyricsFromEvent(track),
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

  getTrackGradient(track: Event): string | null {
    const gradientTag = track.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      return `linear-gradient(135deg, ${gradientTag[2]})`;
    }
    return null;
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
        return formatDuration(seconds);
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
      const videoTag = track.tags.find(t => t[0] === 'video');
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      const mediaItem: MediaItem = {
        source: url,
        title: titleTag?.[1] || 'Untitled Track',
        artist: this.getTrackArtist(track),
        artwork: imageTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png',
        video: videoTag?.[1] || undefined,
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
    const videoTag = track.tags.find(t => t[0] === 'video');
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    const profile = this.authorProfile();

    const mediaItem: MediaItem = {
      source: url,
      title: titleTag?.[1] || 'Untitled Track',
      artist: this.getTrackArtist(track),
      artwork: imageTag?.[1] || profile?.data?.picture || '/icons/icon-192x192.png',
      video: videoTag?.[1] || undefined,
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
      lyrics: this.utilities.extractLyricsFromEvent(track),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  goToTrackDetails(track: Event): void {
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    if (track.pubkey && dTag) {
      this.layout.openSongDetail(track.pubkey, dTag, track);
    }
  }

  async copyTrackLink(track: Event): Promise<void> {
    try {
      await this.userRelaysService.ensureRelaysForPubkey(track.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(track.pubkey);
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: track.kind,
        pubkey: track.pubkey,
        identifier: dTag,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });
      const link = `https://nostria.app/a/${naddr}`;
      this.clipboard.copy(link);
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

  copyArtistLink(): void {
    const npub = this.artistNpub();
    if (!npub) return;

    const link = `https://nostria.app/music/artist/${npub}`;
    this.clipboard.copy(link);
    this.snackBar.open('Artist link copied!', 'Close', { duration: 2000 });
  }

  downloadTracksAsM3u8(): void {
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
    const downloadUrl = URL.createObjectURL(blob);

    // Create a safe filename from the artist name
    const safeArtistName = this.artistName()
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length

    const filename = `${safeArtistName || 'artist'}_tracks.m3u8`;

    // Create download link and trigger download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    this.snackBar.open('Tracks downloaded!', 'Close', { duration: 2000 });
  }

  zapArtist(): void {
    const pk = this.pubkey();
    if (!pk || !this.canZapArtist()) return;

    const profile = this.authorProfile();

    const data: ZapDialogData = {
      recipientPubkey: pk,
      recipientName: this.artistName(),
      recipientMetadata: profile?.data,
    };

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }
}
