import { Component, computed, input, inject, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { ReactionService } from '../../services/reaction.service';
import { NostrRecord } from '../../interfaces';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';

@Component({
  selector: 'app-music-playlist-card',
  imports: [MatIconModule, MatCardModule, MatButtonModule, MatMenuModule, MatSnackBarModule],
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
      </div>
      <mat-card-content>
        <div class="playlist-info">
          <span class="playlist-title">{{ title() }}</span>
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
        <div class="playlist-actions">
          <button mat-icon-button (click)="likePlaylist($any($event))" aria-label="Like playlist"
            [class.liked]="isLiked()" [disabled]="isLiked()">
            <mat-icon>{{ isLiked() ? 'favorite' : 'favorite_border' }}</mat-icon>
          </button>
          <button mat-icon-button (click)="zapCreator($any($event))" aria-label="Zap creator">
            <mat-icon>bolt</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="More options">
            <mat-icon>more_vert</mat-icon>
          </button>
          <mat-menu #menu="matMenu">
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
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .playlist-card {
      cursor: pointer;
      transition: transform 0.2s ease, background-color 0.2s ease;
      overflow: hidden;

      &:hover {
        transform: translateY(-2px);
        
        .playlist-actions {
          opacity: 1;
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
    }

    mat-card-content {
      padding-top: 0.75rem;
    }

    .playlist-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .playlist-title {
      font-size: 1rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      margin-top: 0.25rem;
    }
    
    .playlist-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 0.5rem;
      opacity: 0.7;
      transition: opacity 0.2s ease;
      
      button {
        mat-icon {
          font-size: 1.25rem;
          width: 1.25rem;
          height: 1.25rem;
        }
        
        &.liked {
          mat-icon {
            color: var(--mat-sys-error);
          }
        }
      }
    }
  `],
})
export class MusicPlaylistCardComponent {
  private router = inject(Router);
  private data = inject(DataService);
  private reactionService = inject(ReactionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private clipboard = inject(Clipboard);

  event = input.required<Event>();

  authorProfile = signal<NostrRecord | undefined>(undefined);

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
}
