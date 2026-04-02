import { inject, Injectable } from '@angular/core';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import { EmojiSetService } from './emoji-set.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { UserRelaysService } from './relays/user-relays';
import { DatabaseService } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { MusicLikedSongsService } from './music-liked-songs.service';

@Injectable({
  providedIn: 'root',
})
export class ReactionService {
  private nostrService = inject(NostrService);
  private utilities = inject(UtilitiesService);
  private emojiSetService = inject(EmojiSetService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private userRelaysService = inject(UserRelaysService);
  private database = inject(DatabaseService);
  private accountLocalState = inject(AccountLocalStateService);
  private musicLikedSongs = inject(MusicLikedSongsService);

  /**
   * Add a reaction to an event. Supports custom emoji via NIP-30.
   * @param content The reaction content (e.g., '+', '-', ':custom_emoji:')
   * @param event The event to react to
   * @param customEmojiUrl Optional URL for custom emoji if content contains :shortcode:
   */
  async addReaction(content: string, event: Event, customEmojiUrl?: string): Promise<{ success: boolean; event?: Event; error?: string }> {
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
      // Look up the emoji-set-address
      const pubkey = this.accountState.pubkey();
      const emojiSetAddress = pubkey ? await this.emojiSetService.getEmojiSetAddressForShortcode(pubkey, shortcode) : undefined;
      if (emojiSetAddress) {
        tags.push(['emoji', shortcode, customEmojiUrl, emojiSetAddress]);
      } else {
        tags.push(['emoji', shortcode, customEmojiUrl]);
      }
    } else if (content.startsWith(':') && content.endsWith(':')) {
      // Try to find the emoji URL from user's preferences
      const shortcode = content.slice(1, -1);
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
        const emojiUrl = userEmojis.get(shortcode);
        if (emojiUrl) {
          const emojiSetAddress = await this.emojiSetService.getEmojiSetAddressForShortcode(pubkey, shortcode);
          if (emojiSetAddress) {
            tags.push(['emoji', shortcode, emojiUrl, emojiSetAddress]);
          } else {
            tags.push(['emoji', shortcode, emojiUrl]);
          }
        }
      }
    }

    const reactionEvent = this.nostrService.createEvent(kinds.Reaction, content, tags);

    const result = await this.nostrService.signAndPublish(reactionEvent);
    console.log('Reaction added:', { content, eventId: event.id, success: result.success });
    return { success: result.success, event: result.event, error: result.error };
  }

  async addLike(event: Event): Promise<{ success: boolean; event?: Event; error?: string }> {
    const result = await this.addReaction('+', event);

    if (result.success && this.isMusicLikeTarget(event)) {
      const likedSaved = event.kind === 34139
        ? await this.musicLikedSongs.addAlbum(event)
        : await this.musicLikedSongs.addTrack(event);
      if (!likedSaved) {
        return { success: false, event: result.event, error: 'Failed to update liked songs.' };
      }
    }

    return result;
  }

  async addDislike(event: Event): Promise<{ success: boolean; event?: Event; error?: string }> {
    return this.addReaction('-', event);
  }

  async deleteReaction(event: Event): Promise<{ success: boolean; error?: string }> {
    const likedSongsRef = this.getMusicReactionRef(event);

    const deleteEvent = this.nostrService.createRetractionEvent(event);
    const accountRelayUrls = this.accountRelay.getRelayUrls();
    const targetAuthorPubkeys = [...new Set(
      event.tags
        .filter(tag => tag[0] === 'p' && tag[1])
        .map(tag => tag[1])
    )];

    const targetAuthorRelayUrls = await Promise.all(
      targetAuthorPubkeys.map(pubkey => this.userRelaysService.getUserRelaysForPublishing(pubkey))
    );

    const relayUrls = this.utilities.getUniqueNormalizedRelayUrls([
      ...accountRelayUrls,
      ...targetAuthorRelayUrls.flat(),
    ]);

    const result = await this.nostrService.signAndPublish(deleteEvent, relayUrls);
    if (result.success) {
      const currentUserPubkey = this.accountState.pubkey();
      if (currentUserPubkey) {
        this.accountLocalState.markReactionDeleted(currentUserPubkey, event.id);
      }

      try {
        await this.database.deleteEvent(event.id);
      } catch {
        return { success: false, error: 'Failed to remove deleted reaction from local database.' };
      }

      if (likedSongsRef) {
        const likedRemoved = this.isAlbumReactionRef(likedSongsRef)
          ? await this.musicLikedSongs.removeRef(likedSongsRef, 'albums')
          : await this.musicLikedSongs.removeRef(likedSongsRef, 'tracks');
        if (!likedRemoved) {
          return { success: false, error: 'Failed to update liked songs.' };
        }
      }
    }

    console.log('Reaction deleted:', { eventId: event.id, success: result.success });
    return { success: result.success, error: result.error };
  }

  private isMusicLikeTarget(event: Event): boolean {
    if (this.utilities.isParameterizedReplaceableEvent(event.kind)) {
      const dTag = this.utilities.getTagValues('d', event.tags)[0];
      if (!dTag) {
        return false;
      }

      if (this.utilities.parseMusicTrackCoordinate(`${event.kind}:${event.pubkey}:${dTag}`)) {
        return true;
      }

      return event.kind === 34139;
    }

    return this.utilities.isMusicKind(event.kind) || event.kind === 34139;
  }

  private getMusicReactionRef(reaction: Event): string | null {
    if (reaction.kind !== kinds.Reaction) {
      return null;
    }

    const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1]?.trim();
    if (aTag) {
      if (this.utilities.parseMusicTrackCoordinate(aTag)) {
        return aTag;
      }

      const parts = aTag.split(':');
      if (parts.length >= 3 && Number.parseInt(parts[0], 10) === 34139) {
        return aTag;
      }
    }

    const eTag = reaction.tags.find(tag => tag[0] === 'e')?.[1]?.trim();
    const kindTag = reaction.tags.find(tag => tag[0] === 'k')?.[1]?.trim();
    if (!eTag || !kindTag) {
      return null;
    }

    const kind = Number.parseInt(kindTag, 10);
    if (Number.isNaN(kind) || (!this.utilities.isMusicKind(kind) && kind !== 34139)) {
      return null;
    }

    return eTag;
  }

  private isAlbumReactionRef(ref: string): boolean {
    if (!ref.includes(':')) {
      return false;
    }

    const kind = Number.parseInt(ref.split(':')[0], 10);
    return kind === 34139;
  }
}
