import { Injectable, inject } from '@angular/core';
import { UserDataService } from './user-data.service';

/**
 * Lightweight helper for common UserDataService operations.
 * Now that UserDataService is a singleton, this just provides convenient wrappers.
 */
@Injectable({
  providedIn: 'root',
})
export class OnDemandUserDataService {
  private userDataService = inject(UserDataService);

  getProfile(pubkey: string, refresh = false) {
    return this.userDataService.getProfile(pubkey, refresh);
  }

  getProfiles(pubkeys: string[]) {
    return this.userDataService.getProfiles(pubkeys);
  }

  getEvent(pubkey: string, id: string) {
    return this.userDataService.getEventById(pubkey, id, { cache: true, save: true });
  }

  /**
   * Fetch events (replaceable or regular) of a kind for a single pubkey.
   */
  getEventsByPubkeyAndKind(pubkey: string, kind: number) {
    return this.userDataService.getEventsByPubkeyAndKind(pubkey, kind, { cache: true, save: true });
  }

  /**
   * Fetch events with pagination support for infinite scroll
   */
  getEventsByPubkeyAndKindPaginated(pubkey: string, kind: number, until?: number, limit = 20) {
    console.log('[OnDemandUserData] getEventsByPubkeyAndKindPaginated called:', { pubkey: pubkey.slice(0, 8), kind, until, limit });
    return this.userDataService.getEventsByPubkeyAndKindPaginated(pubkey, kind, until, limit, { save: true });
  }
}
