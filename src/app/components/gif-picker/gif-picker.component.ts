import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
  effect,
  untracked,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event as NostrEvent } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService, FavoriteGif } from '../../services/account-local-state.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';

interface GifEntry {
  shortcode: string;
  url: string;
  setTitle: string;
}

interface GifSet {
  id: string;
  title: string;
  gifs: { shortcode: string; url: string }[];
}

@Component({
  selector: 'app-gif-picker',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="gif-picker" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
      <!-- Search -->
      <div class="gif-search">
        <mat-icon class="search-icon">search</mat-icon>
        <input type="text" placeholder="Search GIFs..."
          [value]="searchQuery()"
          (input)="searchQuery.set($any($event.target).value)"
          (keydown.escape)="searchQuery.set('')" />
        @if (searchQuery()) {
        <button class="clear-btn" (click)="searchQuery.set('')">
          <mat-icon>close</mat-icon>
        </button>
        }
      </div>

      <div class="gif-content">
        @if (isLoading()) {
        <div class="loading-state">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading GIFs...</span>
        </div>
        } @else if (searchQuery()) {
          <!-- Search results -->
          @if (filteredGifs().length > 0) {
          <div class="gif-section">
            <div class="section-title">Results</div>
            <div class="gif-grid">
              @for (gif of filteredGifs(); track gif.url) {
              <button class="gif-item" (click)="selectGif(gif)" [matTooltip]="gif.shortcode">
                <img [src]="gif.url" [alt]="gif.shortcode" loading="lazy" />
                <button class="fav-btn" (click)="toggleFavorite(gif, $event)"
                  [class.is-favorite]="isFavorite(gif.url)">
                  <mat-icon>{{ isFavorite(gif.url) ? 'favorite' : 'favorite_border' }}</mat-icon>
                </button>
              </button>
              }
            </div>
          </div>
          } @else {
          <div class="empty-state">
            <mat-icon>search_off</mat-icon>
            <span>No GIFs found for "{{ searchQuery() }}"</span>
          </div>
          }
        } @else {
          <!-- Favorites -->
          @if (favorites().length > 0) {
          <div class="gif-section">
            <div class="section-title">
              <mat-icon class="section-icon">favorite</mat-icon>
              Favorites
            </div>
            <div class="gif-grid">
              @for (gif of favorites(); track gif.url) {
              <button class="gif-item" (click)="selectGif(gif)" [matTooltip]="gif.shortcode">
                <img [src]="gif.url" [alt]="gif.shortcode" loading="lazy" />
                <button class="fav-btn is-favorite" (click)="toggleFavorite(gif, $event)">
                  <mat-icon>favorite</mat-icon>
                </button>
              </button>
              }
            </div>
          </div>
          }

          <!-- GIF sets -->
          @for (set of gifSets(); track set.id) {
          <div class="gif-section">
            <div class="section-title">{{ set.title }}</div>
            <div class="gif-grid">
              @for (gif of set.gifs; track gif.url) {
              <button class="gif-item" (click)="selectGif(gif)" [matTooltip]="gif.shortcode">
                <img [src]="gif.url" [alt]="gif.shortcode" loading="lazy" />
                <button class="fav-btn" (click)="toggleFavorite(gif, $event)"
                  [class.is-favorite]="isFavorite(gif.url)">
                  <mat-icon>{{ isFavorite(gif.url) ? 'favorite' : 'favorite_border' }}</mat-icon>
                </button>
              </button>
              }
            </div>
          </div>
          }

          @if (!isLoading() && gifSets().length === 0 && favorites().length === 0) {
          <div class="empty-state">
            <mat-icon>gif_box</mat-icon>
            <span>No GIF packs found. Add emoji sets with the "gifs" tag.</span>
          </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .gif-picker {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-height: 400px;
      min-height: 200px;
    }

    :host-context(.gif-picker-dialog) .gif-picker {
      max-height: none;
      height: 100%;
    }

    .gif-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);

      .search-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--mat-sys-on-surface-variant);
      }

      input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        font-size: 14px;
        color: var(--mat-sys-on-surface);

        &::placeholder {
          color: var(--mat-sys-on-surface-variant);
        }
      }

      .clear-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        display: flex;
        color: var(--mat-sys-on-surface-variant);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }
    }

    .gif-content {
      overflow-y: auto;
      overflow-x: hidden;
      max-height: 350px;
      padding: 6px;
      scrollbar-gutter: stable both-edges;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb, var(--mat-sys-outline)) var(--scrollbar-track, transparent);
    }

    :host-context(.gif-picker-dialog) .gif-content {
      max-height: none;
      flex: 1;
      overflow-y: auto;
    }

    .gif-section {
      margin-bottom: 8px;

      .section-title {
        padding: 4px 6px 6px;
        font-size: 12px;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 4px;

        .section-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }
    }

    .gif-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
    }

    .gif-item {
      position: relative;
      background: var(--mat-sys-surface-container);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      padding: 0;
      overflow: hidden;
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        border-color: var(--mat-sys-primary);
      }

      &:hover .fav-btn {
        opacity: 1;
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .fav-btn {
        position: absolute;
        top: 2px;
        right: 2px;
        background: rgba(0, 0, 0, 0.5);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--mat-sys-on-surface);
        }

        &.is-favorite {
          opacity: 1;

          mat-icon {
            color: #ff4081;
          }
        }
      }
    }

    .loading-state,
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      opacity: 0.5;
      font-size: 14px;

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GifPickerComponent implements OnDestroy {
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly userData = inject(UserDataService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);

  gifSelected = output<string>();

  searchQuery = signal('');
  isLoading = signal(false);
  gifSets = signal<GifSet[]>([]);
  favorites = signal<FavoriteGif[]>([]);
  private favoriteUrls = signal<Set<string>>(new Set());

  private allGifs = computed<GifEntry[]>(() => {
    const entries: GifEntry[] = [];
    for (const set of this.gifSets()) {
      for (const gif of set.gifs) {
        entries.push({ ...gif, setTitle: set.title });
      }
    }
    return entries;
  });

  filteredGifs = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return [];
    return this.allGifs().filter(g => g.shortcode.toLowerCase().includes(query));
  });

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;
      untracked(() => {
        this.loadFavorites(pubkey);
        this.loadGifSets(pubkey);
      });
    });
  }

  ngOnDestroy(): void { }

  private loadFavorites(pubkey: string) {
    const favs = this.accountLocalState.getFavoriteGifs(pubkey);
    this.favorites.set(favs);
    this.favoriteUrls.set(new Set(favs.map(f => f.url)));
  }

  isFavorite(url: string): boolean {
    return this.favoriteUrls().has(url);
  }

  toggleFavorite(gif: { shortcode: string; url: string }, event: MouseEvent) {
    event.stopPropagation();
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    if (this.isFavorite(gif.url)) {
      this.accountLocalState.removeFavoriteGif(pubkey, gif.url);
    } else {
      this.accountLocalState.addFavoriteGif(pubkey, gif.shortcode, gif.url);
    }
    this.loadFavorites(pubkey);
  }

  selectGif(gif: { shortcode: string; url: string }) {
    this.gifSelected.emit(gif.url);

    // Also add to favorites automatically on use
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.addFavoriteGif(pubkey, gif.shortcode, gif.url);
      this.loadFavorites(pubkey);
    }
  }

  private async loadGifSets(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const sets: GifSet[] = [];

      // 1. Load from user's installed emoji sets (kind 10030 references)
      const userSets = await this.loadUserGifSets(pubkey);
      sets.push(...userSets);

      // 2. Query relays for kind 30030 events with #t=gifs
      const relaySets = await this.loadRelayGifSets(sets.map(s => s.id));
      sets.push(...relaySets);

      this.gifSets.set(sets);
    } catch (error) {
      this.logger.error('Error loading GIF sets:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadUserGifSets(pubkey: string): Promise<GifSet[]> {
    const sets: GifSet[] = [];
    try {
      const emojiListRecord = await this.userData.getEventByPubkeyAndKind(pubkey, 10030, { save: true });
      if (!emojiListRecord) return sets;

      const emojiListEvent = emojiListRecord.event;
      const emojiSetRefs = emojiListEvent.tags.filter(
        (tag: string[]) => tag[0] === 'a' && tag[1]?.startsWith('30030:')
      );

      for (const ref of emojiSetRefs) {
        const [, refPubkey, identifier] = ref[1].split(':');
        if (!refPubkey || !identifier) continue;

        const emojiSet = await this.emojiSetService.getEmojiSet(refPubkey, identifier);
        if (!emojiSet) continue;

        // Check if it has a "gifs" tag
        const hasGifsTag = emojiSet.event.tags.some(
          (tag: string[]) => tag[0] === 't' && tag[1]?.toLowerCase() === 'gifs'
        );
        if (!hasGifsTag) continue;

        const gifs = Array.from(emojiSet.emojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
        if (gifs.length > 0) {
          sets.push({ id: emojiSet.id, title: emojiSet.title, gifs });
        }
      }
    } catch (error) {
      this.logger.error('Error loading user GIF sets:', error);
    }
    return sets;
  }

  private async loadRelayGifSets(existingIds: string[]): Promise<GifSet[]> {
    const sets: GifSet[] = [];
    const existingIdSet = new Set(existingIds);

    try {
      // Query well-known relays for emoji sets tagged with "gifs"
      const relays = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.nostr.band'];
      const events = await this.relayPool.query(
        relays,
        {
          kinds: [30030],
          '#t': ['gifs'],
          limit: 20,
        },
        10000
      );

      if (!events || events.length === 0) return sets;

      // Deduplicate by d-tag + pubkey
      const seen = new Map<string, NostrEvent>();
      for (const event of events) {
        const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
        if (!dTag) continue;
        const key = `30030:${event.pubkey}:${dTag}`;
        const existing = seen.get(key);
        if (!existing || event.created_at > existing.created_at) {
          seen.set(key, event);
        }
      }

      for (const [key, event] of seen) {
        if (existingIdSet.has(key)) continue;

        const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1] ||
          event.tags.find((t: string[]) => t[0] === 'd')?.[1] || 'Untitled';

        const gifs: { shortcode: string; url: string }[] = [];
        for (const tag of event.tags) {
          if (tag[0] === 'emoji' && tag[1] && tag[2]) {
            gifs.push({ shortcode: tag[1], url: tag[2] });
          }
        }

        if (gifs.length > 0) {
          sets.push({ id: key, title, gifs });
          // Cache for future use
          await this.database.saveEvent(event);
        }
      }
    } catch (error) {
      this.logger.error('Error loading relay GIF sets:', error);
    }
    return sets;
  }
}
