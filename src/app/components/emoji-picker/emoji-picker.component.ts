import {
  Component,
  output,
  signal,
  computed,
  inject,
  effect,
  untracked,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountLocalStateService, RecentEmoji } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { EmojiSetGroup, EmojiSetService } from '../../services/emoji-set.service';
import { LoggerService } from '../../services/logger.service';
import { GifPickerComponent } from '../gif-picker/gif-picker.component';
import { UNICODE_EMOJI_CATEGORIES } from '../../utils/unicode-emoji-catalog';

const EMOJI_CATEGORIES = UNICODE_EMOJI_CATEGORIES;

const EMOJI_KEYWORDS: Record<string, string[]> = {
  '😀': ['grin', 'happy', 'smile'], '😃': ['smile', 'happy'], '😄': ['smile', 'happy', 'laugh'],
  '😁': ['grin', 'teeth', 'happy'], '😆': ['laugh', 'xd'], '😅': ['sweat', 'nervous', 'laugh'],
  '🤣': ['rofl', 'laugh', 'lol', 'lmao'], '😂': ['laugh', 'cry', 'tears', 'lol', 'funny'],
  '🙂': ['smile', 'slight'], '😊': ['blush', 'smile', 'happy'], '😇': ['angel', 'innocent'],
  '🥰': ['love', 'hearts', 'adore'], '😍': ['love', 'heart', 'eyes', 'crush'],
  '🤩': ['star', 'excited', 'wow'], '😘': ['kiss', 'love'], '😋': ['yummy', 'delicious', 'tongue'],
  '😛': ['tongue', 'playful'], '😜': ['wink', 'tongue', 'silly'], '🤪': ['crazy', 'zany', 'wild'],
  '🤑': ['money', 'rich'], '🤗': ['hug', 'embrace'], '🤔': ['think', 'thinking', 'hmm'],
  '🙄': ['eye', 'roll', 'annoyed'], '😏': ['smirk', 'smug'], '😒': ['unamused', 'annoyed'],
  '😔': ['sad', 'pensive'], '😴': ['sleep', 'zzz', 'tired'], '🤯': ['mind', 'blown', 'wow'],
  '🥳': ['party', 'celebration', 'birthday'], '😎': ['cool', 'sunglasses'],
  '👍': ['thumbs', 'up', 'like', 'yes', 'good', 'ok'], '👎': ['thumbs', 'down', 'dislike', 'no'],
  '👋': ['wave', 'hi', 'hello', 'bye'], '👏': ['clap', 'applause', 'bravo'],
  '🙌': ['raise', 'hands', 'hooray'], '🤝': ['handshake', 'deal'],
  '🙏': ['pray', 'please', 'thanks', 'namaste'], '✌️': ['peace', 'victory'],
  '💪': ['muscle', 'strong', 'flex', 'power'], '👊': ['fist', 'bump', 'punch'],
  '❤️': ['heart', 'love', 'red'], '💔': ['broken', 'heart'], '🔥': ['fire', 'hot', 'lit'],
  '✨': ['sparkle', 'stars', 'magic'], '💯': ['hundred', 'perfect', 'score'],
  '🎉': ['party', 'celebration', 'tada'], '🎊': ['confetti', 'celebration'],
  '💬': ['speech', 'chat', 'message', 'talk'], '💭': ['thought', 'thinking'],
  '😷': ['mask', 'sick', 'covid'], '🤮': ['vomit', 'sick'], '🤧': ['sneeze', 'sick'],
  '😵': ['dizzy', 'dead'], '🤠': ['cowboy', 'western'], '🤓': ['nerd', 'geek', 'glasses'],
  '😮': ['surprised', 'wow', 'open', 'mouth', 'shock'],
  '🚀': ['rocket', 'launch', 'space'],
};

@Component({
  selector: 'app-emoji-picker',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    GifPickerComponent,
  ],
  template: `
    <div class="emoji-picker" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
      <!-- Tabs (only in content mode) -->
      @if (mode() === 'content') {
      <div class="picker-tabs">
        <button class="tab-btn" [class.active]="activeTab() === 'emoji'" (click)="activeTab.set('emoji')">
          <mat-icon>sentiment_satisfied</mat-icon>
          <span>Emoji</span>
        </button>
        <button class="tab-btn" [class.active]="activeTab() === 'gifs'" (click)="activeTab.set('gifs')">
          <mat-icon>gif_box</mat-icon>
          <span>GIFs</span>
        </button>
      </div>
      }

      @if (activeTab() === 'emoji') {
      <!-- Emoji tab content -->
      <!-- Search -->
      <div class="emoji-search">
        <mat-icon class="search-icon">search</mat-icon>
        <input type="text" placeholder="Search emojis..."
          [ngModel]="searchQuery()"
          (ngModelChange)="searchQuery.set($event)"
          (click)="$event.stopPropagation()">
        @if (searchQuery()) {
        <button mat-icon-button class="clear-search" (click)="searchQuery.set(''); $event.stopPropagation()">
          <mat-icon>close</mat-icon>
        </button>
        }
      </div>

      @if (searchQuery()) {
      <!-- Search results -->
      <div class="emoji-grid-container">
        <div class="emoji-grid">
          @for (emoji of filteredEmojis(); track emoji) {
          <button class="emoji-btn" (click)="selectEmoji(emoji); $event.stopPropagation()">
            {{ emoji }}
          </button>
          }
          @for (emoji of filteredCustomEmojis(); track emoji.shortcode) {
          <button class="emoji-btn custom-emoji" (click)="selectCustomEmoji(emoji.shortcode, emoji.url); $event.stopPropagation()"
            [matTooltip]="emoji.shortcode">
            <img [src]="emoji.url" [alt]="emoji.shortcode" class="custom-emoji-img">
          </button>
          }
        </div>
        @if (filteredEmojis().length === 0 && filteredCustomEmojis().length === 0) {
        <div class="no-results">No emojis found</div>
        }
      </div>
      } @else {
        <div class="emoji-list-scroll">
          <div class="emoji-section">
            <div class="section-title">
              <span class="section-icon">🕘</span>
              <span>Recent</span>
            </div>
            @if (recentEmojis().length > 0) {
            <div class="emoji-grid">
              @for (recent of recentEmojis(); track recent.emoji) {
              <button class="emoji-btn" (click)="selectEmoji(recent.emoji); $event.stopPropagation()">
                @if (recent.url) {
                <img [src]="recent.url" [alt]="recent.emoji" class="custom-emoji-img">
                } @else {
                {{ recent.emoji }}
                }
              </button>
              }
            </div>
            } @else {
            <div class="no-results">
              <mat-icon>sentiment_satisfied</mat-icon>
              <span>Recent emojis will appear here</span>
            </div>
            }
          </div>

          @if (emojiSets().length > 0) {
          <div class="emoji-section">
            <div class="section-title">
              <span class="section-icon">🧩</span>
              <span>Custom Emojis</span>
            </div>
            @for (set of emojiSets(); track set.id) {
            <div class="emoji-set-section">
              <div class="set-title">{{ set.title }}</div>
              <div class="emoji-grid">
                @for (emoji of set.emojis; track emoji.shortcode) {
                <button class="emoji-btn custom-emoji" (click)="selectCustomEmoji(emoji.shortcode, emoji.url); $event.stopPropagation()"
                  [matTooltip]="emoji.shortcode">
                  <img [src]="emoji.url" [alt]="emoji.shortcode" class="custom-emoji-img">
                </button>
                }
              </div>
            </div>
            }
          </div>
          }

          @for (category of categories; track category.id) {
          <div class="emoji-section">
            <div class="section-title">
              <span class="section-icon">{{ category.icon }}</span>
              <span>{{ category.label }}</span>
            </div>
            <div class="emoji-grid">
              @for (emoji of category.emojis; track emoji) {
              <button class="emoji-btn" (click)="selectEmoji(emoji); $event.stopPropagation()">
                {{ emoji }}
              </button>
              }
            </div>
          </div>
          }
        </div>
      }
      } @else {
      <!-- GIFs tab content -->
      <div class="gif-tab-content">
        <app-gif-picker (gifSelected)="onGifSelected($event)"></app-gif-picker>
      </div>
      }
    </div>
  `,
  styles: [`
    :host-context(.emoji-picker-dialog) {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    :host-context(.emoji-picker-menu) {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    :host-context(.emoji-picker-dialog) .emoji-picker {
      width: 100%;
      max-width: none;
      max-height: none;
      flex: 1;
      min-height: 0;
    }

    :host-context(.emoji-picker-menu) .emoji-picker {
      width: 100%;
      max-height: none;
      flex: 1;
      min-height: 0;
    }

    .emoji-picker {
      width: 100%;
      max-width: 360px;
      min-width: 0;
      max-height: 350px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      overflow-x: hidden;
      box-sizing: border-box;
    }

    .emoji-picker * {
      box-sizing: border-box;
    }

    .picker-tabs {
      display: flex;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      flex-shrink: 0;

      .tab-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        font-size: 0.8rem;
        color: var(--mat-sys-on-surface-variant);
        transition: all 0.15s;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &.active {
          color: var(--mat-sys-primary);
          border-bottom-color: var(--mat-sys-primary);
        }

        &:hover:not(.active) {
          background: var(--mat-sys-surface-container-high);
        }
      }
    }

    .gif-tab-content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      app-gif-picker {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
    }

    .emoji-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);

      .search-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        opacity: 0.5;
      }

      input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        color: inherit;
        font-size: 0.875rem;
        min-width: 0;
      }

      .clear-search {
        width: 24px;
        height: 24px;
        padding: 0;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }
    }

    :host-context(.emoji-picker-dialog) .emoji-grid-container,
    :host-context(.emoji-picker-menu) .emoji-grid-container {
      max-height: none;
      flex: 1;
      overflow-y: auto;
    }

    .emoji-grid-container {
      overflow-y: auto;
      overflow-x: hidden;
      max-height: 280px;
      padding: 4px;
      scrollbar-gutter: stable both-edges;
      scrollbar-width: auto;
      scrollbar-color: var(--scrollbar-thumb, var(--mat-sys-outline)) var(--scrollbar-track, transparent);
    }

    :host-context(.emoji-picker-dialog) .emoji-list-scroll,
    :host-context(.emoji-picker-menu) .emoji-list-scroll {
      max-height: none;
      flex: 1;
      overflow-y: auto;
    }

    .emoji-list-scroll {
      overflow-y: auto;
      overflow-x: hidden;
      max-height: 280px;
      padding: 4px;
      scrollbar-gutter: stable both-edges;
      scrollbar-width: auto;
      scrollbar-color: var(--scrollbar-thumb, var(--mat-sys-outline)) var(--scrollbar-track, transparent);
    }

    .emoji-grid-container::-webkit-scrollbar,
    .emoji-list-scroll::-webkit-scrollbar {
      width: 10px;
    }

    .emoji-grid-container::-webkit-scrollbar-track,
    .emoji-list-scroll::-webkit-scrollbar-track {
      background: var(--scrollbar-track, transparent);
    }

    .emoji-grid-container::-webkit-scrollbar-thumb,
    .emoji-list-scroll::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb, var(--mat-sys-outline));
      border-radius: 5px;
    }

    .emoji-grid-container::-webkit-scrollbar-thumb:hover,
    .emoji-list-scroll::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover, var(--mat-sys-on-surface-variant));
    }

    :host-context(.emoji-picker-dialog) .emoji-grid {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    :host-context(.emoji-picker-dialog) .emoji-btn {
      width: 100%;
      height: 58px;
      font-size: 1.95rem;

      .custom-emoji-img {
        width: 36px;
        height: 36px;
      }
    }

    :host-context(.emoji-picker-dialog) .emoji-search {
      padding: 10px 12px;

      .search-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      input {
        font-size: 1rem;
      }
    }

    .emoji-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 1px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }

    @media (max-width: 420px) {
      .emoji-grid,
      :host-context(.emoji-picker-dialog) .emoji-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
    }

    @media (max-width: 360px) {
      .emoji-grid,
      :host-context(.emoji-picker-dialog) .emoji-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    .emoji-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-width: 0;
      height: 40px;
      font-size: 1.45rem;
      border: none;
      background: transparent;
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      transition: background-color 0.15s ease;

      &:hover {
        background-color: var(--mat-sys-surface-container-high);
      }

      .custom-emoji-img {
        width: 28px;
        height: 28px;
        object-fit: contain;
      }
    }

    .emoji-section {
      margin-bottom: 8px;
      overflow-x: hidden;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--mat-sys-on-surface-variant);
    }

    .section-icon {
      line-height: 1;
      font-size: 0.95rem;
    }

    .no-results {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      opacity: 0.5;
      font-size: 0.875rem;

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
      }
    }

    .emoji-set-section {
      margin-bottom: 8px;

      .set-title {
        padding: 4px 4px 2px;
        font-size: 0.75rem;
        opacity: 0.6;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    }

    @media (max-width: 700px),
    (max-height: 700px) {
      :host-context(.emoji-picker-dialog) .emoji-picker {
        height: 100%;
      }

      :host-context(.emoji-picker-dialog) .emoji-search {
        padding: 8px 10px;
      }

      :host-context(.emoji-picker-dialog) .emoji-grid-container,
      :host-context(.emoji-picker-dialog) .emoji-list-scroll {
        padding: 2px 4px 4px;
      }

      :host-context(.emoji-picker-dialog) .emoji-grid {
        gap: 0;
      }

      :host-context(.emoji-picker-dialog) .emoji-btn {
        height: 60px;
        font-size: 2.05rem;

        .custom-emoji-img {
          width: 38px;
          height: 38px;
        }
      }

      :host-context(.emoji-picker-dialog) .emoji-section {
        margin-bottom: 6px;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiPickerComponent {
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly logger = inject(LoggerService);

  /** 'reaction' = emoji only (no GIF tab), 'content' = emoji + GIF tabs */
  mode = input<'reaction' | 'content'>('content');

  /** Which tab to show initially */
  initialTab = input<'emoji' | 'gifs'>('emoji');

  /** Emitted when an emoji is selected */
  emojiSelected = output<string>();

  /** Emitted when a GIF is selected (URL) */
  gifSelected = output<string>();

  activeTab = signal<'emoji' | 'gifs'>('emoji');

  readonly categories = EMOJI_CATEGORIES;
  searchQuery = signal('');
  recentEmojis = signal<RecentEmoji[]>([]);
  emojiSets = signal<EmojiSetGroup[]>([]);

  /** Reset the active tab to the initialTab value. Call this when re-opening the picker (e.g. mat-menu opened). */
  resetTab(): void {
    this.activeTab.set(this.initialTab());
  }

  constructor() {
    // Set initial tab from input whenever it changes
    effect(() => {
      const tab = this.initialTab();
      untracked(() => {
        this.activeTab.set(tab);
      });
    });

    // Load recent emojis and custom emoji sets
    // Also reloads when emojiSetService.preferencesChanged signal updates (e.g. after installing a set)
    effect(() => {
      const pubkey = this.accountState.pubkey();
      // Track the preferencesChanged signal so this effect re-runs when emoji sets are installed/uninstalled
      const _version = this.emojiSetService.preferencesChanged();
      if (!pubkey) return;

      untracked(async () => {
        const recent = this.accountLocalState.getRecentEmojis(pubkey);
        this.recentEmojis.set(recent);
        const sets = await this.emojiSetService.getUserEmojiSetsGrouped(pubkey);
        this.emojiSets.set(sets);
      });
    });
  }

  filteredEmojis = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return [];

    const results: string[] = [];
    const seen = new Set<string>();

    // Search by keyword
    for (const [emoji, keywords] of Object.entries(EMOJI_KEYWORDS)) {
      if (keywords.some(k => k.includes(query)) && !seen.has(emoji)) {
        results.push(emoji);
        seen.add(emoji);
      }
    }

    // Search by emoji character match in categories
    for (const category of EMOJI_CATEGORIES) {
      for (const emoji of category.emojis) {
        if (!seen.has(emoji)) {
          const label = category.label.toLowerCase();
          if (label.includes(query)) {
            results.push(emoji);
            seen.add(emoji);
          }
        }
      }
    }

    return results.slice(0, 50);
  });

  filteredCustomEmojis = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return [];

    const results: { shortcode: string; url: string }[] = [];
    for (const set of this.emojiSets()) {
      for (const emoji of set.emojis) {
        if (emoji.shortcode.toLowerCase().includes(query)) {
          results.push(emoji);
        }
      }
    }
    return results.slice(0, 30);
  });

  selectEmoji(emoji: string): void {
    this.emojiSelected.emit(emoji);

    // Track as recent
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.addRecentEmoji(pubkey, emoji);
      this.recentEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
    }
  }

  selectCustomEmoji(shortcode: string, url: string): void {
    const emoji = `:${shortcode}:`;
    this.emojiSelected.emit(emoji);

    // Track as recent with URL
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.addRecentEmoji(pubkey, emoji, url);
      this.recentEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
    }
  }

  onGifSelected(url: string): void {
    this.gifSelected.emit(url);
  }
}
