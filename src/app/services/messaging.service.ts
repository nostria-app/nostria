import { computed, inject, Injectable, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { Filter, kinds, NostrEvent } from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';

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
  providedIn: 'root'
})
export class MessagingService {
  private nostr = inject(NostrService);
  private relay = inject(RelayService);
  private logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly encryption = inject(EncryptionService);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  private chatsMap = signal<Map<string, Chat>>(new Map());

  // chats = computed(() => {
  //   return this.chatsMap();
  // });

  getChat(chatId: string): Chat | null {
    const chat = this.chatsMap().get(chatId);
    return chat || null;
  }

  sortedChats = computed(() => {
    debugger;
    return Array.from(this.chatsMap().entries())
      .map(([chatId, chat]) => ({ chatId, chat }))
      .sort((a, b) => {
        debugger;
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

    return Array.from(chat.messages.values())
      .sort((a, b) => a.created_at - b.created_at); // Oldest first
  }
  // Helper method to add a message to a chat (prevents duplicates and updates sorting)
  addMessageToChat(pubkey: string, message: DirectMessage): void {
    debugger;
    const currentMap = this.chatsMap();
    const chatId = message.encryptionType === 'nip04' ? `nip04${pubkey}` : `nip44${pubkey}`;

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
        messages: new Map([[message.id, message]])
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
        unreadCount: message.isOutgoing ? chat.unreadCount : chat.unreadCount + 1
      };

      // Update the chat in the new map
      newMap.set(chatId, updatedChat);
    }

    // Set the new map to trigger signal reactivity
    this.chatsMap.set(newMap);
  }

  // Helper method to get the latest message from a messages map
  private getLatestMessage(messagesMap: Map<string, DirectMessage>): DirectMessage | null {
    if (messagesMap.size === 0) return null;

    return Array.from(messagesMap.values())
      .sort((a, b) => b.created_at - a.created_at)[0];
  }

  async loadChats() {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const myPubkey = this.accountState.pubkey();
      if (!myPubkey) {
        this.error.set('You need to be logged in to view messages');
        this.isLoading.set(false);
        return;
      }

      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        limit: 1
      };

      const filterSent: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        limit: 1
      };

      // Store pubkeys of people who've messaged us
      const chatPubkeys = new Set<string>();

      // First, look for existing gift-wrapped messages
      const sub = this.relay.subscribe([filterReceived, filterSent], async (event: NostrEvent) => {
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
            isOutgoing: event.pubkey === myPubkey,
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip44' // Gift-wrapped messages are NIP-44
          };

          // Add the message to the chat
          this.addMessageToChat(wrappedevent.pubkey, directMessage);

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
                this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
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
              this.logger.warn('Failed to unwrap gift-wrapped message', event);
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
              encryptionType: 'nip04' // Gift-wrapped messages are NIP-04
            };

            // Add the message to the chat
            this.addMessageToChat(targetPubkey, directMessage);
          }
        }
      }, () => {
        console.log('End of data for incoming messages.');

        // Now create chats list from collected pubkeys
        // const chatsList: Chat[] = Array.from(chatPubkeys).map(pubkey => ({
        //   id: pubkey, // Using pubkey as chat ID
        //   pubkey,
        //   unreadCount: 0,
        //   lastMessage: null
        // }));

        // // Sort chats (will be updated with last messages later)
        // const sortedChats = chatsList.sort((a, b) => {
        //   const aTime = a.lastMessage?.created_at || 0;
        //   const bTime = b.lastMessage?.created_at || 0;
        //   return bTime - aTime; // Most recent first
        // });

        // this.chats.set(sortedChats);

        // For each chat, fetch the latest message
        // for (const chat of sortedChats) {
        //   this.fetchLatestMessageForChat(chat.pubkey);
        // }

        this.isLoading.set(false);
      })

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
  private async queueMessageForDecryption(event: NostrEvent, type: 'nip04' | 'nip44', senderPubkey: string): Promise<any | null> {
    return new Promise((resolve, reject) => {
      const queueItem: DecryptionQueueItem = {
        id: `${event.id}-${Date.now()}`,
        event,
        type,
        senderPubkey,
        resolve,
        reject
      };

      this.decryptionQueue.push(queueItem);
      this.decryptionQueueLength.set(this.decryptionQueue.length);
      this.logger.debug(`Added message to decryption queue. Queue length: ${this.decryptionQueue.length}`);

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
    } this.isProcessingQueue = true;
    this.isDecryptingMessages.set(true);
    this.logger.debug('Starting decryption queue processing');

    while (this.decryptionQueue.length > 0) {
      const item = this.decryptionQueue.shift()!;
      this.decryptionQueueLength.set(this.decryptionQueue.length);

      try {
        this.logger.debug(`Processing decryption for message ${item.id}`);

        let result: any | null = null; if (item.type === 'nip04') {
          result = await this.unwrapNip04MessageInternal(item.event);
        } else if (item.type === 'nip44') {
          result = await this.unwrapMessageInternal(item.event);
        }

        item.resolve(result);
        this.logger.debug(`Successfully decrypted message ${item.id}`);

        // Small delay between processing to prevent overwhelming the user with extension prompts
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        debugger;
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
  private async unwrapNip04MessageInternal(event: NostrEvent): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    try {
      // For NIP-04 messages, the sender is the event pubkey
      const tags = this.utilities.getPTagsValuesFromEvent(event);

      if (tags.length === 0) {
        return null;
      }
      else if (tags.length > 1) {
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
      const decryptionResult = await this.encryption.autoDecrypt(event.content, decryptionPubkey, event);

      // Return the message with decrypted content
      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        content: decryptionResult.content,
        tags: event.tags
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

      // First decrypt the wrapped content using the EncryptionService
      // This will handle both browser extension and direct decryption
      let wrappedContent: any;
      try {
        const decryptionResult = await this.encryption.autoDecrypt(wrappedEvent.content, wrappedEvent.pubkey, wrappedEvent);
        wrappedContent = JSON.parse(decryptionResult.content);
      } catch (err) {
        this.logger.error('Failed to decrypt wrapped content', err);
        return null;
      }

      // Get the sealed message
      let sealedEvent;
      if (wrappedEvent.pubkey === myPubkey) {
        // If we sent it, we can directly use the encryptedMessage
        sealedEvent = wrappedContent.encryptedMessage;
      } else {
        // Decrypt the sealed content using the EncryptionService
        try {
          const sealedDecryptionResult = await this.encryption.autoDecrypt(wrappedContent.content, wrappedContent.pubkey, wrappedEvent);
          sealedEvent = JSON.parse(sealedDecryptionResult.content);
        } catch (err) {
          this.logger.error('Failed to decrypt sealed content', err);
          return null;
        }
      }

      // Return the final decrypted message
      return {
        ...sealedEvent
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
    debugger;
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
    const messageKinds = chat.encryptionType === 'nip04' 
      ? [kinds.EncryptedDirectMessage] 
      : [kinds.GiftWrap];

    this.logger.debug(`Loading more messages for chat ${chatId}, encryption type: ${chat.encryptionType}, until: ${until}`);

    // Create filters for both received and sent messages
    const filterReceived: Filter = {
      kinds: messageKinds,
      authors: [chat.pubkey],
      '#p': [myPubkey],
      until: until,
      limit: 25
    };

    const filterSent: Filter = {
      kinds: messageKinds,
      authors: [myPubkey],
      '#p': [chat.pubkey],
      until: until,
      limit: 25
    };

    const loadedMessages: DirectMessage[] = [];

    try {
      // Use subscribe with EOSE to get historical messages
      await new Promise<void>((resolve, reject) => {
        const sub = this.relay.subscribe([filterReceived, filterSent], async (event: NostrEvent) => {
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
                encryptionType: chat.encryptionType
              };

              loadedMessages.push(directMessage);
              this.addMessageToChat(otherPubkey, directMessage);
            }
          } catch (error) {
            this.logger.error('Failed to process older message:', error);
          }
        }, () => {
          // EOSE callback - end of stored events
          resolve();
        });        // Set a timeout to prevent hanging
        setTimeout(() => {
          if (sub) {
            sub.close();
          }
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
}
