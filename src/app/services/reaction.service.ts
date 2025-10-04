import { inject, Injectable } from '@angular/core';
import type { Event } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import { NostrService } from './nostr.service';

@Injectable({
  providedIn: 'root',
})
export class ReactionService {
  private nostrService = inject(NostrService);

  async addReaction(content: string, event: Event): Promise<boolean> {
    const reactionEvent = this.nostrService.createEvent(kinds.Reaction, content, [
      ['e', event.id],
      ['p', event.pubkey],
      ['k', event.kind.toString()], // Add kind tag for better relay filtering
    ]);

    const result = await this.nostrService.signAndPublish(reactionEvent);
    console.log('Reaction added:', { content, eventId: event.id, success: result });
    return result;
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
    console.log('Reaction deleted:', { eventId: event.id, success: result });
    return result;
  }
}
