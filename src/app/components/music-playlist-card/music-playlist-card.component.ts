import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
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
import { NostrRecord, MediaItem } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import {
  EditMusicPlaylistDialogComponent,
  EditMusicPlaylistDialogData,
} from '../../pages/music/edit-music-playlist-dialog/edit-music-playlist-dialog.component';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-music-playlist-card',
  imports: [MatIconModule, MatCardModule, MatButtonModule, MatMenuModule, MatSnackBarModule, MatProgressSpinnerModule, EditMusicPlaylistDialogComponent],
  template: `
    <mat-card class="playlist-card" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" 
      tabindex="0" role="button" [attr.aria-label]="'Open playlist ' + title()">
      <div class="playlist-cover" [style.background]="gradient() || ''">
        @if (coverImage() && !gradient()) {
          <img [src]="coverImage()" [alt]="title()" class="cover-image" loading="lazy" />
        } @else if (!gradient()) {
          <div class="cover-placeholder">
            <mat-icon>queue_music</mat-icon>
          </div>
        }
        @if (trackCount() > 0) {
        <button mat-icon-button class="play-btn" (click)="playPlaylist($event)" 
          [disabled]="isLoadingTracks()"
          aria-label="Play playlist">
          @if (isLoadingTracks()) {
            <mat-spinner diameter="24"></mat-spinner>
          } @else {
            <mat-icon>play_arrow</mat-icon>
          }
        </button>
        }
      </div>
      <mat-card-content>
        <div class="playlist-info">
          <div class="playlist-title-row">
            <span class="playlist-title">{{ title() }}</span>
            <button mat-icon-button class="menu-btn" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <span class="playlist-meta">
            {{ trackCount() }} tracks
            @if (isPublic()) {
              <span class="public-badge">
                <mat-icon>public</mat-icon>
                Public
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
          @if (isOwnPlaylist()) {
            <button mat-menu-item (click)="editPlaylist()">
              <mat-icon>edit</mat-icon>
              <span>Edit Playlist</span>
            </button>
          }
          <button mat-menu-item (click)="sharePlaylist()">
            <mat-icon>share</mat-icon>
            <span>Share Playlist</span>
          </button>
          <button mat-menu-item (click)="copyEventLink()">
            <mat-icon>link</mat-icon>
            <span>Copy Event Link</span>
          </button>
          <button mat-menu-item (click)="copyEventData()">
            <mat-icon>data_object</mat-icon>
            <span>Copy Event Data</span>
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
      cursor: pointer;
      transition: transform 0.2s ease, background-color 0.2s ease;
      overflow: hidden;

      &:hover {
        transform: translateY(-2px);

        .play-btn {
          opacity: 1;
          transform: translateY(0);
        }
      }

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .playlist-cover {
      height: 160px;
      overflow: hidden;
      position: relative;

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--mat-sys-tertiary-container) 0%, var(--mat-sys-secondary-container) 100%);

        mat-icon {
          font-size: 4rem;
          width: 4rem;
          height: 4rem;
          color: var(--mat-sys-on-tertiary-container);
          opacity: 0.5;
        }
      }

      .play-btn {
        position: absolute;
        bottom: 8px;
        right: 8px;
        width: 40px;
        height: 40px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        border-radius: 50%;
        box-shadow: var(--mat-sys-level3);

        &:hover:not(:disabled) {
          background-color: var(--mat-sys-primary-container);
          color: var(--mat-sys-on-primary-container);
          transform: scale(1.1);
        }

        &:disabled {
          opacity: 1;
          transform: translateY(0);
        }

        mat-icon {
          font-size: 24px;
          width: 24px;
          height: 24px;
        }

        mat-spinner {
          margin: auto;

          ::ng-deep circle {
            stroke: var(--mat-sys-on-primary) !important;
          }
        }
      }
    }

    mat-card-content {
      padding-top: 0.75rem;
    }

    .playlist-info {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .playlist-title-row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .playlist-title {
      flex: 1;
      font-size: 1rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .menu-btn {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
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
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      align-items: center;
      gap: 0.5rem;

      .public-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;

        mat-icon {
          font-size: 0.875rem;
          width: 0.875rem;
          height: 0.875rem;
        }
      }
    }

    .playlist-description {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.125rem;
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
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);

  event = input.required<Event>();

  authorProfile = signal<NostrRecord | undefined>(undefined);
  isLoadingTracks = signal(false);

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
    return event.tags.filter(t => t[0] === 'a' && t[1]?.startsWith('36787:')).length;
  });

  // Check if public
  isPublic = computed(() => {
    const event = this.event();
    const publicTag = event.tags.find(t => t[0] === 'public');
    return publicTag?.[1] === 'true';
  });

  // Cover image (first track's image or playlist image)
  coverImage = computed(() => {
    const event = this.event();
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Get gradient background (alternative to image)
  gradient = computed(() => {
    const event = this.event();
    const gradientTag = event.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      const colors = gradientTag[2];
      return `linear-gradient(135deg, ${colors})`;
    }
    return null;
  });

  // Track liked state - set after liking
  private _isLiked = signal(false);
  isLiked = this._isLiked.asReadonly();

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

  openPlaylist(): void {
    const event = this.event();
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag) {
      this.router.navigate(['/music/playlist', event.pubkey, dTag]);
    }
  }

  // Like the playlist
  likePlaylist(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    if (this._isLiked()) return;

    const ev = this.event();
    this.reactionService.addLike(ev).then(success => {
      if (success) {
        this._isLiked.set(true);
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

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
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

  // Copy event link (naddr)
  copyEventLink(): void {
    const addr = this.naddr();
    if (addr) {
      const link = `https://nostria.app/a/${addr}`;
      this.clipboard.copy(link);
      this.snackBar.open('Link copied!', 'Close', { duration: 2000 });
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

  // Share playlist as a kind 1 note with reference
  sharePlaylist(): void {
    const addr = this.naddr();

    if (!addr) {
      this.snackBar.open('Failed to generate playlist reference', 'Close', { duration: 3000 });
      return;
    }

    // Create content with nostr: reference to the playlist
    const content = `nostr:${addr}`;

    // Open note editor with the playlist reference
    this.eventService.createNote({ content });
  }

  // Edit playlist
  editPlaylist(): void {
    const ev = this.event();
    const dTag = ev.tags.find(t => t[0] === 'd')?.[1] || '';

    // Get the playlist from the service or create from event
    const playlists = this.musicPlaylistService.userPlaylists();
    let playlist = playlists.find(p => p.id === dTag);

    if (!playlist) {
      // Create playlist object from event
      const titleTag = ev.tags.find(t => t[0] === 'title');
      const descTag = ev.tags.find(t => t[0] === 'description');
      const imageTag = ev.tags.find(t => t[0] === 'image');
      const publicTag = ev.tags.find(t => t[0] === 'public');
      const collaborativeTag = ev.tags.find(t => t[0] === 'collaborative');
      const trackRefs = ev.tags
        .filter(t => t[0] === 'a' && t[1]?.startsWith('36787:'))
        .map(t => t[1]);

      playlist = {
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
    }

    // Use inline dialog instead of MatDialog
    this.editDialogData.set({ playlist });
    this.showEditDialog.set(true);
  }

  // Handle edit dialog closed
  onEditDialogClosed(result: { updated: boolean; playlist?: any } | null): void {
    this.showEditDialog.set(false);
    this.editDialogData.set(null);

    if (result?.updated) {
      this.snackBar.open('Playlist updated', 'Close', { duration: 2000 });
    }
  }

  // Play all tracks in the playlist
  async playPlaylist(clickEvent: MouseEvent | KeyboardEvent): Promise<void> {
    clickEvent.stopPropagation();

    if (this.isLoadingTracks()) return;

    const ev = this.event();
    const trackRefs = ev.tags
      .filter(t => t[0] === 'a' && t[1]?.startsWith(`${MUSIC_KIND}:`))
      .map(t => t[1]);

    if (trackRefs.length === 0) {
      this.snackBar.open('Playlist is empty', 'Close', { duration: 2000 });
      return;
    }

    this.isLoadingTracks.set(true);

    try {
      // Parse track references
      const trackKeys: { author: string; dTag: string }[] = [];
      for (const ref of trackRefs) {
        const parts = ref.split(':');
        if (parts.length >= 3) {
          trackKeys.push({ author: parts[1], dTag: parts.slice(2).join(':') });
        }
      }

      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      if (relayUrls.length === 0) {
        this.snackBar.open('No relays available', 'Close', { duration: 3000 });
        return;
      }

      // Fetch tracks
      const trackMap = new Map<string, Event>();
      const uniqueAuthors = [...new Set(trackKeys.map(k => k.author))];
      const uniqueDTags = [...new Set(trackKeys.map(k => k.dTag))];

      const filter: Filter = {
        kinds: [MUSIC_KIND],
        authors: uniqueAuthors,
        '#d': uniqueDTags,
        limit: trackKeys.length * 2,
      };

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);

        const sub = this.pool.subscribe(relayUrls, filter, (trackEvent: Event) => {
          const dTag = trackEvent.tags.find(t => t[0] === 'd')?.[1] || '';
          const uniqueId = `${trackEvent.pubkey}:${dTag}`;

          const isInPlaylist = trackKeys.some(k => k.author === trackEvent.pubkey && k.dTag === dTag);
          if (!isInPlaylist) return;

          const existing = trackMap.get(uniqueId);
          if (!existing || existing.created_at < trackEvent.created_at) {
            trackMap.set(uniqueId, trackEvent);
          }

          if (trackMap.size >= trackKeys.length) {
            clearTimeout(timeout);
            sub.close();
            resolve();
          }
        });

        // Also resolve after shorter timeout if we got some tracks
        setTimeout(() => {
          if (trackMap.size > 0) {
            clearTimeout(timeout);
            sub.close();
            resolve();
          }
        }, 3000);
      });

      if (trackMap.size === 0) {
        this.snackBar.open('Could not load tracks', 'Close', { duration: 3000 });
        return;
      }

      // Sort tracks according to playlist order
      const orderedTracks: Event[] = [];
      for (const ref of trackRefs) {
        const parts = ref.split(':');
        if (parts.length >= 3) {
          const author = parts[1];
          const dTag = parts.slice(2).join(':');
          const uniqueId = `${author}:${dTag}`;
          const track = trackMap.get(uniqueId);
          if (track && !orderedTracks.includes(track)) {
            orderedTracks.push(track);
          }
        }
      }

      // Get artist name from playlist author
      const profile = this.authorProfile();
      const artistName = profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';

      // Play tracks
      for (let i = 0; i < orderedTracks.length; i++) {
        const track = orderedTracks[i];
        const urlTag = track.tags.find(t => t[0] === 'url');
        const url = urlTag?.[1];
        if (!url) continue;

        const titleTag = track.tags.find(t => t[0] === 'title');
        const imageTag = track.tags.find(t => t[0] === 'image');
        const trackDTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

        const mediaItem: MediaItem = {
          source: url,
          title: titleTag?.[1] || 'Untitled Track',
          artist: artistName,
          artwork: imageTag?.[1] || '/icons/icon-192x192.png',
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
