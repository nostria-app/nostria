import { Injectable, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { UserDataService } from './user-data.service';

export interface StarterPack {
  id: string;
  title: string;
  description?: string;
  image?: string;
  pubkeys: string[];
  relays?: string[];
  dTag: string;
  authorPubkey: string;
  createdAt: number;
}

export interface Interest {
  id: string;
  name: string;
  icon: string;
}

export interface SuggestedProfile {
  id: string;
  name: string;
  bio: string;
  avatar: string;
  interests: string[];
  region?: string;
}

interface ParsedProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  [key: string]: unknown;
}

/**
 * Hardcoded "Popular" starter pack event for immediate loading
 * This is used as fallback when database has no cached data
 */
const POPULAR_STARTER_PACK_EVENT: Event = {
  id: '89c8d851ae5e634c8c02a63aeca1a79292f2e068e7980eaff3cfd877e4971e40',
  pubkey: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
  created_at: 1760778777,
  kind: 39089,
  tags: [
    ['d', 'popular'],
    ['title', 'Popular'],
    ['description', 'These are the profiles that are presented in the Popular feed on Nostria'],
    ['image', 'https://www.nostria.app/assets/nostria-social.jpg'],
    ['p', '101a112c8adc2e69e0003114ff1c1d36b7fcde06d84d47968e599d558721b0df'],
    ['p', 'c0e0c4272134d92da8651650c10ca612b710a670d5e043488f27e073a1f63a16'],
    ['p', '469223f4ce484bba4e125a8c8a92032e16e5d07b723ea5da2f253b2627da92c7'],
    ['p', '6116d06dd94aedb145d2e7689a2fe2249de56fc4e89a4cace88a0d4b1d80b135'],
    ['p', 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b'],
    ['p', '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515'],
    ['p', '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2'],
    ['p', '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9'],
    ['p', 'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42'],
    ['p', '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e'],
    ['p', '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204'],
    ['p', 'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52'],
    ['p', '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24'],
    ['p', '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411'],
    ['p', 'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11'],
    ['p', 'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f'],
    ['p', '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832'],
    ['p', '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245'],
    ['p', 'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0'],
    ['p', '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93'],
  ],
  content: '',
  sig: 'a0d3eddcd34d83c8050ee50f9bb8cd86240fd8f3ee07271600aa8659e31a3129deadc6194878029aefd77e9b100932019960cf6228409a979389f3f97b89f93a',
};

@Injectable({
  providedIn: 'root',
})
export class Followset {
  private readonly dataService = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly onDemandUserData = inject(OnDemandUserDataService);
  private readonly userDataService = inject(UserDataService);

  // Signals for reactive updates
  starterPacks = signal<StarterPack[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Well-known starter packs with specific d-tags
  // Each entry specifies a pubkey and the specific d-tags to fetch from that pubkey
  private readonly STARTER_PACK_SOURCES: { pubkey: string; dTags: string[] }[] = [
    {
      pubkey: 'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria official
      dTags: ['popular', 'coax9y2o26yu'],
    },
    {
      pubkey: 'f901616f00a63f4f9c7881d4871a03df3d4cee7291eafd7adcbeea7c95c58e27',
      dTags: ['odenjo2n582o'],
    },
    {
      pubkey: '17538dc2a62769d09443f18c37cbe358fab5bbf981173542aa7c5ff171ed77c4',
      dTags: ['y156932o9xfh'],
    },
    {
      pubkey: 'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52',
      dTags: ['5gj7p3ctxvje'],
    },
    {
      pubkey: '85df00a2f6a91845354c8d2d9fbab4002bb85b4225baeab60fafb2587c5038ea',
      dTags: ['8b8a3825-ddc2-4085-a58d-a5b33a1a934d'],
    },
    {
      pubkey: 'ede41352397758154514148b24112308ced96d121229b0e6a66bc5a2b40c03ec',
      dTags: ['streamersFollowPackh8Kz3P2q'],
    },
    {
      pubkey: '64bfa9abffe5b18d0731eed57b38173adc2ba89bf87c168da90517f021e722b5',
      dTags: ['frwuenx3icsi'],
    },
  ];

  // Set of all allowed d-tags for quick lookup
  private readonly ALLOWED_DTAGS = new Set(
    this.STARTER_PACK_SOURCES.flatMap(source => source.dTags)
  );

  /**
   * Get the hardcoded "Popular" starter pack
   * This is always available immediately without any network requests
   */
  getHardcodedPopularStarterPack(): StarterPack {
    return this.parseStarterPackEvent(POPULAR_STARTER_PACK_EVENT)!;
  }

  /**
   * Fetch starter packs using a database-first strategy with hardcoded fallback
   * 
   * Loading strategy (NO relay fetch on initial load):
   * 1. Check database for cached starter packs
   * 2. If found in database, use that data
   * 3. If NOT found, use hardcoded data immediately (no waiting)
   * 4. Trigger background refresh from relays to update database for next load
   * 
   * This ensures instant loading on first use while keeping data fresh for subsequent loads.
   * 
   * @param dTagFilter Optional d-tag to filter for a specific starter pack (e.g., 'popular')
   */
  async fetchStarterPacks(dTagFilter?: string): Promise<StarterPack[]> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const starterPacks: StarterPack[] = [];
      let usedHardcodedFallback = false;

      // Fetch starter packs from each source
      // Process sources in parallel for faster loading
      const sourcePromises = this.STARTER_PACK_SOURCES.map(async source => {
        try {
          // Try to get from database/cache ONLY (no relay fetch)
          // This uses cache: true, save: true - returns cached data if available
          const events = await this.onDemandUserData.getEventsByPubkeyAndKind(
            source.pubkey,
            39089 // Starter pack kind
          );

          // Parse each event and add to starter packs if it matches allowed d-tags
          const packs: StarterPack[] = [];
          events.forEach(record => {
            const starterPack = this.parseStarterPackEvent(record.event);
            if (starterPack) {
              // Only include if the d-tag is in the allowed list for this source
              const isAllowedDTag = source.dTags.includes(starterPack.dTag);
              const matchesFilter = !dTagFilter || starterPack.dTag === dTagFilter;

              if (isAllowedDTag && matchesFilter) {
                packs.push(starterPack);
              }
            }
          });
          return packs;
        } catch (error) {
          this.logger.debug(`No cached starter packs for ${source.pubkey}:`, error);
          return [];
        }
      });

      // Wait for all sources to complete (in parallel)
      const results = await Promise.all(sourcePromises);
      results.forEach(packs => starterPacks.push(...packs));

      // Check if we need to add the hardcoded "Popular" starter pack
      // Add it if:
      // 1. No filter specified OR filter is 'popular'
      // 2. AND it's not already in the results from database
      const needsPopular = !dTagFilter || dTagFilter === 'popular';
      const hasPopular = starterPacks.some(pack => pack.dTag === 'popular');

      if (needsPopular && !hasPopular) {
        // Use hardcoded fallback for immediate loading
        const hardcodedPopular = this.getHardcodedPopularStarterPack();
        starterPacks.unshift(hardcodedPopular); // Add at beginning for priority
        usedHardcodedFallback = true;
        this.logger.info('[Followset] Using hardcoded Popular starter pack (no cached data)');
      }

      this.starterPacks.set(starterPacks);
      this.logger.info(
        `[Followset] Loaded ${starterPacks.length} starter packs` +
        `${usedHardcodedFallback ? ' (includes hardcoded fallback)' : ' from cache'}` +
        `${dTagFilter ? ` (filtered by d-tag: ${dTagFilter})` : ''}`
      );

      // Trigger background refresh from relays for next time
      // This happens asynchronously and doesn't block the return
      this.refreshStarterPacksInBackground(dTagFilter);

      return starterPacks;
    } catch (error) {
      this.logger.error('[Followset] Failed to fetch starter packs:', error);

      // Even on error, return hardcoded Popular if applicable
      const needsPopular = !dTagFilter || dTagFilter === 'popular';
      if (needsPopular) {
        const hardcodedPopular = this.getHardcodedPopularStarterPack();
        this.starterPacks.set([hardcodedPopular]);
        this.logger.info('[Followset] Returning hardcoded Popular starter pack due to error');
        return [hardcodedPopular];
      }

      this.error.set('Failed to load starter packs');
      return [];
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Refresh starter packs from relays in the background
   * This updates the stored data for the next time fetchStarterPacks is called
   * 
   * Uses invalidateCache: true to force fetching fresh data from relays,
   * bypassing cache and storage to ensure we get the latest updates
   * 
   * @param dTagFilter Optional d-tag to filter for a specific starter pack (e.g., 'popular')
   */
  private refreshStarterPacksInBackground(dTagFilter?: string): void {
    // Use queueMicrotask to ensure this happens asynchronously
    queueMicrotask(async () => {
      try {
        this.logger.debug(`Starting background refresh of starter packs from relays${dTagFilter ? ` (filtered by d-tag: ${dTagFilter})` : ''}`);

        const refreshedPacks: StarterPack[] = [];

        for (const source of this.STARTER_PACK_SOURCES) {
          try {
            // Fetch fresh data from relays by bypassing cache
            // invalidateCache: true forces fetching from relays, not cache/storage
            // save: true ensures the fresh data is saved to storage for next time
            const events = await this.userDataService.getEventsByPubkeyAndKind(
              source.pubkey,
              39089, // Starter pack kind
              {
                cache: true,        // Enable caching for future fast reads
                invalidateCache: true,  // But bypass cache for this fetch (get from relays)
                save: true          // Save fresh data to storage
              }
            );

            // Parse and collect the refreshed starter packs if they match allowed d-tags
            events.forEach(record => {
              const starterPack = this.parseStarterPackEvent(record.event);
              if (starterPack) {
                // Only include if the d-tag is in the allowed list for this source
                const isAllowedDTag = source.dTags.includes(starterPack.dTag);
                const matchesFilter = !dTagFilter || starterPack.dTag === dTagFilter;

                if (isAllowedDTag && matchesFilter) {
                  refreshedPacks.push(starterPack);
                }
              }
            });
          } catch (error) {
            this.logger.debug(`Background refresh failed for ${source.pubkey}:`, error);
            // Don't throw - this is best-effort background refresh
          }
        }

        // Update the signal with fresh data if we got any
        if (refreshedPacks.length > 0) {
          this.starterPacks.set(refreshedPacks);
          this.logger.debug(
            `Background refresh completed: Updated ${refreshedPacks.length} starter packs from relays${dTagFilter ? ` (filtered by d-tag: ${dTagFilter})` : ''}`
          );
        }

        this.logger.debug('Background refresh of starter packs completed');
      } catch (error) {
        this.logger.debug('Background refresh of starter packs failed:', error);
        // Silently fail - this is a background operation
      }
    });
  }

  /**
   * Parse a starter pack event into our StarterPack interface
   */
  private parseStarterPackEvent(event: Event): StarterPack | null {
    try {
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const dTag = event.tags.find(tag => tag[0] === 'd');
      const imageTag = event.tags.find(tag => tag[0] === 'image');
      const descriptionTag = event.tags.find(tag => tag[0] === 'description');
      const relayTags = event.tags.filter(tag => tag[0] === 'relays');
      const pubkeyTags = event.tags.filter(tag => tag[0] === 'p');

      if (!titleTag || !dTag) {
        this.logger.warn('Starter pack missing required tags', {
          eventId: event.id,
        });
        return null;
      }

      return {
        id: event.id,
        title: titleTag[1],
        description: descriptionTag?.[1],
        image: imageTag?.[1],
        pubkeys: pubkeyTags.map(tag => tag[1]),
        relays: relayTags.flatMap(tag => tag.slice(1)),
        dTag: dTag[1],
        authorPubkey: event.pubkey,
        createdAt: event.created_at,
      };
    } catch (error) {
      this.logger.error('Failed to parse starter pack event:', error);
      return null;
    }
  }

  /**
   * Convert starter packs to interests for the followset component
   */
  convertStarterPacksToInterests(starterPacks: StarterPack[]): Interest[] {
    return starterPacks.map(pack => ({
      id: pack.dTag,
      name: pack.title,
      icon: this.getIconForStarterPack(pack),
    }));
  }

  /**
   * Convert starter packs to suggested profiles
   */
  async convertStarterPacksToProfiles(
    starterPacks: StarterPack[],
    selectedInterests: string[]
  ): Promise<SuggestedProfile[]> {
    const profiles: SuggestedProfile[] = [];

    // Get all pubkeys from selected starter packs
    const selectedPacks = starterPacks.filter(pack => selectedInterests.includes(pack.dTag));
    const allPubkeys = new Set<string>();

    selectedPacks.forEach(pack => {
      pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
    });

    // Fetch profiles for these pubkeys
    const pubkeyArray = Array.from(allPubkeys);

    try {
      const profileRecords = await this.dataService.getProfiles(pubkeyArray);

      if (profileRecords) {
        profileRecords.forEach(record => {
          const metadata = this.parseProfileMetadata(record.event.content);
          if (metadata) {
            const meta = metadata as ParsedProfileMetadata;
            // Find which starter packs this pubkey belongs to
            const belongsToInterests = selectedPacks
              .filter(pack => pack.pubkeys.includes(record.event.pubkey))
              .map(pack => pack.dTag);

            profiles.push({
              id: record.event.pubkey,
              name: (typeof meta.name === 'string' && meta.name) || (typeof meta.display_name === 'string' && meta.display_name) || 'Anonymous',
              bio: typeof meta.about === 'string' ? meta.about : '',
              avatar: typeof meta.picture === 'string' ? meta.picture : '/icons/icon-192x192.png',
              interests: belongsToInterests,
            });
          }
        });
      }
    } catch (error) {
      this.logger.error('Failed to fetch profiles for starter packs:', error);
    }

    return profiles;
  }

  /**
   * Parse profile metadata from event content
   */
  private parseProfileMetadata(content: string): ParsedProfileMetadata | null {
    try {
      return JSON.parse(content) as ParsedProfileMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Get appropriate icon for a starter pack based on its title
   */
  private getIconForStarterPack(pack: StarterPack): string {
    const title = pack.title.toLowerCase();

    if (title.includes('stream')) return 'play_circle';
    if (title.includes('tech') || title.includes('developer')) return 'code';
    if (title.includes('art') || title.includes('design')) return 'palette';
    if (title.includes('music')) return 'music_note';
    if (title.includes('news') || title.includes('journalist')) return 'newspaper';
    if (title.includes('bitcoin') || title.includes('crypto')) return 'currency_bitcoin';
    if (title.includes('gaming') || title.includes('game')) return 'sports_esports';
    if (title.includes('food') || title.includes('cooking')) return 'restaurant';
    if (title.includes('travel')) return 'flight';
    if (title.includes('fitness') || title.includes('health')) return 'fitness_center';
    if (title.includes('education') || title.includes('learning')) return 'school';
    if (title.includes('business') || title.includes('entrepreneur')) return 'business';

    return 'group'; // Default icon
  }

  /**
   * Get starter pack by dTag
   */
  getStarterPackByDTag(dTag: string): StarterPack | undefined {
    return this.starterPacks().find(pack => pack.dTag === dTag);
  }

  /**
   * Get all pubkeys from selected interests
   */
  getPubkeysFromInterests(selectedInterests: string[]): string[] {
    const pubkeys = new Set<string>();

    selectedInterests.forEach(interestId => {
      const pack = this.getStarterPackByDTag(interestId);
      if (pack) {
        pack.pubkeys.forEach(pubkey => pubkeys.add(pubkey));
      }
    });

    return Array.from(pubkeys);
  }
}
