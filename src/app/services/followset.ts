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

  // Well-known pubkeys for different categories
  private readonly NOSTRIA_CURATORS = [
    'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria official
    'f901616f00a63f4f9c7881d4871a03df3d4cee7291eafd7adcbeea7c95c58e27', // Community curator - starter pack: odenjo2n582o
    '17538dc2a62769d09443f18c37cbe358fab5bbf981173542aa7c5ff171ed77c4', // Starter pack: y156932o9xfh
    'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Starter pack: 5gj7p3ctxvje
    '85df00a2f6a91845354c8d2d9fbab4002bb85b4225baeab60fafb2587c5038ea', // Starter pack: 8b8a3825-ddc2-4085-a58d-a5b33a1a934d
    'ede41352397758154514148b24112308ced96d121229b0e6a66bc5a2b40c03ec', // Starter pack: streamersFollowPackh8Kz3P2q
    '64bfa9abffe5b18d0731eed57b38173adc2ba89bf87c168da90517f021e722b5', // Starter pack: frwuenx3icsi
  ];

  /**
   * Fetch starter packs from known curators using DataService
   * 
   * This method uses a cache-first strategy:
   * 1. Returns cached/stored data immediately (fast)
   * 2. Refreshes from relays in the background for next time
   * 
   * The OnDemandUserDataService already handles cache/storage via { cache: true, save: true }
   * so we just need to trigger a background refresh after returning cached data.
   * 
   * @param dTagFilter Optional d-tag to filter for a specific starter pack (e.g., 'popular')
   */
  async fetchStarterPacks(dTagFilter?: string): Promise<StarterPack[]> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const starterPacks: StarterPack[] = [];

      // Fetch starter packs from each curator
      // This will return cached data if available, or fetch from relays if not
      for (const pubkey of this.NOSTRIA_CURATORS) {
        try {
          // One-shot fetch via on-demand service to avoid holding sockets
          // This uses cache: true, save: true - so it returns cached data quickly
          const events = await this.onDemandUserData.getEventsByPubkeyAndKind(
            pubkey,
            39089 // Starter pack kind
          );

          // Parse each event and add to starter packs
          events.forEach(record => {
            const starterPack = this.parseStarterPackEvent(record.event);
            if (starterPack) {
              // Filter by d-tag if specified
              if (!dTagFilter || starterPack.dTag === dTagFilter) {
                starterPacks.push(starterPack);
              }
            }
          });
        } catch (error) {
          this.logger.error(`Failed to fetch starter packs from ${pubkey}:`, error);
        }
      }

      this.starterPacks.set(starterPacks);
      this.logger.info(`Fetched ${starterPacks.length} starter packs from cache/storage${dTagFilter ? ` (filtered by d-tag: ${dTagFilter})` : ''}`);

      // Trigger background refresh from relays for next time
      // This happens asynchronously and doesn't block the return
      this.refreshStarterPacksInBackground(dTagFilter);

      return starterPacks;
    } catch (error) {
      this.logger.error('Failed to fetch starter packs:', error);
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

        for (const pubkey of this.NOSTRIA_CURATORS) {
          try {
            // Fetch fresh data from relays by bypassing cache
            // invalidateCache: true forces fetching from relays, not cache/storage
            // save: true ensures the fresh data is saved to storage for next time
            const events = await this.userDataService.getEventsByPubkeyAndKind(
              pubkey,
              39089, // Starter pack kind
              {
                cache: true,        // Enable caching for future fast reads
                invalidateCache: true,  // But bypass cache for this fetch (get from relays)
                save: true          // Save fresh data to storage
              }
            );

            // Parse and collect the refreshed starter packs
            events.forEach(record => {
              const starterPack = this.parseStarterPackEvent(record.event);
              if (starterPack) {
                // Filter by d-tag if specified
                if (!dTagFilter || starterPack.dTag === dTagFilter) {
                  refreshedPacks.push(starterPack);
                }
              }
            });
          } catch (error) {
            this.logger.debug(`Background refresh failed for ${pubkey}:`, error);
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
