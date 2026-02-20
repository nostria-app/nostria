import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  inject,
  signal,
  computed,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


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
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { NotificationType } from '../../services/database.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { NPubPipe } from '../../pipes/npub.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { AgoPipe } from '../../pipes/ago.pipe';
import { LinkifyPipe } from '../../pipes/linkify.pipe';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
import {
  StartChatDialogComponent,
  StartChatDialogResult,
} from '../../components/start-chat-dialog/start-chat-dialog.component';
import {
  kinds,
  getPublicKey,
  generateSecretKey,
  finalizeEvent,
  Event as NostrEvent,
  getEventHash,
  nip19,
} from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ApplicationService } from '../../services/application.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { EncryptionService } from '../../services/encryption.service';
import { EncryptionPermissionService } from '../../services/encryption-permission.service';
import { DataService } from '../../services/data.service';
import { MessagingService } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { NamePipe } from '../../pipes/name.pipe';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UserRelayService } from '../../services/relays/user-relay';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { DatabaseService } from '../../services/database.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { SpeechService } from '../../services/speech.service';
import { SettingsService } from '../../services/settings.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { MediaService } from '../../services/media.service';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EmojiPickerComponent } from '../../components/emoji-picker/emoji-picker.component';

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

interface MessageGroup {
  dateLabel: string;
  dateTimestamp: number;
  messages: DirectMessage[];
}

@Component({
  selector: 'app-messages',
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
    MatTabsModule,
    MatSidenavModule,
    MatProgressBarModule,
    RouterModule,
    LoadingOverlayComponent,
    UserProfileComponent,
    TimestampPipe,
    AgoPipe,
    LinkifyPipe,
    MessageContentComponent,
    NamePipe,
    EmojiPickerComponent,
  ],
  templateUrl: './messages.component.html',
  styleUrl: './messages.component.scss',
})
export class MessagesComponent implements OnInit, OnDestroy, AfterViewInit {
  private data = inject(DataService);
  private nostr = inject(NostrService);
  // private relay = inject(AccountRelayServiceEx);
  private logger = inject(LoggerService);
  messaging = inject(MessagingService);
  private notifications = inject(NotificationService);
  private userRelayService = inject(UserRelayService);
  private customDialog = inject(CustomDialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private appState = inject(ApplicationStateService);
  private snackBar = inject(MatSnackBar);
  private readonly app = inject(ApplicationService);
  readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);
  readonly encryption = inject(EncryptionService);
  private readonly encryptionPermission = inject(EncryptionPermissionService);
  layout = inject(LayoutService); // UI state signals
  private readonly database = inject(DatabaseService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly speechService = inject(SpeechService);
  private readonly settings = inject(SettingsService);
  readonly localSettings = inject(LocalSettingsService);
  readonly mediaService = inject(MediaService);

  @ViewChild('chatSearchInput') chatSearchInput?: ElementRef<HTMLInputElement>;

  isLoading = signal<boolean>(false);
  isLoadingMore = signal<boolean>(false);
  isSending = signal<boolean>(false);
  isVoiceListening = signal<boolean>(false);
  isVoiceTranscribing = signal<boolean>(false);
  isUploading = signal<boolean>(false);
  uploadStatus = signal<string>('');
  mediaPreviews = signal<{ url: string; type: 'image' | 'video' }[]>([]);
  error = signal<string | null>(null);
  showMobileList = signal<boolean>(true);
  selectedTabIndex = signal<number>(0); // 0 = Following, 1 = Others
  chatSearchQuery = signal<string>(''); // Search query for filtering chats
  showChatDetails = signal<boolean>(false); // Chat details sidepanel
  showHiddenChats = signal<boolean>(false); // Toggle to show hidden chats
  showSearch = signal<boolean>(false); // Toggle search input visibility

  // Long-press support for touch devices
  longPressedMessage = signal<DirectMessage | null>(null);
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly LONG_PRESS_DURATION = 500; // 500ms for long press

  // Computed signal for single-pane view - collapse chat list when mobile or when right panel is open
  // This enables the same behavior as mobile (toggle between list and thread) when viewing
  // a profile or event from the messages, as the left panel shrinks to 700px
  isSinglePaneView = computed(() => this.layout.isHandset() || this.layout.hasNavigationItems());
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);

  // Timeout duration for waiting for chats to load when opening a specific chat
  private readonly CHAT_LOAD_TIMEOUT_MS = 10000;

  // Data signals
  // chats = signal<Chat[]>([]);
  selectedChatId = signal<string | null>(null);

  selectedChat = computed(() => {
    const chatId = this.selectedChatId();
    this.logger.debug('selectedChat computed - chatId:', chatId);
    if (!chatId) return null;
    const chat = this.messaging.getChat(chatId);
    this.logger.debug('selectedChat computed - chat found:', chat ? 'yes' : 'no');
    return chat || null;
  });

  // activePubkey = computed(() => this.selectedChat()?.pubkey || '');
  // Track pending/local messages that haven't been persisted yet
  private pendingMessages = signal<DirectMessage[]>([]);

  // Computed signal for messages - merges persisted messages with pending ones
  messages = computed(() => {
    const chatId = this.selectedChatId();
    if (!chatId) return [];

    const persistedMessages = this.messaging.getChatMessages(chatId);

    // Get the IDs of all persisted messages
    const persistedIds = new Set(persistedMessages.map(m => m.id));

    // Only include pending messages that aren't already in persisted messages
    const pending = this.pendingMessages().filter(m => {
      // Skip if this message is already persisted
      if (persistedIds.has(m.id)) {
        return false;
      }

      // Filter pending messages for this chat
      const chat = this.selectedChat();
      if (!chat) return false;

      // Check if message is for this chat (based on tags for outgoing messages)
      const pTags = m.tags.filter(tag => tag[0] === 'p');
      return pTags.some(tag => tag[1] === chat.pubkey);
    });

    // Merge, filter hidden, and sort by timestamp
    return [...persistedMessages, ...pending]
      .filter(m => !this.messaging.isMessageHidden(chatId, m.id, true))
      .sort((a, b) => a.created_at - b.created_at);
  });

  // Computed signal for messages grouped by date
  groupedMessages = computed(() => {
    const msgs = this.messages();
    if (msgs.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of msgs) {
      const messageDate = new Date(message.created_at * 1000);
      const dateKey = this.getDateKey(messageDate);
      const dateLabel = this.getDateLabel(messageDate);

      if (!currentGroup || currentGroup.dateTimestamp !== dateKey) {
        currentGroup = {
          dateLabel,
          dateTimestamp: dateKey,
          messages: []
        };
        groups.push(currentGroup);
      }

      currentGroup.messages.push(message);
    }

    return groups;
  });

  newMessageText = signal<string>('');
  hasMoreMessages = signal<boolean>(false);
  // Track which message is being replied to
  replyingToMessage = signal<DirectMessage | null>(null);
  // Track the last selected chat to determine if we should scroll to bottom
  private lastSelectedChatId = signal<string | null>(null);
  // Track if we're currently loading more messages to avoid scrolling
  private isLoadingMoreMessages = signal<boolean>(false);
  // Track the previous account pubkey to detect actual account changes
  private lastAccountPubkey = signal<string | null>(null);
  // Track the last message count to detect new incoming messages
  private lastMessageCount = signal<number>(0);

  // Computed helpers
  hasChats = computed(() => this.messaging.sortedChats().length > 0);

  // Check if the selected chat is a "Note to Self" chat
  isNoteToSelf = computed(() => {
    const chat = this.selectedChat();
    const myPubkey = this.accountState.pubkey();
    return chat?.pubkey === myPubkey;
  });

  // Chat details computed signals
  chatMessageCount = computed(() => this.messages().length);

  chatStartDate = computed(() => {
    const msgs = this.messages();
    if (msgs.length === 0) return null;
    const earliest = Math.min(...msgs.map(m => m.created_at));
    return earliest;
  });

  sharedLinks = computed(() => {
    const msgs = this.messages();
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
    const links: { url: string; timestamp: number; isOutgoing: boolean }[] = [];

    for (const msg of msgs) {
      const matches = msg.content.match(urlRegex);
      if (matches) {
        for (const url of matches) {
          links.push({
            url,
            timestamp: msg.created_at,
            isOutgoing: msg.isOutgoing
          });
        }
      }
    }

    return links;
  });

  sharedFiles = computed(() => {
    const links = this.sharedLinks();
    const fileExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|txt|csv|json|xml)$/i;
    return links.filter(link => fileExtensions.test(link.url));
  });

  sharedMedia = computed(() => {
    const links = this.sharedLinks();
    const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg)$/i;
    return links.filter(link => mediaExtensions.test(link.url));
  });

  // Helper to check if a chat matches the search query
  private chatMatchesSearch(chat: Chat, query: string): boolean {
    if (!query) return true;

    const lowerQuery = query.toLowerCase();

    // Check if pubkey starts with the query (for npub search)
    if (chat.pubkey.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Check profile name/display_name
    const profile = this.data.getCachedProfile(chat.pubkey);
    if (profile?.data) {
      const name = profile.data.name?.toLowerCase() || '';
      const displayName = profile.data.display_name?.toLowerCase() || '';
      const nip05Value = profile.data.nip05;
      const nip05 = (Array.isArray(nip05Value) ? nip05Value[0] : nip05Value)?.toLowerCase() || '';
      if (name.includes(lowerQuery) || displayName.includes(lowerQuery) || nip05.includes(lowerQuery)) {
        return true;
      }
    }

    // Check message content
    if (chat.lastMessage?.content?.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Check all messages in the chat
    for (const message of chat.messages.values()) {
      if (message.content?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
    }

    return false;
  }

  // Helper to check if a chat is hidden
  private isChatHidden(chatId: string): boolean {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return false;
    return this.accountLocalState.isChatHidden(pubkey, chatId, true);
  }

  // Helper to check if a chat is "Note to Self"
  isChatNoteToSelf(chat: Chat): boolean {
    const myPubkey = this.accountState.pubkey();
    return chat.pubkey === myPubkey;
  }

  // Computed signal for "Note to Self" chat (shown separately at top)
  noteToSelfChat = computed(() => {
    const myPubkey = this.accountState.pubkey();
    const query = this.chatSearchQuery();
    const showHidden = this.showHiddenChats();

    const noteToSelf = this.messaging.sortedChats().find(item => item.chat.pubkey === myPubkey);
    if (!noteToSelf) return null;

    // Apply search filter
    if (query && !this.chatMatchesSearch(noteToSelf.chat, query)) return null;

    // Apply hidden filter
    if (!showHidden && this.isChatHidden(noteToSelf.chat.id)) return null;

    return noteToSelf;
  });

  // Filtered chats based on selected tab and search query (excluding Note to Self)
  // Optimized with Set for O(1) following list lookups
  followingChats = computed(() => {
    const followingList = this.accountState.followingList();
    const followingSet = new Set(followingList);
    const myPubkey = this.accountState.pubkey();
    const query = this.chatSearchQuery();
    const showHidden = this.showHiddenChats();
    return this.messaging.sortedChats()
      .filter(item => item.chat.pubkey !== myPubkey) // Exclude Note to Self
      .filter(item => followingSet.has(item.chat.pubkey))
      .filter(item => this.chatMatchesSearch(item.chat, query))
      .filter(item => showHidden || !this.isChatHidden(item.chat.id));
  });

  otherChats = computed(() => {
    const followingList = this.accountState.followingList();
    const followingSet = new Set(followingList);
    const myPubkey = this.accountState.pubkey();
    const query = this.chatSearchQuery();
    const showHidden = this.showHiddenChats();
    return this.messaging.sortedChats()
      .filter(item => item.chat.pubkey !== myPubkey) // Exclude Note to Self
      .filter(item => !followingSet.has(item.chat.pubkey))
      .filter(item => this.chatMatchesSearch(item.chat, query))
      .filter(item => showHidden || !this.isChatHidden(item.chat.id));
  });

  filteredChats = computed(() => {
    const tabIndex = this.selectedTabIndex();
    return tabIndex === 0 ? this.followingChats() : this.otherChats();
  });

  hasFollowingChats = computed(() => this.followingChats().length > 0 || this.noteToSelfChat() !== null);
  hasOtherChats = computed(() => this.otherChats().length > 0);

  // Subscription management
  private messageSubscription: any = null;
  private chatSubscription: any = null;
  private readonly destroyRef = inject(DestroyRef);

  // ViewChild for scrolling functionality
  @ViewChild('messagesWrapper', { static: false })
  messagesWrapper?: ElementRef<HTMLDivElement>;

  // ViewChild for chat list scrolling
  @ViewChild('messageThreads', { static: false })
  messageThreads?: ElementRef<HTMLDivElement>;

  // ViewChild for message input to auto-focus
  @ViewChild('messageInput', { static: false })
  messageInput?: ElementRef<HTMLTextAreaElement>;

  // ViewChild for file upload input
  @ViewChild('mediaFileInput', { static: false })
  mediaFileInput?: ElementRef<HTMLInputElement>;

  // Throttling for scroll handler
  private scrollThrottleTimeout: any = null;
  private chatListScrollThrottleTimeout: any = null;
  private chatListScrollElement: HTMLElement | null = null;

  constructor() {
    // Initialize lastAccountPubkey with current account to avoid false "account changed" on first load
    this.lastAccountPubkey.set(this.accountState.account()?.pubkey || null);

    // Effect to sync mobile nav visibility with chat selection on mobile
    effect(() => {
      const chatId = this.selectedChatId();
      const isSinglePane = this.isSinglePaneView();
      const showingMobileList = this.showMobileList();

      // On single-pane view (mobile or right panel open), hide the nav when viewing a chat, show it when viewing the list
      if (isSinglePane) {
        this.layout.hideMobileNav.set(chatId !== null && !showingMobileList);
      }
    });

    // Effect to clean up pending messages once they're persisted
    effect(() => {
      const chatId = this.selectedChatId();
      if (!chatId) return;

      untracked(() => {
        const persistedMessages = this.messaging.getChatMessages(chatId);
        const persistedIds = new Set(persistedMessages.map(m => m.id));

        // Remove any pending messages that are now persisted
        this.pendingMessages.update(msgs =>
          msgs.filter(msg => !persistedIds.has(msg.id))
        );
      });
    });

    // Set up effect to handle chat selection and message updates
    effect(() => {
      // Only watch the chatId to avoid triggering on unreadCount changes
      const chatId = this.selectedChatId();
      this.logger.debug('Effect triggered - selectedChatId:', chatId);

      if (chatId) {
        untracked(() => {
          // Get the chat inside untracked to avoid watching its properties
          const chat = this.messaging.getChat(chatId);
          if (!chat) {
            this.logger.warn('Chat not found for id:', chatId);
            return;
          }

          const isNewChat = this.lastSelectedChatId() !== chatId;
          const chatMessages = this.messaging.getChatMessages(chatId);
          const currentMessages = this.messages();

          if (isNewChat) {
            this.logger.debug('New chat selected in effect:', chatId);
            // New chat selected - load all messages and scroll to bottom
            this.lastSelectedChatId.set(chatId);
            // Clear pending messages and reply context when switching chats
            this.pendingMessages.set([]);
            this.replyingToMessage.set(null);
            this.hasMoreMessages.set(true);
            // Reset message count tracking for the new chat
            this.lastMessageCount.set(chatMessages.length);
            this.scrollToBottom();

            // Re-setup scroll listener for the new chat
            setTimeout(() => {
              this.setupScrollListener();
            }, 200);
          } else if (!this.isLoadingMoreMessages() && chatMessages.length > 0) {
            // Same chat but check for new messages
            const latestLocalTimestamp =
              this.messages().length > 0 ? Math.max(...this.messages().map(m => m.created_at)) : 0;
            const latestChatTimestamp = Math.max(...chatMessages.map(m => m.created_at));

            // If the chat has newer messages than what we're showing, scroll to bottom
            if (latestChatTimestamp > latestLocalTimestamp) {
              this.scrollToBottom();
            }
          }
        });
      }
    });

    // Effect to scroll to bottom when new messages arrive in the selected chat
    effect(() => {
      const currentMessages = this.messages();
      const messageCount = currentMessages.length;
      const chatId = this.selectedChatId();

      if (!chatId || messageCount === 0) {
        this.lastMessageCount.set(0);
        return;
      }

      const previousCount = this.lastMessageCount();

      // If we have more messages than before and we're not loading older messages,
      // scroll to bottom (new message received)
      if (messageCount > previousCount && previousCount > 0 && !this.isLoadingMoreMessages()) {
        this.scrollToBottom();
      }

      // Update the last message count
      this.lastMessageCount.set(messageCount);
    });

    // Listen to connection status changes
    effect(() => {
      if (this.appState.isOnline()) {
        this.error.set(null);
      } else {
        this.error.set('You are offline. Messages will be sent when you reconnect.');
      }
    });

    effect(() => {
      const account = this.accountState.account();
      const currentPubkey = account?.pubkey || null;
      const previousPubkey = this.lastAccountPubkey();

      if (account) {
        untracked(() => {
          // Only clear state if the account ACTUALLY changed (different pubkey)
          // This prevents clearing state on effect re-runs with the same account
          if (currentPubkey !== previousPubkey) {
            this.logger.debug('Account changed from', previousPubkey, 'to', currentPubkey);

            // Update tracked pubkey
            this.lastAccountPubkey.set(currentPubkey);

            // Clear local state when account changes
            this.pendingMessages.set([]);
            this.selectedChatId.set(null);

            // Clear the messaging service's in-memory state to prevent data from
            // previous account bleeding into the new account's view
            this.messaging.clear();

            // Reload chats for the new account (only if user is on messages page)
            // This is component-level loading, not global
            this.logger.debug('Reloading chats for new account on messages page');

            // Use setTimeout to ensure the call happens after the current effect cycle
            setTimeout(() => {
              this.logger.debug('Calling loadChats after account change');
              this.messaging.loadChats();
            }, 0);

            // Navigate back to messages list (without chat ID) if we're on a specific chat route
            if (this.router.url.startsWith('/messages/') && this.router.url !== '/messages') {
              this.router.navigate(['/messages']);
            }
          }
        });
      }
    });

    // Watch for text changes and ensure textarea scrolls to show cursor
    effect(() => {
      // Read the signal to track changes
      this.newMessageText();
      
      // Use untracked to avoid infinite loops and schedule after DOM updates
      untracked(() => {
        setTimeout(() => {
          const textarea = this.messageInput?.nativeElement;
          if (textarea) {
            // Only scroll if we're not already at the bottom
            // This avoids unnecessary DOM operations on every keystroke
            const isAtBottom = textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 5;
            if (!isAtBottom) {
              textarea.scrollTop = textarea.scrollHeight;
            }
          }
        }, 0);
      });
    });
  }

  ngOnInit(): void {

    // Start live subscription for incoming DMs
    this.startLiveSubscription();

    // Check for route parameters first to see if we need to start a specific chat
    this.route.queryParams.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(params => {
      const pubkey = params['pubkey'];
      if (pubkey) {
        this.logger.debug('Query param pubkey detected:', pubkey);

        // Ensure chats are loaded before attempting to start the chat
        // Check if we need to trigger initial load
        if (!this.messaging.isLoading() && this.messaging.sortedChats().length === 0) {
          this.logger.debug('Chats not loaded yet, starting load process for DM link...');
          // Start loading and wait for completion before starting chat
          this.messaging.loadChats().then(() => {
            this.logger.debug('Chat loading completed, now starting chat');
            this.startChatWithPubkey(pubkey);
          }).catch(error => {
            this.logger.error('Failed to load chats for DM link:', error);
            // Try to start chat anyway - it will create a temp chat
            this.startChatWithPubkey(pubkey);
          });
        } else if (this.messaging.isLoading()) {
          this.logger.debug('Chats are currently loading, waiting for completion...');

          // Use an effect to wait for loading to complete with a timeout fallback
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          const waitEffect = effect(() => {
            if (!this.messaging.isLoading()) {
              this.logger.debug('Chats finished loading, now starting chat with pubkey');
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
              }
              untracked(() => {
                this.startChatWithPubkey(pubkey);
                waitEffect.destroy(); // Clean up the effect
              });
            }
          });

          // Add a timeout fallback in case loading never completes
          timeoutHandle = setTimeout(() => {
            this.logger.warn('Chat loading timeout reached, attempting to start chat anyway');
            untracked(() => {
              waitEffect.destroy();
              this.startChatWithPubkey(pubkey);
            });
          }, this.CHAT_LOAD_TIMEOUT_MS);
        } else {
          // Chats already loaded - refresh to get any missed messages, then start chat
          this.logger.debug('Chats already loaded, refreshing and starting chat');
          this.messaging.refreshChats().then(() => {
            this.startChatWithPubkey(pubkey);
          }).catch(() => {
            // Still start the chat even if refresh fails
            this.startChatWithPubkey(pubkey);
          });
        }
      } else {
        // No pubkey query param - just do regular initialization
        // Always load all cached chats from database to ensure nothing is missed
        if (!this.messaging.isLoading()) {
          this.logger.debug('Loading chats on messages component init (no DM link)');
          // Always call loadChats() to ensure all cached chats are loaded from database
          // loadChats() internally calls load() which loads from IndexedDB first
          this.messaging.loadChats();
        }
      }
    });
  }

  /**
   * Start the live subscription for incoming DMs.
   * This allows the message list to auto-update when new DMs arrive.
   */
  private async startLiveSubscription(): Promise<void> {
    // Close any existing subscriptions first
    if (this.messageSubscription) {
      this.messageSubscription.close();
      this.messageSubscription = null;
    }

    // Start the live subscription via the messaging service
    const sub = await this.messaging.subscribeToIncomingMessages();
    if (sub) {
      this.messageSubscription = sub;
      this.logger.debug('Live DM subscription started');
    }
  }

  toggleSearch(): void {
    this.showSearch.update(v => !v);
    if (!this.showSearch()) {
      this.chatSearchQuery.set('');
    }
  }

  ngAfterViewInit(): void {
    // Set up scroll event listener for loading more messages with a delay to ensure DOM is ready
    setTimeout(() => {
      this.setupScrollListener();
    }, 100);

    // Set up chat list scroll listener with longer delay to ensure tabs are rendered
    setTimeout(() => {
      this.setupChatListScrollListener();
    }, 500);

  }

  /**
   * Set up scroll event listener for chat list to auto-load more chats
   */
  private setupChatListScrollListener(retryCount = 0): void {
    const messageThreadsEl = this.messageThreads?.nativeElement;
    if (!messageThreadsEl) {
      this.logger.warn('Message threads element not found for scroll listener');
      return;
    }

    // The actual scrollable element is the mat-mdc-tab-body-content inside the tab group
    // Try multiple selectors to find the scrollable element
    let scrollElement: Element | null = null;

    // First try: active tab body content
    scrollElement = messageThreadsEl.querySelector('.mat-mdc-tab-body-active .mat-mdc-tab-body-content');

    // Second try: any tab body content (there might only be one rendered)
    if (!scrollElement) {
      scrollElement = messageThreadsEl.querySelector('.mat-mdc-tab-body-content');
    }

    // If we couldn't find the tab content and haven't retried too many times, try again
    if (!scrollElement && retryCount < 5) {
      this.logger.debug(`Tab content not found, retrying in 200ms (attempt ${retryCount + 1})`);
      setTimeout(() => this.setupChatListScrollListener(retryCount + 1), 200);
      return;
    }

    // Fallback to the message threads element itself
    if (!scrollElement) {
      scrollElement = messageThreadsEl;
    }

    this.logger.info('Setting up scroll listener for chat list auto-load', {
      foundActiveTab: !!messageThreadsEl.querySelector('.mat-mdc-tab-body-active .mat-mdc-tab-body-content'),
      foundAnyTab: !!messageThreadsEl.querySelector('.mat-mdc-tab-body-content'),
      scrollElementClass: scrollElement.className,
      scrollHeight: (scrollElement as HTMLElement).scrollHeight,
      clientHeight: (scrollElement as HTMLElement).clientHeight,
    });

    // Remove listener from previous element if different
    if (this.chatListScrollElement && this.chatListScrollElement !== scrollElement) {
      this.chatListScrollElement.removeEventListener('scroll', this.chatListScrollHandler);
    }

    // Store reference for the handler
    this.chatListScrollElement = scrollElement as HTMLElement;

    // Remove any existing listener to avoid duplicates
    scrollElement.removeEventListener('scroll', this.chatListScrollHandler);

    // Add the scroll event listener
    scrollElement.addEventListener('scroll', this.chatListScrollHandler);
  }

  /**
   * Chat list scroll event handler - loads more chats when scrolling near bottom
   */
  private chatListScrollHandler = () => {
    // Throttle the scroll handler to prevent excessive calls
    if (this.chatListScrollThrottleTimeout) {
      return;
    }

    this.chatListScrollThrottleTimeout = setTimeout(() => {
      this.chatListScrollThrottleTimeout = null;

      const scrollElement = this.chatListScrollElement;
      if (!scrollElement) {
        this.logger.warn('Chat list scroll element not set');
        return;
      }

      // Check if user is near the bottom
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const threshold = 200; // pixels from bottom
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Log scroll state for debugging
      this.logger.info('Chat list scroll check', {
        distanceFromBottom,
        scrollTop,
        scrollHeight,
        clientHeight,
        hasMoreChats: this.messaging.hasMoreChats(),
        isLoadingMoreChats: this.messaging.isLoadingMoreChats(),
        threshold,
      });

      if (
        distanceFromBottom < threshold &&
        this.messaging.hasMoreChats() &&
        !this.messaging.isLoadingMoreChats()
      ) {
        this.logger.info('Loading more chats from scroll...');
        this.loadMoreChats();
      }
    }, 150); // Throttle interval
  };

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
  }

  /**
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

      this.logger.debug(
        `Scroll position: ${scrollTop}, threshold: ${threshold}, hasMore: ${this.hasMoreMessages()}, isLoading: ${this.isLoadingMore()}, messages: ${this.messages().length}`
      );

      if (
        scrollTop <= threshold &&
        this.hasMoreMessages() &&
        !this.isLoadingMore() &&
        this.messages().length > 0
      ) {
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
  }

  ngOnDestroy(): void {

    // Reset mobile nav visibility
    this.layout.hideMobileNav.set(false);

    // Clean up scroll listener
    const scrollElement = this.messagesWrapper?.nativeElement;
    if (scrollElement) {
      scrollElement.removeEventListener('scroll', this.scrollHandler);
    }

    // Clean up chat list scroll listener
    const chatListElement = this.messageThreads?.nativeElement;
    if (chatListElement) {
      chatListElement.removeEventListener('scroll', this.chatListScrollHandler);
    }

    // Clean up throttle timeout
    if (this.scrollThrottleTimeout) {
      clearTimeout(this.scrollThrottleTimeout);
      this.scrollThrottleTimeout = null;
    }

    if (this.chatListScrollThrottleTimeout) {
      clearTimeout(this.chatListScrollThrottleTimeout);
      this.chatListScrollThrottleTimeout = null;
    }

    // Clean up subscriptions
    if (this.messageSubscription) {
      this.messageSubscription.close();
    }

    if (this.chatSubscription) {
      this.chatSubscription.close();
    }
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
      const oldestTimestamp =
        currentMessages.length > 0
          ? Math.min(...currentMessages.map(m => m.created_at)) - 1
          : undefined;

      this.logger.debug(
        `Current messages count: ${currentMessages.length}, oldest timestamp: ${oldestTimestamp}`
      );

      // Store current scroll position to maintain it after loading new messages
      const scrollElement = this.messagesWrapper?.nativeElement;
      const scrollHeight = scrollElement?.scrollHeight || 0;
      const scrollTop = scrollElement?.scrollTop || 0; // Load older messages from the messaging service
      const olderMessages = await this.messaging.loadMoreMessages(selectedChat.id, oldestTimestamp);

      this.logger.debug(`Loaded ${olderMessages.length} older messages`);

      // If no messages were loaded, there are no more messages to load
      if (olderMessages.length === 0) {
        this.hasMoreMessages.set(false);
        this.logger.debug('No more messages to load, setting hasMoreMessages to false');
      }

      // Messages are automatically updated via the computed signal
      // Just need to restore scroll position after DOM update
      setTimeout(() => {
        if (scrollElement) {
          const newScrollHeight = scrollElement.scrollHeight;
          const heightDiff = newScrollHeight - scrollHeight;
          scrollElement.scrollTop = scrollTop + heightDiff;
          this.logger.debug(
            `Restored scroll position: ${scrollElement.scrollTop} (diff: ${heightDiff})`
          );
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
  async selectChat(chat: Chat): Promise<void> {
    this.logger.debug('selectChat called with chat:', chat.id, 'pubkey:', chat.pubkey);
    this.logger.debug('Before set - selectedChatId:', this.selectedChatId());
    this.selectedChatId.set(chat.id);
    this.logger.debug('After set - selectedChatId:', this.selectedChatId());
    this.logger.debug('selectedChat computed:', this.selectedChat());

    // Reset hasMoreMessages for the new chat
    this.hasMoreMessages.set(true);

    // Hide the chat list in single-pane view (mobile or when right panel is open)
    if (this.isSinglePaneView()) {
      this.showMobileList.set(false);
      this.layout.hideMobileNav.set(true);
    }

    // Mark chat as read when selected
    await this.markChatAsRead(chat.id);

    // Preload DM relays (kind 10050) for this contact so sending is instant.
    // Loads from database first, refreshes from network in the background.
    this.userRelayService.ensureDmRelaysForPubkey(chat.pubkey).catch(err => {
      this.logger.warn('Failed to preload DM relays for chat:', err);
    });

    // Navigate to the chat, clearing any query params
    this.logger.debug('Navigating to /messages/' + chat.id);
    this.router.navigate(['/messages', chat.id], {
      queryParams: {},
    });
  }

  /**
   * Mark a chat as read
   */
  async markChatAsRead(chatId: string): Promise<void> {
    // Call the messaging service to mark the chat as read
    // Messages are automatically updated via the computed signal
    await this.messaging.markChatAsRead(chatId);
  }

  /**
   * Start voice input for message dictation
   */
  async startVoiceInput(): Promise<void> {
    // Check if AI transcription is enabled first
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) {
      this.snackBar.open('AI transcription is disabled in settings', 'Open Settings', { duration: 5000 })
        .onAction().subscribe(() => {
          this.router.navigate(['/ai/settings']);
        });
      return;
    }

    this.isVoiceListening.set(true);

    await this.speechService.startRecording({
      silenceDuration: 2000,
      onRecordingStateChange: (isRecording) => {
        this.isVoiceListening.set(isRecording);
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isVoiceTranscribing.set(isTranscribing);
      },
      onTranscription: (text) => {
        // Append transcribed text to existing message
        const currentText = this.newMessageText();
        const separator = currentText && !currentText.endsWith(' ') ? ' ' : '';
        this.newMessageText.set(currentText + separator + text);

        // Focus the input
        this.messageInput?.nativeElement?.focus();
      }
    });
  }

  /**
   * Stop voice recording
   */
  stopVoiceRecording(): void {
    this.speechService.stopRecording();
  }

  /**
   * Open file dialog for uploading media
   */
  openFileDialog(): void {
    if (!this.mediaFileInput?.nativeElement) {
      return;
    }

    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.mediaFileInput.nativeElement.click();
  }

  /**
   * Open media library chooser dialog
   */
  async openMediaChooser(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const { MediaChooserDialogComponent } = await import('../../components/media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../../components/media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.customDialog.open<typeof MediaChooserDialogComponent.prototype, MediaChooserResult>(MediaChooserDialogComponent, {
      title: 'Choose from Library',
      width: '700px',
      maxWidth: '95vw',
      data: {
        multiple: true,
        mediaType: 'all',
      },
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.items?.length) {
        for (const item of result.items) {
          this.insertMediaUrl(item.url, item.type);
        }
      }
    });
  }

  /**
   * Handle file selection from the file input
   */
  onMediaFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadMediaFile(input.files[0]);
    }
    input.value = '';
  }

  /**
   * Upload a media file and insert the URL into the message
   */
  private async uploadMediaFile(file: File): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.isUploading.set(true);
    this.uploadStatus.set('Uploading...');

    try {
      await this.mediaService.load();

      const result = await this.mediaService.uploadFile(
        file,
        false,
        this.mediaService.mediaServers()
      );

      if (result.status === 'success' && result.item) {
        this.insertMediaUrl(result.item.url, result.item.type);
      } else {
        this.snackBar.open(result.message || 'Upload failed', 'Dismiss', { duration: 5000 });
      }
    } catch (err) {
      this.logger.error('Failed to upload media file', err);
      this.snackBar.open('Failed to upload media', 'Dismiss', { duration: 5000 });
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  /**
   * Insert media URL into the message text and show preview
   */
  private insertMediaUrl(url: string, mimeType: string): void {
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    this.newMessageText.set(currentText + separator + url);

    // Add preview
    if (mimeType.startsWith('image/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'image' }]);
    } else if (mimeType.startsWith('video/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'video' }]);
    }

    this.messageInput?.nativeElement?.focus();
  }

  /**
   * Insert an emoji at the current cursor position in the message input
   */
  insertEmoji(emoji: string): void {
    const textarea = this.messageInput?.nativeElement;
    if (textarea) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      const currentText = this.newMessageText();
      const newText = currentText.substring(0, start) + emoji + currentText.substring(end);
      this.newMessageText.set(newText);

      // Restore cursor position after emoji
      setTimeout(() => {
        const newPos = start + emoji.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    } else {
      this.newMessageText.update(text => text + emoji);
    }
  }

  /**
   * Open emoji picker in a fullscreen dialog on small screens
   */
  async openEmojiPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../../components/emoji-picker/emoji-picker-dialog.component');
    const dialogRef = this.customDialog.open<typeof EmojiPickerDialogComponent.prototype, string>(EmojiPickerDialogComponent, {
      title: 'Emoji',
      width: '400px',
      panelClass: 'emoji-picker-dialog',
    });

    dialogRef.afterClosed$.subscribe(result => {
      if (result.result) {
        this.insertEmoji(result.result);
      }
    });
  }

  /**
   * Remove a specific media preview by index
   */
  removeMediaPreview(index: number): void {
    const preview = this.mediaPreviews()[index];
    if (preview) {
      // Remove the URL from the message text
      const currentText = this.newMessageText();
      const newText = currentText
        .split('\n')
        .filter(line => line.trim() !== preview.url)
        .join('\n');
      this.newMessageText.set(newText);
    }
    this.mediaPreviews.update(previews => previews.filter((_, i) => i !== index));
  }

  private hasConfiguredMediaServers(): boolean {
    return this.mediaService.mediaServers().length > 0;
  }

  private showMediaServerWarning(): void {
    this.snackBar.open('You need to configure a media server before uploading files.', 'Setup', { duration: 5000 })
      .onAction().subscribe(() => {
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      });
  }

  /**
   * Handle keyboard events in the message input
   * Desktop: Enter sends message, Shift+Enter adds newline
   * Mobile: Enter adds newline (must use send button to send)
   */
  onMessageKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      // Check if this is a mobile/touch device
      const isTouchDevice = this.layout.isHandset() || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

      if (isTouchDevice) {
        // On mobile, Enter always creates a newline (let default behavior happen)
        // User must use the send button to send
        return;
      } else {
        // On desktop
        if (event.shiftKey) {
          // Shift+Enter: allow newline (let default behavior happen)
          return;
        } else {
          // Enter without Shift: send the message
          event.preventDefault();
          this.sendMessage();
        }
      }
    }
  }

  /**
   * Send a direct message using both NIP-04 and NIP-44.
   * Uses optimistic UI: the message appears immediately while
   * relay publishing happens in the background.
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

      // Ensure relays are discovered for the receiver
      await this.userRelayService.ensureRelaysForPubkey(receiverPubkey);

      // Scroll to bottom for new outgoing messages
      this.scrollToBottom();

      // Capture the reply context before clearing
      const replyToMessage = this.replyingToMessage();

      // Clear the input and reply context
      this.newMessageText.set('');
      this.replyingToMessage.set(null);
      this.mediaPreviews.set([]);

      // Restore focus to the input field after sending (desktop behavior)
      setTimeout(() => {
        this.messageInput?.nativeElement?.focus();
      }, 0);

      // Determine which encryption to use based on chat and client capabilities
      const selectedChat = this.selectedChat()!;
      const useModernEncryption = this.supportsModernEncryption(selectedChat);

      // Create the message (encrypts + signs, but does NOT publish yet)
      let result: { message: DirectMessage; publish: () => Promise<void> };

      if (useModernEncryption) {
        result = await this.createNip44Message(
          messageText,
          receiverPubkey,
          myPubkey,
          replyToMessage?.id
        );
      } else {
        result = await this.createNip04Message(
          messageText,
          receiverPubkey,
          myPubkey,
          replyToMessage?.id
        );
      }

      const finalMessage = result.message;

      // Create a pending message to show immediately in the UI
      const pendingMessage: DirectMessage = {
        ...finalMessage,
        pending: true,
        received: false,
      };

      // Add to pending messages so the user sees feedback right away
      this.pendingMessages.update(msgs => [...msgs, pendingMessage]);

      // Add the message to the messaging service to update the chat's lastMessage
      const updatedMessage = {
        ...finalMessage,
        pending: false,
        received: true,
      };

      this.messaging.addMessageToChat(receiverPubkey, updatedMessage);

      // Release the send button immediately - message is visible in the UI
      this.isSending.set(false);

      // Publish to relays in the background (fire-and-forget from UI perspective)
      result.publish().catch(err => {
        this.logger.error('Background relay publishing failed', err);
      });
    } catch (err) {
      this.logger.error('Failed to send message', err);

      // Clear any pending messages since the send failed
      this.pendingMessages.set([]);

      this.isSending.set(false);

      this.notifications.addNotification({
        id: Date.now().toString(),
        type: NotificationType.ERROR,
        title: 'Message Failed',
        message: 'Failed to send message. Please try again.',
        timestamp: Date.now(),
        read: false,
      });
    }
  }

  /**
   * Retry sending a failed message
   */
  retryMessage(message: DirectMessage): void {
    // Remove the failed message from pending
    this.pendingMessages.update(msgs => msgs.filter(msg => msg.id !== message.id));

    // Then set its content to the input field so the user can try again
    this.newMessageText.set(message.content);
  }

  /**
   * Set a message to reply to
   */
  setReplyTo(message: DirectMessage): void {
    this.replyingToMessage.set(message);
    // Focus the message input
    setTimeout(() => {
      this.messageInput?.nativeElement.focus();
    }, 100);
  }

  /**
   * Clear the reply context
   */
  clearReply(): void {
    this.replyingToMessage.set(null);
  }

  /**
   * Get a message by ID for displaying reply context
   */
  getMessageById(messageId: string): DirectMessage | undefined {
    const messages = this.messages();
    return messages.find(m => m.id === messageId);
  }

  /**
   * Handle touch start on message bubble (for long press detection)
   */
  onMessageTouchStart(event: TouchEvent, message: DirectMessage): void {
    // Clear any existing timeout
    this.onMessageTouchEnd();

    // Start the long press timer
    this.longPressTimeout = setTimeout(() => {
      // Trigger haptic feedback if available
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }

      this.longPressedMessage.set(message);
      this.showMessageContextMenu(message, event);
    }, this.LONG_PRESS_DURATION);
  }

  /**
   * Handle touch end/move (cancel long press)
   */
  onMessageTouchEnd(): void {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
    // Clear after a short delay to allow menu to show
    setTimeout(() => {
      this.longPressedMessage.set(null);
    }, 300);
  }

  /**
   * Handle right-click context menu on desktop
   */
  onMessageContextMenu(event: MouseEvent, message: DirectMessage): void {
    // Only show custom context menu for messages without failed status
    if (!message.failed) {
      event.preventDefault();
      this.showMessageContextMenu(message, event);
    }
  }

  /**
   * Show the context menu for a message (shared by touch and right-click)
   */
  private showMessageContextMenu(message: DirectMessage, event: TouchEvent | MouseEvent): void {
    // The mat-menu is triggered by the more_vert button, so we need to programmatically
    // trigger it. For simplicity, we'll use the snackbar approach for touch devices
    // and let the mat-menu handle desktop.

    // For touch devices, show a bottom sheet style menu via snackbar with action
    if (event instanceof TouchEvent) {
      const actions = [
        { label: 'Reply', action: () => this.setReplyTo(message) },
        { label: 'Copy', action: () => this.copyMessageContent(message) },
        { label: 'Delete', action: () => this.confirmDeleteMessage(message) },
      ];

      // Show a simple action snackbar (or we could use a custom dialog)
      const snackRef = this.snackBar.open('Message options', 'Delete', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });

      snackRef.onAction().subscribe(() => {
        this.confirmDeleteMessage(message);
      });
    }
  }

  /**
   * Copy message content to clipboard
   */
  async copyMessageContent(message: DirectMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.content);
      this.snackBar.open('Message copied', 'Close', { duration: 2000 });
    } catch (err) {
      this.logger.error('Failed to copy message:', err);
      this.snackBar.open('Failed to copy message', 'Close', { duration: 2000 });
    }
  }

  /**
   * Show confirmation dialog before deleting a message
   */
  async confirmDeleteMessage(message: DirectMessage): Promise<void> {
    // Show confirmation snackbar
    const snackRef = this.snackBar.open(
      'Delete this message? This only removes it from your device.',
      'Delete',
      {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      }
    );

    snackRef.onAction().subscribe(async () => {
      await this.deleteMessage(message);
    });
  }

  /**
   * Delete a message from the current chat
   */
  async deleteMessage(message: DirectMessage): Promise<void> {
    const chatId = this.selectedChatId();
    if (!chatId) {
      this.logger.warn('Cannot delete message: no chat selected');
      return;
    }

    const success = await this.messaging.deleteMessage(chatId, message.id);

    if (success) {
      this.snackBar.open('Message deleted', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to delete message', 'Close', { duration: 3000 });
    }
  }

  /**
   * Hide a received message from the current chat (local only)
   */
  hideMessage(message: DirectMessage): void {
    const chatId = this.selectedChatId();
    if (!chatId) {
      this.logger.warn('Cannot hide message: no chat selected');
      return;
    }

    this.messaging.hideMessage(chatId, message.id);
    this.snackBar.open('Message hidden', 'Close', { duration: 2000 });
  }

  /**
   * Start a new chat with a user
   */
  startNewChat(): void {
    const dialogRef = this.customDialog.open<StartChatDialogComponent, StartChatDialogResult | undefined>(
      StartChatDialogComponent,
      {
        title: 'Start New Chat',
        width: '500px',
        maxWidth: '90vw',
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        this.startChatWithUser((result as StartChatDialogResult).pubkey, (result as StartChatDialogResult).isLegacy);
      }
    });
  }

  /**
   * Forward a message to one or more recipients
   */
  async forwardMessage(message: DirectMessage): Promise<void> {
    const { ForwardMessageDialogComponent } = await import('../../components/forward-message-dialog/forward-message-dialog.component');
    type ForwardResult = import('../../components/forward-message-dialog/forward-message-dialog.component').ForwardMessageDialogResult;

    const dialogRef = this.customDialog.open<typeof ForwardMessageDialogComponent.prototype, ForwardResult | undefined>(
      ForwardMessageDialogComponent,
      {
        title: 'Forward Message',
        width: '500px',
        maxWidth: '90vw',
      }
    );

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result && result.pubkeys?.length) {
        const pubkeys = (result as ForwardResult).pubkeys;
        let successCount = 0;
        let failCount = 0;

        for (const pubkey of pubkeys) {
          try {
            await this.messaging.sendDirectMessage(message.content, pubkey);
            successCount++;
          } catch (err) {
            failCount++;
            this.logger.error('Failed to forward message to', pubkey, err);
          }
        }

        if (failCount === 0) {
          this.snackBar.open(
            `Message forwarded to ${successCount} recipient${successCount > 1 ? 's' : ''}`,
            'OK',
            { duration: 3000 }
          );
        } else {
          this.snackBar.open(
            `Forwarded to ${successCount}, failed for ${failCount} recipient${failCount > 1 ? 's' : ''}`,
            'OK',
            { duration: 5000 }
          );
        }
      }
    });
  }

  /**
   * Reset messages cache - clears all decrypted messages from IndexedDB
   */
  async resetLocalMessagesCache(): Promise<void> {
    try {
      // Clear any pending bunker operations first
      this.encryption.clearBunkerQueue();

      await this.database.init();
      await this.database.clearAllMessages();

      // Clear the in-memory chats
      this.messaging.clear();

      // Reset the messages last check timestamp so we fetch all messages again
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setMessagesLastCheck(pubkey, 0);
      }

      // Clear selection
      this.selectedChatId.set(null);
      this.showMobileList.set(true);

      this.snackBar.open('Messages cache cleared. Reloading...', 'Close', { duration: 3000 });

      // Reload chats from relays
      await this.messaging.loadChats();
    } catch (error) {
      this.logger.error('Failed to reset messages cache:', error);
      this.snackBar.open('Failed to clear messages cache', 'Close', { duration: 3000 });
    }
  }

  /**
   * Mark all chats as read
   */
  async markAllChatsAsRead(): Promise<void> {
    try {
      await this.messaging.markAllChatsAsRead();
      this.snackBar.open('All messages marked as read', 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Failed to mark all chats as read:', error);
      this.snackBar.open('Failed to mark messages as read', 'Close', { duration: 3000 });
    }
  }

  /**
   * Start a new chat with a specific pubkey (public method for external navigation)
   */
  startChatWithPubkey(pubkey: string): void {
    // Use modern encryption (NIP-44) by default
    this.startChatWithUser(pubkey, false);
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
    this.layout.hideMobileNav.set(false);
  }

  /**
   * Toggle chat details sidepanel
   */
  toggleChatDetails(): void {
    this.showChatDetails.update(v => !v);
  }

  /**
   * Close chat details sidepanel
   */
  closeChatDetails(): void {
    this.showChatDetails.set(false);
  }

  /**
   * Hide a chat (persist to local state so it stays hidden across sessions)
   */
  async hideChat(): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Add to hidden chats in local state
    this.accountLocalState.hideChat(pubkey, chat.id);

    // Clear selection and go back to list
    this.selectedChatId.set(null);
    this.showMobileList.set(true);
    this.showChatDetails.set(false);

    this.snackBar.open('Chat hidden', 'Close', { duration: 3000 });
  }

  /**
   * Unhide a chat (remove from hidden list)
   */
  async unhideChat(): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    // Remove from hidden chats in local state
    this.accountLocalState.unhideChat(pubkey, chat.id);

    this.snackBar.open('Chat unhidden', 'Close', { duration: 3000 });
  }

  /**
   * Check if the currently selected chat is hidden
   */
  isSelectedChatHidden(): boolean {
    const chat = this.selectedChat();
    if (!chat) return false;
    return this.isChatHidden(chat.id);
  }

  /**
   * Toggle show hidden chats
   */
  toggleShowHiddenChats(): void {
    this.showHiddenChats.update(v => !v);
  }

  /**
   * Get display URL (truncated for UI)
   */
  getDisplayUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname.slice(0, 20) : '');
    } catch {
      return url.slice(0, 30);
    }
  }

  /**
   * Open URL in new tab
   */
  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Handle tab change between Following and Others
   */
  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    // Re-attach scroll listener since each tab has its own scroll container
    setTimeout(() => this.setupChatListScrollListener(), 50);
  }

  /**
   * View profile of the selected chat
   */
  viewProfile(): void {
    const pubkey = this.selectedChat()?.pubkey;
    if (pubkey) {
      this.layout.openProfile(pubkey);
    }
  }

  /**
   * Check if a chat supports modern encryption (NIP-44)
   * For merged chats, we always use modern encryption for new messages
   */
  private supportsModernEncryption(chat: Chat): boolean {
    // For merged chats, always prefer modern encryption for new messages
    // The chat may contain legacy messages, but new messages will use NIP-44
    return true;
  }

  /**
   * Check if we should show encryption warning for a chat
   */
  shouldShowEncryptionWarning(chat: Chat): boolean {
    // Show warning if chat contains any legacy NIP-04 messages
    return chat.hasLegacyMessages === true;
  }

  /**
   * Get encryption status message for a chat
   */
  getEncryptionStatusMessage(chat: Chat): string {
    if (chat.hasLegacyMessages === true) {
      return 'This chat contains some messages using legacy encryption (NIP-04). New messages will use modern encryption (NIP-17).';
    }
    return 'This chat uses modern encryption (NIP-17) for enhanced security.';
  }

  /**
   * Create a NIP-04 encrypted message (legacy).
   * Returns the message for UI display and a publish function for background relay delivery.
   */
  private async createNip04Message(
    messageText: string,
    receiverPubkey: string,
    myPubkey: string,
    replyToId?: string
  ): Promise<{ message: DirectMessage; publish: () => Promise<void> }> {
    try {
      // Encrypt the message using NIP-04
      const encryptedContent = await this.encryption.encryptNip04(messageText, receiverPubkey);

      // Build tags
      const tags: string[][] = [['p', receiverPubkey]];

      // Add 'e' tag if this is a reply (NIP-17 - also supported in NIP-04 for compatibility)
      if (replyToId) {
        tags.push(['e', replyToId]);
      }

      // Create the event
      const event = {
        kind: kinds.EncryptedDirectMessage,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: encryptedContent,
      };

      // Sign and finalize the event
      const signedEvent = await this.nostr.signEvent(event);

      // Return the message for immediate UI display and a publish function for background delivery
      const message: DirectMessage = {
        id: signedEvent.id,
        pubkey: myPubkey,
        created_at: signedEvent.created_at,
        content: messageText, // Store decrypted content locally
        isOutgoing: true,
        tags: signedEvent.tags,
        encryptionType: 'nip04',
      };

      const publish = () => this.publishToRelays(signedEvent, receiverPubkey);

      return { message, publish };
    } catch (error) {
      this.logger.error('Failed to create NIP-04 message', error);
      throw error;
    }
  }

  /**
   * Create a NIP-44 encrypted message (modern).
   * Returns the message for UI display and a publish function for background relay delivery.
   */
  private async createNip44Message(
    messageText: string,
    receiverPubkey: string,
    myPubkey: string,
    replyToId?: string
  ): Promise<{ message: DirectMessage; publish: () => Promise<void> }> {
    try {
      const isNoteToSelf = receiverPubkey === myPubkey;

      // Step 1: Create the message (unsigned event) - kind 14
      const tags: string[][] = [['p', receiverPubkey]];

      // Add 'e' tag if this is a reply (NIP-17)
      if (replyToId) {
        tags.push(['e', replyToId]);
      }

      const unsignedMessage = {
        kind: kinds.PrivateDirectMessage,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: messageText,
      };

      // Calculate the message ID (but don't sign it)
      const rumorId = getEventHash(unsignedMessage);
      const rumorWithId = { ...unsignedMessage, id: rumorId };
      const eventText = JSON.stringify(rumorWithId);

      // Step 2: Create the seal (kind 13) - encrypt the rumor
      const sealedContent = await this.encryption.encryptNip44(eventText, receiverPubkey);

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

      // Prepare the second gift wrap for self (for regular messages, not note-to-self)
      let signedGiftWrap2: NostrEvent | null = null;
      if (!isNoteToSelf) {
        const sealedContent2 = await this.encryption.encryptNip44(eventText, myPubkey);

        const sealedMessage2 = {
          kind: kinds.Seal,
          pubkey: myPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [],
          content: sealedContent2,
        };

        const signedSealedMessage2 = await this.nostr.signEvent(sealedMessage2);

        const giftWrapContent2 = await this.encryption.encryptNip44WithKey(
          JSON.stringify(signedSealedMessage2),
          bytesToHex(ephemeralKey),
          myPubkey
        );

        const giftWrap2 = {
          kind: kinds.GiftWrap,
          pubkey: ephemeralPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [['p', myPubkey]],
          content: giftWrapContent2,
        };

        signedGiftWrap2 = finalizeEvent(giftWrap2, ephemeralKey);
      }

      // Return the message for immediate UI display
      const message: DirectMessage = {
        id: rumorId,
        pubkey: myPubkey,
        created_at: unsignedMessage.created_at,
        content: messageText,
        isOutgoing: true,
        tags: unsignedMessage.tags,
        encryptionType: 'nip44',
      };

      // Return a publish function that handles all relay publishing in the background
      const publish = async () => {
        if (isNoteToSelf) {
          // Note to Self: Only one gift wrap needed
          await Promise.allSettled([
            this.publishToUserDmRelays(signedGiftWrap, myPubkey),
            this.publishToAccountRelays(signedGiftWrap),
          ]);
        } else {
          // Regular message: publish both gift wraps
          await Promise.allSettled([
            this.publishToUserDmRelays(signedGiftWrap, receiverPubkey),
            this.publishToAccountRelays(signedGiftWrap),
            this.publishToDiscoveryRelays(signedGiftWrap),
            this.publishToUserDmRelays(signedGiftWrap2!, myPubkey),
            this.publishToAccountRelays(signedGiftWrap2!),
          ]);
        }
      };

      return { message, publish };
    } catch (error) {
      this.logger.error('Failed to create NIP-44 message', error);
      throw error;
    }
  }

  /**
   * Publish an event to multiple relays
   */
  private async publishToRelays(event: NostrEvent, pubkey: string): Promise<void> {
    const promisesUser = this.userRelayService.publish(pubkey, event);
    const promisesAccount = this.accountRelay.publish(event);

    // Wait for all publish attempts to complete
    await Promise.allSettled([promisesUser, promisesAccount]);
  }

  /**
   * Publish a gift-wrapped DM to the recipient's DM relays (NIP-17)
   * Uses kind 10050 relays if available, falls back to regular relays
   */
  private async publishToUserDmRelays(event: NostrEvent, pubkey: string): Promise<void> {
    const promisesUser = this.userRelayService.publishToDmRelays(pubkey, event);

    // Wait for all publish attempts to complete
    await Promise.allSettled([promisesUser]);
  }

  private async publishToUserRelays(event: NostrEvent, pubkey: string): Promise<void> {
    const promisesUser = this.userRelayService.publish(pubkey, event);

    // Wait for all publish attempts to complete
    await Promise.allSettled([promisesUser]);
  }

  private async publishToAccountRelays(event: NostrEvent): Promise<void> {
    const promisesAccount = this.accountRelay.publish(event);

    // Wait for all publish attempts to complete
    await Promise.allSettled([promisesAccount]);
  }

  /**
   * Publish to discovery relays as a fallback
   * Discovery relays are popular relays that both sender and recipient might use
   */
  private async publishToDiscoveryRelays(event: NostrEvent): Promise<void> {
    const discoveryRelayUrls = this.discoveryRelay.getRelayUrls();
    if (discoveryRelayUrls.length === 0) {
      this.logger.debug('No discovery relays available for publishing');
      return;
    }

    this.logger.debug('[MessagesComponent] Publishing to discovery relays:', discoveryRelayUrls);

    // Use the SimplePool to publish directly to discovery relays
    const pool = this.discoveryRelay.getPool();
    if (pool) {
      const publishResults = pool.publish(discoveryRelayUrls, event);
      await Promise.allSettled(publishResults);
    }
  }

  /**
   * Start a chat with a specific user
   * Note: isLegacy parameter is kept for backward compatibility but ignored
   * since all chats are now merged by pubkey
   */
  private async startChatWithUser(pubkey: string, isLegacy: boolean): Promise<void> {
    try {
      const myPubkey = this.accountState.pubkey();
      const isNoteToSelf = pubkey === myPubkey;

      // Use pubkey directly as chatId - chats are now merged regardless of encryption type
      const chatId = pubkey;
      this.logger.debug('startChatWithUser - chatId:', chatId);

      // Check if chat already exists
      let existingChat = this.messaging.getChat(chatId);

      // Also check for legacy chatIds (for backward compatibility with old stored chats)
      if (!existingChat) {
        existingChat = this.messaging.getChat(`${pubkey}-nip44`) || this.messaging.getChat(`${pubkey}-nip04`);
        if (existingChat) {
          this.logger.debug('Found existing chat with legacy chatId format');
        }
      }

      if (existingChat) {
        this.logger.debug('Chat already exists, selecting it');
        // Chat already exists, just select it
        this.selectChat(existingChat);
        return;
      }

      this.logger.debug('Creating new temporary chat');
      // For now, just switch to the chat view and let the user send the first message
      // The chat will be created when the first message is sent

      // Create a temporary chat object for UI purposes
      // New messages always use modern encryption (NIP-44)
      const tempChat: Chat = {
        id: chatId,
        pubkey: pubkey,
        unreadCount: 0,
        lastMessage: null,
        relays: [], // TODO: Use discovered relays from dialog
        encryptionType: 'nip44',
        hasLegacyMessages: false,
        messages: new Map(),
      };

      // Add the temporary chat to the messaging service's chatsMap
      this.logger.debug('Adding chat to messaging service');
      this.messaging.addChat(tempChat);

      // Verify it was added
      const verifyChat = this.messaging.getChat(chatId);
      this.logger.debug('Chat verification after add:', verifyChat ? 'Found' : 'Not found');

      // Select the chat (this will show the chat interface)
      this.logger.debug('Calling selectChat');
      this.selectChat(tempChat);
    } catch (error) {
      this.logger.error('Error starting chat:', error);
      this.snackBar.open('Failed to start chat', 'Close', { duration: 3000 });
    }
  }

  /**
   * Start or open the "Note to Self" chat
   */
  async startNoteToSelf(): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.snackBar.open('Please log in first', 'Close', { duration: 3000 });
      return;
    }
    await this.startChatWithUser(myPubkey, false);
  }

  /**
   * Revoke encryption permission
   */
  revokeEncryptionPermission(): void {
    this.encryptionPermission.revokePermission();
    this.snackBar.open('Extension permission revoked', 'Close', { duration: 3000 });

    // Clear messages since we can no longer decrypt them
    this.messaging.clear();
  }

  /**
   * Get a unique key for a date (timestamp at midnight)
   */
  private getDateKey(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /**
   * Get a human-readable label for a date
   */
  getDateLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateKey = this.getDateKey(date);
    const todayKey = this.getDateKey(today);
    const yesterdayKey = this.getDateKey(yesterday);

    if (dateKey === todayKey) {
      return $localize`:@@messages.date.today:Today`;
    }

    if (dateKey === yesterdayKey) {
      return $localize`:@@messages.date.yesterday:Yesterday`;
    }

    // For dates within the last week, show day name
    const daysDiff = Math.floor((todayKey - dateKey) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7) {
      const dayNames = [
        $localize`:@@messages.date.sunday:Sunday`,
        $localize`:@@messages.date.monday:Monday`,
        $localize`:@@messages.date.tuesday:Tuesday`,
        $localize`:@@messages.date.wednesday:Wednesday`,
        $localize`:@@messages.date.thursday:Thursday`,
        $localize`:@@messages.date.friday:Friday`,
        $localize`:@@messages.date.saturday:Saturday`
      ];
      return dayNames[date.getDay()];
    }

    // For older dates, show formatted date like "Jan 3., Sat"
    const shortMonths = [
      $localize`:@@messages.date.jan:Jan`,
      $localize`:@@messages.date.feb:Feb`,
      $localize`:@@messages.date.mar:Mar`,
      $localize`:@@messages.date.apr:Apr`,
      $localize`:@@messages.date.may:May`,
      $localize`:@@messages.date.jun:Jun`,
      $localize`:@@messages.date.jul:Jul`,
      $localize`:@@messages.date.aug:Aug`,
      $localize`:@@messages.date.sep:Sep`,
      $localize`:@@messages.date.oct:Oct`,
      $localize`:@@messages.date.nov:Nov`,
      $localize`:@@messages.date.dec:Dec`
    ];
    const shortDays = [
      $localize`:@@messages.date.sun:Sun`,
      $localize`:@@messages.date.mon:Mon`,
      $localize`:@@messages.date.tue:Tue`,
      $localize`:@@messages.date.wed:Wed`,
      $localize`:@@messages.date.thu:Thu`,
      $localize`:@@messages.date.fri:Fri`,
      $localize`:@@messages.date.sat:Sat`
    ];

    const month = shortMonths[date.getMonth()];
    const day = date.getDate();
    const dayName = shortDays[date.getDay()];

    return `${month} ${day}., ${dayName}`;
  }

  /**
   * Format time for a message based on user's time format preference
   */
  formatMessageTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (this.localSettings.timeFormat() === '24h') {
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    } else {
      const hour12 = hours % 12 || 12;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      return `${hour12}:${minutes} ${ampm}`;
    }
  }
}