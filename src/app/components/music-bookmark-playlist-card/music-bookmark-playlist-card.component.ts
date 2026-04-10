import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Event, nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { ImageCacheService } from '../../services/image-cache.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-music-bookmark-playlist-card',
  imports: [MatIconModule],
  template: `
    @if (variant() === 'compact') {
      <div class="compact-playlist-card" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" tabindex="0"
        role="button">
        <div class="compact-cover" [style.background]="gradient() || ''">
          @if (coverImage()) {
            <img [src]="coverImage()!" [alt]="title()" />
          } @else {
            <div class="compact-placeholder">
              <mat-icon>playlist_play</mat-icon>
            </div>
          }
        </div>
        <div class="compact-content">
          <div class="compact-title">{{ title() }}</div>
          <div class="compact-meta">{{ trackCount() }} tracks</div>
        </div>
      </div>
    } @else {
      <div class="playlist-card" (click)="openPlaylist()" (keydown.enter)="openPlaylist()" tabindex="0" role="button">
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
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
    }

    .playlist-card {
      display: block;
      overflow: hidden;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-medium);
      background-color: var(--mat-sys-surface-container-high);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--mat-sys-shadow) 10%, transparent);

      &:hover,
      &:focus {
        background-color: var(--mat-sys-surface-container-highest);
        outline: none;
      }
    }

    .compact-playlist-card {
      display: flex;
      flex-direction: row;
      align-items: center;
      border-radius: var(--mat-sys-corner-small);
      cursor: pointer;
      transition: background-color 0.15s ease;
      overflow: hidden;
      background-color: var(--mat-sys-surface-container-high);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--mat-sys-shadow) 10%, transparent);
      height: 56px;
      width: 100%;
      min-width: 0;
      isolation: isolate;

      &:hover,
      &:focus {
        background-color: var(--mat-sys-surface-container-highest);
        outline: none;
      }
    }

    :host-context(.dark) .compact-playlist-card {
      background-color: var(--mat-sys-surface-container);
      box-shadow: none;
    }

    :host-context(.dark) .compact-playlist-card:hover,
    :host-context(.dark) .compact-playlist-card:focus {
      background-color: var(--mat-sys-surface-container-high);
    }

    :host-context(.dark) .playlist-card {
      background-color: var(--mat-sys-surface-container);
      box-shadow: none;
    }

    :host-context(.dark) .playlist-card:hover,
    :host-context(.dark) .playlist-card:focus {
      background-color: var(--mat-sys-surface-container-high);
    }

    .cover {
      aspect-ratio: 1;
      display: block;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-secondary-container));
    }

    .compact-cover {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      min-width: 56px;
      border-radius: var(--mat-sys-corner-small) 0 0 var(--mat-sys-corner-small);
      overflow: hidden;
      background: linear-gradient(135deg, var(--mat-sys-primary-container), var(--mat-sys-secondary-container));
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
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

    .compact-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .compact-placeholder mat-icon {
        width: 1.5rem;
        height: 1.5rem;
        font-size: 1.5rem;
        color: white;
        opacity: 1;
    }

    .content {
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .compact-content {
      display: flex;
      flex-direction: column;
      padding: 0.5rem 0.75rem;
      gap: 0.125rem;
      min-width: 0;
      overflow: hidden;
      flex: 1;
      background: transparent;
    }

    .title,
    .meta,
    .compact-title,
    .compact-meta,
     .description {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      font-size: 0.95rem;
      color: var(--mat-sys-on-surface);
    }

    .compact-title {
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface);
    }

    .meta,
    .description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .compact-meta {
      font-size: 0.6875rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class MusicBookmarkPlaylistCardComponent {
  private layout = inject(LayoutService);
  private utilities = inject(UtilitiesService);
  private imageCache = inject(ImageCacheService);

  event = input.required<Event>();
  variant = input<'card' | 'compact'>('card');

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
