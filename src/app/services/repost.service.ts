import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { kinds } from 'nostr-tools';
import type { NostrRecord } from '../interfaces';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';

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

  async repostNote(event: Event): Promise<boolean> {
    if (this.isProtectedEvent(event)) {
      this.snackBar.open('Protected events cannot be reposted', 'Dismiss', {
        duration: 3000,
      });
      return false;
    }

    const repostEvent = this.createRepostEvent(event);

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

  isProtectedEvent(event: Event): boolean {
    return event.tags.some(tag => tag[0] === '-');
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

  async deleteRepost(event: Event): Promise<boolean> {
    // Create the event
    const deleteEvent = this.nostrService.createRetractionEvent(event);

    const result = await this.nostrService.signAndPublish(deleteEvent);
    if (result.success) {
      this.snackBar.open('Repost deletion was requested', 'Dismiss', {
        duration: 3000,
      });
    }
    return result.success;
  }

  private createRepostEvent(event: Event): UnsignedEvent {
    const tags = [
      ['e', event.id],
      ['p', event.pubkey],
    ];

    // NIP-18 specification: kind:1 events (ShortTextNote) must use kind:6 reposts,
    // while all other event kinds use kind:16 generic reposts.
    // See: https://github.com/nostria-app/nips/blob/master/18.md
    if (event.kind === kinds.ShortTextNote) {
      return this.nostrService.createEvent(kinds.Repost, JSON.stringify(event), tags);
    }

    const genericTags: string[][] = [
      ...tags,
      ['k', String(event.kind)],
    ];

    const coordinateTag = this.getReplaceableCoordinateTag(event);
    if (coordinateTag) {
      genericTags.push(['a', coordinateTag]);
    }

    return this.nostrService.createEvent(kinds.GenericRepost, JSON.stringify(event), genericTags);
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
