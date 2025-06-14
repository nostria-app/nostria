import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, inject, signal, computed, effect, untracked } from '@angular/core';

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
import { kinds, SimplePool, getPublicKey, generateSecretKey, finalizeEvent, Event as NostrEvent, Filter } from 'nostr-tools';
import { ApplicationService } from '../../services/application.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { EncryptionService } from '../../services/encryption.service';
import { DataService } from '../../services/data.service';
import { MessagingService } from '../../services/messaging.service';
import { UserRelayFactoryService } from '../../services/user-relay-factory.service';
import { UserRelayService } from '../../services/user-relay.service';
import { AccountRelayService } from '../../services/account-relay.service';
import { LayoutService } from '../../services/layout.service';

// Define interfaces for our DM data structures
interface Chat {
    id: string;
    pubkey: string;
    unreadCount: number;
    lastMessage?: DirectMessage | null;
    relays?: string[];
    encryptionType?: 'nip04' | 'nip44';
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

@Component({
    selector: 'app-messages',
    standalone: true,
    imports: [
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
export class MessagesComponent implements OnInit, OnDestroy, AfterViewInit {
    private data = inject(DataService);
    private nostr = inject(NostrService);
    private relay = inject(RelayService);
    private logger = inject(LoggerService); messaging = inject(MessagingService);
    private notifications = inject(NotificationService);
    private userRelayFactory = inject(UserRelayFactoryService);
    private dialog = inject(MatDialog);
    private storage = inject(StorageService);
    private router = inject(Router);
    private appState = inject(ApplicationStateService);
    private snackBar = inject(MatSnackBar);
    private readonly app = inject(ApplicationService);
    readonly utilities = inject(UtilitiesService);
    private readonly accountState = inject(AccountStateService);
    private readonly encryption = inject(EncryptionService);
    layout = inject(LayoutService);// UI state signals
    isLoading = signal<boolean>(false);
    isLoadingMore = signal<boolean>(false);
    isSending = signal<boolean>(false);
    error = signal<string | null>(null);
    showMobileList = signal<boolean>(true);
    isDecryptingMessages = signal<boolean>(false);
    decryptionQueueLength = signal<number>(0);
    private accountRelayService = inject(AccountRelayService);

    // Data signals
    // chats = signal<Chat[]>([]);
    selectedChatId = signal<string | null>(null); selectedChat = computed(() => {
        const chatId = this.selectedChatId();
        if (!chatId) return null;
        return this.messaging.getChat(chatId) || null;
    });

    // activePubkey = computed(() => this.selectedChat()?.pubkey || '');
    messages = signal<DirectMessage[]>([]);
    newMessageText = signal<string>('');
    hasMoreMessages = signal<boolean>(false);
    // Track the last selected chat to determine if we should scroll to bottom
    private lastSelectedChatId = signal<string | null>(null);
    // Track if we're currently loading more messages to avoid scrolling
    private isLoadingMoreMessages = signal<boolean>(false);

    // Computed helpers
    hasChats = computed(() => this.messaging.sortedChats().length > 0);

    // Subscription management
    private messageSubscription: any = null;
    private chatSubscription: any = null;    // Decryption queue management
    private decryptionQueue: DecryptionQueueItem[] = [];
    private isProcessingQueue = false;    // ViewChild for scrolling functionality
    @ViewChild('messagesWrapper', { static: false }) messagesWrapper?: ElementRef<HTMLDivElement>;

    // Throttling for scroll handler
    private scrollThrottleTimeout: any = null; constructor() {        // Set up effect to handle chat selection and message updates
        effect(() => {
            const chat = this.selectedChat();

            if (chat) {
                untracked(() => {
                    const isNewChat = this.lastSelectedChatId() !== chat.id;
                    const chatMessages = this.messaging.getChatMessages(chat.id);
                    const currentMessages = this.messages();

                    if (isNewChat) {
                        // New chat selected - load all messages and scroll to bottom
                        this.lastSelectedChatId.set(chat.id);
                        this.messages.set(chatMessages || []);
                        this.hasMoreMessages.set(true);
                        this.scrollToBottom();

                        // Re-setup scroll listener for the new chat
                        setTimeout(() => {
                            this.setupScrollListener();
                        }, 200);

                        // Mark this chat as read when selected
                        // TODO: FIX, this will trigger selectedChat signal and cause infinite loop
                        // this.markChatAsRead(chat.id);
                    } else if (!this.isLoadingMoreMessages() && chatMessages.length > 0) {
                        // Same chat but check for new messages
                        const latestLocalTimestamp = currentMessages.length > 0
                            ? Math.max(...currentMessages.map(m => m.created_at))
                            : 0;
                        const latestChatTimestamp = Math.max(...chatMessages.map(m => m.created_at));

                        // If the chat has newer messages than what we're showing, update and scroll
                        if (latestChatTimestamp > latestLocalTimestamp) {
                            this.messages.set(chatMessages);
                            this.scrollToBottom();
                        }
                    }
                });
            }
        });

        // Listen to connection status changes
        effect(() => {
            if (this.appState.isOnline()) {
                this.error.set(null);
            } else {
                this.error.set('You are offline. Messages will be sent when you reconnect.');
            }
        });

        effect(async () => {
            if (this.accountState.initialized()) {
                await this.messaging.loadChats();
                // this.subscribeToMessages();
            }
        });
    }

    ngOnInit(): void {

    } ngAfterViewInit(): void {
        // Set up scroll event listener for loading more messages with a delay to ensure DOM is ready
        setTimeout(() => {
            this.setupScrollListener();
        }, 100);
    }

    /**
     * Set up scroll event listener to detect when user scrolls near the top
     */
    private setupScrollListener(): void {
        const scrollElement = this.messagesWrapper?.nativeElement;
        if (!scrollElement) {
            this.logger.warn('Messages wrapper element not found for scroll listener');
            return;
        }

        this.logger.debug('Setting up scroll listener for loadMoreMessages');

        // Remove any existing listener to avoid duplicates
        scrollElement.removeEventListener('scroll', this.scrollHandler);

        // Add the scroll event listener
        scrollElement.addEventListener('scroll', this.scrollHandler);
    }    /**
     * Scroll event handler - defined as arrow function to maintain 'this' context
     * Uses throttling to prevent excessive calls during rapid scrolling
     */
    private scrollHandler = () => {
        // Throttle the scroll handler to prevent excessive calls
        if (this.scrollThrottleTimeout) {
            return;
        }

        this.scrollThrottleTimeout = setTimeout(() => {
            this.scrollThrottleTimeout = null;

            const scrollElement = this.messagesWrapper?.nativeElement;
            if (!scrollElement) return;

            // Check if user is near the top and we have messages to load
            const { scrollTop, scrollHeight, clientHeight } = scrollElement;
            const threshold = 100; // pixels from top

            this.logger.debug(`Scroll position: ${scrollTop}, threshold: ${threshold}, hasMore: ${this.hasMoreMessages()}, isLoading: ${this.isLoadingMore()}, messages: ${this.messages().length}`);

            if (scrollTop <= threshold &&
                this.hasMoreMessages() &&
                !this.isLoadingMore() &&
                this.messages().length > 0) {
                debugger;

                this.logger.debug('Triggering loadMoreMessages from scroll');
                this.loadMoreMessages();
            }
        }, 100); // 100ms throttle
    };

    /**
     * Scroll the messages wrapper to the bottom to show latest messages
     */
    private scrollToBottom(): void {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => {
            if (this.messagesWrapper?.nativeElement) {
                const element = this.messagesWrapper.nativeElement;
                element.scrollTop = element.scrollHeight;
            }
        }, 100);
    } ngOnDestroy(): void {
        // Clean up scroll listener
        const scrollElement = this.messagesWrapper?.nativeElement;
        if (scrollElement) {
            scrollElement.removeEventListener('scroll', this.scrollHandler);
        }

        // Clean up throttle timeout
        if (this.scrollThrottleTimeout) {
            clearTimeout(this.scrollThrottleTimeout);
            this.scrollThrottleTimeout = null;
        }

        // Clean up subscriptions
        if (this.messageSubscription) {
            this.messageSubscription.close();
        }

        if (this.chatSubscription) {
            this.chatSubscription.close();
        }

        // Clear the decryption queue
        this.clearDecryptionQueue();
    }

    /**
     * Clear the decryption queue (useful for cleanup)
     */
    private clearDecryptionQueue(): void {
        this.messaging.clearDecryptionQueue();
    }
    /**
   * Load more messages (older messages)
   */
    async loadMoreMessages(): Promise<void> {
        this.logger.debug('loadMoreMessages called');

        if (this.isLoadingMore()) {
            this.logger.debug('Already loading more messages, skipping');
            return;
        }

        const selectedChat = this.selectedChat();
        if (!selectedChat) {
            this.logger.debug('No selected chat, skipping loadMoreMessages');
            return;
        }

        this.logger.debug(`Loading more messages for chat: ${selectedChat.id}`);
        this.isLoadingMore.set(true);
        this.isLoadingMoreMessages.set(true); // Prevent auto-scroll during loading

        try {
            const currentMessages = this.messages();
            const oldestTimestamp = currentMessages.length > 0
                ? Math.min(...currentMessages.map(m => m.created_at)) - 1
                : undefined;

            this.logger.debug(`Current messages count: ${currentMessages.length}, oldest timestamp: ${oldestTimestamp}`);

            // Store current scroll position to maintain it after loading new messages
            const scrollElement = this.messagesWrapper?.nativeElement;
            const scrollHeight = scrollElement?.scrollHeight || 0;
            const scrollTop = scrollElement?.scrollTop || 0;            // Load older messages from the messaging service
            const olderMessages = await this.messaging.loadMoreMessages(selectedChat.id, oldestTimestamp);

            this.logger.debug(`Loaded ${olderMessages.length} older messages`);

            // if (olderMessages.length === 0) {
            //     this.logger.debug('No more messages available, setting hasMoreMessages to false');
            //     this.hasMoreMessages.set(false);
            // } else {
            // Get the updated messages from the messaging service (includes decrypted content)
            const updatedChatMessages = this.messaging.getChatMessages(selectedChat.id);
            this.messages.set(updatedChatMessages);

            // Restore scroll position after DOM update
            setTimeout(() => {
                if (scrollElement) {
                    const newScrollHeight = scrollElement.scrollHeight;
                    const heightDiff = newScrollHeight - scrollHeight;
                    scrollElement.scrollTop = scrollTop + heightDiff;
                    this.logger.debug(`Restored scroll position: ${scrollElement.scrollTop} (diff: ${heightDiff})`);
                }
            }, 50);
            // }

        } catch (err) {
            this.logger.error('Failed to load more messages', err);
            this.error.set('Failed to load older messages. Please try again.');
        } finally {
            this.isLoadingMore.set(false);
            this.isLoadingMoreMessages.set(false); // Re-enable auto-scroll
        }
    }

    /**
     * Load more chats by fetching older messages
     */
    loadMoreChats(): void {
        this.messaging.loadMoreChats();
    }

    /**
     * Select a chat from the list
     */
    selectChat(chat: Chat): void {
        this.selectedChatId.set(chat.id);

        // Only hide the chat list on mobile devices
        if (this.layout.isHandset()) {
            this.showMobileList.set(false);
        }

        // Mark chat as read when selected
        this.markChatAsRead(chat.id);
    }

    /**
     * Mark a chat as read
     */
    markChatAsRead(chatId: string): void {
        // Update the chat's unread count
        // this.chats.update(chats =>
        //     chats.map(chat =>
        //         chat.id === chatId
        //             ? { ...chat, unreadCount: 0 }
        //             : chat
        //     )
        // );

        // // In a real implementation, we would also send read receipts for the messages
        // const chat = this.chats().find(c => c.id === chatId);
        // if (chat && this.messages().length > 0) {
        //     // Send read receipts for all messages from this pubkey
        //     const messageIds = this.messages()
        //         .filter(m => !m.isOutgoing && !m.read)
        //         .map(m => m.id);

        //     if (messageIds.length > 0) {
        //         this.sendReadReceipts(messageIds);
        //     }
        // }
    }

    /**
     * Send a direct message using both NIP-04 and NIP-44
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
            // const relays = this.relay.getAccountRelayUrls();
            const userRelay = await this.userRelayFactory.create(receiverPubkey);

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
                encryptionType: this.supportsModernEncryption(this.selectedChat()!) ? 'nip44' : 'nip04'
            };            // Add to the messages immediately so the user sees feedback
            this.messages.update(msgs => [...msgs, pendingMessage]);

            // Scroll to bottom for new outgoing messages
            this.scrollToBottom();

            // Clear the input
            this.newMessageText.set('');

            // Determine which encryption to use based on chat and client capabilities
            const selectedChat = this.selectedChat()!;
            const useModernEncryption = this.supportsModernEncryption(selectedChat);

            let finalMessage: DirectMessage;

            if (useModernEncryption) {
                // Use NIP-44 encryption
                finalMessage = await this.sendNip44Message(messageText, receiverPubkey, myPubkey, userRelay);
            } else {
                // Use NIP-04 encryption for backwards compatibility
                finalMessage = await this.sendNip04Message(messageText, receiverPubkey, myPubkey, userRelay);
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
            // this.updateChatLastMessage(selectedChat.id, finalMessage);

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
        // if (event) {
        //     event.stopPropagation();
        // }

        // // Show confirmation dialog
        // const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        //     width: '400px',
        //     data: {
        //         title: 'Delete Chat',
        //         message: 'Are you sure you want to delete this chat? This will only remove it from your device.',
        //         confirmText: 'Delete',
        //         cancelText: 'Cancel'
        //     }
        // });

        // const result = await dialogRef.afterClosed().toPromise();
        // if (!result) return;

        // // Remove the chat from the list
        // this.chats.update(chats => chats.filter(c => c.id !== chat.id));

        // // If it was the selected chat, clear the selection
        // if (this.selectedChatId() === chat.id) {
        //     this.selectedChatId.set(null);
        //     this.messages.set([]);
        //     this.showMobileList.set(true);
        // }

        // // In a real implementation, you might also want to delete all related messages from local storage
        // this.snackBar.open('Chat deleted', 'Close', { duration: 3000 });
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

    /**
     * Check if a chat supports modern encryption (NIP-44)
     * For now, we'll always prefer modern encryption when available
     */
    private supportsModernEncryption(chat: Chat): boolean {
        // If chat already has an encryption type set, respect it
        if (chat.encryptionType) {
            return chat.encryptionType === 'nip44';
        }

        // For new chats, prefer modern encryption
        // In a more sophisticated implementation, we could check:
        // - If the recipient's client supports NIP-44
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
        return 'This chat uses modern encryption (NIP-44) for enhanced security.';
    }

    /**
     * Send a message using NIP-04 encryption (legacy)
     */
    private async sendNip04Message(
        messageText: string,
        receiverPubkey: string,
        myPubkey: string,
        userRelay: UserRelayService
    ): Promise<DirectMessage> {
        try {
            // Encrypt the message using NIP-04
            const encryptedContent = await this.encryption.encryptNip04(messageText, receiverPubkey);

            // Create the event
            const event = {
                kind: kinds.EncryptedDirectMessage,
                pubkey: myPubkey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', receiverPubkey]],
                content: encryptedContent
            };

            // Sign and finalize the event
            const signedEvent = await this.nostr.signEvent(event);

            // Publish to relays
            await this.publishToRelays(signedEvent, userRelay);

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
     * Send a message using NIP-44 encryption (modern)
     */
    private async sendNip44Message(
        messageText: string,
        receiverPubkey: string,
        myPubkey: string,
        userRelay: UserRelayService
    ): Promise<DirectMessage> {
        try {
            // Create the inner chat message (kind 14)
            const chatMessage = {
                kind: kinds.PrivateDirectMessage,
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
                kind: kinds.Seal,
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
            await this.publishToRelays(signedGiftWrap, userRelay);

            // Return the message object based on the original chat message
            return {
                id: signedChatMessage.id,
                pubkey: myPubkey,
                created_at: signedChatMessage.created_at,
                content: messageText,
                isOutgoing: true,
                tags: signedChatMessage.tags,
                encryptionType: 'nip44'
            };
        } catch (error) {
            this.logger.error('Failed to send NIP-44 message', error);
            throw error;
        }
    }

    /**
     * Publish an event to multiple relays
     */
    private async publishToRelays(event: NostrEvent, userRelay: UserRelayService): Promise<void> {
        const promisesUser = userRelay.publish(event);
        const promisesAccount = this.accountRelayService.publish(event);

        // Wait for all publish attempts to complete
        await Promise.allSettled([promisesUser, promisesAccount]);
    }
}