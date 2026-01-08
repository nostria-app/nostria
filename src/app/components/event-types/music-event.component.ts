import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { ReactionService } from '../../services/reaction.service';
import { MusicPlaylistService } from '../../services/music-playlist.service';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { EventService } from '../../services/event';
import { UtilitiesService } from '../../services/utilities.service';
import { ZapService } from '../../services/zap.service';
import { OfflineMusicService } from '../../services/offline-music.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { CreateMusicPlaylistDialogComponent, CreateMusicPlaylistDialogData } from '../../pages/music/create-music-playlist-dialog/create-music-playlist-dialog.component';
import { MusicTrackDialogComponent, MusicTrackDialogData } from '../../pages/music/music-track-dialog/music-track-dialog.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';

@Component({
  selector: 'app-music-event',
  imports: [MatIconModule, MatButtonModule, MatMenuModule, MatSnackBarModule, MatProgressSpinnerModule, MatChipsModule, MusicTrackDialogComponent, UserProfileComponent, DateToggleComponent],
  template: `
    <!-- Card mode: Vertical layout for grid views -->
    @if (mode() === 'card') {
      <div class="music-card-vertical" (click)="openDetails($any($event))" (keydown.enter)="openDetails($any($event))" tabindex="0" role="button"
        [attr.aria-label]="'View ' + title()">
        
        <!-- Cover image/placeholder -->
        <div class="card-cover" [style.background]="gradient() || ''">
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
          
          <!-- Play button overlay -->
          <button mat-icon-button class="play-overlay" (click)="playTrack($any($event))" 
            aria-label="Play now" title="Play Now">
            <mat-icon>play_arrow</mat-icon>
          </button>
        </div>
        
        <!-- Info section -->
        <div class="card-info">
          <div class="card-title-row">
            <h4 class="card-title">{{ title() || 'Untitled Track' }}</h4>
            <button mat-icon-button class="menu-btn" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <span class="card-artist" (click)="openArtist($any($event))" (keydown.enter)="openArtist($any($event))" 
            tabindex="0" role="link">{{ artistName() }}</span>
        </div>
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
          <h4 class="music-title">{{ title() || 'Untitled Track' }}</h4>
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
            aria-label="Play now" title="Play Now">
            <mat-icon>play_arrow</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
            <mat-icon>more_vert</mat-icon>
          </button>
        </div>
      </div>
    }
    
    <!-- Shared menu for both modes -->
    <mat-menu #menu="matMenu">
      @if (isOwnTrack()) {
        <button mat-menu-item (click)="editTrack()">
          <mat-icon>edit</mat-icon>
          <span>Edit Track</span>
        </button>
      }
      <button mat-menu-item (click)="playTrack($any($event))">
        <mat-icon>play_arrow</mat-icon>
        <span>Play Now</span>
      </button>
      <button mat-menu-item (click)="addToQueue()">
        <mat-icon>queue_music</mat-icon>
        <span>Add to Queue</span>
      </button>
      <button mat-menu-item (click)="shareTrack()">
        <mat-icon>share</mat-icon>
        <span>Share Track</span>
      </button>
      @if (isAuthenticated()) {
        <button mat-menu-item [matMenuTriggerFor]="playlistMenu" (click)="loadPlaylists()">
          <mat-icon>playlist_add</mat-icon>
          <span>Add to Playlist</span>
        </button>
      }
      <button mat-menu-item (click)="copyEventLink()">
        <mat-icon>link</mat-icon>
        <span>Copy Event Link</span>
      </button>
      <button mat-menu-item (click)="copyEventData()">
        <mat-icon>data_object</mat-icon>
        <span>Copy Event Data</span>
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
  `,
  styles: [`
    /* ========== Card Mode (Vertical) ========== */
    .music-card-vertical {
      display: flex;
      flex-direction: column;
      cursor: pointer;
      border-radius: 12px;
      background-color: var(--mat-sys-surface-container-low);
      overflow: hidden;
      transition: background-color 0.2s ease, transform 0.2s ease;
      
      &:hover {
        background-color: var(--mat-sys-surface-container);
        
        .play-overlay {
          opacity: 1;
          transform: translateY(0);
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
        z-index: 2;
        
        &:hover {
          background: var(--mat-sys-primary-container);
          color: var(--mat-sys-on-primary-container);
          transform: scale(1.1);
        }
        
        mat-icon {
          font-size: 24px;
          width: 24px;
          height: 24px;
        }
      }
    }
    
    .card-info {
      padding: 0.75rem;
      padding-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      
      .card-title-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        
        .card-title {
          flex: 1;
          margin: 0;
          font-size: 1rem;
          line-height: 1.3;
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
      }
      
      .card-artist {
        font-size: 0.875rem;
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
      border-radius: 8px;
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
})
export class MusicEventComponent {
  private router = inject(Router);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);
  private reactionService = inject(ReactionService);
  private musicPlaylistService = inject(MusicPlaylistService);
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

  event = input.required<Event>();
  mode = input<'card' | 'list'>('list');

  authorProfile = signal<NostrRecord | undefined>(undefined);
  userPlaylists = this.musicPlaylistService.userPlaylists;
  playlistsLoading = this.musicPlaylistService.loading;
  isAuthenticated = computed(() => this.app.authenticated());

  // Edit dialog state
  showEditDialog = signal(false);
  editDialogData = signal<MusicTrackDialogData | null>(null);

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
    // Note: Like checking is done on-demand when user opens track details,
    // not for every card on the list to avoid subscription overflow
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
    const titleTag = event.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || null;
  });

  // Extract audio URL
  audioUrl = computed(() => {
    const event = this.event();
    const urlTag = event.tags.find(t => t[0] === 'url');
    if (urlTag?.[1]) {
      return urlTag[1];
    }

    // Fallback to content if it's a URL
    const content = event.content;
    const match = content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a))/i);
    return match ? match[0] : '';
  });

  // Extract cover image (raw URL for media player)
  rawImage = computed(() => {
    const event = this.event();
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
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
    const aiTag = event.tags.find(t => t[0] === 'ai-generated');
    const hasAiTopic = event.tags.some(t => t[0] === 't' && t[1]?.toLowerCase() === 'ai-generated');
    return aiTag?.[1] === 'true' || hasAiTopic;
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
    const durationTag = event.tags.find(t => t[0] === 'duration');
    const durationSeconds = durationTag?.[1] ? parseInt(durationTag[1], 10) : null;

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

  // Track liked state - set after liking
  private _isLiked = signal(false);
  isLiked = this._isLiked.asReadonly();

  // Get artist name from event tag first, then profile as fallback
  artistName = computed(() => {
    const event = this.event();
    // First check if artist tag exists in the event
    const artistTag = event.tags.find(t => t[0] === 'artist');
    if (artistTag?.[1]) {
      return artistTag[1];
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

  // Open song details page
  openDetails(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    const npub = this.artistNpub();
    const id = this.identifier();
    if (npub && id) {
      this.router.navigate(['/music/song', npub, id]);
    }
  }

  // Open artist page
  openArtist(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    const npub = this.artistNpub();
    if (npub) {
      this.router.navigate(['/music/artist', npub]);
    }
  }

  // Play track in media player
  playTrack(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();

    const url = this.audioUrl();
    if (!url) {
      console.warn('No audio URL found for track');
      return;
    }

    const mediaItem: MediaItem = {
      source: url,
      title: this.title() || 'Untitled Track',
      artist: this.artistName(),
      artwork: this.rawImage() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
      lyrics: this.utilities.extractLyricsFromEvent(this.event()),
    };

    this.mediaPlayer.play(mediaItem);
  }

  // Add track to queue
  addToQueue(): void {
    const url = this.audioUrl();
    if (!url) {
      this.snackBar.open('No audio URL found', 'Close', { duration: 3000 });
      return;
    }

    const mediaItem: MediaItem = {
      source: url,
      title: this.title() || 'Untitled Track',
      artist: this.artistName(),
      artwork: this.rawImage() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
      lyrics: this.utilities.extractLyricsFromEvent(this.event()),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  // Like the track
  likeTrack(event: MouseEvent | KeyboardEvent): void {
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

  // Zap the artist
  zapArtist(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    const ev = this.event();
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

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }

  // Copy event link (music song URL)
  copyEventLink(): void {
    const npub = this.artistNpub();
    const id = this.identifier();
    if (npub && id) {
      const link = `https://nostria.app/music/song/${npub}/${id}`;
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

  // Share track as a kind 1 note with reference
  shareTrack(): void {
    const ev = this.event();
    const addr = this.naddr();

    if (!addr) {
      this.snackBar.open('Failed to generate track reference', 'Close', { duration: 3000 });
      return;
    }

    // Create content with nostr: reference to the track
    const content = `nostr:${addr}`;

    // Open note editor with the track reference
    this.eventService.createNote({ content });
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
    const ev = this.event();
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
      console.error('Error adding to playlist:', error);
      this.snackBar.open('Failed to add to playlist', 'Close', { duration: 3000 });
    }
  }
}
