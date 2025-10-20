import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { LayoutService } from './layout.service';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from './account-state.service';
import { NostrRecord } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);

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
        const cachedResults = this.accountState.searchProfiles(searchValue);
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
