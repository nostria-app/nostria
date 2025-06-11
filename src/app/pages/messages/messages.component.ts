import { Component, OnInit, OnDestroy, inject, signal, computed, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterModule } from '@angular/router';
import { NostrService } from '../../services/nostr.service';
import { RelayService, Relay } from '../../services/relay.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { NotificationType, StorageService } from '../../services/storage.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { NPubPipe } from '../../pipes/npub.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { AgoPipe } from '../../pipes/ago.pipe';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { kinds, SimplePool, getPublicKey, nip04, nip44, generateSecretKey, finalizeEvent, Event as NostrEvent, Filter } from 'nostr-tools';
import { v2 } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils';
import { ApplicationService } from '../../services/application.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { EncryptionService } from '../../services/encryption.service';
import { DataService } from '../../services/data.service';

// Define interfaces for our DM data structures
interface Chat {
    id: string;
    pubkey: string;
    unreadCount: number;
    lastMessage?: DirectMessage | null;
    relays?: string[];
    encryptionType?: 'nip04' | 'nip17';
    isLegacy?: boolean; // true for NIP-04 chats
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
    encryptionType?: 'nip04' | 'nip17';
}

// Constants for both NIP-04 and NIP-17 events
const DIRECT_MESSAGE_KIND = 4;    // NIP-04 direct messages
// const GIFT_WRAPPED_KIND = 1059;   // NIP-17 gift wrapped messages
const SEALED_MESSAGE_KIND = 13;   // NIP-17 sealed messages
const CHAT_MESSAGE_KIND = 14;     // NIP-17 chat messages
const RECEIPT_KIND = 1405;        // For read receipts

@Component({
    selector: 'app-messages',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        MatListModule,
        MatCardModule,
        MatDividerModule,
        MatMenuModule,
        MatTooltipModule,
        MatBadgeModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
        MatDialogModule,
        RouterModule,
        LoadingOverlayComponent,
        UserProfileComponent,
        NPubPipe,
        TimestampPipe,
        AgoPipe
    ],
    templateUrl: './messages.component.html',
    styleUrl: './messages.component.scss'
})
export class MessagesComponent implements OnInit, OnDestroy {
    private data = inject(DataService);
    private nostr = inject(NostrService);
    private relay = inject(RelayService);
    private logger = inject(LoggerService);
    private notifications = inject(NotificationService);
    private dialog = inject(MatDialog);
    private storage = inject(StorageService);
    private router = inject(Router);
    private appState = inject(ApplicationStateService);
    private snackBar = inject(MatSnackBar); private readonly app = inject(ApplicationService);
    readonly utilities = inject(UtilitiesService);
    private readonly accountState = inject(AccountStateService);
    private readonly encryption = inject(EncryptionService);

    // UI state signals
    isLoading = signal<boolean>(false);
    isLoadingMore = signal<boolean>(false);
    isSending = signal<boolean>(false);
    error = signal<string | null>(null);
    showMobileList = signal<boolean>(true);

    // Data signals
    chats = signal<Chat[]>([]);
    selectedChatId = signal<string | null>(null);
    selectedChat = computed(() => {
        debugger;
        const chatId = this.selectedChatId();
        if (!chatId) return null;
        return this.chats().find(chat => chat.id === chatId) || null;
    });

    activePubkey = computed(() => this.selectedChat()?.pubkey || '');

    messages = signal<DirectMessage[]>([]);
    newMessageText = signal<string>('');
    hasMoreMessages = signal<boolean>(false);

    // Computed helpers
    hasChats = computed(() => this.chats().length > 0);

    // Clean up subscriptions
    private messageSubscription: any = null;
    private chatSubscription: any = null;

    constructor() {
        // Set up effect to load messages when chat is selected
        effect(() => {
            debugger;
            const chat = this.selectedChat();
            if (chat) {
                untracked(() => {
                    this.loadMessages(chat.pubkey);
                    // Mark this chat as read when selected
                    // TODO: FIX, this will trigger selectedChat signal and cause infinite loop
                    // this.markChatAsRead(chat.id);
                });
            }
        });

        // Listen to connection status changes
        effect(() => {
            debugger;
            if (this.appState.isOnline()) {
                this.error.set(null);
            } else {
                this.error.set('You are offline. Messages will be sent when you reconnect.');
            }
        });

        effect(async () => {
            if (this.accountState.initialized()) {
                debugger;
                await this.loadChats();
                this.subscribeToMessages();
            }
        });
    }

    ngOnInit(): void {

    }

    ngOnDestroy(): void {
        // Clean up subscriptions
        if (this.messageSubscription) {
            this.messageSubscription.close();
        }

        if (this.chatSubscription) {
            this.chatSubscription.close();
        }
    }

    /**
     * Load all chats for the current user
     */
    async loadChats(): Promise<void> {
        this.isLoading.set(true);
        this.error.set(null);

        try {
            const myPubkey = this.accountState.pubkey();
            if (!myPubkey) {
                this.error.set('You need to be logged in to view messages');
                this.isLoading.set(false);
                return;
            }

            const filter: Filter = {
                kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
                '#p': [myPubkey],
                limit: 100
            };

            // Store pubkeys of people who've messaged us
            const chatPubkeys = new Set<string>();

            debugger;

            // First, look for existing gift-wrapped messages
            const sub = this.relay.subscribe([], async (event: NostrEvent) => {
                debugger;
                // Handle incoming wrapped events
                if (event.kind === kinds.GiftWrap) {

                    if (event.pubkey !== myPubkey) {
                        chatPubkeys.add(event.pubkey);
                    }

                    // Look for 'p' tags for recipients other than ourselves
                    const pTags = event.tags.filter(tag => tag[0] === 'p');
                    for (const tag of pTags) {
                        const pubkey = tag[1];
                        if (pubkey !== myPubkey) {
                            chatPubkeys.add(pubkey);
                        }
                    }

                    const chatsList: Chat[] = Array.from(chatPubkeys).map(pubkey => ({
                        id: pubkey, // Using pubkey as chat ID
                        pubkey,
                        unreadCount: 0,
                        lastMessage: null
                    }));

                    // Sort chats (will be updated with last messages later)
                    const sortedChats = chatsList.sort((a, b) => {
                        const aTime = a.lastMessage?.created_at || 0;
                        const bTime = b.lastMessage?.created_at || 0;
                        return bTime - aTime; // Most recent first
                    });

                    this.chats.set(sortedChats);

                    // For each chat, fetch the latest message
                    for (const chat of sortedChats) {
                        await this.fetchLatestMessageForChat(chat.pubkey);
                    }

                    // this.relayPool?.publish(relays, event);
                }
            }, () => {
                debugger;
                console.log('End of data.');
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
            const ourMessages = await this.relay.getAccountPool()?.subscribe(this.relay.getAccountRelayUrls(), {
                kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
                authors: [myPubkey],
                limit: 100
            }, {
                maxWait: 5000,
                label: 'loadChats',
                onevent: async (event: NostrEvent) => {
                    debugger;

                    if (event.kind == kinds.EncryptedDirectMessage) {
                        const unwrappedMessage = await this.unwrapMessage(event);
                        if (unwrappedMessage) {
                            // Create a DirectMessage object
                            const directMessage: DirectMessage = {
                                id: unwrappedMessage.id,
                                pubkey: unwrappedMessage.pubkey,
                                created_at: unwrappedMessage.created_at,
                                content: unwrappedMessage.content,
                                isOutgoing: unwrappedMessage.pubkey === myPubkey,
                                tags: unwrappedMessage.tags,
                                received: true // Since we've received and decrypted it
                            };

                            // Update the chat with this latest message
                            this.chats.update(chats => {
                                return chats.map(chat => {
                                    if (chat.pubkey === myPubkey) {
                                        return {
                                            ...chat,
                                            lastMessage: directMessage
                                        };
                                    }
                                    return chat;
                                });
                            });
                        }
                    }

                    // Handle incoming wrapped events
                    if (event.kind === kinds.GiftWrap) {

                        const pTags = event.tags.filter(tag => tag[0] === 'p');
                        for (const tag of pTags) {
                            const pubkey = tag[1];
                            if (pubkey !== myPubkey) {
                                chatPubkeys.add(pubkey);
                            }
                        }

                        // Look for 'p' tags for recipients other than ourselves
                        // const pTags = event.tags.filter(tag => tag[0] === 'p');
                        // for (const tag of pTags) {
                        //     const pubkey = tag[1];
                        //     if (pubkey !== myPubkey) {
                        //         chatPubkeys.add(pubkey);
                        //     }
                        // }
                    }
                }
            });

            // if (ourMessages && ourMessages.length > 0) {
            //     for (const event of ourMessages) {

            //     }
            // }

            // Convert to array of Chat objects


            this.isLoading.set(false);
        } catch (err) {
            this.logger.error('Failed to load chats', err);
            this.error.set('Failed to load chats. Please try again.');
            this.isLoading.set(false);
        }
    }

    /**
     * Fetch the latest message for a specific chat
     */
    async fetchLatestMessageForChat(pubkey: string): Promise<void> {
        const myPubkey = this.accountState.pubkey();

        try {
            // Fetch wrapped messages between us and this pubkey
            // TODO: Wrap this function so we don't go directly to the pool.
            const wrappedEvents = await this.relay.getAccountPool().subscribeManyEose(this.relay.getAccountRelayUrls(), [{
                kinds: [kinds.GiftWrap],
                authors: [pubkey],
                '#p': [myPubkey],
                limit: 1
            }, {
                kinds: [kinds.GiftWrap],
                authors: [myPubkey],
                '#p': [pubkey],
                limit: 1
            }],
                {
                    maxWait: 5000,
                    label: 'fetchLatestMessageForChat',
                    onevent: async (event: NostrEvent) => {
                        debugger;
                        // Handle incoming wrapped events
                        if (event.kind === kinds.GiftWrap) {
                            // this.relayPool?.publish(relays, event);
                            const unwrappedMessage = await this.unwrapMessage(event);

                            if (unwrappedMessage) {
                                // Create a DirectMessage object
                                const directMessage: DirectMessage = {
                                    id: unwrappedMessage.id,
                                    pubkey: unwrappedMessage.pubkey,
                                    created_at: unwrappedMessage.created_at,
                                    content: unwrappedMessage.content,
                                    isOutgoing: unwrappedMessage.pubkey === myPubkey,
                                    tags: unwrappedMessage.tags,
                                    received: true // Since we've received and decrypted it
                                };

                                // Update the chat with this latest message
                                this.chats.update(chats => {
                                    return chats.map(chat => {
                                        if (chat.pubkey === pubkey) {
                                            return {
                                                ...chat,
                                                lastMessage: directMessage
                                            };
                                        }
                                        return chat;
                                    });
                                });

                                // Re-sort chats by latest message
                                this.chats.update(chats => {
                                    return [...chats].sort((a, b) => {
                                        const aTime = a.lastMessage?.created_at || 0;
                                        const bTime = b.lastMessage?.created_at || 0;
                                        return bTime - aTime; // Most recent first
                                    });
                                });
                            }

                        }
                    }
                });

            // if (!wrappedEvents || wrappedEvents.length === 0) return;

            // // Sort by created_at to get the most recent
            // const latestEvent = wrappedEvents.sort((a, b) => b.created_at - a.created_at)[0];

            // // Try to unwrap and decrypt the message
            // try {
            //     const unwrappedMessage = await this.unwrapMessage(latestEvent);

            // } catch (err) {
            //     this.logger.error('Failed to unwrap message for chat preview', err);
            // }
        } catch (err) {
            this.logger.error('Failed to fetch latest message for chat', err);
        }
    }

    /**
     * Load messages for a specific chat
     */
    async loadMessages(pubkey: string): Promise<void> {
        debugger;
        this.isLoading.set(true);
        this.messages.set([]);

        try {
            const myPubkey = this.accountState.pubkey();
            if (!myPubkey) {
                this.error.set('You need to be logged in to view messages');
                this.isLoading.set(false);
                return;
            }

            // Fetch wrapped messages between us and this pubkey (in both directions)
            const wrappedEvents = await this.relay.getAccountPool().subscribeManyEose(this.relay.getAccountRelayUrls(), [{
                kinds: [kinds.GiftWrap],
                authors: [pubkey],
                '#p': [myPubkey],
                limit: 50
            }, {
                kinds: [kinds.GiftWrap],
                authors: [myPubkey],
                '#p': [pubkey],
                limit: 50
            }], {
                maxWait: 5000,
                label: 'loadMessages',
                onevent: async (event: NostrEvent) => {
                    debugger;
                    // Handle incoming wrapped events
                    if (event.kind === kinds.GiftWrap) {
                        // this.relayPool?.publish(relays, event);
                        const unwrappedMessage = await this.unwrapMessage(event);

                        if (unwrappedMessage) {
                            // Create a DirectMessage object
                            const directMessage: DirectMessage = {
                                id: unwrappedMessage.id,
                                pubkey: unwrappedMessage.pubkey,
                                created_at: unwrappedMessage.created_at,
                                content: unwrappedMessage.content,
                                isOutgoing: unwrappedMessage.pubkey === myPubkey,
                                tags: unwrappedMessage.tags,
                                received: true // Since we've received and decrypted it
                            };

                            // Update the messages list with this message
                            this.messages.update(msgs => [...msgs, directMessage]);


                        }
                    }
                }
            });

            // if (!wrappedEvents || wrappedEvents.length === 0) {
            //     this.isLoading.set(false);
            //     return;
            // }

            // // Process each wrapped message
            // const decryptedMessages: DirectMessage[] = [];

            // for (const event of wrappedEvents) {
            //     try {
            //         const unwrappedMessage = await this.unwrapMessage(event);
            //         if (unwrappedMessage) {
            //             decryptedMessages.push({
            //                 id: unwrappedMessage.id,
            //                 pubkey: unwrappedMessage.pubkey,
            //                 created_at: unwrappedMessage.created_at,
            //                 content: unwrappedMessage.content,
            //                 isOutgoing: unwrappedMessage.pubkey === myPubkey,
            //                 tags: unwrappedMessage.tags,
            //                 received: true, // Since we've received and decrypted it
            //                 read: true // Mark as read since we're viewing it now
            //             });
            //         }
            //     } catch (err) {
            //         this.logger.error('Failed to unwrap message', err);
            //     }
            // }

            // Sort messages by timestamp
            // const sortedMessages = decryptedMessages.sort((a, b) => a.created_at - b.created_at);

            // // Update the messages signal
            // this.messages.set(sortedMessages);

            // // There may be more messages
            // this.hasMoreMessages.set(sortedMessages.length >= 50);

            // // Send read receipts for these messages
            // this.sendReadReceipts(sortedMessages.filter(m => !m.isOutgoing).map(m => m.id));

            this.isLoading.set(false);
        } catch (err) {
            this.logger.error('Failed to load messages', err);
            this.error.set('Failed to load messages. Please try again.');
            this.isLoading.set(false);
        }
    }

    /**
     * Unwrap and decrypt a gift-wrapped message
     */
    async unwrapMessage(wrappedEvent: any): Promise<any | null> {
        debugger;
        const myPubkey = this.accountState.pubkey();
        if (!myPubkey) return null;

        // Get our private key (in a real app, this would use a more secure method)
        //const privateKey = await this.nostr.getActivePrivateKeySecure();
        const privateKey = await this.accountState.account()?.privkey;
        if (!privateKey) return null;

        const privateKeyBytes = hexToBytes(privateKey);

        try {
            debugger;
            // Parse the wrapped content
            const convKey = v2.utils.getConversationKey(privateKeyBytes, wrappedEvent.pubkey);
            const decrypted = v2.decrypt(wrappedEvent.content, convKey);
            const wrappedContent = JSON.parse(decrypted);
            // const wrappedContent = JSON.parse(wrappedEvent.content);

            // Check if this message is for us
            const recipient = wrappedEvent.tags.find((t: string[]) => t[0] === 'p')?.[1];
            if (recipient !== myPubkey && wrappedEvent.pubkey !== myPubkey) {
                return null;
            }

            // Get the sealed message
            let sealedEvent;
            if (wrappedEvent.pubkey === myPubkey) {
                // If we sent it, we can directly use the encryptedMessage
                sealedEvent = wrappedContent.encryptedMessage;
            } else {
                debugger;
                const convKey = v2.utils.getConversationKey(privateKeyBytes, wrappedContent.pubkey);
                const decrypted = v2.decrypt(wrappedContent.content, convKey);
                sealedEvent = JSON.parse(decrypted);
                console.log('Decrypted content:', decrypted);

                // Otherwise decrypt the message using NIP-44
                // const sharedKey = getSharedSecret(privateKey, wrappedContent.senderPubkey || wrappedEvent.pubkey);
                // sealedEvent = JSON.parse(await nip44.decrypt(sharedKey, wrappedContent.encryptedMessage));
            }

            debugger;

            // Now unseal the actual message content
            // const sharedKey = sealedEvent.pubkey === myPubkey
            //     ? getSharedSecret(privateKey, recipient)
            //     : getSharedSecret(privateKey, sealedEvent.pubkey);

            // const decryptedContent = await nip44.decrypt(sharedKey, sealedEvent.content);
            // Return the final decrypted message
            return {
                ...sealedEvent
            };
        } catch (err) {
            this.logger.error('Failed to decrypt message', err);
            throw err;
        }
    }

    /**
     * Load more messages (older messages)
     */
    async loadMoreMessages(): Promise<void> {
        if (this.isLoadingMore()) return;
        this.isLoadingMore.set(true);

        try {
            const pubkey = this.selectedChat()?.pubkey;
            const myPubkey = this.accountState.pubkey();

            if (!pubkey || !myPubkey) {
                this.isLoadingMore.set(false);
                return;
            }

            // Get the oldest timestamp from current messages
            const currentMessages = this.messages();
            if (currentMessages.length === 0) {
                this.isLoadingMore.set(false);
                return;
            }

            const oldestTimestamp = Math.min(...currentMessages.map(m => m.created_at));

            // Fetch older wrapped messages
            const wrappedEvents = await this.relay.getAccountPool().subscribeManyEose(this.relay.getAccountRelayUrls(), [{
                kinds: [kinds.GiftWrap],
                authors: [pubkey],
                '#p': [myPubkey],
                until: oldestTimestamp - 1,
                limit: 25
            }, {
                kinds: [kinds.GiftWrap],
                authors: [myPubkey],
                '#p': [pubkey],
                until: oldestTimestamp - 1,
                limit: 25
            }], {
                maxWait: 5000,
                label: 'loadMoreMessages',
                onevent: async (event: NostrEvent) => {
                    debugger;
                    // Handle incoming wrapped events
                    if (event.kind === kinds.GiftWrap) {
                        // this.relayPool?.publish(relays, event);
                        const unwrappedMessage = await this.unwrapMessage(event);

                        if (unwrappedMessage) {
                            // Create a DirectMessage object
                            const directMessage: DirectMessage = {
                                id: unwrappedMessage.id,
                                pubkey: unwrappedMessage.pubkey,
                                created_at: unwrappedMessage.created_at,
                                content: unwrappedMessage.content,
                                isOutgoing: unwrappedMessage.pubkey === myPubkey,
                                tags: unwrappedMessage.tags,
                                received: true // Since we've received and decrypted it
                            };

                            // Update the messages list with this message
                            this.messages.update(msgs => [...msgs, directMessage]);
                        }
                    }
                }
            });

            // if (!wrappedEvents || wrappedEvents.length === 0) {
            //     this.hasMoreMessages.set(false);
            //     this.isLoadingMore.set(false);
            //     return;
            // }

            // // Process each wrapped message
            // const olderMessages: DirectMessage[] = [];

            // for (const event of wrappedEvents) {
            //     try {
            //         const unwrappedMessage = await this.unwrapMessage(event);
            //         if (unwrappedMessage) {
            //             olderMessages.push({
            //                 id: unwrappedMessage.id,
            //                 pubkey: unwrappedMessage.pubkey,
            //                 created_at: unwrappedMessage.created_at,
            //                 content: unwrappedMessage.content,
            //                 isOutgoing: unwrappedMessage.pubkey === myPubkey,
            //                 tags: unwrappedMessage.tags,
            //                 received: true,
            //                 read: true
            //             });
            //         }
            //     } catch (err) {
            //         this.logger.error('Failed to unwrap older message', err);
            //     }
            // }

            // // Sort messages by timestamp
            // const sortedOlderMessages = olderMessages.sort((a, b) => a.created_at - b.created_at);

            // // Add to the beginning of the current messages
            // this.messages.update(currentMsgs => [...sortedOlderMessages, ...currentMsgs]);

            // // There might be more messages
            // this.hasMoreMessages.set(sortedOlderMessages.length >= 25);

            // // Send read receipts for these messages
            // this.sendReadReceipts(sortedOlderMessages.filter(m => !m.isOutgoing).map(m => m.id));

            this.isLoadingMore.set(false);
        } catch (err) {
            this.logger.error('Failed to load more messages', err);
            this.isLoadingMore.set(false);
        }
    }

    /**
     * Select a chat from the list
     */
    selectChat(chat: Chat): void {
        this.selectedChatId.set(chat.id);
        this.showMobileList.set(false);

        // Mark chat as read when selected
        this.markChatAsRead(chat.id);
    }

    /**
     * Mark a chat as read
     */
    markChatAsRead(chatId: string): void {
        // Update the chat's unread count
        this.chats.update(chats =>
            chats.map(chat =>
                chat.id === chatId
                    ? { ...chat, unreadCount: 0 }
                    : chat
            )
        );

        // In a real implementation, we would also send read receipts for the messages
        const chat = this.chats().find(c => c.id === chatId);
        if (chat && this.messages().length > 0) {
            // Send read receipts for all messages from this pubkey
            const messageIds = this.messages()
                .filter(m => !m.isOutgoing && !m.read)
                .map(m => m.id);

            if (messageIds.length > 0) {
                this.sendReadReceipts(messageIds);
            }
        }
    }

    /**
     * Send read receipts for messages
     */
    async sendReadReceipts(messageIds: string[]): Promise<void> {
        if (messageIds.length === 0) return;

        const myPubkey = this.accountState.pubkey();
        if (!myPubkey) return;

        // Convert array of message IDs to an array of [e, ID] tags
        const eTags = messageIds.map(id => ['e', id]);

        try {
            const receiptEvent = {
                kind: RECEIPT_KIND,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: eTags,
                content: '' // Empty content for receipt events
            };

            // Sign the event
            const signedEvent = await this.nostr.signEvent(receiptEvent);

            // Publish to relays
            if (signedEvent) {
                await this.relay.getAccountPool().publish(this.relay.getAccountRelayUrls(), signedEvent);

                // Update message read status in local state
                this.messages.update(msgs =>
                    msgs.map(msg =>
                        messageIds.includes(msg.id)
                            ? { ...msg, read: true }
                            : msg
                    )
                );
            }
        } catch (err) {
            this.logger.error('Failed to send read receipts', err);
        }
    }    /**
     * Send a direct message using both NIP-04 and NIP-17
     */
    async sendMessage(): Promise<void> {
        const messageText = this.newMessageText().trim();
        if (!messageText || this.isSending()) return;

        const receiverPubkey = this.selectedChat()?.pubkey;
        if (!receiverPubkey) return;

        this.isSending.set(true);

        try {
            const myPubkey = this.accountState.pubkey();
            if (!myPubkey) {
                throw new Error('You need to be logged in to send messages');
            }

            // Get relays to publish to
            // TODO: Important, get all relays for the user we are sending DM to and include
            // it in this array for publishing the DM!!
            const relays = this.relay.getAccountRelayUrls();

            // Create a unique ID for the pending message
            const pendingId = `pending-${Date.now()}-${Math.random()}`;

            // Create a pending message to show immediately in the UI
            const pendingMessage: DirectMessage = {
                id: pendingId,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                content: messageText,
                isOutgoing: true,
                pending: true,
                tags: [['p', receiverPubkey]],
                received: false,
                encryptionType: this.supportsModernEncryption(this.selectedChat()!) ? 'nip17' : 'nip04'
            };

            // Add to the messages immediately so the user sees feedback
            this.messages.update(msgs => [...msgs, pendingMessage]);

            // Clear the input
            this.newMessageText.set('');

            // Determine which encryption to use based on chat and client capabilities
            const selectedChat = this.selectedChat()!;
            const useModernEncryption = this.supportsModernEncryption(selectedChat);

            let finalMessage: DirectMessage;

            if (useModernEncryption) {
                // Use NIP-17 encryption
                finalMessage = await this.sendNip17Message(messageText, receiverPubkey, myPubkey, relays);
            } else {
                // Use NIP-04 encryption for backwards compatibility
                finalMessage = await this.sendNip04Message(messageText, receiverPubkey, myPubkey, relays);
            }

            // Success: update the message to remove the pending state
            this.messages.update(msgs =>
                msgs.map(msg =>
                    msg.id === pendingId
                        ? {
                            ...finalMessage,
                            pending: false,
                            received: true
                        }
                        : msg
                )
            );

            // Update the last message for this chat in the chat list
            this.updateChatLastMessage(selectedChat.id, finalMessage);

            this.isSending.set(false);

            // Show success notification
            this.snackBar.open('Message sent', 'Close', {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'bottom'
            });

        } catch (err) {
            this.logger.error('Failed to send message', err);

            // Show error state for the message
            this.messages.update(msgs =>
                msgs.map(msg =>
                    msg.id.startsWith('pending-')
                        ? { ...msg, pending: false, failed: true }
                        : msg
                )
            );

            this.isSending.set(false);

            this.notifications.addNotification({
                id: Date.now().toString(),
                type: NotificationType.ERROR,
                title: 'Message Failed',
                message: 'Failed to send message. Please try again.',
                timestamp: Date.now(),
                read: false
            });
        }
    }

    /**
     * Update the last message for a chat
     */
    updateChatLastMessage(chatId: string, message: DirectMessage): void {
        this.chats.update(chats =>
            chats.map(chat =>
                chat.id === chatId
                    ? { ...chat, lastMessage: message }
                    : chat
            )
        );

        // Also re-sort the chats to put the most recent first
        this.chats.update(chats => {
            return [...chats].sort((a, b) => {
                const aTime = a.lastMessage?.created_at || 0;
                const bTime = b.lastMessage?.created_at || 0;
                return bTime - aTime;
            });
        });
    }

    /**
     * Retry sending a failed message
     */
    retryMessage(message: DirectMessage): void {
        // Remove the failed message
        this.messages.update(msgs => msgs.filter(msg => msg.id !== message.id));

        // Then set its content to the input field so the user can try again
        this.newMessageText.set(message.content);
    }

    /**
     * Start a new chat with a user
     */
    startNewChat(): void {
        // Navigate to the people page to select a user
        this.router.navigate(['/people'], {
            queryParams: { mode: 'select', returnUrl: '/messages' }
        });
    }

    /**
     * Delete a chat
     */
    async deleteChat(chat: Chat, event?: Event): Promise<void> {
        if (event) {
            event.stopPropagation();
        }

        // Show confirmation dialog
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            width: '400px',
            data: {
                title: 'Delete Chat',
                message: 'Are you sure you want to delete this chat? This will only remove it from your device.',
                confirmText: 'Delete',
                cancelText: 'Cancel'
            }
        });

        const result = await dialogRef.afterClosed().toPromise();
        if (!result) return;

        // Remove the chat from the list
        this.chats.update(chats => chats.filter(c => c.id !== chat.id));

        // If it was the selected chat, clear the selection
        if (this.selectedChatId() === chat.id) {
            this.selectedChatId.set(null);
            this.messages.set([]);
            this.showMobileList.set(true);
        }

        // In a real implementation, you might also want to delete all related messages from local storage
        this.snackBar.open('Chat deleted', 'Close', { duration: 3000 });
    }

    /**
     * Subscribe to new messages
     */
    subscribeToMessages(): void {
        const myPubkey = this.accountState.pubkey();
        if (!myPubkey) return;

        // Subscribe to gift-wrapped messages addressed to us
        this.messageSubscription = this.relay.getAccountPool().subscribe(this.relay.getAccountRelayUrls(), {
            kinds: [kinds.GiftWrap],
            '#p': [myPubkey],
            since: Math.floor(Date.now() / 1000) // Only get new messages from now on
        }, {
            maxWait: 5000,
            label: 'subscribeToMessages',
            onevent: async (event: NostrEvent) => {
                // Handle incoming wrapped events
                // Only process if it's not from us
                if (event.pubkey === myPubkey) return;

                try {
                    // Try to unwrap the message
                    const unwrappedMessage = await this.unwrapMessage(event);
                    if (!unwrappedMessage) return;

                    // Extract the sender pubkey
                    const senderPubkey = unwrappedMessage.pubkey;

                    // Check if we already have a chat with this user
                    let existingChat = this.chats().find(chat => chat.pubkey === senderPubkey);
                    let chatId: string;

                    if (existingChat) {
                        chatId = existingChat.id;

                        // Update the chat with this new message and increment unread count
                        this.chats.update(chats => {
                            return chats.map(chat => {
                                if (chat.pubkey === senderPubkey) {
                                    return {
                                        ...chat,
                                        lastMessage: {
                                            id: unwrappedMessage.id,
                                            pubkey: senderPubkey,
                                            created_at: unwrappedMessage.created_at,
                                            content: unwrappedMessage.content,
                                            isOutgoing: false,
                                            tags: unwrappedMessage.tags,
                                        },
                                        unreadCount: this.selectedChatId() === chat.id ? 0 : chat.unreadCount + 1
                                    };
                                }
                                return chat;
                            });
                        });
                    } else {
                        // Create a new chat for this sender
                        chatId = senderPubkey;

                        const newChat: Chat = {
                            id: chatId,
                            pubkey: senderPubkey,
                            unreadCount: 1,
                            lastMessage: {
                                id: unwrappedMessage.id,
                                pubkey: senderPubkey,
                                created_at: unwrappedMessage.created_at,
                                content: unwrappedMessage.content,
                                isOutgoing: false,
                                tags: unwrappedMessage.tags
                            }
                        };

                        // Add the chat to the list
                        this.chats.update(chats => [newChat, ...chats]);
                    }

                    // Re-sort the chats
                    this.chats.update(chats => {
                        return [...chats].sort((a, b) => {
                            const aTime = a.lastMessage?.created_at || 0;
                            const bTime = b.lastMessage?.created_at || 0;
                            return bTime - aTime;
                        });
                    });

                    // If this chat is currently selected, add the message to the view
                    if (this.selectedChatId() === chatId) {
                        const newMessage: DirectMessage = {
                            id: unwrappedMessage.id,
                            pubkey: senderPubkey,
                            created_at: unwrappedMessage.created_at,
                            content: unwrappedMessage.content,
                            isOutgoing: false,
                            tags: unwrappedMessage.tags,
                            received: true
                        };

                        this.messages.update(msgs => [...msgs, newMessage]);

                        // Send a read receipt
                        this.sendReadReceipts([newMessage.id]);
                    }

                    // Show notification for new message if not currently viewing this chat
                    if (this.selectedChatId() !== chatId) {
                        this.notifications.addNotification({
                            id: `message-${unwrappedMessage.id}`,
                            type: NotificationType.GENERAL,
                            title: 'New Message',
                            message: `New message from ${this.utilities.getTruncatedNpub(senderPubkey)}`,
                            timestamp: Date.now(),
                            read: false
                        });
                    }
                } catch (err) {
                    this.logger.error('Failed to process incoming message', err);
                }
            }
        });

        // // Handle incoming events
        // this.messageSubscription.on('event', async (event: any) => {

        // });

        // // Handle subscription closing
        // this.messageSubscription.on('eose', () => {
        //     this.logger.debug('Message subscription EOSE received');
        // });
    }

    /**
     * Back to list on mobile view
     */
    backToList(): void {
        this.showMobileList.set(true);
    }    /**
     * View profile of the selected chat
     */
    viewProfile(): void {
        const pubkey = this.selectedChat()?.pubkey;
        if (pubkey) {
            this.router.navigate(['/p', pubkey]);
        }
    }    /**
     * Check if a chat supports modern encryption (NIP-17)
     * For now, we'll always prefer modern encryption when available
     */
    private supportsModernEncryption(chat: Chat): boolean {
        // If chat already has an encryption type set, respect it
        if (chat.encryptionType) {
            return chat.encryptionType === 'nip17';
        }

        // For new chats, prefer modern encryption
        // In a more sophisticated implementation, we could check:
        // - If the recipient's client supports NIP-17
        // - User preferences
        // - Relay capabilities
        return true;
    }

    /**
     * Check if we should show encryption warning for a chat
     */
    shouldShowEncryptionWarning(chat: Chat): boolean {
        // Show warning for legacy NIP-04 chats
        return chat.encryptionType === 'nip04' || chat.isLegacy === true;
    }

    /**
     * Get encryption status message for a chat
     */
    getEncryptionStatusMessage(chat: Chat): string {
        if (chat.encryptionType === 'nip04' || chat.isLegacy === true) {
            return 'This chat uses legacy encryption (NIP-04). Consider starting a new chat for better security.';
        }
        return 'This chat uses modern encryption (NIP-17) for enhanced security.';
    }

    /**
     * Send a message using NIP-04 encryption (legacy)
     */
    private async sendNip04Message(
        messageText: string,
        receiverPubkey: string,
        myPubkey: string,
        relays: string[]
    ): Promise<DirectMessage> {
        try {
            // Encrypt the message using NIP-04
            const encryptedContent = await this.encryption.encryptNip04(messageText, receiverPubkey);

            // Create the event
            const event = {
                kind: DIRECT_MESSAGE_KIND,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', receiverPubkey]],
                content: encryptedContent
            };

            // Sign and finalize the event
            const signedEvent = await this.nostr.signEvent(event);

            // Publish to relays
            await this.publishToRelays(signedEvent, relays);

            // Return the message object
            return {
                id: signedEvent.id,
                pubkey: myPubkey,
                created_at: signedEvent.created_at,
                content: messageText, // Store decrypted content locally
                isOutgoing: true,
                tags: signedEvent.tags,
                encryptionType: 'nip04'
            };
        } catch (error) {
            this.logger.error('Failed to send NIP-04 message', error);
            throw error;
        }
    }

    /**
     * Send a message using NIP-17 encryption (modern)
     */
    private async sendNip17Message(
        messageText: string,
        receiverPubkey: string,
        myPubkey: string,
        relays: string[]
    ): Promise<DirectMessage> {
        try {
            // Create the inner chat message (kind 14)
            const chatMessage = {
                kind: CHAT_MESSAGE_KIND,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', receiverPubkey]],
                content: messageText
            };

            // Sign the chat message
            const signedChatMessage = await this.nostr.signEvent(chatMessage);

            // Create the sealed message (kind 13) - encrypt the chat message
            const sealedContent = await this.encryption.encryptNip44(
                JSON.stringify(signedChatMessage),
                receiverPubkey
            );

            const sealedMessage = {
                kind: SEALED_MESSAGE_KIND,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [],
                content: sealedContent
            };

            // Sign the sealed message
            const signedSealedMessage = await this.nostr.signEvent(sealedMessage);

            // Create the gift wrap (kind 1059) - this is what gets published
            // Generate a random key for the gift wrap
            const randomKey = generateSecretKey();
            const randomPubkey = getPublicKey(randomKey);

            const giftWrapContent = await this.encryption.encryptNip44(
                JSON.stringify(signedSealedMessage),
                receiverPubkey
            );

            const giftWrap = {
                kind: kinds.GiftWrap,
                pubkey: randomPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', receiverPubkey]],
                content: giftWrapContent
            };

            // Sign the gift wrap with the random key
            const signedGiftWrap = finalizeEvent(giftWrap, randomKey);

            // Publish the gift wrap to relays
            await this.publishToRelays(signedGiftWrap, relays);

            // Return the message object based on the original chat message
            return {
                id: signedChatMessage.id,
                pubkey: myPubkey,
                created_at: signedChatMessage.created_at,
                content: messageText,
                isOutgoing: true,
                tags: signedChatMessage.tags,
                encryptionType: 'nip17'
            };
        } catch (error) {
            this.logger.error('Failed to send NIP-17 message', error);
            throw error;
        }
    }

    /**
     * Publish an event to multiple relays
     */
    private async publishToRelays(event: NostrEvent, relays: string[]): Promise<void> {
        const promises = relays.map(async (relayUrl) => {
            try {
                // TODO: We want to have an "UserPool" and "AccountPool" to send
                // messages to, right now we are connecting to user relays using 
                // the account relay, we don't want to do that.
                if (this.relay.getAccountPool()) {
                    await this.relay.getAccountPool().publish([relayUrl], event);
                }
            } catch (error) {
                this.logger.error(`Failed to publish to relay ${relayUrl}`, error);
                // Don't throw here - we want to try all relays
            }
        });

        // Wait for all publish attempts to complete
        await Promise.allSettled(promises);
    }
}