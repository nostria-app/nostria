import { Injectable, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { UserDataFactoryService } from './user-data-factory.service';

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

@Injectable({
  providedIn: 'root',
})
export class Followset {
  private readonly dataService = inject(DataService);
  private readonly logger = inject(LoggerService);
  private readonly userDataFactory = inject(UserDataFactoryService);

  // Signals for reactive updates
  starterPacks = signal<StarterPack[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Well-known pubkeys for different categories
  private readonly NOSTRIA_CURATORS = [
    'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria official
    // Add more curator pubkeys here
  ];

  /**
   * Fetch starter packs from known curators using DataService
   */
  async fetchStarterPacks(): Promise<StarterPack[]> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const starterPacks: StarterPack[] = [];

      // Fetch starter packs from each curator
      for (const pubkey of this.NOSTRIA_CURATORS) {
        try {
          const data = await this.userDataFactory.create(pubkey);

          // Use DataService to get events by pubkey and kind
          const events = await data.getEventsByPubkeyAndKind(
            pubkey,
            39089, // Starter pack kind
            { cache: true, save: true }
          );

          // Parse each event and add to starter packs
          events.forEach(record => {
            const starterPack = this.parseStarterPackEvent(record.event);
            if (starterPack) {
              starterPacks.push(starterPack);
            }
          });
        } catch (error) {
          this.logger.error(
            `Failed to fetch starter packs from ${pubkey}:`,
            error
          );
        }
      }

      this.starterPacks.set(starterPacks);
      this.logger.info(`Fetched ${starterPacks.length} starter packs`);

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
    const selectedPacks = starterPacks.filter(pack =>
      selectedInterests.includes(pack.dTag)
    );
    const allPubkeys = new Set<string>();

    selectedPacks.forEach(pack => {
      pack.pubkeys.forEach(pubkey => allPubkeys.add(pubkey));
    });

    // Fetch profiles for these pubkeys
    const pubkeyArray = Array.from(allPubkeys).slice(0, 20); // Limit to 20 profiles

    try {
      const profileRecords = await this.dataService.getProfiles(pubkeyArray);

      if (profileRecords) {
        profileRecords.forEach(record => {
          const metadata = this.parseProfileMetadata(record.event.content);
          if (metadata) {
            // Find which starter packs this pubkey belongs to
            const belongsToInterests = selectedPacks
              .filter(pack => pack.pubkeys.includes(record.event.pubkey))
              .map(pack => pack.dTag);

            profiles.push({
              id: record.event.pubkey,
              name: metadata.name || metadata.display_name || 'Anonymous',
              bio: metadata.about || '',
              avatar: metadata.picture || '/icons/icon-192x192.png',
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
  private parseProfileMetadata(content: string): any {
    try {
      return JSON.parse(content);
    } catch (error) {
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
    if (title.includes('news') || title.includes('journalist'))
      return 'newspaper';
    if (title.includes('bitcoin') || title.includes('crypto'))
      return 'currency_bitcoin';
    if (title.includes('gaming') || title.includes('game'))
      return 'sports_esports';
    if (title.includes('food') || title.includes('cooking'))
      return 'restaurant';
    if (title.includes('travel')) return 'flight';
    if (title.includes('fitness') || title.includes('health'))
      return 'fitness_center';
    if (title.includes('education') || title.includes('learning'))
      return 'school';
    if (title.includes('business') || title.includes('entrepreneur'))
      return 'business';

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
