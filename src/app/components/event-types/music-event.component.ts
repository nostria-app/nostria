import { Component, computed, input, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { NostrRecord, MediaItem } from '../../interfaces';

@Component({
  selector: 'app-music-event',
  imports: [MatIconModule],
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
  `],
})
export class MusicEventComponent {
  private router = inject(Router);
  private data = inject(DataService);
  private mediaPlayer = inject(MediaPlayerService);

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
    };

    this.mediaPlayer.play(mediaItem);
  }
}
