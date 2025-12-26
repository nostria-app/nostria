import { inject, Injectable, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { NostrService } from './services/nostr.service';
import { LayoutService } from './services/layout.service';
import { Meta } from '@angular/platform-browser';
import { UtilitiesService } from './services/utilities.service';
import { MetaService } from './services/meta.service';
import { UsernameService } from './services/username';

export const EVENT_STATE_KEY = makeStateKey<any>('large-json-data');

export interface EventData {
  title: string;
  description: string;
  event?: any;
  metadata?: any;
}

@Injectable({ providedIn: 'root' })
export class DataResolver implements Resolve<EventData | null> {
  nostr = inject(NostrService);
  layout = inject(LayoutService);
  transferState = inject(TransferState);
  utilities = inject(UtilitiesService);
  metaService = inject(MetaService);
  meta = inject(Meta);
  usernameService = inject(UsernameService);

  constructor() { }

  async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
    if (this.layout.isBrowser()) {
      return null;
    }

    let id = route.params['id'] || route.params['pubkey'];

    // For username routes, resolve the username to pubkey
    const username = route.params['username'];
    if (!id && username) {
      console.log('[SSR] DataResolver: Resolving username to pubkey:', username);
      id = await this.usernameService.getPubkey(username);
      console.log('[SSR] DataResolver: Resolved username', username, 'to pubkey:', id);
    }

    console.log('[SSR] DataResolver: Attempting to load metadata for id:', id);

    const data: EventData = {
      title: 'Nostr Event',
      description: 'Loading Nostr event content...',
    };

    // If we don't have a valid id, return early
    if (!id || id === 'undefined' || !id.trim()) {
      console.warn('[SSR] DataResolver: No valid id found, skipping metadata load');
      this.transferState.set(EVENT_STATE_KEY, data);
      return data;
    }

    try {
      if (this.utilities.isHex(id)) {
        // Convert hex pubkey to npub for metadata loading
        const npub = this.utilities.getNpubFromPubkey(id);
        console.log('[SSR] Converting hex pubkey to npub:', id, '->', npub);
        const metadata = await this.metaService.loadSocialMetadata(npub);
        const { author, ...metadataWithoutAuthor } = metadata;
        data.event = metadataWithoutAuthor;
        data.metadata = metadata.author;
      } else {
        const metadata = await this.metaService.loadSocialMetadata(id);
        const { author, ...metadataWithoutAuthor } = metadata;
        data.event = metadataWithoutAuthor;
        data.metadata = metadata.author;
      }
    } catch (error) {
      console.error('[SSR] Failed to load metadata:', error);
      data.title = 'Nostr Event (Error)';
      data.description = 'Error loading event content';
    }

    this.transferState.set(EVENT_STATE_KEY, data);

    return data;
  }
}
