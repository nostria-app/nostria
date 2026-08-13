import { computed, inject, signal, Service } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from './relays/relay-pool';
import { RelaysService } from './relays/relays';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { ReportingService } from './reporting.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import { DEFAULT_PODCAST_RELAYS } from '../utils/podcast-default-relays';
import {
  AUTHORED_PODCASTS_KIND,
  isValidPodcastEpisode,
  isValidPodcastShow,
  PODCAST_EPISODE_KIND,
  PODCAST_METADATA_KIND,
} from '../utils/podcast';

const RELAY_SET_KIND = 30002;
const PODCAST_RELAY_SET_D_TAG = 'podcasts';
const SUBSCRIPTION_LIMIT = 400;
const QUERY_TIMEOUT_MS = 7000;

/**
 * Cached NIP-F4 episodes and show metadata.
 * Curated discovery is "authors who published kind 10154", which filters out
 * unsolicited kind 54 spam that has no matching show metadata.
 */
@Service()
export class PodcastDataService {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);

  readonly episodes = signal<Event[]>([]);
  readonly shows = signal<Event[]>([]);
  readonly publishers = signal<Event[]>([]);
  readonly loading = signal(true);
  readonly podcastRelays = signal<string[]>([]);

  readonly showPubkeys = computed(() => this.shows().map(show => show.pubkey));

  private episodeMap = new Map<string, Event>();
  private showMap = new Map<string, Event>();
  private publisherMap = new Map<string, Event>();
  private episodeSubscription: { close: () => void } | null = null;
  private showSubscription: { close: () => void } | null = null;
  private publisherSubscription: { close: () => void } | null = null;
  private initialized = false;
  private lastAuthorKey = '';
  private readonly showRefreshInFlight = new Map<string, Promise<void>>();
  private readonly publisherRefreshInFlight = new Map<string, Promise<void>>();

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.loadFromDatabase();
    await this.loadPodcastRelaySet();
  }

  getShow(pubkey: string): Event | undefined {
    return this.showMap.get(pubkey);
  }

  getEpisodesForShow(pubkey: string): Event[] {
    return this.episodes()
      .filter(episode => episode.pubkey === pubkey)
      .sort((a, b) => b.created_at - a.created_at);
  }

  getCachedShowAndEpisodes(pubkey: string): { show: Event | null; episodes: Event[] } {
    return {
      show: this.getShow(pubkey) ?? null,
      episodes: this.getEpisodesForShow(pubkey),
    };
  }

  async refresh(authors: string[] | null): Promise<void> {
    await this.ensureInitialized();
    this.startSubscriptions(authors);
  }

  stopSubscriptions(): void {
    this.episodeSubscription?.close();
    this.showSubscription?.close();
    this.publisherSubscription?.close();
    this.episodeSubscription = null;
    this.showSubscription = null;
    this.publisherSubscription = null;
  }

  getPublisher(pubkey: string): Event | undefined {
    return this.publisherMap.get(pubkey);
  }

  getPublisherShowPubkeys(pubkey: string): string[] {
    const event = this.getPublisher(pubkey);
    return event ? this.getPublisherShowPubkeysFromEvent(event) : [];
  }

  getShowsForPublisher(pubkey: string): Event[] {
    return this.getPublisherShowPubkeys(pubkey)
      .map(showPubkey => this.getShow(showPubkey))
      .filter((show): show is Event => !!show);
  }

  addPublisher(event: Event): boolean {
    if (!this.acceptPublisher(event)) {
      return false;
    }

    const existing = this.publisherMap.get(event.pubkey);
    if (existing && existing.created_at >= event.created_at) {
      return false;
    }

    this.publisherMap.set(event.pubkey, event);
    this.publishers.set(Array.from(this.publisherMap.values()));
    void this.database.saveReplaceableEvent(event);
    return true;
  }

  addEpisode(event: Event): boolean {
    if (!this.acceptEpisode(event)) {
      return false;
    }

    const existing = this.episodeMap.get(event.id);
    if (existing && existing.created_at >= event.created_at) {
      return false;
    }

    this.episodeMap.set(event.id, event);
    this.episodes.set(Array.from(this.episodeMap.values()));
    void this.database.saveEvent(event);
    return true;
  }

  removeEpisode(eventId: string): void {
    if (!this.episodeMap.delete(eventId)) {
      return;
    }
    this.episodes.set(Array.from(this.episodeMap.values()));
  }

  removeShow(pubkey: string): void {
    if (!this.showMap.delete(pubkey)) {
      return;
    }
    this.shows.set(Array.from(this.showMap.values()));
  }

  addShow(event: Event): boolean {
    if (!this.acceptShow(event)) {
      return false;
    }

    const existing = this.showMap.get(event.pubkey);
    if (existing && existing.created_at >= event.created_at) {
      return false;
    }

    this.showMap.set(event.pubkey, event);
    this.shows.set(Array.from(this.showMap.values()));
    void this.database.saveReplaceableEvent(event);
    return true;
  }

  private acceptEpisode(event: Event): boolean {
    if (!isValidPodcastEpisode(event)) {
      return false;
    }
    if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
      return false;
    }
    return true;
  }

  private acceptShow(event: Event): boolean {
    if (!isValidPodcastShow(event)) {
      return false;
    }
    if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
      return false;
    }
    return true;
  }

  private acceptPublisher(event: Event): boolean {
    if (event.kind !== AUTHORED_PODCASTS_KIND) {
      return false;
    }
    if (this.getPublisherShowPubkeysFromEvent(event).length === 0) {
      return false;
    }
    if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
      return false;
    }
    return true;
  }

  private getPublisherShowPubkeysFromEvent(event: Event): string[] {
    return this.utilities.getPTagsValuesFromEvent(event).filter(pubkey => !!pubkey);
  }

  private async loadFromDatabase(): Promise<void> {
    try {
      const [cachedEpisodes, cachedShows, cachedPublishers] = await Promise.all([
        this.database.getEventsByKind(PODCAST_EPISODE_KIND),
        this.database.getEventsByKind(PODCAST_METADATA_KIND),
        this.database.getEventsByKind(AUTHORED_PODCASTS_KIND),
      ]);

      for (const episode of cachedEpisodes) {
        if (!this.acceptEpisode(episode)) {
          continue;
        }
        const existing = this.episodeMap.get(episode.id);
        if (!existing || episode.created_at > existing.created_at) {
          this.episodeMap.set(episode.id, episode);
        }
      }

      for (const show of cachedShows) {
        if (!this.acceptShow(show)) {
          continue;
        }
        const existing = this.showMap.get(show.pubkey);
        if (!existing || show.created_at > existing.created_at) {
          this.showMap.set(show.pubkey, show);
        }
      }

      for (const publisher of cachedPublishers) {
        if (!this.acceptPublisher(publisher)) {
          continue;
        }
        const existing = this.publisherMap.get(publisher.pubkey);
        if (!existing || publisher.created_at > existing.created_at) {
          this.publisherMap.set(publisher.pubkey, publisher);
        }
      }

      this.episodes.set(Array.from(this.episodeMap.values()));
      this.shows.set(Array.from(this.showMap.values()));
      this.publishers.set(Array.from(this.publisherMap.values()));

      if (this.episodeMap.size > 0 || this.showMap.size > 0 || this.publisherMap.size > 0) {
        this.loading.set(false);
      }
    } catch (error) {
      this.logger.warn('[Podcasts] Failed to load cached events:', error);
    }
  }

  private async loadPodcastRelaySet(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.podcastRelays.set([...DEFAULT_PODCAST_RELAYS]);
      return;
    }

    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        PODCAST_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.podcastRelays.set(this.extractRelayUrls(cachedEvent));
      }

      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      if (relayUrls.length === 0) {
        if (!cachedEvent) {
          this.podcastRelays.set([...DEFAULT_PODCAST_RELAYS]);
        }
        return;
      }

      const events = await this.pool.query(relayUrls, {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [PODCAST_RELAY_SET_D_TAG],
        limit: 1,
      }, 3000);

      const foundEvent = events.length > 0
        ? events.reduce((latest, event) => event.created_at > latest.created_at ? event : latest)
        : null;

      if (foundEvent && (!cachedEvent || foundEvent.created_at > cachedEvent.created_at)) {
        this.podcastRelays.set(this.extractRelayUrls(foundEvent));
        const dTag = foundEvent.tags.find(tag => tag[0] === 'd')?.[1];
        await this.database.saveEvent({ ...foundEvent, dTag });
      } else if (!cachedEvent) {
        this.podcastRelays.set([...DEFAULT_PODCAST_RELAYS]);
      }
    } catch (error) {
      this.logger.warn('[Podcasts] Failed to load podcast relay set:', error);
      if (this.podcastRelays().length === 0) {
        this.podcastRelays.set([...DEFAULT_PODCAST_RELAYS]);
      }
    }
  }

  private extractRelayUrls(event: Event): string[] {
    return event.tags
      .filter(tag => tag[0] === 'relay' && !!tag[1])
      .map(tag => tag[1]);
  }

  getRelayUrls(): string[] {
    const accountRelays = this.accountRelay.getRelayUrls();
    const customRelays = this.podcastRelays();
    const combined = [...new Set([...accountRelays, ...customRelays])];
    if (combined.length > 0) {
      return combined;
    }
    return this.utilities.anonymousRelays.length > 0
      ? this.utilities.anonymousRelays
      : [...DEFAULT_PODCAST_RELAYS];
  }

  startSubscriptions(authors: string[] | null): void {
    this.stopSubscriptions();

    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) {
      this.loading.set(false);
      return;
    }

    if (authors !== null && authors.length === 0) {
      this.loading.set(false);
      return;
    }

    const authorKey = authors === null ? 'public' : authors.slice().sort().join(',');
    this.lastAuthorKey = authorKey;

    let episodesLoaded = false;
    let showsLoaded = false;
    let publishersLoaded = false;
    const checkLoaded = () => {
      if (episodesLoaded && showsLoaded && publishersLoaded) {
        this.loading.set(false);
      }
    };

    const episodeTimeout = setTimeout(() => {
      episodesLoaded = true;
      checkLoaded();
    }, 5000);
    const showTimeout = setTimeout(() => {
      showsLoaded = true;
      checkLoaded();
    }, 5000);
    const publisherTimeout = setTimeout(() => {
      publishersLoaded = true;
      checkLoaded();
    }, 5000);

    const episodeFilter: Filter = {
      kinds: [PODCAST_EPISODE_KIND],
      limit: SUBSCRIPTION_LIMIT,
    };
    const showFilter: Filter = {
      kinds: [PODCAST_METADATA_KIND],
      limit: SUBSCRIPTION_LIMIT,
    };
    const publisherFilter: Filter = {
      kinds: [AUTHORED_PODCASTS_KIND],
      limit: SUBSCRIPTION_LIMIT,
    };
    if (authors !== null) {
      episodeFilter.authors = authors;
      showFilter.authors = authors;
      publisherFilter.authors = authors;
    }

    this.episodeSubscription = this.pool.subscribe(relayUrls, episodeFilter, (event: Event) => {
      this.addEpisode(event);
      if (!episodesLoaded) {
        clearTimeout(episodeTimeout);
        episodesLoaded = true;
        checkLoaded();
      }
    });

    this.showSubscription = this.pool.subscribe(relayUrls, showFilter, (event: Event) => {
      this.addShow(event);
      if (!showsLoaded) {
        clearTimeout(showTimeout);
        showsLoaded = true;
        checkLoaded();
      }
    });

    this.publisherSubscription = this.pool.subscribe(relayUrls, publisherFilter, (event: Event) => {
      this.addPublisher(event);
      if (!publishersLoaded) {
        clearTimeout(publisherTimeout);
        publishersLoaded = true;
        checkLoaded();
      }
    });
  }

  async queryShowAndEpisodes(pubkey: string): Promise<{ show: Event | null; episodes: Event[] }> {
    await this.ensureInitialized();
    await this.refreshShowAndEpisodes(pubkey);
    return this.getCachedShowAndEpisodes(pubkey);
  }

  async refreshShowAndEpisodes(pubkey: string): Promise<void> {
    await this.ensureInitialized();

    const existing = this.showRefreshInFlight.get(pubkey);
    if (existing) {
      return existing;
    }

    const work = this.fetchShowAndEpisodes(pubkey).finally(() => {
      this.showRefreshInFlight.delete(pubkey);
    });
    this.showRefreshInFlight.set(pubkey, work);
    return work;
  }

  private async fetchShowAndEpisodes(pubkey: string): Promise<void> {
    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) {
      return;
    }

    const [showEvents, episodeEvents] = await Promise.all([
      this.pool.query(relayUrls, {
        kinds: [PODCAST_METADATA_KIND],
        authors: [pubkey],
        limit: 1,
      }, QUERY_TIMEOUT_MS),
      this.pool.query(relayUrls, {
        kinds: [PODCAST_EPISODE_KIND],
        authors: [pubkey],
        limit: 200,
      }, QUERY_TIMEOUT_MS),
    ]);

    for (const show of showEvents) {
      this.addShow(show);
    }
    for (const episode of episodeEvents) {
      this.addEpisode(episode);
    }
  }

  async refreshPublisher(pubkey: string): Promise<void> {
    await this.ensureInitialized();

    const existing = this.publisherRefreshInFlight.get(pubkey);
    if (existing) {
      return existing;
    }

    const work = this.fetchPublisher(pubkey).finally(() => {
      this.publisherRefreshInFlight.delete(pubkey);
    });
    this.publisherRefreshInFlight.set(pubkey, work);
    return work;
  }

  private async fetchPublisher(pubkey: string): Promise<void> {
    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) {
      return;
    }

    const publisherEvents = await this.pool.query(relayUrls, {
      kinds: [AUTHORED_PODCASTS_KIND],
      authors: [pubkey],
      limit: 1,
    }, QUERY_TIMEOUT_MS);

    for (const event of publisherEvents) {
      this.addPublisher(event);
    }

    const showPubkeys = this.getPublisherShowPubkeys(pubkey);
    if (showPubkeys.length === 0) {
      return;
    }

    const showEvents = await this.pool.query(relayUrls, {
      kinds: [PODCAST_METADATA_KIND],
      authors: showPubkeys,
      limit: Math.max(showPubkeys.length, 1),
    }, QUERY_TIMEOUT_MS);

    for (const show of showEvents) {
      this.addShow(show);
    }
  }
}
