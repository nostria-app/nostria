import { Component, computed, input, inject, signal, effect, untracked, output, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { firstValueFrom } from 'rxjs';
import { Event, Filter, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { ReactionService } from '../../services/reaction.service';
import { AccountStateService } from '../../services/account-state.service';
import { MusicPlaylistService } from '../../services/music-playlist.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { EventService } from '../../services/event';
import { DatabaseService } from '../../services/database.service';
import { ZapService } from '../../services/zap.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { LayoutService } from '../../services/layout.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { NostrService } from '../../services/nostr.service';
import { MusicLikedSongsService } from '../../services/music-liked-songs.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { DeleteEventService } from '../../services/delete-event.service';
import {
  EditMusicPlaylistDialogComponent,
  EditMusicPlaylistDialogData,
} from '../../pages/music/edit-music-playlist-dialog/edit-music-playlist-dialog.component';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-music-playlist-card',
  imports: [MatIconModule, MatCardModule, MatDividerModule, MatButtonModule, MatMenuModule, MatSnackBarModule, MatProgressSpinnerModule, EditMusicPlaylistDialogComponent],
  template: `
    <mat-card class="playlist-card">
      <div class="playlist-cover" [style.background]="gradient() || ''" (click)="playPlaylist($any($event))"
        (keydown.enter)="playPlaylist($any($event))" (keydown.space)="playPlaylist($any($event))" tabindex="0" role="button"
        [attr.aria-label]="'Play ' + title()">
        @if (coverImage()) {
          <img [src]="coverImage()" [alt]="title()" class="cover-image" loading="lazy" />
        } @else {
        <div class="cover-placeholder" [class.with-gradient]="!!gradient()">
          <mat-icon>queue_music</mat-icon>
        </div>
        }
        @if (trackCount() > 0) {
        <button mat-icon-button class="play-btn media-action-button media-primary-action" (click)="playPlaylist($event)"
          [disabled]="isLoadingTracks()"
          aria-label="Play playlist">
          @if (isLoadingTracks()) {
            <mat-spinner diameter="24"></mat-spinner>
          } @else {
            <mat-icon>play_arrow</mat-icon>
          }
        </button>
        }
        <div class="hover-action-row">
          <button mat-icon-button class="media-action-button like-action" [class.is-liked]="isLiked()" (click)="likePlaylist($event)"
            [attr.aria-label]="isLiked() ? 'Unlike playlist' : 'Like playlist'" [title]="isLiked() ? 'Unlike' : 'Like'">
            <mat-icon [class.is-liked]="isLiked()">{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
          </button>
          <button mat-icon-button class="media-action-button share-action" (click)="sharePlaylist(); $event.stopPropagation()"
            aria-label="Share playlist" title="Share playlist">
            <mat-icon>share</mat-icon>
          </button>
          <button mat-icon-button class="media-action-button zap-action" (click)="zapCreator($event)"
            aria-label="Zap creator" title="Zap creator">
            <mat-icon>bolt</mat-icon>
          </button>
        </div>
      </div>
      <mat-card-content (click)="openPlaylist($any($event))" (keydown.enter)="openPlaylist($any($event))" (keydown.space)="openPlaylist($any($event))"
        tabindex="0" role="button" [attr.aria-label]="'Open playlist ' + title()">
        <div class="playlist-info">
          <div class="playlist-title-row">
            <span class="playlist-title">{{ title() }}</span>
            <button mat-icon-button class="menu-btn" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <span class="playlist-meta">
            {{ trackCount() }} tracks
            @if (isPrivate()) {
              <span class="visibility-badge">
                <mat-icon>lock</mat-icon>
                Private
              </span>
            }
          </span>
          @if (description()) {
            <span class="playlist-description">{{ description() }}</span>
          }
        </div>
        <mat-menu #menu="matMenu">
          <button mat-menu-item (click)="playPlaylist($event)">
            <mat-icon>play_arrow</mat-icon>
            <span>Play All</span>
          </button>
          <mat-divider></mat-divider>
          <button mat-menu-item (click)="likePlaylist($event)">
            <mat-icon>{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
            <span>{{ isLiked() ? 'Unlike' : 'Like' }}</span>
          </button>

          <button mat-menu-item (click)="sharePlaylist()">
            <mat-icon>share</mat-icon>
            <span>Share</span>
          </button>
          <button mat-menu-item (click)="zapCreator($event)">
            <mat-icon>bolt</mat-icon>
            <span>Zap Creator</span>
          </button>
          <mat-divider></mat-divider>
           @if (isOwnPlaylist()) {
            <button mat-menu-item (click)="editPlaylist()">
              <mat-icon>edit</mat-icon>
              <span>Edit Album</span>
            </button>
            <button mat-menu-item (click)="deletePlaylist($event)" [disabled]="isDeleting()">
              @if (isDeleting()) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                <mat-icon>delete</mat-icon>
              }
              <span>Delete Album</span>
            </button>
            <mat-divider></mat-divider>
          }
          <button mat-menu-item (click)="copyEventLink()">
            <mat-icon>link</mat-icon>
            <span>Copy Link</span>
          </button>
          <button mat-menu-item (click)="copyEventData()">
            <mat-icon>data_object</mat-icon>
            <span>Copy Data</span>
          </button>

        </mat-menu>
      </mat-card-content>
    </mat-card>
    
    @if (showEditDialog() && editDialogData()) {
      <app-edit-music-playlist-dialog [data]="editDialogData()!" (closed)="onEditDialogClosed($event)" />
    }
  `,
  styles: [`
    .playlist-card {
      transition: transform 0.2s ease, background-color 0.2s ease;
      overflow: hidden;
      min-width: 0;
      background-color: var(--mat-sys-surface-container-high);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--mat-sys-shadow) 10%, transparent);

      &:hover {
        transform: translateY(-2px);
        background-color: var(--mat-sys-surface-container-highest);

        .play-btn,
        .hover-action-row {
          opacity: 1;
        }

        .play-btn {
          transform: translate(-50%, -50%) scale(1);
        }

        .hover-action-row {
          transform: translate(-50%, 0);
        }
      }

      &:focus-within {
        background-color: var(--mat-sys-surface-container-highest);

        .play-btn,
        .hover-action-row {
          opacity: 1;
        }

        .play-btn {
          transform: translate(-50%, -50%) scale(1);
        }

        .hover-action-row {
          transform: translate(-50%, 0);
        }
      }

      @media (max-width: 600px) {
        &:hover {
          transform: none;
        }
      }

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    :host-context(.dark) .playlist-card {
      background-color: var(--mat-sys-surface-container);
      box-shadow: none;
    }

    :host-context(.dark) .playlist-card:hover,
    :host-context(.dark) .playlist-card:focus-within {
      background-color: var(--mat-sys-surface-container-high);
    }

    .playlist-cover {
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      position: relative;
      border-radius: 8px;
      cursor: pointer;

      &:focus {
        outline: none;
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }

      &::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--mat-sys-scrim) 8%, transparent) 0%,
          color-mix(in srgb, var(--mat-sys-scrim) 18%, transparent) 52%,
          color-mix(in srgb, var(--mat-sys-scrim) 48%, transparent) 100%
        );
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }

      .playlist-card:hover &::after,
      .playlist-card:focus-within &::after {
        opacity: 1;
      }

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.28s ease;
      }

      .playlist-card:hover & .cover-image,
      .playlist-card:focus-within & .cover-image {
        transform: scale(1.05);
      }

      .cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);

        &.with-gradient {
          background: transparent;
        }

        mat-icon {
          font-size: 3rem;
          width: 3rem;
          height: 3rem;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.5;
        }
      }

      .play-btn {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 64px;
        height: 64px;
        opacity: 0;
        transform: translate(-50%, -44%) scale(0.92);
        transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
        border-radius: 50%;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;

        &:hover:not(:disabled) {
          transform: translate(-50%, -50%) scale(1.04);
        }

        &:disabled {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
        }

        mat-spinner {
          margin: auto;

          ::ng-deep circle {
            stroke: var(--mat-sys-on-surface) !important;
          }
        }
      }

      .hover-action-row {
        position: absolute;
        left: 50%;
        bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transform: translate(-50%, 8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 2;
      }

      .media-action-button {
        width: 40px;
        height: 40px;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--mat-sys-scrim) 42%, transparent);
        color: var(--mat-sys-on-surface);
        border: 1px solid color-mix(in srgb, var(--mat-sys-outline) 32%, transparent);
        backdrop-filter: blur(14px);
        box-shadow: var(--mat-sys-level2);
        transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;

        &:not(.media-primary-action):hover:not(:disabled) {
          background: color-mix(in srgb, var(--mat-sys-scrim) 56%, transparent);
          transform: translateY(-1px);
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .media-primary-action {
        background: color-mix(in srgb, var(--mat-sys-surface-container-highest) 68%, transparent);
        color: var(--mat-sys-on-surface);
        border-color: color-mix(in srgb, var(--mat-sys-outline) 40%, transparent);

        &:hover:not(:disabled) {
          background: color-mix(in srgb, var(--mat-sys-surface-container-highest) 82%, transparent);
        }
      }

      .like-action {
        &.is-liked {
          background: color-mix(in srgb, var(--mat-sys-error-container) 34%, transparent);
          color: color-mix(in srgb, var(--mat-sys-error) 68%, var(--mat-sys-on-surface) 32%);
          border-color: color-mix(in srgb, var(--mat-sys-error) 20%, transparent);
        }

        &:hover:not(:disabled) {
          background: color-mix(in srgb, var(--mat-sys-error-container) 58%, transparent);
          color: color-mix(in srgb, var(--mat-sys-error) 76%, var(--mat-sys-on-surface) 24%);
          border-color: color-mix(in srgb, var(--mat-sys-error) 34%, transparent);
        }

        mat-icon.is-liked {
          font-variation-settings: 'FILL' 1;
        }
      }

      .share-action {
        &:hover:not(:disabled) {
          background: color-mix(in srgb, #2f6dff 26%, transparent);
          color: color-mix(in srgb, #8ab4ff 78%, var(--mat-sys-on-surface) 22%);
          border-color: color-mix(in srgb, #6ea0ff 38%, transparent);
        }
      }

      .zap-action {
        &:hover:not(:disabled) {
          background: color-mix(in srgb, #ff9800 24%, transparent);
          color: color-mix(in srgb, #ffbf66 78%, var(--mat-sys-on-surface) 22%);
          border-color: color-mix(in srgb, #ffb74d 34%, transparent);
        }
      }
    }

    mat-card-content {
      padding-top: 0.75rem;
      min-width: 0;
      overflow: hidden;
      cursor: pointer;

      &:focus {
        outline: none;
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }

      @media (max-width: 600px) {
        padding-top: 0.5rem;
      }
    }

    .playlist-info {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
      overflow: hidden;
    }

    .playlist-title-row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      min-width: 0;
    }

    .playlist-title {
      flex: 1;
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .menu-btn {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      padding: 0;
      margin: -4px -8px -4px 0;
      opacity: 0.6;
      transition: opacity 0.2s ease;

      mat-icon {
        font-size: 1.25rem;
        width: 1.25rem;
        height: 1.25rem;
      }

      &:hover {
        opacity: 1;
      }
    }

    .playlist-meta {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      align-items: center;
      gap: 0.375rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      .visibility-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        font-size: 0.6875rem;

        mat-icon {
          font-size: 0.75rem;
          width: 0.75rem;
          height: 0.75rem;
        }
      }
    }

    .playlist-description {
      font-size: 0.6875rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.125rem;

      @media (max-width: 600px) {
        display: none;
      }
    }

    .menu-btn {
      @media (max-width: 600px) {
        width: 28px;
        height: 28px;
        margin: -2px -4px -2px 0;
      }
    }

    // Compact mode when inside yours-grid (all screen sizes)
    :host-context(.yours-grid) {
      :host {
        min-width: 0;
        overflow: hidden;
      }

      .playlist-card {
        display: flex;
        flex-direction: row;
        align-items: center;
        height: 56px;
        border-radius: var(--mat-sys-corner-small);
        overflow: hidden;

        &:hover {
          transform: none;

          .play-btn {
            opacity: 0;
          }
        }
      }

      .playlist-cover {
        width: 56px;
        min-width: 56px;
        height: 56px;
        aspect-ratio: auto;
        border-radius: var(--mat-sys-corner-small) 0 0 var(--mat-sys-corner-small);

        .cover-image {
          width: 56px;
          height: 56px;
          object-fit: cover;
        }

        .cover-placeholder mat-icon {
          font-size: 1.5rem;
          width: 1.5rem;
          height: 1.5rem;
        }

        .play-btn {
          display: none;
        }

        .hover-action-row {
          display: none;
        }
      }

      mat-card-content {
        padding: 0 0.625rem;
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .playlist-info {
        overflow: hidden;
      }

      .playlist-title-row {
        overflow: hidden;
      }

      .playlist-title {
        font-size: 0.8125rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .playlist-meta {
        font-size: 0.6875rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .playlist-description {
        display: none;
      }

      .menu-btn {
        display: none;
      }
    }
  `],
})
export class MusicPlaylistCardComponent {
  private router = inject(Router);
  private data = inject(DataService);
  private reactionService = inject(ReactionService);
  private accountState = inject(AccountStateService);
  private musicPlaylistService = inject(MusicPlaylistService);
  private mediaPlayer = inject(MediaPlayerService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private eventService = inject(EventService);
  private database = inject(DatabaseService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);
  private zapService = inject(ZapService);
  private imageCache = inject(ImageCacheService);
  private layout = inject(LayoutService);
  private customDialog = inject(CustomDialogService);
  private userRelaysService = inject(UserRelaysService);
  private nostrService = inject(NostrService);
  private likedSongsService = inject(MusicLikedSongsService);
  private deleteEventService = inject(DeleteEventService);

  event = input.required<Event>();
  likedReaction = input<Event | null>(null);
  likedReactionChange = output<Event | null>();

  authorProfile = signal<NostrRecord | undefined>(undefined);
  isLoadingTracks = signal(false);
  isDeleting = signal(false);

  // Edit dialog state
  showEditDialog = signal(false);
  editDialogData = signal<EditMusicPlaylistDialogData | null>(null);

  private profileLoaded = false;

  // Check if the current user owns this playlist
  isOwnPlaylist = computed(() => {
    const currentPubkey = this.accountState.pubkey();
    return currentPubkey === this.event().pubkey;
  });

  constructor() {
    // Load author profile - use untracked to prevent re-triggers from cache updates
    effect(() => {
      const pubkey = this.event().pubkey;
      if (pubkey && !this.profileLoaded) {
        this.profileLoaded = true;
        untracked(() => {
          this.data.getProfile(pubkey).then(profile => {
            this.authorProfile.set(profile);
          });
        });
      }
    });

    effect(() => {
      const event = this.event();
      const userPubkey = this.accountState.pubkey();
      if (!event || !userPubkey) {
        return;
      }

      this.likedSongsService.likedAlbumRefs();

      untracked(() => {
        void this.likedSongsService.ensureInitialized(userPubkey);
      });
    });
  }

  // Extract title from tags
  title = computed(() => {
    const event = this.event();
    const titleTag = event.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Playlist';
  });

  // Extract description
  description = computed(() => {
    const event = this.event();
    const descTag = event.tags.find(t => t[0] === 'description');
    return descTag?.[1] || event.content || null;
  });

  // Count tracks (a tags referencing kind 36787)
  trackCount = computed(() => {
    const event = this.event();
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
    const eventTrackRefs = this.getTrackRefsFromEvent(event);

    if (dTag) {
      const playlistFromService = this.musicPlaylistService
        .userPlaylists()
        .find(playlist => playlist.id === dTag && playlist.pubkey === event.pubkey);

      if (playlistFromService) {
        if (playlistFromService.created_at >= event.created_at) {
          return playlistFromService.trackRefs.length;
        }

        return eventTrackRefs.length;
      }
    }

    return eventTrackRefs.length;
  });

  // Check if private
  isPrivate = computed(() => {
    const event = this.event();
    return this.utilities.isMusicPlaylistPrivate(event);
  });

  // Cover image (raw URL)
  rawCoverImage = computed(() => {
    const event = this.event();
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Cover image (proxied for display to reduce image size)
  coverImage = computed(() => {
    const rawUrl = this.rawCoverImage();
    if (!rawUrl) return null;
    // Use 320x320 for playlist card display
    return this.imageCache.getOptimizedImageUrlWithSize(rawUrl, 320, 320);
  });

  // Get gradient background (alternative to image)
  gradient = computed(() => {
    const event = this.event();
    return this.utilities.getMusicGradient(event);
  });

  // Track liked state - prefer parent input, keep local override until parent catches up
  private _likedOverride = signal<Event | null | undefined>(undefined);
  isLiked = computed(() => {
    const override = this._likedOverride();
    if (override !== undefined) return !!override;

    const playlist = this.event();
    if (playlist.kind === 34139 && this.likedSongsService.isAlbumLiked(playlist)) {
      return true;
    }

    return !!this.likedReaction();
  });

  // Get naddr for addressable event
  naddr = computed(() => {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    try {
      return nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
      });
    } catch {
      return '';
    }
  });

  openPlaylist(triggerEvent?: MouseEvent | KeyboardEvent): void {
    if (triggerEvent instanceof KeyboardEvent) {
      triggerEvent.preventDefault();
    }
    triggerEvent?.stopPropagation();

    const event = this.event();
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag) {
      this.layout.openMusicAlbum(event.pubkey, dTag, event);
    }
  }

  // Like the playlist
  likePlaylist(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();

    const ev = this.event();
    if (this.isLiked()) {
      const existingReaction = this._likedOverride() ?? this.likedReaction();

      const deletePromise = existingReaction
        ? this.reactionService.deleteReaction(existingReaction)
        : this.reactionService.deleteLikeForTarget(ev);

      deletePromise.then(result => {
        if (result.success) {
          this._likedOverride.set(null);
          this.likedReactionChange.emit(null);
          this.snackBar.open('Like removed', 'Close', { duration: 2000 });
        } else {
          this.snackBar.open('Failed to remove like', 'Close', { duration: 3000 });
        }
      });
      return;
    }

    this.reactionService.addLike(ev).then(result => {
      if (result.success) {
        const reactionEvent = result.event ?? null;
        this._likedOverride.set(reactionEvent);
        this.likedReactionChange.emit(reactionEvent);
        this.snackBar.open('Liked!', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to like', 'Close', { duration: 3000 });
      }
    });
  }

  // Zap the creator
  zapCreator(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    const profile = this.authorProfile();

    // Check for zap splits in the event
    const zapSplits = this.zapService.parseZapSplits(ev);

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
      recipientMetadata: profile?.data,
      eventId: ev.id,
      eventKind: ev.kind,
      eventAddress: `${ev.kind}:${ev.pubkey}:${dTag}`,
      event: ev,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
    };

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }

  // Copy event link (playlist URL)
  copyEventLink(): void {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1];
    if (dTag) {
      void this.createAlbumShareUrl(ev).then(link => {
        this.clipboard.copy(link);
        this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
      }).catch(() => {
        this.snackBar.open('Failed to generate link', 'Close', { duration: 3000 });
      });
    } else {
      this.snackBar.open('Failed to generate link', 'Close', { duration: 3000 });
    }
  }

  // Copy event JSON data
  copyEventData(): void {
    const ev = this.event();
    this.clipboard.copy(JSON.stringify(ev, null, 2));
    this.snackBar.open('Event data copied!', 'Close', { duration: 2000 });
  }

  // Open standard share dialog
  async sharePlaylist(): Promise<void> {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    if (!dTag) {
      this.snackBar.open('Failed to generate playlist link', 'Close', { duration: 3000 });
      return;
    }

    try {
      const naddr = await this.createAlbumShareNaddr(ev);
      const link = this.getAlbumShareUrl(naddr);

      const dialogData: ShareArticleDialogData = {
        title: this.title(),
        summary: this.description() || `Check out ${this.title()}`,
        image: this.coverImage() || undefined,
        url: link,
        eventId: ev.id,
        pubkey: ev.pubkey,
        identifier: dTag,
        kind: ev.kind,
        encodedId: naddr,
        naddr,
        event: ev,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: 'Share',
        showCloseButton: true,
        data: dialogData,
        width: '560px',
        maxWidth: 'min(560px, calc(100vw - 24px))',
      });
    } catch {
      this.snackBar.open('Failed to share playlist', 'Close', { duration: 3000 });
    }
  }

  private async createAlbumShareUrl(event: Event): Promise<string> {
    const naddr = await this.createAlbumShareNaddr(event);
    return this.getAlbumShareUrl(naddr);
  }

  private async createAlbumShareNaddr(event: Event): Promise<string> {
    const identifier = event.tags.find(t => t[0] === 'd')?.[1];
    if (!identifier) {
      throw new Error('Missing album identifier');
    }

    const authorRelays = this.utilities.getShareRelayHints(
      await this.userRelaysService.getUserRelaysForPublishing(event.pubkey)
    );

    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
      relays: authorRelays.length > 0 ? authorRelays : undefined,
    });
  }

  private getAlbumShareUrl(naddr: string): string {
    return `https://nostria.app/music/album/${naddr}`;
  }

  // Edit playlist
  editPlaylist(): void {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    // Get the playlist from the service or create from event
    const playlists = this.musicPlaylistService.userPlaylists();
    let playlist = playlists.find(p => p.id === dTag && p.pubkey === ev.pubkey);

    if (playlist?.event && playlist.event.created_at < ev.created_at) {
      playlist = undefined;
    }

    if (!playlist) {
      // Create playlist object from event
      const titleTag = ev.tags.find(t => t[0] === 'title');
      const descTag = ev.tags.find(t => t[0] === 'description');
      const imageTag = ev.tags.find(t => t[0] === 'image');
      const collaborativeTag = ev.tags.find(t => t[0] === 'collaborative');
      const trackRefs = this.getTrackRefsFromEvent(ev);

      playlist = {
        id: dTag,
        title: titleTag?.[1] || 'Untitled Playlist',
        description: descTag?.[1] || ev.content || undefined,
        image: imageTag?.[1] || undefined,
        pubkey: ev.pubkey,
        isPublic: this.utilities.isMusicPlaylistPublic(ev),
        isCollaborative: collaborativeTag?.[1] === 'true',
        trackRefs,
        created_at: ev.created_at,
        event: ev,
      };
    }

    // Use inline dialog instead of MatDialog
    this.editDialogData.set({ playlist });
    this.showEditDialog.set(true);
  }

  private getTrackRefsFromEvent(event: Event): string[] {
    return this.utilities.getMusicPlaylistTrackRefs(event);
  }

  // Handle edit dialog closed
  onEditDialogClosed(result: { updated: boolean; playlist?: any } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated) {
      this.snackBar.open('Playlist updated', 'Close', { duration: 2000 });
    }
  }

  async deletePlaylist(event: MouseEvent | KeyboardEvent): Promise<void> {
    event.stopPropagation();
    const ev = this.event();
    if (!this.isOwnPlaylist() || this.isDeleting()) return;

    const confirmedDelete = await this.deleteEventService.confirmDeletion({
      event: ev,
      title: 'Delete Album',
      entityLabel: 'album',
      confirmText: 'Delete',
    });
    if (!confirmedDelete) return;

    this.isDeleting.set(true);
    try {
      const deleteEvent = this.nostrService.createRetractionEventWithMode(ev, confirmedDelete.referenceMode);
      const result = await this.nostrService.signAndPublish(deleteEvent);

      if (result.success) {
        await this.eventService.deleteEventFromLocalStorage(ev.id);
        await this.musicPlaylistService.fetchUserPlaylists(ev.pubkey);
        this.snackBar.open('Album deleted successfully', 'Dismiss', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to delete album', 'Close', { duration: 3000 });
      }
    } catch {
      this.snackBar.open('Failed to delete album', 'Close', { duration: 3000 });
    } finally {
      this.isDeleting.set(false);
    }
  }

  // Play all tracks in the playlist
  async playPlaylist(clickEvent: MouseEvent | KeyboardEvent): Promise<void> {
    if (clickEvent instanceof KeyboardEvent) {
      clickEvent.preventDefault();
    }
    clickEvent.stopPropagation();

    if (this.isLoadingTracks()) return;

    const ev = this.event();
    const trackRefs = ev.tags
      .filter(t => t[0] === 'a' && !!this.utilities.parseMusicTrackCoordinate(t[1]))
      .map(t => t[1]);

    if (trackRefs.length === 0) {
      this.snackBar.open('Playlist is empty', 'Close', { duration: 2000 });
      return;
    }

    this.isLoadingTracks.set(true);

    try {
      const trackKeys: { kind: number; author: string; dTag: string }[] = [];
      for (const ref of trackRefs) {
        const coordinate = this.utilities.parseMusicTrackCoordinate(ref);
        if (coordinate) {
          trackKeys.push({
            kind: coordinate.kind,
            author: coordinate.pubkey,
            dTag: coordinate.identifier,
          });
        }
      }

      if (trackKeys.length === 0) {
        this.snackBar.open('Playlist is empty', 'Close', { duration: 2000 });
        return;
      }

      const trackMap = new Map<string, Event>();

      await Promise.all(trackKeys.map(async (trackKey) => {
        const cached = await this.database.getParameterizedReplaceableEvent(trackKey.author, trackKey.kind, trackKey.dTag);
        if (!cached) return;
        const key = `${trackKey.kind}:${trackKey.author}:${trackKey.dTag}`;
        const existing = trackMap.get(key);
        if (!existing || existing.created_at < cached.created_at) {
          trackMap.set(key, cached);
        }
      }));

      const missingTrackKeys = trackKeys.filter(k => !trackMap.has(`${k.kind}:${k.author}:${k.dTag}`));

      if (missingTrackKeys.length > 0) {
        const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
        if (relayUrls.length > 0) {
          const uniqueAuthors = [...new Set(missingTrackKeys.map(k => k.author))];
          const uniqueDTags = [...new Set(missingTrackKeys.map(k => k.dTag))];
          const missingKeysSet = new Set(missingTrackKeys.map(k => `${k.kind}:${k.author}:${k.dTag}`));

          const filter: Filter = {
            kinds: [...UtilitiesService.MUSIC_KINDS],
            authors: uniqueAuthors,
            '#d': uniqueDTags,
            limit: missingTrackKeys.length * 2,
          };

          const fetchedTracks = await this.pool.query(relayUrls, filter, 5000);
          for (const trackEvent of fetchedTracks) {
            const dTag = trackEvent.tags.find(t => t[0] === 'd')?.[1] || '';
            const key = `${trackEvent.kind}:${trackEvent.pubkey}:${dTag}`;

            if (!missingKeysSet.has(key)) {
              continue;
            }

            const existing = trackMap.get(key);
            if (!existing || existing.created_at < trackEvent.created_at) {
              trackMap.set(key, trackEvent);
            }
          }
        }
      }

      if (trackMap.size === 0) {
        this.snackBar.open('Could not load tracks', 'Close', { duration: 3000 });
        return;
      }

      // Sort tracks according to playlist order
      const orderedTracks: Event[] = [];
      for (const ref of trackRefs) {
        const coordinate = this.utilities.parseMusicTrackCoordinate(ref);
        if (coordinate) {
          const key = `${coordinate.kind}:${coordinate.pubkey}:${coordinate.identifier}`;
          const track = trackMap.get(key);
          if (track && !orderedTracks.includes(track)) {
            orderedTracks.push(track);
          }
        }
      }

      // Get artist name from playlist author
      const profile = this.authorProfile();
      const playlistArtistName = profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';

      // Resolve profiles for tracks from different authors
      const uniquePubkeys = [...new Set(orderedTracks.map(t => t.pubkey))];
      const profileMap = new Map<string, string>();
      await Promise.all(uniquePubkeys.map(async (pk) => {
        const p = await this.data.getProfile(pk);
        if (p?.data?.name || p?.data?.display_name) {
          profileMap.set(pk, p.data.name || p.data.display_name);
        }
      }));

      this.mediaPlayer.clearQueue();

      // Play tracks
      for (let i = 0; i < orderedTracks.length; i++) {
        const track = orderedTracks[i];
        const url = this.utilities.getUrlWithImetaFallback(track);
        if (!url) continue;

        const titleTag = track.tags.find(t => t[0] === 'title');
        const imageTag = track.tags.find(t => t[0] === 'image');
        const videoTag = track.tags.find(t => t[0] === 'video');
        const trackDTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

        const trackArtist = this.utilities.getMusicArtist(track);
        const mediaItem: MediaItem = {
          source: url,
          title: titleTag?.[1] || 'Untitled Track',
          artist: trackArtist || profileMap.get(track.pubkey) || playlistArtistName,
          artwork: imageTag?.[1] || '/icons/icon-192x192.png',
          video: videoTag?.[1] || undefined,
          type: 'Music',
          eventPubkey: track.pubkey,
          eventIdentifier: trackDTag,
          lyrics: this.utilities.extractLyricsFromEvent(track),
        };

        if (i === 0) {
          this.mediaPlayer.play(mediaItem);
        } else {
          this.mediaPlayer.enque(mediaItem);
        }
      }
    } catch (error) {
      console.error('Error playing playlist:', error);
      this.snackBar.open('Error playing playlist', 'Close', { duration: 3000 });
    } finally {
      this.isLoadingTracks.set(false);
    }
  }
}
