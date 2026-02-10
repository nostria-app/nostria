import { Injectable, inject, signal, effect } from '@angular/core';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { DeletionFilterService } from './deletion-filter.service';

/**
 * Kind 30030: Emoji sets
 * Tags:
 * - "emoji" (shortcode, image URL) - custom emojis
 * - "d" (identifier) - unique identifier for the set
 * 
 * Kind 10030: User's preferred emojis
 * Tags:
 * - "emoji" (emoji character) - direct emoji
 * - "a" (reference) - reference to kind 30030 emoji sets
 * 
 * Kind 30015: Interest sets (hashtags)
 * Tags:
 * - "t" (hashtag) - interest hashtags
 * - "d" (identifier) - unique identifier, we use "interests" as standard
 */
const EMOJI_SET_KIND = 30030;
const PREFERRED_EMOJI_KIND = 10030;
const INTEREST_SET_KIND = 30015;

const DEFAULT_HASHTAGS = [
  'catstr',
  'birdstr',
  'asknostr',
  'homesteading',
  'growstr',
  'farmstr',
];

export interface EmojiItem {
  shortcode: string;
  url: string;
}

export interface PreferredEmojiSet {
  title: string;
  identifier: string;
  emojis: EmojiItem[];
}

export interface EmojiSet {
  identifier: string; // d-tag
  name: string;
  emojis: string[]; // shortcodes or emoji characters
  eventId: string;
  created_at: number;
}

export interface InterestSet {
  identifier: string; // d-tag - unique identifier for this interest list
  title: string; // Human-readable name for the list
  hashtags: string[];
  eventId: string;
  created_at: number;
}

@Injectable({
  providedIn: 'root',
})
export class CollectionSetsService {
  private logger = inject(LoggerService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private publishService = inject(PublishService);
  private accountRelay = inject(AccountRelayService);
  private deletionFilter = inject(DeletionFilterService);

  // Reactive signal for interest sets - shared across all consumers
  interestSets = signal<InterestSet[]>([]);
  interestSetsLoading = signal(false);

  private lastLoadedPubkey: string | null = null;

  constructor() {
    // Auto-load interest sets when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();

      if (pubkey && pubkey !== this.lastLoadedPubkey) {
        this.lastLoadedPubkey = pubkey;
        this.loadInterestSetsForAccount(pubkey);
      } else if (!pubkey) {
        this.lastLoadedPubkey = null;
        this.interestSets.set([]);
      }
    });
  }

  /**
   * Load interest sets for the current account and update the shared signal
   */
  private async loadInterestSetsForAccount(pubkey: string): Promise<void> {
    this.interestSetsLoading.set(true);
    try {
      const sets = await this.getInterestSets(pubkey);
      this.interestSets.set(sets);
    } catch (error) {
      this.logger.error('Error loading interest sets for account:', error);
    } finally {
      this.interestSetsLoading.set(false);
    }
  }

  /**
   * Get preferred emojis from user's emoji list (kind 10030)
   * Returns emojis grouped by their sets
   */
  async getPreferredEmojis(pubkey: string): Promise<PreferredEmojiSet[]> {
    try {
      // First check local database for faster loading
      await this.database.init();
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, PREFERRED_EMOJI_KIND);

      // If no local data, fetch from relays
      if (events.length === 0) {
        events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, PREFERRED_EMOJI_KIND);
        // Save to local database for next time
        for (const event of events) {
          await this.database.saveEvent(event);
        }
      }

      this.logger.info(`Found ${events.length} kind 10030 events for pubkey ${pubkey.substring(0, 8)}...`);

      if (events.length === 0) {
        return [];
      }

      // Get the most recent event
      const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
      this.logger.info('Latest kind 10030 event tags:', latestEvent.tags);

      // Extract emojis from tags
      // Kind 10030 can have:
      // - "emoji" tags: ["emoji", shortcode, url]
      // - "a" tags: ["a", "30030:pubkey:d-tag"] (references to emoji sets)
      const directEmojis: EmojiItem[] = [];
      const referencedSets: string[] = [];
      const emojiSets: PreferredEmojiSet[] = [];

      for (const tag of latestEvent.tags) {
        // Handle direct emoji tags with shortcode and URL
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          // Format: ["emoji", shortcode, url]
          directEmojis.push({
            shortcode: tag[1],
            url: tag[2]
          });
        }
        // Handle references to emoji sets
        else if (tag[0] === 'a' && tag[1]) {
          referencedSets.push(tag[1]);
        }
      }

      // Add direct emojis as a set if any exist
      if (directEmojis.length > 0) {
        emojiSets.push({
          title: 'Custom Emojis',
          identifier: 'custom',
          emojis: directEmojis
        });
      }

      // If we have referenced emoji sets, fetch them
      if (referencedSets.length > 0) {
        this.logger.info(`Found ${referencedSets.length} referenced emoji sets, fetching...`);

        for (const ref of referencedSets) {
          // Parse: "30030:pubkey:d-tag"
          const parts = ref.split(':');
          if (parts.length === 3 && parts[0] === '30030') {
            const [, refPubkey, identifier] = parts;

            // Fetch the referenced emoji set
            const refEvents = await this.database.getEventsByPubkeyKindAndDTag(
              refPubkey,
              EMOJI_SET_KIND,
              identifier
            );

            if (refEvents.length > 0) {
              const refEvent = refEvents[0];
              this.logger.info(`Fetched referenced emoji set "${identifier}":`, refEvent);

              // Get the set title
              const titleTag = refEvent.tags.find(tag => tag[0] === 'title');
              const title = titleTag?.[1] || identifier;

              // Extract emojis from the referenced set
              const setEmojis: EmojiItem[] = [];
              for (const tag of refEvent.tags) {
                if (tag[0] === 'emoji' && tag[1] && tag[2]) {
                  setEmojis.push({
                    shortcode: tag[1],
                    url: tag[2]
                  });
                }
              }

              if (setEmojis.length > 0) {
                emojiSets.push({
                  title,
                  identifier,
                  emojis: setEmojis
                });
              }
            } else {
              this.logger.warn(`Referenced emoji set not found in database: ${ref}`);
            }
          }
        }
      }

      this.logger.info(`Extracted ${emojiSets.length} emoji sets with total emojis:`, emojiSets);
      return emojiSets;
    } catch (error) {
      this.logger.error('Error loading preferred emojis:', error);
      return [];
    }
  }

  /**
   * Get emoji sets for the current user (kind 30030)
   */
  async getEmojiSets(pubkey: string): Promise<EmojiSet[]> {
    try {
      // First check local database for faster loading
      await this.database.init();
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, EMOJI_SET_KIND);

      // If no local data, fetch from relays
      if (events.length === 0) {
        events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, EMOJI_SET_KIND);
        // Save to local database for next time
        for (const event of events) {
          await this.database.saveEvent(event);
        }
      }

      this.logger.info(`Found ${events.length} kind 30030 events for pubkey ${pubkey.substring(0, 8)}...`);

      const sets: EmojiSet[] = [];

      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!dTag) continue;

        const name = event.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')?.[1] || dTag;
        const emojis = event.tags
          .filter(tag => tag[0] === 'emoji' && tag[1])
          .map(tag => tag[1]); // Get shortcode or emoji character

        sets.push({
          identifier: dTag,
          name,
          emojis,
          eventId: event.id,
          created_at: event.created_at,
        });
      }

      return sets;
    } catch (error) {
      this.logger.error('Error loading emoji sets:', error);
      return [];
    }
  }

  /**
   * Create or update an emoji set (kind 30030)
   */
  async saveEmojiSet(identifier: string, name: string, emojis: string[]): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Build tags
      const tags: string[][] = [
        ['d', identifier],
        ['name', name],
      ];

      // Add emoji tags
      for (const emoji of emojis) {
        tags.push(['emoji', emoji]);
      }

      // Create event
      const event = this.nostrService.createEvent(EMOJI_SET_KIND, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      // Save to database
      await this.database.saveEvent(signedEvent);

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Emoji set published:', {
        success: result.success,
        identifier,
        emojiCount: emojis.length,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving emoji set:', error);
      return false;
    }
  }

  /**
   * Delete an emoji set (publishes kind 5 deletion event)
   */
  async deleteEmojiSet(identifier: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Find the event to delete
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, EMOJI_SET_KIND);
      const eventToDelete = events.find(e => {
        const dTag = e.tags.find(tag => tag[0] === 'd')?.[1];
        return dTag === identifier;
      });

      if (!eventToDelete) {
        this.logger.error('Emoji set not found:', identifier);
        return false;
      }

      // Create deletion event (kind 5)
      const event = this.nostrService.createEvent(kinds.EventDeletion, 'Deleted emoji set', [
        ['e', eventToDelete.id],
        ['a', `${EMOJI_SET_KIND}:${pubkey}:${identifier}`],
      ]);
      const signedEvent = await this.nostrService.signEvent(event);

      // Save deletion event to database
      await this.database.saveEvent(signedEvent);

      // Publish deletion event
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Emoji set deletion published:', {
        success: result.success,
        identifier,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error deleting emoji set:', error);
      return false;
    }
  }

  /**
   * Get all interest sets for the current user (kind 30015)
   * Returns all interest lists with different d-tags
   */
  async getInterestSets(pubkey: string): Promise<InterestSet[]> {
    try {
      // First check local database for faster loading
      await this.database.init();
      let events = await this.database.getEventsByPubkeyAndKind(pubkey, INTEREST_SET_KIND);

      // Filter out deleted events
      events = events.filter(event => !this.deletionFilter.isDeleted(event));

      // If no local data, fetch from relays
      if (events.length === 0) {
        const relayEvents = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, INTEREST_SET_KIND);
        // Filter out deleted events from relays
        events = relayEvents.filter(event => !this.deletionFilter.isDeleted(event));
        // Save to local database for next time
        for (const event of events) {
          await this.database.saveEvent(event);
        }
      }

      // Group events by d-tag and keep only the most recent for each
      const eventsByDTag = new Map<string, typeof events[0]>();
      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!dTag) continue;

        const existing = eventsByDTag.get(dTag);
        if (!existing || event.created_at > existing.created_at) {
          eventsByDTag.set(dTag, event);
        }
      }

      // Convert to InterestSet objects
      const interestSets: InterestSet[] = [];
      for (const [dTag, event] of eventsByDTag) {
        const hashtags = event.tags
          .filter(tag => tag[0] === 't' && tag[1])
          .map(tag => tag[1]);

        // Get title from title tag, or use d-tag as fallback
        const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
        const title = titleTag || this.formatDTagAsTitle(dTag);

        interestSets.push({
          identifier: dTag,
          title,
          hashtags,
          eventId: event.id,
          created_at: event.created_at,
        });
      }

      // Sort by created_at descending
      interestSets.sort((a, b) => b.created_at - a.created_at);

      // If no interest sets exist, return a default one
      if (interestSets.length === 0) {
        this.logger.debug('No interest sets found, returning default');
        return [{
          identifier: 'interests',
          title: 'My Interests',
          hashtags: [...DEFAULT_HASHTAGS],
          eventId: '',
          created_at: Math.floor(Date.now() / 1000),
        }];
      }

      this.logger.debug(`Found ${interestSets.length} interest sets`);
      return interestSets;
    } catch (error) {
      this.logger.error('Error loading interest sets:', error);
      return [{
        identifier: 'interests',
        title: 'My Interests',
        hashtags: [...DEFAULT_HASHTAGS],
        eventId: '',
        created_at: Math.floor(Date.now() / 1000),
      }];
    }
  }

  /**
   * Get interest set for the current user (kind 30015) by d-tag
   * Returns default hashtags if no event exists
   */
  async getInterestSet(pubkey: string, identifier = 'interests'): Promise<InterestSet | null> {
    try {
      const allSets = await this.getInterestSets(pubkey);
      const set = allSets.find(s => s.identifier === identifier);

      if (set) {
        return set;
      }

      // No event exists with this identifier
      this.logger.debug(`No interest set found with identifier: ${identifier}`);
      return null;
    } catch (error) {
      this.logger.error('Error loading interest set:', error);
      return null;
    }
  }

  /**
   * Get a specific interest set by d-tag
   */
  async getInterestSetByDTag(pubkey: string, dTag: string): Promise<InterestSet | null> {
    return this.getInterestSet(pubkey, dTag);
  }

  /**
   * Save interest set (kind 30015) with custom identifier
   * @param identifier - d-tag identifier for the list
   * @param title - Human-readable title for the list
   * @param hashtags - Array of hashtags (without # prefix)
   */
  async saveInterestSet(hashtags: string[], identifier = 'interests', title?: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Build tags
      const tags: string[][] = [
        ['d', identifier],
      ];

      // Add title tag if provided
      if (title) {
        tags.push(['title', title]);
      }

      // Add hashtag tags (without # prefix)
      for (const hashtag of hashtags) {
        const cleanHashtag = hashtag.replace(/^#/, '');
        if (cleanHashtag) {
          tags.push(['t', cleanHashtag]);
        }
      }

      // Create event
      const event = this.nostrService.createEvent(INTEREST_SET_KIND, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      // Save to database
      await this.database.saveEvent(signedEvent);

      // Update the shared signal immediately after database save so all consumers
      // see the change right away (consistent with FollowSetsService pattern)
      const cleanHashtags = hashtags.map(h => h.replace(/^#/, '')).filter(h => h);
      this.interestSets.update(sets => {
        const index = sets.findIndex(s => s.identifier === identifier);
        const updatedSet: InterestSet = {
          identifier,
          title: title || (index >= 0 ? sets[index].title : this.formatDTagAsTitle(identifier)),
          hashtags: cleanHashtags,
          eventId: signedEvent.id,
          created_at: signedEvent.created_at,
        };
        if (index >= 0) {
          const newSets = [...sets];
          newSets[index] = updatedSet;
          return newSets;
        }
        return [...sets, updatedSet];
      });

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Interest set published:', {
        success: result.success,
        identifier,
        title,
        hashtagCount: hashtags.length,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving interest set:', error);
      return false;
    }
  }

  /**
   * Create a new interest set with a unique identifier
   */
  async createInterestSet(title: string, hashtags: string[]): Promise<InterestSet | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return null;
    }

    // Generate a unique d-tag based on timestamp
    const identifier = `interests-${Date.now()}`;

    const success = await this.saveInterestSet(hashtags, identifier, title);
    if (success) {
      return {
        identifier,
        title,
        hashtags,
        eventId: '', // Will be populated on next fetch
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    return null;
  }

  /**
   * Delete an interest set (publishes kind 5 deletion event)
   */
  async deleteInterestSet(identifier: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Find the event to delete
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, INTEREST_SET_KIND);
      const eventToDelete = events.find(e => {
        const dTag = e.tags.find(tag => tag[0] === 'd')?.[1];
        return dTag === identifier;
      });

      if (!eventToDelete) {
        this.logger.error('Interest set not found:', identifier);
        return false;
      }

      // Create deletion event (kind 5)
      const event = this.nostrService.createEvent(kinds.EventDeletion, 'Deleted interest set', [
        ['e', eventToDelete.id],
        ['a', `${INTEREST_SET_KIND}:${pubkey}:${identifier}`],
      ]);
      const signedEvent = await this.nostrService.signEvent(event);

      // Save deletion event to database
      await this.database.saveEvent(signedEvent);

      // Remove from the shared signal immediately so all consumers see the change
      this.interestSets.update(sets => sets.filter(s => s.identifier !== identifier));

      // Publish deletion event
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Interest set deletion published:', {
        success: result.success,
        identifier,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error deleting interest set:', error);
      return false;
    }
  }

  /**
   * Reset interest set to default hashtags
   */
  async resetInterestSetToDefaults(): Promise<boolean> {
    return this.saveInterestSet([...DEFAULT_HASHTAGS], 'interests', 'My Interests');
  }

  /**
   * Get default hashtags
   */
  getDefaultHashtags(): string[] {
    return [...DEFAULT_HASHTAGS];
  }

  /**
   * Format a d-tag as a human-readable title
   * e.g., "interests-1234567890" -> "Interest List"
   * e.g., "interests" -> "My Interests"
   */
  private formatDTagAsTitle(dTag: string): string {
    if (dTag === 'interests') {
      return 'My Interests';
    }
    if (dTag.startsWith('interests-')) {
      return 'Interest List';
    }
    // Replace hyphens with spaces and capitalize
    return dTag
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
