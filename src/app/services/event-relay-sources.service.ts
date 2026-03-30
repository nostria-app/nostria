import { Injectable, inject } from '@angular/core';
import { PoolService } from './relays/pool.service';

@Injectable({
  providedIn: 'root',
})
export class EventRelaySourcesService {
  private readonly poolService = inject(PoolService);

  getRelayUrls(eventId: string): string[] {
    const seenOn = this.poolService.pool.seenOn.get(eventId);
    if (!seenOn) {
      return [];
    }

    return [...seenOn]
      .map((relay: { url?: string }) => relay.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
      .filter((url, index, all) => all.indexOf(url) === index)
      .sort((a, b) => a.localeCompare(b));
  }
}
