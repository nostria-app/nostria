import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import {
  Filter,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  kinds,
  NostrEvent,
} from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { EncryptionPermissionService } from './encryption-permission.service';
import { NostriaService } from '../interfaces';
import { bytesToHex } from 'nostr-tools/utils';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService, StoredDirectMessage } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';

// Define interfaces for our DM data structures
interface Chat {
  id: string;
  pubkey: string;
  unreadCount: number;
  lastMessage?: DirectMessage | null;
  relays?: string[];
  encryptionType?: 'nip04' | 'nip44';
  hasLegacyMessages?: boolean; // true if chat contains any NIP-04 messages
  messages: Map<string, DirectMessage>;
}

interface DirectMessage {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  isOutgoing: boolean;
  tags: string[][];
  pending?: boolean;
  failed?: boolean;
  received?: boolean;
  read?: boolean;
  encryptionType?: 'nip04' | 'nip44';
  replyTo?: string; // The event ID this message is replying to (from 'e' tag)
}

@Injectable({
  providedIn: 'root',
})
export class MessagingService implements NostriaService {
  private nostr = inject(NostrService);
  private relay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private pool = inject(RelayPoolService);
  private logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly encryption = inject(EncryptionService);
  private readonly encryptionPermission = inject(EncryptionPermissionService);
  private readonly database = inject(DatabaseService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  isLoading = signal<boolean>(false);
  isLoadingMoreChats = signal<boolean>(false);
  hasMoreChats = signal<boolean>(true);
  error = signal<string | null>(null);

  private chatsMap = signal<Map<string, Chat>>(new Map());
  private oldestChatTimestamp = signal<number | null>(null);

  MESSAGE_SIZE = 100;

  getChat(chatId: string): Chat | null {
    const chat = this.chatsMap().get(chatId);
    return chat || null;
  }

  sortedChats = computed(() => {
    return Array.from(this.chatsMap().entries())
      .map(([chatId, chat]) => ({ chatId, chat }))
      .sort((a, b) => {
        const aTime = a.chat.lastMessage?.created_at || 0;
        const bTime = b.chat.lastMessage?.created_at || 0;
        return bTime - aTime; // Most recent first
      });
  });

  /**
   * Total unread messages count across all chats
   * Note: Computed signals should be pure - side effects moved to an effect
   */
  totalUnreadCount = computed(() => {
    let count = 0;
    for (const [, chat] of this.chatsMap().entries()) {
      count += chat.unreadCount;
    }
    return count;
  });

  constructor() {
    // Effect to persist unread count to local storage when it changes
    effect(() => {
      const count = this.totalUnreadCount();
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        // Use untracked to avoid reading more signals
        untracked(() => {
          const cachedCount = this.accountLocalState.getUnreadMessagesCount(pubkey);
          if (cachedCount !== count) {
            this.accountLocalState.setUnreadMessagesCount(pubkey, count);
          }
        });
      }
    });

    // Effect to auto-start DM subscription when user is logged in
    // This ensures we receive incoming messages even when not on the Messages page
    // Skip for preview accounts - they cannot decrypt DMs
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const account = this.accountState.account();

      if (pubkey && account?.source !== 'preview') {
        // User is logged in with a non-preview account - start the subscription
        untracked(() => {
          this.logger.info('Auto-starting DM subscription for logged in user');
          this.startDmSubscriptionWithRetry();
        });
      } else if (account?.source === 'preview') {
        // Preview account - skip DM subscription (cannot decrypt)
        untracked(() => {
          this.logger.info('Skipping DM subscription for preview account - cannot decrypt messages');
        });
      } else {
        // User logged out - close the subscription
        untracked(() => {
          if (this.liveSubscription) {
            this.logger.info('Closing DM subscription - user logged out');
            this.closeLiveSubscription();
          }
        });
      }
    });
  }

  /**
   * Start the DM subscription with retry logic to wait for relay initialization.
   * Retries up to 10 times with 2-second intervals.
   */
  private async startDmSubscriptionWithRetry(retryCount = 0): Promise<void> {
    const maxRetries = 10;
    const retryDelay = 2000; // 2 seconds

    console.log('[MessagingService] startDmSubscriptionWithRetry called', {
      retryCount,
      isRelayInitialized: this.relay.isInitialized(),
      relayUrls: this.relay.getRelayUrls(),
    });

    // Check if relays are initialized
    if (!this.relay.isInitialized()) {
      if (retryCount < maxRetries) {
        console.log(`[MessagingService] Waiting for relay initialization (attempt ${retryCount + 1}/${maxRetries})`);
        this.logger.debug(`Waiting for relay initialization before starting DM subscription (attempt ${retryCount + 1}/${maxRetries})`);
        setTimeout(() => {
          this.startDmSubscriptionWithRetry(retryCount + 1);
        }, retryDelay);
        return;
      } else {
        console.warn('[MessagingService] Max retries reached waiting for relay initialization');
        this.logger.warn('Max retries reached waiting for relay initialization, attempting subscription anyway');
      }
    }

    console.log('[MessagingService] Starting DM subscription...');
    const sub = await this.subscribeToIncomingMessages();
    if (sub) {
      console.log('[MessagingService] DM subscription started successfully');
      this.logger.info('DM subscription started successfully');
    } else {
      console.warn('[MessagingService] Failed to start DM subscription');
      this.logger.warn('Failed to start DM subscription');
    }
  }

  hasMessage(chatId: string, messageId: string): boolean {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return false;

    return chat.messages.has(messageId);
  }

  getChatMessages(chatId: string): DirectMessage[] {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return [];

    return Array.from(chat.messages.values()).sort((a, b) => a.created_at - b.created_at); // Oldest first
  }

  /**
   * Extract the reply-to message ID from event tags
   * According to NIP-17, 'e' tags denote the direct parent message
   */
  private getReplyToFromTags(tags: string[][]): string | undefined {
    const eTag = tags.find(tag => tag[0] === 'e');
    return eTag ? eTag[1] : undefined;
  }

  // Helper method to add a message to a chat (prevents duplicates and updates sorting)
  addMessageToChat(pubkey: string, message: DirectMessage): void {
    // Validate pubkey to prevent creating invalid chats
    if (!pubkey || pubkey === 'undefined') {
      this.logger.warn('Cannot add message to chat: invalid pubkey', { pubkey, messageId: message.id });
      return;
    }

    // Prevent self-chat - can't message yourself
    const myPubkey = this.accountState.pubkey();
    if (pubkey === myPubkey) {
      this.logger.warn('Cannot create chat with yourself', { pubkey, messageId: message.id });
      return;
    }

    const currentMap = this.chatsMap();
    // Use pubkey directly as chatId - messages are merged regardless of encryption type
    const chatId = pubkey;

    // Check if this message already exists in the specific chat to prevent duplicates
    const existingChat = currentMap.get(chatId);
    if (existingChat && existingChat.messages.has(message.id)) {
      // Message already exists in this chat, don't add it again
      this.logger.debug(`Message ${message.id} already exists in chat ${chatId}, skipping to prevent duplicate`);
      return;
    }

    // Create a new Map to ensure signal reactivity
    const newMap = new Map(currentMap);

    // Individual chats are keyed by pubkey, so we use pubkey as chatId
    const chat = newMap.get(chatId);

    if (!chat) {
      // Create new chat if it doesn't exist
      const newChat: Chat = {
        id: chatId,
        pubkey: pubkey,
        unreadCount: message.isOutgoing ? 0 : 1, // Count as unread if incoming
        lastMessage: message,
        relays: [],
        encryptionType: 'nip44', // Default to modern encryption for new messages
        hasLegacyMessages: message.encryptionType === 'nip04',
        messages: new Map([[message.id, message]]),
      };

      console.log('[MessagingService] Created new chat with message', {
        chatId,
        messageId: message.id,
        isOutgoing: message.isOutgoing,
        unreadCount: newChat.unreadCount,
      });

      // Add the new chat to the new map
      newMap.set(chatId, newChat);
    } else {
      // Update existing chat
      const updatedMessagesMap = new Map(chat.messages);
      updatedMessagesMap.set(message.id, message);

      const updatedChat: Chat = {
        ...chat,
        messages: updatedMessagesMap,
        lastMessage: this.getLatestMessage(updatedMessagesMap),
        unreadCount: message.isOutgoing ? chat.unreadCount : chat.unreadCount + 1,
        // Track if chat has any legacy (NIP-04) messages
        hasLegacyMessages: chat.hasLegacyMessages || message.encryptionType === 'nip04',
      };

      console.log('[MessagingService] Updated chat with message', {
        chatId,
        messageId: message.id,
        isOutgoing: message.isOutgoing,
        previousUnread: chat.unreadCount,
        newUnread: updatedChat.unreadCount,
      });

      // Update the chat in the new map
      newMap.set(chatId, updatedChat);
    }

    // Set the new map to trigger signal reactivity
    this.chatsMap.set(newMap);

    // Save message to storage asynchronously
    this.saveMessageToStorage(message, chatId);
  }

  /**
   * Save a message to IndexedDB storage
   */
  private async saveMessageToStorage(message: DirectMessage, chatId: string): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return;

    try {
      // Check if message already exists in storage to avoid duplicates
      await this.database.init();
      const exists = await this.database.messageExists(myPubkey, chatId, message.id);
      if (exists) {
        this.logger.debug(`Message ${message.id} already in storage, skipping save`);
        return;
      }

      const storedMessage: StoredDirectMessage = {
        id: `${myPubkey}::${chatId}::${message.id}`,
        accountPubkey: myPubkey,
        chatId: chatId,
        messageId: message.id,
        pubkey: message.pubkey,
        created_at: message.created_at,
        content: message.content,
        isOutgoing: message.isOutgoing,
        tags: message.tags,
        encryptionType: message.encryptionType!,
        read: message.read || false,
        received: message.received || false,
        pending: message.pending,
        failed: message.failed,
      };

      await this.database.saveDirectMessage(storedMessage);
      this.logger.debug(`Saved message ${message.id} to storage`);
    } catch (error) {
      this.logger.error('Error saving message to storage:', error);
    }
  }

  // Helper method to get the latest message from a messages map
  private getLatestMessage(messagesMap: Map<string, DirectMessage>): DirectMessage | null {
    if (messagesMap.size === 0) return null;

    return Array.from(messagesMap.values()).sort((a, b) => b.created_at - a.created_at)[0];
  }

  clear() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
    this.isLoading.set(false);
    this.isLoadingMoreChats.set(false);
    this.hasMoreChats.set(true);
    this.error.set(null);
  }

  reset() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
  }

  async load() {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot load messages: no account pubkey');
      return;
    }

    this.logger.info('Loading messages from storage...');

    try {
      // Load messages from IndexedDB first for instant display
      await this.database.init();
      const storedChats = await this.database.getChatsForAccount(myPubkey);

      this.logger.info(`Found ${storedChats.length} stored chats`);

      // Track the oldest message timestamp from stored messages
      let oldestStoredTimestamp: number | null = null;

      // Build chat map from stored messages - group by pubkey to merge NIP-04 and NIP-44 chats
      const chatsByPubkey = new Map<string, { messages: StoredDirectMessage[], unreadCount: number }>();

      for (const chatSummary of storedChats) {
        const messages = await this.database.getMessagesForChat(myPubkey, chatSummary.chatId);

        if (messages.length === 0) continue;

        // Extract pubkey from chatId (format: pubkey-nip04 or pubkey-nip44 for legacy, or just pubkey)
        let pubkey: string;
        if (chatSummary.chatId.endsWith('-nip04') || chatSummary.chatId.endsWith('-nip44')) {
          const parts = chatSummary.chatId.split('-');
          pubkey = parts.slice(0, -1).join('-');
        } else {
          pubkey = chatSummary.chatId;
        }

        // Validate pubkey - skip invalid chats
        if (!pubkey || pubkey === 'undefined' || pubkey.length < 10) {
          this.logger.warn('Skipping chat with invalid pubkey', { chatId: chatSummary.chatId, pubkey });
          continue;
        }

        // Merge messages for the same pubkey
        const existing = chatsByPubkey.get(pubkey);
        if (existing) {
          existing.messages.push(...messages);
          existing.unreadCount += chatSummary.unreadCount;
        } else {
          chatsByPubkey.set(pubkey, { messages: [...messages], unreadCount: chatSummary.unreadCount });
        }
      }

      // Now create chat objects from merged data
      for (const [pubkey, data] of chatsByPubkey.entries()) {
        const messagesMap = new Map<string, DirectMessage>();
        let lastMessage: DirectMessage | null = null;
        let hasLegacyMessages = false;

        for (const storedMsg of data.messages) {
          const dm: DirectMessage = {
            id: storedMsg.messageId,
            pubkey: storedMsg.pubkey,
            created_at: storedMsg.created_at,
            content: storedMsg.content,
            isOutgoing: storedMsg.isOutgoing,
            tags: storedMsg.tags,
            pending: storedMsg.pending,
            failed: storedMsg.failed,
            received: storedMsg.received,
            read: storedMsg.read,
            encryptionType: storedMsg.encryptionType,
            replyTo: this.getReplyToFromTags(storedMsg.tags || []),
          };

          messagesMap.set(dm.id, dm);

          if (!lastMessage || dm.created_at > lastMessage.created_at) {
            lastMessage = dm;
          }

          // Track if chat has any legacy messages
          if (storedMsg.encryptionType === 'nip04') {
            hasLegacyMessages = true;
          }

          // Track the oldest message timestamp across all chats
          if (oldestStoredTimestamp === null || dm.created_at < oldestStoredTimestamp) {
            oldestStoredTimestamp = dm.created_at;
          }
        }

        // Create the chat object - use pubkey as chatId
        const chat: Chat = {
          id: pubkey,
          pubkey: pubkey,
          unreadCount: data.unreadCount,
          lastMessage: lastMessage,
          encryptionType: 'nip44', // Default to modern encryption
          hasLegacyMessages: hasLegacyMessages,
          messages: messagesMap,
        };

        this.chatsMap.update(map => {
          const newMap = new Map(map);
          newMap.set(pubkey, chat);
          return newMap;
        });
      }

      // Set the oldest chat timestamp from stored messages so loadMoreChats uses correct starting point
      if (oldestStoredTimestamp !== null) {
        this.oldestChatTimestamp.set(oldestStoredTimestamp);
        this.logger.info(`Set oldest chat timestamp from storage: ${oldestStoredTimestamp} (${new Date(oldestStoredTimestamp * 1000).toISOString()})`);
      }

      this.logger.info(`Loaded ${storedChats.length} chats from storage`);
    } catch (error) {
      this.logger.error('Error loading messages from storage:', error);
    }
  }

  async createNip44Message(messageText: string, receiverPubkey: string, myPubkey: string) {
    try {
      // Step 1: Create the message (unsigned event) - kind 14
      const unsignedMessage = {
        kind: kinds.PrivateDirectMessage,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', receiverPubkey]],
        content: messageText,
      };

      // Calculate the message ID (but don't sign it)
      const rumorId = getEventHash(unsignedMessage);
      const rumorWithId = { ...unsignedMessage, id: rumorId };

      // Step 2: Create the seal (kind 13) - encrypt the rumor with sender's key
      const sealedContent = await this.encryption.encryptNip44(
        JSON.stringify(rumorWithId),
        receiverPubkey
      );

      const sealedMessage = {
        kind: kinds.Seal,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
        tags: [],
        content: sealedContent,
      };

      // Sign the sealed message
      const signedSealedMessage = await this.nostr.signEvent(sealedMessage);

      // Step 3: Create the gift wrap (kind 1059) - encrypt with ephemeral key
      // Generate a random ephemeral key for the gift wrap
      const ephemeralKey = generateSecretKey();
      const ephemeralPubkey = getPublicKey(ephemeralKey);

      // Encrypt the sealed message using the ephemeral key and recipient's pubkey
      const giftWrapContent = await this.encryption.encryptNip44WithKey(
        JSON.stringify(signedSealedMessage),
        bytesToHex(ephemeralKey),
        receiverPubkey
      );

      const giftWrap = {
        kind: kinds.GiftWrap,
        pubkey: ephemeralPubkey,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
        tags: [['p', receiverPubkey]],
        content: giftWrapContent,
      };

      // Sign the gift wrap with the ephemeral key
      const signedGiftWrap = finalizeEvent(giftWrap, ephemeralKey);

      // Step 4: Create the gift wrap for self (kind 1059) - same content but different tags in pubkey.
      // Should we use different ephemeral key for self? The content is the same anyway,
      // so correlation of messages (and pub keys who are chatting) can be done through the content of gift wrap.
      const giftWrapSelf = {
        kind: kinds.GiftWrap,
        pubkey: ephemeralPubkey,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
        tags: [['p', myPubkey]],
        content: giftWrapContent,
      };

      // Sign the gift wrap with the ephemeral key
      const signedGiftWrapSelf = finalizeEvent(giftWrapSelf, ephemeralKey);

      return {
        recipient: signedGiftWrap,
        sender: signedGiftWrapSelf,
      };

      // Return the message object based on the original rumor
      // return {
      //   id: rumorId,
      //   pubkey: myPubkey,
      //   created_at: unsignedMessage.created_at,
      //   content: messageText,
      //   isOutgoing: true,
      //   tags: unsignedMessage.tags,
      //   encryptionType: 'nip44'
      // };
    } catch (error) {
      this.logger.error('Failed to send NIP-44 message', error);
      throw error;
    }
  }

  /**
   * Refresh chats to catch any messages that were missed while the page was closed.
   * This does an incremental sync from the last check timestamp.
   * Unlike loadChats(), this is faster as it only fetches new messages.
   */
  async refreshChats(): Promise<void> {
    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.logger.warn('Cannot refresh chats: no account pubkey');
      return;
    }

    // Don't refresh if already loading
    if (this.isLoading()) {
      this.logger.debug('Already loading chats, skipping refresh');
      return;
    }

    const lastCheck = this.accountLocalState.getMessagesLastCheck(myPubkey);

    if (!lastCheck) {
      // No last check timestamp, do a full load instead
      this.logger.debug('No lastCheck timestamp, doing full load');
      return this.loadChats();
    }

    // NIP-17 gift wraps have randomized timestamps up to 2 days (172800 seconds) in the past for privacy.
    // We need to use a buffer that accounts for this when refreshing.
    // Use the larger of: lastCheck - 3 days, or 0
    const NIP17_TIMESTAMP_BUFFER = 259200; // 3 days in seconds
    const since = Math.max(0, lastCheck - NIP17_TIMESTAMP_BUFFER);

    this.logger.info(`Refreshing messages since: ${new Date(since * 1000).toISOString()} (with NIP-17 3-day buffer)`);

    // Query both incoming messages (where we're tagged) AND outgoing (from us)
    // This catches messages sent from other devices logged into the same account
    const filterIncoming: Filter = {
      kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
      '#p': [myPubkey],
      since: since,
    };

    const filterOutgoing: Filter = {
      kinds: [kinds.EncryptedDirectMessage],
      authors: [myPubkey],
      since: since,
    };

    try {
      // Collect all relays to query
      // Include: DM relays, account relays, AND discovery relays
      // Discovery relays are popular relays where messages might be published by senders
      // who couldn't discover our DM relays
      const dmRelayUrls = await this.getDmRelayUrls(myPubkey);
      const accountRelays = this.relay.getRelayUrls();
      const discoveryRelays = this.discoveryRelay.getRelayUrls();
      const allRelays = [...new Set([...dmRelayUrls, ...accountRelays, ...discoveryRelays])];

      console.log('[MessagingService] refreshChats relay setup:', {
        dmRelayUrls,
        accountRelays,
        discoveryRelays,
        allRelays,
      });

      if (allRelays.length === 0) {
        this.logger.warn('No relays available for refresh');
        return;
      }

      // Query for incoming messages
      const incomingEvents = await this.pool.query(allRelays, filterIncoming, 15000);
      this.logger.info(`Found ${incomingEvents.length} incoming events during refresh`);

      for (const event of incomingEvents) {
        await this.processIncomingEvent(event, myPubkey);
      }

      // Query for outgoing NIP-04 messages (outgoing NIP-44 are already caught via #p tag)
      const outgoingEvents = await this.pool.query(accountRelays, filterOutgoing, 15000);
      this.logger.info(`Found ${outgoingEvents.length} outgoing NIP-04 events during refresh`);

      for (const event of outgoingEvents) {
        await this.processIncomingEvent(event, myPubkey);
      }

      // Update lastCheck timestamp
      const now = this.utilities.currentDate();
      this.accountLocalState.setMessagesLastCheck(myPubkey, now);

      this.logger.info('Chat refresh complete');
    } catch (err) {
      this.logger.error('Error refreshing chats:', err);
    }
  }

  /**
   * Process an incoming DM event (either GiftWrap or EncryptedDirectMessage)
   */
  private async processIncomingEvent(event: NostrEvent, myPubkey: string): Promise<void> {
    try {
      if (event.kind === kinds.GiftWrap) {
        const unwrappedMessage = await this.unwrapMessageInternal(event);
        if (!unwrappedMessage) return;

        let targetPubkey: string;
        if (unwrappedMessage.pubkey === myPubkey) {
          const pTags = this.utilities.getPTagsValuesFromEvent(unwrappedMessage);
          if (pTags.length > 0 && pTags[0]) {
            targetPubkey = pTags[0];
          } else {
            return;
          }
        } else {
          targetPubkey = unwrappedMessage.pubkey;
        }

        if (!targetPubkey || targetPubkey === myPubkey) return;

        // Check if message already exists to prevent duplicates
        if (this.hasMessage(targetPubkey, unwrappedMessage.id)) {
          this.logger.debug(`NIP-44 message ${unwrappedMessage.id} already exists, skipping`);
          return;
        }

        const directMessage: DirectMessage = {
          id: unwrappedMessage.id,
          pubkey: unwrappedMessage.pubkey,
          created_at: unwrappedMessage.created_at,
          content: unwrappedMessage.content,
          tags: unwrappedMessage.tags || [],
          isOutgoing: unwrappedMessage.pubkey === myPubkey,
          pending: false,
          failed: false,
          received: true,
          read: false,
          encryptionType: 'nip44',
          replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
        };

        this.addMessageToChat(targetPubkey, directMessage);
      } else if (event.kind === kinds.EncryptedDirectMessage) {
        let targetPubkey = event.pubkey;

        if (targetPubkey === myPubkey) {
          const pTags = this.utilities.getPTagsValuesFromEvent(event);
          if (pTags.length > 0) {
            targetPubkey = pTags[0];
          } else {
            return;
          }
        }

        if (this.hasMessage(targetPubkey, event.id)) return;

        const unwrappedMessage = await this.unwrapNip04Message(event);
        if (!unwrappedMessage) return;

        const directMessage: DirectMessage = {
          id: unwrappedMessage.id,
          pubkey: unwrappedMessage.pubkey,
          created_at: unwrappedMessage.created_at,
          content: unwrappedMessage.content,
          tags: unwrappedMessage.tags || [],
          isOutgoing: event.pubkey === myPubkey,
          pending: false,
          failed: false,
          received: true,
          read: false,
          encryptionType: 'nip04',
          replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
        };

        this.addMessageToChat(targetPubkey, directMessage);
      }
    } catch (err) {
      this.logger.error('Error processing incoming event:', err);
    }
  }

  async loadChats() {
    // Don't clear if we're doing an incremental sync
    // Only clear if this is a fresh load (no stored messages)
    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.error.set('You need to be logged in to view messages');
      this.isLoading.set(false);
      return;
    }

    // Check if we have any stored messages
    const lastCheck = this.accountLocalState.getMessagesLastCheck(myPubkey);
    const isIncrementalSync = lastCheck && lastCheck > 0;

    if (!isIncrementalSync) {
      // First time load - clear everything
      this.clear();
    }

    this.isLoading.set(true);

    try {
      // Load messages from storage first
      await this.load();

      // For extension users, we'll let the individual decryption requests handle permission
      // Don't block chat loading - just log the info
      if (this.encryptionPermission.needsPermission()) {
        this.logger.info('Extension user - decryption requests will be queued for permission');
      }

      // Get the last check timestamp to only fetch new messages
      const since = lastCheck || undefined;

      this.logger.info(`Loading messages since: ${since ? new Date(since * 1000).toISOString() : 'beginning'} (incremental: ${isIncrementalSync})`);

      // This contains both incoming and outgoing messages for Giftwrapped messages.
      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        limit: this.MESSAGE_SIZE,
        since: since,
      };

      const filterSent: Filter = {
        kinds: [kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        limit: this.MESSAGE_SIZE,
        since: since, // Add since filter to outgoing messages too
      };

      // Store pubkeys of people who've messaged us
      // const chatPubkeys = new Set<string>();
      let oldestTimestamp = this.oldestChatTimestamp() || this.utilities.currentDate();

      // Track pending decryption promises so we can wait for them
      const pendingDecryptions: Promise<void>[] = [];

      // First, look for existing gift-wrapped messages
      const sub1 = this.relay.subscribe(
        filterReceived,
        (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < oldestTimestamp) {
            oldestTimestamp = event.created_at;
          }
          // Handle incoming wrapped events
          if (event.kind === kinds.GiftWrap) {
            // Push the async processing to pending array so we can wait for it
            const processPromise = (async () => {
              try {
                const wrappedevent = await this.unwrapMessageInternal(event);

                if (!wrappedevent) {
                  this.logger.debug('Failed to unwrap gift-wrapped message', { eventId: event.id });
                  return;
                }

                // Create a DirectMessage object from the unwrapped content
                const directMessage: DirectMessage = {
                  id: wrappedevent.id,
                  pubkey: wrappedevent.pubkey,
                  created_at: wrappedevent.created_at,
                  content: wrappedevent.content,
                  tags: wrappedevent.tags || [],
                  isOutgoing: wrappedevent.pubkey === myPubkey,
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: 'nip44', // Gift-wrapped messages are NIP-44
                  replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
                };

                let targetPubkey = wrappedevent.pubkey;

                // If this is outgoing, it means the target is in the tags on the kind 14.
                if (directMessage.isOutgoing) {
                  const pTags = this.utilities.getPTagsValuesFromEvent(wrappedevent);
                  if (pTags.length > 0 && pTags[0]) {
                    targetPubkey = pTags[0];
                  } else {
                    // No valid recipient found, skip this message
                    this.logger.warn('NIP-44 outgoing message has no valid recipient p-tag, skipping', { eventId: wrappedevent.id });
                    return;
                  }
                } else {
                  // For incoming messages, validate that the sender pubkey is valid
                  if (!targetPubkey || targetPubkey === myPubkey) {
                    this.logger.warn('NIP-44 incoming message has invalid sender pubkey, skipping', { eventId: wrappedevent.id });
                    return;
                  }
                }

                // Add the message to the chat
                this.addMessageToChat(targetPubkey, directMessage);
              } catch (err) {
                this.logger.error('Error processing GiftWrap event:', err);
              }
            })();
            pendingDecryptions.push(processPromise);
          } else {
            // Handle incoming NIP-04 direct messages
            if (event.kind === kinds.EncryptedDirectMessage) {
              let targetPubkey = event.pubkey;

              // Target pubkey:
              if (targetPubkey === myPubkey) {
                // If the event pubkey is our own, we are the sender
                // We need to check 'p' tags for recipients
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  // If we have p-tags, use the first one as the recipient
                  targetPubkey = pTags[0];
                } else {
                  // No p-tags, we can't unwrap this message
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                return; // Skip if we already have this message
              }

              // Push the async processing to pending array so we can wait for it
              const nip04Promise = (async () => {
                try {
                  const unwrappedMessage = await this.unwrapNip04Message(event);

                  if (!unwrappedMessage) {
                    this.logger.warn('Failed to unwrap NIP-04 message', event);
                    return;
                  }

                  // Create a DirectMessage object from the unwrapped content
                  const directMessage: DirectMessage = {
                    id: unwrappedMessage.id,
                    pubkey: unwrappedMessage.pubkey,
                    created_at: unwrappedMessage.created_at,
                    content: unwrappedMessage.content,
                    tags: unwrappedMessage.tags || [],
                    isOutgoing: event.pubkey === myPubkey,
                    pending: false,
                    failed: false,
                    received: true,
                    read: false,
                    encryptionType: 'nip04',
                    replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
                  };

                  // Add the message to the chat
                  this.addMessageToChat(targetPubkey, directMessage);
                } catch (err) {
                  this.logger.error('Error processing NIP-04 event:', err);
                }
              })();
              pendingDecryptions.push(nip04Promise);
            }
          }
        },
        async () => {
          console.log('End of data for incoming messages.');

          // Wait for all pending decryption operations to complete
          this.logger.info(`Waiting for ${pendingDecryptions.length} pending decryption operations...`);
          await Promise.all(pendingDecryptions);
          this.logger.info('All decryption operations complete');

          // Update the oldest timestamp for loading more chats
          this.oldestChatTimestamp.set(oldestTimestamp);

          // ...existing code...

          this.isLoading.set(false);
        }
      );

      // Track pending decryptions for sub2 as well
      const pendingDecryptions2: Promise<void>[] = [];

      const sub2 = this.relay.subscribe(
        filterSent,
        (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < oldestTimestamp) {
            oldestTimestamp = event.created_at;
          }
          // Handle incoming wrapped events
          if (event.kind === kinds.GiftWrap) {
            const processPromise = (async () => {
              try {
                const wrappedevent = await this.unwrapMessageInternal(event);

                if (!wrappedevent) {
                  this.logger.warn('Failed to unwrap gift-wrapped message', event);
                  return;
                }

                // Create a DirectMessage object from the unwrapped content
                const directMessage: DirectMessage = {
                  id: wrappedevent.id,
                  pubkey: wrappedevent.pubkey,
                  created_at: wrappedevent.created_at,
                  content: wrappedevent.content,
                  tags: wrappedevent.tags || [],
                  isOutgoing: wrappedevent.pubkey === myPubkey,
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: 'nip44',
                  replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
                };

                let targetPubkey = wrappedevent.pubkey;

                // If this is outgoing, it means the target is in the tags on the kind 14.
                if (directMessage.isOutgoing) {
                  const pTags = this.utilities.getPTagsValuesFromEvent(wrappedevent);
                  if (pTags.length > 0 && pTags[0]) {
                    targetPubkey = pTags[0];
                  } else {
                    this.logger.warn('NIP-44 outgoing message has no valid recipient p-tag, skipping', { eventId: wrappedevent.id });
                    return;
                  }
                } else {
                  if (!targetPubkey || targetPubkey === myPubkey) {
                    this.logger.warn('NIP-44 incoming message has invalid sender pubkey, skipping', { eventId: wrappedevent.id });
                    return;
                  }
                }

                this.addMessageToChat(targetPubkey, directMessage);
              } catch (err) {
                this.logger.error('Error processing GiftWrap event in sub2:', err);
              }
            })();
            pendingDecryptions2.push(processPromise);
          } else {
            // Handle incoming NIP-04 direct messages
            if (event.kind === kinds.EncryptedDirectMessage) {
              let targetPubkey = event.pubkey;

              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                return;
              }

              const nip04Promise = (async () => {
                try {
                  const unwrappedMessage = await this.unwrapNip04Message(event);

                  if (!unwrappedMessage) {
                    this.logger.warn('Failed to unwrap NIP-04 message', event);
                    return;
                  }

                  const directMessage: DirectMessage = {
                    id: unwrappedMessage.id,
                    pubkey: unwrappedMessage.pubkey,
                    created_at: unwrappedMessage.created_at,
                    content: unwrappedMessage.content,
                    tags: unwrappedMessage.tags || [],
                    isOutgoing: event.pubkey === myPubkey,
                    pending: false,
                    failed: false,
                    received: true,
                    read: false,
                    encryptionType: 'nip04',
                    replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
                  };

                  this.addMessageToChat(targetPubkey, directMessage);
                } catch (err) {
                  this.logger.error('Error processing NIP-04 event in sub2:', err);
                }
              })();
              pendingDecryptions2.push(nip04Promise);
            }
          }
        },
        async () => {
          console.log('End of data for incoming messages.');

          // Wait for all pending decryption operations to complete
          this.logger.info(`Waiting for ${pendingDecryptions2.length} pending decryption operations (sub2)...`);
          await Promise.all(pendingDecryptions2);
          this.logger.info('All decryption operations complete (sub2)');

          // Update the oldest timestamp for loading more chats
          this.oldestChatTimestamp.set(oldestTimestamp);

          // Update the last check timestamp only if we have some chats loaded
          // This prevents setting lastCheck when an incremental load finds nothing
          // which would prevent future full loads from working
          const hasChats = this.chatsMap().size > 0;
          if (!isIncrementalSync || hasChats) {
            const now = this.utilities.currentDate();
            this.accountLocalState.setMessagesLastCheck(myPubkey, now);
          }

          // ...existing code...

          this.isLoading.set(false);
        }
      );

      // Also query DM relays (kind 10050) for messages that may have been sent to those relays
      // This ensures we fetch messages from both account relays and DM-specific relays
      // Note: This runs in parallel with the account relay subscriptions
      await this.queryDmRelaysForMessages(myPubkey, filterReceived);

      // Convert to array of Chat objects
    } catch (err) {
      this.logger.error('Failed to load chats', err);
      this.error.set('Failed to load chats. Please try again.');
      this.isLoading.set(false);
    }
  }

  /**
   * Query DM relays (from kind 10050) and discovery relays for messages.
   * This supplements the main subscription by also checking DM-specific and discovery relays.
   */
  private async queryDmRelaysForMessages(myPubkey: string, filter: Filter): Promise<void> {
    try {
      // Get DM relay URLs from kind 10050
      const dmRelayEvent = await this.database.getEventByPubkeyAndKind(myPubkey, kinds.DirectMessageRelaysList);

      const dmRelayUrls = dmRelayEvent?.tags
        .filter(t => t[0] === 'relay' && t[1])
        .map(t => t[1]) || [];

      // Get discovery relay URLs
      const discoveryRelays = this.discoveryRelay.getRelayUrls();

      // Combine all relays
      const allAdditionalRelays = [...new Set([...dmRelayUrls, ...discoveryRelays])];

      if (allAdditionalRelays.length === 0) {
        this.logger.debug('No additional relays (DM or discovery) to query');
        return;
      }

      // Check which relays are different from account relays
      const accountRelays = new Set(this.relay.getRelayUrls());
      const uniqueRelays = allAdditionalRelays.filter(url => !accountRelays.has(url));

      if (uniqueRelays.length === 0) {
        this.logger.debug('All additional relays are same as account relays, skipping duplicate query');
        return;
      }

      this.logger.info('Querying additional relays (DM + discovery) for messages', {
        relayCount: uniqueRelays.length,
        relays: uniqueRelays,
      });

      // Query all additional relays for messages
      const events = await this.pool.query(uniqueRelays, filter, 10000);

      this.logger.info(`Found ${events.length} events from additional relays`);

      // Process each event
      for (const event of events) {
        try {
          if (event.kind === kinds.GiftWrap) {
            const unwrappedMessage = await this.unwrapMessageInternal(event);
            if (!unwrappedMessage) continue;

            let targetPubkey: string;
            if (unwrappedMessage.pubkey === myPubkey) {
              const pTags = this.utilities.getPTagsValuesFromEvent(unwrappedMessage);
              if (pTags.length > 0 && pTags[0]) {
                targetPubkey = pTags[0];
              } else {
                continue;
              }
            } else {
              targetPubkey = unwrappedMessage.pubkey;
            }

            if (!targetPubkey || targetPubkey === myPubkey) continue;

            const directMessage: DirectMessage = {
              id: unwrappedMessage.id,
              pubkey: unwrappedMessage.pubkey,
              created_at: unwrappedMessage.created_at,
              content: unwrappedMessage.content,
              tags: unwrappedMessage.tags || [],
              isOutgoing: unwrappedMessage.pubkey === myPubkey,
              pending: false,
              failed: false,
              received: true,
              read: false,
              encryptionType: 'nip44',
              replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
            };

            this.addMessageToChat(targetPubkey, directMessage);
          } else if (event.kind === kinds.EncryptedDirectMessage) {
            let targetPubkey = event.pubkey;

            if (targetPubkey === myPubkey) {
              const pTags = this.utilities.getPTagsValuesFromEvent(event);
              if (pTags.length > 0) {
                targetPubkey = pTags[0];
              } else {
                continue;
              }
            }

            if (this.hasMessage(targetPubkey, event.id)) continue;

            const unwrappedMessage = await this.unwrapNip04Message(event);
            if (!unwrappedMessage) continue;

            const directMessage: DirectMessage = {
              id: unwrappedMessage.id,
              pubkey: unwrappedMessage.pubkey,
              created_at: unwrappedMessage.created_at,
              content: unwrappedMessage.content,
              tags: unwrappedMessage.tags || [],
              isOutgoing: event.pubkey === myPubkey,
              pending: false,
              failed: false,
              received: true,
              read: false,
              encryptionType: 'nip04',
              replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
            };

            this.addMessageToChat(targetPubkey, directMessage);
          }
        } catch (err) {
          this.logger.error('Error processing event from additional relay:', err);
        }
      }
    } catch (err) {
      this.logger.error('Error querying additional relays for messages:', err);
    }
  }

  // Store active live subscription reference for cleanup
  private liveSubscription: { close: () => void } | null = null;

  /**
   * Get the relay URLs to use for DM subscriptions.
   * First tries to get DM relays from kind 10050 (NIP-17),
   * falls back to account relays if no DM relays are configured.
   */
  private async getDmRelayUrls(pubkey: string): Promise<string[]> {
    // Try to get DM relay list (kind 10050) from storage or relay
    const dmRelayEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.DirectMessageRelaysList);

    if (dmRelayEvent) {
      // Extract relay URLs from 'relay' tags
      const dmRelayUrls = dmRelayEvent.tags
        .filter(t => t[0] === 'relay' && t[1])
        .map(t => t[1]);

      if (dmRelayUrls.length > 0) {
        this.logger.info('Using DM relays from kind 10050', { count: dmRelayUrls.length, relays: dmRelayUrls });
        return dmRelayUrls;
      }
    }

    // Fall back to account relays
    const accountRelays = this.relay.getRelayUrls();
    this.logger.info('No DM relays found, using account relays', { count: accountRelays.length });
    return accountRelays;
  }

  /**
   * Subscribe to real-time incoming direct messages.
   * Opens a persistent subscription that stays open until explicitly closed.
   * This is automatically called when the user logs in and closed when they log out.
   * Uses DM relays (kind 10050) if available, falls back to account relays.
   * @returns A subscription object with a close() method for cleanup
   */
  async subscribeToIncomingMessages(): Promise<{ close: () => void } | null> {
    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.logger.warn('Cannot subscribe to messages: no account pubkey');
      return null;
    }

    // Close any existing live subscription before creating a new one
    if (this.liveSubscription) {
      this.logger.info('Closing existing live message subscription');
      this.liveSubscription.close();
      this.liveSubscription = null;
    }

    // Get all relay URLs (combine DM relays, account relays, and discovery relays)
    // Discovery relays ensure we catch messages from senders who couldn't find our DM relays
    const dmRelayUrls = await this.getDmRelayUrls(myPubkey);
    const accountRelays = this.relay.getRelayUrls();
    const discoveryRelays = this.discoveryRelay.getRelayUrls();
    const allRelays = [...new Set([...dmRelayUrls, ...accountRelays, ...discoveryRelays])];

    console.log('[MessagingService] subscribeToIncomingMessages relay setup:', {
      dmRelayUrls,
      accountRelays,
      discoveryRelays,
      allRelays,
    });

    if (allRelays.length === 0) {
      this.logger.warn('Cannot subscribe to messages: no relays available');
      return null;
    }

    // NIP-17 gift wraps have randomized timestamps up to 2 days (172800 seconds) in the past for privacy.
    // We need to use a buffer that accounts for this, plus some extra margin.
    // Using 3 days (259200 seconds) to be safe.
    const NIP17_TIMESTAMP_BUFFER = 259200; // 3 days in seconds
    const since = this.utilities.currentDate() - NIP17_TIMESTAMP_BUFFER;

    // Filter for messages where we're tagged (incoming NIP-04/NIP-44, and our own outgoing NIP-44)
    const filterTagged: Filter = {
      kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
      '#p': [myPubkey],
      since: since,
    };

    // Filter for outgoing NIP-04 messages (authored by us)
    const filterAuthored: Filter = {
      kinds: [kinds.EncryptedDirectMessage],
      authors: [myPubkey],
      since: since,
    };

    console.log('[MessagingService] subscribeToIncomingMessages filters:', {
      filterTagged,
      filterAuthored,
      sinceDate: new Date(since * 1000).toISOString(),
      bufferDays: NIP17_TIMESTAMP_BUFFER / 86400,
    });

    this.logger.info('Opening live subscription for DMs', {
      since: new Date(since * 1000).toISOString(),
      relayCount: allRelays.length,
      relays: allRelays,
    });

    // Track processed event IDs to avoid duplicates
    const processedEventIds = new Set<string>();

    const processEvent = async (event: NostrEvent) => {
      // Skip if already processed
      if (processedEventIds.has(event.id)) {
        return;
      }
      processedEventIds.add(event.id);

      this.logger.debug('Received real-time DM event', { kind: event.kind, id: event.id });

      try {
        if (event.kind === kinds.GiftWrap) {
          // Handle NIP-44 gift-wrapped message
          const unwrappedMessage = await this.unwrapMessageInternal(event);
          if (!unwrappedMessage) {
            this.logger.warn('Live subscription: Failed to unwrap gift-wrapped message', { eventId: event.id });
            return;
          }

          // Determine the chat partner pubkey
          let targetPubkey: string;
          if (unwrappedMessage.pubkey === myPubkey) {
            // Outgoing message - get recipient from p tag
            targetPubkey = unwrappedMessage.tags.find((t: string[]) => t[0] === 'p')?.[1];
          } else {
            // Incoming message - sender is the pubkey
            targetPubkey = unwrappedMessage.pubkey;
          }

          if (!targetPubkey || targetPubkey === 'undefined') {
            this.logger.warn('Live subscription: Could not determine target pubkey from gift wrap');
            return;
          }

          this.logger.info('Live subscription: Successfully unwrapped NIP-44 message', {
            eventId: event.id,
            targetPubkey: targetPubkey.slice(0, 16) + '...',
            isOutgoing: unwrappedMessage.pubkey === myPubkey,
          });

          const directMessage: DirectMessage = {
            id: unwrappedMessage.id,
            pubkey: unwrappedMessage.pubkey,
            created_at: unwrappedMessage.created_at,
            content: unwrappedMessage.content,
            tags: unwrappedMessage.tags || [],
            isOutgoing: unwrappedMessage.pubkey === myPubkey,
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip44',
            replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
          };

          this.addMessageToChat(targetPubkey, directMessage);
        } else if (event.kind === kinds.EncryptedDirectMessage) {
          // Handle NIP-04 legacy encrypted message
          const unwrappedMessage = await this.unwrapNip04MessageInternal(event);
          if (!unwrappedMessage) {
            this.logger.warn('Live subscription: Failed to unwrap NIP-04 message', { eventId: event.id });
            return;
          }

          // For NIP-04, determine chat partner
          let targetPubkey: string;
          if (event.pubkey === myPubkey) {
            // Outgoing - get recipient from p tag
            const pTags = this.utilities.getPTagsValuesFromEvent(event);
            targetPubkey = pTags[0];
          } else {
            // Incoming - sender is pubkey
            targetPubkey = event.pubkey;
          }

          if (!targetPubkey || targetPubkey === 'undefined') {
            this.logger.warn('Live subscription: Could not determine target pubkey from NIP-04 message');
            return;
          }

          this.logger.info('Live subscription: Successfully unwrapped NIP-04 message', {
            eventId: event.id,
            targetPubkey: targetPubkey.slice(0, 16) + '...',
            isOutgoing: event.pubkey === myPubkey,
          });

          const directMessage: DirectMessage = {
            id: unwrappedMessage.id,
            pubkey: unwrappedMessage.pubkey,
            created_at: unwrappedMessage.created_at,
            content: unwrappedMessage.content,
            tags: unwrappedMessage.tags || [],
            isOutgoing: event.pubkey === myPubkey,
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip04',
            replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
          };

          this.addMessageToChat(targetPubkey, directMessage);
        }
      } catch (err) {
        this.logger.error('Error processing real-time DM event:', err);
      }
    };

    // Subscribe to messages where we're tagged (incoming + our outgoing NIP-44)
    const sub1 = this.pool.subscribe(allRelays, filterTagged, processEvent);

    // Subscribe to our outgoing NIP-04 messages
    const sub2 = this.pool.subscribe(accountRelays, filterAuthored, processEvent);

    // Create combined subscription object
    const combinedSub = {
      close: () => {
        this.logger.info('Closing live message subscriptions');
        sub1.close();
        sub2.close();
      },
    };

    this.liveSubscription = combinedSub;
    return combinedSub;
  }

  /**
   * Close the live incoming messages subscription.
   * Call this when leaving the Messages page.
   */
  closeLiveSubscription(): void {
    if (this.liveSubscription) {
      this.logger.info('Closing live message subscription');
      this.liveSubscription.close();
      this.liveSubscription = null;
    }
  }

  /**
   * Unwrap and decrypt a NIP-04 direct message
   */
  async unwrapNip04Message(event: NostrEvent): Promise<any | null> {
    return await this.unwrapNip04MessageInternal(event);
  }

  /**
   * Internal unwrap and decrypt a NIP-04 direct message
   */
  private async unwrapNip04MessageInternal(event: NostrEvent): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    try {
      // For NIP-04 messages, the sender is the event pubkey
      const tags = this.utilities.getPTagsValuesFromEvent(event);

      if (tags.length === 0) {
        return null;
      } else if (tags.length > 1) {
        // NIP-04 only supports one recipient, yet some clients have sent DMs with more. Ignore those.
        this.logger.warn('NIP-04 message has multiple recipients, ignoring.', event);
        return null;
      }

      // If we are the sender, get the pubkey from 'p' tag.
      // If we are the receiver, use the event pubkey.
      let decryptionPubkey = event.pubkey;

      if (decryptionPubkey === myPubkey) {
        if (tags.length > 0) {
          decryptionPubkey = tags[0]; // Use the first 'p' tag as the recipient
        }
      }

      // Use the EncryptionService to decrypt
      const decryptionResult = await this.encryption.autoDecrypt(
        event.content,
        decryptionPubkey,
        event
      );

      // Return the message with decrypted content
      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        content: decryptionResult.content,
        tags: event.tags,
      };
    } catch (err) {
      this.logger.error('Failed to decrypt NIP-04 message', err);
      return null;
    }
  }

  /**
   * Internal unwrap and decrypt a gift-wrapped message (direct processing)
   */
  private async unwrapMessageInternal(wrappedEvent: any): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    try {
      // Check if this message is for us
      const recipient = wrappedEvent.tags.find((t: string[]) => t[0] === 'p')?.[1];
      if (recipient !== myPubkey && wrappedEvent.pubkey !== myPubkey) {
        return null;
      }

      // The "wrappedEvent.pubkey" is a random pubkey used to wrap the message. We must use recipient pubkey to decrypt the wrapped content.
      // const wrappedPubkey = recipient;
      // const wrappedPubkey = wrappedEvent.pubkey;

      // First decrypt the wrapped content using the EncryptionService
      // This will handle both browser extension and direct decryption
      let wrappedContent: any;
      try {
        const decryptionResult = await this.encryption.autoDecrypt(
          wrappedEvent.content,
          wrappedEvent.pubkey,
          wrappedEvent
        );
        wrappedContent = JSON.parse(decryptionResult.content);
      } catch (err) {
        this.logger.debug('Failed to decrypt wrapped content', { eventId: wrappedEvent.id });
        return null;
      }

      // Get the sealed message
      let sealedEvent;
      if (wrappedEvent.pubkey === myPubkey) {
        // This will never happen for NIP-44?
        // If we sent it, we can directly use the encryptedMessage
        sealedEvent = wrappedContent.encryptedMessage;
      } else {
        // Decrypt the sealed content using the EncryptionService
        try {
          const sealedDecryptionResult = await this.encryption.autoDecrypt(
            wrappedContent.content,
            wrappedContent.pubkey,
            wrappedEvent
          );
          sealedEvent = JSON.parse(sealedDecryptionResult.content);
        } catch (err) {
          this.logger.error('Failed to decrypt sealed content', err);
          return null;
        }
      }

      if (wrappedContent.pubkey !== sealedEvent.pubkey) {
        throw new Error('Decrypted message pubkey does not match wrapped content pubkey');
      }

      // Return the final decrypted message
      return {
        ...sealedEvent,
      };
    } catch (err) {
      this.logger.error('Failed to unwrap message', err);
      throw err;
    }
  }

  /**
   * Load more (older) messages for a specific chat
   */
  async loadMoreMessages(chatId: string, beforeTimestamp?: number): Promise<DirectMessage[]> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      throw new Error('User not authenticated');
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }

    // Determine the oldest timestamp to fetch from
    let until = beforeTimestamp;
    if (!until) {
      const currentMessages = this.getChatMessages(chatId);
      if (currentMessages.length === 0) {
        until = this.utilities.currentDate(); // Current timestamp
      } else {
        until = Math.min(...currentMessages.map(m => m.created_at)) - 1;
      }
    }

    // Query both NIP-04 and NIP-44 messages for merged chats
    const messageKinds = [kinds.EncryptedDirectMessage, kinds.GiftWrap];

    this.logger.debug(
      `Loading more messages for chat ${chatId}, until: ${until}`
    );

    // Create filters for both received and sent messages
    const filterReceived: Filter = {
      kinds: messageKinds,
      authors: [chat.pubkey],
      '#p': [myPubkey],
      until: until,
      limit: this.MESSAGE_SIZE,
    };

    const filterSent: Filter = {
      kinds: messageKinds,
      authors: [myPubkey],
      '#p': [chat.pubkey],
      until: until,
      limit: this.MESSAGE_SIZE,
    };

    const loadedMessages: DirectMessage[] = [];

    try {
      // Use subscribe with EOSE to get historical messages
      await new Promise<void>((resolve, reject) => {
        const sub = this.relay.subscribe(
          filterReceived,
          async (event: NostrEvent) => {
            try {
              // Skip if we already have this message
              if (this.hasMessage(chatId, event.id)) {
                return;
              }

              let decryptedMessage: any = null;

              if (event.kind === kinds.EncryptedDirectMessage) {
                // Handle NIP-04 messages
                decryptedMessage = await this.unwrapNip04MessageInternal(event);
              } else if (event.kind === kinds.GiftWrap) {
                // Handle NIP-44 wrapped messages
                decryptedMessage = await this.unwrapMessageInternal(event);
              }

              if (decryptedMessage) {
                // Determine if this is an outgoing message
                const isOutgoing = event.pubkey === myPubkey;

                // Determine the other party's pubkey
                let otherPubkey = chat.pubkey;
                if (event.kind === kinds.EncryptedDirectMessage) {
                  // For NIP-04, get the other party from 'p' tags
                  const pTags = this.utilities.getPTagsValuesFromEvent(event);
                  if (isOutgoing && pTags.length > 0) {
                    otherPubkey = pTags[0];
                  } else if (!isOutgoing) {
                    otherPubkey = event.pubkey;
                  }
                }

                const directMessage: DirectMessage = {
                  id: decryptedMessage.id,
                  pubkey: otherPubkey,
                  created_at: decryptedMessage.created_at,
                  content: decryptedMessage.content,
                  isOutgoing: isOutgoing,
                  tags: decryptedMessage.tags || [],
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: event.kind === kinds.EncryptedDirectMessage ? 'nip04' : 'nip44',
                };

                loadedMessages.push(directMessage);
                this.addMessageToChat(otherPubkey, directMessage);
              }
            } catch (error) {
              this.logger.error('Failed to process older message:', error);
            }
          },
          () => {
            // EOSE callback - end of stored events
            (sub as { close: () => void })?.close?.();
            resolve();
          }
        );

        // Set a timeout to prevent hanging
        setTimeout(() => {
          (sub as { close: () => void })?.close?.();
          resolve();
        }, 10000);
      });

      await new Promise<void>((resolve, reject) => {
        const sub = this.relay.subscribe(
          filterSent,
          async (event: NostrEvent) => {
            try {
              // Skip if we already have this message
              if (this.hasMessage(chatId, event.id)) {
                return;
              }

              let decryptedMessage: any = null;

              if (event.kind === kinds.EncryptedDirectMessage) {
                // Handle NIP-04 messages
                decryptedMessage = await this.unwrapNip04MessageInternal(event);
              } else if (event.kind === kinds.GiftWrap) {
                // Handle NIP-44 wrapped messages
                decryptedMessage = await this.unwrapMessageInternal(event);
              }

              if (decryptedMessage) {
                // Determine if this is an outgoing message
                const isOutgoing = event.pubkey === myPubkey;

                // Determine the other party's pubkey
                let otherPubkey = chat.pubkey;
                if (event.kind === kinds.EncryptedDirectMessage) {
                  // For NIP-04, get the other party from 'p' tags
                  const pTags = this.utilities.getPTagsValuesFromEvent(event);
                  if (isOutgoing && pTags.length > 0) {
                    otherPubkey = pTags[0];
                  } else if (!isOutgoing) {
                    otherPubkey = event.pubkey;
                  }
                }

                const directMessage: DirectMessage = {
                  id: decryptedMessage.id,
                  pubkey: otherPubkey,
                  created_at: decryptedMessage.created_at,
                  content: decryptedMessage.content,
                  isOutgoing: isOutgoing,
                  tags: decryptedMessage.tags || [],
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: event.kind === kinds.EncryptedDirectMessage ? 'nip04' : 'nip44',
                };

                loadedMessages.push(directMessage);
                this.addMessageToChat(otherPubkey, directMessage);
              }
            } catch (error) {
              this.logger.error('Failed to process older message:', error);
            }
          },
          () => {
            // EOSE callback - end of stored events
            (sub as { close: () => void })?.close?.();
            resolve();
          }
        );

        // Set a timeout to prevent hanging
        setTimeout(() => {
          (sub as { close: () => void })?.close?.();
          resolve();
        }, 10000);
      });

      this.logger.debug(`Loaded ${loadedMessages.length} older messages for chat ${chatId}`);
      return loadedMessages.sort((a, b) => a.created_at - b.created_at);
    } catch (error) {
      this.logger.error('Failed to load more messages:', error);
      throw error;
    }
  }
  /**
   * Load more (older) chats by fetching older messages
   */
  async loadMoreChats(): Promise<void> {
    if (this.isLoadingMoreChats() || !this.hasMoreChats()) {
      return;
    }

    this.isLoadingMoreChats.set(true);
    this.error.set(null);

    try {
      const myPubkey = this.accountState.pubkey();
      if (!myPubkey) {
        this.error.set('You need to be logged in to view messages');
        this.isLoadingMoreChats.set(false);
        return;
      }

      const oldestTimestamp = this.oldestChatTimestamp();
      if (!oldestTimestamp) {
        this.hasMoreChats.set(false);
        this.isLoadingMoreChats.set(false);
        return;
      }

      this.logger.debug(`Loading more chats before timestamp: ${oldestTimestamp} (${new Date(oldestTimestamp * 1000).toISOString()})`);


      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        until: oldestTimestamp - 1,
        limit: this.MESSAGE_SIZE,
      };

      const filterSent: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        until: oldestTimestamp - 1,
        limit: this.MESSAGE_SIZE,
      };

      let newOldestTimestamp = oldestTimestamp;
      let messagesReceivedFound = 0;
      let messagesSentFound = 0;
      let pendingDecryptions = 0;
      let completedDecryptions = 0;
      let eoseReceived = false;

      // Function to check if we're done and apply final logic
      const checkCompletion = () => {
        if (eoseReceived && pendingDecryptions === completedDecryptions) {
          this.logger.debug(
            `Decryption complete. Received: ${messagesReceivedFound}, Sent: ${messagesSentFound}`
          );

          // Update the oldest timestamp for future loads
          this.oldestChatTimestamp.set(newOldestTimestamp);

          // If both received and sent messages are below the limit, we assume no more chats
          if (messagesReceivedFound < this.MESSAGE_SIZE && messagesSentFound < this.MESSAGE_SIZE) {
            this.logger.debug('No more chats available');
            this.hasMoreChats.set(false);
          }

          this.isLoadingMoreChats.set(false);
        }
      };

      // Subscribe to get older messages
      const sub1 = this.relay.subscribe(
        filterReceived,
        async (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < newOldestTimestamp) {
            newOldestTimestamp = event.created_at;
          }

          // Increment pending decryptions counter
          pendingDecryptions++;

          try {
            // Handle incoming wrapped events
            if (event.kind === kinds.GiftWrap) {
              const wrappedevent = await this.unwrapMessageInternal(event);

              if (!wrappedevent) {
                this.logger.warn('Failed to unwrap gift-wrapped message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: wrappedevent.id,
                pubkey: wrappedevent.pubkey,
                created_at: wrappedevent.created_at,
                content: wrappedevent.content,
                tags: wrappedevent.tags || [],
                isOutgoing: wrappedevent.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip44',
                replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
              };

              // Determine target pubkey for the chat
              let targetPubkey = wrappedevent.pubkey;

              if (directMessage.isOutgoing) {
                messagesSentFound++;
                // For outgoing messages, get recipient from p-tags
                const pTags = this.utilities.getPTagsValuesFromEvent(wrappedevent);
                if (pTags.length > 0 && pTags[0]) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-44 outgoing message has no valid recipient p-tag, skipping', { eventId: wrappedevent.id });
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              } else {
                messagesReceivedFound++;
                // For incoming messages, validate sender pubkey
                if (!targetPubkey || targetPubkey === myPubkey) {
                  this.logger.warn('NIP-44 incoming message has invalid sender pubkey, skipping', { eventId: wrappedevent.id });
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              // Add the message to the chat (this will create new chats if needed)
              this.addMessageToChat(targetPubkey, directMessage);
            } else if (event.kind === kinds.EncryptedDirectMessage) {
              // Handle incoming NIP-04 direct messages
              let targetPubkey = event.pubkey;

              // Target pubkey logic
              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                completedDecryptions++;
                checkCompletion();
                return; // Skip if we already have this message
              }

              const unwrappedMessage = await this.unwrapNip04Message(event);

              if (!unwrappedMessage) {
                this.logger.warn('Failed to unwrap NIP-04 message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: unwrappedMessage.id,
                pubkey: unwrappedMessage.pubkey,
                created_at: unwrappedMessage.created_at,
                content: unwrappedMessage.content,
                tags: unwrappedMessage.tags || [],
                isOutgoing: event.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip04',
                replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
              };

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              this.addMessageToChat(targetPubkey, directMessage);
            }
          } catch (error) {
            this.logger.error('Error processing message during loadMoreChats:', error);
          } finally {
            // Always increment completed counter and check for completion
            completedDecryptions++;
            checkCompletion();
          }
        },
        () => {
          // EOSE callback - just mark that we've received all events
          this.logger.debug(
            `EOSE received. Pending: ${pendingDecryptions}, Completed: ${completedDecryptions}`
          );
          eoseReceived = true;
          checkCompletion();
        }
      );

      const sub2 = this.relay.subscribe(
        filterSent,
        async (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < newOldestTimestamp) {
            newOldestTimestamp = event.created_at;
          }

          // Increment pending decryptions counter
          pendingDecryptions++;

          try {
            // Handle incoming wrapped events
            if (event.kind === kinds.GiftWrap) {
              const wrappedevent = await this.unwrapMessageInternal(event);

              if (!wrappedevent) {
                this.logger.warn('Failed to unwrap gift-wrapped message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: wrappedevent.id,
                pubkey: wrappedevent.pubkey,
                created_at: wrappedevent.created_at,
                content: wrappedevent.content,
                tags: wrappedevent.tags || [],
                isOutgoing: wrappedevent.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip44',
                replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
              };

              // Determine target pubkey for the chat
              let targetPubkey = wrappedevent.pubkey;

              if (directMessage.isOutgoing) {
                messagesSentFound++;
                // For outgoing messages, get recipient from p-tags
                const pTags = this.utilities.getPTagsValuesFromEvent(wrappedevent);
                if (pTags.length > 0 && pTags[0]) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-44 outgoing message has no valid recipient p-tag, skipping', { eventId: wrappedevent.id });
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              } else {
                messagesReceivedFound++;
                // For incoming messages, validate sender pubkey
                if (!targetPubkey || targetPubkey === myPubkey) {
                  this.logger.warn('NIP-44 incoming message has invalid sender pubkey, skipping', { eventId: wrappedevent.id });
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              // Add the message to the chat (this will create new chats if needed)
              this.addMessageToChat(targetPubkey, directMessage);
            } else if (event.kind === kinds.EncryptedDirectMessage) {
              // Handle incoming NIP-04 direct messages
              let targetPubkey = event.pubkey;

              // Target pubkey logic
              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                completedDecryptions++;
                checkCompletion();
                return; // Skip if we already have this message
              }

              const unwrappedMessage = await this.unwrapNip04Message(event);

              if (!unwrappedMessage) {
                this.logger.warn('Failed to unwrap NIP-04 message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: unwrappedMessage.id,
                pubkey: unwrappedMessage.pubkey,
                created_at: unwrappedMessage.created_at,
                content: unwrappedMessage.content,
                tags: unwrappedMessage.tags || [],
                isOutgoing: event.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip04',
                replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
              };

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              this.addMessageToChat(targetPubkey, directMessage);
            }
          } catch (error) {
            this.logger.error('Error processing message during loadMoreChats:', error);
          } finally {
            // Always increment completed counter and check for completion
            completedDecryptions++;
            checkCompletion();
          }
        },
        () => {
          // EOSE callback - just mark that we've received all events
          this.logger.debug(
            `EOSE received. Pending: ${pendingDecryptions}, Completed: ${completedDecryptions}`
          );
          eoseReceived = true;
          checkCompletion();
        }
      );
    } catch (err) {
      this.logger.error('Failed to load more chats', err);
      this.error.set('Failed to load more chats. Please try again.');
      this.isLoadingMoreChats.set(false);
    }
  }

  // Helper method to add a chat directly to the chatsMap (for temporary/new chats)
  addChat(chat: Chat): void {
    // Prevent self-chat
    const myPubkey = this.accountState.pubkey();
    if (chat.pubkey === myPubkey) {
      this.logger.warn('Cannot add chat with yourself', { chatId: chat.id });
      return;
    }

    const currentMap = this.chatsMap();
    const newMap = new Map(currentMap);
    newMap.set(chat.id, chat);
    this.chatsMap.set(newMap);
  }

  /**
   * Remove a chat from the local view (hide it)
   * Note: This doesn't delete messages from storage, just hides the chat
   */
  removeChat(chatId: string): void {
    const currentMap = this.chatsMap();
    const newMap = new Map(currentMap);
    newMap.delete(chatId);
    this.chatsMap.set(newMap);
    this.logger.info(`Chat ${chatId} hidden from view`);
  }

  /**
   * Mark all unread messages in a chat as read
   */
  async markChatAsRead(chatId: string): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot mark chat as read: no account pubkey');
      return;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot mark chat as read: chat ${chatId} not found`);
      return;
    }

    // If chat already has 0 unread count, nothing to do
    if (chat.unreadCount === 0) {
      return;
    }

    try {
      // Mark all messages as read in storage
      await this.database.init();
      await this.database.markChatAsRead(myPubkey, chatId);

      // Update the in-memory chat's unread count and mark messages as read
      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);

      const updatedMessagesMap = new Map(chat.messages);
      for (const [msgId, message] of updatedMessagesMap.entries()) {
        if (!message.isOutgoing && !message.read) {
          updatedMessagesMap.set(msgId, { ...message, read: true });
        }
      }

      const updatedChat: Chat = {
        ...chat,
        unreadCount: 0,
        messages: updatedMessagesMap,
      };

      newMap.set(chatId, updatedChat);
      this.chatsMap.set(newMap);

      this.logger.debug(`Marked chat ${chatId} as read`);
    } catch (error) {
      this.logger.error('Error marking chat as read:', error);
    }
  }

  /**
   * Mark all chats as read
   */
  async markAllChatsAsRead(): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot mark all chats as read: no account pubkey');
      return;
    }

    try {
      await this.database.init();

      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);

      for (const [chatId, chat] of currentMap.entries()) {
        if (chat.unreadCount > 0) {
          // Mark in database
          await this.database.markChatAsRead(myPubkey, chatId);

          // Update in-memory
          const updatedMessagesMap = new Map(chat.messages);
          for (const [msgId, message] of updatedMessagesMap.entries()) {
            if (!message.isOutgoing && !message.read) {
              updatedMessagesMap.set(msgId, { ...message, read: true });
            }
          }

          const updatedChat: Chat = {
            ...chat,
            unreadCount: 0,
            messages: updatedMessagesMap,
          };

          newMap.set(chatId, updatedChat);
        }
      }

      this.chatsMap.set(newMap);

      // Update the cached unread count in local state
      this.accountLocalState.setUnreadMessagesCount(myPubkey, 0);

      this.logger.debug('Marked all chats as read');
    } catch (error) {
      this.logger.error('Error marking all chats as read:', error);
    }
  }

  /**
   * Delete a message from a chat (local deletion only)
   * This removes the message from local storage and memory.
   * Note: This does not delete the message from relays - that would require
   * publishing a NIP-09 deletion event, but gift-wrapped messages use ephemeral
   * keys so deletion requests cannot be verified by relays.
   * 
   * For outgoing messages, the user can only delete their own view of the message.
   * The recipient will still have their copy.
   * 
   * @param chatId The chat ID (pubkey of the other party)
   * @param messageId The message ID to delete
   * @returns true if the message was deleted, false otherwise
   */
  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot delete message: no account pubkey');
      return false;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot delete message: chat ${chatId} not found`);
      return false;
    }

    const message = chat.messages.get(messageId);
    if (!message) {
      this.logger.warn(`Cannot delete message: message ${messageId} not found in chat ${chatId}`);
      return false;
    }

    try {
      // Delete from IndexedDB
      await this.database.init();
      await this.database.deleteDirectMessage(myPubkey, chatId, messageId);

      // Update in-memory state
      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);
      const existingChat = newMap.get(chatId);

      if (existingChat) {
        const updatedMessagesMap = new Map(existingChat.messages);
        updatedMessagesMap.delete(messageId);

        // Recalculate last message
        const newLastMessage = this.getLatestMessage(updatedMessagesMap);

        // Recalculate unread count if we deleted an unread message
        let newUnreadCount = existingChat.unreadCount;
        if (!message.isOutgoing && !message.read) {
          newUnreadCount = Math.max(0, newUnreadCount - 1);
        }

        const updatedChat: Chat = {
          ...existingChat,
          messages: updatedMessagesMap,
          lastMessage: newLastMessage,
          unreadCount: newUnreadCount,
        };

        newMap.set(chatId, updatedChat);
        this.chatsMap.set(newMap);
      }

      this.logger.info(`Deleted message ${messageId} from chat ${chatId}`);
      return true;
    } catch (error) {
      this.logger.error('Error deleting message:', error);
      return false;
    }
  }

  /**
   * Hide a message in a chat (for received messages)
   * This stores the message ID in local state so it's filtered out of display.
   * The message remains in storage but is not shown to the user.
   * 
   * @param chatId The chat ID (pubkey of the other party)
   * @param messageId The message ID to hide
   * @returns true if the message was hidden, false otherwise
   */
  hideMessage(chatId: string, messageId: string): boolean {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot hide message: no account pubkey');
      return false;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot hide message: chat ${chatId} not found`);
      return false;
    }

    const message = chat.messages.get(messageId);
    if (!message) {
      this.logger.warn(`Cannot hide message: message ${messageId} not found in chat ${chatId}`);
      return false;
    }

    // Store in local state
    this.accountLocalState.hideMessage(myPubkey, chatId, messageId);
    this.logger.info(`Hidden message ${messageId} in chat ${chatId}`);
    return true;
  }

  /**
   * Check if a message is hidden
   */
  isMessageHidden(chatId: string, messageId: string, trackChanges = false): boolean {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return false;
    return this.accountLocalState.isMessageHidden(myPubkey, chatId, messageId, trackChanges);
  }
}
