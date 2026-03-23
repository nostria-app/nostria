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
 * Service managing the NIP-51 Communities list (kind 10004).
 * Stores NIP-72 community coordinates the user has joined using "a" tags
 * referencing kind:34550 community definition events.
 *
 * Tag format: ["a", "34550:<pubkey>:<d-tag>"]
 */
@Injectable({
  providedIn: 'root',
})
export class CommunityListService {
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

  /** Community coordinates (e.g. "34550:<pubkey>:<d-tag>") in the communities list */
  communityCoordinates = computed<string[]>(() => {
    return (
      this.listEvent()
        ?.tags.filter(tag => tag[0] === 'a')
        .map(tag => tag[1]) || []
    );
  });

  /** Set of community coordinates for fast lookups */
  communityCoordinateSet = computed<Set<string>>(() => new Set(this.communityCoordinates()));

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
      10004
    );
    this.listEvent.set(event);
    this.initialized.set(true);
  }

  /**
   * Update the list from a relay event. Only applies if the event is newer
   * than the current one. Called by NostrService when a kind 10004 event
   * arrives on the account subscription.
   */
  updateFromEvent(event: Event): void {
    const current = this.listEvent();
    if (!current || event.created_at >= current.created_at) {
      this.listEvent.set(event);
    }
  }

  /** Check if a community is in the communities list */
  isCommunityInList(coordinate: string): boolean {
    return this.communityCoordinateSet().has(coordinate);
  }

  /** Add a community to the communities list */
  async addCommunity(coordinate: string) {
    let event = this.listEvent();

    if (!event) {
      event = {
        kind: 10004,
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

    if (event.tags.some(tag => tag[0] === 'a' && tag[1] === coordinate)) {
      return;
    }

    // NIP-51: new items appended to the end
    event.tags.push(['a', coordinate]);

    await this.publish(event);
  }

  /** Remove a community from the communities list */
  async removeCommunity(coordinate: string) {
    const existingEvent = this.listEvent();
    if (!existingEvent) return;

    const event = {
      ...existingEvent,
      tags: existingEvent.tags.filter(tag => !(tag[0] === 'a' && tag[1] === coordinate)),
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
    await this.layout.showPublishResults(publishPromises, 'Communities');
  }
}
