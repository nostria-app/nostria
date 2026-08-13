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
import { UserRelaysService } from '../../services/relays/user-relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ZapService } from '../../services/zap.service';
import { EventDetailsDialogComponent, EventDetailsDialogData } from '../event-details-dialog/event-details-dialog.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import {
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPrimaryPodcastAudioUrl,
} from '../../utils/podcast';

@Component({
  selector: 'app-podcast-show-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'podcastShowMenu',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <mat-menu #showMenu="matMenu">
      <button mat-menu-item (click)="openShow()">
        <mat-icon>podcasts</mat-icon>
        <span i18n="@@podcasts.action.openShow">Open show</span>
      </button>
      <button mat-menu-item (click)="playLatest()" [disabled]="!latestEpisode()">
        <mat-icon>play_arrow</mat-icon>
        <span i18n="@@podcasts.action.playLatest">Play latest</span>
      </button>
      <button mat-menu-item (click)="playAll()" [disabled]="episodes().length === 0">
        <mat-icon>playlist_play</mat-icon>
        <span i18n="@@podcasts.playAll">Play all</span>
      </button>

      <mat-divider></mat-divider>

      @if (isAuthenticated()) {
        <button mat-menu-item (click)="toggleFavorite()">
          <mat-icon>{{ isFavorite() ? 'bookmark' : 'bookmark_border' }}</mat-icon>
          <span>{{ isFavorite() ? unfavoriteLabel : favoriteLabel }}</span>
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

      @if (isOwnShow()) {
        <mat-divider></mat-divider>
        <button mat-menu-item (click)="editRequested.emit()">
          <mat-icon>edit</mat-icon>
          <span i18n="@@podcasts.menu.editShow">Edit show details</span>
        </button>
        <button mat-menu-item (click)="deleteShow()" [disabled]="isDeleting()">
          @if (isDeleting()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            <mat-icon>delete</mat-icon>
          }
          <span i18n="@@podcasts.action.deleteShow">Delete show</span>
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
export class PodcastShowMenuComponent {
  private layout = inject(LayoutService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private mediaPlayer = inject(MediaPlayerService);
  private data = inject(DataService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(Clipboard);
  private customDialog = inject(CustomDialogService);
  private dialog = inject(MatDialog);
  private utilities = inject(UtilitiesService);
  private userRelays = inject(UserRelaysService);
  private eventRelaySources = inject(EventRelaySourcesService);
  private zapService = inject(ZapService);
  private nostr = inject(NostrService);
  private deleteEventService = inject(DeleteEventService);
  private eventService = inject(EventService);
  private logger = inject(LoggerService);

  @ViewChild('showMenu', { static: true }) public menu!: MatMenu;

  readonly event = input.required<NostrEvent>();
  readonly editRequested = output<void>();
  readonly deleted = output<NostrEvent>();

  readonly isDeleting = signal(false);
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;

  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly isFavorite = computed(() => this.favorites.isFavoriteShow(this.event().pubkey));
  readonly isOwnShow = computed(() => {
    const pubkey = this.accountState.pubkey();
    return !!pubkey && pubkey === this.event().pubkey;
  });
  readonly episodes = computed(() => this.podcastData.getEpisodesForShow(this.event().pubkey));
  readonly latestEpisode = computed(() => this.episodes()[0] ?? null);

  openShow(): void {
    this.layout.openPodcastShow(this.event().pubkey);
  }

  async playLatest(): Promise<void> {
    const episode = this.latestEpisode();
    if (!episode) {
      return;
    }
    const mediaItem = await this.buildMediaItem(episode);
    if (mediaItem) {
      this.mediaPlayer.play(mediaItem);
    }
  }

  async playAll(): Promise<void> {
    const items: MediaItem[] = [];
    for (const episode of this.episodes()) {
      const mediaItem = await this.buildMediaItem(episode);
      if (mediaItem) {
        items.push(mediaItem);
      }
    }
    if (items.length === 0) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }
    this.mediaPlayer.replaceQueue(items, 0);
  }

  async toggleFavorite(): Promise<void> {
    if (!this.accountState.pubkey()) {
      return;
    }
    await this.favorites.toggleShow(this.event().pubkey);
  }

  async share(): Promise<void> {
    const ev = this.event();
    const npub = nip19.npubEncode(ev.pubkey);
    const title = getPodcastTitle(ev) || $localize`:@@podcasts.untitledShow:Untitled podcast`;
    const dialogData: ShareArticleDialogData = {
      title,
      summary: getPodcastDescription(ev) || $localize`:@@podcasts.share.showSummary:Listen to ${title}:title:`,
      image: getPodcastImage(ev) || undefined,
      url: `https://nostria.app/podcasts/show/${npub}`,
      eventId: ev.id,
      pubkey: ev.pubkey,
      kind: ev.kind,
      encodedId: npub,
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

    this.dialog.open(ZapDialogComponent, {
      data: {
        recipientPubkey: ev.pubkey,
        recipientMetadata,
        eventId: ev.id,
        eventKind: ev.kind,
        event: ev,
        zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
      } satisfies ZapDialogData,
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

  copyLink(): void {
    const npub = nip19.npubEncode(this.event().pubkey);
    this.clipboard.copy(`https://nostria.app/podcasts/show/${npub}`);
    this.snackBar.open($localize`:@@podcasts.linkCopied:Link copied`, '', { duration: 2000 });
  }

  async copyEventId(): Promise<void> {
    const ev = this.event();
    try {
      const relays = this.utilities.getShareRelayHints(
        await this.userRelays.getUserRelaysForPublishing(ev.pubkey)
      );
      const encoded = nip19.neventEncode({
        id: ev.id,
        author: ev.pubkey,
        kind: ev.kind,
        relays: relays.length > 0 ? relays : undefined,
      });
      this.clipboard.copy(`nostr:${encoded}`);
      this.snackBar.open($localize`:@@podcasts.eventIdCopied:Event ID copied`, '', { duration: 2000 });
    } catch {
      this.clipboard.copy(ev.id);
      this.snackBar.open($localize`:@@podcasts.eventIdCopied:Event ID copied`, '', { duration: 2000 });
    }
  }

  copyEventData(): void {
    this.clipboard.copy(JSON.stringify(this.event(), null, 2));
    this.snackBar.open($localize`:@@podcasts.dataCopied:Event data copied`, '', { duration: 2000 });
  }

  async deleteShow(): Promise<void> {
    const ev = this.event();
    if (!this.isOwnShow() || this.isDeleting()) {
      return;
    }

    const confirmed = await this.deleteEventService.confirmDeletion({
      event: ev,
      title: $localize`:@@podcasts.delete.showTitle:Delete show`,
      entityLabel: $localize`:@@podcasts.delete.showLabel:show`,
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
        this.podcastData.removeShow(ev.pubkey);
        this.deleted.emit(ev);
        this.snackBar.open($localize`:@@podcasts.delete.showSuccess:Show deleted`, '', { duration: 3000 });
      } else {
        this.snackBar.open($localize`:@@podcasts.delete.failed:Failed to delete`, '', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to delete podcast show:', error);
      this.snackBar.open($localize`:@@podcasts.delete.failed:Failed to delete`, '', { duration: 3000 });
    } finally {
      this.isDeleting.set(false);
    }
  }

  private async buildMediaItem(episode: NostrEvent): Promise<MediaItem | null> {
    const source = getPrimaryPodcastAudioUrl(episode);
    if (!source) {
      return null;
    }

    return {
      source,
      title: getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode`,
      artist: getPodcastTitle(this.event()) || $localize`:@@podcasts.unknownShow:Podcast`,
      artwork: getPodcastImage(episode) || getPodcastImage(this.event()) || '/icons/icon-192x192.png',
      type: 'Podcast',
      eventPubkey: episode.pubkey,
      eventIdentifier: episode.id,
      eventKind: episode.kind,
    };
  }
}
