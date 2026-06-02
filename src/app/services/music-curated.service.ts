import { Injectable, inject, signal } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { DatabaseService } from './database.service';
import { RelayPoolService } from './relays/relay-pool';
import { UserRelaysService } from './relays/user-relays';
import { LoggerService } from './logger.service';

export const CURATED_MUSIC_FILTER = 'curated';
export const CURATED_MUSIC_KIND = 30000;
export const CURATED_MUSIC_D_TAG = 'nostria-musicians';
export const CURATED_MUSIC_AUTHOR = '929dd94e6cc8a6665665a1e1fc043952c014c16c1735578e3436cd4510b1e829';

const FALLBACK_CURATED_MUSIC_EVENT: Event = {
  content: '',
  created_at: 1779916226,
  id: 'e3ebfeef4fa59a8f1ac382236b613ef8aab5c9cf8b094ee9031d161d21ef9c91',
  kind: CURATED_MUSIC_KIND,
  pubkey: CURATED_MUSIC_AUTHOR,
  sig: '29fbc1cd7cc8b090c931d9b40e85ed2af35dea20dd110f0b75cf734fe0a571ef0c3e375f0a74c4696547754168954a51906843b49e8bccfea5352ebf61a7fb71',
  tags: [
    ['d', CURATED_MUSIC_D_TAG],
    ['title', 'Musicians'],
    ['p', '9c73236f565eb90bd4681c29ebb2d9c1b80e4e184cdbf84d6da742e990670cb6'],
    ['p', '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515'],
    ['p', '48e976057bf2cf1333020355b5d243f8dd813f193051d1cb04413894f46acc43'],
    ['client', 'nostria'],
  ],
};

@Injectable({ providedIn: 'root' })
export class MusicCuratedService {
  private database = inject(DatabaseService);
  private pool = inject(RelayPoolService);
  private userRelays = inject(UserRelaysService);
  private logger = inject(LoggerService);

  private loadPromise: Promise<string[]> | null = null;
  private refreshPromise: Promise<void> | null = null;

  readonly event = signal<Event | null>(FALLBACK_CURATED_MUSIC_EVENT);
  readonly pubkeys = signal<string[]>(this.extractPubkeys(FALLBACK_CURATED_MUSIC_EVENT));

  async ensureLoaded(): Promise<string[]> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadCuratedEvent().finally(() => {
        this.loadPromise = null;
      });
    }

    return this.loadPromise;
  }

  refreshFromRelays(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshCuratedEvent().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  private async loadCuratedEvent(): Promise<string[]> {
    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        CURATED_MUSIC_AUTHOR,
        CURATED_MUSIC_KIND,
        CURATED_MUSIC_D_TAG
      );

      if (cachedEvent) {
        this.applyEvent(cachedEvent);
      } else {
        this.applyEvent(FALLBACK_CURATED_MUSIC_EVENT);
        await this.database.saveReplaceableEvent({
          ...FALLBACK_CURATED_MUSIC_EVENT,
          dTag: CURATED_MUSIC_D_TAG,
        });
      }
    } catch (error) {
      this.logger.warn('[MusicCurated] Failed to load cached curated music list:', error);
      this.applyEvent(FALLBACK_CURATED_MUSIC_EVENT);
    }

    void this.refreshFromRelays();
    return this.pubkeys();
  }

  private async refreshCuratedEvent(): Promise<void> {
    try {
      const relayUrls = await this.userRelays.getUserRelaysForReading(CURATED_MUSIC_AUTHOR, 8);
      if (relayUrls.length === 0) {
        this.logger.warn('[MusicCurated] No read relays found for curated music author');
        return;
      }

      const filter: Filter = {
        kinds: [CURATED_MUSIC_KIND],
        authors: [CURATED_MUSIC_AUTHOR],
        '#d': [CURATED_MUSIC_D_TAG],
        limit: 1,
      };

      const events = await this.pool.query(relayUrls, filter, 5000);
      const latestEvent = events
        .filter(event => this.hasExpectedDTag(event))
        .sort((a, b) => b.created_at - a.created_at)[0];

      if (!latestEvent) {
        return;
      }

      const currentEvent = this.event();
      if (currentEvent && currentEvent.created_at > latestEvent.created_at) {
        return;
      }

      this.applyEvent(latestEvent);
      await this.database.saveReplaceableEvent({ ...latestEvent, dTag: CURATED_MUSIC_D_TAG });
    } catch (error) {
      this.logger.warn('[MusicCurated] Failed to refresh curated music list:', error);
    }
  }

  private applyEvent(event: Event): void {
    const pubkeys = this.extractPubkeys(event);

    this.event.set(event);
    this.pubkeys.set(pubkeys.length > 0 ? pubkeys : this.extractPubkeys(FALLBACK_CURATED_MUSIC_EVENT));
  }

  private hasExpectedDTag(event: Event): boolean {
    return event.tags.some(tag => tag[0] === 'd' && tag[1] === CURATED_MUSIC_D_TAG);
  }

  private extractPubkeys(event: Event): string[] {
    return Array.from(new Set(
      event.tags
        .filter(tag => tag[0] === 'p' && !!tag[1])
        .map(tag => tag[1])
    ));
  }
}
