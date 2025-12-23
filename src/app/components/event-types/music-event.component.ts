import { Component, computed, input, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { ReactionService } from '../../services/reaction.service';
import { NostrRecord, MediaItem } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-music-event',
  imports: [MatIconModule, MatButtonModule, MatMenuModule, MatSnackBarModule],
  template: `
    <div class="music-card" (click)="openDetails($any($event))" (keydown.enter)="openDetails($any($event))" tabindex="0" role="button"
      [attr.aria-label]="'View ' + title()">
      <div class="music-cover">
        @if (image()) {
          <img [src]="image()" [alt]="title()" class="cover-image" loading="lazy" />
        } @else {
          <div class="cover-placeholder">
            <mat-icon>music_note</mat-icon>
          </div>
        }
        <button class="play-overlay" (click)="playTrack($any($event))" aria-label="Play track">
          <mat-icon class="play-icon">play_arrow</mat-icon>
        </button>
      </div>
      <div class="music-info">
        <span class="music-title">{{ title() || 'Untitled Track' }}</span>
        <span class="music-artist" (click)="openArtist($any($event))" (keydown.enter)="openArtist($any($event))" 
          tabindex="0" role="button">{{ artistName() }}</span>
      </div>
      <div class="music-actions">
        <button mat-icon-button (click)="likeTrack($any($event))" [attr.aria-label]="'Like track'">
          <mat-icon>favorite_border</mat-icon>
        </button>
        <button mat-icon-button (click)="zapArtist($any($event))" aria-label="Zap artist">
          <mat-icon>bolt</mat-icon>
        </button>
        <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
          <mat-icon>more_vert</mat-icon>
        </button>
        <mat-menu #menu="matMenu">
          <button mat-menu-item (click)="addToQueue()">
            <mat-icon>queue_music</mat-icon>
            <span>Add to Queue</span>
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
      </div>
    </div>
  `,
  styles: [`
    .music-card {
      display: flex;
      flex-direction: column;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-large);
      overflow: hidden;
      background-color: var(--mat-sys-surface-container);
      transition: transform 0.2s ease, background-color 0.2s ease;
      
      &:hover {
        transform: scale(1.02);
        background-color: var(--mat-sys-surface-container-high);
        
        .play-overlay {
          opacity: 1;
        }
        
        .music-actions {
          opacity: 1;
        }
      }
      
      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
    
    .music-cover {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      
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
        background: linear-gradient(135deg, var(--mat-sys-primary-container) 0%, var(--mat-sys-secondary-container) 100%);
        
        mat-icon {
          font-size: 4rem;
          width: 4rem;
          height: 4rem;
          color: var(--mat-sys-on-primary-container);
          opacity: 0.5;
        }
      }
      
      .play-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.4);
        opacity: 0;
        transition: opacity 0.2s ease;
        border: none;
        cursor: pointer;
        
        &:hover {
          background-color: rgba(0, 0, 0, 0.6);
        }
        
        .play-icon {
          font-size: 3rem;
          width: 3rem;
          height: 3rem;
          color: white;
        }
      }
    }
    
    .music-info {
      display: flex;
      flex-direction: column;
      padding: 0.75rem;
      padding-bottom: 0.25rem;
      gap: 0.25rem;
    }
    
    .music-title {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .music-artist {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      
      &:hover {
        text-decoration: underline;
        color: var(--mat-sys-primary);
      }
    }
    
    .music-actions {
      display: flex;
      justify-content: space-around;
      padding: 0.25rem;
      opacity: 0.7;
      transition: opacity 0.2s ease;
      
      button {
        mat-icon {
          font-size: 1.25rem;
          width: 1.25rem;
          height: 1.25rem;
        }
      }
    }
  `],
})
export class MusicEventComponent {
  private router = inject(Router);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);
  private reactionService = inject(ReactionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);

  event = input.required<Event>();

  authorProfile = signal<NostrRecord | undefined>(undefined);

  constructor() {
    // Load author profile
    effect(() => {
      const pubkey = this.event().pubkey;
      if (pubkey) {
        this.data.getProfile(pubkey).then(profile => {
          this.authorProfile.set(profile);
        });
      }
    });
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

  // Extract cover image
  image = computed(() => {
    const event = this.event();
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Get artist name from profile or fallback
  artistName = computed(() => {
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
      artwork: this.image() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
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
      artwork: this.image() || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: this.artistNpub(),
      eventIdentifier: this.identifier(),
    };

    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  // Like the track
  likeTrack(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    const ev = this.event();
    this.reactionService.addLike(ev).then(success => {
      if (success) {
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

    const data: ZapDialogData = {
      recipientPubkey: ev.pubkey,
      recipientName: this.artistName(),
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
}
