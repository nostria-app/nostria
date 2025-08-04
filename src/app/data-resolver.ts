import { inject, Injectable, makeStateKey, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { NostrService } from './services/nostr.service';
import { LayoutService } from './services/layout.service';
import { Meta } from '@angular/platform-browser';
import { UtilitiesService } from './services/utilities.service';
import { MetaService } from './services/meta.service';

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

  constructor() {}

  async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
    if (this.layout.isBrowser()) {
      return null;
    }

    const id = route.params['id'];

    let data: EventData = {
      title: 'Nostr Event',
      description: 'Loading Nostr event content...',
    };

    try {
      if (this.utilities.isHex(id)) {
        // If we only have hex, we can't know which relay to find the event on.
        data.title = 'Nostr Event (Hex)';
      } else {
        const metadata = await this.metaService.loadSocialMetadata(id);
        const { author, ...metadataWithoutAuthor } = metadata;
        data.event = metadataWithoutAuthor;
      }
    } catch (error) {
      console.error('Error processing Nostr event:', error);
      data.title = 'Nostr Event (Error)';
      data.description = 'Error loading event content';
    }

    this.transferState.set(EVENT_STATE_KEY, data);

    return data;
  }
}
