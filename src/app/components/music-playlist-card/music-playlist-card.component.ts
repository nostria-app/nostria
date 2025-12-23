import { Component, computed, input, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { Event } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-music-playlist-card',
  imports: [MatIconModule, MatCardModule],
  template: `
    <mat-card class="playlist-card" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" 
      tabindex="0" role="button" [attr.aria-label]="'Open playlist ' + title()">
      <div class="playlist-cover">
        @if (coverImage()) {
          <img [src]="coverImage()" [alt]="title()" class="cover-image" loading="lazy" />
        } @else {
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
  `],
})
export class MusicPlaylistCardComponent {
  private router = inject(Router);
  private data = inject(DataService);

  event = input.required<Event>();

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

  openPlaylist(): void {
    const event = this.event();
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag) {
      this.router.navigate(['/music/playlist', event.pubkey, dTag]);
    }
  }
}
