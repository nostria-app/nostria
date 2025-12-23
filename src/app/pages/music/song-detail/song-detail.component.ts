import { Component, inject, signal, computed, OnInit, OnDestroy, effect, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Event, Filter, nip19, kinds } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { ReactionService } from '../../../services/reaction.service';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { ZapService } from '../../../services/zap.service';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { LoggerService } from '../../../services/logger.service';
import { NostrRecord, MediaItem } from '../../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../../../components/zap-dialog/zap-dialog.component';
import { ZapChipsComponent } from '../../../components/zap-chips/zap-chips.component';
import { CommentsListComponent } from '../../../components/comments-list/comments-list.component';

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
    MatSnackBarModule,
    ZapChipsComponent,
    CommentsListComponent,
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
  private eventService = inject(EventService);
  private zapService = inject(ZapService);
  private sharedRelay = inject(SharedRelayService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  song = signal<Event | null>(null);
  loading = signal(true);
  authorProfile = signal<NostrRecord | undefined>(undefined);
  isLiked = signal(false);
  isLiking = signal(false);

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
      const zapReceipts = await this.zapService.getZapsForEvent(event.id);
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

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
      recipientName: this.artistName(),
      recipientMetadata: profile?.data,
      eventId: ev.id,
      eventKind: ev.kind,
      eventAddress: `${ev.kind}:${ev.pubkey}:${dTag}`,
      event: ev,
    };

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }
}
