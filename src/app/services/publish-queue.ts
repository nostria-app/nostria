import { inject, Injectable } from '@angular/core';
import { NostrService } from './nostr.service';
import { Event, UnsignedEvent } from 'nostr-tools';
import { ProfileStateService } from './profile-state.service';
import { RelayService } from './relay.service';

export enum PublishTarget {
  Account = 'account',
  User = 'user',
  Discovery = 'discovery',
}

@Injectable({
  providedIn: 'root'
})
export class PublishQueueService {
  private readonly nostr = inject(NostrService);
  private readonly relay = inject(RelayService);
  private readonly profileState = inject(ProfileStateService);

  constructor() { }

  // A queue for publishing Nostr events. Needs to process events in order and wait for signing.
  private queue: { event: any, target: PublishTarget }[] = [];

  // Add a task to the queue
  publish(event: UnsignedEvent | Event, target: PublishTarget): void {
    this.queue.push({ event, target });

    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  // Process the queue
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue[0];
      try {
        if (task.target === PublishTarget.Account) {
          // Publish to account
          const signedEvent = await this.nostr.signEvent(task.event);
          await this.nostr.publish(signedEvent);
        }
        else if (task.target === PublishTarget.User) {
          await this.profileState.relay?.publish(task.event as Event);
        }
        else if (task.target === PublishTarget.Discovery) {
          this.relay.publishToDiscoveryRelays(task.event as Event);
        }
      } catch (error) {
        console.error('Error processing queue task:', error);
      }
      this.queue.shift(); // Remove the task after processing
    }
  }

  // Clear the queue
  clear(): void {
    this.queue = [];
  }
}
