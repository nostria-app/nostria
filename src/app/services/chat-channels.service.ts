import { Injectable, inject, signal, computed } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { RelayPoolService } from './relays/relay-pool';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';
import { ReactionService } from './reaction.service';
import { ZapService } from './zap.service';
import { UserRelaysService } from './relays/user-relays';
import { AccountLocalStateService } from './account-local-state.service';
import { NostriaService } from '../interfaces';
import type { DeleteEventReferenceMode } from '../components/delete-confirmation-dialog/delete-confirmation-dialog.component';

/**
 * NIP-28 Event kinds for public chat channels
 */
export const CHANNEL_CREATE_KIND = 40;
export const CHANNEL_METADATA_KIND = 41;
export const CHANNEL_MESSAGE_KIND = 42;
export const CHANNEL_HIDE_MESSAGE_KIND = 43;
export const CHANNEL_MUTE_USER_KIND = 44;

/** Channel name prefixes that should be filtered out and never persisted */
const BLOCKED_CHANNEL_PREFIXES = ['openclaw-world-'];

/**
 * Metadata for a public chat channel
 */
export interface ChannelMetadata {
  name: string;
  about: string;
  picture: string;
  relays?: string[];
}

/**
 * A kind 41 metadata update event parsed for display
 */
export interface ChannelMetadataUpdate {
  /** Event ID of the kind 41 event */
  id: string;
  /** Pubkey of the updater (channel creator) */
  pubkey: string;
  /** Updated metadata */
  metadata: ChannelMetadata;
  /** Timestamp (seconds) */
  createdAt: number;
  /** Tags from the event */
  tags: string[];
}

/**
 * Represents a public chat channel
 */
export interface ChatChannel {
  /** Event ID of the kind 40 creation event */
  id: string;
  /** Pubkey of the channel creator */
  creator: string;
  /** Channel metadata (from kind 40 or latest kind 41) */
  metadata: ChannelMetadata;
  /** Original metadata from the kind 40 creation event */
  originalMetadata: ChannelMetadata;
  /** Timestamp of channel creation (seconds) */
  createdAt: number;
  /** Timestamp of last metadata update (seconds) */
  updatedAt: number;
  /** Number of messages loaded */
  messageCount: number;
  /** Tags/categories from kind 41 "t" tags */
  tags: string[];
  /** Original tags from the kind 40 creation event */
  originalTags: string[];
  /** Event ID of the latest kind 41 metadata update (if any) */
  metadataEventId?: string;
  /** All kind 41 metadata update events, sorted by timestamp */
  metadataUpdates: ChannelMetadataUpdate[];
}

/**
 * Reaction data for a channel message
 */
export interface ChatReaction {
  content: string;
  count: number;
  pubkeys: string[];
  userReacted: boolean;
}

/**
 * Represents a message in a public chat channel
 */
export interface ChannelMessage {
  /** Event ID of this message */
  id: string;
  /** Channel ID (kind 40 event ID) this message belongs to */
  channelId: string;
  /** Pubkey of the message author */
  pubkey: string;
  /** Message content */
  content: string;
  /** Timestamp (seconds) */
  createdAt: number;
  /** Event ID of the message this replies to (if any) */
  replyTo?: string;
  /** The raw nostr event */
  event: Event;
  /** Reactions on this message */
  reactions?: Map<string, ChatReaction>;
  /** Total zap amount in sats */
  zapTotal?: number;
  /** Number of zaps received */
  zapCount?: number;
}

/**
 * Service for managing NIP-28 public chat channels.
 *
 * Handles:
 * - Kind 40: Channel creation
 * - Kind 41: Channel metadata updates
 * - Kind 42: Channel messages
 * - Kind 43: Hide message (client-side moderation)
 * - Kind 44: Mute user (client-side moderation)
 */
@Injectable({
  providedIn: 'root',
})
export class ChatChannelsService implements NostriaService {
  private readonly nostrService = inject(NostrService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly discoveryRelay = inject(DiscoveryRelayService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly utilities = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);
  private readonly reactionService = inject(ReactionService);
  private readonly zapService = inject(ZapService);
  private readonly userRelaysService = inject(UserRelaysService);
  private readonly accountLocalState = inject(AccountLocalStateService);

  /** All known channels keyed by channel ID */
  private readonly channelsMap = signal<Map<string, ChatChannel>>(new Map());

  /** Messages keyed by channel ID */
  private readonly messagesMap = signal<Map<string, ChannelMessage[]>>(new Map());

  /** IDs of hidden messages (kind 43 from current user + channel owners) */
  private readonly hiddenMessageIds = signal<Set<string>>(new Set());

  /** Pubkeys of muted users (kind 44 from current user + channel owners) */
  private readonly mutedUserPubkeys = signal<Set<string>>(new Set());

  /** Channel IDs where the current user has sent messages (kind 42) */
  readonly participatedChannelIds = signal<Set<string>>(new Set());

  /** Loading state */
  readonly isLoading = signal(false);

  /** Loading state for messages in a specific channel */
  readonly isLoadingMessages = signal(false);

  /** Migration progress state */
  readonly isMigrating = signal(false);
  readonly migrationProgress = signal<string>('');

  /** Currently active channel subscription */
  private liveSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

  /** Currently active channel message subscription (account relays) */
  private messageSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

  /** Currently active channel message subscription (channel-specific relays) */
  private channelRelayMessageSubscription: { close: () => void } | null = null;

  /** Currently active reaction subscription */
  private reactionSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

  /** Currently active reaction subscription (channel-specific relays) */
  private channelRelayReactionSubscription: { close: () => void } | null = null;

  /** IDs of deleted messages (kind 5 deletion events) */
  private readonly deletedMessageIds = signal<Set<string>>(new Set());

  /** Dedup sets for reactions and deletions */
  private reactionIds = new Set<string>();
  private deletionIds = new Set<string>();
  private zapReceiptIds = new Set<string>();

  /** Quick reactions for the picker */
  readonly quickReactions = ['👍', '❤️', '😂', '🔥', '🎉', '👏'];

  /** Sorted list of all channels */
  readonly channels = computed(() => {
    const map = this.channelsMap();
    return Array.from(map.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  /** Get messages for a specific channel, excluding hidden and muted */
  getChannelMessages(channelId: string) {
    return computed(() => {
      const messages = this.messagesMap().get(channelId) ?? [];
      const hidden = this.hiddenMessageIds();
      const muted = this.mutedUserPubkeys();
      const deleted = this.deletedMessageIds();
      return messages
        .filter(m => !hidden.has(m.id) && !muted.has(m.pubkey) && !deleted.has(m.id))
        .sort((a, b) => a.createdAt - b.createdAt);
    });
  }

  /**
   * Load channels from local database cache for instant display.
   * Returns true if cached channels were found.
   */
  async loadChannelsFromCache(): Promise<boolean> {
    try {
      await this.database.init();

      // Load kind 40 channel creation events from local DB
      const channelEvents = await this.database.getEventsByKind(CHANNEL_CREATE_KIND);
      if (channelEvents.length === 0) return false;

      const channelMap = new Map<string, ChatChannel>();

      for (const event of channelEvents) {
        const channel = this.parseChannelCreateEvent(event);
        if (channel && !this.isBlockedChannelName(channel.metadata.name)) {
          channelMap.set(channel.id, channel);
        }
      }

      // Load kind 41 metadata updates from local DB
      if (channelMap.size > 0) {
        const metadataEvents = await this.database.getEventsByKind(CHANNEL_METADATA_KIND);
        for (const event of metadataEvents) {
          // Skip metadata events for blocked channel names
          if (this.isBlockedChannelEvent(event)) continue;
          this.applyMetadataUpdate(channelMap, event);
        }
      }

      if (channelMap.size > 0) {
        this.channelsMap.set(channelMap);
        this.logger.info('[ChatChannels] Loaded channels from cache:', channelMap.size);
      }

      // Load cached moderation data
      await this.loadModerationDataFromCache();

      return channelMap.size > 0;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load channels from cache', error);
      return false;
    }
  }

  /**
   * Load channels from relays and persist to local database
   */
  async load(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);

    try {
      const relayUrls = this.getRelayUrls();
      this.logger.info('[ChatChannels] Loading channels from relays:', relayUrls.length);

      // Fetch kind 40 channel creation events
      const rawChannelEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_CREATE_KIND], limit: 100 },
        { timeout: 10000 }
      );

      // Filter out blocked channel names before persisting or processing
      const channelEvents = rawChannelEvents.filter(e => !this.isBlockedChannelEvent(e));

      // Persist channel creation events to local DB
      if (channelEvents.length > 0) {
        this.database.saveEvents(channelEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache channel events', err)
        );
      }

      // Start from the current cached channels so we merge rather than replace
      const channelMap = new Map(this.channelsMap());

      for (const event of channelEvents) {
        const channel = this.parseChannelCreateEvent(event);
        if (channel) {
          channelMap.set(channel.id, channel);
        }
      }

      // Fetch kind 41 metadata updates for all discovered channels
      if (channelMap.size > 0) {
        const channelIds = Array.from(channelMap.keys());
        const rawMetadataEvents = await this.accountRelay.getMany<Event>(
          { kinds: [CHANNEL_METADATA_KIND], '#e': channelIds, limit: 500 },
          { timeout: 10000 }
        );

        // Filter out blocked channel names before persisting or processing
        const metadataEvents = rawMetadataEvents.filter(e => !this.isBlockedChannelEvent(e));

        // Persist metadata events to local DB
        if (metadataEvents.length > 0) {
          this.database.saveEvents(metadataEvents as (Event & { dTag?: string })[]).catch(err =>
            this.logger.error('[ChatChannels] Failed to cache metadata events', err)
          );
        }

        // Apply metadata updates - only from the channel creator
        for (const event of metadataEvents) {
          this.applyMetadataUpdate(channelMap, event);
        }

        // Also fetch kind 41 from channel-specific relays that aren't in account relays
        const channelOnlyRelays = this.getChannelOnlyRelayUrls(this.getAllChannelRelayUrls());
        if (channelOnlyRelays.length > 0) {
          try {
            const channelRelayMetadata = await this.relayPool.query(
              channelOnlyRelays,
              { kinds: [CHANNEL_METADATA_KIND], '#e': channelIds, limit: 500 },
              10000
            );

            const filteredChannelMetadata = channelRelayMetadata.filter(e => !this.isBlockedChannelEvent(e));
            if (filteredChannelMetadata.length > 0) {
              this.database.saveEvents(filteredChannelMetadata as (Event & { dTag?: string })[]).catch(err =>
                this.logger.error('[ChatChannels] Failed to cache channel-relay metadata events', err)
              );
            }

            for (const event of filteredChannelMetadata) {
              this.applyMetadataUpdate(channelMap, event);
            }
          } catch (err) {
            this.logger.warn('[ChatChannels] Failed to fetch metadata from channel-specific relays', err);
          }
        }
      }

      this.channelsMap.set(channelMap);
      this.logger.info('[ChatChannels] Loaded channels:', channelMap.size);

      // Load moderation data for authenticated user
      await this.loadModerationData();
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load channels', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Refresh channel metadata (kind 41) for all known channels.
   * Fetches the latest kind 41 events from both account relays and
   * each channel's own designated relays (from metadata.relays).
   * This ensures we always have the most up-to-date metadata,
   * even when the creator published updates only to the channel's relays.
   */
  async refreshChannelMetadata(): Promise<void> {
    const channelMap = new Map(this.channelsMap());
    if (channelMap.size === 0) return;

    const channelIds = Array.from(channelMap.keys());
    this.logger.info('[ChatChannels] Refreshing metadata for channels:', channelIds.length);

    try {
      // Step 1: Fetch kind 41 from account relays
      const accountMetadataEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_METADATA_KIND], '#e': channelIds, limit: 500 },
        { timeout: 10000 }
      );

      for (const event of accountMetadataEvents) {
        if (this.isBlockedChannelEvent(event)) continue;
        this.applyMetadataUpdate(channelMap, event);
      }

      // Persist to DB
      if (accountMetadataEvents.length > 0) {
        this.database.saveEvents(accountMetadataEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache refreshed metadata events', err)
        );
      }

      // Step 2: Fetch kind 41 from channel-specific relays (those not in account relays)
      const channelOnlyRelays = this.getChannelOnlyRelayUrls(this.getAllChannelRelayUrls());
      if (channelOnlyRelays.length > 0) {
        try {
          const channelRelayMetadataEvents = await this.relayPool.query(
            channelOnlyRelays,
            { kinds: [CHANNEL_METADATA_KIND], '#e': channelIds, limit: 500 },
            10000
          );

          for (const event of channelRelayMetadataEvents) {
            if (this.isBlockedChannelEvent(event)) continue;
            this.applyMetadataUpdate(channelMap, event);
          }

          // Persist to DB
          if (channelRelayMetadataEvents.length > 0) {
            this.database.saveEvents(channelRelayMetadataEvents as (Event & { dTag?: string })[]).catch(err =>
              this.logger.error('[ChatChannels] Failed to cache channel-relay metadata events', err)
            );
          }
        } catch (err) {
          this.logger.warn('[ChatChannels] Failed to fetch metadata from channel relays', err);
        }
      }

      this.channelsMap.set(channelMap);
      this.logger.info('[ChatChannels] Refreshed metadata for channels:', channelMap.size);
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to refresh channel metadata', error);
    }
  }

  /**
   * Load channel IDs where the current user has sent messages (kind 42).
   *
   * Uses the outbox model:
   * 1. Query the user's account relays for their kind 42 messages
   * 2. Extract channel IDs and relay hints from the "e" tags
   * 3. Connect to hinted relays to fetch the kind 40/41 channel events
   * 4. Add discovered channels to channelsMap so they appear in the list
   */
  async loadParticipatedChannels(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Step 1: Query account relays for user's kind 42 messages
      const events = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_MESSAGE_KIND], authors: [pubkey], limit: 500 },
        { timeout: 10000 }
      );

      // Step 2: Extract channel IDs and relay hints from "e" tags
      const channelIds = new Set<string>();
      // Map of channelId -> Set<relayHintUrl>
      const channelRelayHints = new Map<string, Set<string>>();

      for (const event of events) {
        // Find the root "e" tag (channel ID + relay hint)
        const rootTag = event.tags.find(
          t => t[0] === 'e' && (t[3] === 'root' || (!t[3] && t === event.tags.find(tag => tag[0] === 'e')))
        );
        if (!rootTag?.[1]) continue;

        const channelId = rootTag[1];
        channelIds.add(channelId);

        // Extract relay hint from position [2] of the "e" tag
        const relayHint = rootTag[2];
        if (relayHint) {
          if (!channelRelayHints.has(channelId)) {
            channelRelayHints.set(channelId, new Set());
          }
          channelRelayHints.get(channelId)!.add(relayHint);
        }
      }

      this.participatedChannelIds.set(channelIds);
      this.logger.info('[ChatChannels] Loaded participated channels:', channelIds.size);

      // Step 3: Find channel IDs not yet in channelsMap
      const missingChannelIds = Array.from(channelIds).filter(id => !this.channelsMap().has(id));
      if (missingChannelIds.length === 0) return;

      // Step 4: Group missing channels by relay hint and fetch kind 40/41 events
      // Collect all unique relay hints for missing channels
      const relayToChannelIds = new Map<string, string[]>();
      const channelsWithoutHints: string[] = [];

      for (const channelId of missingChannelIds) {
        const hints = channelRelayHints.get(channelId);
        if (hints && hints.size > 0) {
          for (const relay of hints) {
            if (!relayToChannelIds.has(relay)) {
              relayToChannelIds.set(relay, []);
            }
            relayToChannelIds.get(relay)!.push(channelId);
          }
        } else {
          channelsWithoutHints.push(channelId);
        }
      }

      // Fetch from hinted relays (grouped by relay URL for efficiency)
      const fetchPromises: Promise<void>[] = [];

      for (const [relayUrl, ids] of relayToChannelIds) {
        fetchPromises.push(this.fetchChannelsFromRelay([relayUrl], ids));
      }

      // For channels without relay hints, try account relays as fallback
      if (channelsWithoutHints.length > 0) {
        const accountRelayUrls = this.accountRelay.getRelayUrls();
        if (accountRelayUrls.length > 0) {
          fetchPromises.push(this.fetchChannelsFromRelay(accountRelayUrls, channelsWithoutHints));
        }
      }

      await Promise.allSettled(fetchPromises);

      this.logger.info(
        '[ChatChannels] Finished fetching participated channel metadata.',
        'Missing before:', missingChannelIds.length,
        'Still missing:', missingChannelIds.filter(id => !this.channelsMap().has(id)).length
      );
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load participated channels', error);
    }
  }

  /**
   * Fetch a channel's kind 40/41 events from the given relay URLs.
   * Public wrapper around fetchChannelsFromRelay for use when navigating
   * to a channel via nevent that includes relay hints.
   */
  async fetchChannelFromRelays(relayUrls: string[], channelId: string): Promise<void> {
    await this.fetchChannelsFromRelay(relayUrls, [channelId]);
  }

  /**
   * Fetch kind 40 (creation) and kind 41 (metadata) events for specific channel IDs
   * from the given relay URLs, then add them to channelsMap.
   */
  private async fetchChannelsFromRelay(relayUrls: string[], channelIds: string[]): Promise<void> {
    try {
      // Fetch kind 40 creation events by their event IDs
      const createEvents = await this.relayPool.query(
        relayUrls,
        { kinds: [CHANNEL_CREATE_KIND], ids: channelIds },
        8000
      );

      if (createEvents.length === 0) return;

      // Parse and add to channelsMap
      const channelMap = new Map(this.channelsMap());
      const foundIds: string[] = [];

      for (const event of createEvents) {
        if (this.isBlockedChannelEvent(event)) continue;
        if (channelMap.has(event.id)) continue;

        const channel = this.parseChannelCreateEvent(event);
        if (channel) {
          channelMap.set(channel.id, channel);
          foundIds.push(channel.id);

          // Cache the creation event locally
          this.database.saveEvent(event as Event & { dTag?: string }).catch(err =>
            this.logger.error('[ChatChannels] Failed to cache channel creation event', err)
          );
        }
      }

      if (foundIds.length > 0) {
        // Fetch kind 41 metadata updates for the channels we found
        const metadataFilter: Filter = {
          kinds: [CHANNEL_METADATA_KIND],
          '#e': foundIds,
        };

        try {
          const metadataEvents = await this.relayPool.query(relayUrls, metadataFilter, 6000);
          for (const event of metadataEvents) {
            if (this.isBlockedChannelEvent(event)) continue;
            this.applyMetadataUpdate(channelMap, event);

            // Cache metadata events locally
            this.database.saveEvent(event as Event & { dTag?: string }).catch(err =>
              this.logger.error('[ChatChannels] Failed to cache channel metadata event', err)
            );
          }
        } catch (err) {
          this.logger.warn('[ChatChannels] Failed to fetch metadata updates from hinted relays', err);
        }

        this.channelsMap.set(channelMap);
      }
    } catch (error) {
      this.logger.warn('[ChatChannels] Failed to fetch channels from relay', relayUrls, error);
    }
  }

  /**
   * Subscribe to new channel creation events (live updates)
   */
  subscribeToChannels(): void {
    this.closeChannelSubscription();

    const now = this.utilities.currentDate();
    const sub = this.accountRelay.subscribe<Event>(
      { kinds: [CHANNEL_CREATE_KIND, CHANNEL_METADATA_KIND], since: now },
      (event: Event) => {
        // Skip blocked channel names entirely - don't persist or process
        if (this.isBlockedChannelEvent(event)) return;

        // Persist live events to local DB
        this.database.saveEvent(event as Event & { dTag?: string }).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache live channel event', err)
        );

        if (event.kind === CHANNEL_CREATE_KIND) {
          const channel = this.parseChannelCreateEvent(event);
          if (channel) {
            this.channelsMap.update(map => {
              const updated = new Map(map);
              updated.set(channel.id, channel);
              return updated;
            });
          }
        } else if (event.kind === CHANNEL_METADATA_KIND) {
          this.channelsMap.update(map => {
            const updated = new Map(map);
            this.applyMetadataUpdate(updated, event);
            return updated;
          });
        }
      }
    );
    this.liveSubscription = sub;
  }

  /**
   * Load cached messages for a specific channel from IndexedDB.
   * Returns the loaded messages and the latest cached timestamp (or 0 if none).
   */
  private async loadChannelMessagesFromCache(channelId: string): Promise<{ messages: ChannelMessage[]; latestTimestamp: number }> {
    try {
      const cachedEvents = await this.database.getEventsByKindAndEventTag(CHANNEL_MESSAGE_KIND, channelId);
      const messages: ChannelMessage[] = [];
      let latestTimestamp = 0;

      for (const event of cachedEvents) {
        const msg = this.parseChannelMessage(event, channelId);
        if (msg) {
          messages.push(msg);
          if (msg.createdAt > latestTimestamp) {
            latestTimestamp = msg.createdAt;
          }
        }
      }

      this.logger.info('[ChatChannels] Loaded cached messages for channel:', channelId, messages.length);
      return { messages, latestTimestamp };
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load cached messages for channel:', channelId, error);
      return { messages: [], latestTimestamp: 0 };
    }
  }

  /**
   * Load messages for a specific channel.
   * First loads cached messages from IndexedDB for instant display,
   * then fetches newer messages from relays using a `since` filter
   * (last cached timestamp minus 10 minutes to handle clock drift).
   */
  async loadChannelMessages(channelId: string, limit = 50): Promise<void> {
    this.isLoadingMessages.set(true);

    try {
      // Step 1: Load cached messages from IndexedDB for instant display
      const { messages: cachedMessages, latestTimestamp } = await this.loadChannelMessagesFromCache(channelId);

      // Display cached messages immediately
      if (cachedMessages.length > 0) {
        this.messagesMap.update(map => {
          const updated = new Map(map);
          updated.set(channelId, cachedMessages);
          return updated;
        });
      }

      // Step 2: Build relay filter with `since` based on latest cached timestamp
      const filter: Filter = { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], limit };
      if (latestTimestamp > 0) {
        // Subtract 10 minutes (600 seconds) to handle clock drift between devices/relays
        filter.since = latestTimestamp - 600;
      }

      // Query account relays
      const events = await this.accountRelay.getMany<Event>(
        filter,
        { timeout: 10000 }
      );

      // Also query channel-specific relays (relays from channel metadata not in account relays)
      const channel = this.channelsMap().get(channelId);
      const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
      let channelRelayEvents: Event[] = [];
      if (channelOnlyRelays.length > 0) {
        try {
          channelRelayEvents = await this.relayPool.query(channelOnlyRelays, filter, 10000);
        } catch (err) {
          this.logger.warn('[ChatChannels] Failed to fetch messages from channel relays', err);
        }
      }

      const allEvents = [...events, ...channelRelayEvents];

      // Step 3: Cache fetched messages to IndexedDB
      if (allEvents.length > 0) {
        this.database.saveEvents(allEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache channel messages', err)
        );
      }

      // Step 4: Merge relay messages with cached messages (dedup by event ID)
      const messageMap = new Map<string, ChannelMessage>();
      for (const msg of cachedMessages) {
        messageMap.set(msg.id, msg);
      }
      for (const event of allEvents) {
        const msg = this.parseChannelMessage(event, channelId);
        if (msg) {
          messageMap.set(msg.id, msg);
        }
      }
      const messages = Array.from(messageMap.values());

      this.messagesMap.update(map => {
        const updated = new Map(map);
        updated.set(channelId, messages);
        return updated;
      });

      // Update message count on channel
      this.channelsMap.update(map => {
        const updated = new Map(map);
        const channel = updated.get(channelId);
        if (channel) {
          updated.set(channelId, { ...channel, messageCount: messages.length });
        }
        return updated;
      });

      this.logger.info('[ChatChannels] Loaded messages for channel:', channelId, messages.length);

      // Load reactions and deletions for this channel's messages
      await this.loadReactionsForChannel(channelId);
      await this.loadDeletionsForChannel(channelId);
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load messages for channel:', channelId, error);
    } finally {
      this.isLoadingMessages.set(false);
    }
  }

  /**
   * Refresh messages for a channel WITHOUT using the cached `since` value.
   * This forces a full query (up to `limit`) from relays, which can recover
   * messages that were missed due to clock drift or relay gaps.
   */
  async refreshChannelMessages(channelId: string, limit = 200): Promise<void> {
    this.isLoadingMessages.set(true);

    try {
      // Load cached messages for merging, but ignore the latestTimestamp
      const { messages: cachedMessages } = await this.loadChannelMessagesFromCache(channelId);

      // Build filter WITHOUT a `since` value — fetch everything up to limit
      const filter: Filter = { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], limit };

      // Query account relays
      const events = await this.accountRelay.getMany<Event>(
        filter,
        { timeout: 15000 }
      );

      // Also query channel-specific relays
      const channel = this.channelsMap().get(channelId);
      const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
      let channelRelayEvents: Event[] = [];
      if (channelOnlyRelays.length > 0) {
        try {
          channelRelayEvents = await this.relayPool.query(channelOnlyRelays, filter, 15000);
        } catch (err) {
          this.logger.warn('[ChatChannels] Refresh: Failed to fetch from channel relays', err);
        }
      }

      const allEvents = [...events, ...channelRelayEvents];

      // Cache fetched messages to IndexedDB
      if (allEvents.length > 0) {
        this.database.saveEvents(allEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Refresh: Failed to cache channel messages', err)
        );
      }

      // Merge relay messages with cached messages (dedup by event ID)
      const messageMap = new Map<string, ChannelMessage>();
      for (const msg of cachedMessages) {
        messageMap.set(msg.id, msg);
      }
      for (const event of allEvents) {
        const msg = this.parseChannelMessage(event, channelId);
        if (msg) {
          messageMap.set(msg.id, msg);
        }
      }
      const messages = Array.from(messageMap.values());

      this.messagesMap.update(map => {
        const updated = new Map(map);
        updated.set(channelId, messages);
        return updated;
      });

      // Update message count on channel
      this.channelsMap.update(map => {
        const updated = new Map(map);
        const ch = updated.get(channelId);
        if (ch) {
          updated.set(channelId, { ...ch, messageCount: messages.length });
        }
        return updated;
      });

      this.logger.info('[ChatChannels] Refreshed messages for channel:', channelId, 'total:', messages.length, 'new from relays:', allEvents.length);

      // Reload reactions and deletions
      await this.loadReactionsForChannel(channelId);
      await this.loadDeletionsForChannel(channelId);
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to refresh messages for channel:', channelId, error);
    } finally {
      this.isLoadingMessages.set(false);
    }
  }

  /**
   * Migrate channel messages to the channel's current relay list.
   *
   * This aggregates all unique pubkeys from messages in the channel,
   * discovers each user's relay list (kind 10002), queries those relays
   * for kind 42 messages tagged with this channel, and republishes all
   * found events to the channel's current relay list.
   *
   * This is useful when the channel owner changes the relay list and
   * wants all historical messages to be available on the new relays.
   */
  async migrateChannelMessages(channelId: string): Promise<{ found: number; published: number }> {
    this.isMigrating.set(true);
    this.migrationProgress.set('Starting migration...');

    let totalFound = 0;
    let totalPublished = 0;

    try {
      const channel = this.channelsMap().get(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }

      // Determine the target relay list (the channel's current relays + account relays)
      const targetRelays = this.getPublishRelayUrls(channel.metadata.relays);
      if (targetRelays.length === 0) {
        throw new Error('No target relays configured for this channel');
      }

      // Step 1: Collect all unique pubkeys from existing messages
      this.migrationProgress.set('Collecting message authors...');
      const messages = this.messagesMap().get(channelId) || [];
      const pubkeys = new Set<string>();
      for (const msg of messages) {
        pubkeys.add(msg.pubkey);
      }

      // Also include the channel creator
      pubkeys.add(channel.creator);

      this.migrationProgress.set(`Found ${pubkeys.size} unique authors. Discovering relays...`);

      // Step 2: Discover relay lists (kind 10002) for all authors
      const userRelayMap = new Map<string, string[]>();
      const pubkeyArray = Array.from(pubkeys);
      const batchSize = 10;
      for (let i = 0; i < pubkeyArray.length; i += batchSize) {
        const batch = pubkeyArray.slice(i, i + batchSize);
        this.migrationProgress.set(`Discovering relays... (${Math.min(i + batchSize, pubkeyArray.length)}/${pubkeyArray.length} authors)`);
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            try {
              const relays = await this.userRelaysService.getUserRelays(pubkey);
              if (relays.length > 0) {
                userRelayMap.set(pubkey, relays);
              }
            } catch (err) {
              this.logger.warn(`[ChatChannels] Migration: failed to discover relays for ${pubkey.slice(0, 8)}`, err);
            }
          })
        );
      }

      this.migrationProgress.set(`Discovered relays for ${userRelayMap.size}/${pubkeys.size} authors. Querying for messages...`);

      // Step 3: Collect all unique relay URLs from all authors
      const allUserRelays = new Set<string>();
      for (const relays of userRelayMap.values()) {
        for (const url of relays) {
          allUserRelays.add(url);
        }
      }

      // Remove relays that are already in the target set (no need to fetch from them
      // since messages there are already accessible)
      const sourceOnlyRelays = Array.from(allUserRelays).filter(url => !targetRelays.includes(url));

      // Also include target relays as sources to collect all existing messages
      const allSourceRelays = [...new Set([...sourceOnlyRelays, ...targetRelays])];

      // Step 4: Query all source relays for messages in this channel
      const allEvents = new Map<string, Event>();

      // Query in batches of relay URLs to avoid overwhelming
      const relayBatchSize = 15;
      const relayArray = allSourceRelays;
      for (let i = 0; i < relayArray.length; i += relayBatchSize) {
        const relayBatch = relayArray.slice(i, i + relayBatchSize);
        this.migrationProgress.set(`Querying relays for messages... (${Math.min(i + relayBatchSize, relayArray.length)}/${relayArray.length} relays)`);

        try {
          const filter: Filter = { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], limit: 500 };
          const events = await this.relayPool.query(relayBatch, filter, 15000);
          for (const event of events) {
            allEvents.set(event.id, event);
          }
        } catch (err) {
          this.logger.warn(`[ChatChannels] Migration: failed to query relay batch starting at index ${i}`, err);
        }
      }

      totalFound = allEvents.size;
      this.migrationProgress.set(`Found ${totalFound} messages. Publishing to chat relays...`);

      if (totalFound === 0) {
        this.migrationProgress.set('No messages found to migrate.');
        return { found: 0, published: 0 };
      }

      // Step 5: Republish all events to the target relay list
      const eventsArray = Array.from(allEvents.values());
      const publishBatchSize = 20;
      for (let i = 0; i < eventsArray.length; i += publishBatchSize) {
        const batch = eventsArray.slice(i, i + publishBatchSize);
        this.migrationProgress.set(`Publishing messages... (${Math.min(i + publishBatchSize, eventsArray.length)}/${eventsArray.length})`);

        await Promise.allSettled(
          batch.map(async (event) => {
            try {
              await this.relayPool.publish(targetRelays, event, 10000);
              totalPublished++;
            } catch (err) {
              this.logger.warn(`[ChatChannels] Migration: failed to publish event ${event.id.slice(0, 8)}`, err);
            }
          })
        );
      }

      // Step 6: Cache all events to IndexedDB
      if (eventsArray.length > 0) {
        this.database.saveEvents(eventsArray as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Migration: failed to cache events', err)
        );
      }

      this.migrationProgress.set(`Migration complete. Found ${totalFound} messages, published ${totalPublished} to ${targetRelays.length} relays.`);
      this.logger.info(`[ChatChannels] Migration complete for channel ${channelId}: found=${totalFound}, published=${totalPublished}`);

      // Reload messages to show any newly discovered ones
      await this.refreshChannelMessages(channelId);

      return { found: totalFound, published: totalPublished };
    } catch (error) {
      this.logger.error('[ChatChannels] Migration failed for channel:', channelId, error);
      this.migrationProgress.set(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    } finally {
      this.isMigrating.set(false);
    }
  }

  /**
   * Subscribe to new messages in a specific channel (live updates)
   */
  subscribeToChannelMessages(channelId: string): void {
    this.closeMessageSubscription();

    const now = this.utilities.currentDate();
    const handleMessageEvent = (event: Event) => {
      const msg = this.parseChannelMessage(event, channelId);
      if (msg) {
        // Cache live message to IndexedDB
        this.database.saveEvents([event as Event & { dTag?: string }]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache live message', err)
        );

        this.messagesMap.update(map => {
          const updated = new Map(map);
          const existing = updated.get(channelId) ?? [];
          // Avoid duplicates
          if (!existing.some(m => m.id === msg.id)) {
            updated.set(channelId, [...existing, msg]);
          }
          return updated;
        });

        // Update message count
        this.channelsMap.update(map => {
          const updated = new Map(map);
          const channel = updated.get(channelId);
          if (channel) {
            const messages = this.messagesMap().get(channelId) ?? [];
            updated.set(channelId, { ...channel, messageCount: messages.length });
          }
          return updated;
        });
      }
    };

    // Subscribe on account relays
    const msgSub = this.accountRelay.subscribe<Event>(
      { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], since: now },
      handleMessageEvent
    );
    this.messageSubscription = msgSub;

    // Also subscribe on channel-specific relays (those not in account relays)
    const channel = this.channelsMap().get(channelId);
    const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
    if (channelOnlyRelays.length > 0) {
      this.channelRelayMessageSubscription = this.relayPool.subscribe(
        channelOnlyRelays,
        { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], since: now },
        handleMessageEvent
      );
    }

    // Also subscribe to reactions for this channel
    this.subscribeToReactions(channelId);
  }

  /**
   * Add a reaction to a channel message
   */
  async addReaction(message: ChannelMessage, emoji: string): Promise<boolean> {
    const currentUserPubkey = this.accountState.pubkey();
    if (!currentUserPubkey) return false;

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions?.get(emoji);
    if (existingReaction?.pubkeys.includes(currentUserPubkey)) {
      return false; // Already reacted
    }

    try {
      const result = await this.reactionService.addReaction(emoji, message.event);
      if (result.success) {
        // Optimistic UI update
        this.updateMessageReaction(message.channelId, message.id, emoji, currentUserPubkey);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to add reaction', error);
      return false;
    }
  }

  /**
   * Delete a channel message (kind 5 NIP-09 retraction)
   * Only the message author can delete their own messages.
   */
  async deleteMessage(message: ChannelMessage, referenceMode: DeleteEventReferenceMode = 'e'): Promise<boolean> {
    const currentUserPubkey = this.accountState.pubkey();
    if (!currentUserPubkey || message.pubkey !== currentUserPubkey) {
      this.logger.warn('[ChatChannels] Cannot delete message - not the author');
      return false;
    }

    try {
      const deleteEvent = this.nostrService.createRetractionEventWithMode(message.event, referenceMode);
      const channel = this.channelsMap().get(message.channelId);
      const publishRelays = this.getPublishRelayUrls(channel?.metadata.relays);
      const result = await this.nostrService.signAndPublish(deleteEvent, publishRelays);

      if (result.success) {
        this.deletedMessageIds.update(set => {
          const updated = new Set(set);
          updated.add(message.id);
          return updated;
        });
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to delete message', error);
      return false;
    }
  }

  /**
   * Get reactions array for a message (for template iteration)
   */
  getReactionsArray(message: ChannelMessage): ChatReaction[] {
    if (!message.reactions) return [];
    return Array.from(message.reactions.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Update a message's zap totals
   */
  private updateMessageZaps(channelId: string, messageId: string, amount: number): void {
    this.messagesMap.update(map => {
      const updated = new Map(map);
      const messages = updated.get(channelId);
      if (!messages) return map;

      const updatedMessages = messages.map(msg => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          zapTotal: (msg.zapTotal ?? 0) + amount,
          zapCount: (msg.zapCount ?? 0) + 1,
        };
      });

      updated.set(channelId, updatedMessages);
      return updated;
    });
  }

  /**
   * Create a new public chat channel (kind 40)
   */
  async createChannel(metadata: ChannelMetadata, tags: string[] = []): Promise<{ success: boolean; channelId?: string }> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[ChatChannels] Cannot create channel - no account');
      return { success: false };
    }

    try {
      const content = JSON.stringify({
        name: metadata.name,
        about: metadata.about,
        picture: metadata.picture,
        relays: metadata.relays ?? [],
      });

      const eventTags: string[][] = tags.map(t => ['t', t]);

      const event = this.nostrService.createEvent(CHANNEL_CREATE_KIND, content, eventTags);
      const publishRelays = this.getPublishRelayUrls(metadata.relays);
      const result = await this.nostrService.signAndPublish(event, publishRelays);

      if (result.success && result.event) {
        const channel: ChatChannel = {
          id: result.event.id,
          creator: pubkey,
          metadata,
          originalMetadata: { ...metadata },
          createdAt: result.event.created_at,
          updatedAt: result.event.created_at,
          messageCount: 0,
          tags,
          originalTags: [...tags],
          metadataUpdates: [],
        };

        this.channelsMap.update(map => {
          const updated = new Map(map);
          updated.set(channel.id, channel);
          return updated;
        });

        this.logger.info('[ChatChannels] Created channel:', channel.id);
        return { success: true, channelId: channel.id };
      }

      return { success: false };
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to create channel', error);
      return { success: false };
    }
  }

  /**
   * Update channel metadata (kind 41)
   * Only the channel creator can update metadata.
   */
  async updateChannelMetadata(
    channelId: string,
    metadata: ChannelMetadata,
    tags: string[] = []
  ): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    // Verify current user is the channel creator
    const channel = this.channelsMap().get(channelId);
    if (!channel || channel.creator !== pubkey) {
      this.logger.warn('[ChatChannels] Cannot update metadata - not the channel creator');
      return false;
    }

    try {
      const content = JSON.stringify({
        name: metadata.name,
        about: metadata.about,
        picture: metadata.picture,
        relays: metadata.relays ?? [],
      });

      const relayHint = this.getRelayHint(metadata.relays);
      const eventTags: string[][] = [
        ['e', channelId, relayHint, 'root'],
        ...tags.map(t => ['t', t]),
      ];

      const event = this.nostrService.createEvent(CHANNEL_METADATA_KIND, content, eventTags);
      const publishRelays = this.getPublishRelayUrls(metadata.relays);
      const result = await this.nostrService.signAndPublish(event, publishRelays);

      if (result.success && result.event) {
        const updateEntry: ChannelMetadataUpdate = {
          id: result.event.id,
          pubkey,
          metadata,
          createdAt: result.event.created_at,
          tags,
        };

        this.channelsMap.update(map => {
          const updated = new Map(map);
          const current = updated.get(channelId) ?? channel;
          const existingUpdates = current.metadataUpdates || [];
          // Dedup: only add if not already present
          const alreadyExists = existingUpdates.some(u => u.id === updateEntry.id);
          updated.set(channelId, {
            ...current,
            metadata,
            updatedAt: result.event!.created_at,
            tags,
            metadataEventId: result.event!.id,
            metadataUpdates: alreadyExists
              ? existingUpdates
              : [...existingUpdates, updateEntry].sort((a, b) => a.createdAt - b.createdAt),
          });
          return updated;
        });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to update channel metadata', error);
      return false;
    }
  }

  /**
   * Send a message to a channel (kind 42)
   */
  async sendMessage(channelId: string, content: string, replyToId?: string, extraTags?: string[][]): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      // Look up channel relays for publishing and relay hint
      const channel = this.channelsMap().get(channelId);
      const channelRelays = channel?.metadata.relays;
      const relayHint = this.getRelayHint(channelRelays);

      const tags: string[][] = [['e', channelId, relayHint, 'root']];

      if (replyToId) {
        // Find the original message to get the author pubkey for the p tag
        const messages = this.messagesMap().get(channelId) ?? [];
        const replyMessage = messages.find(m => m.id === replyToId);

        tags.push(['e', replyToId, relayHint, 'reply']);
        if (replyMessage) {
          tags.push(['p', replyMessage.pubkey]);
        }
      }

      if (extraTags?.length) {
        tags.push(...extraTags);
      }

      const event = this.nostrService.createEvent(CHANNEL_MESSAGE_KIND, content, tags);
      const publishRelays = this.getPublishRelayUrls(channelRelays);
      const result = await this.nostrService.signAndPublish(event, publishRelays);

      if (result.success && result.event) {
        // Add message to local state immediately
        const msg: ChannelMessage = {
          id: result.event.id,
          channelId,
          pubkey,
          content,
          createdAt: result.event.created_at,
          replyTo: replyToId,
          event: result.event,
        };

        this.messagesMap.update(map => {
          const updated = new Map(map);
          const existing = updated.get(channelId) ?? [];
          if (!existing.some(m => m.id === msg.id)) {
            updated.set(channelId, [...existing, msg]);
          }
          return updated;
        });

        // Cache to IndexedDB so the `since` optimization works correctly on reload
        this.database.saveEvents([result.event as Event & { dTag?: string }]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache sent message', err)
        );

        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to send message', error);
      return false;
    }
  }

  /**
   * Hide a message (kind 43)
   */
  async hideMessage(messageId: string, reason?: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const content = reason ? JSON.stringify({ reason }) : '';
      const tags: string[][] = [['e', messageId]];

      const event = this.nostrService.createEvent(CHANNEL_HIDE_MESSAGE_KIND, content, tags);
      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.hiddenMessageIds.update(set => {
          const updated = new Set(set);
          updated.add(messageId);
          return updated;
        });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to hide message', error);
      return false;
    }
  }

  /**
   * Mute a user (kind 44)
   */
  async muteUser(userPubkey: string, reason?: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const content = reason ? JSON.stringify({ reason }) : '';
      const tags: string[][] = [['p', userPubkey]];

      const event = this.nostrService.createEvent(CHANNEL_MUTE_USER_KIND, content, tags);
      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.mutedUserPubkeys.update(set => {
          const updated = new Set(set);
          updated.add(userPubkey);
          return updated;
        });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to mute user', error);
      return false;
    }
  }

  /**
   * Unmute a user locally (does not publish an event)
   */
  unmuteUser(userPubkey: string): void {
    this.mutedUserPubkeys.update(set => {
      const updated = new Set(set);
      updated.delete(userPubkey);
      return updated;
    });
  }

  /**
   * Unhide a message locally (does not publish an event)
   */
  unhideMessage(messageId: string): void {
    this.hiddenMessageIds.update(set => {
      const updated = new Set(set);
      updated.delete(messageId);
      return updated;
    });
  }

  /**
   * Check if a user is muted
   */
  isUserMuted(pubkey: string): boolean {
    return this.mutedUserPubkeys().has(pubkey);
  }

  /**
   * Check if a message is hidden
   */
  isMessageHidden(messageId: string): boolean {
    return this.hiddenMessageIds().has(messageId);
  }

  /**
   * Get all muted user pubkeys (read-only)
   */
  getMutedUserPubkeys(): ReadonlySet<string> {
    return this.mutedUserPubkeys();
  }

  /**
   * Get all hidden message IDs (read-only)
   */
  getHiddenMessageIds(): ReadonlySet<string> {
    return this.hiddenMessageIds();
  }

  /**
   * Get muted user pubkeys that are relevant to a specific channel.
   * Only returns pubkeys that have actually sent messages in the given channel.
   */
  getMutedUserPubkeysForChannel(channelId: string): string[] {
    const muted = this.mutedUserPubkeys();
    if (muted.size === 0) return [];
    const messages = this.messagesMap().get(channelId) ?? [];
    const channelPubkeys = new Set(messages.map(m => m.pubkey));
    return Array.from(muted).filter(pk => channelPubkeys.has(pk));
  }

  /**
   * Get hidden message IDs that belong to a specific channel.
   * Only returns IDs that exist in the channel's message list.
   */
  getHiddenMessageIdsForChannel(channelId: string): string[] {
    const hidden = this.hiddenMessageIds();
    if (hidden.size === 0) return [];
    const messages = this.messagesMap().get(channelId) ?? [];
    const channelMessageIds = new Set(messages.map(m => m.id));
    return Array.from(hidden).filter(id => channelMessageIds.has(id));
  }

  /**
   * Get a channel by ID
   */
  getChannel(channelId: string): ChatChannel | undefined {
    return this.channelsMap().get(channelId);
  }

  /**
   * Clear all local state
   */
  clear(): void {
    this.closeChannelSubscription();
    this.closeMessageSubscription();
    this.closeReactionSubscription();
    this.channelsMap.set(new Map());
    this.messagesMap.set(new Map());
    this.hiddenMessageIds.set(new Set());
    this.mutedUserPubkeys.set(new Set());
    this.participatedChannelIds.set(new Set());
    this.deletedMessageIds.set(new Set());
    this.reactionIds.clear();
    this.deletionIds.clear();
  }

  /**
   * Close live channel subscription
   */
  closeChannelSubscription(): void {
    if (this.liveSubscription) {
      if (this.liveSubscription.close) {
        this.liveSubscription.close();
      } else if (this.liveSubscription.unsubscribe) {
        this.liveSubscription.unsubscribe();
      }
      this.liveSubscription = null;
    }
  }

  /**
   * Close live message subscription
   */
  closeMessageSubscription(): void {
    if (this.messageSubscription) {
      if (this.messageSubscription.close) {
        this.messageSubscription.close();
      } else if (this.messageSubscription.unsubscribe) {
        this.messageSubscription.unsubscribe();
      }
      this.messageSubscription = null;
    }
    if (this.channelRelayMessageSubscription) {
      this.channelRelayMessageSubscription.close();
      this.channelRelayMessageSubscription = null;
    }
  }

  /**
   * Close live reaction subscription
   */
  closeReactionSubscription(): void {
    if (this.reactionSubscription) {
      if (this.reactionSubscription.close) {
        this.reactionSubscription.close();
      } else if (this.reactionSubscription.unsubscribe) {
        this.reactionSubscription.unsubscribe();
      }
      this.reactionSubscription = null;
    }
    if (this.channelRelayReactionSubscription) {
      this.channelRelayReactionSubscription.close();
      this.channelRelayReactionSubscription = null;
    }
  }

  // --- Private helpers ---

  /**
   * Check if a channel name matches a blocked prefix.
   * Used to filter out unwanted channels from both in-memory state and database persistence.
   */
  private isBlockedChannelName(name: string): boolean {
    return BLOCKED_CHANNEL_PREFIXES.some(prefix => name.startsWith(prefix));
  }

  /**
   * Check if a raw kind 40/41 event has a blocked channel name in its content.
   */
  private isBlockedChannelEvent(event: Event): boolean {
    try {
      const metadata = JSON.parse(event.content) as Partial<ChannelMetadata>;
      return !!metadata.name && this.isBlockedChannelName(metadata.name);
    } catch {
      return false;
    }
  }

  /**
   * Get the set of unique channel owner pubkeys from all known channels.
   */
  private getChannelOwnerPubkeys(): Set<string> {
    const owners = new Set<string>();
    for (const channel of this.channelsMap().values()) {
      owners.add(channel.creator);
    }
    return owners;
  }

  /**
   * Load user's and channel owners' moderation events from local database cache
   */
  private async loadModerationDataFromCache(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const ownerPubkeys = this.getChannelOwnerPubkeys();

    try {
      // Load cached hidden messages from current user + channel owners
      const hideEvents = await this.database.getEventsByKind(CHANNEL_HIDE_MESSAGE_KIND);
      const hiddenIds = new Set<string>();
      for (const event of hideEvents) {
        if (event.pubkey !== pubkey && !ownerPubkeys.has(event.pubkey)) continue;
        const eTag = event.tags.find(t => t[0] === 'e');
        if (eTag?.[1]) {
          hiddenIds.add(eTag[1]);
        }
      }
      if (hiddenIds.size > 0) {
        this.hiddenMessageIds.set(hiddenIds);
      }

      // Load cached muted users from current user + channel owners
      const muteEvents = await this.database.getEventsByKind(CHANNEL_MUTE_USER_KIND);
      const mutedPubkeys = new Set<string>();
      for (const event of muteEvents) {
        if (event.pubkey !== pubkey && !ownerPubkeys.has(event.pubkey)) continue;
        const pTag = event.tags.find(t => t[0] === 'p');
        if (pTag?.[1]) {
          mutedPubkeys.add(pTag[1]);
        }
      }
      if (mutedPubkeys.size > 0) {
        this.mutedUserPubkeys.set(mutedPubkeys);
      }

      this.logger.info('[ChatChannels] Loaded moderation data from cache:', {
        hiddenMessages: hiddenIds.size,
        mutedUsers: mutedPubkeys.size,
      });
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load moderation data from cache', error);
    }
  }

  /**
   * Load moderation events (hide messages + mute users) from current user AND channel owners.
   */
  private async loadModerationData(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Collect all unique author pubkeys: current user + all channel owners
    const ownerPubkeys = this.getChannelOwnerPubkeys();
    const authors = [pubkey, ...Array.from(ownerPubkeys).filter(pk => pk !== pubkey)];

    try {
      // Load hidden messages from relays (current user + channel owners)
      const hideEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_HIDE_MESSAGE_KIND], authors, limit: 500 },
        { timeout: 8000 }
      );

      // Persist to local DB
      if (hideEvents.length > 0) {
        this.database.saveEvents(hideEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache hide events', err)
        );
      }

      const hiddenIds = new Set<string>();
      for (const event of hideEvents) {
        const eTag = event.tags.find(t => t[0] === 'e');
        if (eTag?.[1]) {
          hiddenIds.add(eTag[1]);
        }
      }
      this.hiddenMessageIds.set(hiddenIds);

      // Load muted users from relays (current user + channel owners)
      const muteEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_MUTE_USER_KIND], authors, limit: 500 },
        { timeout: 8000 }
      );

      // Persist to local DB
      if (muteEvents.length > 0) {
        this.database.saveEvents(muteEvents as (Event & { dTag?: string })[]).catch(err =>
          this.logger.error('[ChatChannels] Failed to cache mute events', err)
        );
      }

      const mutedPubkeys = new Set<string>();
      for (const event of muteEvents) {
        const pTag = event.tags.find(t => t[0] === 'p');
        if (pTag?.[1]) {
          mutedPubkeys.add(pTag[1]);
        }
      }
      this.mutedUserPubkeys.set(mutedPubkeys);

      this.logger.info('[ChatChannels] Loaded moderation data:', {
        hiddenMessages: hiddenIds.size,
        mutedUsers: mutedPubkeys.size,
        authors: authors.length,
      });
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load moderation data', error);
    }
  }

  /**
   * Parse a kind 40 event into a ChatChannel
   */
  private parseChannelCreateEvent(event: Event): ChatChannel | null {
    try {
      const metadata = JSON.parse(event.content) as Partial<ChannelMetadata>;
      const tags = event.tags
        .filter(t => t[0] === 't' && t[1])
        .map(t => t[1]);

      const parsedMetadata: ChannelMetadata = {
        name: metadata.name || 'Unnamed Channel',
        about: metadata.about || '',
        picture: metadata.picture || '',
        relays: metadata.relays || [],
      };

      return {
        id: event.id,
        creator: event.pubkey,
        metadata: { ...parsedMetadata },
        originalMetadata: { ...parsedMetadata },
        createdAt: event.created_at,
        updatedAt: event.created_at,
        messageCount: 0,
        tags,
        originalTags: [...tags],
        metadataUpdates: [],
      };
    } catch (err) {
      this.logger.warn(
        `[ChatChannels] Failed to parse channel create event:`,
        `error: ${err instanceof Error ? err.message : String(err)}`,
        event,
      );
      return null;
    }
  }

  /**
   * Apply a kind 41 metadata update to the channel map
   * Only accepts updates from the channel creator
   */
  private applyMetadataUpdate(channelMap: Map<string, ChatChannel>, event: Event): void {
    const eTag = event.tags.find(t => t[0] === 'e');
    if (!eTag?.[1]) return;

    const channelId = eTag[1];
    const channel = channelMap.get(channelId);
    if (!channel) return;

    // Only the creator can update metadata
    if (event.pubkey !== channel.creator) return;

    try {
      const metadata = JSON.parse(event.content) as Partial<ChannelMetadata>;
      const tags = event.tags
        .filter(t => t[0] === 't' && t[1])
        .map(t => t[1]);

      const parsedMetadata: ChannelMetadata = {
        name: metadata.name || channel.metadata.name,
        about: metadata.about ?? channel.metadata.about,
        picture: metadata.picture ?? channel.metadata.picture,
        relays: metadata.relays ?? channel.metadata.relays,
      };

      // Build the metadata update entry for timeline display
      const updateEntry: ChannelMetadataUpdate = {
        id: event.id,
        pubkey: event.pubkey,
        metadata: parsedMetadata,
        createdAt: event.created_at,
        tags,
      };

      // Add to metadataUpdates if not already present (dedup by event ID)
      const existingUpdates = channel.metadataUpdates || [];
      const alreadyExists = existingUpdates.some(u => u.id === event.id);
      const updatedList = alreadyExists
        ? existingUpdates
        : [...existingUpdates, updateEntry].sort((a, b) => a.createdAt - b.createdAt);

      // Only update the current metadata/updatedAt if this event is newer
      const isNewer = event.created_at > channel.updatedAt;

      channelMap.set(channelId, {
        ...channel,
        metadata: isNewer ? parsedMetadata : channel.metadata,
        updatedAt: isNewer ? event.created_at : channel.updatedAt,
        tags: isNewer ? tags : channel.tags,
        metadataEventId: isNewer ? event.id : channel.metadataEventId,
        metadataUpdates: updatedList,
      });
    } catch {
      this.logger.warn('[ChatChannels] Failed to parse channel metadata event:', event.id);
    }
  }

  /**
   * Parse a kind 42 event into a ChannelMessage
   */
  private parseChannelMessage(event: Event, expectedChannelId: string): ChannelMessage | null {
    // Verify this message belongs to the expected channel
    const rootTag = event.tags.find(
      t => t[0] === 'e' && (t[3] === 'root' || (!t[3] && t === event.tags.find(tag => tag[0] === 'e')))
    );

    if (!rootTag || rootTag[1] !== expectedChannelId) {
      return null;
    }

    const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply');

    return {
      id: event.id,
      channelId: expectedChannelId,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      replyTo: replyTag?.[1],
      event,
    };
  }

  /**
   * Load reactions for messages in a channel
   */
  private async loadReactionsForChannel(channelId: string): Promise<void> {
    try {
      const messages = this.messagesMap().get(channelId) ?? [];
      if (messages.length === 0) return;

      const messageIds = messages.map(m => m.id);
      // Don't filter by #k tag — many reaction events in the wild don't include it,
      // and filtering by #e (message IDs) is sufficient to scope reactions to this channel.
      const filter = { kinds: [7], '#e': messageIds, limit: 500 } as Filter;

      const reactionEvents = await this.accountRelay.getMany<Event>(filter, { timeout: 8000 });

      // Also query channel-specific relays
      const channel = this.channelsMap().get(channelId);
      const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
      if (channelOnlyRelays.length > 0) {
        try {
          const channelRelayReactions = await this.relayPool.query(channelOnlyRelays, filter, 8000);
          for (const event of channelRelayReactions) {
            this.handleReactionEvent(event, channelId);
          }
        } catch (err) {
          this.logger.warn('[ChatChannels] Failed to load reactions from channel relays', err);
        }
      }

      for (const event of reactionEvents) {
        this.handleReactionEvent(event, channelId);
      }

      this.logger.info('[ChatChannels] Loaded reactions for channel:', channelId, reactionEvents.length);
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load reactions for channel:', channelId, error);
    }
  }

  /**
   * Load deletion events for messages in a channel
   */
  private async loadDeletionsForChannel(channelId: string): Promise<void> {
    try {
      const messages = this.messagesMap().get(channelId) ?? [];
      if (messages.length === 0) return;

      const messageIds = messages.map(m => m.id);
      // Don't filter by #k tag — many deletion events don't include it,
      // and filtering by #e (message IDs) is sufficient to scope deletions to this channel.
      const filter = { kinds: [5], '#e': messageIds, limit: 500 } as Filter;

      const deletionEvents = await this.accountRelay.getMany<Event>(filter, { timeout: 8000 });

      // Also query channel-specific relays
      const channel = this.channelsMap().get(channelId);
      const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
      if (channelOnlyRelays.length > 0) {
        try {
          const channelRelayDeletions = await this.relayPool.query(channelOnlyRelays, filter, 8000);
          for (const event of channelRelayDeletions) {
            this.handleDeletionEvent(event, channelId);
          }
        } catch (err) {
          this.logger.warn('[ChatChannels] Failed to load deletions from channel relays', err);
        }
      }

      for (const event of deletionEvents) {
        this.handleDeletionEvent(event, channelId);
      }

      this.logger.info('[ChatChannels] Loaded deletions for channel:', channelId, deletionEvents.length);
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load deletions for channel:', channelId, error);
    }
  }

  /**
   * Subscribe to live reactions for a channel.
   * Scoped to the channel's current message IDs via '#e' filter.
   * Falls back to a broader filter if no messages are loaded yet.
   */
  private subscribeToReactions(channelId: string): void {
    this.closeReactionSubscription();

    const messages = this.messagesMap().get(channelId) ?? [];
    const messageIds = messages.map(m => m.id);

    // If there are no messages loaded, there's nothing to subscribe reactions for
    if (messageIds.length === 0) return;

    const now = Math.floor(Date.now() / 1000);

    // Scope the subscription to reactions/deletions targeting this channel's messages.
    // Don't filter by #k tag — many reactions don't include it.
    const filter: Filter = { kinds: [7, 5, 9735], '#e': messageIds } as Filter;

    // Use a since filter based on the oldest message in the current view
    // to avoid fetching ancient reactions we've already processed
    const oldestMessage = messages.reduce((oldest, m) =>
      m.createdAt < oldest.createdAt ? m : oldest, messages[0]);
    if (oldestMessage) {
      (filter as Record<string, unknown>)['since'] = oldestMessage.createdAt;
    }

    const handleReactionOrDeletion = (event: Event) => {
      if (event.kind === 7) {
        this.handleReactionEvent(event, channelId);
      } else if (event.kind === 5) {
        this.handleDeletionEvent(event, channelId);
      } else if (event.kind === 9735) {
        this.handleZapReceiptEvent(event, channelId);
      }
    };

    const reactionSub = this.accountRelay.subscribe<Event>(
      filter,
      handleReactionOrDeletion,
      () => {
        this.logger.debug('[ChatChannels] Reactions subscription reached EOSE for channel:', channelId);
      }
    );
    this.reactionSubscription = reactionSub;

    // Also subscribe on channel-specific relays
    const channel = this.channelsMap().get(channelId);
    const channelOnlyRelays = this.getChannelOnlyRelayUrls(channel?.metadata.relays);
    if (channelOnlyRelays.length > 0) {
      this.channelRelayReactionSubscription = this.relayPool.subscribe(
        channelOnlyRelays,
        filter,
        handleReactionOrDeletion
      );
    }
  }

  /**
   * Handle a kind 7 reaction event
   */
  private handleReactionEvent(event: Event, channelId: string): void {
    if (this.reactionIds.has(event.id)) return;
    this.reactionIds.add(event.id);

    const targetEventId = event.tags.find(tag => tag[0] === 'e')?.[1];
    if (!targetEventId) return;

    const reactionContent = event.content || '+';
    const reactorPubkey = event.pubkey;

    this.updateMessageReaction(channelId, targetEventId, reactionContent, reactorPubkey);
  }

  /**
   * Handle a kind 5 deletion event
   */
  private handleDeletionEvent(event: Event, channelId: string): void {
    if (this.deletionIds.has(event.id)) return;
    this.deletionIds.add(event.id);

    const targetEventId = event.tags.find(tag => tag[0] === 'e')?.[1];
    if (!targetEventId) return;

    // Verify the deletion author matches the message author (NIP-09)
    const messages = this.messagesMap().get(channelId) ?? [];
    const targetMessage = messages.find(m => m.id === targetEventId);
    if (!targetMessage || targetMessage.pubkey !== event.pubkey) return;

    this.deletedMessageIds.update(set => {
      const updated = new Set(set);
      updated.add(targetEventId);
      return updated;
    });
  }

  /**
   * Handle a kind 9735 zap receipt event
   */
  private handleZapReceiptEvent(event: Event, channelId: string): void {
    if (this.zapReceiptIds.has(event.id)) return;
    this.zapReceiptIds.add(event.id);

    const targetEventId = event.tags.find(tag => tag[0] === 'e')?.[1];
    if (!targetEventId) return;

    const parsed = this.zapService.parseZapReceipt(event);
    if (!parsed.amount || parsed.amount <= 0) return;

    this.updateMessageZaps(channelId, targetEventId, parsed.amount);
  }

  /**
   * Update a message's reaction map
   */
  private updateMessageReaction(channelId: string, messageId: string, emoji: string, reactorPubkey: string): void {
    const currentUserPubkey = this.accountState.pubkey();

    this.messagesMap.update(map => {
      const updated = new Map(map);
      const messages = updated.get(channelId);
      if (!messages) return map;

      const updatedMessages = messages.map(msg => {
        if (msg.id !== messageId) return msg;

        const reactions = new Map(msg.reactions || []);
        const existing = reactions.get(emoji);

        if (existing) {
          if (existing.pubkeys.includes(reactorPubkey)) return msg;
          existing.count++;
          existing.pubkeys.push(reactorPubkey);
          if (reactorPubkey === currentUserPubkey) {
            existing.userReacted = true;
          }
        } else {
          reactions.set(emoji, {
            content: emoji,
            count: 1,
            pubkeys: [reactorPubkey],
            userReacted: reactorPubkey === currentUserPubkey,
          });
        }

        return { ...msg, reactions };
      });

      updated.set(channelId, updatedMessages);
      return updated;
    });
  }

  /**
   * Get relay URLs for queries
   */
  private getRelayUrls(): string[] {
    return this.accountRelay.getRelayUrls();
  }

  /**
   * Get the first relay URL from a channel's relay list, for use as a relay hint
   * in "e" tags. Returns empty string if no channel relays are configured.
   */
  private getRelayHint(channelRelays?: string[]): string {
    return channelRelays && channelRelays.length > 0 ? channelRelays[0] : '';
  }

  /**
   * Get the combined relay URLs for publishing a channel event.
   * Merges the channel's specified relays with the user's account relays
   * to ensure the user always has a backup on their own relays.
   */
  private getPublishRelayUrls(channelRelays?: string[]): string[] {
    const relaySet = new Set<string>();

    // Always include account relays for backup
    for (const url of this.accountRelay.getRelayUrls()) {
      relaySet.add(url);
    }

    // Include channel-specific relays
    if (channelRelays && channelRelays.length > 0) {
      for (const url of channelRelays) {
        relaySet.add(url);
      }
    }

    return Array.from(relaySet);
  }

  /**
   * Get the combined relay URLs for reading channel events.
   * Merges the channel's specified relays with the user's account relays
   * so messages from channel-designated relays are also fetched.
   */
  private getReadRelayUrls(channelRelays?: string[]): string[] {
    return this.getPublishRelayUrls(channelRelays);
  }

  /**
   * Get the channel-only relay URLs (relays not already in account relays).
   * Used to make supplementary queries to channel-specific relays.
   */
  private getChannelOnlyRelayUrls(channelRelays?: string[]): string[] {
    if (!channelRelays || channelRelays.length === 0) return [];
    const accountRelays = new Set(this.accountRelay.getRelayUrls());
    return channelRelays.filter(url => !accountRelays.has(url));
  }

  /**
   * Collect all unique relay URLs from channel metadata across all known channels.
   */
  private getAllChannelRelayUrls(): string[] {
    const relaySet = new Set<string>();
    for (const channel of this.channelsMap().values()) {
      if (channel.metadata.relays) {
        for (const url of channel.metadata.relays) {
          relaySet.add(url);
        }
      }
    }
    return Array.from(relaySet);
  }
}
