import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { UnsignedEvent, kinds, Event } from 'nostr-tools';
import { AccountRelayService } from './account-relay.service';
import { NostrService } from './nostr.service';

@Injectable({
  providedIn: 'root',
})
export class RepostService {
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private accountRelayService = inject(AccountRelayService);

  async repostNote(event: Event): Promise<boolean> {
    // Create the event
    const unsignedEvent: UnsignedEvent = {
      kind: kinds.Repost,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', event.id],
        ['p', event.pubkey],
      ],
      content: JSON.stringify(event),
      pubkey: this.accountState.pubkey(),
    };

    return this.signAndPublish(unsignedEvent);
  }

  private async signAndPublish(event: UnsignedEvent): Promise<boolean> {
    const signedEvent = await this.nostrService.signEvent(event);

    const publishPromises = this.accountRelayService.publish(signedEvent);

    if (publishPromises) {
      await Promise.allSettled(publishPromises);
      return true;
    } else {
      return false;
    }
  }
}
