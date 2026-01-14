import { Component, computed, inject, input, output, signal, effect, untracked } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { RouterModule, Router } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { RepostButtonComponent } from '../event/repost-button/repost-button.component';
import { ReactionButtonComponent } from '../event/reaction-button/reaction-button.component';
import { EventMenuComponent } from '../event/event-menu/event-menu.component';
import { MentionHoverDirective } from '../../directives/mention-hover.directive';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { ZapChipsComponent } from '../zap-chips/zap-chips.component';
import { BookmarkService } from '../../services/bookmark.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { EventService } from '../../services/event';
import { ZapService } from '../../services/zap.service';
import { LoggerService } from '../../services/logger.service';
import { BookmarkListSelectorComponent } from '../bookmark-list-selector/bookmark-list-selector.component';

export interface ArticleData {
  event?: Event;
  title: string;
  summary: string;
  image: string;
  parsedContent: SafeHtml;
  hashtags: string[];
  authorPubkey: string;
  publishedAt: Date | null;
  publishedAtTimestamp: number;
  link: string;
  id: string;
  isJsonContent: boolean;
  jsonData: Record<string, unknown> | unknown[] | null;
}

interface TopZapper {
  pubkey: string;
  amount: number;
}

@Component({
  selector: 'app-article-display',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatChipsModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    RouterModule,
    UserProfileComponent,
    DateToggleComponent,
    RepostButtonComponent,
    ReactionButtonComponent,
    EventMenuComponent,
    MentionHoverDirective,
    CommentsListComponent,
    ZapChipsComponent
  ],
  templateUrl: './article-display.component.html',
  styleUrl: './article-display.component.scss',
})
export class ArticleDisplayComponent {
  private router = inject(Router);

  // Input for article data
  article = input.required<ArticleData>();

  // Display mode: 'full' shows everything, 'preview' hides author, comments, some actions
  mode = input<'full' | 'preview'>('full');

  // Text-to-speech inputs (only used in full mode)
  isSpeaking = input<boolean>(false);
  isPaused = input<boolean>(false);
  isSynthesizing = input<boolean>(false);
  useAiVoice = input<boolean>(false);
  isTranslating = input<boolean>(false);
  availableVoices = input<SpeechSynthesisVoice[]>([]);
  selectedVoice = input<SpeechSynthesisVoice | null>(null);
  playbackRate = input<number>(1);

  // Text-to-speech outputs (only used in full mode)
  startSpeech = output<void>();
  pauseSpeech = output<void>();
  resumeSpeech = output<void>();
  stopSpeech = output<void>();
  toggleAiVoice = output<boolean>();
  voiceChange = output<SpeechSynthesisVoice>();
  playbackRateChange = output<number>();
  share = output<void>();
  translate = output<string>();

  // Playback speed options
  playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // Group voices by language for display
  groupedVoices = computed(() => {
    const voices = this.availableVoices();
    const groups: Record<string, SpeechSynthesisVoice[]> = {};

    for (const voice of voices) {
      // Extract language name from lang code (e.g., "en-US" -> "English")
      const langCode = voice.lang.split('-')[0];
      const langName = this.getLanguageName(langCode);

      if (!groups[langName]) {
        groups[langName] = [];
      }
      groups[langName].push(voice);
    }

    return groups;
  });

  languageGroups = computed(() => Object.keys(this.groupedVoices()).sort());

  private getLanguageName(code: string): string {
    const names: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'nl': 'Dutch',
      'pl': 'Polish',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish',
      'tr': 'Turkish',
      'cs': 'Czech',
      'el': 'Greek',
      'he': 'Hebrew',
      'th': 'Thai',
      'vi': 'Vietnamese',
      'id': 'Indonesian',
      'ms': 'Malay',
      'fil': 'Filipino',
      'uk': 'Ukrainian',
      'ro': 'Romanian',
      'hu': 'Hungarian',
      'sk': 'Slovak',
      'bg': 'Bulgarian',
      'hr': 'Croatian',
      'sl': 'Slovenian',
      'lt': 'Lithuanian',
      'lv': 'Latvian',
      'et': 'Estonian',
      'af': 'Afrikaans',
    };
    return names[code] || code.toUpperCase();
  }

  layout = inject(LayoutService);

  // Services
  bookmark = inject(BookmarkService);
  accountState = inject(AccountStateService);
  private dialog = inject(MatDialog);
  private sharedRelay = inject(SharedRelayService);
  private eventService = inject(EventService);
  private zapService = inject(ZapService);
  private logger = inject(LoggerService);

  // Engagement metrics signals
  reactionCount = signal<number>(0);
  commentCount = signal<number>(0);
  zapTotal = signal<number>(0);
  topZappers = signal<TopZapper[]>([]);
  engagementLoading = signal<boolean>(false);

  // Computed properties for convenience
  event = computed(() => this.article().event);
  title = computed(() => this.article().title);
  summary = computed(() => this.article().summary);
  image = computed(() => this.article().image);
  parsedContent = computed(() => this.article().parsedContent);
  hashtags = computed(() => this.article().hashtags);
  // Deduplicated hashtags to avoid Angular track key errors
  uniqueHashtags = computed(() => [...new Set(this.article().hashtags)]);
  authorPubkey = computed(() => this.article().authorPubkey);
  publishedAtTimestamp = computed(() => this.article().publishedAtTimestamp);
  link = computed(() => this.article().link);
  id = computed(() => this.article().id);
  isJsonContent = computed(() => this.article().isJsonContent);
  jsonData = computed(() => this.article().jsonData);

  // Computed read time based on word count (~200 words per minute)
  readTime = computed(() => {
    const content = this.parsedContent();
    if (!content) return 0;

    // Strip HTML tags and get plain text
    const plainText = content.toString().replace(/<[^>]*>/g, '');
    const words = plainText.trim().split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;

    // Average reading speed is ~200-250 words per minute, use 200 for a comfortable pace
    const minutes = Math.ceil(wordCount / 200);
    return Math.max(1, minutes); // At least 1 minute
  });

  constructor() {
    // Load engagement metrics when article changes
    effect(() => {
      const article = this.article();
      const currentMode = this.mode();

      // Only load engagement in full mode
      if (currentMode === 'full' && article.event) {
        untracked(() => {
          this.loadEngagementMetrics(article.event!);
        });
      }
    });
  }

  private async loadEngagementMetrics(event: Event): Promise<void> {
    this.engagementLoading.set(true);

    try {
      // Load reactions, comments, and zaps in parallel
      const [reactionCount, commentCount, zapData] = await Promise.all([
        this.loadReactionCount(event),
        this.loadCommentCount(event),
        this.loadZaps(event),
      ]);

      this.reactionCount.set(reactionCount);
      this.commentCount.set(commentCount);
      this.zapTotal.set(zapData.total);
      this.topZappers.set(zapData.topZappers);
    } catch (err) {
      this.logger.error('Failed to load engagement metrics:', err);
    } finally {
      this.engagementLoading.set(false);
    }
  }

  private async loadReactionCount(event: Event): Promise<number> {
    try {
      const reactions = await this.eventService.loadReactions(event.id, event.pubkey);
      return reactions.events.length;
    } catch (err) {
      this.logger.error('Failed to load reactions for article:', err);
      return 0;
    }
  }

  private async loadCommentCount(event: Event): Promise<number> {
    try {
      // Get the 'd' tag (identifier) for addressable events
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;

      // Query for kind 1111 comments using the 'A' tag for addressable events
      const filter = {
        kinds: [1111],
        '#A': [aTagValue],
        limit: 100,
      };

      const comments = await this.sharedRelay.getMany(event.pubkey, filter);
      return comments?.length || 0;
    } catch (err) {
      this.logger.error('Failed to load comments for article:', err);
      return 0;
    }
  }

  private async loadZaps(event: Event): Promise<{ total: number; topZappers: TopZapper[] }> {
    try {
      const zapReceipts = await this.zapService.getZapsForEvent(event.id);
      let total = 0;
      const zapperAmounts = new Map<string, number>();

      for (const receipt of zapReceipts) {
        const { zapRequest, amount } = this.zapService.parseZapReceipt(receipt);
        if (amount) {
          total += amount;

          // Track zapper amounts
          if (zapRequest) {
            const zapperPubkey = zapRequest.pubkey;
            const current = zapperAmounts.get(zapperPubkey) || 0;
            zapperAmounts.set(zapperPubkey, current + amount);
          }
        }
      }

      // Get top 3 zappers
      const topZappers = Array.from(zapperAmounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pubkey, amount]) => ({ pubkey, amount }));

      return { total, topZappers };
    } catch (err) {
      this.logger.error('Failed to load zaps for article:', err);
      return { total: 0, topZappers: [] };
    }
  }

  /**
   * Format zap amount for display (e.g., 1000 -> "1k", 1500000 -> "1.5M")
   */
  formatZapAmount(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return sats.toString();
  }

  /**
   * Get keys from an object for template iteration
   */
  getObjectKeys(obj: unknown): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  /**
   * Get value from object by key
   */
  getObjectValue(obj: unknown, key: string): unknown {
    if (!obj || typeof obj !== 'object') return null;
    return (obj as Record<string, unknown>)[key];
  }

  /**
   * Format JSON value for display
   */
  formatJsonValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object') return 'Object';
    return String(value);
  }

  /**
   * Check if value is a primitive (string, number, boolean, null)
   */
  isPrimitive(value: unknown): boolean {
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }

  /**
   * Stringify complex values (objects/arrays) for display
   */
  stringifyValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /**
   * Handle clicks on links in the content to support right panel navigation
   */
  handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const link = target.closest('a');

    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Check for internal links and navigate using auxiliary route
    if (href.startsWith('/p/')) {
      event.preventDefault();
      event.stopPropagation();
      const pubkey = href.split('/')[2];
      this.layout.openProfile(pubkey);
    } else if (href.startsWith('/e/')) {
      event.preventDefault();
      event.stopPropagation();
      const id = href.split('/')[2];
      this.router.navigate([{ outlets: { right: ['e', id] } }]);
    } else if (href.startsWith('/a/')) {
      event.preventDefault();
      event.stopPropagation();
      // Handle article links: /a/naddr or /a/identifier
      const parts = href.split('/');
      if (parts.length > 2) {
        const id = parts[2];
        const slug = parts.length > 3 ? parts[3] : undefined;

        if (slug) {
          this.router.navigate([{ outlets: { right: ['a', id, slug] } }]);
        } else {
          this.router.navigate([{ outlets: { right: ['a', id] } }]);
        }
      }
    }
  }

  /**
   * Open bookmark list selector dialog
   */
  openBookmarkSelector() {
    this.dialog.open(BookmarkListSelectorComponent, {
      data: {
        itemId: this.id(),
        type: 'a'
      },
      width: '400px',
      panelClass: 'responsive-dialog'
    });
  }
}
