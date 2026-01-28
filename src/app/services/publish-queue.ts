import { computed, effect, inject, Injectable, Injector } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { UserRelayService } from './relays/user-relay';

export enum PublishTarget {
  Account = 'account',
  User = 'user',
  Discovery = 'discovery',
}

@Injectable({
  providedIn: 'root',
})
export class PublishQueueService {
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly injector = inject(Injector);

  // Lazy-loaded service reference
  private nostr?: any;

  enabled = computed(() => {
    return this.accountState.account() != null;
  });

  constructor() {
    effect(() => {
      if (this.accountState.account()) {
        this.processQueue();
      }
    });
  }

  // Lazy load the NostrService to avoid circular dependency
  private async getNostrService() {
    if (!this.nostr) {
      const { NostrService } = await import('./nostr.service');
      this.nostr = this.injector.get(NostrService);
    }
    return this.nostr;
  }

  // A queue for publishing Nostr events. Needs to process events in order and wait for signing.
  private queue: { event: any; target: PublishTarget }[] = [];

  // Add a task to the queue
  publish(event: UnsignedEvent | Event, target: PublishTarget): void {
    this.queue.push({ event, target });

    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  // Process the queue
  private async processQueue(): Promise<void> {
    if (!this.enabled()) {
      console.warn('PublishQueueService is not enabled. Skipping processing.');
      return;
    }

    const processedIndices: number[] = [];

    // Process all items in the queue in a single loop
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];

      // Ensure the event is for current logged on user. If not, skip this task and leave it in the queue.
      if (task.event.pubkey !== this.accountState.pubkey()) {
        continue;
      }

      try {
        if (task.target === PublishTarget.Account) {
          // Lazy load the NostrService when needed
          const nostr = await this.getNostrService();
          const signedEvent = await nostr.signEvent(task.event);
          await this.accountRelay.publish(signedEvent);
          // await this.nostr.publish(signedEvent);
        } else if (task.target === PublishTarget.User) {
          await this.userRelayService.publish(this.accountState.pubkey(), task.event as Event);
        } else if (task.target === PublishTarget.Discovery) {
          this.discoveryRelay.publish(task.event as Event);
        }

        // Mark this task as processed
        processedIndices.push(i);
      } catch (error) {
        console.error('Error processing queue task:', error);
        // Mark as processed even on error to avoid retrying indefinitely
        processedIndices.push(i);
      }
    }

    // Remove processed tasks from the queue (in reverse order to maintain indices)
    for (let i = processedIndices.length - 1; i >= 0; i--) {
      this.queue.splice(processedIndices[i], 1);
    }
  }
}
