import { Component, ChangeDetectionStrategy, input, computed, signal, effect, inject } from '@angular/core';
import { MatRippleModule } from '@angular/material/core';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../../../interfaces';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { EventHeaderComponent } from '../header/header.component';
import { LayoutService } from '../../../services/layout.service';

export type ReactionSummaryTab = 'reactions' | 'reposts' | 'quotes' | 'zaps';

export interface ZapInfo {
  receipt: Event;
  zapRequest: Event | null;
  amount: number | null;
  comment: string;
  senderName?: string;
  senderPubkey: string;
  timestamp: number;
}

@Component({
  selector: 'app-reaction-summary',
  imports: [
    MatRippleModule,
    UserProfileComponent,
    AgoPipe,
    EventHeaderComponent,
  ],
  templateUrl: './reaction-summary.component.html',
  styleUrl: './reaction-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionSummaryComponent {
  private layout = inject(LayoutService);

  reactions = input<NostrRecord[]>([]);
  replyCount = input<number>(0);
  repostCount = input<number>(0);
  quoteCount = input<number>(0);
  reposts = input<NostrRecord[]>([]);
  quotes = input<NostrRecord[]>([]);
  zaps = input<ZapInfo[]>([]);
  totalZapAmount = input<number>(0);
  zapCount = input<number>(0);
  initialTab = input<ReactionSummaryTab>('reactions');
  hideTabs = input<boolean>(false);

  selectedTab = signal<ReactionSummaryTab>('reactions');

  allTabs: ReactionSummaryTab[] = ['reactions', 'reposts', 'quotes', 'zaps'];

  visibleTabs = computed<ReactionSummaryTab[]>(() => {
    return this.allTabs.filter(tab => {
      const count = this.tabCount(tab);
      return typeof count === 'number' ? count > 0 : parseInt(count, 10) > 0;
    });
  });

  constructor() {
    // Set initial tab when input changes
    effect(() => {
      const tab = this.initialTab();
      this.selectedTab.set(tab);
    });
  }

  tabLabel(tab: ReactionSummaryTab): string {
    switch (tab) {
      case 'reactions': return 'Reactions';
      case 'reposts': return 'Reposts';
      case 'quotes': return 'Quotes';
      case 'zaps': return 'Zaps';
    }
  }

  tabCount(tab: ReactionSummaryTab): number | string {
    switch (tab) {
      case 'reactions': return this.reactions().length;
      case 'reposts': return this.repostCount();
      case 'quotes': return this.quoteCount();
      case 'zaps': return this.zapCount();
    }
  }

  sortedReactions = computed<NostrRecord[]>(() => {
    return [...this.reactions()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  sortedReposts = computed<NostrRecord[]>(() => {
    return [...this.reposts()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  sortedQuotes = computed<NostrRecord[]>(() => {
    return [...this.quotes()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  sortedZaps = computed<ZapInfo[]>(() => {
    return [...this.zaps()].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  });

  formattedZapAmount = computed<string>(() => {
    const amount = this.totalZapAmount();
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  });

  onTabClick(tab: ReactionSummaryTab, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedTab.set(tab);
  }

  /**
   * Get the display text for a reaction.
   * Converts '+' to heart emoji, otherwise displays the actual reaction content.
   */
  getReactionDisplay(content: string): string {
    if (!content || content === '+') {
      return '\u2764\uFE0F';
    }
    return content;
  }

  /**
   * Get custom emoji URL from reaction event tags (NIP-30).
   * Returns the image URL if the reaction has an emoji tag matching the content.
   */
  getCustomEmojiUrl(event: Event): string | null {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1);
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    return emojiTag?.[2] || null;
  }

  formatAmount(amount: number | null): string {
    if (!amount) return '0';
    return amount.toLocaleString();
  }

  getQuoteDisplayText(content: string): string {
    if (!content) {
      return '';
    }

    return content
      .replace(/nostr:(?:note|nevent|naddr)1(?:(?!(?:note|nevent|naddr)1)[a-z0-9])+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  onQuoteClick(quote: NostrRecord, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openGenericEvent(quote.event.id, quote.event);
  }
}
