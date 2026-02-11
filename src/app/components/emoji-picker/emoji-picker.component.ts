import {
  Component,
  output,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountLocalStateService, RecentEmoji } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

const EMOJI_CATEGORIES = [
  { id: 'smileys', label: 'Smileys', icon: 'sentiment_satisfied', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'] },
  { id: 'gestures', label: 'Gestures', icon: 'waving_hand', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄'] },
  { id: 'hearts', label: 'Hearts', icon: 'favorite', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '❤️‍🔥', '❤️‍🩹'] },
  { id: 'animals', label: 'Animals', icon: 'pets', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈'] },
  { id: 'nature', label: 'Nature', icon: 'eco', emojis: ['🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🍀', '☘️', '🍃', '🍂', '🍁', '🍄', '🌾', '🌿', '🌍', '🌎', '🌏', '🌙', '☀️', '⭐', '🌟', '🌠', '🌈', '🔥', '💧', '🌊', '✨', '💫'] },
  { id: 'food', label: 'Food', icon: 'restaurant', emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥝', '🍅', '🥑', '🌶️', '🌽', '🍔', '🍟', '🍕', '🌮', '🌯', '🥗', '🍝', '🍜', '🍣', '🍱', '🍩', '🍪', '🎂', '🍰', '🍫', '🍬', '🍭', '🍿', '☕', '🍵', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹'] },
  { id: 'activities', label: 'Activities', icon: 'sports_soccer', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🎯', '🎳', '🎮', '🎰', '🧩', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎻', '🎲'] },
  { id: 'objects', label: 'Objects', icon: 'lightbulb', emojis: ['📱', '💻', '⌨️', '🖥️', '📷', '📸', '📹', '📺', '📻', '⏰', '💡', '🔦', '💰', '💳', '💎', '🔧', '🔨', '🔩', '⚙️', '🔫', '💣', '🔪', '🔮', '💊', '💉', '🔑', '🗝️', '🚪', '🛋️', '🛏️', '🧸', '🎁', '🎈', '🎉', '🎊', '✉️', '📦', '📚', '📖', '✏️', '📝', '🔍'] },
  { id: 'symbols', label: 'Symbols', icon: 'emoji_symbols', emojis: ['❤️', '💔', '💯', '💢', '💬', '💭', '🗯️', '❗', '❓', '‼️', '⁉️', '✅', '❌', '⭕', '🚫', '♻️', '⚡', '🔔', '🔕', '🎵', '🎶', '➕', '➖', '➗', '✖️', '💲', '™️', '©️', '®️', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🔘'] },
];

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
};

@Component({
  selector: 'app-emoji-picker',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="emoji-picker" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
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
        </div>
        @if (filteredEmojis().length === 0) {
        <div class="no-results">No emojis found</div>
        }
      </div>
      } @else {
      <!-- Category tabs -->
      <mat-tab-group [selectedIndex]="activeTabIndex()" (selectedIndexChange)="activeTabIndex.set($event)"
        class="emoji-tabs">

        <!-- Recent tab -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon matTooltip="Recent">schedule</mat-icon>
          </ng-template>
          <div class="emoji-grid-container">
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
        </mat-tab>

        @for (category of categories; track category.id) {
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon [matTooltip]="category.label">{{ category.icon }}</mat-icon>
          </ng-template>
          <div class="emoji-grid-container">
            <div class="emoji-grid">
              @for (emoji of category.emojis; track emoji) {
              <button class="emoji-btn" (click)="selectEmoji(emoji); $event.stopPropagation()">
                {{ emoji }}
              </button>
              }
            </div>
          </div>
        </mat-tab>
        }
      </mat-tab-group>
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

    :host-context(.emoji-picker-dialog) .emoji-picker {
      width: 100%;
      max-height: none;
      flex: 1;
      min-height: 0;
    }

    .emoji-picker {
      width: 320px;
      max-height: 350px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
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

    :host-context(.emoji-picker-dialog) .emoji-grid-container {
      max-height: none;
      flex: 1;
      overflow-y: auto;
    }

    .emoji-grid-container {
      overflow-y: auto;
      max-height: 280px;
      padding: 6px;
    }

    :host-context(.emoji-picker-dialog) .emoji-grid {
      grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    }

    :host-context(.emoji-picker-dialog) .emoji-btn {
      width: 100%;
      height: 52px;
      font-size: 1.75rem;

      .custom-emoji-img {
        width: 32px;
        height: 32px;
      }
    }

    :host-context(.emoji-picker-dialog) .emoji-tabs {
      display: flex;
      flex-direction: column;

      ::ng-deep .mat-mdc-tab-header {
        min-height: 44px;
      }

      ::ng-deep .mdc-tab {
        min-width: 40px !important;
        padding: 0 6px;
        height: 44px;
      }

      ::ng-deep .mat-mdc-tab-body-wrapper {
        flex: 1;
      }

      ::ng-deep .mat-mdc-tab-body {
        height: 100%;
      }

      ::ng-deep .mat-mdc-tab-body-content {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
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
      grid-template-columns: repeat(8, 1fr);
      gap: 2px;
    }

    .emoji-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      font-size: 1.25rem;
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
        width: 24px;
        height: 24px;
        object-fit: contain;
      }
    }

    .emoji-tabs {
      flex: 1;
      overflow: hidden;

      ::ng-deep .mat-mdc-tab-header {
        min-height: 36px;
      }

      ::ng-deep .mdc-tab {
        min-width: 32px !important;
        padding: 0 4px;
        height: 36px;
      }

      ::ng-deep .mdc-tab__content {
        padding: 0;
      }

      ::ng-deep .mat-mdc-tab-body-wrapper {
        flex: 1;
        overflow: hidden;
      }

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
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
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiPickerComponent {
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountState = inject(AccountStateService);

  /** Emitted when an emoji is selected */
  emojiSelected = output<string>();

  readonly categories = EMOJI_CATEGORIES;
  searchQuery = signal('');
  activeTabIndex = signal(0);
  recentEmojis = signal<RecentEmoji[]>([]);

  constructor() {
    // Load recent emojis
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const recent = this.accountLocalState.getRecentEmojis(pubkey);
      this.recentEmojis.set(recent);
    }
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

  selectEmoji(emoji: string): void {
    this.emojiSelected.emit(emoji);

    // Track as recent
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.addRecentEmoji(pubkey, emoji);
      this.recentEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
    }
  }
}
