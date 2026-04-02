import { Component, computed, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Event, nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { ImageCacheService } from '../../services/image-cache.service';

@Component({
  selector: 'app-music-bookmark-playlist-card',
  imports: [MatCardModule, MatIconModule],
  template: `
    <mat-card class="playlist-card" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" tabindex="0" role="button">
      <div class="cover" [style.background]="gradient() || ''">
        @if (coverImage()) {
          <img [src]="coverImage()!" [alt]="title()" />
        } @else {
          <div class="placeholder">
            <mat-icon>playlist_play</mat-icon>
          </div>
        }
      </div>
      <div class="content">
        <div class="title">{{ title() }}</div>
        <div class="meta">{{ trackCount() }} tracks</div>
        @if (description()) {
          <div class="description">{{ description() }}</div>
        }
      </div>
    </mat-card>
  `,
  styles: [`
    .playlist-card {
      overflow: hidden;
      cursor: pointer;
    }

    .cover {
      aspect-ratio: 1;
      display: block;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-secondary-container));
    }

    .cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .placeholder mat-icon {
      width: 3rem;
      height: 3rem;
      font-size: 3rem;
      color: var(--mat-sys-on-primary-container);
      opacity: 0.7;
    }

    .content {
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .title,
    .meta,
    .description {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      color: var(--mat-sys-on-surface);
    }

    .meta,
    .description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }
  `],
})
export class MusicBookmarkPlaylistCardComponent {
  private layout = inject(LayoutService);
  private utilities = inject(UtilitiesService);
  private imageCache = inject(ImageCacheService);

  event = input.required<Event>();

  title = computed(() => {
    const title = this.event().tags.find(tag => tag[0] === 'title')?.[1];
    return title || 'Untitled Playlist';
  });

  description = computed(() => {
    return this.event().tags.find(tag => tag[0] === 'description')?.[1] || this.event().content || '';
  });

  trackCount = computed(() => this.utilities.getMusicPlaylistTrackRefs(this.event()).length);

  coverImage = computed(() => {
    const image = this.event().tags.find(tag => tag[0] === 'image')?.[1];
    return image ? this.imageCache.getOptimizedImageUrlWithSize(image, 320, 320) : null;
  });

  gradient = computed(() => this.utilities.getMusicGradient(this.event()));

  openPlaylist(): void {
    const dTag = this.event().tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) {
      return;
    }

    const npub = nip19.npubEncode(this.event().pubkey);
    this.layout.openMusicPlaylist(npub, dTag, this.event());
  }
}
