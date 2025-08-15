import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, kinds, UnsignedEvent } from 'nostr-tools';
import { AccountRelayService } from './account-relay.service';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import { NostrRecord } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class RepostService {
  private nostrService = inject(NostrService);
  private accountRelayService = inject(AccountRelayService);
  private snackBar = inject(MatSnackBar);
  private utilities = inject(UtilitiesService);

  async repostNote(event: Event): Promise<boolean> {
    const repostEvent = this.nostrService.createEvent(
      kinds.Repost,
      JSON.stringify(event),
      [
        ['e', event.id],
        ['p', event.pubkey],
      ]
    );

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
