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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { NotificationType } from '../../services/database.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { NPubPipe } from '../../pipes/npub.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { AgoPipe } from '../../pipes/ago.pipe';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
import {
  StartChatDialogComponent,
  StartChatDialogResult,
} from '../../components/start-chat-dialog/start-chat-dialog.component';
import { RenameChatDialogComponent } from '../../components/rename-chat-dialog/rename-chat-dialog.component';
import {
  kinds,
  getPublicKey,
  generateSecretKey,
  finalizeEvent,
  Event as NostrEvent,
  getEventHash,
  nip19,
} from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ApplicationService } from '../../services/application.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { EncryptionService } from '../../services/encryption.service';
import { EncryptionPermissionService } from '../../services/encryption-permission.service';
import { DataService } from '../../services/data.service';
import { MessagingService, computeGroupChatId } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { NamePipe } from '../../pipes/name.pipe';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UserRelayService } from '../../services/relays/user-relay';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { DatabaseService } from '../../services/database.service';
import { AccountLocalStateService, type RecentEmoji } from '../../services/account-local-state.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { SettingsService } from '../../services/settings.service';
import { MediaService } from '../../services/media.service';
import { TrustService } from '../../services/trust.service';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EmojiPickerComponent } from '../../components/emoji-picker/emoji-picker.component';
import { CustomEmojiComponent } from '../../components/custom-emoji/custom-emoji.component';
import { OpenGraphService, OpenGraphData } from '../../services/opengraph.service';
import { isImageUrl } from '../../services/format/utils';
import { HiddenChatInfoPromptComponent } from '../../components/hidden-chat-info-prompt/hidden-chat-info-prompt.component';
import { HapticsService } from '../../services/haptics.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { MediaProcessingService, type CompressionPreviewResult, type PreparedUploadFile } from '../../services/media-processing.service';
import {
  DEFAULT_DM_MEDIA_UPLOAD_SETTINGS,
  getMediaOptimizationDescription,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  getVideoOptimizationProfileBadgeLabel,
  VIDEO_OPTIMIZATION_PROFILE_OPTIONS,
  MEDIA_OPTIMIZATION_OPTIONS,
  VideoRecordDialogResult,
  usesLocalCompression as usesLocalCompressionMode,
  type MediaOptimizationOptionValue,
  type MediaUploadMode,
  type MediaUploadSettings,
  type VideoOptimizationProfile,
} from '../../interfaces/media-upload';
import type { ReportTarget } from '../../services/reporting.service';
import type { ReportDialogResult } from '../../components/report-dialog/report-dialog.component';
import type { MessageDetailsDialogData } from '../../components/message-details-dialog/message-details-dialog.component';
import type { ManageInboxDialogResult } from '../../components/manage-inbox-dialog/manage-inbox-dialog.component';

const LAST_ACTIVE_EVENT_KINDS = [
  0,
  1,
  3,
  4,
  5,
  6,
  7,
  16,
  20,
  21,
  22,
  1111,
  1984,
  30023,
  30078,
  30315,
  34235,
  34236,
];

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
  isGroup?: boolean;
  participants?: string[];
  subject?: string;
  subjectUpdatedAt?: number;
}

interface DirectMessage {
  id: string;
  rumorKind?: number;
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
  quotedReplyContent?: string;
  quotedReplyAuthor?: string;
  giftWrapId?: string;
  failureReason?: string; // Human-readable reason for send failure
  eventKind?: 'message' | 'reaction';
  reactionTo?: string;
  reactionContent?: string;
}

interface MessageReactionSummary {
  content: string;
  count: number;
  userReacted: boolean;
  customEmojiUrl?: string;
  emojiSetAddress?: string;
}

interface MessageGroup {
  dateLabel: string;
  dateTimestamp: number;
  messages: DirectMessage[];
}

interface PendingEncryptedMediaPreview {
  id: string;
  objectUrl: string;
  file: File;
  sourceFile?: File;
  type: 'image' | 'video' | 'file';
  wasProcessed?: boolean;
  videoOptimizationProfile?: VideoOptimizationProfile;
  originalSize?: number;
  processedSize?: number;
  optimizedSize?: number;
  warningMessage?: string;
}

interface ComposerMediaPreview {
  url: string;
  type: 'image' | 'video' | 'music' | 'file';
  label?: string;
  meta?: string;
  pendingEncrypted?: boolean;
  pendingId?: string;
  videoOptimizationProfile?: VideoOptimizationProfile;
  originalSize?: number;
  processedSize?: number;
  optimizedSize?: number;
  warningMessage?: string;
}

interface PendingDmMediaOptimizationRequest {
  settings: MediaUploadSettings;
  previewIds?: string[];
}

interface QuickReactionMenuItem {
  content: string;
  customEmojiUrl?: string;
}

@Component({
  selector: 'app-messages',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
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
    MatSliderModule,
    MatSlideToggleModule,
    MatProgressBarModule,
    RouterModule,
    LoadingOverlayComponent,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    TimestampPipe,
    AgoPipe,
    MessageContentComponent,
    NamePipe,
    EmojiPickerComponent,
    CustomEmojiComponent,
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
  private userRelayService: UserRelayService = inject(UserRelayService);
  private customDialog = inject(CustomDialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private appState = inject(ApplicationStateService);
  private snackBar = inject(MatSnackBar);
  private bottomSheet = inject(MatBottomSheet);
  private readonly app = inject(ApplicationService);
  readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);
  readonly encryption = inject(EncryptionService);
  private readonly encryptionPermission = inject(EncryptionPermissionService);
  layout = inject(LayoutService); // UI state signals
  private readonly database = inject(DatabaseService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  readonly localSettings = inject(LocalSettingsService);
  readonly settingsService = inject(SettingsService);
  readonly mediaService = inject(MediaService);
  private readonly mediaProcessing = inject(MediaProcessingService);
  private readonly haptics = inject(HapticsService);
  private readonly openGraph = inject(OpenGraphService);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly dialog = inject(MatDialog);

  // Link preview data - keyed by URL
  linkPreviews = signal<Map<string, OpenGraphData>>(new Map());
  private linkPreviewsLoaded = new Set<string>();

  // Cache of resolved custom emoji URLs (shortcode with colons -> URL)
  private resolvedEmojiUrls = signal<Map<string, string>>(new Map());
  private emojiResolutionPending = new Set<string>();
  private readonly fallbackQuickReactions = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
  private readonly recentReactionEmojis = signal<RecentEmoji[]>([]);
  readonly quickReactionMenuItems = computed<QuickReactionMenuItem[]>(() => {
    const recent = this.recentReactionEmojis();
    if (recent.length > 0) {
      return recent.slice(0, 6).map(recentEmoji => ({
        content: recentEmoji.emoji,
        customEmojiUrl: recentEmoji.url,
      }));
    }

    return this.fallbackQuickReactions.map(content => ({ content }));
  });

  @ViewChild('chatSearchInput') chatSearchInput?: ElementRef<HTMLInputElement>;

  isLoading = signal<boolean>(false);
  /** True while navigating to a chat via pubkey query param, before the chat renders */
  isOpeningChat = signal<boolean>(false);
  isLoadingMore = signal<boolean>(false);
  isSending = signal<boolean>(false);
  isUploading = signal<boolean>(false);
  isDragOverMessageInput = signal<boolean>(false);
  uploadStatus = signal<string>('');
  readonly optimizationOptions = MEDIA_OPTIMIZATION_OPTIONS;
  readonly videoOptimizationProfileOptions = VIDEO_OPTIMIZATION_PROFILE_OPTIONS;
  dmMediaUploadMode = signal<MediaUploadMode>(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.mode);
  dmCompressionStrength = signal<number>(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  dmVideoOptimizationProfile = signal<VideoOptimizationProfile>(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.videoOptimizationProfile ?? 'default');
  mediaPreviews = signal<ComposerMediaPreview[]>([]);
  pendingEncryptedMediaPreviews = signal<PendingEncryptedMediaPreview[]>([]);
  readonly hasPendingCompressibleMedia = computed(() =>
    this.pendingEncryptedMediaPreviews().some(preview => preview.type === 'image' || preview.type === 'video')
  );
  readonly hasPendingVideoMedia = computed(() =>
    this.pendingEncryptedMediaPreviews().some(preview => preview.type === 'video')
  );
  readonly selectedDmOptimization = computed(() =>
    getMediaOptimizationOption(this.dmMediaUploadMode(), this.dmCompressionStrength())
  );
  readonly usesLocalDmCompression = computed(() => usesLocalCompressionMode(this.dmMediaUploadMode()));
  dmVideoProfileMenuPreviewId = signal<string | null>(null);
  readonly dmOptimizationDescription = computed(() =>
    getMediaOptimizationDescription(this.dmMediaUploadMode(), this.dmCompressionStrength(), this.dmVideoOptimizationProfile())
  );

  /** Pending extra tags (e.g. imeta with waveform) for the next message */
  pendingTags = signal<string[][]>([]);
  error = signal<string | null>(null);
  showMobileList = signal<boolean>(true);
  selectedTabIndex = signal<number>(0); // 0 = Following, 1 = Others
  chatSearchQuery = signal<string>(''); // Search query for filtering chats
  showChatDetails = signal<boolean>(false); // Chat details sidepanel
  showHiddenChats = signal<boolean>(false); // Toggle to show hidden chats
  showSearch = signal<boolean>(false); // Toggle search input visibility
  othersMinTrustRank = signal<number>(-1); // Web of Trust rank filter for Others tab (-1 = no filter)

  // Long-press support for touch devices
  longPressedMessage = signal<DirectMessage | null>(null);
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly LONG_PRESS_DURATION = 500; // 500ms for long press
  private pendingDmMediaOptimizationRunId = 0;
  private pendingDmMediaOptimizationRequest: PendingDmMediaOptimizationRequest | null = null;
  private pendingDmMediaOptimizationPromise: Promise<void> | null = null;
  private pendingDmVideoProfileMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeDmVideoProfileMenuTrigger: MatMenuTrigger | null = null;
  private readonly DM_VIDEO_PROFILE_MENU_HOLD_DELAY = 450;
  readonly showScrollToLatestButton = signal<boolean>(false);
  private readonly MESSAGE_RENDER_BATCH_SIZE = 20;

  // Computed signal for single-pane view - collapse chat list when mobile or when right panel is open
  // This enables the same behavior as mobile (toggle between list and thread) when viewing
  // a profile or event from the messages, as the left panel shrinks to 700px
  isSinglePaneView = computed(() => this.layout.isHandset() || this.layout.hasNavigationItems());
  private accountRelay = inject(AccountRelayService);
  private relayPool = inject(RelayPoolService);
  private trustService = inject(TrustService);

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

  selectedChatRelayLastActiveAt = signal<number | null>(null);
  selectedChatMessageLastActiveAt = computed(() => {
    const chat = this.selectedChat();
    if (!chat || chat.isGroup) {
      return null;
    }

    const latestIncomingMessage = this.messages()
      .filter(message => !message.isOutgoing)
      .reduce<number | null>((latest, message) => {
        if (latest === null || message.created_at > latest) {
          return message.created_at;
        }

        return latest;
      }, null);

    return latestIncomingMessage;
  });
  selectedChatLastActiveAt = computed(() => {
    const relayTimestamp = this.selectedChatRelayLastActiveAt();
    const messageTimestamp = this.selectedChatMessageLastActiveAt();

    if (relayTimestamp === null) {
      return messageTimestamp;
    }

    if (messageTimestamp === null) {
      return relayTimestamp;
    }

    return Math.max(relayTimestamp, messageTimestamp);
  });
  selectedChatLastActiveLabel = computed(() => {
    const timestamp = this.selectedChatLastActiveAt();
    return timestamp ? `Active ${this.utilities.getRelativeTime(timestamp)}` : '';
  });

  // activePubkey = computed(() => this.selectedChat()?.pubkey || '');
  // Track pending/local messages that haven't been persisted yet
  private pendingMessages = signal<DirectMessage[]>([]);

  // Computed signal for messages - merges persisted messages with pending ones
  messages = computed(() => {
    const chatId = this.selectedChatId();
    if (!chatId) return [];

    const chat = this.selectedChat();
    if (!chat) return [];

    const persistedMessages = this.messaging.getChatMessages(chatId);

    // Get the IDs of all persisted messages
    const persistedIds = new Set(persistedMessages.map(m => m.id));

    // Only include pending messages that aren't already in persisted messages
    const pending = this.pendingMessages().filter(m => {
      // Skip if this message is already persisted
      if (persistedIds.has(m.id)) {
        return false;
      }

      // Check if message is for this chat (based on tags for outgoing messages)
      const pTags = m.tags.filter(tag => tag[0] === 'p');

      if (chat.isGroup && chat.participants) {
        // For group chats, match if the p-tags cover all other participants
        const pTagPubkeys = new Set(pTags.map(tag => tag[1]));
        const myPubkey = this.accountState.pubkey();
        const otherParticipants = chat.participants.filter(p => p !== myPubkey);
        return otherParticipants.length > 0 && otherParticipants.every(p => pTagPubkeys.has(p));
      }

      return pTags.some(tag => tag[1] === chat.pubkey);
    });

    // Merge, filter hidden, and sort by timestamp
    return [...persistedMessages, ...pending]
      .filter(m => !this.messaging.isMessageHidden(chatId, m.id, true))
      .filter(m => !(chat.isGroup && m.content === ''))
      .sort((a, b) => a.created_at - b.created_at);
  });

  renderedThreadMessages = computed(() => {
    const msgs = this.messages().filter(message => !this.isReactionMessage(message));
    const renderedCount = this.renderedMessageCount();

    if (renderedCount >= msgs.length) {
      return msgs;
    }

    return msgs.slice(Math.max(0, msgs.length - renderedCount));
  });

  // Computed signal for messages grouped by date
  groupedRenderedMessages = computed(() => this.groupMessagesByDate(this.renderedThreadMessages()));
  hasHiddenRenderedMessages = computed(() => this.renderedThreadMessages().length < this.messages().filter(message => !this.isReactionMessage(message)).length);
  hasOlderMessagesToLoad = computed(() => this.hasHiddenRenderedMessages() || this.hasMoreMessages());

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
  private renderedMessageCount = signal<number>(this.MESSAGE_RENDER_BATCH_SIZE);
  private lastRenderableMessageCount = 0;
  private lastRenderableMessageChatId: string | null = null;

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

  /** Image-only subset of shared media for thumbnail grid */
  sharedImages = computed(() => {
    const links = this.sharedLinks();
    return links.filter(link => isImageUrl(link.url));
  });

  /** Video-only subset of shared media */
  sharedVideos = computed(() => {
    const links = this.sharedLinks();
    const videoExtensions = /\.(mp4|webm|mov)$/i;
    return links.filter(link => videoExtensions.test(link.url));
  });

  /** Regular links (not media, not files) that need OG previews */
  regularLinks = computed(() => {
    const links = this.sharedLinks();
    const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg)$/i;
    const fileExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|txt|csv|json|xml)$/i;
    return links.filter(link => !mediaExtensions.test(link.url) && !fileExtensions.test(link.url) && !isImageUrl(link.url));
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

    // Check group subject and participant names
    if (chat.isGroup) {
      if (chat.subject?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      if (chat.participants) {
        for (const p of chat.participants) {
          const pProfile = this.data.getCachedProfile(p);
          if (pProfile?.data) {
            const pName = pProfile.data.name?.toLowerCase() || '';
            const pDisplayName = pProfile.data.display_name?.toLowerCase() || '';
            if (pName.includes(lowerQuery) || pDisplayName.includes(lowerQuery)) {
              return true;
            }
          }
        }
      }
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
    if (chat.isGroup) return false;
    const myPubkey = this.accountState.pubkey();
    return chat.pubkey === myPubkey;
  }

  /**
   * Get the display name for a group chat.
   * Uses subject if available, otherwise lists participant names.
   */
  getGroupDisplayName(chat: Chat): string {
    if (chat.subject) {
      return chat.subject;
    }
    const myPubkey = this.accountState.pubkey();
    const others = (chat.participants || []).filter(p => p !== myPubkey);
    if (others.length === 0) return 'Group';
    const names = others.map(p => this.getParticipantName(p));
    if (names.length <= 3) {
      return names.join(', ');
    }
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }

  selectedChatDisplayName(): string {
    const selectedChat = this.selectedChat();
    if (!selectedChat) {
      return '';
    }

    if (selectedChat.isGroup) {
      return this.getGroupDisplayName(selectedChat);
    }

    return this.getParticipantName(selectedChat.pubkey);
  }

  /**
   * Get a short display name for a pubkey (for group chat list and message sender labels).
   */
  getParticipantName(pubkey: string): string {
    const profile = this.data.getCachedProfile(pubkey);
    if (profile?.data) {
      return profile.data.display_name || profile.data.name || pubkey.slice(0, 8) + '...';
    }
    return pubkey.slice(0, 8) + '...';
  }

  /**
   * Get participant pubkeys for a group chat, excluding self.
   */
  getGroupOtherParticipants(chat: Chat): string[] {
    const myPubkey = this.accountState.pubkey();
    return (chat.participants || []).filter(p => p !== myPubkey);
  }

  /**
   * Check if the selected chat is a group chat.
   */
  isGroupChat = computed(() => {
    return !!this.selectedChat()?.isGroup;
  });

  /** Check if a message starts a new sender group (different sender than previous message) */
  isMessageGroupStart(messages: DirectMessage[], index: number): boolean {
    if (index === 0) return true;
    return messages[index].pubkey !== messages[index - 1].pubkey;
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
    const pinnedSet = new Set(this.settingsService.settings().pinnedChatPubkeys ?? []);
    return this.messaging.sortedChats()
      .filter(item => item.chat.pubkey !== myPubkey || item.chat.isGroup) // Exclude Note to Self (but include groups)
      .filter(item => {
        if (item.chat.isGroup && item.chat.participants) {
          // Group chat: include if any participant is followed
          return item.chat.participants.some(p => p !== myPubkey && followingSet.has(p));
        }
        return followingSet.has(item.chat.pubkey);
      })
      .filter(item => this.chatMatchesSearch(item.chat, query))
      .filter(item => showHidden || !this.isChatHidden(item.chat.id))
      .sort((a, b) => {
        const aPinned = pinnedSet.has(a.chat.id) ? 1 : 0;
        const bPinned = pinnedSet.has(b.chat.id) ? 1 : 0;
        return bPinned - aPinned; // Pinned chats first, then original order (most recent)
      });
  });

  otherChats = computed(() => {
    const followingList = this.accountState.followingList();
    const followingSet = new Set(followingList);
    const myPubkey = this.accountState.pubkey();
    const query = this.chatSearchQuery();
    const showHidden = this.showHiddenChats();
    const minTrustRank = this.othersMinTrustRank();
    const pinnedSet = new Set(this.settingsService.settings().pinnedChatPubkeys ?? []);
    return this.messaging.sortedChats()
      .filter(item => item.chat.pubkey !== myPubkey || item.chat.isGroup) // Exclude Note to Self (but include groups)
      .filter(item => {
        if (item.chat.isGroup && item.chat.participants) {
          // Group chat: include in Others if NO participant is followed
          return !item.chat.participants.some(p => p !== myPubkey && followingSet.has(p));
        }
        return !followingSet.has(item.chat.pubkey);
      })
      .filter(item => {
        // Group chats bypass WoT rank filtering
        if (item.chat.isGroup) return true;

        const chat = item.chat;
        const rank = this.trustService.getRankSignal(item.chat.pubkey);

        // -1 means no rank filter (show everything in Others).
        if (minTrustRank < 0) {
          return true;
        }

        // Slider value 0 means: include chats with known positive WoT rank,
        // and chats the user has already replied to (treated as trusted).
        if (minTrustRank === 0) {
          const hasOutgoingReply = Array.from(chat.messages.values()).some(message => message.isOutgoing === true);
          return hasOutgoingReply || (typeof rank === 'number' && rank > 0);
        }

        // Slider 1+ is strict rank filtering only.
        return typeof rank === 'number' && rank >= minTrustRank;
      })
      .filter(item => this.chatMatchesSearch(item.chat, query))
      .filter(item => showHidden || !this.isChatHidden(item.chat.id))
      .sort((a, b) => {
        const aPinned = pinnedSet.has(a.chat.id) ? 1 : 0;
        const bPinned = pinnedSet.has(b.chat.id) ? 1 : 0;
        return bPinned - aPinned; // Pinned chats first, then original order (most recent)
      });
  });

  getTrustRank(pubkey: string): number {
    return this.trustService.getRankSignal(pubkey) || 0;
  }

  onOthersMinTrustRankChange(value: number): void {
    this.othersMinTrustRank.set(Number(value) || 0);
  }

  getOthersMinTrustRankLabel(): string {
    const value = this.othersMinTrustRank();
    return value < 0 ? '-' : String(value);
  }

  filteredChats = computed(() => {
    const tabIndex = this.selectedTabIndex();
    return tabIndex === 0 ? this.followingChats() : this.otherChats();
  });

  hasFollowingChats = computed(() => this.followingChats().length > 0 || this.noteToSelfChat() !== null);
  hasOtherChats = computed(() => this.otherChats().length > 0);

  private groupMessagesByDate(messages: DirectMessage[]): MessageGroup[] {
    if (messages.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of messages) {
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
  }

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

  @ViewChild('encryptedFileInput', { static: false })
  encryptedFileInput?: ElementRef<HTMLInputElement>;

  // Throttling for scroll handler
  private scrollThrottleTimeout: any = null;
  private chatListScrollThrottleTimeout: any = null;
  private chatListScrollElement: HTMLElement | null = null;

  /** Whether the user has manually scrolled away from the bottom of the chat. */
  private userScrolledUp = false;
  /** Last known scrollHeight — used to detect content growth vs. shrink. */
  private lastScrollHeight = 0;
  /** Bound handler for capturing `load` events on media elements. */
  private mediaLoadHandler: ((e: Event) => void) | null = null;
  /** MutationObserver that watches for new DOM nodes (e.g. Angular rendering new message bubbles). */
  private contentMutationObserver: MutationObserver | null = null;
  private selectedChatActivityTrackedPubkey: string | null = null;
  private selectedChatActivitySubscription: { close: () => void } | null = null;
  private selectedChatActivityRequestToken = 0;
  private shouldStickToBottomOnKeyboardOpen = false;
  private composerViewportResizeHandler: (() => void) | null = null;
  private composerViewportResizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private suppressDraftPersistence = false;
  highlightedMessageId = signal<string | null>(null);
  private pendingScrollToMessageId = signal<string | null>(null);

  constructor() {
    // Initialize lastAccountPubkey with current account to avoid false "account changed" on first load
    this.lastAccountPubkey.set(this.accountState.account()?.pubkey || null);

    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.recentReactionEmojis.set([]);
        return;
      }

      this.recentReactionEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
    });

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
            this.resetRenderedMessageWindow(chatId);

            // Set up scroll listener + ResizeObserver FIRST so it can catch
            // content reflows that happen after the initial scrollToBottom.
            setTimeout(() => {
              this.setupScrollListener();
              this.scrollToBottom();
              // Secondary delayed scroll to catch late-rendering content
              // (Angular template rendering, lazy images, embeds)
              setTimeout(() => this.scrollToBottomIfNotScrolledUp(), 500);
            }, 50);
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

    effect(() => {
      const chatId = this.selectedChatId();
      const totalRenderableCount = this.messages().filter(message => !this.isReactionMessage(message)).length;

      if (!chatId) {
        this.lastRenderableMessageChatId = null;
        this.lastRenderableMessageCount = 0;
        return;
      }

      if (this.lastRenderableMessageChatId !== chatId) {
        this.lastRenderableMessageChatId = chatId;
        this.lastRenderableMessageCount = totalRenderableCount;
        return;
      }

      if (totalRenderableCount > this.lastRenderableMessageCount && this.lastRenderableMessageCount > 0) {
        const newMessageCount = totalRenderableCount - this.lastRenderableMessageCount;
        this.renderedMessageCount.update(count => Math.min(totalRenderableCount, count + newMessageCount));
      } else if (totalRenderableCount < this.lastRenderableMessageCount) {
        this.renderedMessageCount.update(count => Math.min(count, totalRenderableCount));
      }

      this.lastRenderableMessageCount = totalRenderableCount;
    });

    effect(() => {
      const chatId = this.selectedChatId();
      const chat = this.selectedChat();

      if (!chatId || !chat || chat.unreadCount === 0) {
        return;
      }

      untracked(() => {
        void this.messaging.markChatAsRead(chatId);
      });
    });

    effect(() => {
      const chatId = this.selectedChatId();
      const accountPubkey = this.accountState.pubkey();

      untracked(() => {
        if (!chatId || !accountPubkey) {
          this.resetSelectedChatActivityTracking();
          return;
        }

        const chat = this.messaging.getChat(chatId);
        const nextPubkey = chat && !chat.isGroup && chat.pubkey !== accountPubkey ? chat.pubkey : null;

        if (nextPubkey === this.selectedChatActivityTrackedPubkey) {
          return;
        }

        void this.startSelectedChatActivityTracking(nextPubkey);
      });
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
            this.restoreDraftForChat(null);

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
          this.syncMessageInputLayout();
        }, 0);
      });
    });

    effect(() => {
      const chatId = this.selectedChatId();
      const draftText = this.newMessageText();
      const accountPubkey = this.accountState.pubkey();

      if (!chatId || !accountPubkey || this.suppressDraftPersistence) {
        return;
      }

      untracked(() => {
        this.accountLocalState.setChatDraft(accountPubkey, chatId, draftText);
      });
    });

    effect(() => {
      const targetMessageId = this.pendingScrollToMessageId();
      const chat = this.selectedChat();
      const messages = this.messages();

      if (!targetMessageId || !chat || messages.length === 0) {
        return;
      }

      if (!messages.some(message => message.id === targetMessageId)) {
        return;
      }

      untracked(() => {
        this.ensureMessageRendered(targetMessageId);
        this.scrollToTargetMessage(targetMessageId);
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
      const chatId = params['chat'];
      const messageId = params['message'];
      const pubkey = params['pubkey'];
      if (chatId) {
        this.logger.debug('Query param chat detected:', chatId);
        this.pendingScrollToMessageId.set(messageId || null);
        this.isOpeningChat.set(true);
        this.openChatById(chatId);
        this.isOpeningChat.set(false);

        if (!this.messaging.isLoading() && this.messaging.sortedChats().length === 0) {
          this.logger.debug('Loading chats in background after opening chat link...');
          this.messaging.loadChats().catch(error => {
            this.logger.error('Failed to load chats for chat link:', error);
          });
        } else if (!this.messaging.isLoading()) {
          this.logger.debug('Refreshing chats in background after opening chat link...');
          this.messaging.refreshChats().catch(error => {
            this.logger.warn('Failed to refresh chats:', error);
          });
        }
      } else if (pubkey) {
        this.logger.debug('Query param pubkey detected:', pubkey);
        this.pendingScrollToMessageId.set(messageId || null);

        // Show a loading indicator immediately so the user gets visual feedback
        this.isOpeningChat.set(true);

        // Start the chat IMMEDIATELY — don't wait for chat loading to finish.
        // startChatWithPubkey will find an existing chat or create a temp one,
        // so the user sees the chat window right away.
        this.startChatWithPubkey(pubkey);
        this.isOpeningChat.set(false);

        // Load/refresh chats in the background so the chat list populates
        if (!this.messaging.isLoading() && this.messaging.sortedChats().length === 0) {
          this.logger.debug('Loading chats in background after opening DM link...');
          this.messaging.loadChats().catch(error => {
            this.logger.error('Failed to load chats for DM link:', error);
          });
        } else if (!this.messaging.isLoading()) {
          this.logger.debug('Refreshing chats in background after opening DM link...');
          this.messaging.refreshChats().catch(error => {
            this.logger.warn('Failed to refresh chats:', error);
          });
        }
      } else {
        this.pendingScrollToMessageId.set(null);
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
    // Cancel the startup delay if still pending — user wants messages now
    this.messaging.requestImmediateDmStart();

    if (this.messaging.hasLiveSubscription()) {
      this.logger.debug('Live DM subscription already active');
      return;
    }

    const sub = await this.messaging.subscribeToIncomingMessages();
    if (sub) {
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

    this.setupComposerViewportListener();

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

    // Set up auto-scroll watchers for rich content loading
    this.setupMediaLoadListener(scrollElement);
    this.setupContentMutationObserver(scrollElement);
  }

  /**
   * Auto-scroll to bottom when new content causes the scroll height to grow,
   * but only if the user was already near the bottom before the growth.
   *
   * Uses the *previous* scrollHeight (`lastScrollHeight`) to determine the
   * "was near bottom" state so that the height increase itself doesn't
   * falsely mark the user as scrolled up.
   */
  private autoScrollAfterContentGrowth(scrollElement: HTMLElement): void {
    const newScrollHeight = scrollElement.scrollHeight;
    if (newScrollHeight <= this.lastScrollHeight) {
      this.lastScrollHeight = newScrollHeight;
      return;
    }

    const { scrollTop, clientHeight } = scrollElement;
    const wasNearBottom = (this.lastScrollHeight - (scrollTop + clientHeight)) < 150;

    if (wasNearBottom) {
      scrollElement.scrollTop = newScrollHeight;
      this.userScrolledUp = false;
    }

    this.lastScrollHeight = newScrollHeight;
  }

  /**
   * Listen for `load` events on media elements (img, video, iframe) inside
   * the message list. The `load` event does NOT bubble, so we must use
   * capturing (`{ capture: true }`) to intercept it on the scroll container.
   */
  private setupMediaLoadListener(scrollElement: HTMLElement): void {
    // Clean up previous listener
    if (this.mediaLoadHandler) {
      scrollElement.removeEventListener('load', this.mediaLoadHandler, true);
    }

    this.lastScrollHeight = scrollElement.scrollHeight;

    this.mediaLoadHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'IFRAME') {
        this.autoScrollAfterContentGrowth(scrollElement);
      }
    };

    scrollElement.addEventListener('load', this.mediaLoadHandler, true);
  }

  /**
   * Watch for DOM mutations (new child nodes added by Angular rendering)
   * that increase the scroll height. This catches cases where new message
   * bubbles are inserted or Angular components expand after rendering.
   */
  private setupContentMutationObserver(scrollElement: HTMLElement): void {
    this.contentMutationObserver?.disconnect();

    this.contentMutationObserver = new MutationObserver(() => {
      this.autoScrollAfterContentGrowth(scrollElement);
    });

    this.contentMutationObserver.observe(scrollElement, {
      childList: true,
      subtree: true,
    });
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

      const { scrollTop, scrollHeight, clientHeight } = scrollElement;

      // Track whether the user has scrolled away from the bottom.
      // "Near the bottom" = within 150px of the end.
      const distFromBottom = scrollHeight - (scrollTop + clientHeight);
      this.userScrolledUp = distFromBottom > 150;
      this.showScrollToLatestButton.set(distFromBottom > 600);

      // Check if user is near the top and we have messages to load
      const threshold = 100; // pixels from top

        this.logger.debug(
          `Scroll position: ${scrollTop}, threshold: ${threshold}, hasMore: ${this.hasOlderMessagesToLoad()}, isLoading: ${this.isLoadingMore()}, messages: ${this.renderedThreadMessages().length}`
        );

        if (
          scrollTop <= threshold &&
          this.hasOlderMessagesToLoad() &&
          !this.isLoadingMore() &&
          this.messages().length > 0
        ) {
        this.logger.debug('Triggering loadMoreMessages from scroll');
        this.loadMoreMessages();
      }
    }, 100); // 100ms throttle
  };

  /**
   * Scroll the messages wrapper to the bottom to show latest messages.
   * Also resets the userScrolledUp flag so the ResizeObserver keeps scrolling.
   */
  private scrollToBottom(): void {
    this.userScrolledUp = false;
    this.showScrollToLatestButton.set(false);
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      if (this.messagesWrapper?.nativeElement) {
        const element = this.messagesWrapper.nativeElement;
        element.scrollTop = element.scrollHeight;
        this.lastScrollHeight = element.scrollHeight;
      }
    }, 100);
  }

  /**
   * Scroll to bottom only if the user hasn't manually scrolled up.
   * Used as a delayed safety-net scroll after content may have reflowed.
   */
  private scrollToBottomIfNotScrolledUp(): void {
    if (this.userScrolledUp) return;
    this.showScrollToLatestButton.set(false);
    if (this.messagesWrapper?.nativeElement) {
      const element = this.messagesWrapper.nativeElement;
      element.scrollTop = element.scrollHeight;
      this.lastScrollHeight = element.scrollHeight;
    }
  }

  private resetRenderedMessageWindow(chatId: string): void {
    const totalMessages = this.messages().filter(message => !this.isReactionMessage(message)).length;
    this.renderedMessageCount.set(Math.min(totalMessages, this.MESSAGE_RENDER_BATCH_SIZE));
    this.lastRenderableMessageChatId = chatId;
    this.lastRenderableMessageCount = totalMessages;
  }

  private expandRenderedMessageWindow(targetCount = this.renderedMessageCount() + this.MESSAGE_RENDER_BATCH_SIZE): boolean {
    const totalMessages = this.messages().filter(message => !this.isReactionMessage(message)).length;
    const nextRenderedCount = Math.min(totalMessages, targetCount);

    if (nextRenderedCount <= this.renderedMessageCount()) {
      return false;
    }

    this.renderedMessageCount.set(nextRenderedCount);
    return true;
  }

  private ensureMessageRendered(messageId: string): void {
    const messages = this.messages().filter(message => !this.isReactionMessage(message));
    const targetIndex = messages.findIndex(message => message.id === messageId);

    if (targetIndex === -1) {
      return;
    }

    const requiredRenderedCount = messages.length - targetIndex;
    if (requiredRenderedCount > this.renderedMessageCount()) {
      this.renderedMessageCount.set(requiredRenderedCount);
    }
  }

  private scrollToTargetMessage(messageId: string): void {
    const attemptScroll = (remainingAttempts: number) => {
      const wrapper = this.messagesWrapper?.nativeElement;
      const messageElement = wrapper?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);

      if (!wrapper || !messageElement) {
        if (remainingAttempts > 0) {
          setTimeout(() => attemptScroll(remainingAttempts - 1), 120);
        }
        return;
      }

      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.highlightedMessageId.set(messageId);
      this.pendingScrollToMessageId.set(null);

      setTimeout(() => {
        if (this.highlightedMessageId() === messageId) {
          this.highlightedMessageId.set(null);
        }
      }, 2500);
    };

    setTimeout(() => attemptScroll(8), 50);
  }

  private isMessagesViewNearBottom(threshold = 150): boolean {
    const element = this.messagesWrapper?.nativeElement;
    if (!element) {
      return false;
    }

    const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    return distanceFromBottom <= threshold;
  }

  onMessageInputFocus(): void {
    this.shouldStickToBottomOnKeyboardOpen = this.isMessagesViewNearBottom();

    if (this.shouldStickToBottomOnKeyboardOpen) {
      this.scrollToBottomIfNotScrolledUp();
    }
  }

  onMessageInputBlur(): void {
    this.shouldStickToBottomOnKeyboardOpen = false;
  }

  scrollToLatestMessage(): void {
    this.scrollToBottom();
  }

  ngOnDestroy(): void {

    this.clearPendingDmVideoProfileMenuOpen();

    this.clearPendingEncryptedMediaPreviews();

    this.resetSelectedChatActivityTracking();

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

    // Clean up media load listener
    if (this.mediaLoadHandler && scrollElement) {
      scrollElement.removeEventListener('load', this.mediaLoadHandler, true);
      this.mediaLoadHandler = null;
    }

    // Clean up MutationObserver
    this.contentMutationObserver?.disconnect();
    this.contentMutationObserver = null;

    this.teardownComposerViewportListener();

    if (this.composerViewportResizeTimeout) {
      clearTimeout(this.composerViewportResizeTimeout);
      this.composerViewportResizeTimeout = null;
    }

  }

  private setupComposerViewportListener(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.teardownComposerViewportListener();

    this.composerViewportResizeHandler = () => {
      const textarea = this.messageInput?.nativeElement;
      if (!textarea || document.activeElement !== textarea || !this.shouldStickToBottomOnKeyboardOpen) {
        return;
      }

      this.scrollToBottomIfNotScrolledUp();

      if (this.composerViewportResizeTimeout) {
        clearTimeout(this.composerViewportResizeTimeout);
      }

      this.composerViewportResizeTimeout = setTimeout(() => {
        if (document.activeElement === textarea && this.shouldStickToBottomOnKeyboardOpen) {
          this.scrollToBottomIfNotScrolledUp();
        }
      }, 180);
    };

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', this.composerViewportResizeHandler);
      viewport.addEventListener('scroll', this.composerViewportResizeHandler);
      return;
    }

    window.addEventListener('resize', this.composerViewportResizeHandler);
  }

  private teardownComposerViewportListener(): void {
    if (typeof window === 'undefined' || !this.composerViewportResizeHandler) {
      return;
    }

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.removeEventListener('resize', this.composerViewportResizeHandler);
      viewport.removeEventListener('scroll', this.composerViewportResizeHandler);
    } else {
      window.removeEventListener('resize', this.composerViewportResizeHandler);
    }

    this.composerViewportResizeHandler = null;
  }

  private async startSelectedChatActivityTracking(pubkey: string | null): Promise<void> {
    this.resetSelectedChatActivityTracking();
    this.selectedChatActivityTrackedPubkey = pubkey;

    if (!pubkey) {
      return;
    }

    const requestToken = ++this.selectedChatActivityRequestToken;
    const liveSince = Math.floor(Date.now() / 1000);
    const filter = {
      authors: [pubkey],
      kinds: LAST_ACTIVE_EVENT_KINDS,
      limit: 1,
    };

    try {
      const [subscription, events] = await Promise.all([
        this.userRelayService.subscribe(
          pubkey,
          {
            authors: [pubkey],
            kinds: LAST_ACTIVE_EVENT_KINDS,
            since: liveSince,
          },
          (event: NostrEvent) => {
            if (this.selectedChatActivityTrackedPubkey !== pubkey) {
              return;
            }

            this.applySelectedChatActivityEvent(event);
          },
        ),
        this.userRelayService.query(pubkey, filter),
      ]);

      if (requestToken !== this.selectedChatActivityRequestToken || this.selectedChatActivityTrackedPubkey !== pubkey) {
        this.closeSelectedChatActivitySubscription(subscription);
        return;
      }

      this.selectedChatActivitySubscription = this.asClosableSubscription(subscription);
      this.applySelectedChatActivityEvent(this.getLatestActivityEvent(events ?? []));
    } catch (error) {
      if (requestToken === this.selectedChatActivityRequestToken) {
        this.logger.warn('[Messages] Failed to load selected chat activity', { pubkey, error });
      }
    }
  }

  private resetSelectedChatActivityTracking(): void {
    this.selectedChatActivityRequestToken++;
    this.selectedChatActivityTrackedPubkey = null;
    this.selectedChatRelayLastActiveAt.set(null);

    if (this.selectedChatActivitySubscription) {
      this.selectedChatActivitySubscription.close();
      this.selectedChatActivitySubscription = null;
    }
  }

  private applySelectedChatActivityEvent(event: NostrEvent | null): void {
    if (!event) {
      this.selectedChatRelayLastActiveAt.set(null);
      return;
    }

    const currentTimestamp = this.selectedChatRelayLastActiveAt() ?? 0;
    if (event.created_at >= currentTimestamp) {
      this.selectedChatRelayLastActiveAt.set(event.created_at);
    }
  }

  private getLatestActivityEvent(events: NostrEvent[]): NostrEvent | null {
    if (events.length === 0) {
      return null;
    }

    return events.reduce((latest, event) => event.created_at > latest.created_at ? event : latest);
  }

  private asClosableSubscription(subscription: unknown): { close: () => void } | null {
    if (!subscription || typeof subscription !== 'object' || !('close' in subscription)) {
      return null;
    }

    const candidate = subscription as { close?: unknown };
    if (typeof candidate.close !== 'function') {
      return null;
    }

    const close = candidate.close as () => void;
    return { close };
  }

  private closeSelectedChatActivitySubscription(subscription: unknown): void {
    const closable = this.asClosableSubscription(subscription);
    closable?.close();
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

    const scrollElement = this.messagesWrapper?.nativeElement;
    const scrollHeight = scrollElement?.scrollHeight || 0;
    const scrollTop = scrollElement?.scrollTop || 0;

    if (this.hasHiddenRenderedMessages()) {
      const expanded = this.expandRenderedMessageWindow();
      if (expanded) {
        setTimeout(() => {
          if (!scrollElement) {
            return;
          }

          const heightDiff = scrollElement.scrollHeight - scrollHeight;
          scrollElement.scrollTop = scrollTop + heightDiff;
        }, 50);
      }
      return;
    }

    this.logger.debug(`Loading more messages for chat: ${selectedChat.id}`);
    this.isLoadingMore.set(true);
    this.isLoadingMoreMessages.set(true); // Prevent auto-scroll during loading

    try {
      const currentMessages = this.renderedThreadMessages();
      const oldestTimestamp =
        currentMessages.length > 0
          ? Math.min(...currentMessages.map(m => m.created_at)) - 1
          : undefined;

      this.logger.debug(
        `Current messages count: ${currentMessages.length}, oldest timestamp: ${oldestTimestamp}`
      );

      // Load older messages from the messaging service
      const olderMessages = await this.messaging.loadMoreMessages(selectedChat.id, oldestTimestamp);

      this.logger.debug(`Loaded ${olderMessages.length} older messages`);

      // If no messages were loaded, there are no more messages to load
      if (olderMessages.length === 0) {
        this.hasMoreMessages.set(false);
        this.logger.debug('No more messages to load, setting hasMoreMessages to false');
      } else {
        this.expandRenderedMessageWindow();
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
    this.restoreDraftForChat(chat.id);
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

    // Resolve any messages stuck in "pending" state from a previous session.
    // These were likely sent but the publish callback was lost (e.g. page refresh).
    this.resolveStalePendingMessages(chat.id);

    // Preload DM relays (kind 10050) so sending is instant.
    // Loads from database first, refreshes from network in the background.
    if (chat.isGroup && chat.participants) {
      const myPubkey = this.accountState.pubkey();
      for (const participant of chat.participants) {
        if (participant !== myPubkey) {
          this.userRelayService.ensureDmRelaysForPubkey(participant).catch(err => {
            this.logger.warn('Failed to preload DM relays for group member:', err);
          });
        }
      }
    } else {
      this.userRelayService.ensureDmRelaysForPubkey(chat.pubkey).catch(err => {
        this.logger.warn('Failed to preload DM relays for chat:', err);
      });
    }

    // Navigate to the chat, clearing any query params
    this.logger.debug('Navigating to /messages/' + chat.id);
    this.router.navigate(['/messages', chat.id], {
      queryParams: {},
    });
  }

  private restoreDraftForChat(chatId: string | null): void {
    const accountPubkey = this.accountState.pubkey();
    const draftText = chatId && accountPubkey ? this.accountLocalState.getChatDraft(accountPubkey, chatId) : '';

    this.suppressDraftPersistence = true;
    this.newMessageText.set(draftText);
    this.syncComposerMediaPreviews(draftText);
    this.suppressDraftPersistence = false;
  }

  /**
   * Resolve messages stuck in "pending" state from a previous session.
   * These messages were encrypted, signed, and the publish() call was fired,
   * but the component was destroyed (page refresh, navigation) before the
   * relay response arrived. Since they were already published, re-signing
   * would risk duplicates. We mark them as delivered because the publish
   * likely succeeded.
   *
   * Only resolves messages that are NOT in the current in-memory pendingMessages
   * signal (those are actively being published right now).
   */
  private resolveStalePendingMessages(chatId: string): void {
    const persistedMessages = this.messaging.getChatMessages(chatId);
    const activePendingIds = new Set(this.pendingMessages().map(m => m.id));

    const staleMessages = persistedMessages.filter(
      m => m.pending && !activePendingIds.has(m.id)
    );

    if (staleMessages.length === 0) return;

    this.logger.info(
      `[MessagesComponent] Resolving ${staleMessages.length} stale pending message(s) in chat ${chatId.slice(0, 16)}...`
    );

    for (const msg of staleMessages) {
      this.messaging.updateMessageInChat(chatId, msg.id, {
        pending: false,
        received: true,
        failed: false,
        failureReason: undefined,
      });
    }
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
   * Auto-resize the message textarea to fit its content.
   * This is a fallback for iOS Safari which does not support the CSS
   * `field-sizing: content` property.
   */
  autoResizeTextarea(): void {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) return;
    const isFocused = typeof document !== 'undefined' && document.activeElement === textarea;
    const selectionStart = isFocused ? textarea.selectionStart : null;
    const selectionEnd = isFocused ? textarea.selectionEnd : null;
    // Reset to auto so shrinking works correctly, then set to scrollHeight
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 150); // matches CSS max-height
    textarea.style.height = newHeight + 'px';
    if (selectionStart !== null && selectionEnd !== null) {
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  private syncMessageInputLayout(): void {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) return;

    // Preserve the user's current edit position instead of forcing the textarea
    // back to the bottom while they are editing older text on Safari/iOS.
    const shouldScrollToBottom = this.shouldKeepMessageInputScrolledToBottom(textarea);

    // Auto-resize textarea for iOS Safari which doesn't support field-sizing: content
    this.autoResizeTextarea();

    if (!shouldScrollToBottom) {
      return;
    }

    // Only scroll if we're not already at the bottom
    // This avoids unnecessary DOM operations on every keystroke
    const isAtBottom = textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 5;
    if (!isAtBottom) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }

  private shouldKeepMessageInputScrolledToBottom(textarea: HTMLTextAreaElement): boolean {
    if (typeof document === 'undefined' || document.activeElement !== textarea) {
      return true;
    }

    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
    return selectionStart === selectionEnd && selectionEnd === textarea.value.length;
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

  openEncryptedFileDialog(): void {
    if (!this.encryptedFileInput?.nativeElement) {
      return;
    }

    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.encryptedFileInput.nativeElement.click();
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
   * Open Send Money dialog to send a Lightning payment to the chat recipient
   */
  async openSendMoneyDialog(): Promise<void> {
    const selectedChat = this.selectedChat();
    if (selectedChat?.isGroup) {
      this.snackBar.open('Send Money is not available for group chats', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }
    const recipientPubkey = selectedChat?.pubkey;
    if (!recipientPubkey) {
      this.snackBar.open('No chat selected', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const { SendMoneyDialogComponent } = await import('../../components/send-money-dialog/send-money-dialog.component');
    type SendMoneyDialogResult = import('../../components/send-money-dialog/send-money-dialog.component').SendMoneyDialogResult;

    const dialogRef = this.customDialog.open<typeof SendMoneyDialogComponent.prototype, SendMoneyDialogResult>(SendMoneyDialogComponent, {
      title: 'Send Money',
      width: '450px',
      maxWidth: '95vw',
      data: {
        recipientPubkey,
      },
    });

    // Initialize the dialog after it's created
    dialogRef.componentInstance.initialize();
  }

  /**
   * Open Request Money dialog to generate a BOLT-11 invoice and send it to the chat recipient
   */
  async openRequestMoneyDialog(): Promise<void> {
    const selectedChat = this.selectedChat();
    if (selectedChat?.isGroup) {
      this.snackBar.open('Request Payment is not available for group chats', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }
    const recipientPubkey = selectedChat?.pubkey;
    if (!recipientPubkey) {
      this.snackBar.open('No chat selected', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const { RequestMoneyDialogComponent } = await import('../../components/request-money-dialog/request-money-dialog.component');
    type RequestMoneyDialogResult = import('../../components/request-money-dialog/request-money-dialog.component').RequestMoneyDialogResult;

    const dialogRef = this.customDialog.open<typeof RequestMoneyDialogComponent.prototype, RequestMoneyDialogResult>(RequestMoneyDialogComponent, {
      title: 'Request Payment',
      width: '450px',
      maxWidth: '95vw',
      data: {
        recipientPubkey,
      },
    });

    // Initialize the dialog after it's created
    dialogRef.componentInstance.initialize();
  }

  /**
   * Handle file selection from the file input
   */
  onMediaFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.stageEncryptedFiles(Array.from(input.files));
    }
    input.value = '';
  }

  onEncryptedFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.stageEncryptedFiles(Array.from(input.files));
    }
    input.value = '';
  }

  /**
   * Handle paste events in the message input.
   * If clipboard contains image/video files, upload and insert them into the message.
   */
  onMessagePaste(event: ClipboardEvent): void {
    const mediaFiles = this.getClipboardMediaFiles(event);
    if (mediaFiles.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.stagePastedMediaFiles(mediaFiles);
  }

  onMessageDragOver(event: DragEvent): void {
    if (!this.hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.isDragOverMessageInput.set(true);
  }

  onMessageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOverMessageInput.set(false);
  }

  onMessageDrop(event: DragEvent): void {
    this.isDragOverMessageInput.set(false);

    if (!this.hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const mediaFiles = this.getDroppedMediaFiles(event);
    if (mediaFiles.length === 0) {
      return;
    }

    void this.stageEncryptedFiles(mediaFiles);
  }

  private hasFilePayload(event: DragEvent): boolean {
    const transferTypes = event.dataTransfer?.types;
    return !!transferTypes && Array.from(transferTypes).includes('Files');
  }

  private getDroppedMediaFiles(event: DragEvent): File[] {
    const droppedFiles = event.dataTransfer?.files;
    if (!droppedFiles || droppedFiles.length === 0) {
      return [];
    }

    return Array.from(droppedFiles).filter(file => this.isMediaFile(file));
  }

  private getClipboardMediaFiles(event: ClipboardEvent): File[] {
    const items = event.clipboardData?.items;
    if (!items) {
      return [];
    }

    const mediaFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') {
        continue;
      }

      const file = item.getAsFile();
      if (file && this.isMediaFile(file)) {
        mediaFiles.push(file);
      }
    }

    return mediaFiles;
  }

  private isMediaFile(file: File): boolean {
    return file.type.startsWith('image/') || file.type.startsWith('video/');
  }

  private async sendEncryptedFileMessage(
    file: File,
    options?: { preserveComposer?: boolean; uploadSettings?: MediaUploadSettings; skipMediaPreparation?: boolean }
  ): Promise<void> {
    const selectedChat = this.selectedChat();
    const myPubkey = this.accountState.pubkey();
    const isGroup = !!selectedChat?.isGroup;
    const preserveComposer = options?.preserveComposer ?? false;
    const replyToMessageId = this.replyingToMessage()?.id;

    if (!selectedChat || !myPubkey) {
      return;
    }

    if (isGroup && !selectedChat.participants) {
      return;
    }

    if (!isGroup && !selectedChat.pubkey) {
      return;
    }

    try {
      this.isSending.set(true);
      const uploadSettings = options?.uploadSettings ?? this.getDmUploadSettings();
      const preparedFile = this.isMediaFile(file) && !options?.skipMediaPreparation
        ? await this.mediaProcessing.prepareFileForUpload(file, uploadSettings, progress => {
          const progressSuffix = progress.progress !== undefined
            ? ` ${Math.round(progress.progress * 100)}%`
            : '';
          this.uploadStatus.set(`${progress.message}${progressSuffix}`);
        })
        : {
          file,
          uploadOriginal: true,
          wasProcessed: false,
        };

      if (preparedFile.warningMessage) {
        this.layout.toast(preparedFile.warningMessage, 5000, 'error-snackbar');
      }

      this.uploadStatus.set(`Encrypting ${preparedFile.file.name}...`);

      if (isGroup && selectedChat.participants) {
        const otherParticipants = selectedChat.participants.filter(p => p !== myPubkey);
        await Promise.all(
          otherParticipants.flatMap(p => [
            this.userRelayService.ensureRelaysForPubkey(p),
            this.userRelayService.ensureDmRelaysForPubkey(p),
          ])
        );
      } else {
        await Promise.all([
          this.userRelayService.ensureRelaysForPubkey(selectedChat.pubkey),
          this.userRelayService.ensureDmRelaysForPubkey(selectedChat.pubkey),
        ]);
      }

      const encryption = await this.encryptFileForMessage(preparedFile.file);
      this.uploadStatus.set(`Uploading ${preparedFile.file.name}...`);

      await this.mediaService.load();
      const encryptedUploadBuffer = new ArrayBuffer(encryption.encryptedBytes.byteLength);
      new Uint8Array(encryptedUploadBuffer).set(encryption.encryptedBytes);
      const encryptedFile = new File([encryptedUploadBuffer], preparedFile.file.name, {
        type: 'application/octet-stream',
        lastModified: preparedFile.file.lastModified,
      });
      const uploadResult = await this.mediaService.uploadFile(
        encryptedFile,
        true,
        this.mediaService.mediaServers()
      );

      if (uploadResult.status !== 'success' || !uploadResult.item) {
        throw new Error(uploadResult.message || 'Upload failed');
      }

      const extraRumorTags: string[][] = [
        ['alt', preparedFile.file.name],
        ['file-type', encryption.mimeType],
        ['encryption-algorithm', 'aes-gcm'],
        ['decryption-key', encryption.keyHex],
        ['decryption-nonce', encryption.nonceHex],
        ['x', encryption.encryptedSha256],
        ['ox', encryption.originalSha256],
        ['size', String(encryption.encryptedSize)],
      ];

      const result = isGroup && selectedChat.participants
        ? await this.createNip44GroupMessage(
          uploadResult.item.url,
          selectedChat.participants,
          myPubkey,
          replyToMessageId,
          undefined,
          {
            rumorKind: kinds.FileMessage,
            extraRumorTags,
          },
        )
        : await this.createNip44Message(
          uploadResult.item.url,
          selectedChat.pubkey,
          myPubkey,
          replyToMessageId,
          {
            rumorKind: kinds.FileMessage,
            extraRumorTags,
          },
        );

      const finalMessage = result.message;
      const previewMessage: DirectMessage = {
        ...finalMessage,
        pending: true,
        received: false,
      };
      const chatId = selectedChat.id;
      const pendingMessage = previewMessage;

      if (!preserveComposer) {
        this.newMessageText.set('');
        this.syncComposerMediaPreviews('');
        this.replyingToMessage.set(null);
        this.mediaPreviews.set([]);
      }

      if (isGroup && selectedChat.participants) {
        this.messaging.addMessageToChat(chatId, pendingMessage, {
          isGroup: true,
          participants: selectedChat.participants,
          subject: selectedChat.subject,
          subjectUpdatedAt: selectedChat.subjectUpdatedAt,
        });
      } else {
        this.messaging.addMessageToChat(chatId, pendingMessage);
      }
      this.pendingMessages.update(msgs => [...msgs, pendingMessage]);
      this.scrollToBottom();
      this.focusMessageInput();

      result.publish().then(publishResult => {
        if (publishResult.success) {
          this.messaging.updateMessageInChat(chatId, finalMessage.id, {
            pending: false,
            received: true,
            failed: false,
            failureReason: undefined,
          });
          this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));
          this.layout.toast('Encrypted file sent');
        } else {
          const reason = publishResult.failureReason || 'All relays rejected the encrypted file message';
          this.messaging.updateMessageInChat(chatId, finalMessage.id, {
            pending: false,
            received: false,
            failed: true,
            failureReason: reason,
          });
          this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));
          this.layout.toast(reason, 4000, 'error-snackbar');
        }
      }).catch(err => {
        const reason = err?.message || 'Failed to publish encrypted file message';
        this.logger.error('Encrypted file publish failed', err);
        this.messaging.updateMessageInChat(chatId, finalMessage.id, {
          pending: false,
          received: false,
          failed: true,
          failureReason: reason,
        });
        this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));
        this.layout.toast(reason, 4000, 'error-snackbar');
      });
    } catch (err) {
      this.logger.error('Failed to send encrypted file message', err);
      this.snackBar.open(err instanceof Error ? err.message : 'Failed to send encrypted file', 'Dismiss', {
        duration: 5000,
      });
    } finally {
      this.isSending.set(false);
      this.uploadStatus.set('');
    }
  }

  private async stagePastedMediaFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    if (this.newMessageText().trim()) {
      this.layout.toast('Send the current text message first. Pasted media is sent as a separate encrypted message.', 4000, 'error-snackbar');
      return;
    }

    if (this.pendingEncryptedMediaPreviews().length > 0 || this.mediaPreviews().some(preview => preview.pendingEncrypted)) {
      this.layout.toast('Confirm or remove the existing pasted media preview first.', 4000, 'error-snackbar');
      return;
    }

    await this.stagePendingEncryptedFiles(files, true);
  }

  private async stageEncryptedFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    if (this.newMessageText().trim()) {
      this.layout.toast('Send the current text message first. Encrypted files are sent as separate messages.', 4000, 'error-snackbar');
      return;
    }

    if (this.pendingEncryptedMediaPreviews().length > 0 || this.mediaPreviews().some(preview => preview.pendingEncrypted)) {
      this.layout.toast('Confirm or remove the existing staged file preview first.', 4000, 'error-snackbar');
      return;
    }

    await this.stagePendingEncryptedFiles(files, false);
  }

  private async stagePendingEncryptedFiles(files: File[], pastedMediaOnly: boolean): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const stagedPreviews = files.flatMap((file, index) => {
      if (pastedMediaOnly && !this.isMediaFile(file)) {
        return [];
      }

      return [this.isMediaFile(file)
        ? this.createInitialPendingEncryptedMediaPreview(file, index)
        : this.createPendingEncryptedFilePreview(file, index)];
    });

    if (stagedPreviews.length === 0) {
      return;
    }

    const uploadSettings = this.getDmUploadSettings();
    this.pendingDmMediaOptimizationRunId += 1;

    this.setPendingEncryptedFiles(stagedPreviews);

    const previewIds = stagedPreviews
      .filter(preview => preview.type === 'image' || preview.type === 'video')
      .map(preview => preview.id);

    if (previewIds.length === 0) {
      return;
    }

    try {
      await this.reprocessPendingEncryptedMediaForOptimization(uploadSettings, previewIds);
    } catch (error) {
      this.logger.error('Failed to prepare encrypted attachment preview', error);
      this.layout.toast('Failed to prepare one or more attachments.', 4000, 'error-snackbar');
    }
  }

  private createInitialPendingEncryptedMediaPreview(file: File, index: number): PendingEncryptedMediaPreview {
    return {
      id: `${Date.now()}-${index}-${file.name}`,
      objectUrl: URL.createObjectURL(file),
      file,
      sourceFile: file,
      type: file.type.startsWith('video/') ? 'video' : 'image',
      videoOptimizationProfile: file.type.startsWith('video/') ? this.dmVideoOptimizationProfile() : undefined,
      originalSize: file.size,
      processedSize: file.size,
      optimizedSize: file.size,
    };
  }

  private async createPendingEncryptedMediaPreview(
    sourceFile: File,
    index: number,
    uploadSettings: MediaUploadSettings,
    existingPreview?: PendingEncryptedMediaPreview,
    optimizationRunId?: number,
  ): Promise<PendingEncryptedMediaPreview> {
    const preparedFile = await this.mediaProcessing.prepareFileForUpload(
      sourceFile,
      this.getDmUploadSettingsForSourceFile(sourceFile, uploadSettings, existingPreview),
      progress => {
        if (optimizationRunId !== undefined && optimizationRunId !== this.pendingDmMediaOptimizationRunId) {
          return;
        }

        const progressSuffix = progress.progress !== undefined
          ? ` ${Math.round(progress.progress * 100)}%`
          : '';
        this.uploadStatus.set(`${progress.message}${progressSuffix}`);
      },
    );

    return {
      id: existingPreview?.id ?? `${Date.now()}-${index}-${sourceFile.name}`,
      objectUrl: URL.createObjectURL(preparedFile.file),
      file: preparedFile.file,
      sourceFile,
      type: sourceFile.type.startsWith('video/') ? 'video' : 'image',
      wasProcessed: preparedFile.wasProcessed,
      videoOptimizationProfile: sourceFile.type.startsWith('video/')
        ? (existingPreview?.videoOptimizationProfile ?? uploadSettings.videoOptimizationProfile ?? 'default')
        : undefined,
      originalSize: sourceFile.size,
      processedSize: preparedFile.file.size,
      optimizedSize: preparedFile.optimizedSize ?? preparedFile.file.size,
      warningMessage: preparedFile.warningMessage,
    };
  }

  private createPendingEncryptedFilePreview(file: File, index: number): PendingEncryptedMediaPreview {
    return {
      id: `${Date.now()}-${index}-${file.name}`,
      objectUrl: URL.createObjectURL(file),
      file,
      type: 'file',
    };
  }

  private setPendingEncryptedFiles(stagedPreviews: PendingEncryptedMediaPreview[]): void {
    const previousObjectUrls = this.pendingEncryptedMediaPreviews().map(preview => preview.objectUrl);

    this.syncPendingEncryptedMediaPreviews(stagedPreviews);

    for (const objectUrl of previousObjectUrls) {
      this.revokeObjectUrlLater(objectUrl);
    }
  }

  private syncPendingEncryptedMediaPreviews(stagedPreviews: PendingEncryptedMediaPreview[]): void {
    this.pendingEncryptedMediaPreviews.set(stagedPreviews);
    this.mediaPreviews.set(stagedPreviews.map(preview => ({
      url: preview.objectUrl,
      type: preview.type,
      label: preview.sourceFile?.name ?? preview.file.name,
      meta: this.formatFileSize(preview.originalSize ?? preview.file.size),
      pendingEncrypted: true,
      pendingId: preview.id,
      videoOptimizationProfile: preview.videoOptimizationProfile,
      originalSize: preview.originalSize,
      processedSize: preview.processedSize,
      optimizedSize: preview.optimizedSize,
      warningMessage: preview.warningMessage,
    })));
  }

  private async encryptFileForMessage(file: File): Promise<{
    encryptedBytes: Uint8Array;
    encryptedSha256: string;
    originalSha256: string;
    keyHex: string;
    nonceHex: string;
    encryptedSize: number;
    mimeType: string;
  }> {
    const sourceBytes = await this.mediaService.getFileBytes(file);
    const sourceBuffer = new Uint8Array(sourceBytes);
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonceBytes },
      cryptoKey,
      sourceBuffer,
    );
    const encryptedBytes = new Uint8Array(encryptedBuffer);

    return {
      encryptedBytes,
      encryptedSha256: bytesToHex(sha256(encryptedBytes)),
      originalSha256: bytesToHex(sha256(sourceBytes)),
      keyHex: bytesToHex(keyBytes),
      nonceHex: bytesToHex(nonceBytes),
      encryptedSize: encryptedBytes.byteLength,
      mimeType: this.mediaService.getFileMimeType(file),
    };
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  /**
   * Insert media URL into the message text and show preview
   */
  private insertMediaUrl(url: string, mimeType: string): void {
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    const updatedText = currentText + separator + url;
    this.newMessageText.set(updatedText);
    this.syncComposerMediaPreviews(updatedText);

    // Add preview
    if (mimeType.startsWith('image/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'image' }]);
    } else if (mimeType.startsWith('video/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'video' }]);
    }

    this.messageInput?.nativeElement?.focus();
  }

  onMessageTextChanged(value: string): void {
    this.newMessageText.set(value);
    this.syncComposerMediaPreviews(value);
  }

  private syncComposerMediaPreviews(text: string): void {
    const normalizedText = text.trim();
    this.mediaPreviews.update(previews => previews.filter(preview => {
      if (preview.pendingEncrypted) {
        return true;
      }

      return normalizedText.includes(preview.url);
    }));
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
      this.syncComposerMediaPreviews(newText);

      // Restore cursor position after emoji
      setTimeout(() => {
        const newPos = start + emoji.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    } else {
      this.newMessageText.update(text => text + emoji);
      this.syncComposerMediaPreviews(this.newMessageText());
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
      data: { mode: 'content', activeTab: 'emoji' },
    });

    dialogRef.afterClosed$.subscribe(result => {
      if (result.result) {
        // Check if it's a GIF URL (starts with http)
        if (result.result.startsWith('http')) {
          this.insertGifUrl(result.result);
        } else {
          this.insertEmoji(result.result);
        }
      }
    });
  }

  /**
   * Insert a GIF URL into the message text
   */
  insertGifUrl(url: string): void {
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    const updatedText = currentText + separator + url;
    this.newMessageText.set(updatedText);
    this.syncComposerMediaPreviews(updatedText);

    // Add preview (GIFs are images)
    this.mediaPreviews.update(previews => [...previews, { url, type: 'image' as const }]);

    this.messageInput?.nativeElement?.focus();
  }

  /**
   * Open GIF picker in a fullscreen dialog on small screens
   */
  async openGifPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../../components/emoji-picker/emoji-picker-dialog.component');
    const dialogRef = this.customDialog.open<typeof EmojiPickerDialogComponent.prototype, string>(EmojiPickerDialogComponent, {
      title: 'GIFs',
      width: '400px',
      panelClass: 'emoji-picker-dialog',
      data: { mode: 'content', activeTab: 'gifs' },
    });

    dialogRef.afterClosed$.subscribe(result => {
      if (result.result) {
        this.insertGifUrl(result.result);
      }
    });
  }

  /**
   * Open music chooser dialog to share music tracks or albums
   */
  async openMusicChooser(): Promise<void> {
    const { MusicChooserDialogComponent } = await import('../../components/music-chooser-dialog/music-chooser-dialog.component');
    type MusicChooserResult = import('../../components/music-chooser-dialog/music-chooser-dialog.component').MusicChooserResult;

    const dialogRef = this.customDialog.open<typeof MusicChooserDialogComponent.prototype, MusicChooserResult>(MusicChooserDialogComponent, {
      title: 'Choose Music',
      width: '500px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.naddr) {
        this.insertMusicReference(result.naddr, result.title, result.type);
      }
    });
  }

  /**
   * Insert a music reference (naddr) into the message text
   */
  private insertMusicReference(naddr: string, title: string, musicType: 'track' | 'playlist'): void {
    const nostrUrl = 'nostr:' + naddr;
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    const updatedText = currentText + separator + nostrUrl;
    this.newMessageText.set(updatedText);
    this.syncComposerMediaPreviews(updatedText);

    // Add preview
    const label = musicType === 'playlist' ? `Album: ${title}` : title;
    this.mediaPreviews.update(previews => [...previews, { url: nostrUrl, type: 'music' as const, label }]);

    this.messageInput?.nativeElement?.focus();
  }

  /**
   * Open the reference picker dialog to insert Nostr references (profiles, events, articles)
   */
  async openReferencePicker(): Promise<void> {
    const { ArticleReferencePickerDialogComponent } = await import(
      '../../components/article-reference-picker-dialog/article-reference-picker-dialog.component'
    );
    type ArticleReferencePickerResult = import(
      '../../components/article-reference-picker-dialog/article-reference-picker-dialog.component'
    ).ArticleReferencePickerResult;

    const dialogRef = this.customDialog.open<
      typeof ArticleReferencePickerDialogComponent.prototype,
      ArticleReferencePickerResult
    >(ArticleReferencePickerDialogComponent, {
      title: 'Insert Reference',
      width: '760px',
      maxWidth: '96vw',
      showCloseButton: true,
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      const references = result?.references ?? [];
      if (references.length > 0) {
        this.insertNostrReferences(references);
      }
    });
  }

  private insertNostrReferences(references: string[]): void {
    const unique = Array.from(new Set(references.filter(ref => !!ref?.trim())));
    if (unique.length === 0) {
      return;
    }

    const insertionText = unique.join('\n');
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    const updatedText = currentText + separator + insertionText;
    this.newMessageText.set(updatedText);
    this.syncComposerMediaPreviews(updatedText);

    this.messageInput?.nativeElement?.focus();
    this.snackBar.open(
      unique.length === 1 ? 'Reference inserted' : `${unique.length} references inserted`,
      'Close',
      { duration: 2500 },
    );
  }

  /**
   * Record an audio clip and attach it to the message
   */
  async recordAudioClip(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const { AudioRecordDialogComponent } = await import('../../pages/media/audio-record-dialog/audio-record-dialog.component');

    const dialogRef = this.dialog.open(AudioRecordDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(async (result: { blob: Blob; waveform: number[]; duration: number } | undefined) => {
      if (result?.blob) {
        try {
          const file = new File([result.blob], 'voice-message.mp4', { type: result.blob.type });
          await this.sendEncryptedFileMessage(file, { preserveComposer: true });
        } catch {
          this.snackBar.open('Failed to upload audio clip', 'Dismiss', { duration: 5000 });
        }
      }
    });
  }

  /**
   * Record a video clip and attach it to the message
   */
  async recordVideoClip(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const { VideoRecordDialogComponent } = await import('../../pages/media/video-record-dialog/video-record-dialog.component');

    const dialogRef = this.customDialog.open<typeof VideoRecordDialogComponent.prototype, VideoRecordDialogResult | null>(
      VideoRecordDialogComponent,
      {
        title: 'Record Video Clip',
        width: '600px',
        maxWidth: '90vw',
        disableClose: true,
        showCloseButton: true,
        panelClass: 'video-record-dialog-panel',
      }
    );

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result?.file) {
        try {
          await this.sendEncryptedFileMessage(result.file, {
            preserveComposer: true,
            uploadSettings: result.uploadSettings,
          });
        } catch {
          this.snackBar.open('Failed to upload video clip', 'Dismiss', { duration: 5000 });
        }
      }
    });
  }

  /**
   * Remove a specific media preview by index
   */
  removeMediaPreview(index: number): void {
    const preview = this.mediaPreviews()[index];
    let pendingObjectUrlToRevoke: string | null = null;

    if (preview) {
      if (preview.pendingEncrypted && preview.pendingId) {
        this.pendingDmMediaOptimizationRunId += 1;
        const stagedPreview = this.pendingEncryptedMediaPreviews().find(item => item.id === preview.pendingId);
        if (stagedPreview) {
          pendingObjectUrlToRevoke = stagedPreview.objectUrl;
        }
        this.pendingEncryptedMediaPreviews.update(items => items.filter(item => item.id !== preview.pendingId));
      }

      // Remove the URL from the message text
      const currentText = this.newMessageText();
      const newText = currentText
        .split('\n')
        .filter(line => line.trim() !== preview.url)
        .join('\n');
      this.newMessageText.set(newText);
    }
    this.mediaPreviews.update(previews => previews.filter((_, i) => i !== index));

    this.revokeObjectUrlLater(pendingObjectUrlToRevoke);
  }

  async confirmPastedMedia(): Promise<void> {
    const stagedPreviews = this.pendingEncryptedMediaPreviews();
    if (stagedPreviews.length === 0 || this.isUploading()) {
      return;
    }

    if (this.newMessageText().trim()) {
      this.layout.toast('Send the current text message first. Encrypted media is sent as a separate message.', 4000, 'error-snackbar');
      return;
    }

    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.isUploading.set(true);

    try {
      await this.mediaService.load();

      for (let index = 0; index < stagedPreviews.length; index++) {
        this.uploadStatus.set(stagedPreviews.length > 1 ? `Encrypting ${index + 1}/${stagedPreviews.length}...` : 'Encrypting...');
        await this.sendEncryptedFileMessage(stagedPreviews[index].file, {
          preserveComposer: true,
          uploadSettings: this.getDmUploadSettingsForPreview(stagedPreviews[index]),
          skipMediaPreparation: stagedPreviews[index].type === 'image' || stagedPreviews[index].type === 'video',
        });
      }
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
      this.clearPendingEncryptedMediaPreviews();
    }
  }

  async openPendingCompressionPreview(previewId: string): Promise<void> {
    const stagedPreview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    if (!stagedPreview || (stagedPreview.type !== 'image' && stagedPreview.type !== 'video')) {
      return;
    }

    const { CompressionPreviewDialogComponent } = await import(
      '../../components/compression-preview-dialog/compression-preview-dialog.component'
    );

    this.customDialog.open<typeof CompressionPreviewDialogComponent.prototype, void>(CompressionPreviewDialogComponent, {
      title: 'Optimization Preview',
      width: '980px',
      maxWidth: '96vw',
      showCloseButton: true,
      data: {
        file: stagedPreview.sourceFile ?? stagedPreview.file,
        uploadSettings: this.getDmUploadSettingsForPreview(stagedPreview),
        contextLabel: 'Encrypted attachment',
        previewResult: this.getDmExistingCompressionPreview(stagedPreview),
      },
    });
  }

  async openComposerImagePreview(index: number, event?: MouseEvent): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const imagePreviews = this.mediaPreviews()
      .map((preview, previewIndex) => ({ preview, previewIndex }))
      .filter(entry => entry.preview.type === 'image');

    const selectedImageIndex = imagePreviews.findIndex(entry => entry.previewIndex === index);
    if (selectedImageIndex === -1) {
      return;
    }

    const { MediaPreviewDialogComponent } = await import('../../components/media-preview-dialog/media-preview.component');

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: imagePreviews.map(({ preview }) => ({
          url: preview.url,
          type: 'image',
          title: preview.label,
        })),
        initialIndex: selectedImageIndex,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  clearPendingEncryptedMediaPreviews(): void {
    const objectUrls = this.pendingEncryptedMediaPreviews().map(preview => preview.objectUrl);
    this.pendingDmMediaOptimizationRunId += 1;

    this.pendingEncryptedMediaPreviews.set([]);
    this.mediaPreviews.update(previews => previews.filter(preview => !preview.pendingEncrypted));
    this.dmMediaUploadMode.set(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.mode);
    this.dmCompressionStrength.set(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.compressionStrength);
    this.dmVideoOptimizationProfile.set(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.videoOptimizationProfile ?? 'default');

    for (const objectUrl of objectUrls) {
      this.revokeObjectUrlLater(objectUrl);
    }
  }

  async onDmOptimizationChange(optimization: MediaOptimizationOptionValue): Promise<void> {
    const settings = {
      ...getMediaUploadSettingsForOptimization(optimization),
      videoOptimizationProfile: this.dmVideoOptimizationProfile(),
    };
    const changed = settings.mode !== this.dmMediaUploadMode()
      || settings.compressionStrength !== this.dmCompressionStrength()
      || settings.videoOptimizationProfile !== this.dmVideoOptimizationProfile();

    this.dmMediaUploadMode.set(settings.mode);
    this.dmCompressionStrength.set(settings.compressionStrength);
    this.dmVideoOptimizationProfile.set(settings.videoOptimizationProfile ?? 'default');

    if (!changed) {
      return;
    }

    await this.reprocessPendingEncryptedMediaForOptimization(settings);
  }

  getDmPendingPreviewSizeLabel(preview: ComposerMediaPreview): string {
    const comparisonSize = this.getDmPendingPreviewComparisonSize(preview);
    return this.formatCompactFileSize(comparisonSize || this.getDmPendingPreviewUploadSize(preview) || this.getDmPendingPreviewOriginalSize(preview));
  }

  getDmPendingPreviewSavingsLabel(preview: ComposerMediaPreview): string {
    const savings = this.getDmPendingPreviewCompressionChangePercent(preview);

    if (savings === null) {
      return '';
    }

    if (savings > 0) {
      return `-${savings}%`;
    }

    if (savings < 0) {
      return `+${Math.abs(savings)}%`;
    }

    return preview.optimizedSize !== undefined ? '0%' : '';
  }

  getDmPendingPreviewSavingsTone(preview: ComposerMediaPreview): 'decrease' | 'increase' | 'neutral' | 'none' {
    const savings = this.getDmPendingPreviewCompressionChangePercent(preview);

    if (savings === null) {
      return 'none';
    }

    if (savings > 0) {
      return 'decrease';
    }

    if (savings < 0) {
      return 'increase';
    }

    return 'neutral';
  }

  getDmVideoOptimizationProfileBadgeLabel(previewId: string): string {
    const preview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    if (!preview) {
      return getVideoOptimizationProfileBadgeLabel(this.dmVideoOptimizationProfile());
    }

    return getVideoOptimizationProfileBadgeLabel(this.getDmVideoOptimizationProfileForPreview(preview));
  }

  getDmVideoOptimizationProfileLabel(previewId: string): string {
    const preview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    const profile = preview ? this.getDmVideoOptimizationProfileForPreview(preview) : this.dmVideoOptimizationProfile();

    return this.videoOptimizationProfileOptions.find(option => option.value === profile)?.label
      ?? this.videoOptimizationProfileOptions[0].label;
  }

  onPendingPreviewPointerDown(previewId: string, trigger: MatMenuTrigger, event: PointerEvent): void {
    const preview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    if (!preview || preview.type !== 'video' || event.button !== 0) {
      return;
    }

    this.clearPendingDmVideoProfileMenuOpen();
    this.pendingDmVideoProfileMenuTimeout = setTimeout(() => {
      this.pendingDmVideoProfileMenuTimeout = null;
      this.openDmVideoOptimizationMenu(preview, trigger);
    }, this.DM_VIDEO_PROFILE_MENU_HOLD_DELAY);
  }

  onPendingPreviewPointerUp(): void {
    this.clearPendingDmVideoProfileMenuOpen();
  }

  onPendingPreviewContextMenu(previewId: string, trigger: MatMenuTrigger, event: MouseEvent): void {
    const preview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    if (!preview || preview.type !== 'video') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.clearPendingDmVideoProfileMenuOpen();
    this.openDmVideoOptimizationMenu(preview, trigger);
  }

  onPendingPreviewKeyDown(previewId: string, trigger: MatMenuTrigger, event: KeyboardEvent): void {
    const preview = this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
    if (!preview || preview.type !== 'video') {
      return;
    }

    const shouldOpenMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!shouldOpenMenu) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openDmVideoOptimizationMenu(preview, trigger);
  }

  isSelectedDmVideoOptimizationProfile(profile: VideoOptimizationProfile): boolean {
    const preview = this.getDmVideoProfileMenuPreview();
    if (!preview) {
      return false;
    }

    return this.getDmVideoOptimizationProfileForPreview(preview) === profile;
  }

  async onDmVideoOptimizationProfileSelected(profile: VideoOptimizationProfile): Promise<void> {
    const preview = this.getDmVideoProfileMenuPreview();
    if (!preview) {
      return;
    }

    this.activeDmVideoProfileMenuTrigger?.closeMenu();

    if (this.getDmVideoOptimizationProfileForPreview(preview) === profile) {
      return;
    }

    this.pendingEncryptedMediaPreviews.update(items => items.map(item => item.id === preview.id
      ? { ...item, videoOptimizationProfile: profile }
      : item));
    this.mediaPreviews.update(items => items.map(item => item.pendingId === preview.id
      ? { ...item, videoOptimizationProfile: profile }
      : item));

    await this.reprocessPendingEncryptedMediaForOptimization(this.getDmUploadSettings(), [preview.id]);
  }

  onDmVideoOptimizationMenuClosed(): void {
    this.clearPendingDmVideoProfileMenuOpen();
    this.activeDmVideoProfileMenuTrigger = null;
    this.dmVideoProfileMenuPreviewId.set(null);
  }

  private getDmUploadSettings(): MediaUploadSettings {
    return {
      mode: this.dmMediaUploadMode(),
      compressionStrength: this.dmCompressionStrength(),
      videoOptimizationProfile: this.dmVideoOptimizationProfile(),
    };
  }

  private getDmUploadSettingsForPreview(preview: PendingEncryptedMediaPreview): MediaUploadSettings {
    return {
      ...this.getDmUploadSettings(),
      videoOptimizationProfile: preview.type === 'video'
        ? this.getDmVideoOptimizationProfileForPreview(preview)
        : this.dmVideoOptimizationProfile(),
    };
  }

  private getDmUploadSettingsForSourceFile(
    sourceFile: File,
    settings: MediaUploadSettings,
    preview?: PendingEncryptedMediaPreview,
  ): MediaUploadSettings {
    if (!sourceFile.type.startsWith('video/')) {
      return settings;
    }

    return {
      ...settings,
      videoOptimizationProfile: preview?.videoOptimizationProfile ?? settings.videoOptimizationProfile ?? this.dmVideoOptimizationProfile(),
    };
  }

  private getDmVideoOptimizationProfileForPreview(preview: PendingEncryptedMediaPreview): VideoOptimizationProfile {
    return preview.videoOptimizationProfile ?? this.dmVideoOptimizationProfile();
  }

  private getDmVideoProfileMenuPreview(): PendingEncryptedMediaPreview | undefined {
    const previewId = this.dmVideoProfileMenuPreviewId();
    if (!previewId) {
      return undefined;
    }

    return this.pendingEncryptedMediaPreviews().find(item => item.id === previewId);
  }

  private openDmVideoOptimizationMenu(preview: PendingEncryptedMediaPreview, trigger: MatMenuTrigger): void {
    this.dmVideoProfileMenuPreviewId.set(preview.id);
    this.activeDmVideoProfileMenuTrigger = trigger;
    requestAnimationFrame(() => {
      trigger.openMenu();
      setTimeout(() => trigger.updatePosition(), 0);
    });
  }

  private clearPendingDmVideoProfileMenuOpen(): void {
    if (this.pendingDmVideoProfileMenuTimeout !== null) {
      clearTimeout(this.pendingDmVideoProfileMenuTimeout);
      this.pendingDmVideoProfileMenuTimeout = null;
    }
  }

  private async reprocessPendingEncryptedMediaForOptimization(
    settings: MediaUploadSettings,
    previewIds?: string[],
  ): Promise<void> {
    this.pendingDmMediaOptimizationRequest = this.mergePendingDmMediaOptimizationRequest(
      this.pendingDmMediaOptimizationRequest,
      { settings, previewIds },
    );

    if (this.pendingDmMediaOptimizationPromise) {
      return this.pendingDmMediaOptimizationPromise;
    }

    this.pendingDmMediaOptimizationPromise = this.flushPendingDmMediaOptimizationQueue();
    return this.pendingDmMediaOptimizationPromise;
  }

  private mergePendingDmMediaOptimizationRequest(
    current: PendingDmMediaOptimizationRequest | null,
    next: PendingDmMediaOptimizationRequest,
  ): PendingDmMediaOptimizationRequest {
    if (!current) {
      return {
        settings: next.settings,
        previewIds: next.previewIds ? [...next.previewIds] : undefined,
      };
    }

    return {
      settings: next.settings,
      previewIds: this.mergePendingDmMediaOptimizationPreviewIds(current.previewIds, next.previewIds),
    };
  }

  private mergePendingDmMediaOptimizationPreviewIds(
    current?: string[],
    next?: string[],
  ): string[] | undefined {
    if (!current || current.length === 0 || !next || next.length === 0) {
      return undefined;
    }

    return Array.from(new Set([...current, ...next]));
  }

  private async flushPendingDmMediaOptimizationQueue(): Promise<void> {
    this.isUploading.set(true);

    try {
      while (this.pendingDmMediaOptimizationRequest) {
        const request = this.pendingDmMediaOptimizationRequest;
        this.pendingDmMediaOptimizationRequest = null;
        await this.runPendingDmMediaOptimization(request.settings, request.previewIds);
      }
    } finally {
      this.pendingDmMediaOptimizationPromise = null;
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  private async runPendingDmMediaOptimization(
    settings: MediaUploadSettings,
    previewIds?: string[],
  ): Promise<void> {
    const pendingPreviews = this.pendingEncryptedMediaPreviews().filter(preview => {
      if (preview.type !== 'image' && preview.type !== 'video') {
        return false;
      }

      if (!previewIds || previewIds.length === 0) {
        return true;
      }

      return previewIds.includes(preview.id);
    });

    if (pendingPreviews.length === 0) {
      return;
    }

    const runId = ++this.pendingDmMediaOptimizationRunId;
    const isStale = (): boolean => runId !== this.pendingDmMediaOptimizationRunId;
    const currentPreviews = [...this.pendingEncryptedMediaPreviews()];

    for (const [index, preview] of pendingPreviews.entries()) {
      if (isStale()) {
        return;
      }

      const sourceFile = preview.sourceFile ?? preview.file;
      const refreshedPreview = await this.createPendingEncryptedMediaPreview(sourceFile, index, settings, preview, runId);

      if (isStale()) {
        this.revokeObjectUrlLater(refreshedPreview.objectUrl);
        return;
      }

      const existingIndex = currentPreviews.findIndex(item => item.id === preview.id);
      if (existingIndex === -1) {
        this.revokeObjectUrlLater(refreshedPreview.objectUrl);
        continue;
      }

      this.revokeObjectUrlLater(currentPreviews[existingIndex].objectUrl);
      currentPreviews[existingIndex] = refreshedPreview;
    }

    if (isStale()) {
      return;
    }

    this.syncPendingEncryptedMediaPreviews(currentPreviews);
  }

  private getDmPendingPreviewUploadSize(preview: ComposerMediaPreview): number {
    return preview.processedSize ?? this.getDmPendingPreviewOriginalSize(preview);
  }

  private getDmPendingPreviewComparisonSize(preview: ComposerMediaPreview): number {
    return preview.optimizedSize ?? preview.processedSize ?? this.getDmPendingPreviewOriginalSize(preview);
  }

  private getDmPendingPreviewOriginalSize(preview: ComposerMediaPreview): number {
    return preview.originalSize ?? preview.processedSize ?? 0;
  }

  private getDmPendingPreviewCompressionChangePercent(preview: ComposerMediaPreview): number | null {
    const originalSize = this.getDmPendingPreviewOriginalSize(preview);
    const comparisonSize = this.getDmPendingPreviewComparisonSize(preview);

    if (originalSize <= 0 || comparisonSize <= 0) {
      return null;
    }

    return Math.round((1 - comparisonSize / originalSize) * 100);
  }

  private getDmExistingCompressionPreview(preview: PendingEncryptedMediaPreview): CompressionPreviewResult {
    const originalFile = preview.sourceFile ?? preview.file;
    const hasProcessedFile = !!preview.wasProcessed;

    return {
      originalFile,
      compressedFile: hasProcessedFile ? preview.file : undefined,
      optimizedSize: preview.optimizedSize ?? preview.processedSize,
      willUploadCompressedFile: hasProcessedFile,
      warningMessage: preview.warningMessage,
    };
  }

  private formatCompactFileSize(bytes?: number): string {
    if (!bytes || bytes <= 0) {
      return '0B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);

    let decimals = 0;
    if (value < 10 && exponent > 0) {
      decimals = 1;
    }

    return `${parseFloat(value.toFixed(decimals))}${units[exponent]}`;
  }

  private hasConfiguredMediaServers(): boolean {
    return this.mediaService.mediaServers().length > 0;
  }

  private revokeObjectUrlLater(url: string | null): void {
    if (!url?.startsWith('blob:')) {
      return;
    }

    const revoke = () => URL.revokeObjectURL(url);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(revoke));
      return;
    }

    setTimeout(revoke, 0);
  }

  private showMediaServerWarning(): void {
    this.snackBar.open('You need to configure a media server before uploading files.', 'Setup', { duration: 5000 })
      .onAction().subscribe(() => {
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      });
  }

  /**
   * Handle keyboard events in the message input
   * Desktop: Enter (or Ctrl+Enter) sends message, Shift+Enter adds newline
   * Mobile: Enter adds newline (must use send button to send)
   */
  onMessageKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      // Use layout handset detection only. Touch-capable desktops should still use desktop key behavior.
      const isMobile = this.layout.isHandset();

      if (isMobile) {
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
   * Uses optimistic UI: the message appears as pending immediately while
   * relay publishing happens in the background. The message transitions
   * to received/failed based on actual relay delivery results.
   */
  async sendMessage(): Promise<void> {
    const messageText = this.newMessageText().trim();
    if (!messageText || this.isSending()) return;

    const selectedChat = this.selectedChat();
    if (!selectedChat) return;

    const isGroup = !!selectedChat.isGroup;
    const chatId = selectedChat.id;

    // For 1-on-1 chats, we need a receiver pubkey
    if (!isGroup && !selectedChat.pubkey) return;

    this.isSending.set(true);

    try {
      const myPubkey = this.accountState.pubkey();
      if (!myPubkey) {
        throw new Error('You need to be logged in to send messages');
      }

      // Ensure DM relays (kind 10050) are discovered for all recipients.
      // This is critical for first-time conversations where relays haven't been cached yet.
      if (isGroup && selectedChat.participants) {
        const otherParticipants = selectedChat.participants.filter(p => p !== myPubkey);
        await Promise.all(
          otherParticipants.flatMap(p => [
            this.userRelayService.ensureRelaysForPubkey(p),
            this.userRelayService.ensureDmRelaysForPubkey(p),
          ])
        );
      } else {
        await Promise.all([
          this.userRelayService.ensureRelaysForPubkey(selectedChat.pubkey),
          this.userRelayService.ensureDmRelaysForPubkey(selectedChat.pubkey),
        ]);
      }

      // Scroll to bottom for new outgoing messages
      this.scrollToBottom();

      // Capture the reply context before clearing
      const replyToMessage = this.replyingToMessage();

      // Clear the input and reply context
      this.newMessageText.set('');
      this.syncComposerMediaPreviews('');
      this.replyingToMessage.set(null);
      this.mediaPreviews.set([]);
      const extraRumorTags = this.pendingTags();
      this.pendingTags.set([]);

      // Create the message (encrypts + signs, but does NOT publish yet)
      let result: { message: DirectMessage; publish: () => Promise<{ success: boolean; failureReason?: string }> };

      if (isGroup && selectedChat.participants) {
        // Group chat: use NIP-44 group message flow
        // Don't include subject on regular messages - only when changing the subject
        result = await this.createNip44GroupMessage(
          messageText,
          selectedChat.participants,
          myPubkey,
          replyToMessage?.id,
          undefined,
          extraRumorTags.length ? { extraRumorTags } : undefined,
        );
      } else {
        // 1-on-1 chat
        const useModernEncryption = this.supportsModernEncryption(selectedChat);

        if (useModernEncryption) {
          result = await this.createNip44Message(
            messageText,
            selectedChat.pubkey,
            myPubkey,
            replyToMessage?.id,
            extraRumorTags.length ? { extraRumorTags } : undefined,
          );
        } else {
          result = await this.createNip04Message(
            messageText,
            selectedChat.pubkey,
            myPubkey,
            replyToMessage?.id
          );
        }
      }

      const finalMessage = result.message;

      // Add message as PENDING to both the messaging service and local pending list.
      // It stays pending until relay publishing confirms delivery.
      const pendingMessage: DirectMessage = {
        ...finalMessage,
        pending: true,
        received: false,
      };

      // Add to messaging service (persists to DB as pending)
      // For groups, pass groupInfo so the chat is created/updated correctly
      if (isGroup && selectedChat.participants) {
        this.messaging.addMessageToChat(chatId, pendingMessage, {
          isGroup: true,
          participants: selectedChat.participants,
          subject: selectedChat.subject,
          subjectUpdatedAt: selectedChat.subjectUpdatedAt,
        });
      } else {
        this.messaging.addMessageToChat(selectedChat.pubkey, pendingMessage);
      }

      // Also add to local pending signal for immediate UI feedback
      this.pendingMessages.update(msgs => [...msgs, pendingMessage]);

      // Release the send button immediately - message is visible as pending
      this.isSending.set(false);
      this.focusMessageInput();

      // Publish to relays in the background, then update message status
      result.publish().then(publishResult => {
        if (publishResult.success) {
          // At least one relay accepted — mark as delivered
          this.messaging.updateMessageInChat(chatId, finalMessage.id, {
            pending: false,
            received: true,
            failed: false,
            failureReason: undefined,
          });
          // Remove from local pending (persisted version will take over)
          this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));
        } else {
          // All relays rejected — mark as failed with reason
          const reason = publishResult.failureReason || 'All relays rejected the message';
          this.logger.error('Message delivery failed:', reason);
          this.messaging.updateMessageInChat(chatId, finalMessage.id, {
            pending: false,
            received: false,
            failed: true,
            failureReason: reason,
          });
          this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));

          this.notifications.addNotification({
            id: Date.now().toString(),
            type: NotificationType.ERROR,
            title: 'Message Not Delivered',
            message: reason,
            timestamp: Date.now(),
            read: false,
          });
        }
      }).catch(err => {
        this.logger.error('Background relay publishing failed', err);
        const reason = err?.message || 'Failed to publish message to relays';
        // Mark as failed so user can see and retry
        this.messaging.updateMessageInChat(chatId, finalMessage.id, {
          pending: false,
          received: false,
          failed: true,
          failureReason: reason,
        });
        this.pendingMessages.update(msgs => msgs.filter(m => m.id !== finalMessage.id));

        this.notifications.addNotification({
          id: Date.now().toString(),
          type: NotificationType.ERROR,
          title: 'Message Not Delivered',
          message: reason,
          timestamp: Date.now(),
          read: false,
        });
      });
    } catch (err) {
      this.logger.error('Failed to send message', err);

      // Clear any pending messages since the send failed before publishing
      this.pendingMessages.set([]);

      this.isSending.set(false);
      this.focusMessageInput();

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

  private focusMessageInput(): void {
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
    }, 0);
  }

  /**
   * Retry sending a failed message.
   * Removes the failed message and re-triggers the full send flow
   * with the same content and reply context.
   */
  async retryMessage(message: DirectMessage): Promise<void> {
    if (message.rumorKind === kinds.FileMessage) {
      this.layout.toast('Encrypted file messages cannot be retried after upload. Please send the file again.', 4000, 'error-snackbar');
      return;
    }

    const selectedChat = this.selectedChat();
    if (!selectedChat) return;

    const chatId = selectedChat.id;

    // Remove the failed message from pending list
    this.pendingMessages.update(msgs => msgs.filter(msg => msg.id !== message.id));

    // Remove from persisted chat state (it was saved as failed)
    this.messaging.removeMessageFromChat(chatId, message.id);

    // Re-send: put the content into the input field and trigger send
    this.newMessageText.set(message.content);
    this.syncComposerMediaPreviews(message.content);

    // Restore reply context if the original message was a reply
    if (message.replyTo) {
      const repliedMessage = this.getMessageById(message.replyTo);
      if (repliedMessage) {
        this.replyingToMessage.set(repliedMessage);
      }
    }

    // Trigger the send flow
    await this.sendMessage();
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
    const messages = this.messages().filter(message => !this.isReactionMessage(message));
    return messages.find(m => m.id === messageId);
  }

  getReplyPreviewText(message: DirectMessage): string | null {
    if (message.replyTo) {
      const repliedMessage = this.getMessageById(message.replyTo);
      if (repliedMessage) {
        return repliedMessage.content;
      }
    }

    return message.quotedReplyContent || null;
  }

  isReactionMessage(message: DirectMessage): boolean {
    if (message.eventKind === 'reaction') {
      return true;
    }

    const kTag = message.tags.find(tag => tag[0] === 'k');
    const hasETag = message.tags.some(tag => tag[0] === 'e' && !!tag[1]);
    return hasETag && (kTag?.[1] === String(kinds.PrivateDirectMessage) || this.isLikelyReactionContent(message.reactionContent || message.content));
  }

  private isLikelyReactionContent(content: string): boolean {
    if (!content) {
      return false;
    }

    if (content === '+' || content === '-') {
      return true;
    }

    if (/^:[A-Za-z0-9_\-+]+:$/.test(content)) {
      return true;
    }

    const compact = content.trim();
    if (!compact || compact.includes(' ')) {
      return false;
    }

    return Array.from(compact).length <= 4;
  }

  getReactionDisplay(content: string): string {
    if (!content || content === '+') {
      return '\u2764\uFE0F';
    }
    return content;
  }

  /**
   * Get the display text for a chat preview in the chat list.
   * For reaction messages, shows "Reacted ❤️" or similar instead of raw content.
   */
  getChatPreviewText(lastMessage: DirectMessage): string {
    if (lastMessage.eventKind === 'reaction' || this.isReactionMessage(lastMessage)) {
      const content = lastMessage.reactionContent || lastMessage.content;
      if (!content || content === '+') {
        return 'Reacted \u2764\uFE0F';
      }
      const shortcode = this.getEmojiShortcode(content);
      if (shortcode) {
        return 'Reacted';
      }
      return `Reacted ${content}`;
    }
    const fileMessageTitle = this.getFileMessageTitle(lastMessage.tags || []);
    if (fileMessageTitle) {
      return fileMessageTitle;
    }
    if (lastMessage.rumorKind === kinds.FileMessage) {
      return 'Encrypted file';
    }
    return lastMessage.content;
  }

  private getFileMessageTitle(tags: string[][]): string | undefined {
    return tags.find(tag => tag[0] === 'alt' && !!tag[1])?.[1];
  }

  getChatPreviewEmojiUrl(lastMessage: DirectMessage): string | undefined {
    if (lastMessage.eventKind !== 'reaction' && !this.isReactionMessage(lastMessage)) {
      return undefined;
    }
    const content = lastMessage.reactionContent || lastMessage.content;
    return this.getReactionCustomEmojiUrl(content, lastMessage.tags || []);
  }

  getReactionCustomEmojiUrl(content: string, tags: string[][]): string | undefined {
    const shortcode = this.getEmojiShortcode(content);
    if (!shortcode) {
      return undefined;
    }

    const emojiTag = tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode && !!tag[2]);
    if (emojiTag?.[2]) {
      return emojiTag[2];
    }

    // Fall back to resolved emoji cache (populated async from user emoji sets)
    return this.resolvedEmojiUrls().get(content);
  }

  getReactionEmojiSetAddress(content: string, tags: string[][]): string | undefined {
    const shortcode = this.getEmojiShortcode(content);
    if (!shortcode) return undefined;
    const emojiTag = tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode && !!tag[2]);
    return emojiTag?.[3] || undefined;
  }

  private getEmojiShortcode(content: string): string | undefined {
    if (!content || !content.startsWith(':') || !content.endsWith(':')) {
      return undefined;
    }

    const shortcode = content.slice(1, -1).trim();
    return shortcode || undefined;
  }

  /**
   * Asynchronously resolve a custom emoji URL from the sender's emoji sets.
   * Updates the resolvedEmojiUrls signal when found, which triggers re-render.
   */
  private resolveEmojiUrl(content: string, senderPubkey: string): void {
    if (this.emojiResolutionPending.has(content)) return;
    this.emojiResolutionPending.add(content);

    const shortcode = this.getEmojiShortcode(content);
    if (!shortcode) return;

    this.emojiSetService.getUserEmojiSets(senderPubkey).then(emojiSets => {
      const url = emojiSets.get(shortcode);
      if (url) {
        this.resolvedEmojiUrls.update(map => {
          const updated = new Map(map);
          updated.set(content, url);
          return updated;
        });
      }
    }).catch(() => {
      // Ignore resolution failures
    });
  }

  getMessageReactions(messageId: string): MessageReactionSummary[] {
    const latestReactionByPubkey = new Map<string, DirectMessage>();

    for (const entry of this.messages()) {
      if (!this.isReactionMessage(entry)) {
        continue;
      }

      const reactionTarget = entry.reactionTo || this.getReactionTargetFromTags(entry.tags);
      if (reactionTarget !== messageId) {
        continue;
      }

      const existing = latestReactionByPubkey.get(entry.pubkey);
      if (!existing || entry.created_at >= existing.created_at) {
        latestReactionByPubkey.set(entry.pubkey, entry);
      }
    }

    const myPubkey = this.accountState.pubkey();
    const groupedReactions = new Map<string, MessageReactionSummary>();

    for (const reaction of latestReactionByPubkey.values()) {
      const content = reaction.reactionContent || reaction.content;
      const customEmojiUrl = this.getReactionCustomEmojiUrl(content, reaction.tags || []);
      const emojiSetAddress = this.getReactionEmojiSetAddress(content, reaction.tags || []);

      // Trigger async resolution for unresolved custom emoji shortcodes
      if (!customEmojiUrl && this.getEmojiShortcode(content)) {
        this.resolveEmojiUrl(content, reaction.pubkey);
      }

      // NIP-25 reaction removal marker.
      if (!content || content === '-') {
        continue;
      }

      const existingSummary = groupedReactions.get(content);
      if (existingSummary) {
        existingSummary.count += 1;
        existingSummary.userReacted = existingSummary.userReacted || (myPubkey === reaction.pubkey);
        if (!existingSummary.customEmojiUrl && customEmojiUrl) {
          existingSummary.customEmojiUrl = customEmojiUrl;
        }
        if (!existingSummary.emojiSetAddress && emojiSetAddress) {
          existingSummary.emojiSetAddress = emojiSetAddress;
        }
      } else {
        groupedReactions.set(content, {
          content,
          count: 1,
          userReacted: myPubkey === reaction.pubkey,
          customEmojiUrl,
          emojiSetAddress,
        });
      }
    }

    return Array.from(groupedReactions.values()).sort((a, b) => b.count - a.count);
  }

  async openReactionPickerDialog(message: DirectMessage): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../../components/emoji-picker/emoji-picker-dialog.component');
    const isHandset = this.layout.isHandset();
    const dialogRef = this.customDialog.open<typeof EmojiPickerDialogComponent.prototype, string>(EmojiPickerDialogComponent, {
      title: 'React',
      width: isHandset ? '400px' : '360px',
      panelClass: isHandset ? 'emoji-picker-dialog' : ['emoji-picker-menu', 'desktop-reaction-picker-dialog'],
      data: { mode: 'reaction', allowPreferredReactionShortcut: true },
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        void this.sendReaction(message, result);
      }
    });
  }

  async sendReaction(message: DirectMessage, reactionContent: string, customEmojiUrl?: string): Promise<void> {
    const reaction = reactionContent.trim();
    if (!reaction) {
      return;
    }

    if (this.isReactionMessage(message) || message.isOutgoing) {
      return;
    }

    const selectedChat = this.selectedChat();
    const myPubkey = this.accountState.pubkey();
    if (!selectedChat || !myPubkey) {
      return;
    }

    const chatId = selectedChat.id;
    const isGroup = !!selectedChat.isGroup;

    try {
      const extraRumorTags: string[][] = [
        ['e', message.id],
        ['k', String(kinds.PrivateDirectMessage)],
      ];

      const shortcode = this.getEmojiShortcode(reaction);
      if (shortcode) {
        // If URL not provided, resolve from user's emoji sets
        let emojiUrl = customEmojiUrl;
        if (!emojiUrl) {
          try {
            const userEmojis = await this.emojiSetService.getUserEmojiSets(myPubkey);
            emojiUrl = userEmojis.get(shortcode);
          } catch {
            // Ignore - emoji URL won't be attached
          }
        }
        if (emojiUrl) {
          extraRumorTags.push(['emoji', shortcode, emojiUrl]);
        }
      }

      let result: { message: DirectMessage; publish: () => Promise<{ success: boolean; failureReason?: string }> };

      if (isGroup && selectedChat.participants) {
        // Ensure DM relays for all participants
        for (const p of selectedChat.participants) {
          await this.userRelayService.ensureRelaysForPubkey(p);
        }

        result = await this.createNip44GroupMessage(
          reaction,
          selectedChat.participants,
          myPubkey,
          undefined,
          undefined,
          {
            rumorKind: kinds.Reaction,
            extraRumorTags,
            eventKind: 'reaction',
            reactionTo: message.id,
            reactionContent: reaction,
          }
        );
      } else {
        const receiverPubkey = selectedChat.pubkey;
        if (!receiverPubkey) return;

        await this.userRelayService.ensureRelaysForPubkey(receiverPubkey);

        result = await this.createNip44Message(
          reaction,
          receiverPubkey,
          myPubkey,
          undefined,
          {
            rumorKind: kinds.Reaction,
            extraRumorTags,
            eventKind: 'reaction',
            reactionTo: message.id,
            reactionContent: reaction,
          }
        );
      }

      this.messaging.addMessageToChat(chatId, {
        ...result.message,
        pending: true,
      }, isGroup ? {
        isGroup: true,
        participants: selectedChat.participants || [],
        subject: selectedChat.subject,
        subjectUpdatedAt: selectedChat.subjectUpdatedAt,
      } : undefined);

      result.publish().then(publishResult => {
        if (publishResult.success) {
          this.trackReactionUsage(reaction, customEmojiUrl);
          this.messaging.updateMessageInChat(chatId, result.message.id, {
            pending: false,
            received: true,
            failed: false,
          });
        } else {
          this.messaging.removeMessageFromChat(chatId, result.message.id);
          this.snackBar.open(publishResult.failureReason || 'Failed to send reaction', 'Close', { duration: 3000 });
        }
      }).catch(err => {
        this.messaging.removeMessageFromChat(chatId, result.message.id);
        this.logger.error('Failed to publish DM reaction', err);
        this.snackBar.open('Failed to send reaction', 'Close', { duration: 3000 });
      });
    } catch (error) {
      this.logger.error('Failed to prepare DM reaction', error);
      this.snackBar.open('Failed to send reaction', 'Close', { duration: 3000 });
    }
  }

  private trackReactionUsage(emoji: string, url?: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    this.accountLocalState.addRecentEmoji(pubkey, emoji, url);
    this.recentReactionEmojis.set(this.accountLocalState.getRecentEmojis(pubkey));
  }

  private getReactionTargetFromTags(tags: string[][]): string | undefined {
    const eTag = tags.find(tag => tag[0] === 'e');
    return eTag?.[1];
  }

  /**
   * Handle touch start on message bubble (for long press detection)
   */
  onMessageTouchStart(event: TouchEvent, message: DirectMessage): void {
    // Clear any existing timeout
    this.onMessageTouchEnd();

    // Start the long press timer
    this.longPressTimeout = setTimeout(() => {
      this.haptics.triggerMedium();

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
   * Handle right-click context menu on desktop.
   * On desktop, allow the native browser context menu so users can copy text.
   * On touch devices, the long-press handler (onMessageTouchStart) handles the custom menu.
   */
  onMessageContextMenu(event: MouseEvent, message: DirectMessage): void {
    // Only intercept for touch-originated context menus (long-press).
    // Regular mouse right-clicks should pass through to the native context menu
    // so users can select/copy text normally.
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

  async showMessageDetails(message: DirectMessage): Promise<void> {
    try {
      const detailsData = await this.buildMessageDetailsData(message);
      const { MessageDetailsDialogComponent } = await import(
        '../../components/message-details-dialog/message-details-dialog.component'
      );

      this.customDialog.open<typeof MessageDetailsDialogComponent.prototype, void>(
        MessageDetailsDialogComponent,
        {
          title: 'Message Details',
          width: '760px',
          maxWidth: '95vw',
          data: detailsData,
        }
      );
    } catch (error) {
      this.logger.error('Failed to open message details:', error);
      this.layout.toast('Failed to load message details', 3000, 'error-snackbar');
    }
  }

  private async buildMessageDetailsData(message: DirectMessage): Promise<MessageDetailsDialogData> {
    await this.database.init();

    let [rawMessageEvent, rawEnvelopeEvent] = await Promise.all([
      this.database.getEvent(message.id),
      message.giftWrapId ? this.database.getEvent(message.giftWrapId) : Promise.resolve(undefined),
    ]);

    if (!rawMessageEvent) {
      rawMessageEvent = await this.fetchEventByIdFromRelays(message.id, message);
    }

    if (message.giftWrapId && !rawEnvelopeEvent) {
      rawEnvelopeEvent = await this.fetchEventByIdFromRelays(message.giftWrapId, message);
    }

    const relaySources = await this.resolveMessageRelaySources(message);
    const rawMessageJson = JSON.stringify(rawMessageEvent || this.createFallbackMessageJson(message), null, 2);
    const unwrapStages = await this.buildGiftWrapUnwrapStages(message, rawMessageEvent, rawEnvelopeEvent);

    return {
      eventId: message.id,
      giftWrapId: message.giftWrapId,
      chatPubkey: this.selectedChat()?.pubkey || message.pubkey,
      relaySources,
      rawMessageJson,
      rawEnvelopeJson: rawEnvelopeEvent ? JSON.stringify(rawEnvelopeEvent, null, 2) : undefined,
      unwrapStages,
    };
  }

  private async buildGiftWrapUnwrapStages(
    message: DirectMessage,
    rawMessageEvent: NostrEvent | undefined,
    rawEnvelopeEvent: NostrEvent | undefined
  ): Promise<MessageDetailsDialogData['unwrapStages']> {
    const unwrapStages: NonNullable<MessageDetailsDialogData['unwrapStages']> = [];

    if (rawMessageEvent) {
      unwrapStages.push({
        title: `Original Event JSON (message.id: ${message.id})`,
        json: JSON.stringify(rawMessageEvent, null, 2),
      });
    }

    if (message.giftWrapId) {
      if (rawEnvelopeEvent) {
        unwrapStages.push({
          title: `Original Gift Wrap JSON (giftWrapId: ${message.giftWrapId})`,
          json: JSON.stringify(rawEnvelopeEvent, null, 2),
        });
      } else {
        unwrapStages.push({
          title: `Original Gift Wrap JSON (giftWrapId: ${message.giftWrapId})`,
          error: 'Gift wrap event not found in local cache or queried relays',
        });
      }
    }

    const giftWrapSourceEvent =
      (rawEnvelopeEvent?.kind === kinds.GiftWrap ? rawEnvelopeEvent : undefined)
      || (rawMessageEvent?.kind === kinds.GiftWrap ? rawMessageEvent : undefined);

    if (!giftWrapSourceEvent) {
      if (rawMessageEvent?.kind === kinds.EncryptedDirectMessage) {
        const nip04Stages = await this.tryDecryptNip04Event(rawMessageEvent);
        unwrapStages.push(...nip04Stages);
      }
      return unwrapStages;
    }

    let wrappedContent: unknown;
    try {
      const firstDecrypt = await this.encryption.autoDecrypt(
        giftWrapSourceEvent.content,
        giftWrapSourceEvent.pubkey,
        giftWrapSourceEvent,
        giftWrapSourceEvent.created_at
      );

      wrappedContent = JSON.parse(firstDecrypt.content);
      unwrapStages.push({
        title: `Stage 1: Decrypted Gift Wrap Content (${giftWrapSourceEvent.id})`,
        json: JSON.stringify(wrappedContent, null, 2),
      });
    } catch (error) {
      unwrapStages.push({
        title: `Stage 1: Decrypted Gift Wrap Content (${giftWrapSourceEvent.id})`,
        error: error instanceof Error ? error.message : String(error),
      });
      return unwrapStages;
    }

    const wrappedContentObj = wrappedContent as { content?: string; pubkey?: string };
    if (typeof wrappedContentObj.content !== 'string' || typeof wrappedContentObj.pubkey !== 'string') {
      unwrapStages.push({
        title: 'Stage 2: Decrypted Seal Content',
        error: 'Wrapped content does not contain expected encrypted seal fields',
      });
      return unwrapStages;
    }

    try {
      const secondDecrypt = await this.encryption.autoDecrypt(
        wrappedContentObj.content,
        wrappedContentObj.pubkey,
        giftWrapSourceEvent,
        giftWrapSourceEvent.created_at
      );

      unwrapStages.push({
        title: 'Stage 2: Decrypted Seal Content (Raw)',
        json: secondDecrypt.content,
      });

      try {
        const parsedSecondStage = JSON.parse(secondDecrypt.content);
        unwrapStages.push({
          title: 'Stage 3: Parsed Inner Event JSON',
          json: JSON.stringify(parsedSecondStage, null, 2),
        });

      } catch (parseError) {
        unwrapStages.push({
          title: 'Stage 3: Parsed Inner Event JSON',
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    } catch (error) {
      unwrapStages.push({
        title: 'Stage 2: Decrypted Seal Content',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return unwrapStages;
  }

  private async tryDecryptNip04Event(event: NostrEvent): Promise<NonNullable<MessageDetailsDialogData['unwrapStages']>> {
    const stages: NonNullable<MessageDetailsDialogData['unwrapStages']> = [];
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      return stages;
    }

    const pTags = this.utilities.getPTagsValuesFromEvent(event);
    let decryptionPubkey = event.pubkey;
    if (decryptionPubkey === myPubkey && pTags.length > 0 && pTags[0]) {
      decryptionPubkey = pTags[0];
    }

    try {
      const decryptResult = await this.encryption.autoDecrypt(
        event.content,
        decryptionPubkey,
        event,
        event.created_at
      );

      stages.push({
        title: `Decrypted Ciphertext Content (${event.id})`,
        json: decryptResult.content,
      });

      try {
        const parsed = JSON.parse(decryptResult.content);
        stages.push({
          title: `Parsed Decrypted JSON (${event.id})`,
          json: JSON.stringify(parsed, null, 2),
        });
      } catch {
        // No-op if decrypted payload is not JSON.
      }
    } catch (error) {
      this.logger.error('Message details: failed to decrypt NIP-04 content', {
        eventId: event.id,
        eventKind: event.kind,
        decryptionPubkey,
        authorPubkey: event.pubkey,
        contentLength: event.content?.length || 0,
        error,
      });
      stages.push({
        title: `Decrypted Ciphertext Content (${event.id})`,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return stages;
  }

  private getCandidateRelaysForMessage(message: DirectMessage): string[] {
    const chatPubkey = this.selectedChat()?.pubkey || message.pubkey;
    const chatRelays = this.selectedChat()?.relays || [];
    const userRelays = chatPubkey ? this.userRelayService.getRelaysForPubkey(chatPubkey) : [];

    return [
      ...new Set([
        ...this.accountRelay.getRelayUrls(),
        ...chatRelays,
        ...userRelays,
      ]),
    ]
      .filter(url => typeof url === 'string' && url.length > 0)
      .slice(0, 20);
  }

  private async fetchEventByIdFromRelays(eventId: string, message: DirectMessage): Promise<NostrEvent | undefined> {
    const candidateRelays = this.getCandidateRelaysForMessage(message);
    if (candidateRelays.length === 0) {
      return undefined;
    }

    try {
      const events = await this.relayPool.query(candidateRelays, { ids: [eventId] }, 4500);
      const exact = events.find(event => event.id === eventId);
      return exact;
    } catch {
      return undefined;
    }
  }

  private createFallbackMessageJson(message: DirectMessage): NostrEvent {
    return {
      id: message.id,
      pubkey: message.pubkey,
      created_at: message.created_at,
      kind: message.encryptionType === 'nip44' ? kinds.GiftWrap : kinds.EncryptedDirectMessage,
      tags: message.tags,
      content: message.content,
      sig: '',
    } as NostrEvent;
  }

  private async resolveMessageRelaySources(message: DirectMessage): Promise<string[]> {
    const candidateRelays = this.getCandidateRelaysForMessage(message);

    if (candidateRelays.length === 0) {
      return [];
    }

    const eventIdsToQuery = [message.id, message.giftWrapId].filter(
      (value): value is string => !!value
    );

    const relayChecks = candidateRelays.map(async relayUrl => {
      try {
        const events = await this.relayPool.query([
          relayUrl,
        ], {
          ids: eventIdsToQuery,
        }, 3500);

        const found = events.some(event => eventIdsToQuery.includes(event.id));
        return found ? relayUrl : null;
      } catch {
        return null;
      }
    });

    const resolvedRelays = await Promise.all(relayChecks);
    return resolvedRelays.filter((relayUrl): relayUrl is string => !!relayUrl);
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

  private imageUrlRegex = /(https?:\/\/[^\s##]+\.(jpe?g|png|gif|webp|avif)(\?[^\s##]*)?)/gi;

  getMessageImageUrls(message: DirectMessage): string[] {
    if (!message.content) return [];
    this.imageUrlRegex.lastIndex = 0;
    const urls: string[] = [];
    let match;
    while ((match = this.imageUrlRegex.exec(message.content)) !== null) {
      urls.push(match[0]);
    }
    return [...new Set(urls)];
  }

  async openSaveMessageToGifsDialog(message: DirectMessage): Promise<void> {
    const urls = this.getMessageImageUrls(message);
    if (urls.length === 0) return;

    const { SaveToGifsDialogComponent } = await import('../../components/save-to-gifs-dialog/save-to-gifs-dialog.component');
    type SaveToGifsDialogData = import('../../components/save-to-gifs-dialog/save-to-gifs-dialog.component').SaveToGifsDialogData;

    this.dialog.open(SaveToGifsDialogComponent, {
      data: { imageUrls: urls } as SaveToGifsDialogData,
      width: '450px',
      panelClass: 'responsive-dialog',
    });
  }

  /**
   * Start a new chat with a user or group
   */
  startNewChat(): void {
    const dialogRef = this.customDialog.open<StartChatDialogComponent, StartChatDialogResult | undefined>(
      StartChatDialogComponent,
      {
        title: 'New Conversation',
        width: '500px',
        maxWidth: '90vw',
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        const chatResult = result as StartChatDialogResult;
        if (chatResult.isGroup && chatResult.participants) {
          this.startGroupChatWithUsers(chatResult.participants, chatResult.subject);
        } else {
          this.startChatWithUser(chatResult.pubkey, chatResult.isLegacy);
        }
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
        const forwardingOptions = this.getForwardingMessageOptions(message);
        let successCount = 0;
        let failCount = 0;

        for (const pubkey of pubkeys) {
          try {
            await this.messaging.sendDirectMessage(message.content, pubkey, forwardingOptions);
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

  private getForwardingMessageOptions(message: DirectMessage): {
    rumorKind?: number;
    extraRumorTags?: string[][];
  } {
    const extraRumorTags = message.tags
      .filter(tag => tag[0] !== 'p' && tag[0] !== 'e')
      .map(tag => [...tag]);

    return {
      rumorKind: message.rumorKind,
      extraRumorTags,
    };
  }

  /**
   * Reset messages cache - clears all decrypted messages from IndexedDB
   */
  chatWidgetEnabled = computed(() => this.localSettings.settings().chatWidgetEnabled !== false);

  toggleChatWidget(): void {
    const current = this.localSettings.settings().chatWidgetEnabled !== false;
    this.localSettings.updateSettings({ chatWidgetEnabled: !current });
  }

  async toggleMessageNotificationSounds(): Promise<void> {
    const currentlyEnabled = this.settingsService.settings().messageNotificationSoundsEnabled !== false;
    const nextEnabled = !currentlyEnabled;

    try {
      await this.settingsService.updateSettings({ messageNotificationSoundsEnabled: nextEnabled });
      this.snackBar.open(nextEnabled ? 'Message sounds enabled' : 'Message sounds disabled', 'Close', { duration: 2500 });
    } catch (error) {
      this.logger.error('Failed to update message sound setting:', error);
      this.snackBar.open('Failed to update message sound setting', 'Close', { duration: 3000 });
    }
  }

  async resetLocalMessagesCache(): Promise<void> {
    try {
      // Clear any pending bunker operations first
      this.encryption.clearBunkerQueue();

      await this.database.init();
      await this.database.clearAllMessages();

      // Clear in-memory chats but keep dead-letter IDs for spam/deleted message resync safety
      this.messaging.clearForResyncPreserveDeadLetter();

      // Reset the messages last check timestamp so we fetch all messages again
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setMessagesLastCheck(pubkey, 0);
      }

      // Clear selection
      this.selectedChatId.set(null);
      this.restoreDraftForChat(null);
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

  private isUnknownProfile(pubkey: string): boolean {
    const profile = this.data.getCachedProfile(pubkey);
    if (!profile?.data) {
      return true;
    }

    const hasDisplayName = !!profile.data.display_name?.trim();
    const hasName = !!profile.data.name?.trim();
    const nip05Value = profile.data.nip05;
    const hasNip05 = Array.isArray(nip05Value)
      ? nip05Value.some(value => !!value?.trim())
      : !!nip05Value?.trim();

    return !hasDisplayName && !hasName && !hasNip05;
  }

  private isPurgeCandidateChat(chat: Chat): boolean {
    const myPubkey = this.accountState.pubkey();
    if (chat.pubkey === myPubkey) {
      return false;
    }

    const followingSet = new Set(this.accountState.followingList());
    if (followingSet.has(chat.pubkey)) {
      return false;
    }

    // Only purge chats where user has never replied
    const hasOutgoingReply = Array.from(chat.messages.values()).some(message => message.isOutgoing === true);
    if (hasOutgoingReply) {
      return false;
    }

    return this.isUnknownProfile(chat.pubkey);
  }

  getPurgeInboxCandidatesCount(): number {
    return this.messaging.sortedChats().filter(item => this.isPurgeCandidateChat(item.chat)).length;
  }

  async openManageInbox(): Promise<void> {
    const { ManageInboxDialogComponent } = await import(
      '../../components/manage-inbox-dialog/manage-inbox-dialog.component'
    );

    const dialogRef = this.customDialog.open<typeof ManageInboxDialogComponent.prototype, ManageInboxDialogResult>(
      ManageInboxDialogComponent,
      {
        title: 'Manage Inbox',
        width: '520px',
        maxWidth: '95vw',
        data: {
          purgeCandidatesCount: this.getPurgeInboxCandidatesCount(),
          deadLetterCount: this.messaging.getDeadLetterCount(),
        },
      }
    );

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (!result) {
        return;
      }

      if (result.clearDeadLetterList) {
        await this.clearDeadLetterList();
      }

      if (result.purgeUnknownProfiles) {
        await this.purgeMessagesFromUnknownProfiles();
      }
    });
  }

  async clearDeadLetterList(): Promise<void> {
    try {
      await this.messaging.clearDeadLetterList();
      this.layout.toast('Dead-letter list cleared');
    } catch (error) {
      this.logger.error('Failed to clear dead-letter list:', error);
      this.layout.toast('Failed to clear dead-letter list', 3000, 'error-snackbar');
    }
  }

  async purgeMessagesFromUnknownProfiles(): Promise<void> {
    const candidates = this.messaging.sortedChats()
      .map(item => item.chat)
      .filter(chat => this.isPurgeCandidateChat(chat));

    if (candidates.length === 0) {
      this.layout.toast('No purge candidates found');
      return;
    }

    let deletedCount = 0;
    for (const chat of candidates) {
      const success = await this.messaging.deleteChatLocally(chat.id, {
        addToDeadLetter: true,
        deadLetterReason: 'Purged unknown inbox chat',
      });

      if (success) {
        deletedCount++;
      }

      if (this.selectedChatId() === chat.id) {
        this.selectedChatId.set(null);
        this.restoreDraftForChat(null);
      }
    }

    if (deletedCount > 0) {
      this.showMobileList.set(true);
      this.showChatDetails.set(false);
      this.layout.toast(`Purged ${deletedCount} unknown chat${deletedCount === 1 ? '' : 's'}`);
      return;
    }

    this.layout.toast('Failed to purge unknown chats', 3000, 'error-snackbar');
  }

  /**
   * Start a new chat with a specific pubkey (public method for external navigation)
   */
  startChatWithPubkey(pubkey: string): void {
    // Use modern encryption (NIP-44) by default
    this.startChatWithUser(pubkey, false);
  }

  private openChatById(chatId: string): void {
    const existingChat = this.messaging.sortedChats().find(item => item.chat.id === chatId)?.chat;
    if (existingChat) {
      void this.selectChat(existingChat);
      return;
    }

    const mappedChat = this.messaging.getChat(chatId);
    if (mappedChat) {
      void this.selectChat(mappedChat);
      return;
    }

    this.logger.debug('Chat not available yet, waiting for refresh', { chatId });
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
    if (this.showChatDetails()) {
      this.loadLinkPreviews();
    }
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

    const hiddenChatInfoDismissed = this.accountLocalState.getDismissedHiddenChatInfoNotification(pubkey);

    // Add to hidden chats in local state
    this.accountLocalState.hideChat(pubkey, chat.id);

    // Clear selection and go back to list
    this.selectedChatId.set(null);
    this.restoreDraftForChat(null);
    this.showMobileList.set(true);
    this.showChatDetails.set(false);

    if (!hiddenChatInfoDismissed) {
      this.accountLocalState.setDismissedHiddenChatInfoNotification(pubkey, true);
      this.bottomSheet.open(HiddenChatInfoPromptComponent, {
        disableClose: false,
        hasBackdrop: true,
      });
      return;
    }

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
   * Check if a chat is pinned (by chat ID)
   */
  isChatPinned(chatId: string): boolean {
    return this.settingsService.isChatPinned(chatId);
  }

  /**
   * Check if the currently selected chat is pinned
   */
  isSelectedChatPinned(): boolean {
    const chat = this.selectedChat();
    if (!chat) return false;
    return this.settingsService.isChatPinned(chat.id);
  }

  /**
   * Pin the currently selected chat
   */
  async pinChat(): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) return;

    await this.settingsService.pinChat(chat.id);
    this.snackBar.open('Chat pinned', 'Close', { duration: 3000 });
  }

  /**
   * Unpin the currently selected chat
   */
  async unpinChat(): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) return;

    await this.settingsService.unpinChat(chat.id);
    this.snackBar.open('Chat unpinned', 'Close', { duration: 3000 });
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

  /** Check if a URL points to an image */
  isImageLink(url: string): boolean {
    return isImageUrl(url);
  }

  /** Get the OG preview for a URL, only when loaded */
  getLinkPreview(url: string): OpenGraphData | undefined {
    const preview = this.linkPreviews().get(url);
    if (preview && !preview.loading && !preview.error) {
      return preview;
    }
    return undefined;
  }

  /** Load OG previews for visible regular links */
  loadLinkPreviews(): void {
    const links = this.regularLinks();
    const toFetch = links
      .slice(0, 10)
      .filter(link => !this.linkPreviewsLoaded.has(link.url));

    for (const link of toFetch) {
      this.linkPreviewsLoaded.add(link.url);
      this.openGraph.getOpenGraphData(link.url).then(data => {
        this.linkPreviews.update(map => {
          const newMap = new Map(map);
          newMap.set(link.url, data);
          return newMap;
        });
      });
    }
  }

  /**
   * Open URL in new tab
   */
  openUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Open image preview dialog for shared images
   */
  async openImagePreview(index: number, event?: MouseEvent): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const images = this.sharedImages();
    if (images.length === 0) return;

    const { MediaPreviewDialogComponent } = await import('../../components/media-preview-dialog/media-preview.component');

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: images.map(img => ({
          url: img.url,
          type: 'image',
        })),
        initialIndex: index,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
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

  async reportSelectedChatUser(): Promise<void> {
    const chat = this.selectedChat();
    if (!chat || chat.isGroup) {
      // Report/block is not applicable to group chats
      return;
    }

    const pubkey = chat.pubkey;
    const profile = this.data.getCachedProfile(pubkey);
    const displayName = profile?.data.display_name || profile?.data.name || undefined;
    const reportTarget: ReportTarget = {
      type: 'user',
      pubkey,
    };

    const reportResult$ = await this.layout.showReportDialog(reportTarget, displayName);
    reportResult$.subscribe(async (result: ReportDialogResult | null | undefined) => {
      const blockedUserPubkey = result?.blockedUserPubkey;
      if (!blockedUserPubkey) {
        return;
      }

      await this.removeChatsForPubkeyLocally(blockedUserPubkey, {
        hideChat: true,
        deadLetterReason: 'User blocked from report dialog',
        successMessage: 'User blocked and chat removed',
        failureMessage: 'Failed to remove blocked user chat',
      });
    });
  }

  async renameGroupChat(): Promise<void> {
    const selectedChat = this.selectedChat();
    if (!selectedChat?.isGroup || !selectedChat.participants) return;

    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return;

    const dialogRef = this.customDialog.open<RenameChatDialogComponent, string>(RenameChatDialogComponent, {
      title: 'Rename Chat',
      width: '400px',
      data: { currentName: selectedChat.subject || '' },
    });

    dialogRef.afterClosed$.subscribe(({ result: newName }) => {
      if (newName) {
        this.sendSubjectChangeMessage(selectedChat, newName, myPubkey);
      }
    });
  }

  private async sendSubjectChangeMessage(chat: Chat, newSubject: string, myPubkey: string): Promise<void> {
    try {
      const myName = this.getParticipantName(myPubkey);
      const messageText = `${myName} changed chat name to ${newSubject}`;

      // Ensure DM relays for all participants
      const otherParticipants = chat.participants!.filter(p => p !== myPubkey);
      await Promise.all(
        otherParticipants.flatMap(p => [
          this.userRelayService.ensureRelaysForPubkey(p),
          this.userRelayService.ensureDmRelaysForPubkey(p),
        ])
      );

      const result = await this.createNip44GroupMessage(
        messageText,
        chat.participants!,
        myPubkey,
        undefined,
        newSubject,
      );

      const pendingMessage: DirectMessage = {
        ...result.message,
        pending: true,
        received: false,
      };

      this.messaging.addMessageToChat(chat.id, pendingMessage, {
        isGroup: true,
        participants: chat.participants!,
        subject: newSubject,
        subjectUpdatedAt: result.message.created_at,
      });

      this.pendingMessages.update(msgs => [...msgs, pendingMessage]);
      this.scrollToBottom();

      const publishResult = await result.publish();
      if (publishResult.success) {
        this.messaging.updateMessageInChat(chat.id, result.message.id, {
          pending: false,
          received: true,
          failed: false,
          failureReason: undefined,
        });
        this.pendingMessages.update(msgs => msgs.filter(m => m.id !== result.message.id));
        this.snackBar.open(`Chat renamed to "${newSubject}"`, 'Dismiss', { duration: 3000 });
      } else {
        const reason = publishResult.failureReason || 'All relays rejected the message';
        this.messaging.updateMessageInChat(chat.id, result.message.id, {
          pending: false,
          received: false,
          failed: true,
          failureReason: reason,
        });
        this.pendingMessages.update(msgs => msgs.filter(m => m.id !== result.message.id));
        this.snackBar.open('Failed to rename chat', 'Dismiss', { duration: 5000 });
      }
    } catch (err) {
      this.logger.error('Failed to rename group chat', err);
      this.snackBar.open('Failed to rename chat', 'Dismiss', { duration: 5000 });
    }
  }

  async deleteSelectedChat(): Promise<void> {
    await this.removeSelectedChatLocally({
      hideChat: false,
      deadLetterReason: 'Chat deleted by user',
      successMessage: 'Chat deleted',
      failureMessage: 'Failed to delete chat',
    });
  }

  async blockSelectedChatUser(): Promise<void> {
    const chat = this.selectedChat();
    if (chat?.isGroup) {
      // Block is not applicable to group chats (use delete instead)
      return;
    }

    await this.removeSelectedChatLocally({
      hideChat: true,
      deadLetterReason: 'User blocked from messages',
      successMessage: 'User blocked and chat removed',
      failureMessage: 'Failed to block user',
    });
  }

  private async removeSelectedChatLocally(options: {
    hideChat: boolean;
    deadLetterReason: string;
    successMessage: string;
    failureMessage: string;
  }): Promise<void> {
    const chat = this.selectedChat();
    if (!chat) {
      return;
    }

    // For group chats, delete by chatId directly (not by pubkey)
    // since chat.pubkey for groups is just participants[0] and would
    // incorrectly match other chats with the same pubkey.
    if (chat.isGroup) {
      if (options.hideChat) {
        const accountPubkey = this.accountState.pubkey();
        if (accountPubkey) {
          this.accountLocalState.hideChat(accountPubkey, chat.id);
        }
      }

      const success = await this.messaging.deleteChatLocally(chat.id, {
        addToDeadLetter: true,
        deadLetterReason: options.deadLetterReason,
      });

      this.selectedChatId.set(null);
      this.restoreDraftForChat(null);

      if (success) {
        this.showMobileList.set(true);
        this.showChatDetails.set(false);
        this.layout.toast(options.successMessage);
      } else {
        this.layout.toast(options.failureMessage, 3000, 'error-snackbar');
      }
      return;
    }

    await this.removeChatsForPubkeyLocally(chat.pubkey, options);
  }

  private async removeChatsForPubkeyLocally(pubkey: string, options: {
    hideChat: boolean;
    deadLetterReason: string;
    successMessage: string;
    failureMessage: string;
  }): Promise<void> {
    const chatsToDeleteCount = this.messaging
      .sortedChats()
      .filter(item => item.chat.pubkey === pubkey).length;

    if (chatsToDeleteCount === 0) {
      return;
    }

    const result = await this.messaging.deleteChatsForPubkeyLocally(pubkey, {
      addToDeadLetter: true,
      deadLetterReason: options.deadLetterReason,
      hideChat: options.hideChat,
    });

    if (this.selectedChat()?.pubkey === pubkey) {
      this.selectedChatId.set(null);
      this.restoreDraftForChat(null);
    }

    if (result.failedCount === 0) {
      this.showMobileList.set(true);
      this.showChatDetails.set(false);
      this.layout.toast(options.successMessage);
      return;
    }

    this.layout.toast(options.failureMessage, 3000, 'error-snackbar');
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
  ): Promise<{ message: DirectMessage; publish: () => Promise<{ success: boolean; failureReason?: string }> }> {
    try {
      // Encrypt the message using NIP-04
      const encryptedContent = await this.encryption.encryptNip04(messageText, receiverPubkey);
      const receiverRelayHint = await this.getDmRelayHint(receiverPubkey);

      // Build tags
      const tags: string[][] = [['p', receiverPubkey, receiverRelayHint || '']];

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
        rumorKind: kinds.EncryptedDirectMessage,
        pubkey: myPubkey,
        created_at: signedEvent.created_at,
        content: messageText, // Store decrypted content locally
        isOutgoing: true,
        tags: signedEvent.tags,
        replyTo: replyToId,
        encryptionType: 'nip04',
      };

      const publish = async (): Promise<{ success: boolean; failureReason?: string }> => {
        const success = await this.publishToRelays(signedEvent, receiverPubkey);
        if (success) return { success: true };
        return { success: false, failureReason: 'Failed to publish to recipient\'s relays' };
      };

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
    replyToId?: string,
    options?: {
      rumorKind?: number;
      extraRumorTags?: string[][];
      eventKind?: 'message' | 'reaction';
      reactionTo?: string;
      reactionContent?: string;
    }
  ): Promise<{ message: DirectMessage; publish: () => Promise<{ success: boolean; failureReason?: string }> }> {
    try {
      const isNoteToSelf = receiverPubkey === myPubkey;
      const rumorKind = options?.rumorKind ?? kinds.PrivateDirectMessage;
      const [receiverRelayHint, myRelayHint] = await Promise.all([
        this.getDmRelayHint(receiverPubkey),
        isNoteToSelf ? Promise.resolve(undefined) : this.getDmRelayHint(myPubkey),
      ]);

      // Step 1: Create the message (unsigned event) - kind 14
      const tags: string[][] = [['p', receiverPubkey, receiverRelayHint || '']];

      // Add 'e' tag if this is a reply (NIP-17)
      if (replyToId) {
        tags.push(['e', replyToId]);
      }

      if (options?.extraRumorTags?.length) {
        tags.push(...options.extraRumorTags);
      }

      const unsignedMessage = {
        kind: rumorKind,
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
        tags: [['p', receiverPubkey, receiverRelayHint || '']],
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
          tags: [['p', myPubkey, myRelayHint || '']],
          content: giftWrapContent2,
        };

        signedGiftWrap2 = finalizeEvent(giftWrap2, ephemeralKey);
      }

      // Return the message for immediate UI display
      const message: DirectMessage = {
        id: rumorId,
        rumorKind,
        pubkey: myPubkey,
        created_at: unsignedMessage.created_at,
        content: messageText,
        isOutgoing: true,
        tags: unsignedMessage.tags,
        replyTo: replyToId,
        encryptionType: 'nip44',
        eventKind: options?.eventKind ?? 'message',
        reactionTo: options?.reactionTo,
        reactionContent: options?.reactionContent,
      };

      // Return a publish function that handles all relay publishing in the background.
      // Uses kind 10050 DM relays only — discovery relays only accept kind 10002/3.
      // Returns true if at least one relay accepted the recipient's gift wrap.
      const publish = async (): Promise<{ success: boolean; failureReason?: string }> => {
        if (isNoteToSelf) {
          const dmSuccess = await this.publishToUserDmRelays(signedGiftWrap, myPubkey);
          if (!dmSuccess) {
            return { success: false, failureReason: 'Failed to publish to DM relays' };
          }

          return { success: true };
        } else {
          const [recipientSuccess, selfCopySuccess] = await Promise.all([
            this.publishToUserDmRelays(signedGiftWrap, receiverPubkey),
            this.publishToUserDmRelays(signedGiftWrap2!, myPubkey),
          ]);

          if (!selfCopySuccess) {
            this.logger.warn('Self-copy gift wrap failed to publish to own DM relays');
          }

          if (!recipientSuccess) {
            return { success: false, failureReason: 'Failed to deliver to recipient\'s DM relays' };
          }

          return { success: true };
        }
      };

      return { message, publish };
    } catch (error) {
      this.logger.error('Failed to create NIP-44 message', error);
      throw error;
    }
  }

  /**
   * Create a NIP-44 group message (kind 14 rumor with multiple p-tags).
   * Per NIP-17, each participant gets an individually gift-wrapped copy.
   * Returns the message for immediate UI display and a publish function for background delivery.
   */
  private async createNip44GroupMessage(
    messageText: string,
    participants: string[],
    myPubkey: string,
    replyToId?: string,
    subject?: string,
    options?: {
      rumorKind?: number;
      extraRumorTags?: string[][];
      eventKind?: 'message' | 'reaction';
      reactionTo?: string;
      reactionContent?: string;
    }
  ): Promise<{ message: DirectMessage; publish: () => Promise<{ success: boolean; failureReason?: string }> }> {
    try {
      const allParticipants = [...new Set([myPubkey, ...participants])].sort();
      const otherParticipants = allParticipants.filter(p => p !== myPubkey);
      const rumorKind = options?.rumorKind ?? kinds.PrivateDirectMessage;
      const relayHints = new Map<string, string>();
      const relayHintEntries = await Promise.all(
        allParticipants.map(async participantPubkey => [participantPubkey, await this.getDmRelayHint(participantPubkey)] as const)
      );
      for (const [participantPubkey, relayHint] of relayHintEntries) {
        if (relayHint) {
          relayHints.set(participantPubkey, relayHint);
        }
      }

      // Step 1: Create the rumor (unsigned kind 14) with p-tags for all recipients
      const tags: string[][] = otherParticipants.map(p => ['p', p, relayHints.get(p) || '']);

      if (replyToId) {
        tags.push(['e', replyToId]);
      }
      if (subject) {
        tags.push(['subject', subject]);
      }
      if (options?.extraRumorTags?.length) {
        tags.push(...options.extraRumorTags);
      }

      const unsignedMessage = {
        kind: rumorKind,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: messageText,
      };

      const rumorId = getEventHash(unsignedMessage);
      const rumorWithId = { ...unsignedMessage, id: rumorId };
      const rumorJson = JSON.stringify(rumorWithId);

      // Step 2: Pre-create sealed + gift-wrapped copies for each participant
      const giftWraps: { recipientPubkey: string; signedGiftWrap: NostrEvent }[] = [];

      for (const recipientPubkey of allParticipants) {
        // Create the seal - encrypt the rumor for this specific recipient
        const sealedContent = await this.encryption.encryptNip44(rumorJson, recipientPubkey);

        const sealedMessage = {
          kind: kinds.Seal,
          pubkey: myPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [],
          content: sealedContent,
        };

        const signedSeal = await this.nostr.signEvent(sealedMessage);

        // Create gift wrap with ephemeral key
        const ephemeralKey = generateSecretKey();
        const ephemeralPubkey = getPublicKey(ephemeralKey);

        const giftWrapContent = await this.encryption.encryptNip44WithKey(
          JSON.stringify(signedSeal),
          bytesToHex(ephemeralKey),
          recipientPubkey
        );

        const giftWrap = {
          kind: kinds.GiftWrap,
          pubkey: ephemeralPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [['p', recipientPubkey, relayHints.get(recipientPubkey) || '']],
          content: giftWrapContent,
        };

        const signedGiftWrap = finalizeEvent(giftWrap, ephemeralKey);
        giftWraps.push({ recipientPubkey, signedGiftWrap });
      }

      // Return message for immediate UI display
      const message: DirectMessage = {
        id: rumorId,
        rumorKind,
        pubkey: myPubkey,
        created_at: unsignedMessage.created_at,
        content: messageText,
        isOutgoing: true,
        tags: unsignedMessage.tags,
        replyTo: replyToId,
        encryptionType: 'nip44',
        eventKind: options?.eventKind || 'message',
        reactionTo: options?.reactionTo,
        reactionContent: options?.reactionContent,
      };

      // Publish function: sends each gift wrap to the corresponding participant's DM relays
      const publish = async (): Promise<{ success: boolean; failureReason?: string }> => {
        let anySuccess = false;
        const failures: string[] = [];

        for (const { recipientPubkey, signedGiftWrap } of giftWraps) {
          try {
            const success = await this.publishToUserDmRelays(signedGiftWrap, recipientPubkey);

            if (success) {
              anySuccess = true;
            } else if (recipientPubkey !== myPubkey) {
              // Only track failures for other participants, not self-copy
              failures.push(recipientPubkey.substring(0, 8));
            } else {
              this.logger.warn('Group self-copy gift wrap failed to publish to own DM relays');
            }
          } catch (err) {
            this.logger.error(`Failed to publish group gift wrap to ${recipientPubkey.substring(0, 8)}`, err);
            if (recipientPubkey !== myPubkey) {
              failures.push(recipientPubkey.substring(0, 8));
            }
          }
        }

        if (!anySuccess) {
          return { success: false, failureReason: 'Failed to deliver to any participant\'s DM relays' };
        }

        if (failures.length > 0) {
          this.logger.warn(`Group message partially delivered. Failed for: ${failures.join(', ')}`);
        }

        return { success: true };
      };

      return { message, publish };
    } catch (error) {
      this.logger.error('Failed to create NIP-44 group message', error);
      throw error;
    }
  }

  /**
   * Publish an event to multiple relays.
   * Returns true if at least one relay accepted the event.
   */
  private async publishToRelays(event: NostrEvent, pubkey: string): Promise<boolean> {
    return this.publishToUserDmRelays(event, pubkey);
  }

  private async getDmRelayHint(pubkey: string): Promise<string | undefined> {
    const relayUrls = await this.userRelayService.getUserDmRelaysForPublishing(pubkey);
    return relayUrls[0];
  }

  /**
   * Publish a gift-wrapped DM to the recipient's DM relays (NIP-17)
   * Uses kind 10050 relays if available, falls back to regular relays.
   * Returns true if at least one relay accepted the event.
   */
  private async publishToUserDmRelays(event: NostrEvent, pubkey: string): Promise<boolean> {
    try {
      const accepted = await this.userRelayService.publishToDmRelays(pubkey, event);
      return accepted;
    } catch (err) {
      this.logger.error('publishToUserDmRelays failed:', err);
      return false;
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

      // Pre-discover DM relays (kind 10050) for this new contact so sending is fast.
      // This runs in the background — don't block the UI.
      this.userRelayService.ensureDmRelaysForPubkey(pubkey).catch(err => {
        this.logger.warn('Failed to pre-discover DM relays for new chat:', err);
      });

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
   * Start or open a group chat with the given participants.
   * Creates a temporary group chat object and selects it.
   */
  private async startGroupChatWithUsers(participantPubkeys: string[], subject?: string): Promise<void> {
    try {
      const myPubkey = this.accountState.pubkey();
      if (!myPubkey) {
        this.snackBar.open('Please log in first', 'Close', { duration: 3000 });
        return;
      }

      // Include self in the participant list
      const allParticipants = [...new Set([myPubkey, ...participantPubkeys])].sort();
      const chatId = computeGroupChatId(allParticipants);

      this.logger.debug('startGroupChatWithUsers - chatId:', chatId, 'participants:', allParticipants.length);

      // Check if group chat already exists
      const existingChat = this.messaging.getChat(chatId);
      if (existingChat) {
        this.logger.debug('Group chat already exists, selecting it');
        this.selectChat(existingChat);
        return;
      }

      // Pre-discover DM relays for all participants in the background
      const otherParticipants = allParticipants.filter(p => p !== myPubkey);
      for (const pubkey of otherParticipants) {
        this.userRelayService.ensureDmRelaysForPubkey(pubkey).catch(err => {
          this.logger.warn(`Failed to pre-discover DM relays for group member ${pubkey.substring(0, 8)}:`, err);
        });
      }

      // Create a temporary group chat object
      const tempChat: Chat = {
        id: chatId,
        pubkey: '', // For groups, pubkey is empty (use participants instead)
        unreadCount: 0,
        lastMessage: null,
        relays: [],
        encryptionType: 'nip44',
        hasLegacyMessages: false,
        messages: new Map(),
        isGroup: true,
        participants: allParticipants,
        subject,
        subjectUpdatedAt: subject ? Math.floor(Date.now() / 1000) : undefined,
      };

      // Add to messaging service
      this.messaging.addChat(tempChat);

      // Select the group chat
      this.selectChat(tempChat);
    } catch (error) {
      this.logger.error('Error starting group chat:', error);
      this.snackBar.open('Failed to create group', 'Close', { duration: 3000 });
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
