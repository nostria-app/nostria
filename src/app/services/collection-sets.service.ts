import { Injectable, inject } from '@angular/core';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';

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

export interface EmojiSet {
  identifier: string; // d-tag
  name: string;
  emojis: string[]; // shortcodes or emoji characters
  eventId: string;
  created_at: number;
}

export interface InterestSet {
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

  /**
   * Get preferred emojis from user's emoji list (kind 10030)
   * This includes direct emoji characters from "emoji" tags
   */
  async getPreferredEmojis(pubkey: string): Promise<EmojiItem[]> {
    try {
      // Query for user's preferred emoji list (kind 10030)
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, PREFERRED_EMOJI_KIND);

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
      const emojis: EmojiItem[] = [];
      const referencedSets: string[] = [];

      for (const tag of latestEvent.tags) {
        // Handle direct emoji tags with shortcode and URL
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          // Format: ["emoji", shortcode, url]
          emojis.push({
            shortcode: tag[1],
            url: tag[2]
          });
        }
        // Handle references to emoji sets
        else if (tag[0] === 'a' && tag[1]) {
          referencedSets.push(tag[1]);
        }
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

              // Extract emojis from the referenced set
              for (const tag of refEvent.tags) {
                if (tag[0] === 'emoji' && tag[1] && tag[2]) {
                  emojis.push({
                    shortcode: tag[1],
                    url: tag[2]
                  });
                }
              }
            } else {
              this.logger.warn(`Referenced emoji set not found in database: ${ref}`);
            }
          }
        }
      }

      this.logger.info(`Extracted ${emojis.length} emojis from kind 10030:`, emojis);
      return emojis;
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
      // Query for all kind 30030 events
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, EMOJI_SET_KIND);
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
   * Get interest set for the current user (kind 30015)
   * Returns default hashtags if no event exists
   */
  async getInterestSet(pubkey: string): Promise<InterestSet | null> {
    try {
      // Try to get from database first
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, INTEREST_SET_KIND);

      // Find the "interests" identifier event
      const event = events.find(e => {
        const dTag = e.tags.find(tag => tag[0] === 'd')?.[1];
        return dTag === 'interests';
      });

      if (event) {
        this.logger.debug('Found kind 30015 interest set event');
        const hashtags = event.tags
          .filter(tag => tag[0] === 't' && tag[1])
          .map(tag => tag[1]);

        return {
          hashtags,
          eventId: event.id,
          created_at: event.created_at,
        };
      }

      // No event exists, return defaults
      this.logger.debug('No interest set found, using defaults');
      return {
        hashtags: [...DEFAULT_HASHTAGS],
        eventId: '',
        created_at: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      this.logger.error('Error loading interest set:', error);
      return {
        hashtags: [...DEFAULT_HASHTAGS],
        eventId: '',
        created_at: Math.floor(Date.now() / 1000),
      };
    }
  }

  /**
   * Save interest set (kind 30015)
   */
  async saveInterestSet(hashtags: string[]): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Build tags
      const tags: string[][] = [
        ['d', 'interests'],
      ];

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

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Interest set published:', {
        success: result.success,
        hashtagCount: hashtags.length,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving interest set:', error);
      return false;
    }
  }

  /**
   * Reset interest set to default hashtags
   */
  async resetInterestSetToDefaults(): Promise<boolean> {
    return this.saveInterestSet([...DEFAULT_HASHTAGS]);
  }

  /**
   * Get default hashtags
   */
  getDefaultHashtags(): string[] {
    return [...DEFAULT_HASHTAGS];
  }
}
