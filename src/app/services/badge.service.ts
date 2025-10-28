import { computed, inject, Injectable, signal, NgZone } from '@angular/core';
import { StorageService } from './storage.service';
import { NostrService } from './nostr.service';
import { Event, kinds, NostrEvent } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { DataService } from './data.service';
import { AccountRelayService } from './relays/account-relay';
import { UserRelayService } from './relays/user-relay';

export interface ParsedBadge {
  slug: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

export interface AcceptedBadge {
  aTag: string[];
  eTag: string[];
  id: string;
  pubkey: string;
  slug: string;
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
  private readonly accountRelay = inject(AccountRelayService);
  private readonly utilities = inject(UtilitiesService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly data = inject(DataService);
  private readonly ngZone = inject(NgZone);

  // Signals to store different types of badges
  badgeDefinitions = signal<Event[]>([]);

  createdDefinitions = computed(() => {
    return this.badgeDefinitions().filter(badge => badge.pubkey === this.accountState.pubkey());
  });

  profileBadgesEvent = signal<NostrEvent | null>(null);
  acceptedBadges = signal<AcceptedBadge[]>([]);
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
      return tags.some(tag => badge.pubkey === pubkey && tag[0] === 'd' && tag[1] === slug);
    });

    return badge;
  }

  putBadgeDefinition(badge: Event): void {
    if (badge.kind === kinds.BadgeDefinition) {
      // Schedule the update for the next change detection cycle to avoid ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.badgeDefinitions.update(badges => {
          const index = badges.findIndex(b => b.id === badge.id);
          if (index !== -1) {
            badges[index] = badge;
          } else {
            badges.push(badge);
          }
          return badges;
        });
      }, 0);
    }
  }

  async load() { }

  async loadAcceptedBadges(pubkey: string): Promise<void> {
    this.isLoadingAccepted.set(true);
    try {
      // Ensure relays are discovered for this pubkey first
      await this.userRelayService.ensureRelaysForPubkey(pubkey);

      // Use userRelayService to query the specific user's relays
      const profileBadgesEvent = await this.userRelayService.getEventByPubkeyAndKind(
        pubkey,
        kinds.ProfileBadges
      );
      console.log('Profile Badges Event:', profileBadgesEvent);

      if (profileBadgesEvent) {
        this.parseBadgeTags(profileBadgesEvent.tags);
        await this.storage.saveEvent(profileBadgesEvent);
      } else {
        // Clear accepted badges if no profile badges event found
        this.acceptedBadges.set([]);
      }

      this.profileBadgesEvent.set(profileBadgesEvent);
    } catch (err) {
      console.error('Error loading accepted badges:', err);
      // Clear accepted badges on error
      this.acceptedBadges.set([]);
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
    let definition: NostrEvent | null | undefined = this.getBadgeDefinition(pubkey, slug);

    if (!definition) {
      definition = await this.accountRelay.getEventByPubkeyAndKindAndTag(
        pubkey,
        kinds.BadgeDefinition,
        { key: 'd', value: slug }
      );
      console.log('Badge definition not found in local storage, fetched from relay:', definition);

      // If the definition is not found on the user's relays, try to fetch from author's relays
      if (!definition) {
        try {
          // Ensure relays are discovered for this pubkey
          await this.userRelayService.ensureRelaysForPubkey(pubkey);

          // Check what relays were discovered
          const authorRelays = this.userRelayService.getRelaysForPubkey(pubkey);
          console.log(`Badge author ${pubkey.slice(0, 16)}... relays discovered:`, authorRelays);

          if (authorRelays.length === 0) {
            this.logger.warn(`No relays found for badge author: ${pubkey.slice(0, 16)}...`);
            // Try using global discovery relays as fallback
            console.log('Attempting to fetch from discovery relays as fallback');
            definition = await this.accountRelay.getEventByPubkeyAndKindAndTag(
              pubkey,
              kinds.BadgeDefinition,
              { key: 'd', value: slug }
            );
          } else {
            definition = await this.userRelayService.getEventByPubkeyAndKindAndTag(
              pubkey,
              kinds.BadgeDefinition,
              { key: 'd', value: slug }
            );
          }

          console.log(
            'Badge definition fetch result from author relays:',
            definition ? 'found' : 'not found'
          );

          if (!definition) {
            this.logger.error(`Badge definition not found for ${pubkey.slice(0, 16)}... slug: ${slug}`);
          }
        } catch (err) {
          this.logger.error('Error loading badge definition:', err);
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
      const badgeDefinitionEvents = await this.accountRelay.getEventsByPubkeyAndKind(
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
      const receivedAwardsEvents = await this.accountRelay.getEventsByKindAndPubKeyTag(
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
    const issuerPubkeys = [...new Set(receivedBadges.map(badge => badge.pubkey))];

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

    // Start loading badge definitions in the background
    this.loadBadgeDefinitionsInBackground(pairs);
  }

  private async loadBadgeDefinitionsInBackground(
    badges: { pubkey: string; slug: string }[]
  ): Promise<void> {
    console.log(`Starting background load of ${badges.length} badge definitions`);

    for (const badge of badges) {
      // Check if we already have this definition cached
      const cached = this.getBadgeDefinition(badge.pubkey, badge.slug);
      if (!cached) {
        // Load in background without blocking
        this.loadBadgeDefinition(badge.pubkey, badge.slug).catch(err => {
          console.error(`Failed to load badge definition for ${badge.slug}:`, err);
        });
      }
    }
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

  clear(): void {
    this.badgeDefinitions.set([]);
    this.profileBadgesEvent.set(null);
    this.acceptedBadges.set([]);
    this.issuedBadges.set([]);
    this.receivedBadges.set([]);
    this.badgeIssuers.set({});
  }
}
