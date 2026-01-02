import { Component, inject, signal, computed, OnInit, OnDestroy, effect, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Clipboard } from '@angular/cdk/clipboard';
import { firstValueFrom } from 'rxjs';
import { Event, Filter, nip19, kinds } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { ReactionService } from '../../../services/reaction.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { EventService } from '../../../services/event';
import { ZapService } from '../../../services/zap.service';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { LoggerService } from '../../../services/logger.service';
import { MusicPlaylistService } from '../../../services/music-playlist.service';
import { LayoutService } from '../../../services/layout.service';
import { OfflineMusicService } from '../../../services/offline-music.service';
import { NostrService } from '../../../services/nostr.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';
import { ZapDialogComponent, ZapDialogData } from '../../../components/zap-dialog/zap-dialog.component';
import { ZapChipsComponent } from '../../../components/zap-chips/zap-chips.component';
import { CommentsListComponent } from '../../../components/comments-list/comments-list.component';
import { CreateMusicPlaylistDialogComponent, CreateMusicPlaylistDialogData } from '../create-music-playlist-dialog/create-music-playlist-dialog.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../music-track-dialog/music-track-dialog.component';

interface TopZapper {
  pubkey: string;
  amount: number;
}

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-song-detail',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatMenuModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    ZapChipsComponent,
    CommentsListComponent,
    MusicTrackDialogComponent,
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
  private reactionService = inject(ReactionService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private eventService = inject(EventService);
  private zapService = inject(ZapService);
  private sharedRelay = inject(SharedRelayService);
  private logger = inject(LoggerService);
  private musicPlaylistService = inject(MusicPlaylistService);
  private layout = inject(LayoutService);
  private offlineMusicService = inject(OfflineMusicService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);

  song = signal<Event | null>(null);
  loading = signal(true);
  authorProfile = signal<NostrRecord | undefined>(undefined);
  isLiked = signal(false);
  isLiking = signal(false);
  isDownloading = signal(false);
  isSavingOffline = signal(false);
  isDeleting = signal(false);

  // Offline music signals
  isOffline = computed(() => {
    const ev = this.song();
    if (!ev) return false;
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    return this.offlineMusicService.isTrackOffline(ev.pubkey, dTag);
  });

  offlineDownloadProgress = this.offlineMusicService.downloadProgress;

  // Playlist signals
  userPlaylists = this.musicPlaylistService.userPlaylists;
  playlistsLoading = this.musicPlaylistService.loading;
  isAuthenticated = computed(() => this.app.authenticated());

  // Edit dialog signals
  showEditDialog = signal(false);
  editDialogData = signal<MusicTrackDialogData | null>(null);

  // Engagement metrics
  reactionCount = signal<number>(0);
  commentCount = signal<number>(0);
  zapTotal = signal<number>(0);
  topZappers = signal<TopZapper[]>([]);
  engagementLoading = signal<boolean>(false);


  private subscription: { close: () => void } | null = null;
  private likeSubscription: { close: () => void } | null = null;
  private likeChecked = false;
  private engagementLoaded = false;

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

  // Get gradient background (alternative to image)
  gradient = computed(() => {
    const event = this.song();
    if (!event) return null;
    const gradientTag = event.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      const colors = gradientTag[2];
      return `linear-gradient(135deg, ${colors})`;
    }
    return null;
  });

  // Parse content into sections (Lyrics, Credits, License, etc.)
  contentSections = computed(() => {
    const event = this.song();
    if (!event) return [];

    // Check for lyrics tag first
    const lyricsTag = event.tags.find(t => t[0] === 'lyrics');
    const sections: { title: string; icon: string; content: string; url?: string }[] = [];

    if (lyricsTag?.[1]) {
      sections.push({ title: 'Lyrics', icon: 'lyrics', content: lyricsTag[1] });
    }

    // Parse content for sections
    const content = event.content;
    if (content && !content.match(/^https?:\/\//)) {
      // Try to parse sections like "Lyrics:\n...", "Credits:\n...", "License:\n..."
      const sectionRegex = /^(Lyrics|Credits|License|Description|Notes|About|Info):\s*\n?/gim;
      const parts = content.split(sectionRegex).filter(p => p.trim());

      if (parts.length >= 2) {
        // We have section headers
        for (let i = 0; i < parts.length; i += 2) {
          const header = parts[i]?.trim();
          const body = parts[i + 1]?.trim();
          if (header && body) {
            const lowerHeader = header.toLowerCase();
            // Skip if we already have lyrics from tag
            if (lowerHeader === 'lyrics' && lyricsTag?.[1]) continue;

            let icon = 'description';
            let url: string | undefined;

            if (lowerHeader === 'lyrics') icon = 'lyrics';
            else if (lowerHeader === 'credits') icon = 'people';
            else if (lowerHeader === 'license') {
              icon = 'gavel';
              // Check if the body contains a URL on the second line
              const lines = body.split('\n');
              const firstLine = lines[0]?.trim() || '';
              const secondLine = lines[1]?.trim() || '';
              if (secondLine.startsWith('http')) {
                url = secondLine;
                sections.push({
                  title: 'License',
                  icon,
                  content: firstLine,
                  url
                });
                continue;
              }
            } else if (lowerHeader === 'notes' || lowerHeader === 'about' || lowerHeader === 'info') icon = 'info';

            sections.push({
              title: header.charAt(0).toUpperCase() + header.slice(1).toLowerCase(),
              icon,
              content: body,
              url
            });
          }
        }
      } else if (content.trim() && !lyricsTag?.[1]) {
        // No section headers, treat as general content/lyrics
        sections.push({ title: 'Lyrics', icon: 'lyrics', content: content.trim() });
      }
    }

    return sections;
  });

  // License computed for easy access
  license = computed(() => {
    const sections = this.contentSections();
    const licenseSection = sections.find(s => s.title === 'License');
    return licenseSection ? { name: licenseSection.content, url: licenseSection.url } : null;
  });

  // Keep legacy lyrics computed for backwards compatibility
  lyrics = computed(() => {
    const sections = this.contentSections();
    const lyricsSection = sections.find(s => s.title === 'Lyrics');
    return lyricsSection?.content || null;
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
    const event = this.song();
    // First check if artist tag exists in the event
    const artistTag = event?.tags.find(t => t[0] === 'artist');
    if (artistTag?.[1]) {
      return artistTag[1];
    }
    // Fallback to profile name
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

  identifier = computed(() => {
    const event = this.song();
    if (!event) return '';
    const dTag = event.tags.find(t => t[0] === 'd');
    return dTag?.[1] || '';
  });

  publishedDate = computed(() => {
    const event = this.song();
    if (!event) return '';
    const date = new Date(event.created_at * 1000);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  });

  isOwnTrack = computed(() => {
    const event = this.song();
    const userPubkey = this.accountState.pubkey();
    return event && userPubkey && event.pubkey === userPubkey;
  });

  constructor() {
    // Load author profile when song loads
    effect(() => {
      const event = this.song();
      if (event?.pubkey) {
        untracked(() => {
          this.data.getProfile(event.pubkey).then(profile => {
            this.authorProfile.set(profile);
          });
        });
      }
    });

    // Check if user has already liked this track
    effect(() => {
      const ev = this.song();
      const userPubkey = this.accountState.pubkey();

      if (!ev || !userPubkey || this.likeChecked) return;
      this.likeChecked = true;

      untracked(() => {
        this.checkExistingLike(ev, userPubkey);
      });
    });

    // Load engagement metrics when song loads
    effect(() => {
      const ev = this.song();
      if (ev && !this.engagementLoaded) {
        this.engagementLoaded = true;
        untracked(() => {
          this.loadEngagementMetrics(ev);
        });
      }
    });
  }

  private async loadEngagementMetrics(event: Event): Promise<void> {
    this.engagementLoading.set(true);

    try {
      // Load reactions, comments, and zaps in parallel
      const [reactionCount, commentCount, zapData] = await Promise.all([
        this.loadReactionCount(event),
        this.loadCommentCount(event),
        this.loadZaps(event),
      ]);

      this.reactionCount.set(reactionCount);
      this.commentCount.set(commentCount);
      this.zapTotal.set(zapData.total);
      this.topZappers.set(zapData.topZappers);
    } catch (err) {
      this.logger.error('Failed to load engagement metrics:', err);
    } finally {
      this.engagementLoading.set(false);
    }
  }

  private async loadReactionCount(event: Event): Promise<number> {
    try {
      const reactions = await this.eventService.loadReactions(event.id, event.pubkey);
      return reactions.events.length;
    } catch (err) {
      this.logger.error('Failed to load reactions for track:', err);
      return 0;
    }
  }

  private async loadCommentCount(event: Event): Promise<number> {
    try {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;

      // Query for kind 1111 comments using the 'A' tag for addressable events
      const filter = {
        kinds: [1111],
        '#A': [aTagValue],
        limit: 100,
      };

      const comments = await this.sharedRelay.getMany(event.pubkey, filter);
      return comments?.length || 0;
    } catch (err) {
      this.logger.error('Failed to load comments for track:', err);
      return 0;
    }
  }

  private async loadZaps(event: Event): Promise<{ total: number; topZappers: TopZapper[] }> {
    try {
      // For addressable events (like music tracks), zaps are stored with the 'a' tag
      // Format: kind:pubkey:d-tag
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;

      // Query zap receipts by both #e and #a tags to catch all zaps
      const filter = {
        kinds: [9735],
        '#a': [aTagValue],
        limit: 100,
      };

      const zapReceipts = await this.sharedRelay.getMany(event.pubkey, filter);

      let total = 0;
      const zapperAmounts = new Map<string, number>();

      for (const receipt of zapReceipts) {
        const { zapRequest, amount } = this.zapService.parseZapReceipt(receipt);
        if (amount) {
          total += amount;

          // Track zapper amounts
          if (zapRequest) {
            const zapperPubkey = zapRequest.pubkey;
            const current = zapperAmounts.get(zapperPubkey) || 0;
            zapperAmounts.set(zapperPubkey, current + amount);
          }
        }
      }

      // Get top 3 zappers
      const topZappers = Array.from(zapperAmounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pubkey, amount]) => ({ pubkey, amount }));

      return { total, topZappers };
    } catch (err) {
      this.logger.error('Failed to load zaps for track:', err);
      return { total: 0, topZappers: [] };
    }
  }

  /**
   * Format zap amount for display (e.g., 1000 -> "1k", 1500000 -> "1.5M")
   */
  formatZapAmount(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return sats.toString();
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
    if (this.likeSubscription) {
      this.likeSubscription.close();
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
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
      lyrics: this.lyrics() || undefined,
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
    // Use browser history to go back to where user came from
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/music']);
    }
  }

  likeTrack(): void {
    if (this.isLiked() || this.isLiking()) return;

    const ev = this.song();
    if (!ev) return;

    this.isLiking.set(true);
    this.reactionService.addLike(ev).then(success => {
      this.isLiking.set(false);
      if (success) {
        this.isLiked.set(true);
        this.snackBar.open('Liked!', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to like', 'Close', { duration: 3000 });
      }
    });
  }

  zapArtist(): void {
    const ev = this.song();
    if (!ev) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    const profile = this.authorProfile();

    // Check for zap splits in the event
    const zapSplits = this.zapService.parseZapSplits(ev);

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
      recipientName: this.artistName(),
      recipientMetadata: profile?.data,
      eventId: ev.id,
      eventKind: ev.kind,
      eventAddress: `${ev.kind}:${ev.pubkey}:${dTag}`,
      event: ev,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });

    // Reload zaps after dialog closes if a zap was sent
    dialogRef.afterClosed().subscribe(result => {
      if (result?.amount) {
        // Small delay to allow relay to process the zap receipt
        setTimeout(() => {
          this.loadZaps(ev).then(({ total, topZappers }) => {
            this.zapTotal.set(total);
            this.topZappers.set(topZappers);
          });
        }, 2000);
      }
    });
  }

  addToQueue(): void {
    const url = this.audioUrl();
    if (!url) return;

    const mediaItem: MediaItem = {
      source: url,
      title: this.title(),
      artist: this.artistName(),
      artwork: this.image() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
      lyrics: this.lyrics() || undefined,
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  copyEventLink(): void {
    const ev = this.song();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
      });
      const link = `https://nostria.app/a/${naddr}`;
      this.clipboard.copy(link);
      this.snackBar.open('Event link copied!', 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to copy link', 'Close', { duration: 2000 });
    }
  }

  shareTrack(): void {
    const ev = this.song();
    if (!ev) return;

    try {
      const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
      });

      // Open note editor with the track reference
      this.eventService.createNote({ content: `nostr:${naddr}` });
    } catch {
      this.snackBar.open('Failed to share track', 'Close', { duration: 2000 });
    }
  }

  copyEventData(): void {
    const ev = this.song();
    if (!ev) return;

    this.clipboard.copy(JSON.stringify(ev, null, 2));
    this.snackBar.open('Event data copied!', 'Close', { duration: 2000 });
  }

  publishTrack(): void {
    const ev = this.song();
    if (!ev) return;

    this.layout.publishEvent(ev);
  }

  editTrack(): void {
    const ev = this.song();
    if (!ev || !this.isOwnTrack()) return;

    this.editDialogData.set({ track: ev });
    this.showEditDialog.set(true);
  }

  onEditDialogClosed(result: { published: boolean; updated?: boolean; event?: Event } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated && result?.event) {
      // Reload the track data
      this.song.set(result.event);
      this.snackBar.open('Track updated', 'Close', { duration: 2000 });
    }
  }

  // Load playlists when submenu is opened
  loadPlaylists(): void {
    this.musicPlaylistService.fetchUserPlaylists();
  }

  // Create a new playlist and add this track to it
  createNewPlaylist(): void {
    const ev = this.song();
    if (!ev) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    const dialogRef = this.dialog.open(CreateMusicPlaylistDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: {
        trackPubkey: ev.pubkey,
        trackDTag: dTag,
      } as CreateMusicPlaylistDialogData,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.playlist) {
        this.snackBar.open(`Added to "${result.playlist.title}"`, 'Close', { duration: 2000 });
      }
    });
  }

  // Add track to an existing playlist
  async addToPlaylist(playlistId: string): Promise<void> {
    const ev = this.song();
    if (!ev) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    try {
      const success = await this.musicPlaylistService.addTrackToPlaylist(
        playlistId,
        ev.pubkey,
        dTag
      );

      if (success) {
        const playlist = this.userPlaylists().find(p => p.id === playlistId);
        this.snackBar.open(`Added to "${playlist?.title || 'playlist'}"`, 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to add to playlist', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error adding to playlist:', error);
      this.snackBar.open('Failed to add to playlist', 'Close', { duration: 3000 });
    }
  }

  /**
   * Download the track with a generated filename based on event metadata
   */
  async downloadTrack(): Promise<void> {
    const url = this.audioUrl();
    if (!url || this.isDownloading()) return;

    this.isDownloading.set(true);

    try {
      // Generate filename from metadata
      const sanitize = (str: string) => str.replace(/[<>:"/\\|?*]/g, '_').trim();
      const artist = sanitize(this.artistName()) || 'Unknown Artist';
      const title = sanitize(this.title()) || 'Untitled Track';

      // Detect file extension from URL or default to mp3
      const urlLower = url.toLowerCase();
      let extension = 'mp3';
      const extMatch = urlLower.match(/\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?|$)/);
      if (extMatch) {
        extension = extMatch[1];
      }

      const filename = `${artist} - ${title}.${extension}`;

      // Fetch the file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();

      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      this.snackBar.open('Download started!', 'Close', { duration: 2000 });
    } catch (error) {
      this.logger.error('Error downloading track:', error);
      this.snackBar.open('Failed to download track', 'Close', { duration: 3000 });
    } finally {
      this.isDownloading.set(false);
    }
  }

  /**
   * Toggle offline availability for this track
   */
  async toggleOffline(): Promise<void> {
    const ev = this.song();
    const url = this.audioUrl();
    if (!ev || !url) return;

    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    if (this.isOffline()) {
      // Remove from offline storage
      this.isSavingOffline.set(true);
      try {
        const success = await this.offlineMusicService.removeTrackOffline(ev.pubkey, dTag);
        if (success) {
          this.snackBar.open('Removed from offline library', 'Close', { duration: 2000 });
        } else {
          this.snackBar.open('Failed to remove from offline library', 'Close', { duration: 3000 });
        }
      } finally {
        this.isSavingOffline.set(false);
      }
    } else {
      // Save for offline use
      this.isSavingOffline.set(true);
      try {
        const success = await this.offlineMusicService.saveTrackOffline(
          ev,
          this.title(),
          this.artistName(),
          url,
          this.image() || undefined
        );

        if (success) {
          this.snackBar.open('Saved for offline listening', 'Close', { duration: 2000 });
        } else {
          this.snackBar.open('Failed to save for offline', 'Close', { duration: 3000 });
        }
      } finally {
        this.isSavingOffline.set(false);
      }
    }
  }

  /**
   * Delete the track (request deletion via NIP-09)
   */
  async deleteTrack(): Promise<void> {
    const ev = this.song();
    if (!ev || !this.isOwnTrack()) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Track',
        message: 'Are you sure you want to request deletion of this track? This action creates a deletion request (NIP-09) but cannot guarantee the track will be removed from all relays and clients.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    const confirmedDelete = await firstValueFrom(dialogRef.afterClosed());
    if (confirmedDelete) {
      this.isDeleting.set(true);
      try {
        const deleteEvent = this.nostrService.createRetractionEvent(ev);
        const result = await this.nostrService.signAndPublish(deleteEvent);

        if (result.success) {
          this.snackBar.open('Track deletion was requested', 'Dismiss', { duration: 3000 });
          // Navigate back after successful deletion request
          this.goBack();
        } else {
          this.snackBar.open('Failed to delete track', 'Close', { duration: 3000 });
        }
      } catch (error) {
        this.logger.error('Error deleting track:', error);
        this.snackBar.open('Failed to delete track', 'Close', { duration: 3000 });
      } finally {
        this.isDeleting.set(false);
      }
    }
  }
}
