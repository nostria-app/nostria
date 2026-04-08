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
  AfterViewInit,
  ElementRef,
  viewChild,
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
import { CollectionSetsService } from '../../services/collection-sets.service';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';

type GifSource = 'own' | 'public';

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
      <!-- Search + source toggle -->
      <div class="gif-toolbar">
        <div class="gif-search">
          <mat-icon class="search-icon">search</mat-icon>
          <input type="text" placeholder="Search GIFs..."
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)"
            (keydown.escape)="searchQuery.set('')"
            #searchInput />
          @if (searchQuery()) {
          <button class="clear-btn" (click)="searchQuery.set('')">
            <mat-icon>close</mat-icon>
          </button>
          }
        </div>
        <div class="source-toggle">
          <button class="toggle-btn" [class.active]="gifSource() === 'own'" (click)="setSource('own')"
            matTooltip="Your GIF sets">
            Mine
          </button>
          <button class="toggle-btn" [class.active]="gifSource() === 'public'" (click)="setSource('public')"
            matTooltip="Public GIF sets from relays">
            Public
          </button>
        </div>
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

          @if (isLoadingMore()) {
          <div class="loading-more-indicator" aria-live="polite">
            <mat-spinner diameter="14"></mat-spinner>
            <span>Looking for more GIF sets...</span>
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
      overflow: hidden;
    }

    :host-context(.gif-picker-dialog) .gif-picker,
    :host-context(.emoji-picker-dialog) .gif-picker,
    :host-context(.emoji-picker-dialog-panel) .gif-picker,
    :host-context(.desktop-reaction-picker-dialog-panel) .gif-picker,
    :host-context(.emoji-picker-menu) .gif-picker {
      max-height: none;
      flex: 1;
      min-height: 0;
    }

    .gif-toolbar {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .gif-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px;

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

    .source-toggle {
      display: flex;
      gap: 4px;
      padding: 0 8px 8px;

      .toggle-btn {
        flex: 1;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 16px;
        padding: 4px 12px;
        font-size: 12px;
        cursor: pointer;
        color: var(--mat-sys-on-surface-variant);
        transition: all 0.15s;

        &.active {
          background: var(--mat-sys-primary-container);
          color: var(--mat-sys-on-primary-container);
          border-color: var(--mat-sys-primary);
        }

        &:hover:not(.active) {
          background: var(--mat-sys-surface-container-high);
        }
      }
    }

    .gif-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 6px;
      scrollbar-gutter: stable;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb, var(--mat-sys-outline)) var(--scrollbar-track, transparent);
    }

    :host-context(.gif-picker-dialog) .gif-content,
    :host-context(.emoji-picker-dialog) .gif-content,
    :host-context(.emoji-picker-dialog-panel) .gif-content,
    :host-context(.desktop-reaction-picker-dialog-panel) .gif-content,
    :host-context(.emoji-picker-menu) .gif-content {
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

    .loading-more-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 12px 14px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      opacity: 0.8;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GifPickerComponent implements OnDestroy, AfterViewInit {
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly collectionSets = inject(CollectionSetsService);
  private readonly userData = inject(UserDataService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);

  gifSelected = output<string>();
  searchInput = viewChild<ElementRef>('searchInput');

  searchQuery = signal('');
  gifSource = signal<GifSource>('public');
  isLoading = signal(false);
  isLoadingMore = signal(false);
  ownGifSets = signal<GifSet[]>([]);
  publicGifSets = signal<GifSet[]>([]);
  favorites = signal<FavoriteGif[]>([]);
  private favoriteUrls = signal<Set<string>>(new Set());
  private ownLoaded = false;
  private publicLoaded = false;

  gifSets = computed(() => this.gifSource() === 'own' ? this.ownGifSets() : this.publicGifSets());

  private allGifs = computed<GifEntry[]>(() => {
    const entries: GifEntry[] = [];
    for (const set of this.gifSets()) {
      for (const gif of set.gifs) {
        entries.push({ ...gif, setTitle: set.title });
      }
    }
    return entries;
  });

  private normalizeSearchTerm(value: string): string {
    return value
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  filteredGifs = computed(() => {
    const rawQuery = this.searchQuery();
    const query = this.normalizeSearchTerm(rawQuery);
    if (!query) return [];

    return this.allGifs().filter((gif) => {
      const shortcode = this.normalizeSearchTerm(gif.shortcode);
      return shortcode.includes(query);
    });
  });

  constructor() {
    // Also reloads when emojiSetService.preferencesChanged signal updates (e.g. after installing a set)
    effect(() => {
      const pubkey = this.accountState.pubkey();
      // Track the preferencesChanged signal so this effect re-runs when emoji sets are installed/uninstalled
      const _version = this.emojiSetService.preferencesChanged();
      if (!pubkey) return;
      untracked(() => {
        // Reset loaded flags so sets are re-fetched with updated preferences
        this.ownLoaded = false;
        this.publicLoaded = false;
        this.loadFavorites(pubkey);
        this.loadPublicGifSets(pubkey);
      });
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.searchInput()?.nativeElement?.focus();
    }, 100);
  }

  ngOnDestroy(): void { }

  setSource(source: GifSource) {
    this.gifSource.set(source);
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;
    if (source === 'public' && !this.publicLoaded) {
      this.loadPublicGifSets(pubkey);
    } else if (source === 'own' && !this.ownLoaded) {
      this.loadOwnGifSets(pubkey);
    }
  }

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

  private async loadOwnGifSets(pubkey: string): Promise<void> {
    if (this.ownLoaded) return;
    this.isLoading.set(true);
    try {
      const sets: GifSet[] = [];

      // 1. Load user's own kind 30030 sets with "gifs" tag (fast, from local DB)
      const allUserSets = await this.collectionSets.getEmojiSets(pubkey);
      for (const emojiSet of allUserSets) {
        if (!emojiSet.tags.some(t => t.toLowerCase() === 'gifs')) continue;
        if (emojiSet.emojis.length === 0) continue;
        sets.push({
          id: `30030:${pubkey}:${emojiSet.identifier}`,
          title: emojiSet.name,
          gifs: emojiSet.emojis.map(e => ({ shortcode: e.shortcode, url: e.url })),
        });
      }

      // 2. Load from user's installed emoji sets (kind 10030 references)
      const installedSets = await this.loadInstalledGifSets(pubkey, sets.map(s => s.id));
      sets.push(...installedSets);

      this.ownGifSets.set(sets);
      this.ownLoaded = true;
    } catch (error) {
      this.logger.error('Error loading own GIF sets:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadPublicGifSets(pubkey: string): Promise<void> {
    if (this.publicLoaded) return;
    this.isLoading.set(true);
    this.isLoadingMore.set(false);
    try {
      const ownIds = this.ownGifSets().map(s => s.id);
      const ownIdSet = new Set(ownIds);

      // 1. Load cached GIF sets from local database first (instant)
      const cachedSets = await this.loadCachedPublicGifSets(ownIdSet);
      if (cachedSets.length > 0) {
        this.publicGifSets.set(cachedSets);
        this.isLoading.set(false);
        this.isLoadingMore.set(true);
      }

      // 2. Fetch from relays in background to pick up new sets
      const relaySets = await this.loadRelayGifSets(ownIdSet);
      if (relaySets.length > 0) {
        // Merge: relay sets take priority (fresher), then cached-only sets
        const relayIdSet = new Set(relaySets.map(s => s.id));
        const cachedOnly = cachedSets.filter(s => !relayIdSet.has(s.id));
        this.publicGifSets.set([...relaySets, ...cachedOnly]);
      }

      this.publicLoaded = true;
    } catch (error) {
      this.logger.error('Error loading public GIF sets:', error);
    } finally {
      this.isLoadingMore.set(false);
      this.isLoading.set(false);
    }
  }

  private getGifSetTitle(event: NostrEvent): string {
    return event.tags.find((tag: string[]) => tag[0] === 'title')?.[1]
      || event.tags.find((tag: string[]) => tag[0] === 'name')?.[1]
      || event.tags.find((tag: string[]) => tag[0] === 'd')?.[1]
      || 'Untitled';
  }

  private async loadCachedPublicGifSets(existingIdSet: Set<string>): Promise<GifSet[]> {
    const sets: GifSet[] = [];
    try {
      await this.database.init();
      const cachedEvents = await this.database.getEventsByKind(30030);
      const seen = new Map<string, NostrEvent>();
      for (const event of cachedEvents) {
        const hasGifsTag = event.tags.some(
          (t: string[]) => t[0] === 't' && t[1]?.toLowerCase() === 'gifs'
        );
        if (!hasGifsTag) continue;
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
        const title = this.getGifSetTitle(event);
        const gifs: { shortcode: string; url: string }[] = [];
        for (const tag of event.tags) {
          if (tag[0] === 'emoji' && tag[1] && tag[2]) {
            gifs.push({ shortcode: tag[1], url: tag[2] });
          }
        }
        if (gifs.length > 0) {
          sets.push({ id: key, title, gifs });
        }
      }
    } catch (error) {
      this.logger.error('Error loading cached public GIF sets:', error);
    }
    return sets;
  }

  private async loadInstalledGifSets(pubkey: string, existingIds: string[]): Promise<GifSet[]> {
    const sets: GifSet[] = [];
    const existingIdSet = new Set(existingIds);
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

        const refId = `30030:${refPubkey}:${identifier}`;
        if (existingIdSet.has(refId)) continue;

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

  private async loadRelayGifSets(existingIdSet: Set<string>): Promise<GifSet[]> {
    const sets: GifSet[] = [];

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

        const title = this.getGifSetTitle(event);

        const gifs: { shortcode: string; url: string }[] = [];
        for (const tag of event.tags) {
          if (tag[0] === 'emoji' && tag[1] && tag[2]) {
            gifs.push({ shortcode: tag[1], url: tag[2] });
          }
        }

        if (gifs.length > 0) {
          sets.push({ id: key, title, gifs });
          // Cache for future use (replaceable event dedup)
          await this.database.saveReplaceableEvent(event);
        }
      }
    } catch (error) {
      this.logger.error('Error loading relay GIF sets:', error);
    }
    return sets;
  }
}
