import { inject, Injectable } from '@angular/core';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import { EmojiSetService } from './emoji-set.service';
import { AccountStateService } from './account-state.service';

@Injectable({
  providedIn: 'root',
})
export class ReactionService {
  private nostrService = inject(NostrService);
  private utilities = inject(UtilitiesService);
  private emojiSetService = inject(EmojiSetService);
  private accountState = inject(AccountStateService);

  /**
   * Add a reaction to an event. Supports custom emoji via NIP-30.
   * @param content The reaction content (e.g., '+', '-', ':custom_emoji:')
   * @param event The event to react to
   * @param customEmojiUrl Optional URL for custom emoji if content contains :shortcode:
   */
  async addReaction(content: string, event: Event, customEmojiUrl?: string): Promise<{ success: boolean; error?: string }> {
    const tags: string[][] = [
      ['e', event.id],
      ['p', event.pubkey],
      ['k', event.kind.toString()], // Add kind tag for better relay filtering
    ];

    // NIP-25: For addressable events, add 'a' tag with coordinates (kind:pubkey:d-tag)
    if (this.utilities.isParameterizedReplaceableEvent(event.kind)) {
      const dTag = this.utilities.getTagValues('d', event.tags)[0];
      if (dTag !== undefined) {
        const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
        tags.push(['a', aTag]);
      }
    }

    // NIP-30: Add emoji tag for custom emoji reactions
    if (customEmojiUrl) {
      const shortcode = content.replace(/:/g, ''); // Remove colons
      tags.push(['emoji', shortcode, customEmojiUrl]);
    } else if (content.startsWith(':') && content.endsWith(':')) {
      // Try to find the emoji URL from user's preferences
      const shortcode = content.slice(1, -1);
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
        const emojiUrl = userEmojis.get(shortcode);
        if (emojiUrl) {
          tags.push(['emoji', shortcode, emojiUrl]);
        }
      }
    }

    const reactionEvent = this.nostrService.createEvent(kinds.Reaction, content, tags);

    const result = await this.nostrService.signAndPublish(reactionEvent);
    console.log('Reaction added:', { content, eventId: event.id, success: result.success });
    return { success: result.success, error: result.error };
  }

  async addLike(event: Event): Promise<{ success: boolean; error?: string }> {
    return this.addReaction('+', event);
  }

  async addDislike(event: Event): Promise<{ success: boolean; error?: string }> {
    return this.addReaction('-', event);
  }

  async deleteReaction(event: Event): Promise<{ success: boolean; error?: string }> {
    const deleteEvent = this.nostrService.createRetractionEvent(event);
    const result = await this.nostrService.signAndPublish(deleteEvent);
    console.log('Reaction deleted:', { eventId: event.id, success: result.success });
    return { success: result.success, error: result.error };
  }
}
