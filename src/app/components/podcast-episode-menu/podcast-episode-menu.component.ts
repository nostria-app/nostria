import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { MediaItem } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { DataService } from '../../services/data.service';
import { DeleteEventService } from '../../services/delete-event.service';
import { EventService } from '../../services/event';
import { EventRelaySourcesService } from '../../services/event-relay-sources.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { NostrService } from '../../services/nostr.service';
import { PodcastDataService } from '../../services/podcast-data.service';
import { PodcastFavoritesService } from '../../services/podcast-favorites.service';
import { ReactionService } from '../../services/reaction.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ZapService } from '../../services/zap.service';
import { EventDetailsDialogComponent, EventDetailsDialogData } from '../event-details-dialog/event-details-dialog.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import {
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
} from '../../utils/podcast';

@Component({
  selector: 'app-podcast-episode-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'podcastEpisodeMenu',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <mat-menu #episodeMenu="matMenu">
      <button mat-menu-item (click)="play()">
        <mat-icon>{{ isPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
        <span>{{ isPlaying() ? pauseLabel : playLabel }}</span>
      </button>
      <button mat-menu-item (click)="addToQueue()">
        <mat-icon>queue_music</mat-icon>
        <span i18n="@@podcasts.action.queue">Add to Queue</span>
      </button>
      <button mat-menu-item (click)="openDetails()">
        <mat-icon>info</mat-icon>
        <span i18n="@@podcasts.action.details">Episode details</span>
      </button>
      <button mat-menu-item (click)="openShow()">
        <mat-icon>podcasts</mat-icon>
        <span i18n="@@podcasts.action.openShow">Open show</span>
      </button>

      <mat-divider></mat-divider>

      @if (isAuthenticated()) {
        <button mat-menu-item (click)="toggleFavorite()">
          <mat-icon>{{ isFavorite() ? 'bookmark' : 'bookmark_border' }}</mat-icon>
          <span>{{ isFavorite() ? unfavoriteLabel : favoriteLabel }}</span>
        </button>
        <button mat-menu-item (click)="like()" [disabled]="isLiking()">
          <mat-icon>{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
          <span>{{ isLiked() ? unlikeLabel : likeLabel }}</span>
        </button>
      }
      <button mat-menu-item (click)="share()">
        <mat-icon>share</mat-icon>
        <span i18n="@@podcasts.action.share">Share</span>
      </button>
      @if (isAuthenticated()) {
        <button mat-menu-item (click)="zapCreator()">
          <mat-icon>bolt</mat-icon>
          <span i18n="@@podcasts.action.zap">Zap creator</span>
        </button>
      }
      <button mat-menu-item (click)="republish()">
        <mat-icon>publish</mat-icon>
        <span i18n="@@podcasts.action.republish">Republish</span>
      </button>

      @if (isOwnEpisode()) {
        <mat-divider></mat-divider>
        <button mat-menu-item (click)="deleteEpisode()" [disabled]="isDeleting()">
          @if (isDeleting()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            <mat-icon>delete</mat-icon>
          }
          <span i18n="@@podcasts.action.deleteEpisode">Delete episode</span>
        </button>
      }

      <mat-divider></mat-divider>

      <button mat-menu-item (click)="openEventDetails()">
        <mat-icon>data_object</mat-icon>
        <span i18n="@@podcasts.action.viewEvent">View event</span>
      </button>
      <button mat-menu-item (click)="copyLink()">
        <mat-icon>link</mat-icon>
        <span i18n="@@podcasts.action.copyLink">Copy link</span>
      </button>
      <button mat-menu-item (click)="copyEventId()">
        <mat-icon>fingerprint</mat-icon>
        <span i18n="@@podcasts.action.copyEventId">Copy event ID</span>
      </button>
      <button mat-menu-item (click)="copyEventData()">
        <mat-icon>content_copy</mat-icon>
        <span i18n="@@podcasts.action.copyData">Copy data</span>
      </button>
    </mat-menu>
  `,
  styles: [`
    :host {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      pointer-events: none;
    }
  `],
})
export class PodcastEpisodeMenuComponent {
  private mediaPlayer = inject(MediaPlayerService);
  private layout = inject(LayoutService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);
  private customDialog = inject(CustomDialogService);
  private dialog = inject(MatDialog);
  private utilities = inject(UtilitiesService);
  private userRelays = inject(UserRelaysService);
  private eventRelaySources = inject(EventRelaySourcesService);
  private reactionService = inject(ReactionService);
  private zapService = inject(ZapService);
  private data = inject(DataService);
  private nostr = inject(NostrService);
  private deleteEventService = inject(DeleteEventService);
  private eventService = inject(EventService);
  private logger = inject(LoggerService);

  @ViewChild('episodeMenu', { static: true }) public menu!: MatMenu;

  readonly event = input.required<NostrEvent>();
  readonly deleted = output<NostrEvent>();

  readonly isLiked = signal(false);
  readonly isLiking = signal(false);
  readonly isDeleting = signal(false);

  readonly playLabel = $localize`:@@podcasts.action.play:Play`;
  readonly pauseLabel = $localize`:@@podcasts.action.pause:Pause`;
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;
  readonly likeLabel = $localize`:@@podcasts.action.like:Like`;
  readonly unlikeLabel = $localize`:@@podcasts.action.unlike:Unlike`;

  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly isFavorite = computed(() => this.favorites.isFavoriteShow(this.event().pubkey));
  readonly isOwnEpisode = computed(() => {
    const pubkey = this.accountState.pubkey();
    return !!pubkey && pubkey === this.event().pubkey;
  });
  readonly isPlaying = computed(() => {
    const current = this.mediaPlayer.current();
    const url = getPrimaryPodcastAudioUrl(this.event());
    return !!current
      && current.type === 'Podcast'
      && (current.source === url || current.eventIdentifier === this.event().id);
  });

  async play(): Promise<void> {
    if (this.isPlaying()) {
      if (this.mediaPlayer.paused) {
        void this.mediaPlayer.resume();
      } else {
        this.mediaPlayer.pause();
      }
      return;
    }

    const mediaItem = await this.buildMediaItem();
    if (!mediaItem) {
      return;
    }
    this.mediaPlayer.play(mediaItem);
  }

  async addToQueue(): Promise<void> {
    const mediaItem = await this.buildMediaItem();
    if (!mediaItem) {
      return;
    }
    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open($localize`:@@podcasts.queued:Added to queue`, '', { duration: 2000 });
  }

  openDetails(): void {
    this.layout.openPodcastEpisode(this.event().id, this.event());
  }

  openShow(): void {
    this.layout.openPodcastShow(this.event().pubkey);
  }

  async toggleFavorite(): Promise<void> {
    if (!this.accountState.pubkey()) {
      return;
    }
    await this.favorites.toggleShow(this.event().pubkey);
  }

  like(): void {
    if (this.isLiked() || this.isLiking()) {
      return;
    }

    this.isLiking.set(true);
    void this.reactionService.addLike(this.event()).then(result => {
      this.isLiking.set(false);
      if (result.success) {
        this.isLiked.set(true);
        this.snackBar.open($localize`:@@podcasts.liked:Liked`, '', { duration: 2000 });
      } else {
        this.snackBar.open($localize`:@@podcasts.likeFailed:Failed to like`, '', { duration: 3000 });
      }
    });
  }

  async share(): Promise<void> {
    const ev = this.event();
    const encoded = await this.encodeNevent();
    if (!encoded) {
      this.snackBar.open($localize`:@@podcasts.shareFailed:Failed to generate share link`, '', { duration: 3000 });
      return;
    }

    const title = getPodcastTitle(ev) || $localize`:@@podcasts.untitled:Untitled episode`;
    const dialogData: ShareArticleDialogData = {
      title,
      summary: $localize`:@@podcasts.share.summary:Listen to ${title}:title:`,
      image: getPodcastImage(ev) || getPodcastImage(this.podcastData.getShow(ev.pubkey) ?? ev) || undefined,
      url: `https://nostria.app/podcasts/episode/${encoded}`,
      eventId: ev.id,
      pubkey: ev.pubkey,
      kind: ev.kind,
      encodedId: encoded,
      event: ev,
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: $localize`:@@podcasts.action.share:Share`,
      showCloseButton: true,
      data: dialogData,
      width: '560px',
      maxWidth: 'min(560px, calc(100vw - 24px))',
    });
  }

  async zapCreator(): Promise<void> {
    const ev = this.event();
    const zapSplits = this.zapService.parseZapSplits(ev);
    let recipientMetadata: Record<string, unknown> | undefined;
    try {
      recipientMetadata = (await this.data.getProfile(ev.pubkey))?.data;
    } catch {
      recipientMetadata = undefined;
    }

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
      recipientMetadata,
      eventId: ev.id,
      eventKind: ev.kind,
      event: ev,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
    };

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }

  republish(): void {
    void this.layout.publishEvent(this.event());
  }

  openEventDetails(): void {
    const ev = this.event();
    const dialogRef = this.customDialog.open(EventDetailsDialogComponent, {
      title: $localize`:@@podcasts.action.viewEvent:View event`,
      width: '800px',
      maxWidth: '95vw',
      data: {
        event: ev,
        relayUrls: this.eventRelaySources.getRelayUrls(ev.id),
      } as EventDetailsDialogData,
    });
    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.dialogData = {
      event: ev,
      relayUrls: this.eventRelaySources.getRelayUrls(ev.id),
    };
  }

  async copyLink(): Promise<void> {
    const encoded = await this.encodeNevent();
    if (!encoded) {
      this.snackBar.open($localize`:@@podcasts.copyFailed:Failed to copy`, '', { duration: 3000 });
      return;
    }
    this.clipboard.copy(`https://nostria.app/podcasts/episode/${encoded}`);
    this.snackBar.open($localize`:@@podcasts.linkCopied:Link copied`, '', { duration: 2000 });
  }

  async copyEventId(): Promise<void> {
    const encoded = await this.encodeNevent();
    if (!encoded) {
      this.snackBar.open($localize`:@@podcasts.copyFailed:Failed to copy`, '', { duration: 3000 });
      return;
    }
    this.clipboard.copy(`nostr:${encoded}`);
    this.snackBar.open($localize`:@@podcasts.eventIdCopied:Event ID copied`, '', { duration: 2000 });
  }

  copyEventData(): void {
    this.clipboard.copy(JSON.stringify(this.event(), null, 2));
    this.snackBar.open($localize`:@@podcasts.dataCopied:Event data copied`, '', { duration: 2000 });
  }

  async deleteEpisode(): Promise<void> {
    const ev = this.event();
    if (!this.isOwnEpisode() || this.isDeleting()) {
      return;
    }

    const confirmed = await this.deleteEventService.confirmDeletion({
      event: ev,
      title: $localize`:@@podcasts.delete.episodeTitle:Delete episode`,
      entityLabel: $localize`:@@podcasts.delete.episodeLabel:episode`,
      confirmText: $localize`:@@podcasts.delete.confirm:Delete`,
    });
    if (!confirmed) {
      return;
    }

    this.isDeleting.set(true);
    try {
      const deleteEvent = this.nostr.createRetractionEventWithMode(ev, confirmed.referenceMode);
      const result = await this.nostr.signAndPublish(deleteEvent);
      if (result.success) {
        await this.eventService.deleteEventFromLocalStorage(ev.id);
        this.podcastData.removeEpisode(ev.id);
        this.deleted.emit(ev);
        this.snackBar.open($localize`:@@podcasts.delete.episodeSuccess:Episode deleted`, '', { duration: 3000 });
      } else {
        this.snackBar.open($localize`:@@podcasts.delete.failed:Failed to delete`, '', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to delete podcast episode:', error);
      this.snackBar.open($localize`:@@podcasts.delete.failed:Failed to delete`, '', { duration: 3000 });
    } finally {
      this.isDeleting.set(false);
    }
  }

  private async encodeNevent(): Promise<string | null> {
    const ev = this.event();
    try {
      const relays = this.utilities.getShareRelayHints(
        await this.userRelays.getUserRelaysForPublishing(ev.pubkey)
      );
      return nip19.neventEncode({
        id: ev.id,
        author: ev.pubkey,
        kind: ev.kind,
        relays: relays.length > 0 ? relays : undefined,
      });
    } catch {
      return ev.id;
    }
  }

  private async buildMediaItem(): Promise<MediaItem | null> {
    const ev = this.event();
    const source = getPrimaryPodcastAudioUrl(ev);
    if (!source) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return null;
    }

    let artist = getPodcastTitle(this.podcastData.getShow(ev.pubkey) ?? ev);
    if (!artist) {
      try {
        const profile = await this.data.getProfile(ev.pubkey);
        artist = profile?.data?.display_name || profile?.data?.name || $localize`:@@podcasts.unknownShow:Podcast`;
      } catch {
        artist = $localize`:@@podcasts.unknownShow:Podcast`;
      }
    }

    return {
      source,
      title: getPodcastTitle(ev) || $localize`:@@podcasts.untitled:Untitled episode`,
      artist: artist || $localize`:@@podcasts.unknownShow:Podcast`,
      artwork: getPodcastImage(ev) || getPodcastImage(this.podcastData.getShow(ev.pubkey) ?? ev) || '/icons/icon-192x192.png',
      type: 'Podcast',
      eventPubkey: ev.pubkey,
      eventIdentifier: ev.id,
      eventKind: ev.kind,
    };
  }
}
