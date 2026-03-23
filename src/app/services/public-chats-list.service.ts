import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { NostrService } from './nostr.service';
import { ApplicationStateService } from './application-state.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from './layout.service';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';

/**
 * Service managing the NIP-51 Public Chats list (kind 10005).
 * Stores NIP-28 channel IDs the user has joined/pinned using "e" tags
 * referencing kind:40 channel definition events.
 */
@Injectable({
  providedIn: 'root',
})
export class PublicChatsListService {
  private accountRelay = inject(AccountRelayService);
  private nostr = inject(NostrService);
  private appState = inject(ApplicationStateService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private layout = inject(LayoutService);
  private database = inject(DatabaseService);

  listEvent = signal<Event | null>(null);

  /** Whether the initial load from IndexedDB has completed */
  readonly initialized = signal<boolean>(false);

  /** Channel IDs (kind:40 event IDs) in the public chats list */
  channelIds = computed<string[]>(() => {
    return (
      this.listEvent()
        ?.tags.filter(tag => tag[0] === 'e')
        .map(tag => tag[1]) || []
    );
  });

  /** Set of channel IDs for fast lookups */
  channelIdSet = computed<Set<string>>(() => new Set(this.channelIds()));

  constructor() {
    effect(async () => {
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.listEvent.set(null);
        this.initialized.set(false);
      }
    });
  }

  async initialize() {
    const event = await this.database.getEventByPubkeyAndKind(
      this.accountState.pubkey()!,
      10005
    );
    this.listEvent.set(event);
    this.initialized.set(true);
  }

  /**
   * Update the list from a relay event. Only applies if the event is newer
   * than the current one. Called by NostrService when a kind 10005 event
   * arrives on the account subscription.
   */
  updateFromEvent(event: Event): void {
    const current = this.listEvent();
    if (!current || event.created_at >= current.created_at) {
      this.listEvent.set(event);
    }
  }

  /** Check if a channel is in the public chats list */
  isChannelInList(channelId: string): boolean {
    return this.channelIdSet().has(channelId);
  }

  /** Add a channel to the public chats list */
  async addChannel(channelId: string) {
    let event = this.listEvent();

    if (!event) {
      event = {
        kind: 10005,
        pubkey: this.accountState.pubkey(),
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [],
        id: '',
        sig: '',
      } as unknown as Event;
    } else {
      event = { ...event, tags: [...event.tags] };
    }

    if (event.tags.some(tag => tag[0] === 'e' && tag[1] === channelId)) {
      return;
    }

    // NIP-51: new items appended to the end
    event.tags.push(['e', channelId]);

    await this.publish(event);
  }

  /** Remove a channel from the public chats list */
  async removeChannel(channelId: string) {
    const existingEvent = this.listEvent();
    if (!existingEvent) return;

    const event = {
      ...existingEvent,
      tags: existingEvent.tags.filter(tag => !(tag[0] === 'e' && tag[1] === channelId)),
    };

    await this.publish(event);
  }

  private async publish(event: Event) {
    event.id = '';
    event.sig = '';
    event.created_at = Math.floor(Date.now() / 1000);

    const signedEvent = await this.nostr.signEvent(event);

    await this.database.saveEvent(signedEvent);
    this.listEvent.set(signedEvent);

    const publishPromises = await this.accountRelay.publish(signedEvent);
    await this.layout.showPublishResults(publishPromises, 'Public Chats');
  }
}
