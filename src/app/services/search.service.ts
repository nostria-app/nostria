import { effect, inject, Injectable, signal } from '@angular/core';
import { LayoutService } from './layout.service';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from './account-state.service';
import { NostrRecord } from '../interfaces';
import { nip19 } from 'nostr-tools';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  router = inject(Router);

  // Search results from cached profiles
  searchResults = signal<NostrRecord[]>([]);
  constructor() {
    effect(async () => {
      const query = this.layout.query();
      let searchValue = query?.trim();

      console.log('SearchService effect triggered with query:', query);

      if (searchValue) {
        // Check if the search value is a nostr: prefixed URL
        if (searchValue.startsWith('nostr:')) {
          try {
            await this.handleNostrUrl(searchValue);
            return; // Exit early as we've handled the nostr URL
          } catch (error) {
            console.error('Failed to parse nostr URL:', error);
            this.layout.toast('Invalid nostr URL format');
            return;
          }
        }

        // First, search in cached profiles
        const cachedResults = this.accountState.searchProfiles(searchValue);
        console.log(
          'Cached search results:',
          cachedResults.length,
          'results for query:',
          searchValue,
        );
        this.searchResults.set(cachedResults);

        // If query looks like an email (NIP-05), also try NIP-05 lookup
        if (searchValue.indexOf('@') > -1) {
          if (!searchValue.startsWith('_')) {
            searchValue = '_' + searchValue;
          }

          if (isNip05(searchValue)) {
            try {
              const profile = await queryProfile(searchValue);
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
        this.searchResults.set([]);
      }
    });
  }

  // Method to select a search result
  selectSearchResult(profile: NostrRecord): void {
    this.layout.openProfile(profile.event.pubkey);
    this.layout.toggleSearch();
    this.searchResults.set([]);
  }

  // Method to clear search results
  clearResults(): void {
    this.searchResults.set([]);
  }

  /**
   * Handle nostr: prefixed URLs by parsing and routing appropriately
   */
  private async handleNostrUrl(nostrUrl: string): Promise<void> {
    // Remove the 'nostr:' prefix
    const encodedPart = nostrUrl.substring(6);

    try {
      // Decode the nostr entity
      const decoded = nip19.decode(encodedPart);

      console.log('Decoded nostr URL:', decoded);

      switch (decoded.type) {
        case 'npub': {
          // Profile URL - navigate to profile page
          const pubkey = decoded.data as string;
          console.log('Opening profile for pubkey:', pubkey);
          this.layout.openProfile(pubkey);
          this.layout.toggleSearch();
          break;
        }

        case 'nevent': {
          // Event URL - navigate to event page
          const eventData = decoded.data as nip19.EventPointer;
          console.log('Opening event:', eventData.id);
          await this.router.navigate(['/e', eventData.id]);
          this.layout.toggleSearch();
          break;
        }

        case 'naddr': {
          // Address URL (for articles/replaceable events) - navigate to event page
          const addrData = decoded.data as nip19.AddressPointer;
          console.log('Opening address event:', addrData);
          // For articles, we can construct an identifier or use the address directly
          const identifier = `${addrData.kind}:${addrData.pubkey}:${addrData.identifier || ''}`;
          await this.router.navigate(['/e', identifier]);
          this.layout.toggleSearch();
          break;
        }

        case 'note': {
          // Note ID - navigate to event page
          const noteId = decoded.data as string;
          console.log('Opening note:', noteId);
          await this.router.navigate(['/e', noteId]);
          this.layout.toggleSearch();
          break;
        }

        case 'nprofile': {
          // Profile with relay info - navigate to profile page
          const profileData = decoded.data as nip19.ProfilePointer;
          console.log('Opening profile from nprofile:', profileData.pubkey);
          this.layout.openProfile(profileData.pubkey);
          this.layout.toggleSearch();
          break;
        }

        default: {
          console.warn('Unsupported nostr URL type:', decoded.type);
          this.layout.toast(`Unsupported nostr URL type: ${decoded.type}`);
          break;
        }
      }
    } catch (error) {
      console.error('Error decoding nostr URL:', error);
      throw new Error('Invalid nostr URL format');
    }
  }
}
