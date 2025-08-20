import { Injectable, inject } from '@angular/core';
import { Event, kinds, nip19, SimplePool } from 'nostr-tools';
import { DecodedNevent } from 'nostr-tools/nip19';
import { LoggerService } from './logger.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';
import { EventData } from '../data-resolver';
import { NostrRecord } from '../interfaces';
import { DiscoveryRelayServiceEx } from './relays/discovery-relay';
import { UserDataFactoryService } from './user-data-factory.service';
import { Cache } from './cache';
import { UserDataService } from './user-data.service';

export interface Reaction {
  emoji: string;
  count: number;
}

export interface ReactionEvents {
  events: NostrRecord[];
  data: Map<string, number>;
}

export interface ThreadedEvent {
  event: Event;
  replies: ThreadedEvent[];
  level: number;
  hasMoreReplies?: boolean;
  deepestReplyId?: string;
}

export interface EventTags {
  author: string | null;
  rootId: string | null;
  replyId: string | null;
  pTags: string[];
}

export interface ThreadData {
  event: Event;
  replies: Event[];
  threadedReplies: ThreadedEvent[];
  reactions: Reaction[];
  parents: Event[];
  isThreadRoot: boolean;
  rootEvent: Event | null;
}

@Injectable({
  providedIn: 'root',
})
export class EventService {
  private readonly logger = inject(LoggerService);
  private readonly data = inject(DataService);
  private readonly utilities = inject(UtilitiesService);
  private readonly nostrService = inject(NostrService);
  private readonly discoveryRelay = inject(DiscoveryRelayServiceEx);
  private readonly userDataFactory = inject(UserDataFactoryService);
  private readonly cache = inject(Cache);

  /**
   * Parse event tags to extract thread information
   */
  getEventTags(event: Event): EventTags {
    const eTags = event.tags.filter(tag => tag[0] === 'e');
    const pTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);

    let rootId: string | null = null;
    let replyId: string | null = null;
    let author: string | null = null;

    // Find root tag (NIP-10 marked format)
    const rootTag = eTags.find(tag => tag[3] === 'root');
    if (rootTag) {
      rootId = rootTag[1];
      // Extract author pubkey from root tag if present (5th element)
      author = rootTag[4] || null;
    }

    // Find reply tag (NIP-10 marked format)
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    if (replyTag) {
      replyId = replyTag[1];
    } else if (eTags.length > 0 && !rootTag) {
      // Fallback to positional format: assume replying to the last e tag
      replyId = eTags[eTags.length - 1][1];
    }

    // If no marked root but we have e-tags, use positional format
    if (!rootId && eTags.length > 0) {
      if (eTags.length === 1) {
        // Single e-tag is both root and reply
        rootId = eTags[0][1];
        replyId = eTags[0][1];
        // Extract author from the single e-tag if present
        author = eTags[0][4] || null;
      } else if (eTags.length >= 2) {
        // First e-tag is root in positional format
        rootId = eTags[0][1];
        // Extract author from the first e-tag if present
        author = eTags[0][4] || null;
      }
    }

    return { author, rootId, replyId, pTags };
  }

  /**
   * Build a threaded tree structure from events
   */
  buildThreadTree(
    events: Event[],
    rootEventId: string,
    maxDepth = 5
  ): ThreadedEvent[] {
    const eventMap = new Map<string, Event>();
    const childrenMap = new Map<string, Event[]>();

    // Build maps
    events.forEach(event => {
      eventMap.set(event.id, event);

      const { replyId } = this.getEventTags(event);
      const parentId = replyId || rootEventId;

      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(event);
    });

    // Build tree recursively with depth limit
    const buildNode = (eventId: string, level = 0): ThreadedEvent[] => {
      const children = childrenMap.get(eventId) || [];

      return children
        .sort((a, b) => a.created_at - b.created_at) // Sort by creation time
        .map(child => {
          const threadedEvent: ThreadedEvent = {
            event: child,
            replies: [],
            level,
          };

          // If we're at max depth, check if there are deeper replies
          if (level >= maxDepth - 1) {
            const hasDeepReplies =
              childrenMap.has(child.id) &&
              childrenMap.get(child.id)!.length > 0;
            if (hasDeepReplies) {
              threadedEvent.hasMoreReplies = true;
              threadedEvent.deepestReplyId = child.id;
            }
          } else {
            // Continue building the tree if we haven't reached max depth
            threadedEvent.replies = buildNode(child.id, level + 1);
          }

          return threadedEvent;
        });
    };

    return buildNode(rootEventId);
  }

  /**
   * Load a single event by ID or nevent using outbox model.
   */
  async loadEvent(nevent: string, item?: EventData): Promise<Event | null> {
    this.logger.info('loadEvent called with nevent:', nevent);

    let userData: UserDataService | undefined;

    // Handle hex string input
    if (this.utilities.isHex(nevent)) {
      this.logger.info('Input is hex string, encoding to nevent');
      nevent = nip19.neventEncode({ id: nevent }) as string;
      this.logger.info('Encoded to nevent:', nevent);
    }

    const decoded = this.utilities.decode(nevent) as DecodedNevent;
    const hex = decoded.data.id;
    this.logger.info('Decoded event ID:', hex, 'Author:', decoded.data.author);

    // If we have an author, we'll create a data factory for it.
    if (decoded.data.author) {
      userData = this.cache.get<UserDataService>(
        'user-data-' + decoded.data.author
      );

      if (!userData) {
        userData = await this.userDataFactory.create(decoded.data.author);

        this.cache.set('user-data-' + decoded.data.author, userData, {
          maxSize: 20,
          ttl: 1000 * 60,
        });
      }
    }

    // Check if we have cached event in item
    if (item?.event && item.event.id === hex) {
      this.logger.info('Using cached event from item');
      return item.event;
    }

    if (userData) {
      // Try to get from user data service first
      try {
        const event = await userData.getEventById(hex);

        if (event) {
          this.logger.info(
            'Loaded event from storage or relays:',
            event.event.id
          );
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading event from data service:', error);
      }
    } else {
      // Try to get from account data service.
      try {
        // Attempt to get from account relays.
        const event = await this.data.getEventById(hex);

        if (event) {
          this.logger.info(
            'Loaded event from storage or relays:',
            event.event.id
          );
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading event from data service:', error);
      }
    }

    return null;

    // Try to get from data service first
    // try {
    //   const event = await userData.getEventById(hex);
    //   if (event) {
    //     this.logger.info(
    //       'Loaded event from storage or relays:',
    //       event.event.id
    //     );
    //     return event.event;
    //   }
    // } catch (error) {
    //   this.logger.error('Error loading event from data service:', error);
    // }

    // Try to discover from author's relays
    // if (!decoded.data.author) {
    //   this.logger.info('No author in decoded data, cannot discover relays');
    //   throw new Error(
    //     'Event not found. There is no pubkey to discover the event from.'
    //   );
    // }

    // this.logger.info(
    //   'Discovering user relays for author:',
    //   decoded.data.author
    // );

    // Get user relays
    // let userRelays = await this.data.getUserRelays(decoded.data.author);

    // if (!userRelays || userRelays.length === 0) {
    //   this.logger.info(
    //     'No user relays found, attempting relay discovery via NostrService'
    //   );

    //   debugger;

    //   userRelays = await this.discoveryRelay.getUserRelayUrls(
    //     decoded.data.author
    //   );
    // }

    // if (!userRelays || userRelays.length === 0) {
    //   this.logger.info(
    //     'Still no user relays found after all discovery attempts'
    //   );
    //   throw new Error('No user relays found for the author.');
    // }

    // Fetch from user relays
    // const pool = new SimplePool();
    // try {
    //   this.logger.info(
    //     'Attempting to fetch event from user relays:',
    //     userRelays
    //   );
    //   const event = await pool.get(
    //     userRelays,
    //     { ids: [decoded.data.id] },
    //     { maxWait: 4000 }
    //   );

    //   if (!event) {
    //     this.logger.info('Event not found on user relays');
    //     throw new Error('Event not found on user relays.');
    //   }

    //   this.logger.info(
    //     'Successfully fetched event from user relays:',
    //     event.id
    //   );
    //   return event;
    // } finally {
    //   pool.destroy();
    // }
  }

  /**
   * Load replies for an event
   */
  async loadReplies(eventId: string, pubkey: string): Promise<Event[]> {
    this.logger.info(
      'loadReplies called with eventId:',
      eventId,
      'pubkey:',
      pubkey
    );

    let userData = this.cache.get<UserDataService>('user-data-' + pubkey);

    if (!userData) {
      userData = await this.userDataFactory.create(pubkey);

      this.cache.set('user-data-' + pubkey, userData, {
        maxSize: 20,
        ttl: 1000 * 60,
      });
    }

    try {
      // Load replies (kind 1 events that reference this event)
      const replyRecords = await userData.getEventsByKindAndEventTag(
        kinds.ShortTextNote,
        eventId,
        {
          save: false,
          cache: false,
        }
      );

      // Extract events from records and filter valid replies
      const replies = replyRecords
        .map(record => record.event)
        .filter(event => event.content && event.content.trim().length > 0);

      this.logger.info(
        'Successfully loaded replies for event:',
        eventId,
        'replies:',
        replies.length
      );

      return replies;
    } catch (error) {
      this.logger.error('Error loading replies:', error);
      return [];
    }
  }

  /**
   * Load reactions for an event
   */
  async loadReactions(
    eventId: string,
    pubkey: string
  ): Promise<ReactionEvents> {
    this.logger.info(
      'loadReactions called with eventId:',
      eventId,
      'pubkey:',
      pubkey
    );

    let userData = this.cache.get<UserDataService>('user-data-' + pubkey);

    if (!userData) {
      userData = await this.userDataFactory.create(pubkey);

      this.cache.set('user-data-' + pubkey, userData, {
        maxSize: 20,
        ttl: 1000 * 60,
      });
    }

    try {
      // Load reactions (kind 7 events that reference this event)
      const reactionRecords = await userData.getEventsByKindAndEventTag(
        kinds.Reaction,
        eventId,
        {
          save: false,
          cache: false,
        }
      );

      // Count reactions by emoji
      const reactionCounts = new Map<string, number>();
      reactionRecords.forEach(record => {
        const event = record.event;
        if (event.content && event.content.trim()) {
          const emoji = event.content.trim();
          reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1);
        }
      });

      const reactions = this.mapToReactionArray(reactionCounts);

      this.logger.info(
        'Successfully loaded reactions for event:',
        eventId,
        'reactions:',
        reactions.length
      );

      return {
        events: reactionRecords,
        data: reactionCounts,
      };
    } catch (error) {
      this.logger.error('Error loading reactions:', error);
      return { events: [], data: new Map() };
    }
  }

  /**
   * Load replies and reactions for an event
   * @deprecated Use loadReplies and loadReactions separately
   */
  async loadRepliesAndReactions(
    eventId: string,
    pubkey: string
  ): Promise<{ replies: Event[]; reactions: Reaction[] }> {
    this.logger.info(
      'loadRepliesAndReactions called with eventId:',
      eventId,
      'pubkey:',
      pubkey
    );

    const [replies, reactions] = await Promise.all([
      this.loadReplies(eventId, pubkey),
      this.loadReactions(eventId, pubkey),
    ]);

    return { replies, reactions: this.mapToReactionArray(reactions.data) };
  }

  /**
   * Load parent events in a thread using outbox model. Only the initially opened
   * reply is retrieved from user A relays. Everything else is fetched
   * from user B relays (root author).
   */
  async loadParentEvents(event: Event): Promise<Event[]> {
    const parents: Event[] = [];

    const {
      author: initialAuthor,
      rootId,
      replyId,
      pTags,
    } = this.getEventTags(event);

    let author = initialAuthor;

    if (!rootId && !replyId) {
      // This is a root event
      return parents;
    }

    if (!author) {
      this.logger.warn(
        'No author found for loading root event. Fallback to attempt using first p-tag.'
      );
      author = pTags[0];
    }

    let userData: UserDataService | undefined;

    userData = this.cache.get<UserDataService>('user-data-' + author);

    if (!userData) {
      userData = await this.userDataFactory.create(author);

      this.cache.set('user-data-' + author, userData, {
        maxSize: 20,
        ttl: 1000 * 60,
      });
    }

    try {
      // Load immediate parent (reply)
      if (replyId && replyId !== rootId) {
        const replyEvent = await userData.getEventById(replyId);

        if (replyEvent) {
          parents.unshift(replyEvent.event);

          // Recursively load parents of the reply
          const grandParents = await this.loadParentEvents(replyEvent.event);
          parents.unshift(...grandParents);
        }
      }

      // Load root event if different from reply
      if (rootId && rootId !== replyId) {
        const rootEvent = await userData.getEventById(rootId);

        if (rootEvent && !parents.find(p => p.id === rootEvent.event.id)) {
          parents.unshift(rootEvent.event);
        }
      }

      return parents;
    } catch (error) {
      console.error('Error loading parent events:', error);
      return [];
    }
  }

  /**
   * Load a complete thread with parents and children using outbox model.
   */
  async loadCompleteThread(
    nevent: string,
    item?: EventData
  ): Promise<ThreadData> {
    // Load the main event
    const event = await this.loadEvent(nevent, item);
    if (!event) {
      throw new Error('Event not found');
    }

    const { rootId, replyId } = this.getEventTags(event);
    const isThreadRoot = !rootId && !replyId;

    // Load parent events
    const parents = await this.loadParentEvents(event);

    // Determine the actual root event
    const rootEvent =
      parents.length > 0 ? parents[0] : isThreadRoot ? event : null;
    const threadRootId = rootEvent?.id || event.id;

    // Load replies and reactions for the thread root
    const { replies, reactions } = await this.loadRepliesAndReactions(
      threadRootId,
      event.pubkey
    );

    // Build threaded structure
    const threadedReplies = this.buildThreadTree(replies, threadRootId, 4);

    return {
      event,
      replies,
      threadedReplies,
      reactions,
      parents,
      isThreadRoot,
      rootEvent,
    };
  }

  /**
   * Convert reaction map to array format
   */
  private mapToReactionArray(reactionCounts: Map<string, number>): Reaction[] {
    return Array.from(reactionCounts.entries()).map(([emoji, count]) => ({
      emoji,
      count,
    }));
  }

  /**
   * Load reposts for an event by a specific user
   */
  async loadReposts(
    eventId: string,
    userPubkey: string
  ): Promise<NostrRecord[]> {
    this.logger.info(
      'loadReposts called with eventId:',
      eventId,
      'userPubkey:',
      userPubkey
    );

    let userData: UserDataService | undefined;

    userData = this.cache.get<UserDataService>('user-data-' + userPubkey);

    if (!userData) {
      userData = await this.userDataFactory.create(userPubkey);

      this.cache.set('user-data-' + userPubkey, userData, {
        maxSize: 20,
        ttl: 1000 * 60,
      });
    }

    try {
      const reposts = await userData.getEventsByKindAndEventTag(
        kinds.Repost,
        eventId,
        {
          save: false,
          cache: false, // cannot cache until we have stale-while-revalidate strategy implemented
        }
      );

      this.logger.info(
        'Successfully loaded reposts for event:',
        eventId,
        'count:',
        reposts.length
      );
      return reposts;
    } catch (error) {
      this.logger.error('Error loading reposts for event:', eventId, error);
      return [];
    }
  }
}
