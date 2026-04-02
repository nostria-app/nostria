import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../interfaces';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import type { DeleteEventReferenceMode } from '../components/delete-confirmation-dialog/delete-confirmation-dialog.component';

export interface RepostReference {
  eventId: string;
  relayHint?: string;
  pubkey?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RepostService {
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private utilities = inject(UtilitiesService);

  async repostNote(event: Event, options?: { expiration?: number; relayUrl?: string }): Promise<boolean> {
    const repostEvent = this.createRepostEvent(event, options?.expiration, options?.relayUrl);

    const result = await this.nostrService.signAndPublish(repostEvent);
    if (result.success) {
      this.snackBar.open('Note reposted successfully!', 'Dismiss', {
        duration: 3000,
      });
    }
    return result.success;
  }

  /**
   * Check if this is a repost event (kind 6 or kind 16)
   */
  isRepostEvent(event: Event): boolean {
    return event.kind === kinds.Repost || event.kind === kinds.GenericRepost;
  }

  /**
   * Check if the repost has embedded content (event JSON in content field)
   */
  hasEmbeddedContent(event: Event): boolean {
    return !!event.content && event.content.trim() !== '';
  }

  /**
   * Get the referenced event info from the repost's e tag
   * NIP-18: Reposts can have empty content and reference the event via e tag with relay hint
   */
  getRepostReference(event: Event): RepostReference | null {
    if (!this.isRepostEvent(event)) return null;

    // Find the e tag with the referenced event id and optional relay hint
    const eTag = event.tags.find(tag => tag[0] === 'e');
    if (!eTag || !eTag[1]) return null;

    return {
      eventId: eTag[1],
      relayHint: eTag[2] || undefined,
      pubkey: eTag[4] || undefined, // Some clients include pubkey as 5th element
    };
  }

  /**
   * Decode a repost that has embedded content
   * Returns null if content is empty (use getRepostReference to fetch from relay)
   */
  decodeRepost(event: Event): NostrRecord | null {
    // Return null if content is empty - caller should use async fetch
    if (!event.content || event.content.trim() === '') {
      return null;
    }

    const repostedEvent = this.utilities.parseContent(event.content);

    // Validate that we got a proper event object
    if (!repostedEvent || typeof repostedEvent !== 'object' || !repostedEvent.id || !repostedEvent.pubkey) {
      return null;
    }

    return {
      event: repostedEvent,
      data: this.utilities.parseContent(repostedEvent.content),
    };
  }

  async deleteRepost(event: Event, referenceMode: DeleteEventReferenceMode = 'e'): Promise<boolean> {
    // Create the event
    const deleteEvent = this.nostrService.createRetractionEventWithMode(event, referenceMode);

    const result = await this.nostrService.signAndPublish(deleteEvent);
    if (result.success) {
      this.snackBar.open('Repost deletion was requested', 'Dismiss', {
        duration: 3000,
      });
    }
    return result.success;
  }

  /**
   * Get the expiration timestamp from an event (NIP-40)
   * Returns the expiration timestamp in seconds, or null if no expiration set
   */
  getEventExpiration(event: Event): number | null {
    return this.utilities.getEventExpiration(event);
  }

  private createRepostEvent(event: Event, expiration?: number, relayUrl?: string): UnsignedEvent {
    const normalizedRelayUrl = relayUrl?.trim() || '';
    const eTag = normalizedRelayUrl ? ['e', event.id, normalizedRelayUrl] : ['e', event.id];
    const tags: string[][] = [
      eTag,
      ['p', event.pubkey],
    ];

    // Add expiration tag if provided (NIP-40)
    if (expiration !== undefined) {
      tags.push(['expiration', expiration.toString()]);
    }

    // Strip non-protocol properties (e.g. dTag added by database indexing)
    // before embedding the event JSON in the repost content.
    const { id, pubkey, created_at, kind, tags: eventTags, content, sig } = event;
    const cleanEvent = { id, pubkey, created_at, kind, tags: eventTags, content, sig };

    // NIP-18 specification: kind:1 events (ShortTextNote) must use kind:6 reposts,
    // while all other event kinds use kind:16 generic reposts.
    // See: https://github.com/nostria-app/nips/blob/master/18.md
    if (event.kind === kinds.ShortTextNote) {
      return this.nostrService.createEvent(kinds.Repost, JSON.stringify(cleanEvent), tags);
    }

    const genericTags: string[][] = [
      ...tags,
      ['k', String(event.kind)],
    ];

    const coordinateTag = this.getReplaceableCoordinateTag(event);
    if (coordinateTag) {
      genericTags.push(['a', coordinateTag]);
    }

    return this.nostrService.createEvent(kinds.GenericRepost, JSON.stringify(cleanEvent), genericTags);
  }

  private getReplaceableCoordinateTag(event: Event): string | null {
    const isReplaceable = event.kind === kinds.Metadata || event.kind === kinds.Contacts ||
      (event.kind >= 10000 && event.kind < 20000);
    const isAddressable = event.kind >= 30000 && event.kind < 40000;

    if (isAddressable) {
      const identifier = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      return `${event.kind}:${event.pubkey}:${identifier}`;
    }

    if (isReplaceable) {
      return `${event.kind}:${event.pubkey}:`;
    }

    return null;
  }
}
