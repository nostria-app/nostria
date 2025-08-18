import { computed, inject, Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';
import { NostrService } from './nostr.service';
import { Event, kinds, NostrEvent } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { DataService } from './data.service';
import { AccountRelayServiceEx } from './relays/account-relay';
import { UserRelayExFactoryService } from './user-relay-factory.service';

export interface ParsedBadge {
  slug: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

interface ParsedReward {
  badgeId: string;
  slug: string;
  pubkey: string;
  id: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

@Injectable({
  providedIn: 'root',
})
export class BadgeService implements NostriaService {
  private readonly storage = inject(StorageService);
  private readonly nostr = inject(NostrService);
  private readonly accountRelay = inject(AccountRelayServiceEx);
  private readonly utilities = inject(UtilitiesService);
  userRelayFactory = inject(UserRelayExFactoryService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly data = inject(DataService);

  // Signals to store different types of badges
  badgeDefinitions = signal<Event[]>([]);

  createdDefinitions = computed(() => {
    return this.badgeDefinitions().filter(
      badge => badge.pubkey === this.accountState.pubkey()
    );
  });

  profileBadgesEvent = signal<NostrEvent | null>(null);
  acceptedBadges = signal<
    {
      aTag: string[];
      eTag: string[];
      id: string;
      pubkey: string;
      slug: string;
    }[]
  >([]);
  issuedBadges = signal<NostrEvent[]>([]);
  receivedBadges = signal<NostrEvent[]>([]);
  badgeIssuers = signal<Record<string, any>>({});

  // Loading states
  isLoadingAccepted = signal<boolean>(false);
  isLoadingReceived = signal<boolean>(false);
  isLoadingIssued = signal<boolean>(false);
  isLoadingDefinitions = signal<boolean>(false);

  getBadgeDefinition(pubkey: string, slug: string): Event | undefined {
    const badge = this.badgeDefinitions().find(badge => {
      const tags = badge.tags || [];
      return tags.some(
        tag => badge.pubkey === pubkey && tag[0] === 'd' && tag[1] === slug
      );
    });

    return badge;
  }

  putBadgeDefinition(badge: Event): void {
    if (badge.kind === kinds.BadgeDefinition) {
      this.badgeDefinitions.update(badges => {
        const index = badges.findIndex(b => b.id === badge.id);
        if (index !== -1) {
          badges[index] = badge;
        } else {
          badges.push(badge);
        }
        return badges;
      });
    }
  }

  async load() {}

  async loadAcceptedBadges(pubkey: string): Promise<void> {
    this.isLoadingAccepted.set(true);
    try {
      const profileBadgesEvent =
        await this.accountRelay.getEventByPubkeyAndKind(
          pubkey,
          kinds.ProfileBadges
        );
      console.log('Profile Badges Event:', profileBadgesEvent);

      if (profileBadgesEvent) {
        this.parseBadgeTags(profileBadgesEvent.tags);
        await this.storage.saveEvent(profileBadgesEvent);
      }

      this.profileBadgesEvent.set(profileBadgesEvent);
    } catch (err) {
      console.error('Error loading accepted badges:', err);
    } finally {
      this.isLoadingAccepted.set(false);
    }
  }

  async loadIssuedBadges(pubkey: string): Promise<void> {
    this.isLoadingIssued.set(true);
    try {
      const badgeAwardEvents = await this.accountRelay.getEventsByPubkeyAndKind(
        pubkey,
        kinds.BadgeAward
      );
      console.log('badgeAwardsEvent:', badgeAwardEvents);

      for (const event of badgeAwardEvents) {
        await this.storage.saveEvent(event);
      }

      this.issuedBadges.set(badgeAwardEvents);
    } catch (err) {
      console.error('Error loading issued badges:', err);
    } finally {
      this.isLoadingIssued.set(false);
    }
  }

  /** Attempts to discovery a badge definition. */
  async loadBadgeDefinition(pubkey: string, slug: string) {
    let definition: NostrEvent | null | undefined = this.getBadgeDefinition(
      pubkey,
      slug
    );

    if (!definition) {
      definition = await this.accountRelay.getEventByPubkeyAndKindAndTag(
        pubkey,
        kinds.BadgeDefinition,
        { key: 'd', value: slug }
      );
      console.log(
        'Badge definition not found in local storage, fetched from relay:',
        definition
      );

      // If the definition is not found on the user's relays, try to fetch from author and then re-publish to user's relays.
      if (!definition) {
        try {
          const userRelay = await this.userRelayFactory.create(pubkey);
          definition = await userRelay.getEventByPubkeyAndKindAndTag(
            pubkey,
            kinds.BadgeDefinition,
            { key: 'd', value: slug }
          );
          console.log(
            'Badge definition not found on user relays, fetched from author relays:',
            definition
          );
          userRelay.destroy();

          if (!definition) {
            this.logger.error('Badge definition not found on author relays.');
          }
        } catch (err: any) {
          this.logger.error(err.message);
        }
      }
    }

    if (definition) {
      this.putBadgeDefinition(definition);
      await this.storage.saveEvent(definition);
      // this.parseBadgeDefinition(definition);
    }

    return definition;
  }

  async parseReward(rewardEvent: NostrEvent) {
    if (!rewardEvent || !rewardEvent.tags) {
      return;
    }

    const parsedReward: Partial<ParsedReward> = {
      tags: [],
    };

    const badgeTag = this.nostr.getTags(rewardEvent, 'a');

    if (badgeTag.length !== 1) {
      return;
    }

    const receivers = this.nostr.getTags(rewardEvent, 'p');
    const badgeTagArray = badgeTag[0].split(':');

    // Just validate if the badge type is a badge definition
    if (Number(badgeTagArray[0]) !== kinds.BadgeDefinition) {
      return;
    }

    // Validate that the pubkey is the same as the one in the badge tag
    if (badgeTagArray[1] !== rewardEvent.pubkey) {
      return;
    }

    const pubkey = rewardEvent.pubkey;
    const slug = badgeTagArray[2];

    await this.loadBadgeDefinition(pubkey, slug);

    return parsedReward;
  }

  async loadBadgeDefinitions(pubkey: string): Promise<void> {
    this.isLoadingDefinitions.set(true);
    try {
      const badgeDefinitionEvents =
        await this.accountRelay.getEventsByPubkeyAndKind(
          pubkey,
          kinds.BadgeDefinition
        );
      console.log('badgeDefinitionEvents:', badgeDefinitionEvents);

      for (const event of badgeDefinitionEvents) {
        await this.storage.saveEvent(event);
        this.putBadgeDefinition(event);
      }

      // this.badgeDefinitions.set(badgeDefinitionEvents);
    } catch (err) {
      console.error('Error loading badge definitions:', err);
    } finally {
      this.isLoadingDefinitions.set(false);
    }
  }

  async loadReceivedBadges(pubkey: string): Promise<void> {
    this.isLoadingReceived.set(true);
    try {
      const receivedAwardsEvents =
        await this.accountRelay.getEventsByKindAndPubKeyTag(
          pubkey,
          kinds.BadgeAward
        );
      console.log('receivedAwardsEvents:', receivedAwardsEvents);

      await this.fetchBadgeIssuers(receivedAwardsEvents);
      this.receivedBadges.set(receivedAwardsEvents);
    } catch (err) {
      console.error('Error loading received badges:', err);
    } finally {
      this.isLoadingReceived.set(false);
    }
  }

  async loadAllBadges(pubkey: string): Promise<void> {
    // First load the badge definitions of the account.
    await this.loadBadgeDefinitions(pubkey);

    // Then load all issued badges.
    await this.loadIssuedBadges(pubkey);

    // Load the profile badges event.
    await this.loadAcceptedBadges(pubkey);

    // Finally load the received badges.
    await this.loadReceivedBadges(pubkey);
  }

  private async fetchBadgeIssuers(receivedBadges: NostrEvent[]): Promise<void> {
    const issuers: Record<string, any> = {};

    // Get unique issuer pubkeys
    const issuerPubkeys = [
      ...new Set(receivedBadges.map(badge => badge.pubkey)),
    ];

    // Fetch metadata for each issuer
    for (const pubkey of issuerPubkeys) {
      try {
        const metadata = await this.data.getProfile(pubkey);
        // const metadata = await this.nostr.getMetadataForUser(pubkey);

        if (metadata) {
          issuers[pubkey] = metadata.data;
        } else {
          issuers[pubkey] = { name: this.utilities.getTruncatedNpub(pubkey) };
        }
      } catch (err) {
        console.error(`Error fetching metadata for ${pubkey}:`, err);
        issuers[pubkey] = { name: this.utilities.getTruncatedNpub(pubkey) };
      }
    }

    this.badgeIssuers.set(issuers);
  }

  private parseBadgeTags(tags: string[][]): void {
    // Find the 'a' tags
    const aTags = tags.filter(tag => tag[0] === 'a');
    // Find the 'e' tags
    const eTags = tags.filter(tag => tag[0] === 'e');

    // Match them together based on their position
    const pairs = aTags.map((aTag, index) => {
      const eTag = index < eTags.length ? eTags[index] : null;

      const values = aTag[1].split(':');
      const kind = values[0];
      const pubkey = values[1];
      const slug = values[2];

      return {
        pubkey,
        slug,
        kind,
        id: aTag[1],
        eventId: eTag![0],
        aTag,
        eTag: eTag || [],
      };
    });

    console.log('Parsed badge pairs:', pairs);
    this.acceptedBadges.set(pairs);
  }

  isBadgeAccepted(badgeAward: NostrEvent): boolean {
    const badgeATag = this.getBadgeATag(badgeAward);
    return this.acceptedBadges().some(badge => badge.id === badgeATag);
  }

  getBadgeATag(badgeAward: NostrEvent): string {
    const aTag = badgeAward.tags.find(tag => tag[0] === 'a');
    return aTag ? aTag[1] : '';
  }

  getBadgeDefinitionByATag(aTag: string): NostrEvent | undefined {
    if (!aTag) return undefined;

    const parts = aTag.split(':');
    if (parts.length < 3) return undefined;

    const kind = parts[0];
    const pubkey = parts[1];
    const slug = parts[2];

    return this.getBadgeDefinition(pubkey, slug);
  }

  // parseBadgeDefinition(event: NostrEvent) {
  //     if (!event || !event.tags) {
  //         return;
  //     }

  //     const parsedBadge: Partial<ParsedBadge> = {
  //         tags: []
  //     };

  //     // Parse each tag based on its identifier
  //     for (const tag of event.tags) {
  //         if (tag.length >= 2) {
  //             const [key, value] = tag;

  //             switch (key) {
  //                 case 'd':
  //                     parsedBadge.slug = value;
  //                     break;
  //                 case 'description':
  //                     parsedBadge.description = value;
  //                     break;
  //                 case 'name':
  //                     parsedBadge.name = value;
  //                     break;
  //                 case 'image':
  //                     parsedBadge.image = value;
  //                     break;
  //                 case 'thumb':
  //                     parsedBadge.thumb = value;
  //                     break;
  //                 case 't':
  //                     // Accumulate types in an array
  //                     if (parsedBadge.tags) {
  //                         parsedBadge.tags.push(value);
  //                     }
  //                     break;
  //             }
  //         }
  //     }

  //     return parsedBadge;
  // }

  parseDefinition(event: NostrEvent): ParsedBadge {
    // Early return with complete fallback object
    if (!event?.tags?.length) {
      return {
        slug: '',
        name: 'Unknown Badge',
        description: 'Badge definition not found',
        image: '',
        thumb: '',
        tags: [],
      };
    }

    // Create a tag lookup map for O(1) access to first occurrence
    const tagMap = new Map<string, string>();
    const tagValues: string[] = [];

    for (const tag of event.tags) {
      if (tag.length >= 2) {
        const [key, value] = tag;

        // Store first occurrence of each tag type
        if (!tagMap.has(key)) {
          tagMap.set(key, value);
        }

        // Collect all 't' tag values
        if (key === 't') {
          tagValues.push(value);
        }
      }
    }

    const image = tagMap.get('image') || '';

    return {
      slug: tagMap.get('d') || '',
      name: tagMap.get('name') || 'Unnamed Badge',
      description: tagMap.get('description') || 'No description',
      image,
      thumb: tagMap.get('thumb') || image, // Fallback to image
      tags: tagValues,
    };
  }

  // getBadgeInfo(badgeAward: NostrEvent): ParsedBadge {
  //     const aTag = this.getBadgeATag(badgeAward);
  //     const badgeDefinition = this.getBadgeDefinitionByATag(aTag);

  //     if (!badgeDefinition) {
  //         return {
  //             name: 'Unknown Badge',
  //             description: 'Badge definition not found',
  //             image: '',
  //             thumb: ''
  //         };
  //     }

  //     const nameTag = badgeDefinition.tags.find(tag => tag[0] === 'name');
  //     const descTag = badgeDefinition.tags.find(tag => tag[0] === 'description');
  //     const imageTag = badgeDefinition.tags.find(tag => tag[0] === 'image');
  //     const thumbTag = badgeDefinition.tags.find(tag => tag[0] === 'thumb');

  //     return {
  //         name: nameTag ? nameTag[1] : 'Unnamed Badge',
  //         description: descTag ? descTag[1] : 'No description',
  //         image: imageTag ? imageTag[1] : '',
  //         thumb: thumbTag ? thumbTag[1] : (imageTag ? imageTag[1] : '')
  //     };
  // }

  clear(): void {
    this.badgeDefinitions.set([]);
    this.profileBadgesEvent.set(null);
    this.acceptedBadges.set([]);
    this.issuedBadges.set([]);
    this.receivedBadges.set([]);
    this.badgeIssuers.set({});
  }
}
