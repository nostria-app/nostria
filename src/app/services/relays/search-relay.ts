import { Injectable, inject } from '@angular/core';
import { RelayServiceBase } from './relay';
import { NostriaService } from '../../interfaces';
import { LocalStorageService } from '../local-storage.service';
import { ApplicationStateService } from '../application-state.service';
import { DatabaseService } from '../database.service';
import { SimplePool, UnsignedEvent, Event, Filter } from 'nostr-tools';

// Kind 10007 is not exported from nostr-tools, so we define it here
export const SearchRelayListKind = 10007;

export interface SearchFilter extends Filter {
  search?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SearchRelayService extends RelayServiceBase implements NostriaService {
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);
  private database = inject(DatabaseService);
  private initialized = false;

  private readonly DEFAULT_SEARCH_RELAYS = ['wss://search.nos.today/', 'wss://relay.nostr.band/', 'wss://nostr.polyserv.xyz', 'wss://relay.ditto.pub'];

  constructor() {
    super(new SimplePool());
  }

  async load() {
    // Load search relays from local storage or use default ones
    const searchRelays = this.loadSearchRelaysFromStorage();
    this.init(searchRelays);
    this.initialized = true;
  }

  /**
   * Ensures the service is initialized before performing operations
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.load();
    }
  }

  clear() {
    // Reset to default relays when clearing
    this.init(this.DEFAULT_SEARCH_RELAYS);
  }

  /**
   * Get the default search relays
   */
  getDefaultRelays(): string[] {
    return [...this.DEFAULT_SEARCH_RELAYS];
  }

  save(relayUrls: string[]) {
    // Save to local storage
    this.localStorage.setItem(
      this.appState.SEARCH_RELAYS_STORAGE_KEY,
      JSON.stringify(relayUrls)
    );
  }

  /**
   * Sets search relays and persists them to local storage.
   * Users are allowed to have an empty search relay list.
   */
  setSearchRelays(relayUrls: string[]): void {
    try {
      // Validate that all URLs are valid relay URLs and filter out insecure ws://
      const validRelays = relayUrls.filter(url => {
        try {
          const parsed = new URL(url);
          // Only allow secure wss:// - ws:// cannot be used from secure context
          return parsed.protocol === 'wss:';
        } catch {
          return false;
        }
      });

      if (validRelays.length < relayUrls.length) {
        const filtered = relayUrls.length - validRelays.length;
        this.logger.warn(`[SearchRelayService] Filtered out ${filtered} invalid or insecure relay(s)`);
      }

      // Save even if empty - user explicitly chose to have no search relays
      this.save(validRelays);

      this.logger.debug(`Saved ${validRelays.length} search relays to storage`);

      // Reinitialize the service with new relays (or empty)
      this.init(validRelays);
    } catch (error) {
      this.logger.error('Error saving search relays to storage', error);
    }
  }

  /**
   * Loads search relays from local storage
   */
  private loadSearchRelaysFromStorage(): string[] {
    try {
      const storedRelays = this.localStorage.getItem(this.appState.SEARCH_RELAYS_STORAGE_KEY);
      if (storedRelays) {
        const parsedRelays = JSON.parse(storedRelays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          this.logger.debug(`Loaded ${parsedRelays.length} search relays from storage`);
          return parsedRelays;
        }
      }
    } catch (error) {
      this.logger.error('Error loading search relays from storage', error);
    }
    return this.DEFAULT_SEARCH_RELAYS;
  }

  /**
   * Load search relays from kind 10007 event for a user.
   * Returns null if no event exists (to distinguish from empty list).
   */
  async loadFromEvent(pubkey: string): Promise<string[] | null> {
    try {
      // Try to get from database first
      const event = await this.database.getEventByPubkeyAndKind(pubkey, SearchRelayListKind);

      if (event) {
        const relayUrls = event.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => tag[1]);

        // Return whatever the user has, even if empty
        this.logger.debug(`Loaded ${relayUrls.length} search relays from kind 10007 event`);
        return relayUrls;
      }
    } catch (error) {
      this.logger.error('Error loading search relays from event', error);
    }

    // No event found
    return null;
  }

  /**
   * Creates an unsigned kind 10007 event for publishing search relay list
   */
  createSearchRelayListEvent(pubkey: string, relayUrls: string[]): UnsignedEvent {
    return {
      pubkey,
      kind: SearchRelayListKind,
      created_at: Math.floor(Date.now() / 1000),
      tags: relayUrls.map(url => ['relay', url]),
      content: '',
    };
  }

  /**
   * Save search relay list event to database
   */
  async saveEvent(event: Event): Promise<void> {
    try {
      await this.database.saveEvent(event);
      this.logger.debug('Saved search relay list event to database');
    } catch (error) {
      this.logger.error('Error saving search relay list event', error);
    }
  }

  /**
   * Search for events using NIP-50 search capability
   * @param searchQuery The search query string (supports hashtags like #bitcoin)
   * @param kinds Optional array of event kinds to filter (default: [1] for notes)
   * @param limit Maximum number of results (default: 50)
   * @param options Additional filter options
   */
  async search(
    searchQuery: string,
    kinds: number[] = [1],
    limit = 50,
    options: { since?: number; until?: number; authors?: string[] } = {}
  ): Promise<Event[]> {
    await this.ensureInitialized();

    const urls = this.getRelayUrls();
    if (urls.length === 0) {
      this.logger.warn('No search relays configured');
      return [];
    }

    const filter: SearchFilter = {
      kinds,
      limit,
      search: searchQuery,
      ...options,
    };

    this.logger.debug(`Searching for "${searchQuery}" on ${urls.length} search relays`);

    try {
      const pool = this.getPool();
      const events = await pool.querySync(urls, filter);

      // Deduplicate events by pubkey (for profiles) or id (for other events)
      // Multiple relays may return the same event
      const seen = new Set<string>();
      const uniqueEvents = events.filter(event => {
        // For kind 0 (profiles), deduplicate by pubkey and keep newest
        const key = event.kind === 0 ? event.pubkey : event.id;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      // For profiles, sort by created_at descending to keep newest when deduplicating
      if (kinds.includes(0)) {
        uniqueEvents.sort((a, b) => b.created_at - a.created_at);
      }

      // Filter out expired events
      const validEvents = uniqueEvents.filter(event => !this.utilities.isEventExpired(event));

      this.logger.debug(`Search returned ${validEvents.length} results (${events.length} before dedup)`);
      return validEvents;
    } catch (error) {
      this.logger.error('Search query failed', error);
      return [];
    }
  }

  /**
   * Search for profiles using NIP-50 search capability
   * @param searchQuery The search query string
   * @param limit Maximum number of results (default: 20)
   */
  async searchProfiles(searchQuery: string, limit = 20): Promise<Event[]> {
    return this.search(searchQuery, [0], limit);
  }

  /**
   * Search for notes by hashtag
   * @param hashtag The hashtag to search for (without the # prefix)
   * @param limit Maximum number of results (default: 50)
   */
  async searchByHashtag(hashtag: string, limit = 50): Promise<Event[]> {
    // Remove # if present
    const tag = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
    return this.search(`#${tag}`, [1], limit);
  }

  /**
   * Search for events with multiple kinds (useful for feed columns)
   * @param searchQuery The search query string
   * @param kinds Array of event kinds to search
   * @param limit Maximum number of results
   * @param since Only return events after this timestamp
   */
  async searchForFeed(
    searchQuery: string,
    kinds: number[] = [1, 6, 7],
    limit = 100,
    since?: number
  ): Promise<Event[]> {
    const options: { since?: number } = {};
    if (since) {
      options.since = since;
    }
    return this.search(searchQuery, kinds, limit, options);
  }
}
