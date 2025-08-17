import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../interfaces';
import { AccountRelayService } from './relays/account-relay';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root',
})
export class RepostService {
  private nostrService = inject(NostrService);
  private accountRelayService = inject(AccountRelayService);
  private snackBar = inject(MatSnackBar);
  private utilities = inject(UtilitiesService);

  async repostNote(event: Event): Promise<boolean> {
    const repostEvent = this.createRepostEvent(event);

    const published = await this.signAndPublish(repostEvent);
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

  async deleteRepost(event: Event): Promise<boolean> {
    // Create the event
    const deleteEvent = this.nostrService.createRetractionEvent(event);

    const published = await this.signAndPublish(deleteEvent);
    if (published) {
      this.snackBar.open('Repost deletion was requested', 'Dismiss', {
        duration: 3000,
      });
    }
    return published;
  }

  private createRepostEvent(event: Event): UnsignedEvent {
    const tags = [
      ['e', event.id],
      ['p', event.pubkey],
    ];

    // NIP-18 specification: kind:1 events (ShortTextNote) must use kind:6 reposts,
    // while all other event kinds use kind:16 generic reposts.
    // See: https://github.com/nostr-protocol/nips/blob/master/18.md
    if (event.kind === kinds.ShortTextNote) {
      return this.nostrService.createEvent(
        kinds.Repost,
        JSON.stringify(event),
        tags
      );
    }

    return this.nostrService.createEvent(
      kinds.GenericRepost,
      JSON.stringify(event),
      [...tags, ['k', String(event.kind)]]
    );
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
