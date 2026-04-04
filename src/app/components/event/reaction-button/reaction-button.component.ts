import { Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { CdkOverlayOrigin, ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService, RecentEmoji } from '../../../services/account-local-state.service';
import { EventService, ReactionEvents } from '../../../services/event';
import { ReactionService } from '../../../services/reaction.service';
import { LayoutService } from '../../../services/layout.service';
import { EmojiSetGroup, EmojiSetService } from '../../../services/emoji-set.service';
import { DataService } from '../../../services/data.service';
import { DatabaseService } from '../../../services/database.service';
import { LoggerService } from '../../../services/logger.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { UNICODE_EMOJI_CATEGORIES } from '../../../utils/unicode-emoji-catalog';
import { CustomDialogComponent } from '../../custom-dialog/custom-dialog.component';
import { CustomEmojiComponent } from '../../custom-emoji/custom-emoji.component';
import { EmojiPickerComponent } from '../../emoji-picker/emoji-picker.component';
import { CelebrationBurstComponent } from '../../celebration-burst/celebration-burst.component';
import { HapticsService } from '../../../services/haptics.service';
import { ZapSoundService } from '../../../services/zap-sound.service';

// Emoji categories with icons
const EMOJI_CATEGORIES = UNICODE_EMOJI_CATEGORIES;

// Keyword-based emoji search map
const EMOJI_KEYWORDS: Record<string, string[]> = {
  // Smileys
  '😀': ['grin', 'happy', 'smile', 'face'],
  '😃': ['smile', 'happy', 'grin', 'face', 'open'],
  '😄': ['smile', 'happy', 'grin', 'face', 'eyes'],
  '😁': ['grin', 'teeth', 'happy', 'beam'],
  '😆': ['laugh', 'satisfied', 'xd', 'squint'],
  '😅': ['sweat', 'nervous', 'laugh', 'relief'],
  '🤣': ['rofl', 'rolling', 'laugh', 'lol', 'lmao'],
  '😂': ['laugh', 'cry', 'tears', 'joy', 'lol', 'funny'],
  '🙂': ['smile', 'slight', 'face'],
  '😊': ['blush', 'smile', 'happy', 'pleased'],
  '😇': ['angel', 'innocent', 'halo', 'blessed'],
  '🥰': ['love', 'hearts', 'adore', 'affection'],
  '😍': ['love', 'heart', 'eyes', 'crush', 'adore'],
  '🤩': ['star', 'eyes', 'excited', 'starstruck', 'wow'],
  '😘': ['kiss', 'love', 'heart', 'blow'],
  '😋': ['yummy', 'delicious', 'tongue', 'tasty', 'food'],
  '😛': ['tongue', 'playful', 'silly'],
  '😜': ['wink', 'tongue', 'playful', 'crazy', 'silly'],
  '🤪': ['crazy', 'zany', 'wild', 'goofy', 'silly'],
  '😝': ['tongue', 'squint', 'playful', 'silly'],
  '🤑': ['money', 'rich', 'dollar', 'greedy'],
  '🤗': ['hug', 'hugging', 'embrace', 'open', 'arms'],
  '🤔': ['think', 'thinking', 'hmm', 'consider', 'ponder'],
  '🤐': ['zip', 'mouth', 'secret', 'quiet', 'silent'],
  '🤨': ['raised', 'eyebrow', 'skeptical', 'suspicious'],
  '😐': ['neutral', 'meh', 'blank', 'expressionless'],
  '😑': ['expressionless', 'blank', 'meh', 'unamused'],
  '😶': ['silent', 'mute', 'speechless', 'no', 'mouth'],
  '😏': ['smirk', 'smug', 'sly', 'suggestive'],
  '😒': ['unamused', 'side', 'eye', 'meh', 'annoyed'],
  '🙄': ['eye', 'roll', 'annoyed', 'frustrated', 'whatever'],
  '😬': ['grimace', 'awkward', 'nervous', 'cringe'],
  '😌': ['relieved', 'content', 'peaceful', 'calm'],
  '😔': ['sad', 'pensive', 'disappointed', 'down'],
  '😪': ['sleepy', 'tired', 'sleep', 'drowsy'],
  '🤤': ['drool', 'drooling', 'hungry', 'want', 'desire'],
  '😴': ['sleep', 'sleeping', 'zzz', 'tired', 'snore'],
  '😷': ['mask', 'sick', 'medical', 'covid', 'flu'],
  '🤒': ['sick', 'thermometer', 'fever', 'ill'],
  '🤕': ['hurt', 'injured', 'bandage', 'head'],
  '🤢': ['sick', 'nauseous', 'green', 'queasy'],
  '🤮': ['vomit', 'sick', 'throw', 'up', 'puke'],
  '🤧': ['sneeze', 'sick', 'tissue', 'cold', 'allergies'],
  '🥵': ['hot', 'heat', 'sweating', 'fever', 'overheated'],
  '🥶': ['cold', 'freezing', 'frozen', 'ice', 'winter'],
  '🥴': ['drunk', 'woozy', 'dizzy', 'tipsy', 'intoxicated'],
  '😵': ['dizzy', 'dead', 'knocked', 'out', 'spiral'],
  '🤯': ['mind', 'blown', 'explode', 'shocked', 'wow'],
  '🤠': ['cowboy', 'western', 'yeehaw', 'hat'],
  '🥳': ['party', 'celebration', 'birthday', 'celebrate', 'woohoo'],
  '😎': ['cool', 'sunglasses', 'awesome', 'chill'],
  '🤓': ['nerd', 'geek', 'glasses', 'smart'],
  '🧐': ['monocle', 'fancy', 'investigate', 'curious'],
  // Gestures
  '👍': ['thumbs', 'up', 'like', 'approve', 'yes', 'good', 'ok', 'okay'],
  '👎': ['thumbs', 'down', 'dislike', 'disapprove', 'no', 'bad'],
  '👋': ['wave', 'hi', 'hello', 'bye', 'goodbye', 'hand'],
  '👏': ['clap', 'applause', 'bravo', 'congrats', 'praise'],
  '🙌': ['raise', 'hands', 'hooray', 'celebration', 'praise'],
  '🤝': ['handshake', 'deal', 'agreement', 'partnership'],
  '🙏': ['pray', 'please', 'thanks', 'namaste', 'hope', 'wish'],
  '✌️': ['peace', 'victory', 'two', 'fingers'],
  '🤞': ['crossed', 'fingers', 'luck', 'hope', 'wish'],
  '🤟': ['love', 'you', 'rock', 'sign'],
  '🤘': ['rock', 'metal', 'horns', 'devil'],
  '👌': ['ok', 'okay', 'perfect', 'fine', 'good'],
  '🤌': ['italian', 'pinched', 'fingers', 'chef', 'kiss'],
  '💪': ['muscle', 'strong', 'flex', 'bicep', 'power', 'strength'],
  '👊': ['fist', 'bump', 'punch', 'bro'],
  '✊': ['fist', 'raised', 'power', 'solidarity'],
  // Hearts and love
  '❤️': ['heart', 'love', 'red', 'romance'],
  '🧡': ['heart', 'orange', 'love'],
  '💛': ['heart', 'yellow', 'love', 'friendship'],
  '💚': ['heart', 'green', 'love', 'nature', 'envy'],
  '💙': ['heart', 'blue', 'love', 'trust'],
  '💜': ['heart', 'purple', 'love'],
  '🖤': ['heart', 'black', 'love', 'dark'],
  '🤍': ['heart', 'white', 'love', 'pure'],
  '💕': ['hearts', 'two', 'love', 'affection'],
  '💖': ['heart', 'sparkle', 'love', 'sparkling'],
  '💗': ['heart', 'growing', 'love'],
  '💘': ['heart', 'arrow', 'cupid', 'love', 'valentine'],
  '💝': ['heart', 'ribbon', 'gift', 'love', 'valentine'],
  '💔': ['broken', 'heart', 'sad', 'heartbreak'],
  '🔥': ['fire', 'hot', 'flame', 'lit', 'awesome', 'popular'],
  // Celebration
  '🎉': ['party', 'celebration', 'tada', 'congratulations', 'confetti'],
  '🎊': ['confetti', 'ball', 'party', 'celebration'],
  '🎈': ['balloon', 'party', 'birthday', 'celebration'],
  '🎁': ['gift', 'present', 'wrapped', 'birthday', 'christmas'],
  '🎂': ['cake', 'birthday', 'celebration', 'dessert'],
  '🥂': ['cheers', 'toast', 'champagne', 'celebrate', 'glasses'],
  '🍾': ['champagne', 'bottle', 'celebrate', 'party', 'pop'],
  // Animals
  '🐶': ['dog', 'puppy', 'pet', 'animal', 'cute'],
  '🐱': ['cat', 'kitten', 'pet', 'animal', 'cute'],
  '🐰': ['rabbit', 'bunny', 'pet', 'animal', 'easter'],
  '🐻': ['bear', 'animal', 'teddy', 'cute'],
  '🐼': ['panda', 'bear', 'animal', 'cute', 'china'],
  '🦊': ['fox', 'animal', 'clever', 'cute'],
  '🦁': ['lion', 'king', 'animal', 'brave', 'cat'],
  '🐯': ['tiger', 'animal', 'cat', 'fierce'],
  '🦄': ['unicorn', 'magic', 'fantasy', 'rainbow', 'horse'],
  '🐝': ['bee', 'honey', 'insect', 'buzz'],
  '🦋': ['butterfly', 'insect', 'beautiful', 'nature'],
  '🐢': ['turtle', 'slow', 'animal', 'shell'],
  '🐍': ['snake', 'reptile', 'slither'],
  '🐬': ['dolphin', 'ocean', 'sea', 'marine', 'smart'],
  '🐳': ['whale', 'ocean', 'sea', 'marine', 'big'],
  '🦈': ['shark', 'ocean', 'fish', 'predator'],
  // Food and drink
  '🍕': ['pizza', 'food', 'italian', 'slice'],
  '🍔': ['burger', 'hamburger', 'food', 'fast'],
  '🍟': ['fries', 'french', 'food', 'fast', 'potato'],
  '🌮': ['taco', 'mexican', 'food'],
  '🌯': ['burrito', 'mexican', 'food', 'wrap'],
  '🍣': ['sushi', 'japanese', 'food', 'fish', 'rice'],
  '🍜': ['noodles', 'ramen', 'soup', 'asian', 'food'],
  '🍝': ['spaghetti', 'pasta', 'italian', 'food'],
  '🍦': ['ice', 'cream', 'dessert', 'sweet', 'cold'],
  '🍩': ['donut', 'doughnut', 'dessert', 'sweet'],
  '🍪': ['cookie', 'dessert', 'sweet', 'biscuit'],
  '🍫': ['chocolate', 'candy', 'sweet', 'dessert'],
  '🍰': ['cake', 'slice', 'dessert', 'sweet', 'birthday'],
  '☕': ['coffee', 'drink', 'hot', 'cafe', 'morning', 'espresso'],
  '🍵': ['tea', 'drink', 'hot', 'green', 'japanese'],
  '🍺': ['beer', 'drink', 'alcohol', 'cheers'],
  '🍻': ['beers', 'cheers', 'drink', 'alcohol', 'toast'],
  '🍷': ['wine', 'drink', 'alcohol', 'red', 'glass'],
  // Objects and tech
  '💻': ['computer', 'laptop', 'tech', 'work', 'device'],
  '📱': ['phone', 'mobile', 'smartphone', 'device', 'cell'],
  '⌨️': ['keyboard', 'typing', 'computer', 'tech'],
  '🖥️': ['desktop', 'computer', 'monitor', 'screen'],
  '🎮': ['game', 'controller', 'gaming', 'video', 'play'],
  '🎧': ['headphones', 'music', 'audio', 'listen'],
  '📷': ['camera', 'photo', 'picture', 'photography'],
  '📸': ['camera', 'flash', 'photo', 'selfie'],
  '🎬': ['movie', 'film', 'cinema', 'clapperboard', 'action'],
  '📚': ['books', 'reading', 'study', 'library', 'learn'],
  '📖': ['book', 'reading', 'open', 'study'],
  '✏️': ['pencil', 'write', 'edit', 'school'],
  '💡': ['idea', 'lightbulb', 'bright', 'think', 'creative'],
  '🔑': ['key', 'lock', 'security', 'unlock'],
  '💰': ['money', 'bag', 'rich', 'cash', 'dollar'],
  '💵': ['dollar', 'money', 'cash', 'bill', 'currency'],
  '💎': ['diamond', 'gem', 'precious', 'valuable', 'jewel'],
  // Nature and weather
  '🌸': ['cherry', 'blossom', 'flower', 'spring', 'pink', 'japan'],
  '💮': ['flower', 'white', 'nature'],
  '🏵️': ['rosette', 'flower', 'nature', 'award'],
  '🌹': ['rose', 'flower', 'red', 'love', 'romantic'],
  '🥀': ['wilted', 'flower', 'dead', 'sad', 'withered'],
  '🌻': ['sunflower', 'flower', 'yellow', 'summer', 'sun'],
  '🌺': ['hibiscus', 'flower', 'tropical', 'pink'],
  '🌼': ['blossom', 'flower', 'yellow', 'nature'],
  '🌷': ['tulip', 'flower', 'spring', 'nature', 'pink'],
  '🌱': ['seedling', 'plant', 'grow', 'sprout', 'nature'],
  '🪴': ['potted', 'plant', 'house', 'nature', 'indoor'],
  '🌲': ['evergreen', 'tree', 'pine', 'christmas', 'forest'],
  '🌳': ['tree', 'deciduous', 'nature', 'forest', 'oak'],
  '🌴': ['palm', 'tree', 'tropical', 'beach', 'island'],
  '🌵': ['cactus', 'desert', 'plant', 'dry'],
  '🍀': ['clover', 'four', 'leaf', 'lucky', 'luck', 'irish'],
  '☘️': ['shamrock', 'clover', 'irish', 'nature', 'green'],
  '🍃': ['leaf', 'wind', 'blow', 'nature', 'green'],
  '🍂': ['fallen', 'leaf', 'autumn', 'fall', 'nature'],
  '🍁': ['maple', 'leaf', 'fall', 'autumn', 'canada'],
  '🍄': ['mushroom', 'fungus', 'nature', 'forest'],
  '🌾': ['rice', 'sheaf', 'harvest', 'grain', 'wheat'],
  '🪻': ['hyacinth', 'flower', 'lavender', 'nature', 'purple'],
  '🪷': ['lotus', 'flower', 'nature', 'zen', 'meditation'],
  '🌿': ['herb', 'plant', 'leaf', 'green', 'nature'],
  '🪨': ['rock', 'stone', 'boulder', 'nature'],
  '🌍': ['earth', 'globe', 'world', 'africa', 'europe'],
  '🌎': ['earth', 'globe', 'world', 'americas'],
  '🌏': ['earth', 'globe', 'world', 'asia', 'australia'],
  '🌕': ['full', 'moon', 'night', 'sky'],
  '🌈': ['rainbow', 'colors', 'colorful', 'pride', 'lgbtq'],
  '⭐': ['star', 'favorite', 'night', 'sky', 'special'],
  '🌟': ['star', 'glowing', 'sparkle', 'shine', 'special'],
  '✨': ['sparkles', 'magic', 'shine', 'special', 'glitter', 'new'],
  '💫': ['dizzy', 'star', 'sparkle', 'magic'],
  '🌙': ['moon', 'night', 'crescent', 'sleep'],
  '☀️': ['sun', 'sunny', 'weather', 'bright', 'hot'],
  '⛅': ['cloudy', 'weather', 'partly', 'sun', 'cloud'],
  '🌧️': ['rain', 'rainy', 'weather', 'cloud'],
  '⛈️': ['storm', 'thunder', 'lightning', 'weather'],
  '🌪️': ['tornado', 'storm', 'wind', 'weather', 'twister'],
  '❄️': ['snow', 'snowflake', 'cold', 'winter', 'frozen'],
  '☃️': ['snowman', 'winter', 'cold', 'snow', 'christmas'],
  '⛄': ['snowman', 'winter', 'cold', 'snow'],
  '💧': ['droplet', 'water', 'tear', 'sweat'],
  '🌊': ['wave', 'ocean', 'sea', 'water', 'surf'],
  '☔': ['umbrella', 'rain', 'weather', 'wet'],
  // Misc popular
  '💯': ['hundred', 'perfect', 'score', '100', 'complete'],
  '✅': ['check', 'done', 'complete', 'yes', 'correct'],
  '❌': ['cross', 'wrong', 'no', 'incorrect', 'cancel', 'delete'],
  '❗': ['exclamation', 'important', 'alert', 'attention'],
  '❓': ['question', 'what', 'confused', 'ask'],
  '💤': ['sleep', 'zzz', 'tired', 'sleepy', 'snore'],
  '💬': ['speech', 'bubble', 'talk', 'chat', 'message', 'comment'],
  '👀': ['eyes', 'look', 'see', 'watch', 'stare', 'peek'],
  '👁️': ['eye', 'look', 'see', 'watch'],
  '🗣️': ['speaking', 'head', 'talk', 'say', 'announce'],
  '🚀': ['rocket', 'launch', 'space', 'fast', 'moon', 'ship'],
  '⚡': ['lightning', 'bolt', 'electric', 'fast', 'power', 'energy', 'zap'],
  '🏆': ['trophy', 'winner', 'champion', 'award', 'prize', 'first'],
  '🎯': ['target', 'bullseye', 'goal', 'aim', 'direct'],
  '🎵': ['music', 'note', 'song', 'melody'],
  '🎶': ['music', 'notes', 'song', 'melody', 'singing'],
  '🔔': ['bell', 'notification', 'alert', 'ring'],
  '📌': ['pin', 'pushpin', 'location', 'mark', 'important'],
  '🔗': ['link', 'chain', 'url', 'connection'],
  '⚙️': ['gear', 'settings', 'config', 'cog', 'options'],
  '🛠️': ['tools', 'build', 'repair', 'fix', 'work'],
  '⏰': ['alarm', 'clock', 'time', 'wake'],
  '📅': ['calendar', 'date', 'schedule', 'event'],
  '📊': ['chart', 'graph', 'statistics', 'data', 'bar'],
  '📈': ['chart', 'increase', 'up', 'growth', 'trending'],
  '📉': ['chart', 'decrease', 'down', 'decline'],
};

type ViewMode = 'icon' | 'full';

interface ReactionGroup {
  content: string;
  count: number;
  pubkeys: string[];
  userReacted: boolean;
}

interface ReactionEmojiSectionNavItem {
  id: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-reaction-button',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    OverlayModule,
    CustomDialogComponent,
    CustomEmojiComponent,
    EmojiPickerComponent,
    CelebrationBurstComponent,
  ],
  templateUrl: './reaction-button.component.html',
  styleUrls: ['./reaction-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly reactionService = inject(ReactionService);
  private readonly layout = inject(LayoutService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly data = inject(DataService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly localSettings = inject(LocalSettingsService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly haptics = inject(HapticsService);
  private readonly zapSound = inject(ZapSoundService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly elRef = inject(ElementRef);

  // Menu trigger references to close the menu after reaction
  private readonly menuTrigger = viewChild<MatMenuTrigger>('menuTrigger');
  private readonly menuTriggerFull = viewChild<MatMenuTrigger>('menuTriggerFull');
  readonly quickReactionOrigin = viewChild<CdkOverlayOrigin>('quickReactionOrigin');
  protected readonly isHandset = this.layout.isHandset.asReadonly();
  readonly desktopQuickReactionPositions: ConnectedPosition[] = [
    {
      originX: 'center',
      originY: 'bottom',
      overlayX: 'center',
      overlayY: 'top',
      offsetY: 4,
    },
  ];

  /** Opens the reaction picker menu. Called from parent when label is clicked. */
  openMenu(): void {
    if (this.disabled()) {
      return;
    }

    if (this.isHandset()) {
      void this.openReactionPickerDialog();
      return;
    }

    this.desktopHoverMenuActive.set(false);
  }

  openFullReactionPicker(event: globalThis.MouseEvent): void {
    event.stopPropagation();

    if (this.disabled()) {
      return;
    }

    if (this.isHandset()) {
      void this.openReactionPickerDialog();
      return;
    }

    this.menuTriggerFull()?.openMenu();
  }

  // Long-press detection state
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;
  private readonly LONG_PRESS_DURATION = 500; // ms
  private readonly DESKTOP_HOVER_CLOSE_DELAY = 280;
  private reactionsMutationVersion = 0;
  private suppressNextClick = false;
  private pointerDownType: string | null = null;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  protected desktopHoverOpen = signal(false);
  protected desktopHoverSurfaceActive = signal(false);
  protected desktopHoverMenuActive = signal(false);
  protected likeCelebrationTier = signal(0);
  private likeCelebrationTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Send the user's default reaction emoji (from settings) on a single tap.
   * If the user already reacted, toggle off their reaction instead.
   */
  sendDefaultReaction(): void {
    if (this.disabled()) {
      return;
    }

    if (this.tapBehavior() === 'like') {
      void this.toggleLike();
      return;
    }

    const defaultEmoji = this.defaultReaction()?.emoji || this.localSettings.defaultReactionEmoji();

    if (this.userReaction()) {
      void this.toggleLike();
      return;
    }

    if (!defaultEmoji) {
      this.openMenu();
      return;
    }

    if (this.isStandardLikeEmoji(defaultEmoji)) {
      void this.toggleLike();
      return;
    }

    this.addReaction(defaultEmoji, false);
  }

  /**
   * Handle pointer down for long-press detection.
   * Starts a timer; if held long enough, opens the emoji picker (or touch quick-select on touch).
   */
  onPointerDown(event: PointerEvent): void {
    if (!this.isBrowser || this.disabled()) return;
    this.longPressTriggered = false;
    this.pointerDownType = event.pointerType || null;
    const isTouch = event.pointerType === 'touch';
    const pointerId = event.pointerId;
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      if (isTouch) {
        this.openTouchQuickSelect(pointerId);
      } else {
        this.openMenu();
      }
    }, this.LONG_PRESS_DURATION);
  }

  /**
   * Handle pointer up: if long-press was not triggered, send the default reaction.
   * If touch quick-select is active, delegate to its handler.
   */
  onPointerUp(event: PointerEvent): void {
    if (!this.isBrowser || this.disabled()) return;
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    // If touch quick-select is active, the global pointerup listener handles it
    if (this.touchQuickSelectVisible()) {
      this.suppressNextClick = true;
      this.pointerDownType = null;
      return;
    }

    const pointerType = this.pointerDownType;
    if (this.longPressTriggered) {
      this.suppressNextClick = true;
    } else if (pointerType === 'touch' || pointerType === 'pen') {
      event.preventDefault();
      event.stopPropagation();
      this.suppressNextClick = true;
      this.sendDefaultReaction();
    }

    this.pointerDownType = null;
    this.longPressTriggered = false;
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();

    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      this.pointerDownType = null;
      return;
    }

    this.pointerDownType = null;
    this.sendDefaultReaction();
  }

  onDesktopMouseEnter(): void {
    if (this.isHandset() || this.disabled() || !this.enableDesktopHoverPicker()) {
      return;
    }

    this.desktopHoverOpen.set(true);
    this.desktopHoverSurfaceActive.set(true);

    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }

    this.desktopHoverMenuActive.set(false);
  }

  onDesktopMouseLeave(): void {
    if (this.isHandset() || !this.enableDesktopHoverPicker()) {
      return;
    }

    this.desktopHoverSurfaceActive.set(false);

    this.scheduleDesktopHoverClose();
  }

  onDesktopMenuMouseEnter(): void {
    if (this.isHandset() || this.disabled() || !this.enableDesktopHoverPicker()) {
      return;
    }

    this.desktopHoverOpen.set(true);
    this.desktopHoverMenuActive.set(true);

    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
  }

  onDesktopMenuMouseLeave(): void {
    if (this.isHandset() || !this.enableDesktopHoverPicker()) {
      return;
    }

    this.desktopHoverMenuActive.set(false);

    this.scheduleDesktopHoverClose();
  }

  private scheduleDesktopHoverClose(): void {
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
    }

    this.hoverCloseTimer = setTimeout(() => {
      if (this.desktopHoverSurfaceActive() || this.desktopHoverMenuActive()) {
        this.hoverCloseTimer = null;
        return;
      }

      this.desktopHoverOpen.set(false);
      this.hoverCloseTimer = null;
    }, this.DESKTOP_HOVER_CLOSE_DELAY);
  }

  openDesktopFullReactionPicker(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();

    if (this.isHandset() || this.disabled()) {
      return;
    }

    this.desktopHoverMenuActive.set(false);
    this.desktopHoverOpen.set(false);
    this.desktopHoverSurfaceActive.set(false);
    this.menuTriggerFull()?.openMenu();
  }

  /**
   * Cancel long-press if pointer leaves the element.
   */
  onPointerLeave(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    // Don't reset longPressTriggered if touch quick-select is active
    if (!this.touchQuickSelectVisible()) {
      this.longPressTriggered = false;
    }
    this.pointerDownType = null;
  }

  // --- Touch quick-select emoji bar ---
  touchQuickSelectVisible = signal(false);
  touchQuickSelectAnimating = signal(false);
  touchQuickSelectIndex = signal<number>(-1);
  touchQuickSelectLeft = signal(0);
  touchQuickSelectBottom = signal(0);
  private touchQuickSelectPointerId: number | null = null;
  /** Cached bar screen-space rect so we don't depend on DOM queries during move. */
  private touchQuickBarScreenLeft = 0;
  private touchQuickBarScreenTop = 0;
  private touchQuickBarScreenWidth = 0;
  private touchQuickBarItemCount = 0;
  /** Bound listener refs for cleanup. */
  private boundTouchMove: ((e: PointerEvent) => void) | null = null;
  private boundTouchUp: ((e: PointerEvent) => void) | null = null;
  private boundTouchCancel: ((e: PointerEvent) => void) | null = null;

  /** Items shown in the touch quick-select bar. Shares the same source list as desktop quick reactions. */
  touchQuickSelectItems = computed<{ emoji: string; url?: string }[]>(() => {
    return this.desktopQuickReactions().slice(0, 6);
  });

  /**
   * Open the touch quick-select bar above the button.
   * Called instead of openMenu() when pointer type is touch.
   */
  private openTouchQuickSelect(pointerId: number): void {
    this.touchQuickSelectPointerId = pointerId;
    this.touchQuickSelectIndex.set(-1);

    const itemCount = this.touchQuickSelectItems().length + 1; // +1 for "+" button
    this.touchQuickBarItemCount = itemCount;
    const barWidth = itemCount * 48 + 12; // ~48px per item + padding

    // Position the bar centered above the button
    const container = this.elRef.nativeElement.querySelector('.reaction-container') as HTMLElement | null;
    const buttonEl = this.elRef.nativeElement.querySelector('button') as HTMLElement | null;
    if (buttonEl && container) {
      const buttonRect = buttonEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Center bar over the button
      let left = buttonRect.left + buttonRect.width / 2 - containerRect.left - barWidth / 2;
      // Clamp so bar doesn't go off screen
      const leftEdge = -containerRect.left + 8;
      const rightEdge = window.innerWidth - containerRect.left - barWidth - 8;
      left = Math.max(leftEdge, Math.min(rightEdge, left));
      this.touchQuickSelectLeft.set(left);
      this.touchQuickSelectBottom.set(buttonRect.height + 8);

      // Cache the bar's expected screen position for hit-testing during moves
      this.touchQuickBarScreenLeft = containerRect.left + left;
      this.touchQuickBarScreenTop = buttonRect.top - buttonRect.height - 8 - 60; // generous top bound
      this.touchQuickBarScreenWidth = barWidth;
    }

    this.touchQuickSelectVisible.set(true);
    // Haptic feedback when bar appears
    navigator.vibrate?.(15);

    // Attach global listeners so we get events regardless of which element the touch is over.
    this.boundTouchMove = (e: PointerEvent) => {
      this.onTouchQuickSelectMove(e);
    };
    this.boundTouchUp = (e: PointerEvent) => this.onTouchQuickSelectUp(e);
    this.boundTouchCancel = () => this.closeTouchQuickSelect();
    document.addEventListener('pointermove', this.boundTouchMove);
    document.addEventListener('pointerup', this.boundTouchUp);
    document.addEventListener('pointercancel', this.boundTouchCancel);

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      this.touchQuickSelectAnimating.set(true);
    });
  }

  /** Track finger movement and highlight the emoji under the finger. */
  onTouchQuickSelectMove(event: PointerEvent): void {
    if (!this.touchQuickSelectVisible()) return;

    // Use cached screen-space position instead of querying the DOM
    const x = event.clientX - this.touchQuickBarScreenLeft;
    const itemCount = this.touchQuickBarItemCount;
    const barWidth = this.touchQuickBarScreenWidth;
    const itemWidth = barWidth / itemCount;

    // Allow generous vertical tolerance
    if (x < -20 || x > barWidth + 20) {
      this.touchQuickSelectIndex.set(-1);
      return;
    }

    const clamped = Math.max(0, Math.min(x, barWidth - 1));
    const index = Math.min(Math.floor(clamped / itemWidth), itemCount - 1);
    const prev = this.touchQuickSelectIndex();
    if (index !== prev) {
      this.touchQuickSelectIndex.set(index);
      navigator.vibrate?.(8);
    }
  }

  /** Handle finger release — send the selected reaction or open full picker. */
  onTouchQuickSelectUp(_event: PointerEvent): void {
    const selectedIndex = this.touchQuickSelectIndex();
    const items = this.touchQuickSelectItems();

    this.closeTouchQuickSelect();

    if (selectedIndex >= 0 && selectedIndex < items.length) {
      // Selected an emoji — send it as reaction
      this.addReaction(items[selectedIndex].emoji, false);
    } else if (selectedIndex === items.length) {
      // Selected the "+" button — open full picker
      setTimeout(() => this.openMenu(), 50);
    }
    // If selectedIndex is -1 (no selection), do nothing
  }

  /** Cancel the touch quick-select without selecting. */
  onTouchQuickSelectCancel(): void {
    this.closeTouchQuickSelect();
  }

  private closeTouchQuickSelect(): void {
    // Remove global listeners
    if (this.boundTouchMove) {
      document.removeEventListener('pointermove', this.boundTouchMove);
      this.boundTouchMove = null;
    }
    if (this.boundTouchUp) {
      document.removeEventListener('pointerup', this.boundTouchUp);
      this.boundTouchUp = null;
    }
    if (this.boundTouchCancel) {
      document.removeEventListener('pointercancel', this.boundTouchCancel);
      this.boundTouchCancel = null;
    }
    this.touchQuickSelectVisible.set(false);
    this.touchQuickSelectAnimating.set(false);
    this.touchQuickSelectPointerId = null;
    this.longPressTriggered = false;
  }

  isLoadingReactions = signal<boolean>(false);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  customEmojis = signal<{ shortcode: string; url: string }[]>([]);
  emojiSets = signal<EmojiSetGroup[]>([]);
  recentEmojis = signal<RecentEmoji[]>([]);
  emojiSearchQuery = signal<string>('');
  showSigningErrorDialog = signal<boolean>(false);
  signingErrorMessage = signal<string>('');
  private sectionNavDragStrip: HTMLDivElement | null = null;
  private sectionNavPointerId: number | null = null;
  private sectionNavDragStartX = 0;
  private sectionNavStartScrollLeft = 0;
  private sectionNavDragMoved = false;

  // Emoji categories for sectioned display
  readonly emojiCategories = EMOJI_CATEGORIES;
  readonly sectionNavItems = computed<ReactionEmojiSectionNavItem[]>(() => {
    const sections: ReactionEmojiSectionNavItem[] = [
      { id: 'recent', label: 'Recent', icon: '🕘' },
    ];

    if (this.emojiSets().length > 0) {
      sections.push({ id: 'custom-emojis', label: 'Custom Emojis', icon: '🧩' });
    }

    return sections.concat(this.emojiCategories.map(category => ({
      id: category.id,
      label: category.label,
      icon: category.icon,
    })));
  });

  // Quick reactions for the picker
  readonly quickReactions = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

  desktopQuickReactions = computed<{ emoji: string; url?: string }[]>(() => {
    const pubkey = this.accountState.pubkey();
    const recent = pubkey ? this.accountLocalState.getRecentEmojis(pubkey) : [];
    const recentItems = recent
      .filter(item => item.emoji)
      .slice(0, 6)
      .map(item => ({ emoji: item.emoji, url: item.url }));

    if (recentItems.length >= 6) {
      return recentItems;
    }

    const defaultItem = this.defaultReaction();
    const baseItems = [...recentItems, defaultItem, ...this.quickReactions.map(emoji => ({ emoji }))]
      .filter((item): item is { emoji: string; url?: string } => !!item?.emoji);

    const uniqueItems: { emoji: string; url?: string }[] = [];
    for (const item of baseItems) {
      if (uniqueItems.some(existing => existing.emoji === item.emoji && existing.url === item.url)) {
        continue;
      }

      uniqueItems.push(item);
      if (uniqueItems.length >= 6) {
        break;
      }
    }

    return uniqueItems;
  });

  defaultReaction = computed<{ emoji: string; url?: string } | null>(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return { emoji: this.localSettings.defaultReactionEmoji() || '❤️' };
    }

    const preferredReaction = this.accountLocalState.getMostUsedReactionEmoji(pubkey);
    if (preferredReaction) {
      return preferredReaction;
    }

    return { emoji: this.localSettings.defaultReactionEmoji() || '❤️' };
  });

  event = input.required<Event>();
  view = input<ViewMode>('icon');
  tapBehavior = input<'default-reaction' | 'like'>('default-reaction');
  disabled = input<boolean>(false);
  enableDesktopHoverPicker = input<boolean>(true);
  // Accept reactions from parent to avoid duplicate queries
  // If not provided, component will load independently
  reactionsFromParent = input<ReactionEvents | null>(null);

  // Output to notify parent to reload reactions
  reactionChanged = output<void>();

  likeReaction = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reactions().events.find(
      r => r.event.pubkey === this.accountState.pubkey() && r.event.content === '+'
    );
  });

  likes = computed<NostrRecord[]>(() => {
    return this.reactions().events.filter(r => r.event.content === '+');
  });

  // Computed: Get user's reaction (any emoji they reacted with)
  userReaction = computed<NostrRecord | undefined>(() => {
    const event = this.event();
    if (!event) return;
    return this.reactions().events.find(
      r => r.event.pubkey === this.accountState.pubkey()
    );
  });

  // Computed: Group reactions by emoji
  reactionGroups = computed<ReactionGroup[]>(() => {
    const currentUserPubkey = this.accountState.pubkey();
    const groups = new Map<string, ReactionGroup>();
    const reactions = this.reactions();

    for (const record of reactions.events) {
      const emoji = record.event.content;
      if (!groups.has(emoji)) {
        groups.set(emoji, {
          content: emoji,
          count: 0,
          pubkeys: [],
          userReacted: false
        });
      }
      const group = groups.get(emoji)!;
      group.count++;
      group.pubkeys.push(record.event.pubkey);
      if (record.event.pubkey === currentUserPubkey) {
        group.userReacted = true;
      }
    }

    return Array.from(groups.values());
  });

  // Computed: Total reaction count
  totalReactionCount = computed<number>(() => {
    return this.reactions().events.length;
  });

  // Computed: Search results for emoji search
  searchResults = computed<{ unicode: string[]; custom: { shortcode: string; url: string }[] }>(() => {
    const query = this.emojiSearchQuery().toLowerCase().trim();
    if (!query) {
      return { unicode: [], custom: [] };
    }

    // Search unicode emojis by keywords
    const unicodeMatches: string[] = [];
    for (const [emoji, keywords] of Object.entries(EMOJI_KEYWORDS)) {
      if (keywords.some(kw => kw.includes(query))) {
        unicodeMatches.push(emoji);
      }
    }

    // Also search all category emojis if not found in keywords
    if (unicodeMatches.length < 20) {
      for (const category of EMOJI_CATEGORIES) {
        for (const emoji of category.emojis) {
          if (!unicodeMatches.includes(emoji)) {
            // Check if category label matches
            if (category.label.toLowerCase().includes(query)) {
              unicodeMatches.push(emoji);
            }
          }
        }
      }
    }

    // Search custom emojis by shortcode
    const customMatches = this.customEmojis().filter(e =>
      e.shortcode.toLowerCase().includes(query)
    );

    return {
      unicode: unicodeMatches.slice(0, 50),
      custom: customMatches.slice(0, 20)
    };
  });

  constructor() {
    // Load user's custom emojis and emoji sets
    // Also reloads when emojiSetService.preferencesChanged signal updates (e.g. after installing a set)
    effect(() => {
      const pubkey = this.accountState.pubkey();
      // Track the preferencesChanged signal so this effect re-runs when emoji sets are installed/uninstalled
      const _version = this.emojiSetService.preferencesChanged();
      if (!pubkey) {
        this.customEmojis.set([]);
        this.emojiSets.set([]);
        this.recentEmojis.set([]);
        return;
      }

      untracked(async () => {
        try {
          // Load recent emojis from local state
          const recent = this.accountLocalState.getRecentEmojis(pubkey);
          this.recentEmojis.set(recent);

          // Load user's custom emojis
          const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
          const emojiArray = Array.from(userEmojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
          this.customEmojis.set(emojiArray);

          // Load emoji sets grouped by set for tabbed display
          const sets = await this.emojiSetService.getUserEmojiSetsGrouped(pubkey);
          this.emojiSets.set(sets);
        } catch (error) {
          this.logger.error('Failed to load custom emojis for reactions:', error);
          this.customEmojis.set([]);
          this.emojiSets.set([]);
        }
      });
    });

    // Watch for parent reactions and use them when available
    effect(() => {
      const parentReactions = this.reactionsFromParent();

      // If parent provides reactions, use them
      if (parentReactions !== null) {
        this.reactionsMutationVersion++;
        this.reactions.set(this.filterReactionsForCurrentEvent(parentReactions));
      }
    });

    // Fallback: Load reactions independently only if parent doesn't provide them
    // This handles standalone usage of the component
    effect(() => {
      const event = this.event();
      const parentReactions = this.reactionsFromParent();

      if (!event || parentReactions !== null) {
        return;
      }

      // Load independently only if no parent data is being managed
      untracked(async () => {
        this.loadReactions();
      });
    });
  }

  private filterReactionsForCurrentEvent(reactions: ReactionEvents): ReactionEvents {
    const currentEvent = this.event();
    if (!currentEvent || reactions.events.length === 0) {
      return reactions;
    }

    const dTag = currentEvent.tags.find(tag => tag[0] === 'd')?.[1];
    const eventAddress = dTag ? `${currentEvent.kind}:${currentEvent.pubkey}:${dTag}` : null;

    const filteredEvents = reactions.events.filter(record => {
      const tags = record.event.tags;
      const matchesEventId = tags.some(tag => tag[0] === 'e' && tag[1] === currentEvent.id);
      const matchesAddress = !!eventAddress && tags.some(tag => tag[0] === 'a' && tag[1] === eventAddress);
      return matchesEventId || matchesAddress;
    });

    if (filteredEvents.length === reactions.events.length) {
      return reactions;
    }

    const filteredCounts = new Map<string, number>();
    filteredEvents.forEach(record => {
      const emoji = record.event.content?.trim();
      if (!emoji) {
        return;
      }

      filteredCounts.set(emoji, (filteredCounts.get(emoji) || 0) + 1);
    });

    return {
      events: filteredEvents,
      data: filteredCounts,
    };
  }

  async addReaction(emoji: string, closePicker = true) {
    if (this.isLoadingReactions()) {
      return;
    }

    if (closePicker) {
      this.closeMenu();
    }

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;

    // Check if user already reacted with this emoji
    const existingReaction = this.reactions().events.find(
      r => r.event.pubkey === userPubkey && r.event.content === emoji
    );

    if (existingReaction) {
      // Remove the reaction
      await this.removeReaction(existingReaction, emoji);
    } else {
      // Check if user has any existing reaction (to remove it first if different)
      const userExistingReaction = this.userReaction();
      if (userExistingReaction) {
        // Remove old reaction first
        await this.removeReaction(userExistingReaction, userExistingReaction.event.content);
      }
      // Add new reaction
      await this.addNewReaction(emoji);
    }
  }

  closeMenu() {
    this.menuTrigger()?.closeMenu();
    this.menuTriggerFull()?.closeMenu();
  }

  scrollToReactionSection(scrollContainer: HTMLDivElement, sectionId: string): void {
    if (this.sectionNavDragMoved) {
      this.sectionNavDragMoved = false;
      return;
    }

    const section = scrollContainer.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
    if (!section) return;

    const offsetTop = section.offsetTop - scrollContainer.offsetTop - 8;
    scrollContainer.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
  }

  onReactionSectionNavWheel(event: WheelEvent): void {
    const nav = event.currentTarget as HTMLDivElement | null;
    if (!nav || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    nav.scrollBy({ left: event.deltaY, behavior: 'auto' });
    event.preventDefault();
  }

  startReactionSectionNavDrag(event: PointerEvent): void {
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

  moveReactionSectionNavDrag(event: PointerEvent): void {
    if (!this.sectionNavDragStrip || this.sectionNavPointerId !== event.pointerId) return;

    const deltaX = event.clientX - this.sectionNavDragStartX;
    if (Math.abs(deltaX) > 4) {
      this.sectionNavDragMoved = true;
    }

    this.sectionNavDragStrip.scrollLeft = this.sectionNavStartScrollLeft - deltaX;
    event.preventDefault();
  }

  endReactionSectionNavDrag(event?: PointerEvent): void {
    if (this.sectionNavDragStrip && event && this.sectionNavPointerId === event.pointerId) {
      this.sectionNavDragStrip.releasePointerCapture(event.pointerId);
    }

    this.sectionNavDragStrip = null;
    this.sectionNavPointerId = null;
    setTimeout(() => {
      this.sectionNavDragMoved = false;
    }, 0);
  }

  private async openReactionPickerDialog(): Promise<void> {
    this.closeMenu();

    const { EmojiPickerDialogComponent } = await import('../../emoji-picker/emoji-picker-dialog.component');
    const dialogRef = this.customDialog.open<typeof EmojiPickerDialogComponent.prototype, string>(EmojiPickerDialogComponent, {
      title: 'React',
      width: '400px',
      panelClass: 'emoji-picker-dialog',
      data: { mode: 'reaction', activeTab: 'emoji', allowPreferredReactionShortcut: true },
    });

    dialogRef.afterClosed$.subscribe(async result => {
      if (result.result) {
        await this.addReaction(result.result, false);
      }
    });
  }

  private async removeReaction(reaction: NostrRecord, emoji: string) {
    this.isLoadingReactions.set(true);
    try {
      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
      const result = await this.reactionService.deleteReaction(reaction.event);
      if (!result.success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
        this.handleReactionError(result.error, 'Failed to remove reaction. Please try again.');
      } else {
        // Notify parent to reload reactions
        this.reactionChanged.emit();
      }
      // Reload reactions in the background to sync
      setTimeout(() => this.loadReactions(true), 2000);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  private async addNewReaction(emoji: string) {
    const event = this.event();
    if (!event) return;

    this.isLoadingReactions.set(true);
    try {
      // Look up emoji URL from customEmojis or emojiSets before creating reaction
      // This ensures the emoji tag is added to the reaction event (NIP-30)
      let emojiUrl: string | undefined;
      if (emoji.startsWith(':') && emoji.endsWith(':')) {
        const shortcode = emoji.slice(1, -1);
        // First check customEmojis
        const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
        if (customEmoji?.url) {
          emojiUrl = customEmoji.url;
        } else {
          // Fallback: check emojiSets
          for (const set of this.emojiSets()) {
            const setEmoji = set.emojis.find(e => e.shortcode === shortcode);
            if (setEmoji?.url) {
              emojiUrl = setEmoji.url;
              break;
            }
          }
        }
      }

      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
      const result = await this.reactionService.addReaction(emoji, event, emojiUrl);
      if (!result.success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
        this.handleReactionError(result.error, 'Failed to add reaction. Please try again.');
      } else {
        if (result.event) {
          if (this.disabled()) {
            return;
          }
        }

        this.haptics.triggerLight();
        this.zapSound.playLikeSound();
        this.triggerReactionCelebration(emoji);
        // Track emoji usage for recent emojis
        this.trackEmojiUsage(emoji, emojiUrl);
        // Notify parent to reload reactions
        this.reactionChanged.emit();
      }
      // Reload reactions in the background to sync
      setTimeout(() => this.loadReactions(true), 2000);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  async toggleLike() {
    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      // Show login dialog if no account is active or if using a preview account
      await this.layout.showLoginDialog();
      return;
    }

    const event = this.event();
    if (!event) return;

    this.isLoadingReactions.set(true);

    try {
      const existingLikeReaction = this.userReaction();

      if (existingLikeReaction) {
        // Remove the current reaction, regardless of whether it was stored as '+' or an emoji.
        this.updateReactionsOptimistically(userPubkey, existingLikeReaction.event.content, false);

        const result = await this.reactionService.deleteReaction(existingLikeReaction.event);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, existingLikeReaction.event.content, true);
          this.handleReactionError(result.error, 'Failed to remove like. Please try again.');
        } else {
          this.reactionChanged.emit();
        }
      } else {
        // Add like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', true);

        const result = await this.reactionService.addLike(event);
        if (!result.success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', false);
          this.handleReactionError(result.error, 'Failed to add like. Please try again.');
        } else if (result.event) {
          this.replaceOptimisticReactionWithSigned(userPubkey, '+', result.event);
        }

        if (result.success) {
          this.haptics.triggerMedium();
          this.zapSound.playLikeSound();
          this.triggerReactionCelebration('+');
          this.reactionChanged.emit();
        }
      }

      // Reload reactions in the background to sync with the network
      setTimeout(() => {
        this.loadReactions(true);
      }, 2000);

    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  isExtensionError(error?: string): boolean {
    if (!error) return false;
    return error.includes('Nostr extension not found') ||
      error.includes('NIP-07') ||
      error.includes('extension');
  }

  handleReactionError(error: string | undefined, fallbackMessage: string): void {
    if (this.isExtensionError(error)) {
      this.signingErrorMessage.set(error!);
      this.showSigningErrorDialog.set(true);
    } else {
      this.snackBar.open(fallbackMessage, 'Dismiss', { duration: 3000 });
    }
  }

  closeSigningErrorDialog(): void {
    this.showSigningErrorDialog.set(false);
    this.signingErrorMessage.set('');
  }

  private isStandardLikeEmoji(emoji: string): boolean {
    return emoji === '+' || emoji === '❤️';
  }

  async loadReactions(invalidateCache = false) {
    const event = this.event();
    if (!event) return;

    const sourceRelayUrls = this.data.toRecord(event).relayUrls ?? [];

    this.isLoadingReactions.set(true);
    const mutationVersionAtStart = this.reactionsMutationVersion;
    try {
      const reactions = await this.eventService.loadReactions(
        event.id,
        event.pubkey,
        invalidateCache,
        sourceRelayUrls,
      );

      if (mutationVersionAtStart !== this.reactionsMutationVersion) {
        return;
      }

      this.reactionsMutationVersion++;
      this.reactions.set(reactions);
    } finally {
      this.isLoadingReactions.set(false);
    }
  }

  /**
   * Get the display text for a reaction
   * Converts '+' to heart emoji, otherwise displays the actual reaction content
   */
  getReactionDisplay(content: string): string {
    if (!content || content === '+') {
      return '❤️';
    }
    return content;
  }

  /**
   * Look up a custom emoji URL by shortcode from user's loaded emoji sets.
   * Checks customEmojis, recentEmojis, and emojiSets in order.
   * @param shortcode The emoji shortcode without colons (e.g., 'catJAM')
   * @param emojiWithColons The full emoji string with colons (e.g., ':catJAM:') for recent emoji lookup
   */
  private lookupEmojiUrlByShortcode(shortcode: string, emojiWithColons?: string): string | null {
    // Check user's loaded custom emojis
    const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
    if (customEmoji?.url) {
      return customEmoji.url;
    }

    // Check recent emojis (they store the URL when used)
    if (emojiWithColons) {
      const recentEmoji = this.recentEmojis().find(e => e.emoji === emojiWithColons);
      if (recentEmoji?.url) {
        return recentEmoji.url;
      }
    }

    // Check all emoji sets
    for (const set of this.emojiSets()) {
      const emoji = set.emojis.find(e => e.shortcode === shortcode);
      if (emoji?.url) {
        return emoji.url;
      }
    }

    return null;
  }

  /**
   * Get custom emoji URL from reaction event tags (NIP-30)
   * Returns the image URL if the reaction has an emoji tag matching the content.
   * Falls back to user's emoji sets if the event doesn't have the emoji tag.
   */
  getCustomEmojiUrl(event: Event): string | null {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1); // Remove colons

    // First, check if the event has an emoji tag
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    if (emojiTag?.[2]) {
      return emojiTag[2];
    }

    // Fall back to user's emoji sets
    return this.lookupEmojiUrlByShortcode(shortcode, event.content);
  }

  /**
   * Optimistically update reactions for immediate UI feedback
   */
  private updateReactionsOptimistically(userPubkey: string, emoji: string, isAdding: boolean) {
    this.reactionsMutationVersion++;
    const currentReactions = this.reactions();
    const currentEvents = [...currentReactions.events];
    const currentData = new Map(currentReactions.data);
    const currentEvent = this.event();

    if (isAdding) {
      // Create a temporary reaction event for optimistic UI
      const baseTags: string[][] = [
        ['e', currentEvent?.id || ''],
        ['p', currentEvent?.pubkey || ''],
        ['k', currentEvent?.kind.toString() || ''],
      ];

      // Check if this is a custom emoji and add emoji tag for NIP-30
      // emoji format is :shortcode:, so extract the shortcode without colons
      const isCustomEmoji = emoji.startsWith(':') && emoji.endsWith(':');
      if (isCustomEmoji) {
        const shortcode = emoji.slice(1, -1);
        // First check customEmojis
        let emojiUrl: string | undefined;
        const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
        if (customEmoji?.url) {
          emojiUrl = customEmoji.url;
        } else {
          // Fallback: check emojiSets
          for (const set of this.emojiSets()) {
            const setEmoji = set.emojis.find(e => e.shortcode === shortcode);
            if (setEmoji?.url) {
              emojiUrl = setEmoji.url;
              break;
            }
          }
        }
        if (emojiUrl) {
          baseTags.push(['emoji', shortcode, emojiUrl]);
        }
      }

      const tempReactionEvent = {
        id: `temp-${userPubkey}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.Reaction,
        content: emoji,
        tags: baseTags,
        sig: '',
      };

      const tempRecord = {
        event: tempReactionEvent,
        data: emoji,
      };

      currentEvents.push(tempRecord);
      currentData.set(emoji, (currentData.get(emoji) || 0) + 1);
    } else {
      // Remove every local reaction from this user so the button doesn't get stuck
      // with a stale optimistic/signed record after unliking.
      const removedContents = currentEvents
        .filter(record => record.event.pubkey === userPubkey)
        .map(record => record.event.content);

      if (removedContents.length > 0) {
        const nextEvents = currentEvents.filter(record => record.event.pubkey !== userPubkey);

        for (const content of removedContents) {
          const currentCount = currentData.get(content) || 0;
          if (currentCount > 1) {
            currentData.set(content, currentCount - 1);
          } else {
            currentData.delete(content);
          }
        }

        currentEvents.length = 0;
        currentEvents.push(...nextEvents);
      }
    }

    this.reactions.set({
      events: currentEvents,
      data: currentData,
    });
  }

  private replaceOptimisticReactionWithSigned(userPubkey: string, emoji: string, signedEvent: Event): void {
    this.reactionsMutationVersion++;

    const currentReactions = this.reactions();
    const updatedEvents = currentReactions.events.filter(record => {
      if (record.event.pubkey !== userPubkey || record.event.content !== emoji) {
        return true;
      }

      return !record.event.id.startsWith('temp-');
    });

    const alreadyPresent = updatedEvents.some(record => record.event.id === signedEvent.id);
    if (!alreadyPresent) {
      updatedEvents.push({
        event: signedEvent,
        data: signedEvent.content,
      });
    }

    const updatedData = new Map<string, number>();
    for (const record of updatedEvents) {
      const content = record.event.content;
      updatedData.set(content, (updatedData.get(content) || 0) + 1);
    }

    this.reactions.set({
      events: updatedEvents,
      data: updatedData,
    });
  }

  /**
   * Track emoji usage for recent emojis
   */
  private trackEmojiUsage(emoji: string, url?: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    this.accountLocalState.addRecentEmoji(pubkey, emoji, url);

    // Update local signal immediately for UI responsiveness
    const recent = this.accountLocalState.getRecentEmojis(pubkey);
    this.recentEmojis.set(recent);
  }

  private triggerReactionCelebration(emoji: string): void {
    const normalizedEmoji = emoji.trim();
    const tier = normalizedEmoji === '+' || normalizedEmoji === '❤️' || normalizedEmoji === '❤' ? 2 : 1;

    if (this.likeCelebrationTimer) {
      clearTimeout(this.likeCelebrationTimer);
    }

    this.likeCelebrationTier.set(tier);
    this.likeCelebrationTimer = setTimeout(() => {
      this.likeCelebrationTier.set(0);
      this.likeCelebrationTimer = null;
    }, tier === 2 ? 720 : 620);
  }

  /**
   * Get the URL for a custom emoji by its shortcode format (:shortcode:)
   */
  getCustomEmojiUrlByShortcode(emoji: string): string | null {
    if (!emoji.startsWith(':') || !emoji.endsWith(':')) {
      return null;
    }
    const shortcode = emoji.slice(1, -1);
    return this.lookupEmojiUrlByShortcode(shortcode, emoji);
  }

  /**
   * Get the URL for a custom emoji in reaction groups display.
   * First checks if any reaction event has the emoji tag, then falls back to user's emoji sets.
   */
  getCustomEmojiUrlForGroup(content: string): string | null {
    if (!content.startsWith(':') || !content.endsWith(':')) {
      return null;
    }

    const reactionWithTag = this.reactions().events.find(
      r => r.event.content === content && this.getCustomEmojiUrl(r.event)
    );
    if (reactionWithTag) {
      return this.getCustomEmojiUrl(reactionWithTag.event);
    }

    const shortcode = content.slice(1, -1);
    return this.lookupEmojiUrlByShortcode(shortcode, content);
  }

  /**
   * Get the emoji-set-address (NIP-30) from a reaction event's emoji tag.
   */
  getEmojiSetAddress(event: Event): string | undefined {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return undefined;
    }

    const shortcode = event.content.slice(1, -1);
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    return emojiTag?.[3] || undefined;
  }

  /**
   * Get the emoji-set-address for a reaction group's custom emoji.
   */
  getEmojiSetAddressForGroup(content: string): string | undefined {
    if (!content.startsWith(':') || !content.endsWith(':')) {
      return undefined;
    }

    const reactionWithTag = this.reactions().events.find(
      r => r.event.content === content && this.getCustomEmojiUrl(r.event)
    );
    if (reactionWithTag) {
      return this.getEmojiSetAddress(reactionWithTag.event);
    }

    return undefined;
  }
}
