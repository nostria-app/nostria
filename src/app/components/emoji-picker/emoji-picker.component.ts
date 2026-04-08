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
  ElementRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountLocalStateService, RecentEmoji } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { EmojiSetGroup, EmojiSetService } from '../../services/emoji-set.service';
import { LoggerService } from '../../services/logger.service';
import { HapticsService } from '../../services/haptics.service';
import { LocalSettingsService } from '../../services/local-settings.service';
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

interface EmojiSectionNavItem {
  id: string;
  label: string;
  icon: string;
}

const DEFAULT_REACTION_RECENT_EMOJIS = ['+', '-'];

@Component({
  selector: 'app-emoji-picker',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    GifPickerComponent,
  ],
  template: `
    <div class="emoji-picker" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
      <button class="emoji-context-menu-trigger" type="button" [style.left.px]="emojiContextMenuPosition().x"
        [style.top.px]="emojiContextMenuPosition().y" [matMenuTriggerFor]="emojiContextMenu"
        #emojiContextMenuTrigger="matMenuTrigger" aria-hidden="true" tabindex="-1"></button>

      <mat-menu #emojiContextMenu="matMenu" class="emoji-context-menu">
        <button mat-menu-item type="button" (click)="makeEmojiMostRecent()">
          <mat-icon>vertical_align_top</mat-icon>
          <span>Make most recent</span>
        </button>
        <button mat-menu-item type="button" (click)="makeEmojiDefault()">
          <mat-icon>favorite</mat-icon>
          <span>Make default</span>
        </button>
      </mat-menu>

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
          <button class="emoji-btn" [class.default-emoji]="isDefaultEmoji(emoji)" (click)="selectEmoji(emoji); $event.stopPropagation()"
            (contextmenu)="openEmojiContextMenu($event, emoji)" (touchstart)="onEmojiTouchStart($event, emoji)"
            (touchend)="onEmojiTouchEnd()" (touchcancel)="onEmojiTouchEnd()" (touchmove)="onEmojiTouchEnd()">
            {{ emoji }}
          </button>
          }
          @for (emoji of filteredCustomEmojis(); track emoji.shortcode) {
          <button class="emoji-btn custom-emoji" [class.default-emoji]="isDefaultEmoji(':' + emoji.shortcode + ':')"
            (click)="selectCustomEmoji(emoji.shortcode, emoji.url); $event.stopPropagation()"
            (contextmenu)="openEmojiContextMenu($event, ':' + emoji.shortcode + ':', emoji.url)"
            (touchstart)="onEmojiTouchStart($event, ':' + emoji.shortcode + ':', emoji.url)"
            (touchend)="onEmojiTouchEnd()" (touchcancel)="onEmojiTouchEnd()" (touchmove)="onEmojiTouchEnd()"
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
        <div class="emoji-list-scroll" #emojiScrollContainer>
          <div class="emoji-section" data-section-id="recent">
            <div class="section-title">
              <span class="section-icon">🕘</span>
              <span>Recent</span>
            </div>
            @if (visibleRecentEmojis().length > 0) {
            <div class="emoji-grid">
              @for (recent of visibleRecentEmojis(); track recent.emoji) {
              <button class="emoji-btn" [class.default-emoji]="isDefaultEmoji(recent.emoji)"
                (click)="selectEmoji(recent.emoji); $event.stopPropagation()"
                (contextmenu)="openEmojiContextMenu($event, recent.emoji, recent.url)"
                (touchstart)="onEmojiTouchStart($event, recent.emoji, recent.url)" (touchend)="onEmojiTouchEnd()"
                (touchcancel)="onEmojiTouchEnd()" (touchmove)="onEmojiTouchEnd()">
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
          <div class="emoji-section" data-section-id="custom-emojis">
            <div class="section-title">
              <span class="section-icon">🧩</span>
              <span>Custom Emojis</span>
            </div>
            @for (set of emojiSets(); track set.id) {
            <div class="emoji-set-section">
              <div class="set-title">{{ set.title }}</div>
              <div class="emoji-grid">
                @for (emoji of set.emojis; track emoji.shortcode) {
                <button class="emoji-btn custom-emoji" [class.default-emoji]="isDefaultEmoji(':' + emoji.shortcode + ':')"
                  (click)="selectCustomEmoji(emoji.shortcode, emoji.url); $event.stopPropagation()"
                  (contextmenu)="openEmojiContextMenu($event, ':' + emoji.shortcode + ':', emoji.url)"
                  (touchstart)="onEmojiTouchStart($event, ':' + emoji.shortcode + ':', emoji.url)"
                  (touchend)="onEmojiTouchEnd()" (touchcancel)="onEmojiTouchEnd()" (touchmove)="onEmojiTouchEnd()"
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
          <div class="emoji-section" [attr.data-section-id]="category.id">
            <div class="section-title">
              <span class="section-icon">{{ category.icon }}</span>
              <span>{{ category.label }}</span>
            </div>
            <div class="emoji-grid">
              @for (emoji of category.emojis; track emoji) {
              <button class="emoji-btn" [class.default-emoji]="isDefaultEmoji(emoji)"
                (click)="selectEmoji(emoji); $event.stopPropagation()"
                (contextmenu)="openEmojiContextMenu($event, emoji)" (touchstart)="onEmojiTouchStart($event, emoji)"
                (touchend)="onEmojiTouchEnd()" (touchcancel)="onEmojiTouchEnd()" (touchmove)="onEmojiTouchEnd()">
                {{ emoji }}
              </button>
              }
            </div>
          </div>
          }
        </div>

        <div class="emoji-section-nav" (wheel)="onSectionNavWheel($event)"
          (pointerdown)="startSectionNavDrag($event)" (pointermove)="moveSectionNavDrag($event)"
          (pointerup)="endSectionNavDrag($event)" (pointercancel)="endSectionNavDrag($event)"
          (pointerleave)="endSectionNavDrag()">
          @for (section of sectionNavItems(); track section.id) {
          <button class="section-nav-btn" type="button" [matTooltip]="section.label"
            [attr.aria-label]="section.label" (click)="scrollToSection(section.id); $event.stopPropagation()">
            {{ section.icon }}
          </button>
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
    :host-context(.emoji-picker-dialog),
    :host-context(.emoji-picker-dialog-panel),
    :host-context(.desktop-reaction-picker-dialog-panel) {
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

    :host-context(.emoji-picker-dialog) .emoji-picker,
    :host-context(.emoji-picker-dialog-panel) .emoji-picker,
    :host-context(.desktop-reaction-picker-dialog-panel) .emoji-picker {
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
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
    }

    .emoji-picker {
      position: relative;
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

    .emoji-context-menu-trigger {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      opacity: 0;
      pointer-events: none;
      outline: none;
      -webkit-tap-highlight-color: transparent;
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
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: none;
      padding: 4px;
      scrollbar-gutter: stable;
      scrollbar-width: auto;
      scrollbar-color: var(--scrollbar-thumb, var(--mat-sys-outline)) var(--scrollbar-track, transparent);
    }

    :host-context(.emoji-picker-menu) .emoji-grid-container,
    :host-context(.emoji-picker-menu) .emoji-list-scroll {
      background: var(--mat-sys-surface-container-low);
    }

    :host-context(.emoji-picker-dialog) .emoji-list-scroll,
    :host-context(.emoji-picker-dialog-panel) .emoji-list-scroll,
    :host-context(.desktop-reaction-picker-dialog-panel) .emoji-list-scroll,
    :host-context(.emoji-picker-menu) .emoji-list-scroll {
      max-height: none;
      flex: 1;
      overflow-y: auto;
    }

    .emoji-list-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: none;
      padding: 4px;
      scrollbar-gutter: stable;
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

    .emoji-section-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      min-width: 0;
      padding: 6px 4px 4px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      flex-shrink: 0;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      touch-action: pan-x;
      scroll-snap-type: x proximity;
      cursor: grab;

      &:active {
        cursor: grabbing;
      }

      &::-webkit-scrollbar {
        display: none;
      }
    }

    :host-context(.emoji-picker-menu) .emoji-section-nav {
      background: var(--mat-sys-surface-container-high);
      border-top-color: var(--mat-sys-outline);
    }

    .section-nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      scroll-snap-align: center;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      font-size: 1rem;
      transition: background-color 0.15s ease, transform 0.15s ease;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }

      &:active {
        transform: scale(0.96);
      }
    }

    :host-context(.emoji-picker-dialog) .emoji-grid,
    :host-context(.emoji-picker-dialog-panel) .emoji-grid,
    :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    :host-context(.emoji-picker-dialog) .emoji-btn,
    :host-context(.emoji-picker-dialog-panel) .emoji-btn,
    :host-context(.desktop-reaction-picker-dialog-panel) .emoji-btn {
      width: 100%;
      height: 58px;
      font-size: 1.95rem;

      .custom-emoji-img {
        width: 36px;
        height: 36px;
      }
    }

    :host-context(.emoji-picker-dialog) .emoji-search,
    :host-context(.emoji-picker-dialog-panel) .emoji-search,
    :host-context(.desktop-reaction-picker-dialog-panel) .emoji-search {
      padding: 12px 12px 10px;

      .search-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      input {
        font-size: 1.05rem;
        padding-top: 2px;
      }
    }

    @media (min-width: 701px) and (min-height: 701px) {
      :host-context(.emoji-picker-dialog) .emoji-grid-container,
      :host-context(.emoji-picker-dialog-panel) .emoji-grid-container,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid-container,
      :host-context(.emoji-picker-dialog) .emoji-list-scroll,
      :host-context(.emoji-picker-dialog-panel) .emoji-list-scroll,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-list-scroll {
        margin: 8px 10px 10px;
        padding: 6px;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
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
      :host-context(.emoji-picker-dialog) .emoji-grid,
      :host-context(.emoji-picker-dialog-panel) .emoji-grid,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
    }

    @media (max-width: 360px) {
      .emoji-grid,
      :host-context(.emoji-picker-dialog) .emoji-grid,
      :host-context(.emoji-picker-dialog-panel) .emoji-grid,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid {
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
      color: var(--mat-sys-on-surface);
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      transition: background-color 0.15s ease;
      outline: none;
      box-shadow: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;

      &:hover {
        background-color: var(--mat-sys-surface-container-high);
      }

      &:focus,
      &:focus-visible,
      &:active {
        outline: none;
        box-shadow: none;
      }

      .custom-emoji-img {
        width: 28px;
        height: 28px;
        object-fit: contain;
      }

      &.default-emoji {
        background-color: var(--mat-sys-surface-container-high);
        box-shadow: inset 0 0 0 1px var(--mat-sys-primary);
      }

      &.default-emoji:hover {
        background-color: var(--mat-sys-surface-container-highest);
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
      :host-context(.emoji-picker-dialog) .emoji-picker,
      :host-context(.emoji-picker-dialog-panel) .emoji-picker,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-picker {
        height: 100%;
      }

      :host-context(.emoji-picker-dialog) .emoji-search,
      :host-context(.emoji-picker-dialog-panel) .emoji-search,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-search {
        padding: 8px 10px;
      }

      :host-context(.emoji-picker-dialog) .emoji-grid-container,
      :host-context(.emoji-picker-dialog-panel) .emoji-grid-container,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid-container,
      :host-context(.emoji-picker-dialog) .emoji-list-scroll,
      :host-context(.emoji-picker-dialog-panel) .emoji-list-scroll,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-list-scroll {
        padding: 2px 4px 4px;
      }

      :host-context(.emoji-picker-dialog) .emoji-grid,
      :host-context(.emoji-picker-dialog-panel) .emoji-grid,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-grid {
        gap: 0;
      }

      :host-context(.emoji-picker-dialog) .emoji-btn,
      :host-context(.emoji-picker-dialog-panel) .emoji-btn,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-btn {
        height: 60px;
        font-size: 2.05rem;

        .custom-emoji-img {
          width: 38px;
          height: 38px;
        }
      }

      :host-context(.emoji-picker-dialog) .emoji-section,
      :host-context(.emoji-picker-dialog-panel) .emoji-section,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-section {
        margin-bottom: 6px;
      }

      :host-context(.emoji-picker-dialog) .emoji-section-nav,
      :host-context(.emoji-picker-dialog-panel) .emoji-section-nav,
      :host-context(.desktop-reaction-picker-dialog-panel) .emoji-section-nav {
        gap: 3px;
        padding: 6px 4px max(4px, env(safe-area-inset-bottom));
      }

      :host-context(.emoji-picker-dialog) .section-nav-btn,
      :host-context(.emoji-picker-dialog-panel) .section-nav-btn,
      :host-context(.desktop-reaction-picker-dialog-panel) .section-nav-btn {
        height: 36px;
        font-size: 1.1rem;
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
  private readonly haptics = inject(HapticsService);
  private readonly localSettings = inject(LocalSettingsService);

  /** 'reaction' = emoji only (no GIF tab), 'content' = emoji + GIF tabs */
  mode = input<'reaction' | 'content'>('content');
  allowPreferredReactionShortcut = input<boolean>(false);

  /** Which tab to show initially */
  initialTab = input<'emoji' | 'gifs'>('emoji');

  /** Emitted when an emoji is selected */
  emojiSelected = output<string>();

  /** Emitted when a GIF is selected (URL) */
  gifSelected = output<string>();

  private readonly emojiScrollContainer = viewChild<ElementRef<HTMLDivElement>>('emojiScrollContainer');
  private sectionNavDragStrip: HTMLDivElement | null = null;
  private sectionNavPointerId: number | null = null;
  private sectionNavDragStartX = 0;
  private sectionNavStartScrollLeft = 0;
  private sectionNavDragMoved = false;
  private emojiContextMenuTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly EMOJI_CONTEXT_MENU_LONG_PRESS_MS = 500;
  private readonly emojiContextMenuTrigger = viewChild<MatMenuTrigger>('emojiContextMenuTrigger');

  activeTab = signal<'emoji' | 'gifs'>('emoji');
  emojiContextMenuPosition = signal({ x: 0, y: 0 });
  emojiContextMenuTarget = signal<{ emoji: string; url?: string } | null>(null);

  readonly categories = EMOJI_CATEGORIES;
  readonly defaultEmoji = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const preferredEmoji = this.accountLocalState.getPreferredReactionEmoji(pubkey);
      if (preferredEmoji) {
        return preferredEmoji;
      }
    }

    return this.localSettings.defaultReactionEmoji() || '';
  });
  searchQuery = signal('');
  recentEmojis = signal<RecentEmoji[]>([]);
  emojiSets = signal<EmojiSetGroup[]>([]);
  visibleRecentEmojis = computed<RecentEmoji[]>(() => {
    const recentEmojis = this.recentEmojis();
    if (this.mode() !== 'reaction') {
      return recentEmojis;
    }

    const missingDefaults = DEFAULT_REACTION_RECENT_EMOJIS
      .filter(emoji => !recentEmojis.some(entry => entry.emoji === emoji))
      .map(emoji => ({ emoji, timestamp: 0, useCount: 0 }));

    if (missingDefaults.length === 0) {
      return recentEmojis;
    }

    const maxRecentCount = 12;
    const retainedRecent = recentEmojis.slice(0, Math.max(0, maxRecentCount - missingDefaults.length));
    return [...retainedRecent, ...missingDefaults];
  });
  sectionNavItems = computed<EmojiSectionNavItem[]>(() => {
    const sections: EmojiSectionNavItem[] = [
      { id: 'recent', label: 'Recent', icon: '🕘' },
    ];

    if (this.emojiSets().length > 0) {
      sections.push({ id: 'custom-emojis', label: 'Custom Emojis', icon: '🧩' });
    }

    return sections.concat(this.categories.map(category => ({
      id: category.id,
      label: category.label,
      icon: category.icon,
    })));
  });

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

  scrollToSection(sectionId: string): void {
    if (this.sectionNavDragMoved) {
      this.sectionNavDragMoved = false;
      return;
    }

    const scrollContainer = this.emojiScrollContainer()?.nativeElement;
    if (!scrollContainer) return;

    const section = scrollContainer.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
    if (!section) return;

    const offsetTop = section.offsetTop - scrollContainer.offsetTop - 4;
    scrollContainer.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
  }

  onSectionNavWheel(event: WheelEvent): void {
    const nav = event.currentTarget as HTMLDivElement | null;
    if (!nav || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    nav.scrollBy({ left: event.deltaY, behavior: 'auto' });
    event.preventDefault();
  }

  startSectionNavDrag(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;

    const nav = event.currentTarget as HTMLDivElement | null;
    if (!nav) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.section-nav-btn')) {
      return;
    }

    this.sectionNavDragStrip = nav;
    this.sectionNavPointerId = event.pointerId;
    this.sectionNavDragStartX = event.clientX;
    this.sectionNavStartScrollLeft = nav.scrollLeft;
    this.sectionNavDragMoved = false;
    nav.setPointerCapture(event.pointerId);
  }

  moveSectionNavDrag(event: PointerEvent): void {
    if (!this.sectionNavDragStrip || this.sectionNavPointerId !== event.pointerId) return;

    const deltaX = event.clientX - this.sectionNavDragStartX;
    if (Math.abs(deltaX) > 4) {
      this.sectionNavDragMoved = true;
    }

    this.sectionNavDragStrip.scrollLeft = this.sectionNavStartScrollLeft - deltaX;
    event.preventDefault();
  }

  endSectionNavDrag(event?: PointerEvent): void {
    if (this.sectionNavDragStrip && event && this.sectionNavPointerId === event.pointerId) {
      this.sectionNavDragStrip.releasePointerCapture(event.pointerId);
    }

    this.sectionNavDragStrip = null;
    this.sectionNavPointerId = null;
    setTimeout(() => {
      this.sectionNavDragMoved = false;
    }, 0);
  }

  onGifSelected(url: string): void {
    this.gifSelected.emit(url);
  }

  onEmojiTouchStart(event: TouchEvent, emoji: string, url?: string): void {
    this.onEmojiTouchEnd();
    this.emojiContextMenuTimer = setTimeout(() => {
      this.haptics.triggerMedium();
      this.openEmojiContextMenu(event, emoji, url);
    }, this.EMOJI_CONTEXT_MENU_LONG_PRESS_MS);
  }

  onEmojiTouchEnd(): void {
    if (this.emojiContextMenuTimer) {
      clearTimeout(this.emojiContextMenuTimer);
      this.emojiContextMenuTimer = null;
    }
  }

  openEmojiContextMenu(event: Event, emoji: string, url?: string): void {
    if (!this.allowPreferredReactionShortcut()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.blurEventTarget(event);

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    const position = this.getEventLocalPosition(event);
    this.emojiContextMenuTarget.set({ emoji, url });
    this.emojiContextMenuPosition.set(position);

    const trigger = this.emojiContextMenuTrigger();
    if (!trigger) {
      return;
    }

    trigger.closeMenu();
    setTimeout(() => trigger.openMenu());
  }

  makeEmojiMostRecent(): void {
    const pubkey = this.accountState.pubkey();
    const target = this.emojiContextMenuTarget();
    if (!pubkey || !target) {
      return;
    }

    this.accountLocalState.promoteRecentEmoji(pubkey, target.emoji, target.url);
    this.recentEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
  }

  makeEmojiDefault(): void {
    const pubkey = this.accountState.pubkey();
    const target = this.emojiContextMenuTarget();
    if (!pubkey || !target) {
      return;
    }

    this.accountLocalState.setPreferredReactionEmoji(pubkey, target.emoji);
  }

  isDefaultEmoji(emoji: string): boolean {
    return !!emoji && this.defaultEmoji() === emoji;
  }

  private blurEventTarget(event: Event): void {
    const target = event.currentTarget || event.target;
    if (target instanceof HTMLElement) {
      target.blur();
    }
  }

  private blurActiveElement(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  private getEventLocalPosition(event: Event): { x: number; y: number } {
    const hostRect = this.getHostRect();

    if (event instanceof MouseEvent) {
      return {
        x: Math.max(0, event.clientX - hostRect.left),
        y: Math.max(0, event.clientY - hostRect.top),
      };
    }

    if (event instanceof TouchEvent) {
      const touch = event.touches[0] || event.changedTouches[0];
      if (touch) {
        return {
          x: Math.max(0, touch.clientX - hostRect.left),
          y: Math.max(0, touch.clientY - hostRect.top),
        };
      }
    }

    return {
      x: Math.max(0, hostRect.width / 2),
      y: Math.max(0, hostRect.height / 2),
    };
  }

  private getHostRect(): DOMRect {
    const scrollContainer = this.emojiScrollContainer()?.nativeElement;
    const hostElement = scrollContainer?.closest('.emoji-picker') as HTMLElement | null;
    return (hostElement || scrollContainer || document.body).getBoundingClientRect();
  }
}
