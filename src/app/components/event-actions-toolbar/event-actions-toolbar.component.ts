import { Component, computed, effect, inject, input, output, signal, untracked, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { trigger, style, animate, transition } from '@angular/animations';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { ReactionButtonComponent } from '../event/reaction-button/reaction-button.component';
import { ZapButtonComponent } from '../zap-button/zap-button.component';
import { ReactionSummaryComponent, type ZapInfo } from '../event/reaction-summary/reaction-summary.component';
import { type ReactionEvents } from '../../services/event';
import { type NostrRecord } from '../../interfaces';
import { BookmarkService } from '../../services/bookmark.service';
import { EventService } from '../../services/event';
import { ZapService } from '../../services/zap.service';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';

@Component({
  selector: 'app-event-actions-toolbar',
  imports: [
    MatIconModule,
    ReactionButtonComponent,
    ZapButtonComponent,
    ReactionSummaryComponent,
  ],
  templateUrl: './event-actions-toolbar.component.html',
  styleUrl: './event-actions-toolbar.component.scss',
  animations: [
    trigger('expandCollapse', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('200ms ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ height: '*', opacity: 1, overflow: 'hidden' }),
        animate('200ms ease-in', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
})
export class EventActionsToolbarComponent {
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Required: the Nostr event to show actions for
  event = input.required<Event>();

  /**
   * Bookmark type: 'a' for addressable events (articles, music tracks, playlists),
   * 'e' for regular events.
   */
  bookmarkType = input<'e' | 'a'>('a');

  /**
   * Optional: pre-loaded reaction data from parent.
   * If provided (non-empty), the toolbar will NOT load its own reactions.
   */
  reactions = input<ReactionEvents>({ events: [], data: new Map() });
  repostsInput = input<NostrRecord[]>([]);
  quotesInput = input<NostrRecord[]>([]);
  zapsInput = input<ZapInfo[]>([]);
  replyCountInput = input<number>(0);

  /**
   * Whether the toolbar should auto-load engagement metrics internally.
   * Defaults to true. Set to false if the parent provides all data via inputs.
   */
  autoLoad = input<boolean>(true);

  // Outputs for parent to handle
  reactionChanged = output<void>();
  zapSent = output<number>();
  replyClick = output<MouseEvent>();
  bookmarkClick = output<MouseEvent>();
  shareClick = output<void>();

  /**
   * Whether this toolbar is for a reply event.
   * Replies and original posts store separate display mode preferences.
   */
  isReply = input<boolean>(false);

  // Services
  bookmark = inject(BookmarkService);
  private eventService = inject(EventService);
  private zapService = inject(ZapService);
  private sharedRelay = inject(SharedRelayService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);

  // Display mode for action buttons: 'labels-only', 'icons-and-labels', 'icons-only'
  actionsDisplayMode = computed<string>(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return this.isReply() ? 'labels-only' : 'icons-and-labels';
    }
    if (this.isReply()) {
      return this.accountLocalState.getActionsDisplayModeReplies(pubkey);
    }
    return this.accountLocalState.getActionsDisplayMode(pubkey);
  });

  onActionsDisplayModeToggle(event: globalThis.Event): void {
    event.preventDefault();
    event.stopPropagation();
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const modes = ['icons-and-labels', 'labels-only', 'icons-only'];
    const currentMode = this.actionsDisplayMode();
    const currentIndex = modes.indexOf(currentMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];

    if (this.isReply()) {
      this.accountLocalState.setActionsDisplayModeReplies(pubkey, nextMode);
    } else {
      this.accountLocalState.setActionsDisplayMode(pubkey, nextMode);
    }
  }

  // Long press on bookmark for touch devices
  private bookmarkLongPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private bookmarkLongPressed = false;

  onBookmarkLongPressStart(event: TouchEvent): void {
    this.bookmarkLongPressed = false;
    this.bookmarkLongPressTimeout = setTimeout(() => {
      this.bookmarkLongPressed = true;
      event.preventDefault();
      this.onActionsDisplayModeToggle(event);
    }, 500);
  }

  onBookmarkLongPressEnd(): void {
    if (this.bookmarkLongPressTimeout) {
      clearTimeout(this.bookmarkLongPressTimeout);
      this.bookmarkLongPressTimeout = null;
    }
  }

  // Internal engagement metrics signals
  engagementLoading = signal<boolean>(false);
  internalReactions = signal<ReactionEvents>({ events: [], data: new Map() });
  internalZaps = signal<ZapInfo[]>([]);
  commentCount = signal<number>(0);
  zapTotal = signal<number>(0);
  zapCountInternal = signal<number>(0);

  // Effective computed values (prefer parent input, fall back to internal)
  effectiveReactions = computed<ReactionEvents>(() => {
    const parentReactions = this.reactions();
    if (parentReactions.events.length > 0) {
      return parentReactions;
    }
    return this.internalReactions();
  });

  likes = computed<NostrRecord[]>(() => this.effectiveReactions().events);

  effectiveZaps = computed<ZapInfo[]>(() => {
    const parentZaps = this.zapsInput();
    if (parentZaps.length > 0) {
      return parentZaps;
    }
    return this.internalZaps();
  });

  effectiveReplyCount = computed<number>(() => {
    const parentCount = this.replyCountInput();
    return parentCount > 0 ? parentCount : this.commentCount();
  });

  totalZapAmount = computed<number>(() => {
    const zaps = this.effectiveZaps();
    if (zaps.length === 0) {
      return this.zapTotal();
    }
    return zaps.reduce((total, zap) => total + (zap.amount || 0), 0);
  });

  zapCount = computed<number>(() => {
    const zaps = this.effectiveZaps();
    return zaps.length > 0 ? zaps.length : this.zapCountInternal();
  });

  repostCount = computed<number>(() => this.repostsInput().length);
  quoteCount = computed<number>(() => this.quotesInput().length);
  shareCount = computed<number>(() => this.repostCount() + this.quoteCount());

  // Top emoji aggregation
  topEmojis = computed<{ emoji: string; url?: string; count: number }[]>(() => {
    const reactions = this.likes();
    if (!reactions || reactions.length === 0) return [];

    const emojiCounts = new Map<string, { count: number; url?: string }>();
    for (const reaction of reactions) {
      let content = reaction.event.content || '+';
      if (content === '+') {
        content = '\u2764\uFE0F';
      }
      const existing = emojiCounts.get(content);
      if (existing) {
        existing.count++;
      } else {
        let url: string | undefined;
        if (content.startsWith(':') && content.endsWith(':')) {
          const shortcode = content.slice(1, -1);
          const emojiTag = reaction.event.tags.find(
            (tag: string[]) => tag[0] === 'emoji' && tag[1] === shortcode
          );
          if (emojiTag && emojiTag[2]) {
            url = emojiTag[2];
          }
        }
        emojiCounts.set(content, { count: 1, url });
      }
    }

    return Array.from(emojiCounts.entries())
      .map(([emoji, data]) => ({ emoji, url: data.url, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  });

  // Bookmark identifier
  id = computed(() => {
    const ev = this.event();
    if (this.bookmarkType() === 'a') {
      const dTag = ev.tags.find(tag => tag[0] === 'd')?.[1] || '';
      return `${ev.kind}:${ev.pubkey}:${dTag}`;
    }
    return ev.id;
  });

  isBookmarked = computed(() => {
    return this.bookmark.isBookmarkedInAnyList(this.id(), this.bookmarkType());
  });

  bookmarkIcon = computed(() => (this.isBookmarked() ? 'bookmark_remove' : 'bookmark_add'));

  // Reactions summary panel state
  showReactionsSummary = signal<boolean>(false);
  reactionsSummaryTab = signal<'reactions' | 'reposts' | 'quotes' | 'zaps'>('reactions');

  constructor() {
    // Auto-load engagement metrics when event changes
    effect(() => {
      const ev = this.event();
      const shouldAutoLoad = this.autoLoad();
      if (shouldAutoLoad && ev && this.isBrowser) {
        untracked(() => {
          void this.loadEngagementMetrics(ev);
        });
      }
    });
  }

  private async loadEngagementMetrics(event: Event): Promise<void> {
    this.engagementLoading.set(true);

    try {
      const [reactionData, commentCnt, zapData] = await Promise.all([
        this.loadReactionData(event),
        this.loadCommentCount(event),
        this.loadZaps(event),
      ]);

      this.internalReactions.set(reactionData);
      this.commentCount.set(commentCnt);
      this.zapTotal.set(zapData.total);
      this.zapCountInternal.set(zapData.count);
      this.internalZaps.set(zapData.zaps);
    } catch (err) {
      this.logger.error('Failed to load engagement metrics:', err);
    } finally {
      this.engagementLoading.set(false);
    }
  }

  private async loadReactionData(event: Event): Promise<ReactionEvents> {
    try {
      return await this.eventService.loadReactions(event.id, event.pubkey);
    } catch (err) {
      this.logger.error('Failed to load reactions:', err);
      return { events: [], data: new Map() };
    }
  }

  private async loadCommentCount(event: Event): Promise<number> {
    try {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;

      const filter = {
        kinds: [1111],
        '#A': [aTagValue],
        limit: 100,
      };

      const comments = await this.sharedRelay.getMany(event.pubkey, filter);
      return comments?.length || 0;
    } catch (err) {
      this.logger.error('Failed to load comments:', err);
      return 0;
    }
  }

  private async loadZaps(event: Event): Promise<{ total: number; count: number; zaps: ZapInfo[] }> {
    try {
      const zapReceipts = await this.zapService.getZapsForEvent(event.id);
      let total = 0;
      const zaps: ZapInfo[] = [];

      for (const receipt of zapReceipts) {
        const { zapRequest, amount, comment } = this.zapService.parseZapReceipt(receipt);
        if (amount) {
          total += amount;

          if (zapRequest) {
            zaps.push({
              receipt,
              zapRequest,
              amount,
              comment,
              senderPubkey: zapRequest.pubkey,
              timestamp: receipt.created_at,
            });
          }
        }
      }

      return { total, count: zapReceipts.length, zaps };
    } catch (err) {
      this.logger.error('Failed to load zaps:', err);
      return { total: 0, count: 0, zaps: [] };
    }
  }

  onReactionChanged(): void {
    this.reactionChanged.emit();
    const currentEvent = this.event();
    if (currentEvent && this.autoLoad()) {
      void this.loadEngagementMetrics(currentEvent);
    }
  }

  onZapSent(amount: number): void {
    this.zapSent.emit(amount);
    const currentEvent = this.event();
    if (currentEvent && this.autoLoad()) {
      void this.loadEngagementMetrics(currentEvent);
    }
  }

  formatZapAmount(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return sats.toString();
  }

  toggleReactionsSummary(tab: 'reactions' | 'reposts' | 'quotes' | 'zaps' = 'reactions'): void {
    const isCurrentlyVisible = this.showReactionsSummary();
    const resolvedTab = this.resolveTabWithData(tab);
    const currentTab = this.reactionsSummaryTab();

    if (isCurrentlyVisible && currentTab === resolvedTab) {
      this.showReactionsSummary.set(false);
    } else {
      this.reactionsSummaryTab.set(resolvedTab);
      this.showReactionsSummary.set(true);
    }
  }

  private resolveTabWithData(
    preferredTab: 'reactions' | 'reposts' | 'quotes' | 'zaps'
  ): 'reactions' | 'reposts' | 'quotes' | 'zaps' {
    const tabHasData: Record<string, () => boolean> = {
      reactions: () => this.likes().length > 0,
      reposts: () => this.repostCount() > 0,
      quotes: () => this.quoteCount() > 0,
      zaps: () => this.zapCount() > 0,
    };

    if (tabHasData[preferredTab]()) {
      return preferredTab;
    }

    const tabs: ('reactions' | 'reposts' | 'quotes' | 'zaps')[] = ['reactions', 'reposts', 'quotes', 'zaps'];
    return tabs.find(t => tabHasData[t]()) ?? preferredTab;
  }
}
