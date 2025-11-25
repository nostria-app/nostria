import { inject, Injectable } from '@angular/core';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root',
})
export class ReactionService {
  private nostrService = inject(NostrService);
  private utilities = inject(UtilitiesService);

  async addReaction(content: string, event: Event): Promise<boolean> {
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

    const reactionEvent = this.nostrService.createEvent(kinds.Reaction, content, tags);

    const result = await this.nostrService.signAndPublish(reactionEvent);
    console.log('Reaction added:', { content, eventId: event.id, success: result.success });
    return result.success;
  }

  async addLike(event: Event): Promise<boolean> {
    return this.addReaction('+', event);
  }

  async addDislike(event: Event): Promise<boolean> {
    return this.addReaction('-', event);
  }

  async deleteReaction(event: Event): Promise<boolean> {
    const deleteEvent = this.nostrService.createRetractionEvent(event);
    const result = await this.nostrService.signAndPublish(deleteEvent);
    console.log('Reaction deleted:', { eventId: event.id, success: result.success });
    return result.success;
  }
}
