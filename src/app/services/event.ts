import { Injectable, inject } from '@angular/core';
import { Event, kinds, nip19, Filter } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';
import { EventData } from '../data-resolver';
import { minutes, NostrRecord } from '../interfaces';
import { NoteEditorDialogData } from '../interfaces/note-editor';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { OnDemandUserDataService } from './on-demand-user-data.service';
import { Cache } from './cache';
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { SubscriptionCacheService } from './subscription-cache.service';
import { RelayPoolService } from './relays/relay-pool';
// CommentEditorDialogComponent is dynamically imported to break circular dependency
import type { CommentEditorDialogData } from '../components/comment-editor-dialog/comment-editor-dialog.component';
import { CustomDialogService, CustomDialogRef } from './custom-dialog.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AccountStateService } from './account-state.service';
import { AudioRecordDialogComponent } from '../pages/media/audio-record-dialog/audio-record-dialog.component';
import { MediaService } from './media.service';
import { AccountRelayService } from './relays/account-relay';
import { UnsignedEvent } from 'nostr-tools';
import { DatabaseService } from './database.service';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';
import { RepostService } from './repost.service';

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
  quotes: NostrRecord[];
}

export interface ThreadedEvent {
  event: Event;
  replies: ThreadedEvent[];
  level: number;
  hasMoreReplies?: boolean;
  deepestReplyId?: string;
}

export interface IntermediateEvent {
  id: string;
  author: string | null;
  relays: string[];
}

export interface EventTags {
  author: string | null; // Author of the root event
  replyAuthor: string | null; // Author of the reply event (5th element of reply e-tag)
  rootId: string | null;
  replyId: string | null;
  pTags: string[];
  rootRelays: string[];
  replyRelays: string[];
  pTagRelays: Map<string, string[]>; // Map of pubkey to relay hints from p-tags
  mentionIds: string[]; // Event IDs that are mentioned (not replies)
  intermediates: IntermediateEvent[]; // Intermediate events between root and reply (empty marker e-tags)
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
  private readonly database = inject(DatabaseService);
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
  private readonly repostService = inject(RepostService);

  /**
   * Parse event tags to extract thread information
   * According to NIP-10, e-tags can have markers: "root", "reply", or "mention"
   * Only "root" and "reply" (or unmarked positional tags) indicate actual thread participation
   * "mention" tags are references but not replies
   */
  getEventTags(event: Event): EventTags {
    const eTags = event.tags.filter((tag) => tag[0] === 'e');
    const pTagsRaw = event.tags.filter((tag) => tag[0] === 'p');
    const pTags = pTagsRaw.map((tag) => tag[1]);

    // Extract relay hints from p-tags: ["p", pubkey, relay-url]
    const pTagRelays = new Map<string, string[]>();
    pTagsRaw.forEach((tag) => {
      const pubkey = tag[1];
      const relayUrl = tag[2];
      if (pubkey && relayUrl && relayUrl.trim() !== '') {
        const existing = pTagRelays.get(pubkey) || [];
        if (!existing.includes(relayUrl)) {
          existing.push(relayUrl);
        }
        pTagRelays.set(pubkey, existing);
      }
    });

    let rootId: string | null = null;
    let replyId: string | null = null;
    let author: string | null = null;
    let replyAuthor: string | null = null;
    const rootRelays: string[] = [];
    const replyRelays: string[] = [];
    const mentionIds: string[] = [];
    const intermediates: IntermediateEvent[] = [];

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
        // Extract author pubkey from reply tag if present (5th element)
        replyAuthor = replyTag[4] || null;
        // Extract relay URL from reply tag if present (3rd element)
        if (replyTag[2] && replyTag[2].trim() !== '') {
          replyRelays.push(replyTag[2]);
        }
      }
    } else if (threadTags.length > 0 && !rootTag) {
      // Fallback to positional format: assume replying to the last e tag (that's not a mention)
      const lastThreadTag = threadTags[threadTags.length - 1];
      replyId = lastThreadTag[1];
      // Extract author pubkey from last thread tag if present (5th element)
      replyAuthor = lastThreadTag[4] || null;
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

    // Collect intermediate events: e-tags with empty marker (not root, reply, or mention)
    // These are events in the thread chain between root and the direct reply
    // They appear when users copy the full thread history when replying
    if (rootId && replyId && rootId !== replyId) {
      threadTags.forEach((tag) => {
        const eventId = tag[1];
        const marker = tag[3];
        // Skip root, reply, and marked mentions - only collect empty/unmarked intermediate events
        if (eventId !== rootId && eventId !== replyId && (!marker || marker === '')) {
          const relays: string[] = [];
          if (tag[2] && tag[2].trim() !== '') {
            relays.push(tag[2]);
          }
          intermediates.push({
            id: eventId,
            author: tag[4] || null,
            relays,
          });
        }
      });

      if (intermediates.length > 0) {
        this.logger.info(`[getEventTags] Found ${intermediates.length} intermediate events for event ${event.id.slice(0, 16)}:`,
          intermediates.map(i => i.id.slice(0, 16))
        );
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

      // NOTE: We intentionally do NOT treat quotes as parent/root events.
      // Per NIP-18, quotes (q tags) are inline embeds, not thread relationships.
      // The quoted event is rendered inline in the content, so it should not
      // appear in the parent events list above the main event.
    }

    return { author, replyAuthor, rootId, replyId, pTags, rootRelays, replyRelays, pTagRelays, mentionIds, intermediates, quoteId, quoteAuthor, quoteRelays };
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
   * @param events - All reply events to process
   * @param rootEventId - The event ID to build the tree from
   * @param isViewingThreadRoot - Whether the user is viewing the actual thread root (OP)
   */
  buildThreadTree(events: Event[], rootEventId: string, isViewingThreadRoot = false): ThreadedEvent[] {
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
          // Only when viewing the thread root (OP), direct replies (level 0) are newest first
          // All other cases: oldest first for chronological conversation flow
          if (isViewingThreadRoot && level === 0) {
            return b.created_at - a.created_at; // Newest first for OP's direct replies
          } else {
            return a.created_at - b.created_at; // Oldest first for all other replies
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
   * Check if an event has been deleted by querying for kind 5 (deletion request) events.
   * Per NIP-09, a deletion request is valid if:
   * 1. It's a kind 5 event
   * 2. It contains an 'e' tag referencing the event to delete
   * 3. The pubkey of the deletion request matches the pubkey of the event being deleted
   * 
   * @param event The event to check for deletion
   * @returns The deletion request event if found and valid, null otherwise
   */
  async checkDeletionRequest(event: Event): Promise<Event | null> {
    try {
      // Query for kind 5 events that reference this event ID
      // and are authored by the same pubkey as the event
      const filter: Filter = {
        kinds: [kinds.EventDeletion], // kind 5
        authors: [event.pubkey],
        '#e': [event.id],
      };

      // Use account relays and any relays we know the author uses
      const relays = this.accountRelay.getRelayUrls();
      const authorRelays = await this.discoveryRelay.getUserRelayUrls(event.pubkey);
      const combinedRelays = [...new Set([...relays, ...authorRelays])];

      this.logger.debug(`[Deletion Check] Checking for deletion request for event ${event.id}`);

      const deletionEvents = await this.relayPool.query(combinedRelays, filter, 5000);

      if (deletionEvents && deletionEvents.length > 0) {
        // Validate the deletion request
        const deletionEvent = deletionEvents[0];

        // Check that the deletion event references this event in an 'e' tag
        const hasValidETag = deletionEvent.tags.some(
          tag => tag[0] === 'e' && tag[1] === event.id
        );

        if (hasValidETag && deletionEvent.pubkey === event.pubkey) {
          this.logger.info(`[Deletion Check] Found valid deletion request for event ${event.id}`, {
            deletionEventId: deletionEvent.id,
            content: deletionEvent.content || '(no reason given)',
          });
          return deletionEvent;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('[Deletion Check] Error checking for deletion request:', error);
      return null;
    }
  }

  /**
   * Check if an event has been deleted by querying for kind 5 (deletion request) events
   * when we only have the event ID (event was not found).
   * 
   * @param eventId The event ID to check for deletion
   * @returns The deletion request event if found, null otherwise
   */
  async checkDeletionRequestById(eventId: string): Promise<Event | null> {
    try {
      // Query for kind 5 events that reference this event ID
      // We don't know the author, so we can't filter by pubkey
      const filter: Filter = {
        kinds: [kinds.EventDeletion], // kind 5
        '#e': [eventId],
      };

      // Use account relays for the query
      const relays = this.accountRelay.getRelayUrls();

      this.logger.debug(`[Deletion Check] Checking for deletion request for event ID ${eventId}`);

      const deletionEvents = await this.relayPool.query(relays, filter, 5000);

      if (deletionEvents && deletionEvents.length > 0) {
        // Return the first deletion event found
        // Note: Without the original event, we can't fully validate the deletion
        // but finding any deletion request for this ID suggests it was deleted
        const deletionEvent = deletionEvents[0];

        this.logger.info(`[Deletion Check] Found deletion request for event ID ${eventId}`, {
          deletionEventId: deletionEvent.id,
          author: deletionEvent.pubkey,
          content: deletionEvent.content || '(no reason given)',
        });
        return deletionEvent;
      }

      return null;
    } catch (error) {
      this.logger.error('[Deletion Check] Error checking for deletion request by ID:', error);
      return null;
    }
  }

  /**
   * Delete an event from local database.
   * Used after successful deletion request or when a deletion request is found.
   * 
   * @param eventId The event ID to delete from local storage
   */
  async deleteEventFromLocalStorage(eventId: string): Promise<void> {
    try {
      await this.database.deleteEvent(eventId);
      this.logger.info(`[Deletion] Deleted event ${eventId} from local database`);
    } catch (error) {
      this.logger.error(`[Deletion] Error deleting event ${eventId} from local database:`, error);
    }
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
      const { kind, pubkey, identifier, relays: relayHints } = decoded.data;
      this.logger.info('Loading addressable event:', { kind, pubkey, identifier, relayHints });

      // Strategy for addressable events: Try multiple sources
      // 0. Relay hints (if provided) - fastest when available
      // 1. Local database
      // 2. Author's relays
      // 3. Account relays
      // 4. Discovery relays

      // Step 0: Try relay hints first if provided (with short timeout)
      if (relayHints && relayHints.length > 0) {
        this.logger.debug('Trying relay hints from naddr:', relayHints);
        try {
          const event = await this.relayPool.get(
            relayHints,
            {
              authors: [pubkey],
              kinds: [kind],
              '#d': [identifier],
            },
            2000 // Short timeout since we have specific hints
          );
          if (event) {
            this.logger.info('Loaded addressable event from relay hints:', event.id);
            await this.database.saveEvent(event);
            return event;
          }
          this.logger.debug('Addressable event not found via relay hints, falling back to normal flow');
        } catch (error) {
          this.logger.debug('Failed to fetch addressable event from relay hints:', error);
          // Continue with normal flow
        }
      }

      // Step 1: Check local database
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(pubkey, kind, identifier);
      if (cachedEvent) {
        this.logger.info('Loaded addressable event from local database:', cachedEvent.id);
        return cachedEvent;
      }

      // Step 2: Try author's relays via userDataService
      try {
        const event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kind,
          identifier,
          { cache: true, ttl: minutes.five, save: true }
        );

        if (event) {
          this.logger.info('Loaded addressable event from author relays:', event.event.id);
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading addressable event from author relays:', error);
      }

      // Step 3: Try account relays
      try {
        const event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kind,
          identifier,
          { cache: true, ttl: minutes.five, save: true }
        );

        if (event) {
          this.logger.info('Loaded addressable event from account relays:', event.event.id);
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading addressable event from account relays:', error);
      }

      // Step 4: Try discovery relays
      try {
        await this.discoveryRelay.load();
        const discoveryEvent = await this.discoveryRelay.getEventByPubkeyAndKindAndTag(
          pubkey,
          kind,
          { key: 'd', value: identifier }
        );

        if (discoveryEvent) {
          this.logger.info('Loaded addressable event from discovery relays:', discoveryEvent.id);
          await this.database.saveEvent(discoveryEvent);
          return discoveryEvent;
        }
      } catch (error) {
        this.logger.error('Error loading addressable event from discovery relays:', error);
      }

      this.logger.warn('Addressable event not found:', { kind, pubkey, identifier });
      return null;
    }

    // Handle regular events (nevent or note)
    if (decoded.type !== 'nevent' && decoded.type !== 'note') {
      this.logger.error('Unexpected decoded type:', decoded.type);
      return null;
    }

    // For 'note' type, decoded.data is just the hex string
    // For 'nevent' type, decoded.data is an object with id, author, and optionally relays
    const hex = decoded.type === 'note' ? decoded.data : decoded.data.id;
    const author = decoded.type === 'nevent' ? decoded.data.author : null;
    const relayHints = decoded.type === 'nevent' ? decoded.data.relays : undefined;

    // Check if we have cached event in item
    if (item?.event && item.event.id === hex) {
      this.logger.info('Using cached event from item');
      return item.event;
    }

    try {
      // Strategy: Try multiple sources in order of efficiency
      // 0. Relay hints (if provided in nevent) - fastest when available
      // 1. Local database (fastest, no network)
      // 2. Author's relays (if author provided in nevent) - most likely to have the event
      // 3. Account relays - for events from followed accounts
      // 4. Discovery relays - broad coverage fallback
      // This ensures we find events even if the author's relay list isn't discoverable

      // First, always check local database regardless of author
      const cachedEvent = await this.database.getEventById(hex);
      if (cachedEvent) {
        this.logger.info('Loaded event from local database:', cachedEvent.id);
        return cachedEvent;
      }

      // Try relay hints first if provided (with short timeout)
      if (relayHints && relayHints.length > 0) {
        this.logger.debug('Trying relay hints from nevent:', relayHints);
        try {
          const event = await this.relayPool.get(
            relayHints,
            { ids: [hex] },
            2000 // Short timeout since we have specific hints
          );
          if (event) {
            this.logger.info('Loaded event from relay hints:', event.id);
            await this.database.saveEvent(event);
            return event;
          }
          this.logger.debug('Event not found via relay hints, falling back to normal flow');
        } catch (error) {
          this.logger.debug('Failed to fetch from relay hints:', error);
          // Continue with normal flow
        }
      }

      if (author) {
        // Try to get from user data service with author pubkey
        try {
          const event = await this.userDataService.getEventById(author, hex, { cache: true, ttl: minutes.five, save: true });

          if (event) {
            this.logger.info('Loaded event from author relays:', event.event.id);
            return event.event;
          }
        } catch (error) {
          this.logger.error('Error loading event from user data service:', error);
        }
      }

      // Fallback: Try account relays
      // This helps when the author's relay list isn't discoverable but the event
      // is available on the current account's relays (e.g., for followed accounts)
      try {
        const event = await this.data.getEventById(hex, { cache: true, ttl: minutes.five, save: true });

        if (event) {
          this.logger.info('Loaded event from account relays:', event.event.id);
          return event.event;
        }
      } catch (error) {
        this.logger.error('Error loading event from account relays:', error);
      }

      // Final fallback: Try discovery relays
      // This provides broad coverage when all other methods fail
      try {
        // Ensure discovery relay is loaded (it lazy-loads on first use)
        await this.discoveryRelay.load();
        const discoveryEvent = await this.discoveryRelay.getEventById(hex);

        if (discoveryEvent) {
          this.logger.info('Loaded event from discovery relays:', discoveryEvent.id);
          // Save to database for future lookups
          await this.database.saveEvent(discoveryEvent);
          return discoveryEvent;
        }
      } catch (error) {
        this.logger.error('Error loading event from discovery relays:', error);
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
   * Uses both the profile's relays and the current account's relays to ensure
   * we discover all replies, even if the profile has private relays.
   */
  async loadReplies(eventId: string, pubkey: string): Promise<Event[]> {
    this.logger.info('loadReplies called with eventId:', eventId, 'pubkey:', pubkey);

    try {
      // Load replies (kind 1 events that reference this event)
      // Include account relays to discover replies that may not be on the profile's relays
      // Use save: true to persist to database for faster subsequent loads
      const replyRecords = await this.userDataService.getEventsByKindAndEventTag(pubkey, kinds.ShortTextNote, eventId, {
        cache: true,
        ttl: minutes.five,
        includeAccountRelays: true,
        save: true, // Persist to database for faster loading next time
      });

      // Extract events and filter to actual thread participants
      // NOTE: buildThreadTree() will do further filtering to only include downstream descendants
      // but we pre-filter here to improve performance and exclude obvious non-replies
      const replies = replyRecords
        .map((record: NostrRecord) => record.event)
        .filter((event: Event) => {
          // Filter out events with empty content
          if (!event.content || !event.content.trim()) return false;

          // Use getEventTags to properly parse the thread relationship
          // Only include events that are actually part of the thread (not just mentions)
          const eventTags = this.getEventTags(event);
          const { rootId, replyId, mentionIds } = eventTags;

          // If this event only mentions the target event (not a thread relationship), exclude it
          if (mentionIds.includes(eventId) && rootId !== eventId && replyId !== eventId) {
            return false;
          }

          // Include if it has any thread relationship to the target event
          return rootId === eventId || replyId === eventId;
        });

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
   * This is more efficient than calling loadReactions, loadReposts, and loadReports separately.
   * Uses both the profile's relays and the current account's relays to ensure
   * we discover all interactions, even if the profile has private relays.
   */
  async loadEventInteractions(
    eventId: string,
    eventKind: number,
    pubkey: string,
    invalidateCache = false,
    skipReplies = false,
  ): Promise<EventInteractions> {
    this.logger.info('loadEventInteractions called with eventId:', eventId, 'pubkey:', pubkey, 'skipReplies:', skipReplies);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    // Include skipReplies in cache key since different queries return different data
    const cacheKey = `interactions-${eventId}-${pubkey}-${skipReplies ? 'no-replies' : 'with-replies'}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<EventInteractions>(
      cacheKey,
      [eventId], // eventIds array
      'interactions', // subscription type
      async () => {
        try {
          // Determine the repost kind based on the event kind
          const repostKind = eventKind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost;

          // Build the list of kinds to query
          // Skip ShortTextNote (replies) if the caller already has reply count from parent
          const kindsToQuery = skipReplies
            ? [kinds.Reaction, repostKind, kinds.Report]
            : [kinds.Reaction, repostKind, kinds.Report, kinds.ShortTextNote];

          // Fetch all interaction types in a single query
          // Include account relays to discover interactions that may not be on the profile's relays
          // Use save: true to persist to database for faster subsequent loads
          const allRecords = await this.userDataService.getEventsByKindsAndEventTag(
            pubkey,
            kindsToQuery,
            eventId,
            {
              cache: true,
              ttl: minutes.five,
              invalidateCache,
              includeAccountRelays: true,
              save: true, // Persist to database for faster loading next time
            },
          );

          // Separate events by kind
          const reactionRecords = allRecords.filter((r) => r.event.kind === kinds.Reaction);
          const repostRecords = allRecords.filter((r) => r.event.kind === repostKind);
          const reportRecords = allRecords.filter((r) => r.event.kind === kinds.Report);

          // Count replies only if we didn't skip them
          // When skipReplies is true, the caller already has the reply count from parent
          let replyCount = 0;
          if (!skipReplies) {
            // Count replies (kind 1 events that are actual thread replies to this event)
            // IMPORTANT: An event having an e-tag referencing this event doesn't mean it's a reply!
            // It could be a mention, quote, or reply to a different event in the thread.
            // We must use getEventTags to determine if this event actually REPLIES to this specific event.
            const replyRecords = allRecords.filter((r) => {
              if (r.event.kind !== kinds.ShortTextNote) return false;

              // Filter out events with empty content (same as loadReplies)
              if (!r.event.content || !r.event.content.trim()) return false;

              // Use getEventTags to properly parse the thread relationship
              const eventTags = this.getEventTags(r.event);
              const { rootId, replyId } = eventTags;

              // An event is a direct reply to this event if:
              // 1. replyId matches this event (explicit reply marker), OR
              // 2. rootId matches this event AND no replyId (direct reply to root with no explicit reply marker)
              // Note: If replyId is set to a DIFFERENT event, this is NOT a direct reply to us,
              // it's a reply to that other event (even if rootId matches us as the thread root)
              return replyId === eventId || (rootId === eventId && !replyId);
            });
            replyCount = replyRecords.length;
          }

          // Process reactions
          const reactionCounts = new Map<string, number>();
          reactionRecords.forEach((record: NostrRecord) => {
            const event = record.event;
            if (event.content && event.content.trim()) {
              const emoji = event.content.trim();
              reactionCounts.set(emoji, (reactionCounts.get(emoji) || 0) + 1);
            }
          });

          // Process reports - only accept valid NIP-56 report types
          const reportCounts = new Map<string, number>();
          const validReportRecords: NostrRecord[] = [];

          reportRecords.forEach((record: NostrRecord) => {
            const event = record.event;
            const eTags = event.tags.filter((tag: string[]) => tag[0] === 'e' && tag[1] === eventId);

            let hasValidReportType = false;
            eTags.forEach((tag: string[]) => {
              const reportType = tag[2]?.trim().toLowerCase();
              if (reportType && this.VALID_REPORT_TYPES.has(reportType)) {
                reportCounts.set(reportType, (reportCounts.get(reportType) || 0) + 1);
                hasValidReportType = true;
              }
            });

            // Only include records with valid report types
            if (hasValidReportType) {
              validReportRecords.push(record);
            }
          });

          this.logger.info(
            'Successfully loaded event interactions:',
            eventId,
            'reactions:',
            reactionRecords.length,
            'reposts:',
            repostRecords.length,
            'reports:',
            validReportRecords.length,
            '(filtered',
            reportRecords.length - validReportRecords.length,
            'invalid)',
            'replies:',
            skipReplies ? 'skipped' : replyCount,
          );

          // Note: Quotes are loaded separately via loadQuotes() since they use 'q' tag, not 'e' tag
          return {
            reactions: {
              events: reactionRecords,
              data: reactionCounts,
            },
            reposts: repostRecords,
            reports: {
              events: validReportRecords,
              data: reportCounts,
            },
            replyCount, // 0 if skipReplies was true (caller should use replyCountFromParent)
            quotes: [], // Quotes are loaded separately
          };
        } catch (error) {
          this.logger.error('Error loading event interactions:', error);
          return {
            reactions: { events: [], data: new Map() },
            reposts: [],
            reports: { events: [], data: new Map() },
            replyCount: 0,
            quotes: [],
          };
        }
      },
    );

    return cachedResult;
  }

  /**
   * Load reactions for an event.
   * Uses both the profile's relays and the current account's relays to ensure
   * we discover all reactions, even if the profile has private relays.
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
          // Include account relays to discover reactions that may not be on the profile's relays
          const reactionRecords = await this.userDataService.getEventsByKindAndEventTag(
            pubkey,
            kinds.Reaction,
            eventId,
            {
              cache: true,
              save: true,
              ttl: minutes.five,
              invalidateCache,
              includeAccountRelays: true,
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
   * Valid report types according to NIP-56
   */
  private readonly VALID_REPORT_TYPES = new Set([
    'nudity',
    'malware',
    'profanity',
    'illegal',
    'spam',
    'impersonation',
    'other',
  ]);

  /**
   * Load reports for an event.
   * Uses both the profile's relays and the current account's relays to ensure
   * we discover all reports, even if the profile has private relays.
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
      // Include account relays to discover reports that may not be on the profile's relays
      const reportRecords = await this.userDataService.getEventsByKindAndEventTag(pubkey, kinds.Report, eventId, {
        cache: true,
        save: true,
        ttl: minutes.five,
        invalidateCache,
        includeAccountRelays: true,
      });

      // Filter and count reports by type from tags (NIP-56)
      // Only accept valid report types according to NIP-56
      const reportCounts = new Map<string, number>();
      const validReportRecords: NostrRecord[] = [];

      reportRecords.forEach((record: NostrRecord) => {
        const event = record.event;

        // Look for report type in e-tags that reference this event
        const eTags = event.tags.filter((tag: string[]) => tag[0] === 'e' && tag[1] === eventId);

        let hasValidReportType = false;
        eTags.forEach((tag: string[]) => {
          // Report type is the 3rd element (index 2) in the tag according to NIP-56
          const reportType = tag[2]?.trim().toLowerCase();
          if (reportType && this.VALID_REPORT_TYPES.has(reportType)) {
            reportCounts.set(reportType, (reportCounts.get(reportType) || 0) + 1);
            hasValidReportType = true;
          }
        });

        // Only include records with valid report types
        if (hasValidReportType) {
          validReportRecords.push(record);
        }
      });

      this.logger.info(
        'Successfully loaded reports for event:',
        eventId,
        'report types:',
        Array.from(reportCounts.keys()),
        'filtered:',
        reportRecords.length - validReportRecords.length,
        'invalid reports',
      );

      return {
        events: validReportRecords,
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
   *
   * This method also uses relay hints from event tags to improve discovery
   * of parent events, especially when the original author has private relays.
   */
  async loadParentEvents(event: Event, eventTags?: EventTags): Promise<Event[]> {
    const parents: Event[] = [];

    // Only load parent events for kind 1 (ShortTextNote) - replies in threads
    // Other kinds like reposts (kind 6/16) have e-tags but should not show parent events
    // as they render the referenced event via their own repost display logic
    if (event.kind !== kinds.ShortTextNote) {
      return parents;
    }

    const tags = eventTags ?? this.getEventTags(event);
    const { author: initialAuthor, replyAuthor, rootId, replyId, pTags, rootRelays, replyRelays, pTagRelays, intermediates } = tags;

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

    /**
     * Collect relay hints for a given event author.
     * Combines relay hints from e-tags (root/reply) with p-tag relay hints for the author.
     */
    const collectRelayHints = (eventRelays: string[], authorPubkey: string | null): string[] => {
      const hints: string[] = [...eventRelays];

      // Add relay hints from p-tags for this author
      if (authorPubkey && pTagRelays.has(authorPubkey)) {
        const pRelays = pTagRelays.get(authorPubkey)!;
        pRelays.forEach(relay => {
          if (!hints.includes(relay)) {
            hints.push(relay);
          }
        });
      }

      return hints;
    };

    try {
      // Special case: Single unmarked e-tag (deprecated NIP-10 positional format)
      // When rootId === replyId, this is a direct reply to that single event.
      // Some clients don't follow NIP-10 marked format and only include one e-tag.
      // We need to load that event as the parent.
      if (rootId && rootId === replyId) {
        const singleParentHints = collectRelayHints([...rootRelays, ...replyRelays], author);

        this.logger.info(`[loadParentEvents] Loading single parent event ${rootId.slice(0, 16)} (deprecated NIP-10 format) with author ${author?.slice(0, 8)} and hints:`, singleParentHints);

        const singleParentEvent = await this.loadParentEvent(rootId, author, singleParentHints);

        if (singleParentEvent) {
          this.logger.info(`[loadParentEvents] Successfully loaded single parent event ${rootId.slice(0, 16)}`);
          parents.unshift(singleParentEvent);

          // Recursively load parents of this event to get the full thread chain
          const grandParents = await this.loadParentEvents(singleParentEvent);
          parents.unshift(...grandParents);
        } else {
          this.logger.warn(`[loadParentEvents] Failed to load single parent event ${rootId.slice(0, 16)}`);
        }

        // Sort parents by created_at to ensure proper chronological order
        parents.sort((a, b) => a.created_at - b.created_at);

        this.logger.info(`[loadParentEvents] Returning ${parents.length} parent events (single parent case):`,
          parents.map(p => ({ id: p.id.slice(0, 16), created_at: p.created_at }))
        );

        return parents;
      }

      // Load immediate parent (reply)
      if (replyId && replyId !== rootId) {
        // Use replyAuthor if available, otherwise fall back to author
        const replyEventAuthor = replyAuthor || author;
        const replyHints = collectRelayHints(replyRelays, replyEventAuthor);

        this.logger.info(`[loadParentEvents] Loading reply parent ${replyId.slice(0, 16)} with author ${replyEventAuthor?.slice(0, 8)} and hints:`, replyHints);

        const replyEvent = await this.loadParentEvent(replyId, replyEventAuthor, replyHints);

        if (replyEvent) {
          this.logger.info(`[loadParentEvents] Successfully loaded reply event ${replyId.slice(0, 16)}`);
          parents.unshift(replyEvent);

          // Recursively load parents of the reply
          const grandParents = await this.loadParentEvents(replyEvent);
          parents.unshift(...grandParents);
        } else {
          this.logger.warn(`[loadParentEvents] Failed to load reply event ${replyId.slice(0, 16)}`);
        }
      } else {
        this.logger.info(`[loadParentEvents] No reply to load. replyId=${replyId?.slice(0, 16)}, rootId=${rootId?.slice(0, 16)}`);
      }

      // Load intermediate events (those with empty markers between root and reply)
      // These are thread chain events that may not be captured by recursive loading
      if (intermediates && intermediates.length > 0) {
        this.logger.info(`[loadParentEvents] Loading ${intermediates.length} intermediate events:`,
          intermediates.map(i => ({ id: i.id.slice(0, 16), author: i.author?.slice(0, 8), relays: i.relays }))
        );

        for (const intermediate of intermediates) {
          // Skip if already loaded (from recursive parent loading)
          if (parents.find((p) => p.id === intermediate.id)) {
            this.logger.debug(`[loadParentEvents] Skipping intermediate ${intermediate.id.slice(0, 16)} - already loaded`);
            continue;
          }

          const intermediateHints = collectRelayHints(intermediate.relays, intermediate.author);
          const intermediateEvent = await this.loadParentEvent(
            intermediate.id,
            intermediate.author || author,
            intermediateHints
          );

          if (intermediateEvent) {
            this.logger.info(`[loadParentEvents] Loaded intermediate event ${intermediate.id.slice(0, 16)}`);
            // Insert intermediate events after root but before reply
            // Find the position of the reply event (which should be last)
            const replyIndex = parents.findIndex((p) => p.id === replyId);
            if (replyIndex > 0) {
              // Insert before the reply
              parents.splice(replyIndex, 0, intermediateEvent);
            } else {
              // If no reply found yet, just add to the list
              parents.push(intermediateEvent);
            }
          } else {
            this.logger.warn(`[loadParentEvents] Failed to load intermediate event ${intermediate.id.slice(0, 16)}`);
          }
        }
      }

      // Load root event if different from reply
      if (rootId && rootId !== replyId) {
        const rootHints = collectRelayHints(rootRelays, author);

        this.logger.info(`[loadParentEvents] Loading root event ${rootId.slice(0, 16)} with hints:`, rootHints);

        const rootEvent = await this.loadParentEvent(rootId, author, rootHints);

        if (rootEvent && !parents.find((p) => p.id === rootEvent.id)) {
          parents.unshift(rootEvent);
        }
      }

      // Sort parents by created_at to ensure proper chronological order
      // This is important because intermediate events may be loaded out of order
      parents.sort((a, b) => a.created_at - b.created_at);

      this.logger.info(`[loadParentEvents] Returning ${parents.length} parent events:`,
        parents.map(p => ({ id: p.id.slice(0, 16), created_at: p.created_at }))
      );

      return parents;
    } catch (error) {
      console.error('Error loading parent events:', error);
      return [];
    }
  }

  /**
   * Load a parent event which could be either a regular event (hex ID) or an addressable event (kind:pubkey:d-tag)
   * @param eventRef The event ID or addressable event reference (kind:pubkey:d-tag)
   * @param author The author pubkey to use for discovering relays
   * @param relayHints Optional relay hints from event tags to try first
   */
  private async loadParentEvent(eventRef: string, author: string, relayHints?: string[]): Promise<Event | null> {
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
      // First, try relay hints if provided (these are from e-tag and p-tag relay hints)
      if (relayHints && relayHints.length > 0) {
        this.logger.info(`[loadParentEvent] Trying relay hints first for event ${eventRef.slice(0, 16)}:`, relayHints);
        try {
          const event = await this.relayPool.getEventById(relayHints, eventRef, 3000);
          if (event) {
            this.logger.info(`[loadParentEvent] Found event ${eventRef.slice(0, 16)} via relay hints`);
            return event;
          }
          this.logger.info(`[loadParentEvent] Event ${eventRef.slice(0, 16)} not found via relay hints, falling back to author relays`);
        } catch (error) {
          this.logger.warn(`[loadParentEvent] Error querying relay hints:`, error);
        }
      }

      // Fall back to using author's relays
      this.logger.info(`[loadParentEvent] Trying author ${author?.slice(0, 8)} relays for event ${eventRef.slice(0, 16)}`);
      const record = await this.userDataService.getEventById(author, eventRef, {
        cache: true,
        ttl: minutes.five,
        save: true,  // This enables checking the local database first
      });

      if (record) {
        this.logger.info(`[loadParentEvent] Found event ${eventRef.slice(0, 16)} via author relays or database`);
      } else {
        this.logger.warn(`[loadParentEvent] Event ${eventRef.slice(0, 16)} NOT FOUND via author ${author?.slice(0, 8)} relays or database`);
      }

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

    // Load replies and reactions
    // For nested events, load from BOTH thread root AND current event to catch:
    // 1. Proper NIP-10 replies (with root marker pointing to thread root)
    // 2. Simple replies (with just an e-tag pointing to current event, no root marker)
    let replies: Event[];
    let reactions: Reaction[];

    if (!isThreadRoot && threadRootId !== event.id) {
      const [threadRootData, currentEventReplies] = await Promise.all([
        this.loadRepliesAndReactions(threadRootId, rootEvent?.pubkey || event.pubkey),
        this.loadReplies(event.id, event.pubkey),
      ]);

      // Merge and deduplicate replies by event ID
      const seenIds = new Set<string>();
      replies = [...threadRootData.replies, ...currentEventReplies].filter((reply) => {
        if (seenIds.has(reply.id)) return false;
        seenIds.add(reply.id);
        return true;
      });
      reactions = threadRootData.reactions;
    } else {
      const data = await this.loadRepliesAndReactions(threadRootId, event.pubkey);
      replies = data.replies;
      reactions = data.reactions;
    }

    // Filter out parent events from replies to avoid duplication
    const parentEventIds = new Set(parents.map((p) => p.id));
    // Also exclude the current event itself from replies
    parentEventIds.add(event.id);

    const filteredReplies = replies.filter((reply) => !parentEventIds.has(reply.id));

    // Build threaded structure starting from the current event
    // Pass isThreadRoot so sorting is correct: newest first only for OP's direct replies
    const threadedReplies = this.buildThreadTree(filteredReplies, event.id, isThreadRoot);

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

    // Check if this is a repost event - if so, we need to load reactions/replies
    // for the reposted content, not the repost event itself
    const isRepost = this.repostService.isRepostEvent(event);
    let targetEventId = event.id;
    let targetEventPubkey = event.pubkey;

    if (isRepost) {
      // Try to get the reposted event from embedded content first
      const repostedRecord = this.repostService.decodeRepost(event);
      if (repostedRecord?.event) {
        targetEventId = repostedRecord.event.id;
        targetEventPubkey = repostedRecord.event.pubkey;
      } else {
        // Fallback to e-tag reference
        const reference = this.repostService.getRepostReference(event);
        if (reference) {
          targetEventId = reference.eventId;
          if (reference.pubkey) {
            targetEventPubkey = reference.pubkey;
          }
        }
      }
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

    // Start loading replies and reactions for the target event (reposted content for reposts)
    const currentEventRepliesPromise = this.loadReplies(targetEventId, targetEventPubkey);
    const currentEventReactionsPromise = this.loadReactions(targetEventId, targetEventPubkey);

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
      // - For reposts: just load replies for the reposted content (targetEventId)
      // - If this is the thread root, just load direct replies
      // - If this is a nested event, load replies from BOTH the thread root AND the current event
      //   This ensures we catch:
      //   1. Proper NIP-10 replies (with root marker pointing to thread root)
      //   2. Simple replies (with just an e-tag pointing to current event, no root marker)
      let finalReactionsPromise = currentEventReactionsPromise;
      let replies: Event[] = [];

      if (isRepost) {
        // For reposts, just load replies for the reposted content
        replies = await currentEventRepliesPromise;
      } else if (!isThreadRoot && threadRootId !== event.id) {
        // Load replies from both thread root and current event in parallel
        const [threadRootReplies, currentEventReplies] = await Promise.all([
          this.loadReplies(threadRootId, rootEvent?.pubkey || event.pubkey),
          currentEventRepliesPromise,
        ]);

        // Merge and deduplicate replies by event ID
        const seenIds = new Set<string>();
        replies = [...threadRootReplies, ...currentEventReplies].filter((reply) => {
          if (seenIds.has(reply.id)) return false;
          seenIds.add(reply.id);
          return true;
        });

        finalReactionsPromise = this.loadReactions(threadRootId, rootEvent?.pubkey || event.pubkey);
      } else {
        // Thread root - just load direct replies
        replies = await currentEventRepliesPromise;
      }

      // Only filter out parent events and current event from the flat replies list
      const parentEventIds = new Set(parents.map((p) => p.id));
      parentEventIds.add(event.id);
      // For reposts, also filter out the repost event itself from replies
      if (isRepost) {
        parentEventIds.add(targetEventId);
      }

      const filteredReplies = replies.filter((reply) => !parentEventIds.has(reply.id));

      // Prefetch profiles for all reply authors - await to ensure cache is populated
      // before components try to render. This loads from storage quickly.
      await this.prefetchProfilesForReplies(filteredReplies, parents);

      // Build thread tree starting from the target event (reposted content for reposts)
      // This will only include downstream descendants of the target event
      // Pass isThreadRoot so sorting is correct: newest first only for OP's direct replies
      const threadedReplies = this.buildThreadTree(filteredReplies, targetEventId, isRepost || isThreadRoot);

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

        // Prefetch profiles for reply authors - await to ensure cache is populated
        await this.prefetchProfilesForReplies(filteredReplies, []);

        // Pass isThreadRoot so sorting is correct: newest first only for OP's direct replies
        const threadedReplies = this.buildThreadTree(filteredReplies, event.id, isThreadRoot);

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
          // Include account relays to discover reposts that may not be on the profile's relays
          const reposts = await this.userDataService.getEventsByKindAndEventTag(userPubkey, repostKind, eventId, {
            save: false,
            cache: true,
            invalidateCache,
            includeAccountRelays: true,
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

  /**
   * Load quotes for an event (NIP-18 quote reposts with 'q' tag)
   * Queries for kind 1 events that have a 'q' tag referencing this event
   */
  async loadQuotes(
    eventId: string,
    userPubkey: string,
    invalidateCache = false,
  ): Promise<NostrRecord[]> {
    this.logger.info('loadQuotes called with eventId:', eventId, 'userPubkey:', userPubkey);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    const cacheKey = `quotes-${eventId}-${userPubkey}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<NostrRecord[]>(
      cacheKey,
      [eventId], // eventIds array
      'quotes', // subscription type
      async () => {
        try {
          // Quotes are kind 1 events with a 'q' tag referencing this event
          const quotes = await this.userDataService.getEventsByKindAndQuoteTag(userPubkey, [kinds.ShortTextNote], eventId, {
            save: false,
            cache: true,
            invalidateCache,
            includeAccountRelays: true,
          });

          this.logger.info(
            'Successfully loaded quotes for event:',
            eventId,
            'count:',
            quotes.length,
          );
          return quotes;
        } catch (error) {
          this.logger.error('Error loading quotes for event:', eventId, error);
          return [];
        }
      },
    );

    return cachedResult;
  }

  /**
   * NIP-41: Load edit events (kind 1010) for a kind:1 short note
   * Returns the most recent edit event from the same author, or null if no edits exist
   * @param eventId The ID of the original kind:1 event
   * @param eventPubkey The pubkey of the original event author (edits must come from same author)
   * @param invalidateCache Whether to force reload from relays
   */
  async loadLatestEdit(
    eventId: string,
    eventPubkey: string,
    invalidateCache = false,
  ): Promise<NostrRecord | null> {
    this.logger.info('loadLatestEdit called for event:', eventId);

    // Handle cache invalidation if requested
    if (invalidateCache) {
      this.subscriptionCache.invalidateEventCache([eventId]);
    }

    // Use subscription cache to prevent duplicate subscriptions
    const cacheKey = `edit-${eventId}`;
    const cachedResult = await this.subscriptionCache.getOrCreateSubscription<NostrRecord | null>(
      cacheKey,
      [eventId],
      'edit',
      async () => {
        try {
          // Kind 1010 is the edit event kind per NIP-41
          const editKind = 1010;
          const edits = await this.userDataService.getEventsByKindAndEventTag(
            eventPubkey,
            editKind,
            eventId,
            {
              save: false,
              cache: true,
              invalidateCache,
              includeAccountRelays: true,
            }
          );

          // Filter to only edits from the same author (CRITICAL per NIP-41)
          const authorEdits = edits.filter(record => record.event.pubkey === eventPubkey);

          if (authorEdits.length === 0) {
            return null;
          }

          // Sort by created_at descending and return the most recent
          authorEdits.sort((a, b) => b.event.created_at - a.event.created_at);

          this.logger.info(
            'Found edits for event:',
            eventId,
            'count:',
            authorEdits.length,
            'latest:',
            authorEdits[0].event.created_at
          );

          return authorEdits[0];
        } catch (error) {
          this.logger.error('Error loading edits for event:', eventId, error);
          return null;
        }
      },
    );

    return cachedResult;
  }

  // Handler methods for different creation types
  async createNote(data: NoteEditorDialogData = {}): Promise<void> {
    // Dynamically import NoteEditorDialogComponent to avoid circular dependency
    const { NoteEditorDialogComponent } = await import('../components/note-editor-dialog/note-editor-dialog.component');

    // Determine dialog title based on context
    let title = 'Create Note';
    if (data.replyTo) {
      title = 'Reply to Note';
    } else if (data.quote) {
      title = 'Quote Note';
    }

    // Open note editor dialog using custom dialog service
    const dialogRef = this.customDialog.open<typeof NoteEditorDialogComponent.prototype, { published: boolean; event?: Event }>(
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

  async createComment(rootEvent: Event): Promise<{ published: boolean; event?: Event } | undefined> {
    // Dynamically import CommentEditorDialogComponent to break circular dependency
    const { CommentEditorDialogComponent } = await import('../components/comment-editor-dialog/comment-editor-dialog.component');

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

    return new Promise((resolve) => {
      dialogRef.afterClosed().subscribe((result) => {
        if (result?.published) {
          console.log('Comment published successfully:', result.event);
        }
        resolve(result);
      });
    });
  }

  async createCommentReply(rootEvent: Event, parentComment: Event): Promise<{ published: boolean; event?: Event } | undefined> {
    // Dynamically import CommentEditorDialogComponent to break circular dependency
    const { CommentEditorDialogComponent } = await import('../components/comment-editor-dialog/comment-editor-dialog.component');

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

    return new Promise((resolve) => {
      dialogRef.afterClosed().subscribe((result) => {
        if (result?.published) {
          console.log('Comment reply published successfully:', result.event);
        }
        resolve(result);
      });
    });
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

  /**
   * Prefetch profiles for all reply authors and parent authors.
   * This loads profiles from cache/storage into memory cache BEFORE rendering,
   * ensuring instant display for all thread participants.
   * 
   * The method awaits loading from cache/storage (fast) but fetches from relays
   * in background (slow) to avoid blocking thread display.
   * 
   * @param replies All reply events in the thread
   * @param parents Parent events in the thread chain
   */
  private async prefetchProfilesForReplies(replies: Event[], parents: Event[]): Promise<void> {
    // Collect unique pubkeys from replies and parents
    const authorPubkeys = new Set<string>();

    for (const reply of replies) {
      if (reply.pubkey) {
        authorPubkeys.add(reply.pubkey);
      }
    }

    for (const parent of parents) {
      if (parent.pubkey) {
        authorPubkeys.add(parent.pubkey);
      }
    }

    const pubkeysArray = Array.from(authorPubkeys);
    if (pubkeysArray.length === 0) return;

    this.logger.debug(`[Thread Prefetch] Prefetching ${pubkeysArray.length} profiles for thread participants`);

    try {
      // Load from cache/storage quickly, fetch missing from relays in background
      // skipRelayFetch=true means we return immediately after cache/storage check
      // and relay fetch happens in background (non-blocking)
      const results = await this.data.batchLoadProfiles(pubkeysArray, undefined, true);
      this.logger.debug(`[Thread Prefetch] Loaded ${results.size}/${pubkeysArray.length} profiles from cache/storage`);
    } catch (err) {
      this.logger.error('[Thread Prefetch] Error prefetching profiles:', err);
    }
  }
}
