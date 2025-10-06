import { Injectable, inject } from '@angular/core';
import { Event, kinds, nip19 } from 'nostr-tools';
import { DecodedNevent } from 'nostr-tools/nip19';
import { LoggerService } from './logger.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';
import { EventData } from '../data-resolver';
import { minutes, NostrRecord } from '../interfaces';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { Cache } from './cache';
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { SubscriptionCacheService } from './subscription-cache.service';
import {
  NoteEditorDialogComponent,
  NoteEditorDialogData,
} from '../components/note-editor-dialog/note-editor-dialog.component';
import { MatDialog } from '@angular/material/dialog';

export interface Reaction {
  emoji: string;
  count: number;
}

export interface ReactionEvents {
  events: NostrRecord[];
  data: Map<string, number>;
}

export interface ReportEvents {
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
  rootRelays: string[];
  replyRelays: string[];
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
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly userDataService = inject(UserDataService);
  private readonly onDemand = inject(OnDemandUserDataService);
  private readonly cache = inject(Cache);
  private readonly dialog = inject(MatDialog);
  private readonly relays = inject(RelaysService);
  private readonly subscriptionCache = inject(SubscriptionCacheService);


  /**
   * Parse event tags to extract thread information
   */
  getEventTags(event: Event): EventTags {
    const eTags = event.tags.filter((tag) => tag[0] === 'e');
    const pTags = event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]);

    let rootId: string | null = null;
    let replyId: string | null = null;
    let author: string | null = null;
    const rootRelays: string[] = [];
    const replyRelays: string[] = [];

    // Find root tag (NIP-10 marked format)
    const rootTag = eTags.find((tag) => tag[3] === 'root');
    if (rootTag) {
      rootId = rootTag[1];
      // Extract author pubkey from root tag if present (5th element)
      author = rootTag[4] || null;
      // Extract relay URL from root tag if present (3rd element)
      if (rootTag[2] && rootTag[2].trim() !== '') {
        rootRelays.push(rootTag[2]);
      }
    }

    // Find reply tag (NIP-10 marked format)
    const replyTag = eTags.find((tag) => tag[3] === 'reply');
    if (replyTag) {
      replyId = replyTag[1];
      // Extract relay URL from reply tag if present (3rd element)
      if (replyTag[2] && replyTag[2].trim() !== '') {
        replyRelays.push(replyTag[2]);
      }
    } else if (eTags.length > 0 && !rootTag) {
      // Fallback to positional format: assume replying to the last e tag
      const lastETag = eTags[eTags.length - 1];
      replyId = lastETag[1];
      // Extract relay URL from last e tag if present
      if (lastETag[2] && lastETag[2].trim() !== '') {
        replyRelays.push(lastETag[2]);
      }
    }

    // If no marked root but we have e-tags, use positional format
    if (!rootId && eTags.length > 0) {
      if (eTags.length === 1) {
        // Single e-tag is both root and reply
        rootId = eTags[0][1];
        replyId = eTags[0][1];
        // Extract author from the single e-tag if present
        author = eTags[0][4] || null;
        // Extract relay URL - use for both root and reply
        if (eTags[0][2] && eTags[0][2].trim() !== '') {
          const relayUrl = eTags[0][2];
          rootRelays.push(relayUrl);
          replyRelays.push(relayUrl);
        }
      } else if (eTags.length >= 2) {
        // First e-tag is root in positional format
        rootId = eTags[0][1];
        // Extract author from the first e-tag if present
        author = eTags[0][4] || null;
        // Extract relay URL from first e-tag (root)
        if (eTags[0][2] && eTags[0][2].trim() !== '') {
          rootRelays.push(eTags[0][2]);
        }
      }
    }

    return { author, rootId, replyId, pTags, rootRelays, replyRelays };
  }

  /**
   * Process an event and collect relay hints for storage
   */
  async processEventForRelayHints(event: Event): Promise<void> {
    // Skip kind 10002 events (user relay lists) as these should not be stored in the mapping
    if (event.kind === 10002) {
      return;
    }

    const { rootRelays, replyRelays, author } = this.getEventTags(event);
    const allRelayHints = [...rootRelays, ...replyRelays];

    if (allRelayHints.length > 0) {
      // Store hints for the event author if we know them
      if (author) {
        await this.relays.addRelayHintsFromEvent(author, allRelayHints);
      }

      // Store hints for the event creator
      await this.relays.addRelayHintsFromEvent(event.pubkey, allRelayHints);
    }
  }

  /**
   * Build a threaded tree structure from events
   */
  buildThreadTree(events: Event[], rootEventId: string, maxDepth = 5): ThreadedEvent[] {
    const eventMap = new Map<string, Event>();
    const childrenMap = new Map<string, Event[]>();

    // Build maps
    events.forEach((event) => {
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
        .sort((a, b) => {
          // Replies to root post (level 0): newest first (descending)
          // Replies to replies (level > 0): oldest first (ascending)
          if (level === 0) {
            return b.created_at - a.created_at; // Newest first for root replies
          } else {
            return a.created_at - b.created_at; // Oldest first for nested replies
          }
        })
        .map((child) => {
          const threadedEvent: ThreadedEvent = {
            event: child,
            replies: [],
            level,
          };

          // If we're at max depth, check if there are deeper replies
          if (level >= maxDepth - 1) {
            const hasDeepReplies =
              childrenMap.has(child.id) && childrenMap.get(child.id)!.length > 0;
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

    // Handle hex string input
    if (this.utilities.isHex(nevent)) {
      this.logger.info('Input is hex string, encoding to nevent');
      nevent = nip19.neventEncode({ id: nevent }) as string;
      this.logger.info('Encoded to nevent:', nevent);
    }

    const decoded = this.utilities.decode(nevent) as DecodedNevent;
    const hex = decoded.data.id;
    this.logger.info('Decoded event ID:', hex, 'Author:', decoded.data.author);

    // Check if we have cached event in item
    if (item?.event && item.event.id === hex) {
      this.logger.info('Using cached event from item');
      return item.event;
    }

    try {
      if (decoded.data.author) {
        // Try to get from user data service with author pubkey
        try {
          const event = await this.userDataService.getEventById(decoded.data.author, hex, { cache: true, ttl: minutes.five });

          if (event) {
            this.logger.info('Loaded event from storage or relays:', event.event.id);
            return event.event;
          }
        } catch (error) {
          this.logger.error('Error loading event from data service:', error);
        }
      } else {
        // Try to get from account data service.
        try {
          // Attempt to get from account relays.
          const event = await this.data.getEventById(hex, { cache: true, ttl: minutes.five });

          if (event) {
            this.logger.info('Loaded event from storage or relays:', event.event.id);
            return event.event;
          }
        } catch (error) {
          this.logger.error('Error loading event from data service:', error);
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error in getEventFromUrl:', error);
      return null;
    }
  }

  /**
   * Load replies for an event
   */
  async loadReplies(eventId: string, pubkey: string): Promise<Event[]> {
    this.logger.info('loadReplies called with eventId:', eventId, 'pubkey:', pubkey);

    try {
      // Load replies (kind 1 events that reference this event)
      const replyRecords = await this.userDataService.getEventsByKindAndEventTag(pubkey, kinds.ShortTextNote, eventId, {
        cache: true,
        ttl: minutes.five,
      });

      // Extract events from records and filter valid replies
      const replies = replyRecords
        .map((record: NostrRecord) => record.event)
        .filter((event: Event) => event.content && event.content.trim().length > 0);

      this.logger.info(
        'Successfully loaded replies for event:',
        eventId,
        'replies:',
        replies.length,
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
    pubkey: string,
    invalidateCache = false,
  ): Promise<ReactionEvents> {
    this.logger.info('loadReactions called with eventId:', eventId, 'pubkey:', pubkey);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    const cacheKey = `reactions-${eventId}-${pubkey}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<ReactionEvents>(
      cacheKey,
      [eventId], // eventIds array
      'reactions', // subscription type
      async () => {
        try {
          // Load reactions (kind 7 events that reference this event)
          const reactionRecords = await this.userDataService.getEventsByKindAndEventTag(
            pubkey,
            kinds.Reaction,
            eventId,
            {
              cache: true,
              ttl: minutes.five,
              invalidateCache,
            },
          );

          // Count reactions by emoji
          const reactionCounts = new Map<string, number>();
          reactionRecords.forEach((record: NostrRecord) => {
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
            reactions.length,
          );

          return {
            events: reactionRecords,
            data: reactionCounts,
          };
        } catch (error) {
          this.logger.error('Error loading reactions:', error);
          return { events: [], data: new Map() };
        }
      },
    );

    return cachedResult;
  }

  /**
   * Load reports for an event
   */
  async loadReports(
    eventId: string,
    pubkey: string,
    invalidateCache = false,
  ): Promise<ReportEvents> {
    this.logger.info('loadReports called with eventId:', eventId, 'pubkey:', pubkey);

    try {
      // Load reports (kind 1984 events that reference this event)
      const reportRecords = await this.userDataService.getEventsByKindAndEventTag(pubkey, kinds.Report, eventId, {
        cache: true,
        ttl: minutes.five,
        invalidateCache,
      });

      // Count reports by type from tags (NIP-56)
      const reportCounts = new Map<string, number>();
      reportRecords.forEach((record: NostrRecord) => {
        const event = record.event;

        // Look for report type in e-tags that reference this event
        const eTags = event.tags.filter((tag: string[]) => tag[0] === 'e' && tag[1] === eventId);

        eTags.forEach((tag: string[]) => {
          // Report type is the 3rd element (index 2) in the tag according to NIP-56
          const reportType = tag[2];
          if (reportType && reportType.trim()) {
            reportCounts.set(reportType, (reportCounts.get(reportType) || 0) + 1);
          }
        });

        // Also check p-tags for user reports (in case this is being used for user reports)
        // const pTags = event.tags.filter((tag) => tag[0] === 'p');
        // pTags.forEach((tag) => {
        //   const reportType = tag[2];
        //   if (reportType && reportType.trim()) {
        //     reportCounts.set(reportType, (reportCounts.get(reportType) || 0) + 1);
        //   }
        // });
      });

      this.logger.info(
        'Successfully loaded reports for event:',
        eventId,
        'report types:',
        Array.from(reportCounts.keys()),
      );

      return {
        events: reportRecords,
        data: reportCounts,
      };
    } catch (error) {
      this.logger.error('Error loading reports:', error);
      return { events: [], data: new Map() };
    }
  }

  /**
   * Load replies and reactions for an event
   * @deprecated Use loadReplies and loadReactions separately
   */
  async loadRepliesAndReactions(
    eventId: string,
    pubkey: string,
  ): Promise<{ replies: Event[]; reactions: Reaction[] }> {
    this.logger.info('loadRepliesAndReactions called with eventId:', eventId, 'pubkey:', pubkey);

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

    const { author: initialAuthor, rootId, replyId, pTags } = this.getEventTags(event);

    let author = initialAuthor;

    if (!rootId && !replyId) {
      // This is a root event
      return parents;
    }

    if (!author) {
      this.logger.warn(
        'No author found for loading root event. Fallback to attempt using first p-tag.',
      );
      author = pTags[0];
    }

    try {
      // Load immediate parent (reply)
      if (replyId && replyId !== rootId) {
        const replyEvent = await this.userDataService.getEventById(author, replyId, {
          cache: true,
          ttl: minutes.five,
        });

        if (replyEvent) {
          parents.unshift(replyEvent.event);

          // Recursively load parents of the reply
          const grandParents = await this.loadParentEvents(replyEvent.event);
          parents.unshift(...grandParents);
        }
      }

      // Load root event if different from reply
      if (rootId && rootId !== replyId) {
        const rootEvent = await this.userDataService.getEventById(author, rootId, {
          cache: true,
          ttl: minutes.five,
        });

        if (rootEvent && !parents.find((p) => p.id === rootEvent.event.id)) {
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
  async loadCompleteThread(nevent: string, item?: EventData): Promise<ThreadData> {
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
    const rootEvent = parents.length > 0 ? parents[0] : isThreadRoot ? event : null;
    const threadRootId = rootEvent?.id || event.id;

    // Load replies and reactions for the thread root
    const { replies, reactions } = await this.loadRepliesAndReactions(threadRootId, event.pubkey);

    // Filter out parent events from replies to avoid duplication
    const parentEventIds = new Set(parents.map((p) => p.id));
    // Also exclude the current event itself from replies
    parentEventIds.add(event.id);

    const filteredReplies = replies.filter((reply) => !parentEventIds.has(reply.id));

    // Build threaded structure starting from the current event
    const threadedReplies = this.buildThreadTree(filteredReplies, event.id, 4);

    return {
      event,
      replies: filteredReplies,
      threadedReplies,
      reactions,
      parents,
      isThreadRoot,
      rootEvent,
    };
  }

  /**
   * Load a thread progressively, yielding data as it becomes available
   */
  async *loadThreadProgressively(
    nevent: string,
    item?: EventData,
  ): AsyncGenerator<Partial<ThreadData>, ThreadData> {
    // First, load the main event
    const event = await this.loadEvent(nevent, item);
    if (!event) {
      throw new Error('Event not found');
    }

    const { rootId, replyId } = this.getEventTags(event);
    const isThreadRoot = !rootId && !replyId;

    // Yield the main event immediately
    yield {
      event,
      replies: [],
      threadedReplies: [],
      reactions: [],
      parents: [],
      isThreadRoot,
      rootEvent: null,
    };

    // Load parent events in the background
    const parentsPromise = this.loadParentEvents(event);

    // Start loading replies and reactions for the current event initially
    const currentEventRepliesPromise = this.loadReplies(event.id, event.pubkey);
    const currentEventReactionsPromise = this.loadReactions(event.id, event.pubkey);

    // Wait for parents first and yield updated data
    try {
      const parents = await parentsPromise;
      const rootEvent = parents.length > 0 ? parents[0] : isThreadRoot ? event : null;
      const actualThreadRootId = rootEvent?.id || event.id;

      // Yield with parent events
      yield {
        event,
        replies: [],
        threadedReplies: [],
        reactions: [],
        parents,
        isThreadRoot,
        rootEvent,
      };

      // Determine which replies to use based on thread structure
      let finalRepliesPromise = currentEventRepliesPromise;
      let finalReactionsPromise = currentEventReactionsPromise;

      // If this event is part of a larger thread, load replies for the root
      if (actualThreadRootId !== event.id) {
        finalRepliesPromise = this.loadReplies(
          actualThreadRootId,
          rootEvent?.pubkey || event.pubkey,
        );
        finalReactionsPromise = this.loadReactions(
          actualThreadRootId,
          rootEvent?.pubkey || event.pubkey,
        );
      }

      // Load replies and yield them as soon as available
      const replies = await finalRepliesPromise;

      // Only filter out parent events and current event from the flat replies list
      const parentEventIds = new Set(parents.map((p) => p.id));
      parentEventIds.add(event.id);

      const filteredReplies = replies.filter((reply) => !parentEventIds.has(reply.id));

      // Build thread tree starting from the current event, not the thread root
      // This will show replies TO the current event and its descendants
      const threadedReplies = this.buildThreadTree(filteredReplies, event.id, 4);

      yield {
        event,
        replies: filteredReplies,
        threadedReplies,
        reactions: [],
        parents,
        isThreadRoot,
        rootEvent,
      };

      // Finally wait for reactions and yield complete data
      const reactions = await finalReactionsPromise;
      const finalData: ThreadData = {
        event,
        replies: filteredReplies,
        threadedReplies,
        reactions: this.mapToReactionArray(reactions.data),
        parents,
        isThreadRoot,
        rootEvent,
      };

      return finalData;
    } catch (error) {
      this.logger.error('Error in progressive thread loading:', error);

      // Try to at least load replies for the current event
      try {
        const replies = await currentEventRepliesPromise;

        // Filter out the current event from replies
        const filteredReplies = replies.filter((reply) => reply.id !== event.id);
        const threadedReplies = this.buildThreadTree(filteredReplies, event.id, 4);

        const finalData: ThreadData = {
          event,
          replies: filteredReplies,
          threadedReplies,
          reactions: [],
          parents: [],
          isThreadRoot,
          rootEvent: isThreadRoot ? event : null,
        };

        return finalData;
      } catch {
        // Return minimal data if everything fails
        const finalData: ThreadData = {
          event,
          replies: [],
          threadedReplies: [],
          reactions: [],
          parents: [],
          isThreadRoot,
          rootEvent: isThreadRoot ? event : null,
        };

        return finalData;
      }
    }
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
    eventKind: number,
    userPubkey: string,
    invalidateCache = false,
  ): Promise<NostrRecord[]> {
    this.logger.info('loadReposts called with eventId:', eventId, 'userPubkey:', userPubkey);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    const cacheKey = `reposts-${eventId}-${userPubkey}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<NostrRecord[]>(
      cacheKey,
      [eventId], // eventIds array
      'reposts', // subscription type
      async () => {
        const repostKind = eventKind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost;

        try {
          const reposts = await this.userDataService.getEventsByKindAndEventTag(userPubkey, repostKind, eventId, {
            save: false,
            cache: true,
            invalidateCache,
          });

          this.logger.info(
            'Successfully loaded reposts for event:',
            eventId,
            'count:',
            reposts.length,
          );
          return reposts;
        } catch (error) {
          this.logger.error('Error loading reposts for event:', eventId, error);
          return [];
        }
      },
    );

    return cachedResult;
  }

  // Handler methods for different creation types
  createNote(data: NoteEditorDialogData = {}): void {
    // Open note editor dialog
    const dialogRef = this.dialog.open(NoteEditorDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      data,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.published) {
        console.log('Note published successfully:', result.event);
      }
    });
  }
}
