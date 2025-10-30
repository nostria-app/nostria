import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { LayoutService } from './layout.service';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from './account-state.service';
import { NostrRecord } from '../interfaces';
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  userData = inject(UserDataService);
  relaysService = inject(RelaysService);
  relayPool = inject(RelayPoolService);
  storage = inject(StorageService);

  // Search results from cached profiles
  searchResults = signal<NostrRecord[]>([]);

  // Track last processed query to prevent redundant searches
  #lastQuery = '';

  constructor() {
    effect(async () => {
      const query = this.layout.query();
      const searchValue = query?.trim() || '';

      // Skip if query hasn't changed
      if (searchValue === this.#lastQuery) {
        return;
      }

      this.#lastQuery = searchValue;
      console.log('SearchService effect triggered with query:', query);

      if (searchValue) {
        // First, search in cached profiles
        const cachedResults = untracked(() => this.accountState.searchProfiles(searchValue));
        console.log(
          'Cached search results:',
          cachedResults.length,
          'results for query:',
          searchValue
        );

        // Use untracked to prevent creating reactive dependencies
        untracked(() => {
          this.searchResults.set(cachedResults);
        });

        // Check if the query is a valid hex string (64 characters) - potential event ID
        const isHexEventId = /^[0-9a-f]{64}$/i.test(searchValue);

        // If no cached results and query looks like an event ID, search for the event
        if (cachedResults.length === 0 && isHexEventId) {
          await this.searchForEventById(searchValue);
        }

        // If query looks like an email (NIP-05), also try NIP-05 lookup
        if (searchValue.indexOf('@') > -1) {
          let nip05Value = searchValue;
          if (!nip05Value.startsWith('_')) {
            nip05Value = '_' + nip05Value;
          }

          if (isNip05(nip05Value)) {
            try {
              const profile = await queryProfile(nip05Value);
              console.log('Profile:', profile);

              if (profile?.pubkey) {
                this.layout.openProfile(profile?.pubkey);
                this.layout.toggleSearch();
              } else {
                this.layout.toast('Profile not found via NIP-05');
              }
            } catch (error) {
              console.error('NIP-05 lookup failed:', error);
              // Don't show error toast, just continue with cached results
            }
          }
        }
      } else {
        // Clear results when query is empty
        untracked(() => {
          this.searchResults.set([]);
        });
      }
    });
  }

  /**
   * Search for an event by ID when profile search fails
   * First tries account relays, then falls back to popular observed relays
   */
  private async searchForEventById(eventId: string): Promise<void> {
    console.log('Searching for event by ID:', eventId);

    try {
      // If user is authenticated, try their account relays first
      if (this.accountState.pubkey()) {
        const pubkey = this.accountState.pubkey();
        console.log('Trying to fetch event from account relays');

        const event = await this.userData.getEventById(pubkey, eventId, {
          save: true,
          cache: false,
        });

        if (event) {
          console.log('Event found on account relays:', event);
          this.layout.openEvent(eventId, event.event);
          this.layout.toggleSearch();
          return;
        }
      }

      // If not found on account relays, try observed relays sorted by popularity
      console.log('Event not found on account relays, trying observed relays');

      const observedRelays = await this.relaysService.getAllObservedRelays();

      // Sort by events received (popularity) and connection success
      const sortedRelays = observedRelays
        .sort((a, b) => {
          // Prioritize connected relays
          if (a.isConnected && !b.isConnected) return -1;
          if (!a.isConnected && b.isConnected) return 1;

          // Then sort by events received (popularity)
          if (b.eventsReceived !== a.eventsReceived) {
            return b.eventsReceived - a.eventsReceived;
          }

          // Finally by last successful connection
          return b.lastSuccessfulConnection - a.lastSuccessfulConnection;
        })
        .map(relay => relay.url);

      console.log(
        'Searching through',
        sortedRelays.length,
        'observed relays (most popular first)'
      );

      // Try up to 20 of the most popular relays
      const relaysToTry = sortedRelays.slice(0, 20);

      for (const relayUrl of relaysToTry) {
        try {
          console.log('Trying relay:', relayUrl);
          const event = await this.relayPool.getEventById([relayUrl], eventId, 2000);

          if (event) {
            console.log('Event found on relay:', relayUrl);
            this.layout.openEvent(eventId, event);
            this.layout.toggleSearch();

            // Save the event for future use
            await this.storage.saveEvent(event);
            return;
          }
        } catch (error) {
          console.debug('Failed to fetch from relay:', relayUrl, error);
          // Continue to next relay
        }
      }

      console.log('Event not found on any relay');
      this.layout.toast('Event not found');
    } catch (error) {
      console.error('Error searching for event:', error);
      this.layout.toast('Failed to search for event');
    }
  }

  // Method to select a search result
  selectSearchResult(profile: NostrRecord): void {
    this.layout.openProfile(profile.event.pubkey);
    this.layout.toggleSearch();
    untracked(() => {
      this.searchResults.set([]);
    });
  }

  // Method to clear search results
  clearResults(): void {
    untracked(() => {
      this.searchResults.set([]);
    });
  }
}
