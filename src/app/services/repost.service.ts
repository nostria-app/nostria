import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, kinds, UnsignedEvent } from 'nostr-tools';
import { AccountRelayService } from './account-relay.service';
import { AccountStateService } from './account-state.service';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import { NostrRecord } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class RepostService {
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private accountRelayService = inject(AccountRelayService);
  private snackBar = inject(MatSnackBar);
  private utilities = inject(UtilitiesService);

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

    const published = await this.signAndPublish(unsignedEvent);
    if (published) {
      this.snackBar.open('Note reposted successfully!', 'Dismiss', {
        duration: 3000,
      });
    }
    return published;
  }

  decodeRepost(event: Event): NostrRecord {
    const repostedEvent = this.utilities.parseContent(event.content);
    return {
      event: repostedEvent,
      data: this.utilities.parseContent(repostedEvent.content),
    };
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
