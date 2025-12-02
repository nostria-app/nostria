import { Injectable, inject } from '@angular/core';
import { Event, kinds, nip19, Filter } from 'nostr-tools';
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
import { RelayPoolService } from './relays/relay-pool';
import {
  NoteEditorDialogComponent,
  NoteEditorDialogData,
} from '../components/note-editor-dialog/note-editor-dialog.component';
import {
  CommentEditorDialogComponent,
  CommentEditorDialogData,
} from '../components/comment-editor-dialog/comment-editor-dialog.component';
import { CustomDialogService, CustomDialogRef } from './custom-dialog.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AccountStateService } from './account-state.service';
import { AudioRecordDialogComponent } from '../pages/media/audio-record-dialog/audio-record-dialog.component';
import { MediaService } from './media.service';
import { AccountRelayService } from './relays/account-relay';
import { UnsignedEvent } from 'nostr-tools';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';

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

export interface EventInteractions {
  reactions: ReactionEvents;
  reposts: NostrRecord[];
  reports: ReportEvents;
  replyCount: number;
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
  mentionIds: string[]; // Event IDs that are mentioned (not replies)
  quoteId: string | null; // Event ID from q tag (NIP-18)
  quoteAuthor: string | null; // Author pubkey from q tag
  quoteRelays: string[]; // Relay hints from q tag
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
  private readonly customDialog = inject(CustomDialogService);
  private readonly relays = inject(RelaysService);
  private readonly subscriptionCache = inject(SubscriptionCacheService);
  private readonly accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly mediaService = inject(MediaService);
  private readonly accountRelay = inject(AccountRelayService);

  /**
   * Parse event tags to extract thread information
   * According to NIP-10, e-tags can have markers: "root", "reply", or "mention"
   * Only "root" and "reply" (or unmarked positional tags) indicate actual thread participation
   * "mention" tags are references but not replies
   */
  getEventTags(event: Event): EventTags {
    const eTags = event.tags.filter((tag) => tag[0] === 'e');
    const pTags = event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]);

    let rootId: string | null = null;
    let replyId: string | null = null;
    let author: string | null = null;
    const rootRelays: string[] = [];
    const replyRelays: string[] = [];
    const mentionIds: string[] = [];

    // Separate mention tags from thread tags
    const mentionTags = eTags.filter((tag) => tag[3] === 'mention');
    const threadTags = eTags.filter((tag) => tag[3] !== 'mention');

    // Collect mention IDs
    mentionTags.forEach((tag) => {
      mentionIds.push(tag[1]);
    });

    // Find root tag (NIP-10 marked format)
    const rootTag = threadTags.find((tag) => tag[3] === 'root');
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
    const replyTag = threadTags.find((tag) => tag[3] === 'reply');
    if (replyTag) {
      // NIP-10 special case: if there's only a "reply" marker without a "root" marker,
      // treat the reply target as the root (some clients don't set root marker
      // when replying directly to the root event). In this case, don't set replyId
      // so that the parent loading logic correctly loads just the root event.
      if (!rootTag) {
        rootId = replyTag[1];
        // Extract author pubkey from reply tag if present (5th element),
        // otherwise use the first p tag as the author of the root event
        author = replyTag[4] || (pTags.length > 0 ? pTags[0] : null);
        // Use the relay for root
        if (replyTag[2] && replyTag[2].trim() !== '') {
          rootRelays.push(replyTag[2]);
        }
        // replyId stays null - this is a direct reply to root
      } else {
        // Normal case: we have both root and reply markers
        replyId = replyTag[1];
        // Extract relay URL from reply tag if present (3rd element)
        if (replyTag[2] && replyTag[2].trim() !== '') {
          replyRelays.push(replyTag[2]);
        }
      }
    } else if (threadTags.length > 0 && !rootTag) {
      // Fallback to positional format: assume replying to the last e tag (that's not a mention)
      const lastThreadTag = threadTags[threadTags.length - 1];
      replyId = lastThreadTag[1];
      // Extract relay URL from last thread tag if present
      if (lastThreadTag[2] && lastThreadTag[2].trim() !== '') {
        replyRelays.push(lastThreadTag[2]);
      }
    }

    // If no marked root but we have thread tags, use positional format (for unmarked tags)
    if (!rootId && threadTags.length > 0) {
      if (threadTags.length === 1) {
        // Single thread tag is both root and reply
        rootId = threadTags[0][1];
        replyId = threadTags[0][1];
        // Extract author from the single thread tag if present
        author = threadTags[0][4] || null;
        // Extract relay URL - use for both root and reply
        if (threadTags[0][2] && threadTags[0][2].trim() !== '') {
          const relayUrl = threadTags[0][2];
          rootRelays.push(relayUrl);
          replyRelays.push(relayUrl);
        }
      } else if (threadTags.length >= 2) {
        // First thread tag is root in positional format
        rootId = threadTags[0][1];
        // Extract author from the first thread tag if present
        author = threadTags[0][4] || null;
        // Extract relay URL from first thread tag (root)
        if (threadTags[0][2] && threadTags[0][2].trim() !== '') {
          rootRelays.push(threadTags[0][2]);
        }
      }
    }

    // Extract quote information from q tag (NIP-18)
    // q tag format: ["q", <event-id or addressable-event>, <relay-url>, <pubkey>]
    // For addressable events: "kind:pubkey:d-tag"
    let quoteId: string | null = null;
    let quoteAuthor: string | null = null;
    const quoteRelays: string[] = [];

    const qTag = event.tags.find((tag) => tag[0] === 'q');
    if (qTag) {
      quoteId = qTag[1] || null;

      // Extract relay URL from q tag if present (3rd element)
      if (qTag[2] && qTag[2].trim() !== '') {
        quoteRelays.push(qTag[2]);
      }

      // Extract author pubkey from q tag if present (4th element)
      quoteAuthor = qTag[3] || null;

      // If quoteId is in addressable event format (kind:pubkey:d-tag), extract the pubkey
      if (quoteId) {
        const addressableMatch = quoteId.match(/^(\d+):([0-9a-f]{64}):(.+)$/);
        if (addressableMatch && !quoteAuthor) {
          // Extract pubkey from addressable event identifier
          quoteAuthor = addressableMatch[2];
        }
      }

      // If we don't have a rootId from e-tags but we have a quote, use the quote as root
      if (!rootId && quoteId) {
        rootId = quoteId;
        author = quoteAuthor;
        if (quoteRelays.length > 0) {
          rootRelays.push(...quoteRelays);
        }
      }
    }

    return { author, rootId, replyId, pTags, rootRelays, replyRelays, mentionIds, quoteId, quoteAuthor, quoteRelays };
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
   * Build a threaded tree structure from events.
   * Only includes replies that are downstream of the rootEventId.
   * Filters out replies to other thread branches (e.g., replies to parent events).
   */
  buildThreadTree(events: Event[], rootEventId: string): ThreadedEvent[] {
    const childrenMap = new Map<string, Event[]>();

    // First pass: build parent-child relationships
    events.forEach((event) => {
      const { replyId, rootId } = this.getEventTags(event);

      // Determine the actual parent this event replies to:
      // 1. If replyId is set, use it (explicit reply marker)
      // 2. If no replyId but rootId matches our rootEventId, it's a direct reply to root
      // 3. Otherwise, skip this event (it belongs to a different branch)
      let parentId: string | null = null;

      if (replyId) {
        parentId = replyId;
      } else if (rootId === rootEventId) {
        // Direct reply to root (has root marker but no reply marker)
        parentId = rootEventId;
      }

      if (parentId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(event);
      }
    });

    // Build tree recursively starting from rootEventId - no depth limit
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
            replies: buildNode(child.id, level + 1),
            level,
          };

          return threadedEvent;
        });
    };

    return buildNode(rootEventId);
  }

  /**
   * Attempt deep resolution by searching batches of observed relays.
   * This is a fallback mechanism when normal event loading fails.
   * @param eventId The hex event ID to search for
   * @param onProgress Optional callback to report progress (currentBatch, totalBatches, relayUrls)
   * @returns The found event or null
   */
  async loadEventWithDeepResolution(
    eventId: string,
    onProgress?: (currentBatch: number, totalBatches: number, relayUrls: string[]) => void
  ): Promise<Event | null> {
    // debugger;
    const BATCH_SIZE = 10;

    // Get observed relays sorted by events received (most active first)
    const observedRelays = await this.relays.getObservedRelaysSorted('eventsReceived');

    if (observedRelays.length === 0) {
      this.logger.info('[Deep Resolution] No observed relays available');
      return null;
    }

    // Extract just the URLs
    const relayUrls = observedRelays.map(r => r.url);

    // Calculate number of batches
    const totalBatches = Math.ceil(relayUrls.length / BATCH_SIZE);

    this.logger.info(`[Deep Resolution] Starting deep resolution for event ${eventId}`, {
      totalRelays: relayUrls.length,
      batchSize: BATCH_SIZE,
      totalBatches,
    });

    // Process in batches
    for (let i = 0; i < totalBatches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, relayUrls.length);
      const batchRelays = relayUrls.slice(start, end);

      this.logger.info(`[Deep Resolution] Searching batch ${i + 1}/${totalBatches}`, {
        relays: batchRelays,
      });

      // Report progress
      if (onProgress) {
        onProgress(i + 1, totalBatches, batchRelays);
      }

      try {
        // Query this batch of relays
        const filter: Filter = { ids: [eventId] };
        const events = await this.relayPool.query(batchRelays, filter, 3000);

        if (events && events.length > 0) {
          this.logger.info(`[Deep Resolution] Event found in batch ${i + 1}/${totalBatches}!`, {
            eventId: events[0].id,
            relays: batchRelays,
          });
          return events[0];
        }
      } catch (error) {
        this.logger.error(`[Deep Resolution] Error querying batch ${i + 1}:`, error);
        // Continue to next batch even if this one fails
      }
    }

    this.logger.info('[Deep Resolution] Event not found after searching all batches');
    return null;
  }

  /**
   * Load a single event by ID or nevent using outbox model.
   */
  async loadEvent(nevent: string, item?: EventData): Promise<Event | null> {
    // this.logger.info('loadEvent called with nevent:', nevent);
    // Check if the input is in addressable event format: kind:pubkey:d-tag
    // This is used for parameterized replaceable events (kinds 30000-39999) like live events (30311)
    const addressableEventPattern = /^(\d+):([0-9a-f]{64}):(.+)$/;
    const addressableMatch = nevent.match(addressableEventPattern);

    if (addressableMatch) {
      const [, kindStr, pubkey, dTag] = addressableMatch;
      const kind = parseInt(kindStr, 10);

      this.logger.info('Input is addressable event format:', { kind, pubkey, dTag });

      // Encode as naddr for addressable events
      try {
        nevent = nip19.naddrEncode({
          kind,
          pubkey,
          identifier: dTag,
        });
        this.logger.info('Encoded to naddr:', nevent);
      } catch (error) {
        this.logger.error('Error encoding to naddr:', error);
        return null;
      }
    }

    // Handle hex string input
    if (this.utilities.isHex(nevent)) {
      this.logger.info('Input is hex string, encoding to nevent');

      try {
        nevent = nip19.neventEncode({ id: nevent }) as string;
        this.logger.info('Encoded to nevent:', nevent);
      } catch (error) {
        this.logger.error('Error encoding to nevent:', error);
        return null;
      }
    }

    const decoded = this.utilities.decode(nevent);

    // Handle addressable events (naddr)
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier } = decoded.data;
      this.logger.info('Loading addressable event:', { kind, pubkey, identifier });

      try {
        const event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kind,
          identifier,
          { cache: true, ttl: minutes.five, save: true }
        );

        if (event) {
          this.logger.info('Loaded addressable event from storage or relays:', event.event.id);
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading addressable event:', error);
      }

      return null;
    }

    // Handle regular events (nevent or note)
    if (decoded.type !== 'nevent' && decoded.type !== 'note') {
      this.logger.error('Unexpected decoded type:', decoded.type);
      return null;
    }

    // For 'note' type, decoded.data is just the hex string
    // For 'nevent' type, decoded.data is an object with id and author
    const hex = decoded.type === 'note' ? decoded.data : decoded.data.id;
    const author = decoded.type === 'nevent' ? decoded.data.author : null;
    // this.logger.info('Decoded event ID:', hex, 'Author:', author);

    // Check if we have cached event in item
    if (item?.event && item.event.id === hex) {
      this.logger.info('Using cached event from item');
      return item.event;
    }

    try {
      if (author) {
        // Try to get from user data service with author pubkey
        try {
          const event = await this.userDataService.getEventById(author, hex, { cache: true, ttl: minutes.five });

          if (event) {
            // this.logger.info('Loaded event from storage or relays:', event.event.id);
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
            // this.logger.info('Loaded event from storage or relays:', event.event.id);
            return event.event;
          }
        } catch (error) {
          this.logger.error('Error loading event from data service:', error);
        }
      }

      // If event not found through normal means, we return null.
      // Deep resolution should be triggered manually by the user in the UI.
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
   * Load event interactions (reactions, reposts, reports) in a single optimized query
   * This is more efficient than calling loadReactions, loadReposts, and loadReports separately
   */
  async loadEventInteractions(
    eventId: string,
    eventKind: number,
    pubkey: string,
    invalidateCache = false,
  ): Promise<EventInteractions> {
    this.logger.info('loadEventInteractions called with eventId:', eventId, 'pubkey:', pubkey);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    const cacheKey = `interactions-${eventId}-${pubkey}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<EventInteractions>(
      cacheKey,
      [eventId], // eventIds array
      'interactions', // subscription type
      async () => {
        try {
          // Determine the repost kind based on the event kind
          const repostKind = eventKind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost;

          // Fetch all interaction types including replies in a single query
          const allRecords = await this.userDataService.getEventsByKindsAndEventTag(
            pubkey,
            [kinds.Reaction, repostKind, kinds.Report, kinds.ShortTextNote],
            eventId,
            {
              cache: true,
              ttl: minutes.five,
              invalidateCache,
            },
          );

          // Separate events by kind
          const reactionRecords = allRecords.filter((r) => r.event.kind === kinds.Reaction);
          const repostRecords = allRecords.filter((r) => r.event.kind === repostKind);
          const reportRecords = allRecords.filter((r) => r.event.kind === kinds.Report);
          // Count replies (kind 1 events that reference this event)
          const replyRecords = allRecords.filter((r) => r.event.kind === kinds.ShortTextNote);

          // Process reactions
          const reactionCounts = new Map<string, number>();
          reactionRecords.forEach((record: NostrRecord) => {
            const event = record.event;
            if (event.content && event.content.trim()) {
              const emoji = event.content.trim();
              reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1);
            }
          });

          // Process reports
          const reportCounts = new Map<string, number>();
          reportRecords.forEach((record: NostrRecord) => {
            const event = record.event;
            const eTags = event.tags.filter((tag: string[]) => tag[0] === 'e' && tag[1] === eventId);
            eTags.forEach((tag: string[]) => {
              const reportType = tag[2];
              if (reportType && reportType.trim()) {
                reportCounts.set(reportType, (reportCounts.get(reportType) || 0) + 1);
              }
            });
          });

          this.logger.info(
            'Successfully loaded event interactions:',
            eventId,
            'reactions:',
            reactionRecords.length,
            'reposts:',
            repostRecords.length,
            'reports:',
            reportRecords.length,
            'replies:',
            replyRecords.length,
          );

          return {
            reactions: {
              events: reactionRecords,
              data: reactionCounts,
            },
            reposts: repostRecords,
            reports: {
              events: reportRecords,
              data: reportCounts,
            },
            replyCount: replyRecords.length,
          };
        } catch (error) {
          this.logger.error('Error loading event interactions:', error);
          return {
            reactions: { events: [], data: new Map() },
            reposts: [],
            reports: { events: [], data: new Map() },
            replyCount: 0,
          };
        }
      },
    );

    return cachedResult;
  }

  /**
   * Load reactions for an event
   * Note: For better performance when loading multiple interaction types,
   * consider using loadEventInteractions() which fetches reactions, reposts, and reports in a single query.
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
   * Note: For better performance when loading multiple interaction types,
   * consider using loadEventInteractions() which fetches reactions, reposts, and reports in a single query.
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
  async loadParentEvents(event: Event, eventTags?: EventTags): Promise<Event[]> {
    const parents: Event[] = [];

    const { author: initialAuthor, rootId, replyId, pTags } = eventTags ?? this.getEventTags(event);

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
        const replyEvent = await this.loadParentEvent(replyId, author);

        if (replyEvent) {
          parents.unshift(replyEvent);

          // Recursively load parents of the reply
          const grandParents = await this.loadParentEvents(replyEvent);
          parents.unshift(...grandParents);
        }
      }

      // Load root event if different from reply
      if (rootId && rootId !== replyId) {
        const rootEvent = await this.loadParentEvent(rootId, author);

        if (rootEvent && !parents.find((p) => p.id === rootEvent.id)) {
          parents.unshift(rootEvent);
        }
      }

      return parents;
    } catch (error) {
      console.error('Error loading parent events:', error);
      return [];
    }
  }

  /**
   * Load a parent event which could be either a regular event (hex ID) or an addressable event (kind:pubkey:d-tag)
   */
  private async loadParentEvent(eventRef: string, author: string): Promise<Event | null> {
    // Check if this is an addressable event reference (kind:pubkey:d-tag)
    const addressableMatch = eventRef.match(/^(\d+):([0-9a-f]{64}):(.+)$/);

    if (addressableMatch) {
      // This is an addressable event
      const [, kindStr, pubkey, dTag] = addressableMatch;
      const kind = parseInt(kindStr, 10);

      this.logger.info('Loading addressable parent event:', { kind, pubkey, dTag });

      const record = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        kind,
        dTag,
        { cache: true, ttl: minutes.five, save: true }
      );

      return record?.event || null;
    } else {
      // This is a regular event ID
      const record = await this.userDataService.getEventById(author, eventRef, {
        cache: true,
        ttl: minutes.five,
      });

      return record?.event || null;
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
    const threadedReplies = this.buildThreadTree(filteredReplies, event.id);

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

    const eventTags = this.getEventTags(event);
    const { rootId, replyId } = eventTags;
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

    // Load parent events in the background (pass eventTags to avoid parsing twice)
    const parentsPromise = this.loadParentEvents(event, eventTags);

    // Start loading replies and reactions for the current event initially
    const currentEventRepliesPromise = this.loadReplies(event.id, event.pubkey);
    const currentEventReactionsPromise = this.loadReactions(event.id, event.pubkey);

    // Wait for parents first and yield updated data
    try {
      const parents = await parentsPromise;
      const rootEvent = parents.length > 0 ? parents[0] : isThreadRoot ? event : null;
      const threadRootId = rootEvent?.id || event.id;

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

      // Determine which replies to load:
      // - If this is the thread root, just load direct replies
      // - If this is a nested event, load all replies to the thread root so we can
      //   build the complete downstream tree from the current event
      let finalRepliesPromise = currentEventRepliesPromise;
      let finalReactionsPromise = currentEventReactionsPromise;

      if (!isThreadRoot && threadRootId !== event.id) {
        // Load replies to the thread root to get the full thread tree
        finalRepliesPromise = this.loadReplies(threadRootId, rootEvent?.pubkey || event.pubkey);
        finalReactionsPromise = this.loadReactions(threadRootId, rootEvent?.pubkey || event.pubkey);
      }

      // Load replies and yield them as soon as available
      const replies = await finalRepliesPromise;

      // Only filter out parent events and current event from the flat replies list
      const parentEventIds = new Set(parents.map((p) => p.id));
      parentEventIds.add(event.id);

      const filteredReplies = replies.filter((reply) => !parentEventIds.has(reply.id));

      // Build thread tree starting from the current event
      // This will only include downstream descendants of the current event
      const threadedReplies = this.buildThreadTree(filteredReplies, event.id);

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
        const threadedReplies = this.buildThreadTree(filteredReplies, event.id);

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
   * Note: For better performance when loading multiple interaction types,
   * consider using loadEventInteractions() which fetches reactions, reposts, and reports in a single query.
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
    // Determine dialog title based on context
    let title = 'Create Note';
    if (data.replyTo) {
      title = 'Reply to Note';
    } else if (data.quote) {
      title = 'Quote Note';
    }

    // Open note editor dialog using custom dialog service
    const dialogRef = this.customDialog.open<NoteEditorDialogComponent, { published: boolean; event?: Event }>(
      NoteEditorDialogComponent,
      {
        title,
        headerIcon: this.accountState.profile()?.data?.picture || '',
        width: '680px',
        maxWidth: '95vw',
        disableClose: true,
        data,
      }
    );

    // Set the dialogRef and data on the component instance
    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.data = data;

    // Handle dialog close - using effect-like approach with signals
    const checkClosed = () => {
      const result = dialogRef.afterClosed()();
      if (result !== undefined) {
        if (result?.published) {
          console.log('Note published successfully:', result.event);
        }
      } else {
        // Keep checking if not closed yet
        setTimeout(checkClosed, 100);
      }
    };
    checkClosed();
  }

  createComment(rootEvent: Event): MatDialogRef<CommentEditorDialogComponent> {
    // Open comment editor dialog for NIP-22 comments
    const dialogRef = this.dialog.open(CommentEditorDialogComponent, {
      panelClass: 'responsive-dialog',
      width: '600px',
      maxWidth: '90vw',
      disableClose: true,
      data: {
        rootEvent,
      } as CommentEditorDialogData,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.published) {
        console.log('Comment published successfully:', result.event);
      }
    });

    return dialogRef;
  }

  createCommentReply(rootEvent: Event, parentComment: Event): MatDialogRef<CommentEditorDialogComponent> {
    // Open comment editor dialog for replying to a comment
    const dialogRef = this.dialog.open(CommentEditorDialogComponent, {
      panelClass: 'responsive-dialog',
      width: '600px',
      maxWidth: '90vw',
      disableClose: true,
      data: {
        rootEvent,
        parentComment,
      } as CommentEditorDialogData,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.published) {
        console.log('Comment reply published successfully:', result.event);
      }
    });

    return dialogRef;
  }

  async createAudioReply(rootEvent: Event): Promise<Event | undefined> {
    const dialogRef = this.dialog.open(AudioRecordDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    const result = await dialogRef.afterClosed().toPromise();

    if (result && result.blob) {
      // Confirm before publishing
      const confirmDialog = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Publish Audio Reply?',
          message: 'Are you sure you want to publish this audio reply?',
          confirmText: 'Publish',
          cancelText: 'Cancel',
          confirmColor: 'primary'
        }
      });

      const confirmed = await confirmDialog.afterClosed().toPromise();

      if (!confirmed) {
        return undefined;
      }

      try {
        // Upload file
        const file = new File([result.blob], 'voice-message.mp4', { type: result.blob.type });
        const uploadResult = await this.mediaService.uploadFile(
          file,
          false,
          this.mediaService.mediaServers()
        );

        if (uploadResult.status === 'success' && uploadResult.item) {
          const audioAttachment = {
            url: uploadResult.item.url,
            waveform: result.waveform,
            duration: Math.round(result.duration)
          };

          const pubkey = this.accountState.pubkey();
          if (!pubkey) return undefined;

          const unsignedEvent = this.buildCommentEvent(
            rootEvent,
            uploadResult.item.url,
            pubkey,
            undefined,
            audioAttachment
          );

          const signedEvent = await this.nostrService.signEvent(unsignedEvent);
          if (!signedEvent) return undefined;

          await this.accountRelay.publish(signedEvent);
          return signedEvent;
        }
      } catch (error) {
        console.error('Failed to create audio reply:', error);
      }
    }

    return undefined;
  }

  buildCommentEvent(
    rootEvent: Event,
    content: string,
    pubkey: string,
    parentComment?: Event,
    audioAttachment?: { url: string; waveform: number[]; duration: number }
  ): UnsignedEvent {
    const now = Math.floor(Date.now() / 1000);
    const tags: string[][] = [];

    // Determine if replying to a comment or the root event
    const isReplyingToComment = !!parentComment;

    // Check if root event is addressable (kind >= 30000 and < 40000)
    const isRootAddressable = rootEvent.kind >= 30000 && rootEvent.kind < 40000;

    if (isReplyingToComment && parentComment) {
      // Replying to a comment
      // Root scope tags (uppercase) - point to original event
      if (isRootAddressable) {
        // Use A tag for addressable events (like articles)
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['A', aTagValue, '', rootEvent.pubkey]);
      } else {
        // Use E tag for regular events
        tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - point to the comment being replied to
      tags.push(['e', parentComment.id, '', parentComment.pubkey]);
      tags.push(['k', parentComment.kind.toString()]);
      tags.push(['p', parentComment.pubkey]);
    } else {
      // Top-level comment on the event
      // Root scope tags (uppercase)
      if (isRootAddressable) {
        // Use A tag for addressable events (like articles)
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['A', aTagValue, '', rootEvent.pubkey]);
      } else {
        // Use E tag for regular events
        tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - same as root for top-level
      if (isRootAddressable) {
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['a', aTagValue, '', rootEvent.pubkey]);
      } else {
        tags.push(['e', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['k', rootEvent.kind.toString()]);
      tags.push(['p', rootEvent.pubkey]);
    }

    const kind = audioAttachment ? 1244 : 1111;

    if (audioAttachment) {
      const att = audioAttachment;
      const waveform = att.waveform.join(' ');
      tags.push(['imeta', `url ${att.url}`, `waveform ${waveform}`, `duration ${att.duration}`]);
      tags.push(['alt', 'Voice reply']);
    }

    return {
      kind,
      content,
      tags,
      created_at: now,
      pubkey,
    };
  }
}
