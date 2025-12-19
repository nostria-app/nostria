import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { LayoutService } from './layout.service';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from './account-state.service';
import { NostrRecord } from '../interfaces';
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService } from './database.service';
import { FollowingService } from './following.service';
import { MatDialog } from '@angular/material/dialog';
import { AddMediaDialog } from '../pages/media-queue/add-media-dialog/add-media-dialog';
import { EventService } from './event';
import { MediaPlayerService } from './media-player.service';
import { RssParserService } from './rss-parser.service';
import { SearchRelayService } from './relays/search-relay';
import { LoggerService } from './logger.service';

export interface SearchAction {
  icon: string;
  label: string;
  description: string;
  callback: () => void;
}

export interface SearchResultProfile extends NostrRecord {
  source: 'local' | 'remote';
}

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  followingService = inject(FollowingService);
  userData = inject(UserDataService);
  relaysService = inject(RelaysService);
  relayPool = inject(RelayPoolService);
  database = inject(DatabaseService);
  dialog = inject(MatDialog);
  eventService = inject(EventService);
  mediaPlayer = inject(MediaPlayerService);
  rssParser = inject(RssParserService);
  searchRelay = inject(SearchRelayService);
  logger = inject(LoggerService);

  // Search results from cached profiles
  searchResults = signal<SearchResultProfile[]>([]);
  searchActions = signal<SearchAction[]>([]);

  // Track if we're currently searching remote relays
  isSearchingRemote = signal(false);

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

      // Check if query is a URL
      const isUrl = /^(http|https):\/\/[^ "]+$/.test(searchValue);

      if (isUrl) {
        this.searchActions.set([
          {
            icon: 'note_add',
            label: 'Publish Note',
            description: 'Create a new note with this URL',
            callback: () => {
              this.eventService.createNote({ content: searchValue });
              this.layout.toggleSearch();
            },
          },
          {
            icon: 'playlist_add',
            label: 'Add to Media Queue',
            description: 'Add this media to your playback queue',
            callback: () => {
              const dialogRef = this.dialog.open(AddMediaDialog, {
                data: { url: searchValue },
                width: '500px',
              });

              dialogRef.afterClosed().subscribe(async (result) => {
                if (result && result.url) {
                  try {
                    const feed = await this.rssParser.parse(result.url);
                    const startIndex = this.mediaPlayer.media().length;

                    if (feed && feed.items.length > 0) {
                      // Determine media type based on feed medium
                      let mediaType: 'Music' | 'Podcast' | 'Video';
                      let toastMessage: string;
                      switch (feed.medium) {
                        case 'music':
                          mediaType = 'Music';
                          toastMessage = 'Added music to queue';
                          break;
                        case 'video':
                        case 'film':
                          mediaType = 'Video';
                          toastMessage = 'Added video to queue';
                          break;
                        default:
                          mediaType = 'Podcast';
                          toastMessage = 'Added podcast to queue';
                      }

                      for (const item of feed.items) {
                        this.mediaPlayer.enque({
                          artist: feed.author || feed.title,
                          artwork: item.image || feed.image,
                          title: item.title,
                          source: item.mediaUrl,
                          type: mediaType,
                        });
                      }
                      this.layout.toast(toastMessage);
                    } else {
                      this.mediaPlayer.enque({
                        artist: 'Unknown',
                        artwork: '',
                        title: result.url,
                        source: result.url,
                        type: 'Podcast',
                      });
                      this.layout.toast('Added to queue');
                    }

                    if (result.playImmediately) {
                      this.mediaPlayer.index = startIndex;
                      this.mediaPlayer.start();
                    }
                  } catch (err) {
                    console.error('Failed to parse RSS:', err);
                    // Fallback to adding as single item
                    const startIndex = this.mediaPlayer.media().length;
                    this.mediaPlayer.enque({
                      artist: 'Unknown',
                      artwork: '',
                      title: result.url,
                      source: result.url,
                      type: 'Podcast',
                    });
                    this.layout.toast('Added to queue');

                    if (result.playImmediately) {
                      this.mediaPlayer.index = startIndex;
                      this.mediaPlayer.start();
                    }
                  }
                }
              });
              this.layout.toggleSearch();
            },
          },
        ]);
      } else {
        this.searchActions.set([]);
      }

      if (searchValue) {
        // Check if this is a hashtag search
        const isHashtagSearch = searchValue.startsWith('#');

        if (isHashtagSearch) {
          // Handle hashtag search - navigate to search results page
          this.searchActions.set([
            {
              icon: 'tag',
              label: `Search for ${searchValue}`,
              description: 'Search notes with this hashtag on search relays',
              callback: () => {
                this.searchByHashtag(searchValue.slice(1));
                this.layout.toggleSearch();
              },
            },
          ]);
          this.searchResults.set([]);
          return;
        }

        // First, search in cached profiles using FollowingService
        const followingResults = untracked(() => this.followingService.searchProfiles(searchValue));
        const cachedResults = this.followingService.toNostrRecords(followingResults);

        // Mark local results with source
        const localResults: SearchResultProfile[] = cachedResults.map(profile => ({
          ...profile,
          source: 'local' as const,
        }));

        console.log(
          'Local search results:',
          localResults.length,
          'results for query:',
          searchValue
        );

        // Use untracked to prevent creating reactive dependencies
        untracked(() => {
          this.searchResults.set(localResults);
        });

        // Also search for profiles on search relays (in background)
        this.searchProfilesOnSearchRelays(searchValue, localResults);

        // Check if the query is a valid hex string (64 characters) - potential event ID
        const isHexEventId = /^[0-9a-f]{64}$/i.test(searchValue);

        // If no cached results and query looks like an event ID, search for the event
        if (localResults.length === 0 && isHexEventId) {
          await this.searchForEventById(searchValue);
        }

        // If query looks like an email (NIP-05), also try NIP-05 lookup
        if (searchValue.indexOf('@') > -1) {
          let nip05Value = searchValue;
          // Only prefix with "_" if the query starts with "@" (domain-only, no username)
          // e.g., "@nostria.app" becomes "_@nostria.app"
          // But "sondreb@nostria.app" stays as is
          if (searchValue.startsWith('@') && !nip05Value.startsWith('_')) {
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
          this.searchActions.set([]);
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
            await this.database.saveEvent(event);
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
      this.searchActions.set([]);
    });
  }

  /**
   * Search for profiles on search relays and merge with local results
   */
  private async searchProfilesOnSearchRelays(
    searchValue: string,
    localResults: SearchResultProfile[]
  ): Promise<void> {
    // Don't search for very short queries
    if (searchValue.length < 2) {
      return;
    }

    this.isSearchingRemote.set(true);

    try {
      const remoteProfiles = await this.searchRelay.searchProfiles(searchValue, 20);

      if (remoteProfiles.length > 0) {
        // Convert remote events to NostrRecords with source marker
        const localPubkeys = new Set(localResults.map(r => r.event.pubkey));

        const remoteResults: SearchResultProfile[] = remoteProfiles
          .filter(event => !localPubkeys.has(event.pubkey)) // Exclude duplicates
          .map(event => {
            let data = {};
            try {
              data = JSON.parse(event.content);
            } catch {
              // Invalid JSON in content
            }
            return {
              event,
              data,
              source: 'remote' as const,
            };
          });

        if (remoteResults.length > 0) {
          this.logger.debug(`Found ${remoteResults.length} remote profiles for "${searchValue}"`);

          // Merge local and remote results
          untracked(() => {
            const currentResults = this.searchResults();
            // Only update if we still have the same search query
            if (this.#lastQuery === searchValue) {
              this.searchResults.set([...currentResults, ...remoteResults]);
            }
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to search profiles on search relays', error);
    } finally {
      this.isSearchingRemote.set(false);
    }
  }

  /**
   * Search for events by hashtag using search relays
   */
  async searchByHashtag(hashtag: string): Promise<void> {
    this.logger.debug(`Searching for hashtag: #${hashtag}`);

    // Navigate to the search page with the hashtag query
    this.layout.router.navigate(['/search'], {
      queryParams: { q: `#${hashtag}` },
    });
  }
}
