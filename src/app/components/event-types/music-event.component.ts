import { ChangeDetectionStrategy, Component, computed, input, inject, signal, effect, untracked, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { ReactionService } from '../../services/reaction.service';
import { MusicBookmarkPlaylistService, MusicBookmarkPlaylist } from '../../services/music-bookmark-playlist.service';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { EventService } from '../../services/event';
import { UtilitiesService } from '../../services/utilities.service';
import { ZapService } from '../../services/zap.service';
import { OfflineMusicService } from '../../services/offline-music.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { MusicLikedSongsService } from '../../services/music-liked-songs.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../share-article-dialog/share-article-dialog.component';
import { CreateMusicBookmarkPlaylistDialogComponent, CreateMusicBookmarkPlaylistDialogData } from '../../pages/music/create-music-bookmark-playlist-dialog/create-music-bookmark-playlist-dialog.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../../pages/music/music-track-dialog/music-track-dialog.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-music-event',
  imports: [MatIconModule, MatButtonModule, MatMenuModule, MatDividerModule, MatSnackBarModule, MatProgressSpinnerModule, MatChipsModule, MusicTrackDialogComponent, CreateMusicBookmarkPlaylistDialogComponent, UserProfileComponent, DateToggleComponent],
  template: `
    <!-- Card mode: Vertical layout for grid views -->
    @if (mode() === 'card') {
      <div class="music-card-vertical">
        
        <!-- Cover image/placeholder -->
        <div class="card-cover" [style.background]="gradient() || ''" (click)="playTrack($any($event))"
          (keydown.enter)="playTrack($any($event))" (keydown.space)="playTrack($any($event))" tabindex="0" role="button"
          [attr.aria-label]="'Play ' + (title() || 'track')">
          @if (image() && !gradient()) {
            <img [src]="image()" [alt]="title()" class="cover-image" loading="lazy" />
          } @else if (!gradient()) {
            <div class="cover-placeholder">
              <mat-icon>music_note</mat-icon>
            </div>
          }
          @if (isAiGenerated()) {
            <span class="ai-badge">AI</span>
          }
          @if (isOffline()) {
            <span class="offline-badge" title="Available offline">
              <mat-icon>offline_pin</mat-icon>
            </span>
          }
          
          <!-- Hover actions -->
          <button mat-icon-button class="play-overlay media-action-button media-primary-action" (click)="playTrack($any($event))"
            [attr.aria-label]="isCurrentTrackPlaying() ? 'Pause track' : 'Play now'"
            [title]="isCurrentTrackPlaying() ? 'Pause' : 'Play Now'">
            <mat-icon>{{ isCurrentTrackPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>
          <div class="hover-action-row">
            <button mat-icon-button class="media-action-button like-action" [class.is-liked]="isLiked()"
              (click)="likeTrack($any($event))" [disabled]="isLiking()" [attr.aria-label]="isLiked() ? 'Unlike track' : 'Like track'"
              [title]="isLiked() ? 'Unlike' : 'Like'">
              <mat-icon [class.is-liked]="isLiked()">{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
            </button>
            <button mat-icon-button class="media-action-button share-action" (click)="shareTrack(); $event.stopPropagation()"
              aria-label="Share track" title="Share track">
              <mat-icon>share</mat-icon>
            </button>
            <button mat-icon-button class="media-action-button zap-action" (click)="zapArtist($any($event))"
              aria-label="Zap creator" title="Zap creator">
              <mat-icon>bolt</mat-icon>
            </button>
          </div>
        </div>
        
        <!-- Info section -->
        <div class="card-info" (click)="openDetails($any($event))" (keydown.enter)="openDetails($any($event))"
          (keydown.space)="openDetails($any($event))" tabindex="0" role="button" [attr.aria-label]="'View ' + title()">
          <div class="card-title-row">
            <span class="card-title">{{ title() || 'Untitled Track' }}</span>
            <button mat-icon-button class="menu-btn" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <span class="card-artist" (click)="openArtist($any($event))" (keydown.enter)="openArtist($any($event))" 
            tabindex="0" role="link">{{ artistName() }}</span>
        </div>
      </div>
    } @else if (mode() === 'track-list') {
      <div class="music-track-row" (click)="playTrack($any($event))" (keydown.enter)="playTrack($any($event))"
        (keydown.space)="playTrack($any($event))" tabindex="0" role="button" [attr.aria-label]="'Play ' + (title() || 'track')">
        <div class="track-row-leading" [class.has-track-number]="trackNumber() !== null">
          @if (trackNumber() !== null) {
            <span class="track-row-number">{{ trackNumber() }}</span>
          }

          <button mat-icon-button class="track-row-play" (click)="playTrack($any($event))"
            [attr.aria-label]="isCurrentTrackPlaying() ? 'Pause track' : 'Play now'"
            [title]="isCurrentTrackPlaying() ? 'Pause' : 'Play Now'">
            <mat-icon>{{ isCurrentTrackPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>
        </div>

        <div class="track-row-cover" [style.background]="gradient() || ''">
          @if (image() && !gradient()) {
            <img [src]="image()" [alt]="title()" class="cover-image" loading="lazy" />
          } @else if (!gradient()) {
            <div class="cover-placeholder">
              <mat-icon>music_note</mat-icon>
            </div>
          }
        </div>

        <div class="track-row-main">
          <div class="track-row-heading">
            <button type="button" class="track-row-title-link" (click)="openDetails($any($event))"
              (keydown.enter)="openDetails($any($event))">
              <span class="track-row-title">{{ title() || 'Untitled Track' }}</span>
            </button>
            @if (isAiGenerated()) {
              <span class="track-row-badge">AI</span>
            }
            @if (isOffline()) {
              <span class="track-row-status" title="Available offline">
                <mat-icon>offline_pin</mat-icon>
              </span>
            }
          </div>

          <button type="button" class="track-row-artist" (click)="openArtist($any($event))"
            (keydown.enter)="openArtist($any($event))">
            {{ artistName() }}
          </button>
        </div>

        <div class="track-row-meta">
          @if (isLiked()) {
            <span class="track-row-liked" title="Liked">
              <mat-icon>favorite</mat-icon>
            </span>
          }
          @if (album()) {
            <span class="track-row-album">
              <span class="track-row-album-text">{{ album() }}</span>
            </span>
          }
          <span class="track-row-duration" [class.is-empty]="!duration()">{{ duration() || '' }}</span>
        </div>

        <button mat-icon-button class="track-row-menu" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
          <mat-icon>more_horiz</mat-icon>
        </button>
      </div>
    } @else {
      <!-- List mode: Horizontal compact layout for embedding -->
      <div class="music-card" (click)="openDetails($any($event))" (keydown.enter)="openDetails($any($event))" tabindex="0" role="button"
        [attr.aria-label]="'View ' + title()">
        
        <!-- Cover image/placeholder -->
        <div class="music-cover" [style.background]="gradient() || ''">
          @if (image() && !gradient()) {
            <img [src]="image()" [alt]="title()" class="cover-image" loading="lazy" />
          } @else if (!gradient()) {
            <div class="cover-placeholder">
              <mat-icon>music_note</mat-icon>
            </div>
          }
          @if (isAiGenerated()) {
            <span class="ai-badge">AI</span>
          }
          @if (isOffline()) {
            <span class="offline-badge" title="Available offline">
              <mat-icon>offline_pin</mat-icon>
            </span>
          }
        </div>
        
        <!-- Info section -->
        <div class="music-info">
          <app-user-profile [pubkey]="event().pubkey" mode="list"></app-user-profile>
          <span class="music-title">{{ title() || 'Untitled Track' }}</span>
          <div class="music-meta">
            <app-date-toggle [date]="event().created_at"></app-date-toggle>
            @if (duration()) {
              <span class="music-duration">{{ duration() }}</span>
            }
            @if (hashtags().length > 0) {
              <mat-chip-set>
                @for (hashtag of hashtags().slice(0, 3); track hashtag) {
                  <mat-chip>{{ hashtag }}</mat-chip>
                }
              </mat-chip-set>
            }
          </div>
        </div>
        
        <!-- Action buttons -->
        <div class="music-actions">
          <button mat-icon-button class="play-btn" (click)="playTrack($any($event))" 
            [attr.aria-label]="isCurrentTrackPlaying() ? 'Pause track' : 'Play now'"
            [title]="isCurrentTrackPlaying() ? 'Pause' : 'Play Now'">
            <mat-icon>{{ isCurrentTrackPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
            <mat-icon>more_vert</mat-icon>
          </button>
        </div>
      </div>
    }
    
    <!-- Shared menu for both modes -->
    <mat-menu #menu="matMenu">

      <button mat-menu-item (click)="playTrack($any($event))">
        <mat-icon>{{ isCurrentTrackPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
        <span>{{ isCurrentTrackPlaying() ? 'Pause' : 'Play Now' }}</span>
      </button>
      <button mat-menu-item (click)="addToQueue()">
        <mat-icon>queue_music</mat-icon>
        <span>Add to Queue</span>
      </button>
            @if (isAuthenticated()) {
        <button mat-menu-item [matMenuTriggerFor]="playlistMenu" (click)="loadPlaylists()">
          <mat-icon>playlist_add</mat-icon>
          <span>Add to Playlist</span>
        </button>
      }
      <mat-divider></mat-divider>
      @if (isAuthenticated()) {
        <button mat-menu-item (click)="likeTrack($any($event))" [disabled]="isLiking()">
          <mat-icon>{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
          <span>{{ isLiked() ? 'Unlike' : 'Like' }}</span>
        </button>
      }

      <button mat-menu-item (click)="shareTrack()">
        <mat-icon>share</mat-icon>
        <span>Share</span>
      </button>
      @if (isAuthenticated()) {
        <button mat-menu-item (click)="zapArtist($any($event))">
          <mat-icon>bolt</mat-icon>
          <span>Zap Creator</span>
        </button>
      }

      <mat-divider></mat-divider>
        @if (isOwnTrack()) {
        <button mat-menu-item (click)="editTrack()">
          <mat-icon>edit</mat-icon>
          <span>Edit Track</span>
        </button>
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
    <mat-menu #playlistMenu="matMenu">
      <button mat-menu-item (click)="createNewPlaylist()">
        <mat-icon>add</mat-icon>
        <span>New Playlist</span>
      </button>
      @if (playlistsLoading()) {
        <div class="playlist-loading">
          <mat-spinner diameter="20"></mat-spinner>
          <span>Loading playlists...</span>
        </div>
      } @else {
        @for (playlist of userPlaylists(); track playlist.id) {
          <button mat-menu-item (click)="addToPlaylist(playlist.id)">
            <mat-icon>queue_music</mat-icon>
            <span>{{ playlist.title }}</span>
          </button>
        }
        @if (userPlaylists().length === 0) {
          <div class="no-playlists">
            <span>No playlists yet</span>
          </div>
        }
      }
    </mat-menu>
    
    @if (showEditDialog() && editDialogData()) {
      <app-music-track-dialog
        [data]="editDialogData()!"
        (closed)="onEditDialogClosed($event)"
      />
    }
    @if (showCreatePlaylistDialog() && createPlaylistDialogData()) {
      <app-create-music-bookmark-playlist-dialog
        [data]="createPlaylistDialogData()!"
        (closed)="onCreatePlaylistDialogClosed($event)"
      />
    }
  `,
  styles: [`
    /* ========== Card Mode (Vertical) ========== */
    .music-card-vertical {
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      background-color: var(--mat-sys-surface-container-low);
      overflow: hidden;
      min-width: 0;
      transition: background-color 0.2s ease, transform 0.2s ease;
      
        &:hover {
          background-color: var(--mat-sys-surface-container);
          
          .play-overlay,
          .hover-action-row {
            opacity: 1;
          }

          .play-overlay {
            transform: translate(-50%, -50%) scale(1);
          }

          .hover-action-row {
            transform: translate(-50%, 0);
          }
        }

        &:focus-within {
          .play-overlay,
          .hover-action-row {
            opacity: 1;
          }

          .play-overlay {
            transform: translate(-50%, -50%) scale(1);
          }

          .hover-action-row {
            transform: translate(-50%, 0);
          }
        }

      @media (max-width: 600px) {
        border-radius: 8px;
        
        &:hover {
          transform: none;
        }
      }
      
      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }
    
    .card-cover {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);
      border-radius: 8px 8px 0 0;

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

      .music-card-vertical:hover &::after,
      .music-card-vertical:focus-within &::after {
        opacity: 1;
      }
      
      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.28s ease;
      }

      .music-card-vertical:hover & .cover-image,
      .music-card-vertical:focus-within & .cover-image {
        transform: scale(1.05);
      }
      
      .cover-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        
        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.5;
        }
      }
      
      .ai-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 0.6rem;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        z-index: 2;
      }

      .offline-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
        
        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }
      
      .play-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 64px;
        height: 64px;
        opacity: 0;
        transform: translate(-50%, -44%) scale(0.92);
        transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
        border-radius: 50%;
        z-index: 2;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;

        @media (max-width: 600px) {
          width: 56px;
          height: 56px;
        }
        
        &:hover {
          transform: translate(-50%, -50%) scale(1.04);
        }
        
        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;

          @media (max-width: 600px) {
            font-size: 28px;
            width: 28px;
            height: 28px;
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
    
    .card-info {
      padding: 0.5rem 0.625rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
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
      
      .card-title-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        min-width: 0;
        
        .card-title {
          display: block;
          flex: 1;
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.3;
          color: var(--mat-sys-on-surface);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        
        .menu-btn {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          padding: 0;
          margin: -2px -4px -2px 0;
          opacity: 0.6;
          transition: opacity 0.2s ease;
          
          mat-icon {
            font-size: 1.125rem;
            width: 1.125rem;
            height: 1.125rem;
          }
          
          &:hover {
            opacity: 1;
          }
        }
      }
      
      .card-artist {
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        
        &:hover {
          color: var(--mat-sys-primary);
          text-decoration: underline;
        }
      }
    }
    
    /* ========== Track List Mode (Songs page) ========== */
    .music-track-row {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 78%, transparent);
      transition: background-color 0.15s ease;

      &:hover {
        background: color-mix(in srgb, var(--mat-sys-surface-container-high) 38%, transparent);
      }

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }

    .track-row-number {
      display: block;
      width: 100%;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8125rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
      transform: translateX(-10px);
      transition: opacity 0.15s ease;
    }

    .track-row-leading {
      position: relative;
      flex: 0 0 2rem;
      width: 2rem;
      min-width: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;

      &.has-track-number .track-row-play {
        position: absolute;
        inset: 50% auto auto 50%;
        transform: translate(-50%, -50%);
        opacity: 0;
        pointer-events: none;
      }
    }

    .music-track-row:hover .track-row-leading.has-track-number .track-row-play,
    .music-track-row:focus-within .track-row-leading.has-track-number .track-row-play {
      opacity: 1;
      pointer-events: auto;
    }

    .music-track-row:hover .track-row-leading.has-track-number .track-row-number,
    .music-track-row:focus-within .track-row-leading.has-track-number .track-row-number {
      opacity: 0;
    }

    .track-row-play,
    .track-row-menu {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      padding: 0 !important;
      display: flex !important;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .track-row-play {
      width: 30px;
      height: 30px;
      background: var(--mat-sys-surface-container);
      border: 1px solid color-mix(in srgb, var(--mat-sys-outline) 26%, transparent);
      transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
      color: var(--mat-sys-on-surface);

      &:hover {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
        border-color: color-mix(in srgb, var(--mat-sys-primary) 40%, transparent);
      }
    }

    .track-row-cover {
      position: relative;
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: var(--mat-sys-corner-extra-small);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cover-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.7;
        }
      }
    }

    .track-row-main {
      flex: 1 1 180px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .track-row-heading {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 0;
    }

    .track-row-title-link {
      min-width: 0;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;

      &:hover .track-row-title {
        color: var(--mat-sys-primary);
        text-decoration: underline;
      }
    }

    .track-row-title {
      display: block;
      margin: 0;
      font-size: 1rem;
      line-height: 1.2;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-row-badge {
      flex-shrink: 0;
      padding: 2px 6px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-size: 0.625rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .track-row-status {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .track-row-artist {
      width: fit-content;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;

      &:hover {
        color: var(--mat-sys-primary);
        text-decoration: underline;
      }
    }

    .track-row-meta {
      flex: 0 1 auto;
      max-width: min(32vw, 340px);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      min-width: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8125rem;
    }

    :host-context(.dual-panel-layout.has-right-content) .track-row-meta {
      max-width: 10.5rem;
    }

    .track-row-album {
      flex: 1 1 180px;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.25rem;
      overflow: hidden;
    }

    .track-row-album-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: right;
    }

    .track-row-duration {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      min-width: 3.25rem;
      text-align: right;

      &.is-empty {
        visibility: hidden;
      }
    }

    .track-row-liked {
      flex-shrink: 0;
      width: 1rem;
      height: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-error);

      mat-icon {
        font-size: 0.95rem;
        width: 0.95rem;
        height: 0.95rem;
      }
    }

    .track-row-menu {
      color: var(--mat-sys-on-surface-variant);
    }

    @media (max-width: 780px) {
      .track-row-leading {
        display: none;
      }

      .track-row-meta {
        flex: 0 0 3.25rem;
      }
    }

    @media (max-width: 520px) {
      .music-track-row {
        padding: 0.4rem 0.5rem;
        gap: 0.5rem;
      }

      .track-row-leading {
        flex-basis: 1.75rem;
        width: 1.75rem;
        min-width: 1.75rem;
      }

      .track-row-number {
        font-size: 0.75rem;
      }

      .track-row-cover {
        width: 32px;
        height: 32px;
        min-width: 32px;
      }

      .track-row-meta {
        flex: 0 0 3rem;
        gap: 0;
        font-size: 0.625rem;
      }
    }

    /* ========== List Mode (Horizontal) ========== */
    .music-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin: 0.5rem 0;
      cursor: pointer;
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background-color: var(--mat-sys-surface-container-low);
      transition: background-color 0.2s ease;
      
      &:hover {
        background-color: var(--mat-sys-surface-container);
      }
      
      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }
    
    .music-cover {
      position: relative;
      width: 64px;
      height: 64px;
      min-width: 64px;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);
      
      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .cover-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        
        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.7;
        }
      }
      
      .ai-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 0.5rem;
        padding: 1px 4px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .offline-badge {
        position: absolute;
        top: 4px;
        left: 4px;
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        
        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          opacity: 1;
        }
      }
    }
    
    .music-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      
      app-user-profile {
        margin-bottom: 4px;
      }
      
      .music-title {
        display: block;
        margin: 0;
        font-size: 1rem;
        line-height: 1.3;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .music-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
        flex-wrap: wrap;
        
        app-date-toggle {
          font-size: 0.75rem;
          color: var(--mat-sys-on-surface-variant);
        }
        
        .music-duration {
          font-size: 0.75rem;
          color: var(--mat-sys-on-surface-variant);
          font-variant-numeric: tabular-nums;
          
          &::before {
            content: '•';
            margin-right: 8px;
          }
        }
        
        mat-chip-set {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          
          mat-chip {
            --mdc-chip-container-height: 20px;
            --mdc-chip-label-text-size: 0.7rem;
          }
        }
      }
    }
    
    .music-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      
      .play-btn {
        color: var(--mat-sys-primary);
        background-color: var(--mat-sys-primary-container);
        
        &:hover {
          background-color: var(--mat-sys-primary);
          color: var(--mat-sys-on-primary);
        }
      }
    }

    .playlist-loading, .no-playlists {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicEventComponent implements OnDestroy {
  private router = inject(Router);
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);
  private reactionService = inject(ReactionService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private musicPlaylistService = inject(MusicBookmarkPlaylistService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private eventService = inject(EventService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);
  private utilities = inject(UtilitiesService);
  private zapService = inject(ZapService);
  private offlineMusicService = inject(OfflineMusicService);
  private imageCache = inject(ImageCacheService);
  private logger = inject(LoggerService);
  private customDialog = inject(CustomDialogService);
  private userRelaysService = inject(UserRelaysService);
  private likedSongsService = inject(MusicLikedSongsService);

  private likeLookupRequestId = 0;
  private destroyed = false;

  event = input.required<Event>();
  mode = input<'card' | 'list' | 'track-list'>('list');
  trackNumber = input<string | null>(null);
  queueTracks = input<Event[] | null>(null);
  queueTrackIndex = input<number | null>(null);

  authorProfile = signal<NostrRecord | undefined>(undefined);
  userPlaylists = this.musicPlaylistService.userPlaylists;
  playlistsLoading = this.musicPlaylistService.loading;
  isAuthenticated = computed(() => this.app.authenticated());

  // Edit dialog state
  showEditDialog = signal(false);
  editDialogData = signal<MusicTrackDialogData | null>(null);

  // Create playlist dialog signals
  showCreatePlaylistDialog = signal(false);
  createPlaylistDialogData = signal<CreateMusicBookmarkPlaylistDialogData | null>(null);

  // Check if this is the current user's track
  isOwnTrack = computed(() => {
    const ev = this.event();
    const userPubkey = this.accountState.pubkey();
    return ev && userPubkey && ev.pubkey === userPubkey;
  });

  // Check if track is available offline
  isOffline = computed(() => {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    return this.offlineMusicService.isTrackOffline(ev.pubkey, dTag);
  });

  private profileLoaded = false;

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

    // Keep per-track like state synced so menu can render Like/Unlike correctly.
    effect(() => {
      const ev = this.event();
      const userPubkey = this.accountState.pubkey();
      if (!ev || !userPubkey) {
        this.likedReaction.set(null);
        return;
      }

      untracked(() => {
        void this.likedSongsService.ensureInitialized(userPubkey);
        this.checkExistingLike(ev, userPubkey);
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.likeLookupRequestId++;
  }

  // Extract d-tag identifier
  identifier = computed(() => {
    const event = this.event();
    const dTag = event.tags.find(t => t[0] === 'd');
    return dTag?.[1] || '';
  });

  // Get npub for artist
  artistNpub = computed(() => {
    const event = this.event();
    try {
      return nip19.npubEncode(event.pubkey);
    } catch {
      return event.pubkey;
    }
  });

  // Extract title from tags
  title = computed(() => {
    const event = this.event();
    return this.utilities.getMusicTitle(event) || null;
  });

  album = computed(() => {
    const event = this.event();
    return event.tags.find(t => t[0] === 'album')?.[1] || null;
  });

  // Extract audio URL
  audioUrl = computed(() => {
    const event = this.event();
    return this.utilities.getMusicAudioUrl(event) || '';
  });

  // Extract cover image (raw URL for media player)
  rawImage = computed(() => {
    const event = this.event();
    return this.utilities.getMusicImage(event) || null;
  });

  // Extract cover image (proxied for display to reduce image size)
  image = computed(() => {
    const rawUrl = this.rawImage();
    if (!rawUrl) return null;
    // Use 200x200 for card display (covers both card and list modes)
    return this.imageCache.getOptimizedImageUrlWithSize(rawUrl, 200, 200);
  });

  // Check if AI generated
  isAiGenerated = computed(() => {
    const event = this.event();
    return this.utilities.isMusicAiGenerated(event);
  });

  // Get gradient background (alternative to image)
  gradient = computed(() => {
    const event = this.event();
    return this.utilities.getMusicGradient(event);
  });

  // Extract hashtags from t tags (excluding common tags like 'music')
  hashtags = computed(() => {
    const event = this.event();
    return event.tags
      .filter(t => t[0] === 't' && t[1])
      .map(t => t[1])
      .filter(tag => tag.toLowerCase() !== 'music'); // Filter out 'music' tag
  });

  // Extract duration from tags
  duration = computed(() => {
    const event = this.event();
    const durationSeconds = this.utilities.getMusicDuration(event) ?? null;

    if (!durationSeconds) return null;

    // Format as MM:SS or HH:MM:SS
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  });

  // Track liked state hydrated from relays and updated locally on like/unlike.
  private likedReaction = signal<Event | null>(null);
  isLiked = computed(() => this.likedSongsService.isTrackLiked(this.event()));
  /**
   * Set while a like/unlike is in-flight to prevent rapid double-taps from
   * immediately toggling a freshly published reaction into a delete event
   * before the new state is reflected locally.
   */
  isLiking = signal(false);

  private getReactionCacheKey(track: Event, userPubkey: string): string {
    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
    return `${userPubkey}:${track.kind}:${track.pubkey}:${dTag}`;
  }

  private async checkExistingLike(track: Event, userPubkey: string): Promise<void> {
    const requestId = ++this.likeLookupRequestId;

    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';
    if (!dTag) {
      this.likedReaction.set(null);
      return;
    }

    const aTagValue = `${track.kind}:${track.pubkey}:${dTag}`;
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      this.likedReaction.set(null);
      return;
    }

    const filter: Filter = {
      kinds: [kinds.Reaction],
      authors: [userPubkey],
      '#a': [aTagValue],
      limit: 10,
    };

    const reactions = await this.pool.query(relayUrls, filter, 2500).catch(() => []);
    let matchedLike: Event | null = null;
    for (const reaction of reactions) {
      if (reaction.content !== '+') {
        continue;
      }

      if (!matchedLike || reaction.created_at > matchedLike.created_at) {
        matchedLike = reaction;
      }
    }

    if (this.destroyed || requestId !== this.likeLookupRequestId) {
      return;
    }

    this.likedReaction.set(matchedLike);
  }

  isCurrentTrackPlaying = computed(() => {
    const currentItem = this.mediaPlayer.current();
    const currentSource = this.audioUrl();

    if (!currentItem || currentItem.type !== 'Music' || !currentSource || this.mediaPlayer.paused) {
      return false;
    }

    const sameEvent = !!this.identifier()
      && currentItem.eventIdentifier === this.identifier()
      && currentItem.eventPubkey === this.artistNpub();

    return sameEvent || currentItem.source === currentSource;
  });

  // Get artist name from event tag first, then profile as fallback
  artistName = computed(() => {
    const event = this.event();
    // First check if artist tag exists in the event
    const artistTag = this.utilities.getMusicArtist(event);
    if (artistTag) {
      return artistTag;
    }
    // Fallback to profile name
    const profile = this.authorProfile();
    return profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';
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

  // Open song details page in right panel
  openDetails(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
    }
    event.stopPropagation();
    const ev = this.event();
    const id = this.identifier();
    if (ev.pubkey && id) {
      this.layout.openSongDetail(ev.pubkey, id, ev);
    }
  }

  // Open artist page in right panel
  openArtist(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
    }
    event.stopPropagation();
    const npub = this.artistNpub();
    if (npub) {
      this.layout.openMusicArtist(npub);
    }
  }

  // Play track in media player
  async playTrack(event: MouseEvent | KeyboardEvent): Promise<void> {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
    }
    event.stopPropagation();

    const currentItem = this.mediaPlayer.current();
    const currentSource = this.audioUrl();
    const sameCurrentTrack = !!currentItem
      && currentItem.type === 'Music'
      && (
        (!!this.identifier()
          && currentItem.eventIdentifier === this.identifier()
          && currentItem.eventPubkey === this.artistNpub())
        || (!!currentSource && currentItem.source === currentSource)
      );

    if (sameCurrentTrack) {
      if (this.mediaPlayer.paused) {
        void this.mediaPlayer.resume();
      } else {
        this.mediaPlayer.pause();
      }
      return;
    }

    const url = this.audioUrl();
    if (!url) {
      this.logger.warn('No audio URL found for track');
      return;
    }

    const queuedPlayback = await this.buildQueuedPlayback();
    if (queuedPlayback) {
      this.mediaPlayer.replaceQueue(queuedPlayback.items, queuedPlayback.startIndex);
      return;
    }

    const mediaItem = await this.buildMediaItem(this.event());
    if (!mediaItem) {
      this.logger.warn('No audio URL found for track');
      return;
    }

    this.mediaPlayer.play(mediaItem);
  }

  private async buildQueuedPlayback(): Promise<{ items: MediaItem[]; startIndex: number } | null> {
    const queueTracks = this.queueTracks();
    const queueTrackIndex = this.queueTrackIndex();

    if (!queueTracks || queueTrackIndex === null || queueTrackIndex < 0 || queueTrackIndex >= queueTracks.length) {
      return null;
    }

    const results = await Promise.all(
      queueTracks.map(async (track, originalIndex) => ({
        originalIndex,
        mediaItem: await this.buildMediaItem(track),
      }))
    );

    const queueEntries = results
      .filter((entry): entry is { originalIndex: number; mediaItem: MediaItem } => !!entry.mediaItem);

    const startIndex = queueEntries.findIndex(entry => entry.originalIndex === queueTrackIndex);
    if (startIndex === -1) {
      return null;
    }

    return {
      items: queueEntries.map(entry => entry.mediaItem),
      startIndex,
    };
  }

  private async buildMediaItem(track: Event): Promise<MediaItem | null> {
    const url = this.utilities.getMusicAudioUrl(track);
    if (!url) {
      return null;
    }

    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';

    let artist = this.utilities.getMusicArtist(track);
    if (!artist) {
      try {
        const profile = await this.data.getProfile(track.pubkey);
        artist = profile?.data?.display_name || profile?.data?.name || 'Unknown Artist';
      } catch {
        artist = 'Unknown Artist';
      }
    }

    return {
      source: url,
      title: this.utilities.getMusicTitle(track) || 'Untitled Track',
      artist: artist || 'Unknown Artist',
      artwork: this.utilities.getMusicImage(track) || '/icons/icon-192x192.png',
      video: track.tags.find(tag => tag[0] === 'video')?.[1] || undefined,
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
      eventKind: track.kind,
      lyrics: this.utilities.extractLyricsFromEvent(track),
    };
  }

  // Add track to queue
  async addToQueue(): Promise<void> {
    const mediaItem = await this.buildMediaItem(this.event());
    if (!mediaItem) {
      this.snackBar.open('No audio URL found', 'Close', { duration: 3000 });
      return;
    }

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  // Like the track
  async likeTrack(event: MouseEvent | KeyboardEvent): Promise<void> {
    event.stopPropagation();

    if (this.isLiking()) {
      return;
    }

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const ev = this.event();

    this.isLiking.set(true);
    try {
      if (this.isLiked()) {
        const existingReaction = this.likedReaction();
        const result = existingReaction
          ? await this.reactionService.deleteReaction(existingReaction)
          : await this.reactionService.deleteLikeForTarget(ev);
        if (result.success) {
          this.likedReaction.set(null);
          this.snackBar.open('Like removed', 'Close', { duration: 2000 });
        } else {
          this.snackBar.open('Failed to remove like', 'Close', { duration: 3000 });
        }
        return;
      }

      const result = await this.reactionService.addLike(ev);
      if (result.success) {
        const reactionEvent = result.event ?? null;
        this.likedReaction.set(reactionEvent);
        this.snackBar.open('Liked!', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Failed to like', 'Close', { duration: 3000 });
      }
    } finally {
      this.isLiking.set(false);
    }
  }

  // Zap the artist
  zapArtist(event: MouseEvent | KeyboardEvent): void {
    void this.openZapDialogForArtist(event);
  }

  private async openZapDialogForArtist(event: MouseEvent | KeyboardEvent): Promise<void> {
    event.stopPropagation();
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';
    const profile = this.authorProfile();

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

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

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }

  // Copy event link (music song URL)
  copyEventLink(): void {
    void this.copyEventLinkWithRelayHints();
  }

  private async copyEventLinkWithRelayHints(): Promise<void> {
    const ev = this.event();
    const id = this.identifier();
    if (!id) {
      this.snackBar.open('Failed to generate link', 'Close', { duration: 3000 });
      return;
    }

    try {
      const authorRelays = this.utilities.getShareRelayHints(
        await this.userRelaysService.getUserRelaysForPublishing(ev.pubkey)
      );
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: id,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });
      const link = `https://nostria.app/music/song/${naddr}`;
      this.clipboard.copy(link);
      this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
    } catch {
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
  async shareTrack(): Promise<void> {
    const ev = this.event();
    const dTag = this.identifier();
    if (!dTag) {
      this.snackBar.open('Failed to generate share link', 'Close', { duration: 3000 });
      return;
    }

    try {
      const authorRelays = this.utilities.getShareRelayHints(
        await this.userRelaysService.getUserRelaysForPublishing(ev.pubkey)
      );
      const naddr = nip19.naddrEncode({
        kind: ev.kind,
        pubkey: ev.pubkey,
        identifier: dTag,
        relays: authorRelays.length > 0 ? authorRelays : undefined,
      });

      const link = `https://nostria.app/music/song/${naddr}`;
      const title = this.title() || 'Untitled Track';

      const dialogData: ShareArticleDialogData = {
        title,
        summary: `Listen to ${title} by ${this.artistName()}`,
        image: this.rawImage() || undefined,
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
      this.snackBar.open('Failed to share track', 'Close', { duration: 3000 });
    }
  }

  // Edit track (for user's own tracks)
  editTrack(): void {
    const ev = this.event();
    if (!ev || !this.isOwnTrack()) return;

    this.editDialogData.set({ track: ev });
    this.showEditDialog.set(true);
  }

  onEditDialogClosed(result: { published: boolean; updated?: boolean; event?: Event } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated) {
      this.snackBar.open('Track updated', 'Close', { duration: 2000 });
      // Note: The parent component should refresh if needed
    }
  }

  // Load playlists when submenu is opened
  loadPlaylists(): void {
    this.musicPlaylistService.fetchUserPlaylists();
  }

  // Create a new playlist and add this track to it
  createNewPlaylist(): void {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    this.createPlaylistDialogData.set({
      trackPubkey: ev.pubkey,
      trackDTag: dTag,
      trackKind: ev.kind,
    });
    this.showCreatePlaylistDialog.set(true);
  }

  onCreatePlaylistDialogClosed(result: { playlist: MusicBookmarkPlaylist; trackAdded: boolean } | null): void {
    this.showCreatePlaylistDialog.set(false);
    this.createPlaylistDialogData.set(null);
    if (result?.playlist) {
      this.snackBar.open(`Added to "${result.playlist.title}"`, 'Close', { duration: 2000 });
    }
  }

  // Add track to an existing playlist
  async addToPlaylist(playlistId: string): Promise<void> {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    try {
      const success = await this.musicPlaylistService.addTrackToPlaylist(
        playlistId,
        ev.pubkey,
        dTag,
        ev.kind
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
}
