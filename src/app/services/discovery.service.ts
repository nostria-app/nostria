import { Injectable, signal, inject } from '@angular/core';
import { SimplePool, Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelaysService } from './relays/relays';
import { UtilitiesService } from './utilities.service';

/** Categories available in the Discovery section */
export type DiscoveryCategory =
  | 'news'
  | 'finance'
  | 'gaming'
  | 'art'
  | 'freedom'
  | 'podcasts'
  | 'music'
  | 'videos'
  | 'live'
  | 'audiobooks'
  | 'photography';

/** Addressable event reference with optional relay hint */
export interface AddressableRef {
  id: string;  // kind:pubkey:d-tag
  relay?: string;  // optional relay hint
}

/** Pubkey reference with optional relay hint */
export interface PubkeyRef {
  pubkey: string;
  relay?: string;  // optional relay hint
}

/** Curated list types based on NIP-51 */
export interface CuratedList {
  category: DiscoveryCategory;
  dTag: string;
  title?: string;
  description?: string;
  image?: string;
  pubkeys: string[]; // For follow sets (kind 30000)
  pubkeyRefs: PubkeyRef[]; // For follow sets with relay hints
  eventIds: string[]; // For article/video curation (kind 30004/30005)
  addressableIds: string[]; // For addressable events (a tags) - legacy
  addressableRefs: AddressableRef[]; // For addressable events with relay hints
  createdAt: number;
  raw?: Event;
}

/** Category configuration for discovery */
export interface CategoryConfig {
  id: DiscoveryCategory;
  title: string;
  description: string;
  icon: string;
  gradient: string;
  /** The d-tag used to fetch curated content for this category */
  dTag: string;
  /** Custom label for the creators section (e.g., "Streamers" for Live Streams) */
  creatorsLabel?: string;
  /** Special sections for this category (e.g., "Angor Hubs" for Finance) */
  specialSections?: string[];
}

/** Content categories (Content tab) */
export const CONTENT_CATEGORIES: CategoryConfig[] = [
  {
    id: 'news',
    title: 'News',
    description: 'Latest updates from the community',
    icon: 'newspaper',
    gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
    dTag: 'news',
  },
  {
    id: 'finance',
    title: 'Finance',
    description: 'Decentralized finance and investment',
    icon: 'account_balance',
    gradient: 'linear-gradient(135deg, #654ea3 0%, #eaafc8 100%)',
    dTag: 'finance',
    specialSections: ['angor-hubs'],
  },
  {
    id: 'gaming',
    title: 'Gaming',
    description: 'Games, esports, and gaming culture',
    icon: 'sports_esports',
    gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    dTag: 'gaming',
  },
  {
    id: 'art',
    title: 'Digital Art',
    description: 'Creative works and digital expressions',
    icon: 'palette',
    gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
    dTag: 'art',
  },
  {
    id: 'freedom',
    title: 'Freedom',
    description: 'Privacy, sovereignty, and liberty',
    icon: 'flag',
    gradient: 'linear-gradient(135deg, #1a1a1a 0%, #ffd700 100%)',
    dTag: 'freedom',
  },
];

/** Media categories (Media tab) */
export const MEDIA_CATEGORIES: CategoryConfig[] = [
  {
    id: 'podcasts',
    title: 'Podcasts',
    description: 'Listen to conversations, stories, and ideas',
    icon: 'podcasts',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    dTag: 'podcasts',
  },
  {
    id: 'music',
    title: 'Music',
    description: 'Discover tracks from independent artists',
    icon: 'library_music',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    dTag: 'music',
  },
  {
    id: 'videos',
    title: 'Videos',
    description: 'Watch educational and entertainment content',
    icon: 'smart_display',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    dTag: 'videos',
  },
  {
    id: 'live',
    title: 'Live Streams',
    description: 'Join live broadcasts happening now',
    icon: 'stream',
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    dTag: 'live',
    creatorsLabel: 'Streamers',
  },
  {
    id: 'audiobooks',
    title: 'Audiobooks',
    description: 'Listen to narrated books and stories',
    icon: 'auto_stories',
    gradient: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)',
    dTag: 'audiobooks',
  },
  {
    id: 'photography',
    title: 'Photography',
    description: 'Visual stories and stunning imagery',
    icon: 'photo_camera',
    gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)',
    dTag: 'photography',
  },
];

/** NIP-51 Kind constants for curated lists */
export const CURATION_KINDS = {
  /** Follow sets - for curated creators/profiles */
  FOLLOW_SET: 30000,
  /** Curation sets - for articles and notes */
  ARTICLE_CURATION: 30004,
  /** Curation sets - for videos */
  VIDEO_CURATION: 30005,
  /** Curation sets - for pictures/images */
  PICTURE_CURATION: 30006,
} as const;

@Injectable({
  providedIn: 'root',
})
export class DiscoveryService {
  private logger = inject(LoggerService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);

  /** The curator's public key (Nostria Curator) */
  readonly CURATOR_PUBKEY = '929dd94e6cc8a6665665a1e1fc043952c014c16c1735578e3436cd4510b1e829';

  /** The relay for curated discovery content */
  readonly CURATOR_RELAY = 'wss://ribo.eu.nostria.app/';

  /** Dedicated SimplePool instance for discovery relay connections */
  private discoveryPool: SimplePool | null = null;

  /** Cache for curated lists */
  private curatedListsCache = new Map<string, CuratedList>();

  /** Loading state for curated content */
  isLoadingCurated = signal<boolean>(false);

  /** Error state for curated content */
  curatedError = signal<string | null>(null);

  /**
   * Get or create the dedicated SimplePool for discovery relay connections.
   * This is separate from the app's main relay pool.
   */
  private getDiscoveryPool(): SimplePool {
    if (!this.discoveryPool) {
      this.discoveryPool = new SimplePool();
    }
    return this.discoveryPool;
  }

  /**
   * Get the curated creators (follow set) for a specific category.
   * Uses kind 30000 with the category's d-tag.
   * @param category The discovery category
   * @returns Promise resolving to pubkeys of curated creators
   */
  async getCuratedCreators(category: DiscoveryCategory): Promise<string[]> {
    const cacheKey = `creators-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached.pubkeys;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.FOLLOW_SET],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);

      if (event) {
        const list = this.parseFollowSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list.pubkeys;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated creators for ${category}:`, error);
    }

    return [];
  }

  /**
   * Get the curated articles for a specific category.
   * Uses kind 30004 with the category's d-tag.
   * @param category The discovery category
   * @returns Promise resolving to article identifiers
   */
  async getCuratedArticles(category: DiscoveryCategory): Promise<CuratedList | null> {
    const cacheKey = `articles-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.ARTICLE_CURATION],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);
      if (event) {
        const list = this.parseCurationSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated articles for ${category}:`, error);
    }

    return null;
  }

  /**
   * Get the curated videos for a specific category.
   * Uses kind 30005 with the category's d-tag.
   * @param category The discovery category
   * @returns Promise resolving to video identifiers
   */
  async getCuratedVideos(category: DiscoveryCategory): Promise<CuratedList | null> {
    const cacheKey = `videos-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.VIDEO_CURATION],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);
      if (event) {
        const list = this.parseCurationSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated videos for ${category}:`, error);
    }

    return null;
  }

  /**
   * Get the curated pictures for a specific category.
   * Uses kind 30006 with the category's d-tag.
   * @param category The discovery category
   * @returns Promise resolving to picture identifiers
   */
  async getCuratedPictures(category: DiscoveryCategory): Promise<CuratedList | null> {
    const cacheKey = `pictures-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.PICTURE_CURATION],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);
      if (event) {
        const list = this.parseCurationSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated pictures for ${category}:`, error);
    }

    return null;
  }

  /**
   * Get curated events for a specific category.
   * Uses kind 30004 with the category's d-tag and extracts 'e' tags (regular events).
   * @param category The discovery category
   * @returns Promise resolving to event identifiers
   */
  async getCuratedEvents(category: DiscoveryCategory): Promise<CuratedList | null> {
    const cacheKey = `events-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.ARTICLE_CURATION],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);
      if (event) {
        const list = this.parseCurationSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated events for ${category}:`, error);
    }

    return null;
  }

  /**
   * Get all curated content for a category.
   * @param category The discovery category
   * @returns Promise resolving to all curated content for the category
   */
  async getAllCuratedContent(category: DiscoveryCategory): Promise<{
    creators: string[];
    articles: CuratedList | null;
    videos: CuratedList | null;
    events: CuratedList | null;
  }> {
    this.isLoadingCurated.set(true);
    this.curatedError.set(null);

    try {
      const [creators, articles, videos, events] = await Promise.all([
        this.getCuratedCreators(category),
        this.getCuratedArticles(category),
        this.getCuratedVideos(category),
        this.getCuratedEvents(category),
      ]);

      return { creators, articles, videos, events };
    } catch (error) {
      this.curatedError.set('Failed to load curated content');
      this.logger.error(`Failed to load all curated content for ${category}:`, error);
      return { creators: [], articles: null, videos: null, events: null };
    } finally {
      this.isLoadingCurated.set(false);
    }
  }

  /**
   * Parse a follow set event (kind 30000) into a CuratedList.
   */
  private parseFollowSet(event: Event, category: DiscoveryCategory): CuratedList {
    const pubkeys: string[] = [];
    const pubkeyRefs: PubkeyRef[] = [];
    let title: string | undefined;
    let description: string | undefined;
    let image: string | undefined;

    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        pubkeys.push(tag[1]);
        // Capture relay hint if present (third element of p tag)
        pubkeyRefs.push({
          pubkey: tag[1],
          relay: tag[2] || undefined,
        });
      } else if (tag[0] === 'title' && tag[1]) {
        title = tag[1];
      } else if (tag[0] === 'description' && tag[1]) {
        description = tag[1];
      } else if (tag[0] === 'image' && tag[1]) {
        image = tag[1];
      }
    }

    return {
      category,
      dTag: category,
      title,
      description,
      image,
      pubkeys,
      pubkeyRefs,
      eventIds: [],
      addressableIds: [],
      addressableRefs: [],
      createdAt: event.created_at,
      raw: event,
    };
  }

  /**
   * Parse a curation set event (kind 30004/30005) into a CuratedList.
   */
  private parseCurationSet(event: Event, category: DiscoveryCategory): CuratedList {
    const pubkeys: string[] = [];
    const pubkeyRefs: PubkeyRef[] = [];
    const eventIds: string[] = [];
    const addressableIds: string[] = [];
    const addressableRefs: AddressableRef[] = [];
    let title: string | undefined;
    let description: string | undefined;
    let image: string | undefined;
    let dTag = category;

    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        pubkeys.push(tag[1]);
        pubkeyRefs.push({
          pubkey: tag[1],
          relay: tag[2] || undefined,
        });
      } else if (tag[0] === 'e' && tag[1]) {
        eventIds.push(tag[1]);
      } else if (tag[0] === 'a' && tag[1]) {
        addressableIds.push(tag[1]);
        // Store with relay hint if available (tag[2])
        addressableRefs.push({
          id: tag[1],
          relay: tag[2] || undefined,
        });
      } else if (tag[0] === 'd' && tag[1]) {
        dTag = tag[1] as DiscoveryCategory;
      } else if (tag[0] === 'title' && tag[1]) {
        title = tag[1];
      } else if (tag[0] === 'description' && tag[1]) {
        description = tag[1];
      } else if (tag[0] === 'image' && tag[1]) {
        image = tag[1];
      }
    }

    return {
      category,
      dTag,
      title,
      description,
      image,
      pubkeys,
      pubkeyRefs,
      eventIds,
      addressableIds,
      addressableRefs,
      createdAt: event.created_at,
      raw: event,
    };
  }

  /**
   * Load curated creators for a category, returning items with pubkey info.
   * @param category The discovery category
   * @returns Promise resolving to curated creator items
   */
  async loadCuratedCreators(category: DiscoveryCategory): Promise<{ id: string; pubkey: string; relay?: string; kind: number; createdAt: number }[]> {
    const pubkeyRefs = await this.getCuratedCreatorsWithRelays(category);
    return pubkeyRefs.map((ref) => ({
      id: ref.pubkey,
      pubkey: ref.pubkey,
      relay: ref.relay,
      kind: CURATION_KINDS.FOLLOW_SET,
      createdAt: Date.now() / 1000,
    }));
  }

  /**
   * Get curated creators with relay hints for a category.
   * @param category The discovery category
   * @returns Promise resolving to pubkey references with relay hints
   */
  async getCuratedCreatorsWithRelays(category: DiscoveryCategory): Promise<PubkeyRef[]> {
    const cacheKey = `creators-${category}`;
    const cached = this.curatedListsCache.get(cacheKey);
    if (cached) {
      return cached.pubkeyRefs;
    }

    try {
      const pool = this.getDiscoveryPool();
      const filter = {
        kinds: [CURATION_KINDS.FOLLOW_SET],
        authors: [this.CURATOR_PUBKEY],
        '#d': [category],
      };

      const event = await pool.get([this.CURATOR_RELAY], filter);

      if (event) {
        const list = this.parseFollowSet(event, category);
        this.curatedListsCache.set(cacheKey, list);
        return list.pubkeyRefs;
      }
    } catch (error) {
      this.logger.error(`Failed to fetch curated creators for ${category}:`, error);
    }

    return [];
  }

  /**
   * Load curated articles for a category, returning items with metadata and relay hints.
   * @param category The discovery category
   * @returns Promise resolving to curated article items
   */
  async loadCuratedArticles(category: DiscoveryCategory): Promise<{ id: string; pubkey: string; relay?: string; kind: number; createdAt: number }[]> {
    const list = await this.getCuratedArticles(category);
    if (!list) return [];

    // Use addressableRefs to get relay hints
    return list.addressableRefs.map((ref) => {
      // Parse addressable ID: kind:pubkey:d-tag
      const parts = ref.id.split(':');
      const pubkey = parts[1] || '';
      return {
        id: ref.id,
        pubkey,
        relay: ref.relay,
        kind: CURATION_KINDS.ARTICLE_CURATION,
        createdAt: list.createdAt,
      };
    });
  }

  /**
   * Load curated videos for a category, returning items with metadata.
   * Videos are stored as 'e' tags (event IDs) in curation sets.
   * @param category The discovery category
   * @returns Promise resolving to curated video items
   */
  async loadCuratedVideos(category: DiscoveryCategory): Promise<{ id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[]> {
    const list = await this.getCuratedVideos(category);
    if (!list) return [];

    // Return event IDs for videos (stored as 'e' tags)
    const items: { id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[] = [];

    for (const eventId of list.eventIds) {
      items.push({
        id: eventId,
        pubkey: '', // Will need to be fetched when displaying
        kind: CURATION_KINDS.VIDEO_CURATION,
        createdAt: list.createdAt,
      });
    }

    return items;
  }

  /**
   * Load curated pictures for a category, returning items with metadata.
   * @param category The discovery category
   * @returns Promise resolving to curated picture items
   */
  async loadCuratedPictures(category: DiscoveryCategory): Promise<{ id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[]> {
    const list = await this.getCuratedPictures(category);
    if (!list) return [];

    // Return event IDs for pictures (stored as 'e' tags)
    const items: { id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[] = [];

    for (const eventId of list.eventIds) {
      items.push({
        id: eventId,
        pubkey: '', // Will need to be fetched when displaying
        kind: CURATION_KINDS.PICTURE_CURATION,
        createdAt: list.createdAt,
      });
    }

    return items;
  }

  /**
   * Load curated events for a category, returning items with metadata.
   * Events are stored as 'e' tags (regular event IDs) in curation sets.
   * @param category The discovery category
   * @returns Promise resolving to curated event items
   */
  async loadCuratedEvents(category: DiscoveryCategory): Promise<{ id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[]> {
    const list = await this.getCuratedEvents(category);
    if (!list) return [];

    // Return only regular event IDs ('e' tags) - articles use 'a' tags
    const items: { id: string; pubkey: string; title?: string; image?: string; kind: number; createdAt: number }[] = [];

    // Add regular event IDs
    for (const eventId of list.eventIds) {
      items.push({
        id: eventId,
        pubkey: '', // Will need to be fetched when displaying
        kind: 1, // Kind 1 for regular text notes
        createdAt: list.createdAt,
      });
    }

    return items;
  }

  /**
   * Load recent articles from specific pubkeys with relay hints.
   * Used for categories like "News" where we fetch from curated creators.
   * @param pubkeyRefs Array of pubkey references with relay hints
   * @param articlesPerAuthor Number of articles to fetch per author (default 2)
   * @returns Promise resolving to article items
   */
  async loadRecentArticlesFromAuthors(
    pubkeyRefs: PubkeyRef[],
    articlesPerAuthor = 2
  ): Promise<{ id: string; pubkey: string; slug: string; kind: number; createdAt: number }[]> {
    if (pubkeyRefs.length === 0) return [];

    try {
      const pool = this.getDiscoveryPool();
      const pubkeys = pubkeyRefs.map(r => r.pubkey);
      const filter = {
        kinds: [30023], // Long-form articles
        authors: pubkeys,
        limit: pubkeys.length * articlesPerAuthor * 2, // Fetch extra to ensure we have enough per author
      };

      // Collect unique relay hints from pubkeyRefs and combine with general relays for reliability
      const relayHints = [...new Set(pubkeyRefs.map(r => r.relay).filter((r): r is string => !!r))];
      const generalRelays = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      const relayUrls = [...new Set([...relayHints, ...generalRelays])];
      const events = await pool.querySync(relayUrls, filter);

      // Group by author and take top N per author
      const byAuthor = new Map<string, Event[]>();
      for (const event of events) {
        const authorEvents = byAuthor.get(event.pubkey) || [];
        authorEvents.push(event);
        byAuthor.set(event.pubkey, authorEvents);
      }

      const items: { id: string; pubkey: string; slug: string; kind: number; createdAt: number }[] = [];

      for (const [pubkey, authorEvents] of byAuthor) {
        // Sort by created_at descending and take top N
        authorEvents.sort((a, b) => b.created_at - a.created_at);
        const topEvents = authorEvents.slice(0, articlesPerAuthor);

        for (const event of topEvents) {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
          items.push({
            id: `${event.kind}:${event.pubkey}:${dTag}`,
            pubkey: event.pubkey,
            slug: dTag,
            kind: event.kind,
            createdAt: event.created_at,
          });
        }
      }

      // Sort all items by created_at descending
      items.sort((a, b) => b.createdAt - a.createdAt);
      return items;
    } catch (error) {
      this.logger.error('Failed to fetch recent articles from authors:', error);
      return [];
    }
  }

  /**
   * Load recent events (notes) from specific pubkeys with relay hints.
   * Used for categories like "News" where we fetch from curated creators.
   * Returns full Event objects so they can be passed directly to components.
   * @param pubkeyRefs Array of pubkey references with relay hints
   * @param eventsPerAuthor Number of events to fetch per author (default 2)
   * @returns Promise resolving to full Event objects
   */
  async loadRecentEventsFromAuthors(
    pubkeyRefs: PubkeyRef[],
    eventsPerAuthor = 2
  ): Promise<Event[]> {
    if (pubkeyRefs.length === 0) return [];

    try {
      const pool = this.getDiscoveryPool();
      const pubkeys = pubkeyRefs.map(r => r.pubkey);
      const filter = {
        kinds: [1], // Short text notes
        authors: pubkeys,
        limit: pubkeys.length * eventsPerAuthor * 2, // Fetch extra to ensure we have enough per author
      };

      // Collect unique relay hints from pubkeyRefs and combine with general relays for reliability
      const relayHints = [...new Set(pubkeyRefs.map(r => r.relay).filter((r): r is string => !!r))];
      const generalRelays = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      const relayUrls = [...new Set([...relayHints, ...generalRelays])];
      const events = await pool.querySync(relayUrls, filter);

      // Group by author and take top N per author
      const byAuthor = new Map<string, Event[]>();
      for (const event of events) {
        const authorEvents = byAuthor.get(event.pubkey) || [];
        authorEvents.push(event);
        byAuthor.set(event.pubkey, authorEvents);
      }

      const resultEvents: Event[] = [];

      for (const [, authorEvents] of byAuthor) {
        // Sort by created_at descending and take top N
        authorEvents.sort((a, b) => b.created_at - a.created_at);
        const topEvents = authorEvents.slice(0, eventsPerAuthor);
        resultEvents.push(...topEvents);
      }

      // Sort all events by created_at descending
      resultEvents.sort((a, b) => b.created_at - a.created_at);
      return resultEvents;
    } catch (error) {
      this.logger.error('Failed to fetch recent events from authors:', error);
      return [];
    }
  }

  /**
   * Clear the curated lists cache.
   */
  clearCache(): void {
    this.curatedListsCache.clear();
  }

  /**
   * Get content categories (for Content tab).
   */
  getContentCategories(): CategoryConfig[] {
    return CONTENT_CATEGORIES;
  }

  /**
   * Get media categories (for Media tab).
   */
  getMediaCategories(): CategoryConfig[] {
    return MEDIA_CATEGORIES;
  }

  /**
   * Get category configuration by ID.
   */
  getCategoryConfig(categoryId: DiscoveryCategory): CategoryConfig | undefined {
    return [...CONTENT_CATEGORIES, ...MEDIA_CATEGORIES].find(c => c.id === categoryId);
  }
}
