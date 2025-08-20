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
    const reactionEvent = this.nostrService.createEvent(
      kinds.Reaction,
      content,
      [
        ['e', event.id],
        ['p', event.pubkey],
      ]
    );

    return this.nostrService.signAndPublish(reactionEvent);
  }

  async addLike(event: Event): Promise<boolean> {
    return this.addReaction('+', event);
  }

  async addDislike(event: Event): Promise<boolean> {
    return this.addReaction('-', event);
  }

  async deleteReaction(event: Event): Promise<boolean> {
    return this.nostrService.signAndPublish(
      this.nostrService.createRetractionEvent(event)
    );
  }
}
