import { Injectable, inject, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';
import { NostriaService } from '../interfaces';

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
 * Represents a public chat channel
 */
export interface ChatChannel {
  /** Event ID of the kind 40 creation event */
  id: string;
  /** Pubkey of the channel creator */
  creator: string;
  /** Channel metadata (from kind 40 or latest kind 41) */
  metadata: ChannelMetadata;
  /** Timestamp of channel creation (seconds) */
  createdAt: number;
  /** Timestamp of last metadata update (seconds) */
  updatedAt: number;
  /** Number of messages loaded */
  messageCount: number;
  /** Tags/categories from kind 41 "t" tags */
  tags: string[];
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
  private readonly utilities = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);

  /** All known channels keyed by channel ID */
  private readonly channelsMap = signal<Map<string, ChatChannel>>(new Map());

  /** Messages keyed by channel ID */
  private readonly messagesMap = signal<Map<string, ChannelMessage[]>>(new Map());

  /** IDs of hidden messages (kind 43 from current user) */
  private readonly hiddenMessageIds = signal<Set<string>>(new Set());

  /** Pubkeys of muted users (kind 44 from current user) */
  private readonly mutedUserPubkeys = signal<Set<string>>(new Set());

  /** Loading state */
  readonly isLoading = signal(false);

  /** Loading state for messages in a specific channel */
  readonly isLoadingMessages = signal(false);

  /** Currently active channel subscription */
  private liveSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

  /** Currently active channel message subscription */
  private messageSubscription: { close?: () => void; unsubscribe?: () => void } | null = null;

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
      return messages
        .filter(m => !hidden.has(m.id) && !muted.has(m.pubkey))
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
   * Load messages for a specific channel
   */
  async loadChannelMessages(channelId: string, limit = 50): Promise<void> {
    this.isLoadingMessages.set(true);

    try {
      const events = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], limit },
        { timeout: 10000 }
      );

      const messages: ChannelMessage[] = [];
      for (const event of events) {
        const msg = this.parseChannelMessage(event, channelId);
        if (msg) {
          messages.push(msg);
        }
      }

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
    } catch (error) {
      this.logger.error('[ChatChannels] Failed to load messages for channel:', channelId, error);
    } finally {
      this.isLoadingMessages.set(false);
    }
  }

  /**
   * Subscribe to new messages in a specific channel (live updates)
   */
  subscribeToChannelMessages(channelId: string): void {
    this.closeMessageSubscription();

    const now = this.utilities.currentDate();
    const msgSub = this.accountRelay.subscribe<Event>(
      { kinds: [CHANNEL_MESSAGE_KIND], '#e': [channelId], since: now },
      (event: Event) => {
        const msg = this.parseChannelMessage(event, channelId);
        if (msg) {
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
      }
    );
    this.messageSubscription = msgSub;
  }

  /**
   * Create a new public chat channel (kind 40)
   */
  async createChannel(metadata: ChannelMetadata): Promise<{ success: boolean; channelId?: string }> {
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

      const event = this.nostrService.createEvent(CHANNEL_CREATE_KIND, content, []);
      const result = await this.nostrService.signAndPublish(event);

      if (result.success && result.event) {
        const channel: ChatChannel = {
          id: result.event.id,
          creator: pubkey,
          metadata,
          createdAt: result.event.created_at,
          updatedAt: result.event.created_at,
          messageCount: 0,
          tags: [],
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

      const eventTags: string[][] = [
        ['e', channelId, '', 'root'],
        ...tags.map(t => ['t', t]),
      ];

      const event = this.nostrService.createEvent(CHANNEL_METADATA_KIND, content, eventTags);
      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.channelsMap.update(map => {
          const updated = new Map(map);
          updated.set(channelId, {
            ...channel,
            metadata,
            updatedAt: this.utilities.currentDate(),
            tags,
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
  async sendMessage(channelId: string, content: string, replyToId?: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;

    try {
      const tags: string[][] = [['e', channelId, '', 'root']];

      if (replyToId) {
        // Find the original message to get the author pubkey for the p tag
        const messages = this.messagesMap().get(channelId) ?? [];
        const replyMessage = messages.find(m => m.id === replyToId);

        tags.push(['e', replyToId, '', 'reply']);
        if (replyMessage) {
          tags.push(['p', replyMessage.pubkey]);
        }
      }

      const event = this.nostrService.createEvent(CHANNEL_MESSAGE_KIND, content, tags);
      const result = await this.nostrService.signAndPublish(event);

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
    this.channelsMap.set(new Map());
    this.messagesMap.set(new Map());
    this.hiddenMessageIds.set(new Set());
    this.mutedUserPubkeys.set(new Set());
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
   * Load user's moderation events from local database cache
   */
  private async loadModerationDataFromCache(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Load cached hidden messages
      const hideEvents = await this.database.getEventsByKind(CHANNEL_HIDE_MESSAGE_KIND);
      const hiddenIds = new Set<string>();
      for (const event of hideEvents) {
        if (event.pubkey !== pubkey) continue;
        const eTag = event.tags.find(t => t[0] === 'e');
        if (eTag?.[1]) {
          hiddenIds.add(eTag[1]);
        }
      }
      if (hiddenIds.size > 0) {
        this.hiddenMessageIds.set(hiddenIds);
      }

      // Load cached muted users
      const muteEvents = await this.database.getEventsByKind(CHANNEL_MUTE_USER_KIND);
      const mutedPubkeys = new Set<string>();
      for (const event of muteEvents) {
        if (event.pubkey !== pubkey) continue;
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
   * Load user's moderation events (hide messages + mute users)
   */
  private async loadModerationData(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Load hidden messages from relays
      const hideEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_HIDE_MESSAGE_KIND], authors: [pubkey], limit: 500 },
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

      // Load muted users from relays
      const muteEvents = await this.accountRelay.getMany<Event>(
        { kinds: [CHANNEL_MUTE_USER_KIND], authors: [pubkey], limit: 500 },
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
      return {
        id: event.id,
        creator: event.pubkey,
        metadata: {
          name: metadata.name || 'Unnamed Channel',
          about: metadata.about || '',
          picture: metadata.picture || '',
          relays: metadata.relays || [],
        },
        createdAt: event.created_at,
        updatedAt: event.created_at,
        messageCount: 0,
        tags: [],
      };
    } catch {
      this.logger.warn('[ChatChannels] Failed to parse channel create event:', event.id);
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

    // Only apply if this is newer than the current metadata
    if (event.created_at <= channel.updatedAt) return;

    try {
      const metadata = JSON.parse(event.content) as Partial<ChannelMetadata>;
      const tags = event.tags
        .filter(t => t[0] === 't' && t[1])
        .map(t => t[1]);

      channelMap.set(channelId, {
        ...channel,
        metadata: {
          name: metadata.name || channel.metadata.name,
          about: metadata.about ?? channel.metadata.about,
          picture: metadata.picture ?? channel.metadata.picture,
          relays: metadata.relays ?? channel.metadata.relays,
        },
        updatedAt: event.created_at,
        tags,
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
   * Get relay URLs for queries
   */
  private getRelayUrls(): string[] {
    return this.accountRelay.getRelayUrls();
  }
}
