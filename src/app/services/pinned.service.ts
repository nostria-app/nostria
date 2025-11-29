import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { NostrService } from './nostr.service';
import { ApplicationService } from './application.service';
import { ApplicationStateService } from './application-state.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from './layout.service';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { UserRelayService } from './relays/user-relay';

@Injectable({
  providedIn: 'root',
})
export class PinnedService {
  accountRelay = inject(AccountRelayService);
  userRelay = inject(UserRelayService);
  nostr = inject(NostrService);
  app = inject(ApplicationService);
  appState = inject(ApplicationStateService);
  accountState = inject(AccountStateService);
  snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);
  database = inject(DatabaseService);

  pinnedEvent = signal<Event | null>(null);

  pinnedNotes = computed<string[]>(() => {
    return (
      this.pinnedEvent()
        ?.tags.filter(tag => tag[0] === 'e')
        .map(tag => tag[1]) || []
    );
  });

  constructor() {
    effect(async () => {
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        await this.initialize();
      } else {
        this.pinnedEvent.set(null);
      }
    });
  }

  async initialize() {
    // Pinned list (kind 10001) should be fetched from storage
    const pinnedEvent = await this.database.getEventByPubkeyAndKind(
      this.accountState.pubkey()!,
      10001
    );
    this.pinnedEvent.set(pinnedEvent);
  }

  /**
   * Get pinned notes for a specific user
   */
  async getPinnedNotesForUser(pubkey: string): Promise<string[]> {
    // Try to get from storage first
    let pinnedEvent = await this.database.getEventByPubkeyAndKind(pubkey, 10001);

    // If not in storage, try to fetch from user relays
    if (!pinnedEvent) {
      pinnedEvent = await this.userRelay.getEventByPubkeyAndKind(pubkey, 10001);

      // If found, save to storage for future use
      if (pinnedEvent) {
        await this.database.saveEvent(pinnedEvent);
      }
    }

    if (!pinnedEvent) {
      return [];
    }

    // According to NIP-51, items are in chronological order (oldest first)
    // We want the last 3 items (most recent pins)
    const eventTags = pinnedEvent.tags
      .filter(tag => tag[0] === 'e')
      .map(tag => tag[1]);

    // Return last 3 items (most recent pins)
    return eventTags.slice(-3).reverse();
  }

  /**
   * Pin a note (add to the end of the list)
   * @param eventId The event ID to pin
   */
  async pinNote(eventId: string) {
    let event = this.pinnedEvent();

    if (!event) {
      // Create a new pinned event if none exists
      event = {
        kind: 10001,
        pubkey: this.accountState.pubkey(),
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [],
        id: '',
        sig: '',
      };
    } else {
      // Create a copy to avoid mutating the existing event
      event = {
        ...event,
        tags: [...event.tags],
      };
    }

    // Check if the note is already pinned
    const existingPin = event.tags.find(tag => tag[0] === 'e' && tag[1] === eventId);

    if (existingPin) {
      this.snackBar.open('This note is already pinned', 'Close', {
        duration: 3000,
      });
      return;
    }

    // According to NIP-51, new items should be appended to the end
    event.tags.push(['e', eventId]);

    // Publish the updated event
    await this.publish(event);
  }

  /**
   * Unpin a note
   * @param eventId The event ID to unpin
   */
  async unpinNote(eventId: string) {
    const existingEvent = this.pinnedEvent();

    if (!existingEvent) {
      return;
    }

    // Create a copy to avoid mutating the existing event
    const event = {
      ...existingEvent,
      tags: existingEvent.tags.filter(tag => !(tag[0] === 'e' && tag[1] === eventId)),
    };

    // Publish the updated event
    await this.publish(event);
  }

  /**
   * Check if a note is pinned
   * @param eventId The event ID to check
   */
  isPinned(eventId: string): boolean {
    return this.pinnedNotes().includes(eventId);
  }

  /**
   * Get tooltip text based on pin status
   */
  getPinTooltip(eventId: string): string {
    return this.isPinned(eventId) ? 'Unpin note' : 'Pin note';
  }

  /**
   * Get icon based on pin status
   */
  getPinIcon(eventId: string): string {
    return this.isPinned(eventId) ? 'push_pin' : 'push_pin';
  }

  async publish(event: Event) {
    if (!event) {
      return;
    }

    event.id = '';
    event.sig = '';
    event.created_at = Math.floor(Date.now() / 1000);

    // Sign the event
    const signedEvent = await this.nostr.signEvent(event);

    // Save to storage immediately for instant local updates
    await this.database.saveEvent(signedEvent);

    // Update the local pinned event with the signed event
    this.pinnedEvent.set(signedEvent);

    // Publish to relays and get array of promises
    const publishPromises = await this.accountRelay.publish(signedEvent);

    await this.layout.showPublishResults(publishPromises, 'Pinned Notes');

    try {
      // Wait for all publishing results
      const results = await Promise.all(publishPromises || []);

      // Count successes and failures
      const successful = results.filter(result => result === '').length;
      const failed = results.length - successful;

      // Display appropriate notification
      if (failed === 0) {
        this.snackBar.open(
          `Pinned notes saved successfully to ${successful} ${successful === 1 ? 'relay' : 'relays'}`,
          'Close',
          {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'success-snackbar',
          }
        );
      } else if (successful > 0) {
        this.snackBar.open(
          `Pinned notes saved to ${successful} ${successful === 1 ? 'relay' : 'relays'}, failed on ${failed}`,
          'Close',
          {
            duration: 5000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'warning-snackbar',
          }
        );
      } else {
        this.snackBar.open('Failed to save pinned notes to any relay', 'Close', {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'error-snackbar',
        });
      }
    } catch (error) {
      console.error('Error publishing pinned notes:', error);
      this.snackBar.open('Error publishing pinned notes', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: 'error-snackbar',
      });
    }
  }
}
