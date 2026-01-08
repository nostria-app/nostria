import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
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
import { EventService, ReactionEvents } from '../../../services/event';
import { ReactionService } from '../../../services/reaction.service';
import { LayoutService } from '../../../services/layout.service';
import { EmojiSetService } from '../../../services/emoji-set.service';

type ViewMode = 'icon' | 'full';

interface ReactionGroup {
  content: string;
  count: number;
  pubkeys: string[];
  userReacted: boolean;
}

@Component({
  selector: 'app-reaction-button',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './reaction-button.component.html',
  styleUrls: ['./reaction-button.component.scss'],
})
export class ReactionButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly reactionService = inject(ReactionService);
  private readonly layout = inject(LayoutService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly emojiSetService = inject(EmojiSetService);

  // Menu trigger references to close the menu after reaction
  private readonly menuTrigger = viewChild<MatMenuTrigger>('menuTrigger');
  private readonly menuTriggerFull = viewChild<MatMenuTrigger>('menuTriggerFull');

  isLoadingReactions = signal<boolean>(false);
  reactions = signal<ReactionEvents>({ events: [], data: new Map() });
  customEmojis = signal<{ shortcode: string; url: string }[]>([]);

  // Quick reactions for the picker
  readonly quickReactions = ['👍', '❤️', '😂', '🔥', '🎉', '👏'];

  event = input.required<Event>();
  view = input<ViewMode>('icon');
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

    for (const record of this.reactions().events) {
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

  constructor() {
    // Load user's custom emojis
    effect(() => {
      const pubkey = this.accountState.pubkey();
      console.log('[ReactionButton] Effect triggered, pubkey:', pubkey?.slice(0, 8));
      if (!pubkey) {
        console.log('[ReactionButton] No pubkey, clearing custom emojis');
        this.customEmojis.set([]);
        return;
      }

      untracked(async () => {
        try {
          console.log('[ReactionButton] Fetching user emoji sets for:', pubkey.slice(0, 8));
          const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
          console.log('[ReactionButton] getUserEmojiSets returned:', userEmojis.size, 'emojis');
          const emojiArray = Array.from(userEmojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
          // Show all custom emojis (no limit)
          console.log('[ReactionButton] Loaded custom emojis for reactions:', emojiArray);
          this.customEmojis.set(emojiArray);
          console.log('[ReactionButton] customEmojis signal set to:', this.customEmojis());
        } catch (error) {
          console.error('[ReactionButton] Failed to load custom emojis for reactions:', error);
          this.customEmojis.set([]);
        }
      });
    });

    // Watch for parent reactions and use them when available
    effect(() => {
      const parentReactions = this.reactionsFromParent();

      // If parent provides reactions, use them
      if (parentReactions !== null) {
        this.reactions.set(parentReactions);
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

  async addReaction(emoji: string) {
    // Close the menu immediately after selection
    this.closeMenu();

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

  private closeMenu() {
    this.menuTrigger()?.closeMenu();
    this.menuTriggerFull()?.closeMenu();
  }

  private async removeReaction(reaction: NostrRecord, emoji: string) {
    this.isLoadingReactions.set(true);
    try {
      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
      const success = await this.reactionService.deleteReaction(reaction.event);
      if (!success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
        this.snackBar.open('Failed to remove reaction. Please try again.', 'Dismiss', { duration: 3000 });
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
      this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, true);
      const success = await this.reactionService.addReaction(emoji, event);
      if (!success) {
        this.updateReactionsOptimistically(this.accountState.pubkey()!, emoji, false);
        this.snackBar.open('Failed to add reaction. Please try again.', 'Dismiss', { duration: 3000 });
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
      const existingLikeReaction = this.likeReaction();

      if (existingLikeReaction) {
        // Remove like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', false);

        const success = await this.reactionService.deleteReaction(existingLikeReaction.event);
        if (!success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', true);
          this.snackBar.open('Failed to remove like. Please try again.', 'Dismiss', { duration: 3000 });
        }
      } else {
        // Add like - optimistically update UI first
        this.updateReactionsOptimistically(userPubkey, '+', true);

        const success = await this.reactionService.addLike(event);
        if (!success) {
          // Revert optimistic update if failed
          this.updateReactionsOptimistically(userPubkey, '+', false);
          this.snackBar.open('Failed to add like. Please try again.', 'Dismiss', { duration: 3000 });
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

  async loadReactions(invalidateCache = false) {
    const event = this.event();
    if (!event) return;

    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    this.isLoadingReactions.set(true);
    try {
      const reactions = await this.eventService.loadReactions(
        event.id,
        userPubkey,
        invalidateCache
      );
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
   * Get custom emoji URL from reaction event tags (NIP-30)
   * Returns the image URL if the reaction has an emoji tag matching the content
   */
  getCustomEmojiUrl(event: Event): string | null {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1); // Remove colons
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);

    return emojiTag?.[2] || null;
  }

  /**
   * Optimistically update reactions for immediate UI feedback
   */
  private updateReactionsOptimistically(userPubkey: string, emoji: string, isAdding: boolean) {
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
      const customEmoji = this.customEmojis().find(e => e.shortcode === emoji);
      if (customEmoji) {
        baseTags.push(['emoji', customEmoji.shortcode, customEmoji.url]);
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
      // Remove the user's reaction
      const userReactionIndex = currentEvents.findIndex(
        r => r.event.pubkey === userPubkey && r.event.content === emoji
      );

      if (userReactionIndex !== -1) {
        currentEvents.splice(userReactionIndex, 1);
        const currentCount = currentData.get(emoji) || 0;
        if (currentCount > 1) {
          currentData.set(emoji, currentCount - 1);
        } else {
          currentData.delete(emoji);
        }
      }
    }

    this.reactions.set({
      events: currentEvents,
      data: currentData,
    });
  }
}
