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

// Define interfaces for our DM data structures
interface Chat {
    id: string;
    pubkey: string;
    unreadCount: number;
    lastMessage?: DirectMessage | null;
    relays?: string[];
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
}

// Constants for NIP-17 events
const DIRECT_MESSAGE_KIND = 14; // Chat messages in NIP-17
const SEALED_MESSAGE_KIND = 13; // Sealed messages in NIP-17
const GIFT_WRAPPED_KIND = 1059; // Gift wrapped messages in NIP-17
const RECEIPT_KIND = 1405; // For read receipts

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
    private nostr = inject(NostrService);
    private relay = inject(RelayService);
    private logger = inject(LoggerService);
    private notifications = inject(NotificationService);
    private dialog = inject(MatDialog);
    private storage = inject(StorageService);
    private router = inject(Router);
    private appState = inject(ApplicationStateService);
    private snackBar = inject(MatSnackBar);
    private readonly app = inject(ApplicationService);
    readonly utilities = inject(UtilitiesService);
    private readonly accountState = inject(AccountStateService);

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
    private relayPool: SimplePool | null = null;
    private preferredRelays = signal<string[]>([]);

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
            if (this.app.initialized()) {
                debugger;
                await this.loadPreferredRelays();
                await this.loadChats();
                this.subscribeToMessages();
            }
        });
    }

    ngOnInit(): void {
        // Initialize relay pool
        this.relayPool = new SimplePool();

        // Load user's preferred message relays
        // this.loadPreferredRelays().then(() => {
        //     debugger;
        //     // Load chats after relays are loaded
        //     this.loadChats();
        //     // Subscribe to new messages
        //     this.subscribeToMessages();
        // });
    }

    ngOnDestroy(): void {
        // Clean up subscriptions
        if (this.messageSubscription) {
            this.messageSubscription.close();
            //   this.relayPool?.unsubscribe(this.messageSubscription);
        }

        if (this.chatSubscription) {
            this.chatSubscription.close();
            // this.relayPool?.unsubscribe(this.chatSubscription);
        }

        // Close relay pool
        if (this.relayPool) {
            this.relayPool.close(this.relays);
        }
    }

    /**
     * Load user's preferred relays for messaging
     */
    async loadPreferredRelays() {
        this.preferredRelays.set(this.relay.relays.map(relay => relay.url));

        // try {
        //     const myPubkey = this.nostr.activeAccount()?.pubkey;
        //     if (!myPubkey) {
        //         throw new Error('Not logged in');
        //     }

        //     // First check for kind 10002 (relay list metadata)
        //     const relayListEvents = await this.relayPool?.list(this.getConnectedRelays(), [{
        //         kinds: [10002],
        //         authors: [myPubkey],
        //         limit: 1
        //     }]);

        //     if (relayListEvents && relayListEvents.length > 0) {
        //         // Parse relay list from the event
        //         const relayList = relayListEvents[0].tags
        //             .filter(tag => tag[0] === 'r')
        //             .map(tag => tag[1]);

        //         if (relayList.length > 0) {
        //             this.preferredRelays.set(relayList);
        //             return;
        //         }
        //     }

        //     // Fallback to connected relays
        //     this.preferredRelays.set(this.getConnectedRelays());

        // } catch (err) {
        //     this.logger.error('Failed to load preferred relays', err);
        //     // Fallback to connected relays
        //     this.preferredRelays.set(this.getConnectedRelays());
        // }
    }

    /**
     * Get currently connected relays
     */
    getConnectedRelays(): string[] {
        return this.relay.relays
            .filter(relay => relay.status === 'connected')
            .map(relay => relay.url);
    }

    relays: string[] = [];

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

            // Get relays to fetch from
            const relays = this.preferredRelays().length > 0
                ? this.preferredRelays()
                : this.getConnectedRelays();

            this.relays = relays;

            if (relays.length === 0) {
                this.error.set('No connected relays available.');
                this.isLoading.set(false);
                return;
            }

            const filter: Filter = {
                kinds: [GIFT_WRAPPED_KIND],
                '#p': [myPubkey],
                limit: 100
            };

            // Store pubkeys of people who've messaged us
            const chatPubkeys = new Set<string>();

            // First, look for existing gift-wrapped messages
            const sub = this.relayPool?.subscribe(relays, filter, {
                maxWait: 5000,
                label: 'loadChats',
                onevent: async (event: NostrEvent) => {
                    debugger;
                    // Handle incoming wrapped events
                    if (event.kind === GIFT_WRAPPED_KIND) {

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
                            await this.fetchLatestMessageForChat(chat.pubkey, relays);
                        }

                        // this.relayPool?.publish(relays, event);
                    }
                }
            });


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
            const ourMessages = await this.relayPool?.subscribe(relays, {
                kinds: [GIFT_WRAPPED_KIND],
                authors: [myPubkey],
                limit: 100
            }, {
                maxWait: 5000,
                label: 'loadChats',
                onevent: (event: NostrEvent) => {
                    debugger;
                    // Handle incoming wrapped events
                    if (event.kind === GIFT_WRAPPED_KIND) {

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
    async fetchLatestMessageForChat(pubkey: string, relays: string[]): Promise<void> {
        const myPubkey = this.accountState.pubkey();
        if (!myPubkey || !this.relayPool) return;

        try {
            // Fetch wrapped messages between us and this pubkey
            const wrappedEvents = await this.relayPool.subscribeManyEose(relays, [{
                kinds: [GIFT_WRAPPED_KIND],
                authors: [pubkey],
                '#p': [myPubkey],
                limit: 1
            }, {
                kinds: [GIFT_WRAPPED_KIND],
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
                        if (event.kind === GIFT_WRAPPED_KIND) {
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
            if (!myPubkey || !this.relayPool) {
                this.error.set('You need to be logged in to view messages');
                this.isLoading.set(false);
                return;
            }

            // Get relays to fetch from
            const relays = this.preferredRelays().length > 0
                ? this.preferredRelays()
                : this.getConnectedRelays();

            if (relays.length === 0) {
                this.error.set('No connected relays available.');
                this.isLoading.set(false);
                return;
            }

            // Fetch wrapped messages between us and this pubkey (in both directions)
            const wrappedEvents = await this.relayPool.subscribeManyEose(relays, [{
                kinds: [GIFT_WRAPPED_KIND],
                authors: [pubkey],
                '#p': [myPubkey],
                limit: 50
            }, {
                kinds: [GIFT_WRAPPED_KIND],
                authors: [myPubkey],
                '#p': [pubkey],
                limit: 50
            }], {
                maxWait: 5000,
                label: 'loadMessages',
                onevent: async (event: NostrEvent) => {
                    debugger;
                    // Handle incoming wrapped events
                    if (event.kind === GIFT_WRAPPED_KIND) {
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

            if (!pubkey || !myPubkey || !this.relayPool) {
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

            // Get relays to fetch from
            const relays = this.preferredRelays().length > 0
                ? this.preferredRelays()
                : this.getConnectedRelays();

            // Fetch older wrapped messages
            const wrappedEvents = await this.relayPool.subscribeManyEose(relays, [{
                kinds: [GIFT_WRAPPED_KIND],
                authors: [pubkey],
                '#p': [myPubkey],
                until: oldestTimestamp - 1,
                limit: 25
            }, {
                kinds: [GIFT_WRAPPED_KIND],
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
                    if (event.kind === GIFT_WRAPPED_KIND) {
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

            // Get relays to publish to
            const relays = this.preferredRelays().length > 0
                ? this.preferredRelays()
                : this.getConnectedRelays();

            // Publish to relays
            if (signedEvent && this.relayPool) {
                await this.relayPool.publish(relays, signedEvent);

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
    }

    /**
     * Send a direct message using NIP-17
     */
    async sendMessage(): Promise<void> {
        // const messageText = this.newMessageText().trim();
        // if (!messageText || this.isSending()) return;

        // const receiverPubkey = this.selectedChat()?.pubkey;
        // if (!receiverPubkey) return;

        // this.isSending.set(true);

        // try {
        //     const myPubkey = this.nostr.activeAccount()?.pubkey;
        //     if (!myPubkey) {
        //         throw new Error('You need to be logged in to send messages');
        //     }

        //     // Get relays to publish to
        //     const relays = this.preferredRelays().length > 0
        //         ? this.preferredRelays()
        //         : this.getConnectedRelays();

        //     if (relays.length === 0) {
        //         throw new Error('No connected relays available');
        //     }

        //     // Create a pending message to show immediately in the UI
        //     const pendingMessage: DirectMessage = {
        //         id: `pending-${Date.now()}`,
        //         pubkey: myPubkey,
        //         created_at: Math.floor(Date.now() / 1000),
        //         content: messageText,
        //         isOutgoing: true,
        //         pending: true,
        //         tags: [['p', receiverPubkey]]
        //     };

        //     // Add to the messages immediately so the user sees feedback
        //     this.messages.update(msgs => [...msgs, pendingMessage]);

        //     // Clear the input
        //     this.newMessageText.set('');

        //     // Step 1: Create the regular direct message (kind 14)
        //     const directMessage = {
        //         kind: DIRECT_MESSAGE_KIND,
        //         pubkey: myPubkey,
        //         created_at: Math.floor(Date.now() / 1000),
        //         tags: [['p', receiverPubkey]],
        //         content: messageText
        //     };

        //     // Sign the direct message
        //     const signedDirectMessage = await this.nostr.signEvent(directMessage);

        //     if (!signedDirectMessage) {
        //         throw new Error('Failed to sign direct message');
        //     }

        //     // Step 2: Seal the message (kind 13) using NIP-44
        //     const privateKey = await this.nostr.getActivePrivateKeySecure();
        //     if (!privateKey) {
        //         throw new Error('Could not get private key');
        //     }

        //     // Create shared secret for encryption
        //     const sharedSecret = getSharedSecret(privateKey, receiverPubkey);

        //     // Encrypt the direct message content
        //     const encryptedContent = await nip44.encrypt(sharedSecret, JSON.stringify(signedDirectMessage));

        //     // Create sealed message
        //     const sealedMessage = {
        //         kind: SEALED_MESSAGE_KIND,
        //         pubkey: myPubkey,
        //         created_at: Math.floor(Date.now() / 1000),
        //         tags: [['p', receiverPubkey]],
        //         content: encryptedContent
        //     };

        //     // Sign the sealed message
        //     const signedSealedMessage = await this.nostr.signEvent(sealedMessage);

        //     if (!signedSealedMessage) {
        //         throw new Error('Failed to sign sealed message');
        //     }

        //     // Step 3: Gift wrap the sealed message (kind 1059)
        //     // First, create a gift wrap for the recipient

        //     // Create another shared secret for the gift wrapping
        //     const recipientSharedSecret = getSharedSecret(privateKey, receiverPubkey);

        //     // Encrypt the sealed message for the recipient
        //     const recipientEncryptedMessage = await nip44.encrypt(recipientSharedSecret, JSON.stringify(signedSealedMessage));

        //     // Create recipient gift wrap
        //     const recipientGiftWrap = {
        //         kind: GIFT_WRAPPED_KIND,
        //         pubkey: myPubkey,
        //         created_at: Math.floor(Date.now() / 1000),
        //         tags: [['p', receiverPubkey]],
        //         content: JSON.stringify({
        //             recipientPubkey: receiverPubkey,
        //             encryptedMessage: recipientEncryptedMessage
        //         })
        //     };

        //     // Sign the recipient gift wrap
        //     const signedRecipientGiftWrap = await this.nostr.signEvent(recipientGiftWrap);

        //     if (!signedRecipientGiftWrap) {
        //         throw new Error('Failed to sign recipient gift wrap');
        //     }

        //     // Now create a self-addressed gift wrap so we can read our own messages
        //     // (In reality, we could just store our own messages locally too)

        //     // Create self gift wrap (we can just use the sealed message directly)
        //     const selfGiftWrap = {
        //         kind: GIFT_WRAPPED_KIND,
        //         pubkey: myPubkey,
        //         created_at: Math.floor(Date.now() / 1000),
        //         tags: [['p', myPubkey]],
        //         content: JSON.stringify({
        //             recipientPubkey: myPubkey,
        //             encryptedMessage: JSON.stringify(signedSealedMessage)
        //         })
        //     };

        //     // Sign the self gift wrap
        //     const signedSelfGiftWrap = await this.nostr.signEvent(selfGiftWrap);

        //     if (!signedSelfGiftWrap) {
        //         throw new Error('Failed to sign self gift wrap');
        //     }

        //     // Step 4: Publish the gift-wrapped messages to appropriate relays
        //     if (this.relayPool) {
        //         await this.relayPool.publish(relays, signedRecipientGiftWrap);
        //         await this.relayPool.publish(relays, signedSelfGiftWrap);

        //         // Success: update the message to remove the pending state
        //         this.messages.update(msgs =>
        //             msgs.map(msg =>
        //                 msg.id === pendingMessage.id
        //                     ? {
        //                         ...msg,
        //                         id: signedDirectMessage.id,
        //                         pending: false
        //                     }
        //                     : msg
        //             )
        //         );

        //         // Update the last message for this chat in the chat list
        //         this.updateChatLastMessage(this.selectedChat()?.id || '', {
        //             id: signedDirectMessage.id,
        //             pubkey: myPubkey,
        //             created_at: Math.floor(Date.now() / 1000),
        //             content: messageText,
        //             isOutgoing: true,
        //             tags: [['p', receiverPubkey]]
        //         });

        //         this.isSending.set(false);

        //         // Show success notification
        //         this.snackBar.open('Message sent', 'Close', {
        //             duration: 3000,
        //             horizontalPosition: 'center',
        //             verticalPosition: 'bottom'
        //         });
        //     }

        // } catch (err) {
        //     this.logger.error('Failed to send message', err);

        //     // Show error state for the message
        //     this.messages.update(msgs =>
        //         msgs.map(msg =>
        //             msg.id === `pending-${Date.now()}`
        //                 ? { ...msg, pending: false, failed: true }
        //                 : msg
        //         )
        //     );

        //     this.isSending.set(false);

        //     this.notifications.addNotification({
        //         id: Date.now().toString(),
        //         type: NotificationType.ERROR,
        //         title: 'Message Failed',
        //         message: 'Failed to send message. Please try again.',
        //         timestamp: Date.now(),
        //         read: false
        //     });
        // }
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
        if (!myPubkey || !this.relayPool) return;

        // Get relays to subscribe to
        const relays = this.preferredRelays().length > 0
            ? this.preferredRelays()
            : this.getConnectedRelays();

        if (relays.length === 0) return;

        // Subscribe to gift-wrapped messages addressed to us
        this.messageSubscription = this.relayPool.subscribe(relays, {
            kinds: [GIFT_WRAPPED_KIND],
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
    }

    /**
     * View profile of the selected chat
     */
    viewProfile(): void {
        const pubkey = this.selectedChat()?.pubkey;
        if (pubkey) {
            this.router.navigate(['/p', pubkey]);
        }
    }
}