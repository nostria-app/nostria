import { computed, inject, Injectable, signal } from '@angular/core';
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
import { NostriaService } from '../interfaces';
import { bytesToHex } from 'nostr-tools/utils';
import { AccountRelayServiceEx } from './relays/account-relay';

// Define interfaces for our DM data structures
interface Chat {
  id: string;
  pubkey: string;
  unreadCount: number;
  lastMessage?: DirectMessage | null;
  relays?: string[];
  encryptionType?: 'nip04' | 'nip44';
  isLegacy?: boolean; // true for NIP-04 chats
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
}

interface DecryptionQueueItem {
  id: string;
  event: NostrEvent;
  type: 'nip04' | 'nip44';
  senderPubkey: string;
  resolve: (result: any | null) => void;
  reject: (error: Error) => void;
}

@Injectable({
  providedIn: 'root',
})
export class MessagingService implements NostriaService {
  private nostr = inject(NostrService);
  private relay = inject(AccountRelayServiceEx);
  private logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly encryption = inject(EncryptionService);
  isLoading = signal<boolean>(false);
  isLoadingMoreChats = signal<boolean>(false);
  hasMoreChats = signal<boolean>(true);
  error = signal<string | null>(null);

  private chatsMap = signal<Map<string, Chat>>(new Map());
  private oldestChatTimestamp = signal<number | null>(null);

  MESSAGE_SIZE = 20;

  // chats = computed(() => {
  //   return this.chatsMap();
  // });

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

  // selectedChatId = signal<string | null>(null);
  // selectedChat = computed(() => {
  //   const chatId = this.selectedChatId();
  //   if (!chatId) return null;
  //   return this.chats().find(chat => chat.id === chatId) || null;
  // });

  private decryptionQueue: DecryptionQueueItem[] = [];
  private isProcessingQueue = false;
  isDecryptingMessages = signal<boolean>(false);
  decryptionQueueLength = signal<number>(0);

  constructor() { }

  hasMessage(chatId: string, messageId: string): boolean {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return false;

    return chat.messages.has(messageId);
  }

  getChatMessages(chatId: string): DirectMessage[] {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return [];

    return Array.from(chat.messages.values()).sort(
      (a, b) => a.created_at - b.created_at
    ); // Oldest first
  }

  // Helper method to add a message to a chat (prevents duplicates and updates sorting)
  addMessageToChat(pubkey: string, message: DirectMessage): void {
    const currentMap = this.chatsMap();
    const chatId =
      message.encryptionType === 'nip04'
        ? `${pubkey}-nip04`
        : `${pubkey}-nip44`;

    // Create a new Map to ensure signal reactivity
    const newMap = new Map(currentMap);

    // Individual chats are keyed by pubkey, so we use pubkey as chatId
    const chat = newMap.get(chatId);

    if (!chat) {
      // Create new chat if it doesn't exist
      const newChat: Chat = {
        id: chatId,
        pubkey: pubkey,
        unreadCount: 0,
        lastMessage: message,
        relays: [],
        encryptionType: message.encryptionType || 'nip44',
        isLegacy: message.encryptionType === 'nip04',
        messages: new Map([[message.id, message]]),
      };

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
        unreadCount: message.isOutgoing
          ? chat.unreadCount
          : chat.unreadCount + 1,
      };

      // Update the chat in the new map
      newMap.set(chatId, updatedChat);
    }

    // Set the new map to trigger signal reactivity
    this.chatsMap.set(newMap);
  }

  // Helper method to get the latest message from a messages map
  private getLatestMessage(
    messagesMap: Map<string, DirectMessage>
  ): DirectMessage | null {
    if (messagesMap.size === 0) return null;

    return Array.from(messagesMap.values()).sort(
      (a, b) => b.created_at - a.created_at
    )[0];
  }

  clear() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
    this.isLoading.set(false);
    this.isLoadingMoreChats.set(false);
    this.hasMoreChats.set(true);
    this.error.set(null);
    this.clearDecryptionQueue();
  }

  reset() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
  }

  async load() { }

  async createNip44Message(
    messageText: string,
    receiverPubkey: string,
    myPubkey: string
  ) {
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
        created_at:
          Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
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
        created_at:
          Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
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
        created_at:
          Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
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

  async loadChats() {
    this.clear();
    this.isLoading.set(true);

    try {
      const myPubkey = this.accountState.pubkey();

      if (!myPubkey) {
        this.error.set('You need to be logged in to view messages');
        this.isLoading.set(false);
        return;
      }

      // This contains both incoming and outgoing messages for Giftwrapped messages.
      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        limit: this.MESSAGE_SIZE,
      };

      const filterSent: Filter = {
        kinds: [kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        limit: this.MESSAGE_SIZE,
      }; // Store pubkeys of people who've messaged us
      const chatPubkeys = new Set<string>();
      let oldestTimestamp =
        this.oldestChatTimestamp() || Math.floor(Date.now() / 1000);

      // First, look for existing gift-wrapped messages
      const sub = this.relay.subscribe(
        [filterReceived, filterSent],
        async (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < oldestTimestamp) {
            oldestTimestamp = event.created_at;
          }
          // Handle incoming wrapped events
          if (event.kind === kinds.GiftWrap) {
            // let chats = this.chatsMap();
            // let chat = chats.get(event.pubkey);

            // if (!chat) {
            //   chat = {
            //     id: event.pubkey,
            //     pubkey: event.pubkey,
            //     unreadCount: 0,
            //     lastMessage: null,
            //     relays: [],
            //     encryptionType: 'nip44',
            //     isLegacy: false,
            //     messages: new Map<string, DirectMessage>()
            //   };
            //   chats.set(event.pubkey, chat);
            // }

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
              encryptionType: 'nip44', // Gift-wrapped messages are NIP-44
            };

            let targetPubkey = wrappedevent.pubkey;

            // If this is outgoing, it means the target is in the tags on the kind 14.
            if (directMessage.isOutgoing) {
              targetPubkey =
                this.utilities.getPTagsValuesFromEvent(wrappedevent)[0];
            }

            // Add the message to the chat
            this.addMessageToChat(targetPubkey, directMessage);

            // Add all pubkeys to the list, including self, we might chat with ourselves for notes, etc.
            // chatPubkeys.add(event.pubkey);

            // // Look for 'p' tags for recipients other than ourselves
            // const pTags = event.tags.filter(tag => tag[0] === 'p');
            // for (const tag of pTags) {
            //   const pubkey = tag[1];
            //   if (pubkey !== myPubkey) {
            //     chatPubkeys.add(pubkey);
            //   }
            // }
            // this.relayPool?.publish(relays, event);
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
                  this.logger.warn(
                    'NIP-04 message has no recipients, ignoring.',
                    event
                  );
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                return; // Skip if we already have this message
              }

              // let chats = this.chatsMap();
              // let chat = chats.get(targetPubkey);

              // if (!chat) {
              //   chat = {
              //     id: targetPubkey,
              //     pubkey: targetPubkey,
              //     unreadCount: 0,
              //     lastMessage: null,
              //     relays: [],
              //     encryptionType: 'nip04',
              //     isLegacy: true,
              //     messages: new Map<string, DirectMessage>()
              //   };
              //   chats.set(targetPubkey, chat);
              // }

              const unwrappedMessage = await this.unwrapNip04Message(event);

              if (!unwrappedMessage) {
                this.logger.warn(
                  'Failed to unwrap gift-wrapped message',
                  event
                );
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
                encryptionType: 'nip04', // Gift-wrapped messages are NIP-04
              };

              // Add the message to the chat
              this.addMessageToChat(targetPubkey, directMessage);
            }
          }
        },
        () => {
          console.log('End of data for incoming messages.');

          // Update the oldest timestamp for loading more chats
          this.oldestChatTimestamp.set(oldestTimestamp);

          // ...existing code...

          this.isLoading.set(false);
        }
      );

      // Process wrapped events to find unique chat participants
      // if (wrappedEvents && wrappedEvents.length > 0) {
      //     for (const event of wrappedEvents) {
      //         // Add the sender to our chat list if not us
      //         if (event.pubkey !== myPubkey) {
      //             chatPubkeys.add(event.pubkey);
      //         }

      //         // Look for 'p' tags for recipients other than ourselves
      //         const pTags = event.tags.filter(tag => tag[0] === 'p');
      //         for (const tag of pTags) {
      //             const pubkey = tag[1];
      //             if (pubkey !== myPubkey) {
      //                 chatPubkeys.add(pubkey);
      //             }
      //         }
      //     }
      // }

      // Also add chats from our outgoing messages
      // const ourMessages = await this.relay.getAccountPool()?.subscribe(this.relay.getAccountRelayUrls(), {
      //     kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
      //     authors: [myPubkey],
      //     limit: 100
      // }, {
      //     maxWait: 5000,
      //     label: 'loadChats', onevent: async (event: NostrEvent) => {
      //         if (event.kind == kinds.EncryptedDirectMessage) {
      //             const unwrappedMessage = await this.unwrapNip04Message(event);
      //             if (unwrappedMessage) {
      //                 // Look for 'p' tags for recipients other than ourselves
      //                 const pTags = event.tags.filter(tag => tag[0] === 'p');
      //                 for (const tag of pTags) {
      //                     const pubkey = tag[1];
      //                     if (pubkey !== myPubkey) {
      //                         chatPubkeys.add(pubkey);
      //                     }
      //                 }
      //             }
      //         }

      //         // Handle outgoing wrapped events
      //         if (event.kind === kinds.GiftWrap) {
      //             const pTags = event.tags.filter(tag => tag[0] === 'p');
      //             for (const tag of pTags) {
      //                 const pubkey = tag[1];
      //                 if (pubkey !== myPubkey) {
      //                     chatPubkeys.add(pubkey);
      //                 }
      //             }
      //         }
      //     }, onclose: () => {
      //         console.log('End of data for outgoing messages.');

      //         // Final update: create chats list from all collected pubkeys
      //         const finalChatsList: Chat[] = Array.from(chatPubkeys).map(pubkey => ({
      //             id: pubkey, // Using pubkey as chat ID
      //             pubkey,
      //             unreadCount: 0,
      //             lastMessage: null
      //         }));

      //         // Sort chats (will be updated with last messages later)
      //         const finalSortedChats = finalChatsList.sort((a, b) => {
      //             const aTime = a.lastMessage?.created_at || 0;
      //             const bTime = b.lastMessage?.created_at || 0;
      //             return bTime - aTime; // Most recent first
      //         });

      //         this.chats.set(finalSortedChats);

      //         // For each chat, fetch the latest message
      //         for (const chat of finalSortedChats) {
      //             this.fetchLatestMessageForChat(chat.pubkey);
      //         }
      //     }
      // });

      // if (ourMessages && ourMessages.length > 0) {
      //     for (const event of ourMessages) {

      //     }
      // }

      // Convert to array of Chat objects
    } catch (err) {
      this.logger.error('Failed to load chats', err);
      this.error.set('Failed to load chats. Please try again.');
      this.isLoading.set(false);
    }
  }

  /**
   * Unwrap and decrypt a NIP-04 direct message (queued version for user-facing calls)
   */
  async unwrapNip04Message(event: NostrEvent): Promise<any | null> {
    const senderPubkey = event.pubkey;
    return await this.queueMessageForDecryption(event, 'nip04', senderPubkey);
  }

  /**
   * Add a message to the decryption queue for sequential processing
   */
  private async queueMessageForDecryption(
    event: NostrEvent,
    type: 'nip04' | 'nip44',
    senderPubkey: string
  ): Promise<any | null> {
    return new Promise((resolve, reject) => {
      const queueItem: DecryptionQueueItem = {
        id: `${event.id}-${Date.now()}`,
        event,
        type,
        senderPubkey,
        resolve,
        reject,
      };

      this.decryptionQueue.push(queueItem);
      this.decryptionQueueLength.set(this.decryptionQueue.length);
      this.logger.debug(
        `Added message to decryption queue. Queue length: ${this.decryptionQueue.length}`
      );

      // Start processing if not already processing
      if (!this.isProcessingQueue) {
        this.processDecryptionQueue();
      }
    });
  }

  /**
   * Clear the decryption queue (useful for cleanup)
   */
  clearDecryptionQueue(): void {
    // Reject all pending items
    this.decryptionQueue.forEach(item => {
      item.reject(new Error('Decryption queue cleared'));
    });

    this.decryptionQueue = [];
    this.isProcessingQueue = false;
    this.isDecryptingMessages.set(false);
    this.decryptionQueueLength.set(0);
    this.logger.debug('Decryption queue cleared');
  }

  /**
   * Process the decryption queue sequentially
   */
  private async processDecryptionQueue(): Promise<void> {
    if (this.isProcessingQueue || this.decryptionQueue.length === 0) {
      return;
    }
    this.isProcessingQueue = true;
    this.isDecryptingMessages.set(true);
    this.logger.debug('Starting decryption queue processing');

    while (this.decryptionQueue.length > 0) {
      const item = this.decryptionQueue.shift()!;
      this.decryptionQueueLength.set(this.decryptionQueue.length);

      try {
        this.logger.debug(`Processing decryption for message ${item.id}`);

        let result: any | null = null;
        if (item.type === 'nip04') {
          result = await this.unwrapNip04MessageInternal(item.event);
        } else if (item.type === 'nip44') {
          result = await this.unwrapMessageInternal(item.event);
        }

        item.resolve(result);
        this.logger.debug(`Successfully decrypted message ${item.id}`);

        // Small delay between processing to prevent overwhelming the user with extension prompts
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.logger.error(`Failed to decrypt message ${item.id}:`, error);
        item.reject(error as Error);
      }
    }

    this.isProcessingQueue = false;
    this.isDecryptingMessages.set(false);
    this.decryptionQueueLength.set(0);
    this.logger.debug('Finished processing decryption queue');
  }

  /**
   * Internal unwrap and decrypt a NIP-04 direct message (direct processing)
   */
  private async unwrapNip04MessageInternal(
    event: NostrEvent
  ): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    try {
      // For NIP-04 messages, the sender is the event pubkey
      const tags = this.utilities.getPTagsValuesFromEvent(event);

      if (tags.length === 0) {
        return null;
      } else if (tags.length > 1) {
        // NIP-04 only supports one recipient, yet some clients have sent DMs with more. Ignore those.
        this.logger.warn(
          'NIP-04 message has multiple recipients, ignoring.',
          event
        );
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
      const recipient = wrappedEvent.tags.find(
        (t: string[]) => t[0] === 'p'
      )?.[1];
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
        this.logger.error('Failed to decrypt wrapped content', err);
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
        throw new Error(
          'Decrypted message pubkey does not match wrapped content pubkey'
        );
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
  async loadMoreMessages(
    chatId: string,
    beforeTimestamp?: number
  ): Promise<DirectMessage[]> {
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
        until = Math.floor(Date.now() / 1000); // Current timestamp
      } else {
        until = Math.min(...currentMessages.map(m => m.created_at)) - 1;
      }
    }

    // Determine which message kinds to fetch based on chat encryption type
    const messageKinds =
      chat.encryptionType === 'nip04'
        ? [kinds.EncryptedDirectMessage]
        : [kinds.GiftWrap];

    this.logger.debug(
      `Loading more messages for chat ${chatId}, encryption type: ${chat.encryptionType}, until: ${until}`
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
          [filterReceived, filterSent],
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
                  encryptionType: chat.encryptionType,
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
            resolve();
          }
        );

        // Set a timeout to prevent hanging
        setTimeout(() => {
          if (sub) {
            sub.close();
          }
          resolve();
        }, 10000);
      });

      this.logger.debug(
        `Loaded ${loadedMessages.length} older messages for chat ${chatId}`
      );
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

      this.logger.debug(
        `Loading more chats before timestamp: ${oldestTimestamp}`
      );

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
          if (
            messagesReceivedFound < this.MESSAGE_SIZE &&
            messagesSentFound < this.MESSAGE_SIZE
          ) {
            this.logger.debug('No more chats available');
            this.hasMoreChats.set(false);
          }

          this.isLoadingMoreChats.set(false);
        }
      };

      // Subscribe to get older messages
      const sub = this.relay.subscribe(
        [filterReceived, filterSent],
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
                this.logger.warn(
                  'Failed to unwrap gift-wrapped message',
                  event
                );
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
                isOutgoing: event.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip44',
              };

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              this.addMessageToChat(wrappedevent.pubkey, directMessage);
            } else if (event.kind === kinds.EncryptedDirectMessage) {
              // Handle incoming NIP-04 direct messages
              let targetPubkey = event.pubkey;

              // Target pubkey logic
              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn(
                    'NIP-04 message has no recipients, ignoring.',
                    event
                  );
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
            this.logger.error(
              'Error processing message during loadMoreChats:',
              error
            );
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
    const currentMap = this.chatsMap();
    const newMap = new Map(currentMap);
    newMap.set(chat.id, chat);
    this.chatsMap.set(newMap);
  }
}
