import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { firstValueFrom } from 'rxjs';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { MediaService } from '../../services/media.service';
import { MediaProcessingService } from '../../services/media-processing.service';
import { HapticsService } from '../../services/haptics.service';
import { ZapService } from '../../services/zap.service';
import { ZapSoundService } from '../../services/zap-sound.service';
import { Event as NostrEvent } from 'nostr-tools';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import {
  ChatChannelsService,
  ChatChannel,
  ChannelMessage,
  ChannelMetadata,
  ChannelMetadataUpdate,
  ChatReaction,
} from '../../services/chat-channels.service';
import { ApplicationService } from '../../services/application.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { TrustService } from '../../services/trust.service';
import { ListFilterMenuComponent, ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { PublicChatsListService } from '../../services/public-chats-list.service';
import { DataService } from '../../services/data.service';
import { stripImageProxy } from '../../utils/strip-image-proxy';
import {
  CreateChannelDialogComponent,
  CreateChannelDialogResult,
} from './create-channel-dialog/create-channel-dialog.component';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import {
  ShareArticleDialogComponent,
  type ShareArticleDialogData,
} from '../../components/share-article-dialog/share-article-dialog.component';
import { VideoRecordDialogResult } from '../../interfaces/media-upload';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DeleteEventService } from '../../services/delete-event.service';
import {
  ChatsSettingsDialogComponent,
} from './chats-settings-dialog/chats-settings-dialog.component';

/**
 * Represents a zap receipt shown inline in the chat timeline.
 */
export interface ChatZapEntry {
  id: string;
  senderPubkey: string;
  amount: number;
  comment: string;
  createdAt: number;
}

/**
 * Discriminated union for timeline entries displayed in the chat.
 * Allows interleaving kind 42 messages, kind 41 metadata updates, and zap receipts.
 */
export type TimelineEntry =
  | { type: 'message'; data: ChannelMessage }
  | { type: 'metadata-update'; data: ChannelMetadataUpdate }
  | { type: 'zap'; data: ChatZapEntry };

@Component({
  selector: 'app-chats',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDividerModule,
    RouterModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    MessageContentComponent,
    AgoPipe,
    DatePipe,
    DecimalPipe,
    ListFilterMenuComponent,
    ChatsSettingsDialogComponent,
  ],
  templateUrl: './chats.component.html',
  styleUrl: './chats.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatsComponent implements OnInit, OnDestroy {
  private deleteEventService = inject(DeleteEventService);
  readonly chatChannels = inject(ChatChannelsService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly app = inject(ApplicationService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly trustService = inject(TrustService);
  readonly utilities = inject(UtilitiesService);
  readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly customDialog = inject(CustomDialogService);
  readonly mediaService = inject(MediaService);
  private readonly mediaProcessing = inject(MediaProcessingService);
  private readonly haptics = inject(HapticsService);
  private readonly publicChatsListService = inject(PublicChatsListService);
  private readonly zapService = inject(ZapService);
  private readonly zapSound = inject(ZapSoundService);
  private readonly dataService = inject(DataService);
  private readonly accountRelay = inject(AccountRelayService);

  /** Currently selected channel ID */
  readonly selectedChannelId = signal<string | null>(null);

  /** Show mobile list vs detail toggle */
  readonly showMobileList = signal<boolean>(true);

  /** Search query for filtering channels */
  readonly channelSearchQuery = signal<string>('');

  /** Show search input */
  readonly showSearch = signal<boolean>(false);

  /** New message text for the input area */
  readonly newMessageText = signal<string>('');

  /** Whether we're sending a message */
  readonly isSending = signal<boolean>(false);

  /** Scroll to latest button visibility */
  readonly showScrollToLatestButton = signal<boolean>(false);

  /** Message being replied to */
  readonly replyingToMessage = signal<ChannelMessage | null>(null);

  /** Whether the chat details panel is open */
  readonly showChatDetails = signal<boolean>(false);

  /** Whether the manage channel panel is open */
  readonly showManagePanel = signal<boolean>(false);

  /** Migration result message */
  readonly migrationResult = signal<string>('');

  /** Whether a media file is currently uploading */
  readonly isUploading = signal<boolean>(false);

  /** Upload status text */
  readonly uploadStatus = signal<string>('');

  /** Media previews for the current message */
  readonly mediaPreviews = signal<{ url: string; type: 'image' | 'video' | 'music'; label?: string }[]>([]);

  /** Pending extra tags (e.g. imeta with waveform) for the next message */
  readonly pendingTags = signal<string[][]>([]);

  /** Zap receipts for the current channel */
  readonly channelZaps = signal<ChatZapEntry[]>([]);

  /** Whether to show the zap celebration animation */
  readonly showZapCelebration = signal<{ amount: number; senderPubkey: string } | null>(null);

  /** Whether the chats settings dialog is open */
  readonly showSettingsDialog = signal(false);

  /** Unsubscribe function for the current zap subscription */
  private zapUnsubscribe: (() => void) | null = null;

  /** Set of seen zap receipt IDs to prevent duplicates */
  private seenZapIds = new Set<string>();

  /** People list filter state — defaults to 'all' for anonymous users since they have no following list */
  readonly selectedListFilter = signal<string>(this.app.authenticated() ? 'following' : 'all');

  /** URL-based initial list filter */
  readonly urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);

  /** Whether the "Show more" section is expanded */
  readonly showMoreChannels = signal<boolean>(false);

  /** Long-press support for touch devices */
  readonly longPressedMessageId = signal<string | null>(null);
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly LONG_PRESS_DURATION = 500;

  /** Whether user is authenticated */
  readonly isAuthenticated = computed(() => this.app.authenticated());

  /** Single-pane view computed */
  readonly isSinglePaneView = computed(() => this.layout.isHandset() || this.layout.hasNavigationItems());

  /** Loading state from service */
  readonly isLoading = computed(() => this.chatChannels.isLoading());

  /** Loading messages state from service */
  readonly isLoadingMessages = computed(() => this.chatChannels.isLoadingMessages());

  /** Whether trust provider is enabled */
  readonly trustEnabled = computed(() => this.trustService.isEnabled());

  /** Pubkeys to filter channels by based on current list filter selection */
  private readonly filterPubkeys = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === 'all') {
      return null; // No filtering
    }
    // For anonymous users, skip any people-based filtering since there's no following list
    if (!this.app.authenticated()) {
      return null;
    }
    if (filter === 'wot') {
      return 'wot' as const; // Special marker for WoT filtering
    }
    if (filter === 'following') {
      return this.accountState.followingList();
    }
    // Filter by a specific follow set
    const followSet = this.followSetsService.followSets().find(s => s.dTag === filter);
    return followSet?.pubkeys || [];
  });

  /** All channels from service, filtered by search query and list filter */
  readonly channels = computed(() => {
    const query = this.channelSearchQuery().toLowerCase();
    const allChannels = this.chatChannels.channels();
    const pubkeys = this.filterPubkeys();
    const pinnedSet = this.publicChatsListService.channelIdSet();

    let filtered = allChannels;

    // Apply list filter
    if (pubkeys === 'wot') {
      filtered = filtered.filter(ch => {
        const rank = this.trustService.getRankSignal(ch.creator);
        return typeof rank === 'number' && rank > 0;
      });
    } else if (pubkeys !== null) {
      const pubkeySet = new Set(pubkeys);
      filtered = filtered.filter(ch => pubkeySet.has(ch.creator));
    }

    // Apply search query
    if (query) {
      filtered = filtered.filter(
        ch =>
          ch.metadata.name.toLowerCase().includes(query) ||
          ch.metadata.about.toLowerCase().includes(query) ||
          ch.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    // Sort pinned channels to top
    return filtered.sort((a, b) => {
      const aPinned = pinnedSet.has(a.id) ? 1 : 0;
      const bPinned = pinnedSet.has(b.id) ? 1 : 0;
      return bPinned - aPinned;
    });
  });

  /** All channels from service (unfiltered by list filter, but filtered by search query) */
  private readonly allSearchFilteredChannels = computed(() => {
    const query = this.channelSearchQuery().toLowerCase();
    const allChannels = this.chatChannels.channels();
    if (!query) return allChannels;
    return allChannels.filter(
      ch =>
        ch.metadata.name.toLowerCase().includes(query) ||
        ch.metadata.about.toLowerCase().includes(query) ||
        ch.tags.some(t => t.toLowerCase().includes(query))
    );
  });

  /** Channels the user has participated in (sent messages to) — NOT filtered by list filter */
  readonly participatedChannels = computed(() => {
    const participated = this.chatChannels.participatedChannelIds();
    if (participated.size === 0) return [];
    const pinnedSet = this.publicChatsListService.channelIdSet();
    return this.allSearchFilteredChannels().filter(ch => participated.has(ch.id))
      .sort((a, b) => {
        const aPinned = pinnedSet.has(a.id) ? 1 : 0;
        const bPinned = pinnedSet.has(b.id) ? 1 : 0;
        return bPinned - aPinned;
      });
  });

  /** Channels the user has NOT participated in, from the list-filtered set */
  readonly discoveredChannels = computed(() => {
    const participated = this.chatChannels.participatedChannelIds();
    if (participated.size === 0) return this.channels();
    const pinnedSet = this.publicChatsListService.channelIdSet();
    return this.channels().filter(ch => !participated.has(ch.id))
      .sort((a, b) => {
        const aPinned = pinnedSet.has(a.id) ? 1 : 0;
        const bPinned = pinnedSet.has(b.id) ? 1 : 0;
        return bPinned - aPinned;
      });
  });

  /** Selected channel */
  readonly selectedChannel = computed(() => {
    const id = this.selectedChannelId();
    if (!id) return null;
    return this.chatChannels.getChannel(id) ?? null;
  });

  /** Messages for the selected channel */
  readonly currentMessages = computed(() => {
    const id = this.selectedChannelId();
    if (!id) return [];
    return this.chatChannels.getChannelMessages(id)();
  });

  /** Combined timeline of messages, metadata updates, and zaps, sorted chronologically */
  readonly currentTimeline = computed((): TimelineEntry[] => {
    const messages = this.currentMessages();
    const channel = this.selectedChannel();
    const zaps = this.channelZaps();

    const entries: TimelineEntry[] = messages.map(m => ({ type: 'message' as const, data: m }));

    // Interleave kind 41 metadata updates if available
    if (channel?.metadataUpdates?.length) {
      for (const update of channel.metadataUpdates) {
        entries.push({ type: 'metadata-update' as const, data: update });
      }
    }

    // Interleave zap receipts
    for (const zap of zaps) {
      entries.push({ type: 'zap' as const, data: zap });
    }

    // Sort by timestamp (ascending)
    entries.sort((a, b) => a.data.createdAt - b.data.createdAt);

    return entries;
  });

  /** Current user pubkey */
  readonly currentPubkey = computed(() => this.accountState.pubkey());

  /** Quick reactions for the picker */
  readonly quickReactions = this.chatChannels.quickReactions;

  /** Whether current user is the creator of the selected channel */
  readonly isChannelCreator = computed(() => {
    const channel = this.selectedChannel();
    const pubkey = this.currentPubkey();
    return !!channel && !!pubkey && channel.creator === pubkey;
  });

  /** Whether selected channel has a kind 41 metadata update */
  readonly hasMetadataUpdate = computed(() => {
    const channel = this.selectedChannel();
    return !!channel && channel.updatedAt > channel.createdAt;
  });

  /** Unique participant pubkeys from current messages */
  readonly chatParticipants = computed(() => {
    const messages = this.currentMessages();
    const seen = new Set<string>();
    const participants: string[] = [];
    for (const msg of messages) {
      if (!seen.has(msg.pubkey)) {
        seen.add(msg.pubkey);
        participants.push(msg.pubkey);
      }
    }
    return participants;
  });

  /** Image URLs extracted from message content */
  readonly sharedImages = computed(() => {
    const messages = this.currentMessages();
    const images: string[] = [];
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i;
    for (const msg of messages) {
      const urls = msg.content.match(/https?:\/\/[^\s]+/g) ?? [];
      for (const url of urls) {
        if (imageExtensions.test(url)) {
          images.push(url);
        }
      }
    }
    return images;
  });

  /** Video URLs extracted from message content */
  readonly sharedVideos = computed(() => {
    const messages = this.currentMessages();
    const videos: string[] = [];
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)(\?[^\s]*)?$/i;
    for (const msg of messages) {
      const urls = msg.content.match(/https?:\/\/[^\s]+/g) ?? [];
      for (const url of urls) {
        if (videoExtensions.test(url)) {
          videos.push(url);
        }
      }
    }
    return videos;
  });

  /** Muted user pubkeys scoped to the selected channel (for the manage panel) */
  readonly mutedUsersList = computed(() => {
    const id = this.selectedChannelId();
    if (!id) return [];
    return this.chatChannels.getMutedUserPubkeysForChannel(id);
  });

  /** Hidden message IDs scoped to the selected channel (for the manage panel) */
  readonly hiddenMessagesList = computed(() => {
    const id = this.selectedChannelId();
    if (!id) return [];
    return this.chatChannels.getHiddenMessageIdsForChannel(id);
  });

  @ViewChild('messagesWrapper', { static: false })
  messagesWrapper?: ElementRef<HTMLDivElement>;

  @ViewChild('messageInput', { static: false })
  messageInput?: ElementRef<HTMLTextAreaElement>;

  @ViewChild('mediaFileInput', { static: false })
  mediaFileInput?: ElementRef<HTMLInputElement>;

  private scrollThrottleTimeout: ReturnType<typeof setTimeout> | null = null;
  private userScrolledUp = false;
  private lastScrollHeight = 0;

  constructor() {
    // Sync mobile nav with channel selection
    effect(() => {
      const channelId = this.selectedChannelId();
      const isSinglePane = this.isSinglePaneView();
      const showingMobileList = this.showMobileList();

      if (isSinglePane) {
        this.layout.hideMobileNav.set(channelId !== null && !showingMobileList);
      }
    });

    // Scroll to bottom when a new channel is selected
    effect(() => {
      const channelId = this.selectedChannelId();
      if (channelId) {
        untracked(() => {
          setTimeout(() => {
            this.scrollToBottom();
          }, 100);
        });
      }
    });

    // Scroll to bottom on new messages
    effect(() => {
      const messages = this.currentMessages();
      if (messages.length > 0) {
        untracked(() => {
          this.scrollToBottomIfNotScrolledUp();
        });
      }
    });
  }

  ngOnInit(): void {
    // Ensure pinned chats list is loaded from DB before rendering channels.
    // This prevents the flash where all channels appear unsorted before
    // the pinned set is available.
    const pinnedReady = this.publicChatsListService.initialized()
      ? Promise.resolve()
      : this.publicChatsListService.initialize();

    pinnedReady.then(() => {
      // Load cached channels first for instant display, then fetch from relays
      this.chatChannels.loadChannelsFromCache().then(() => {
        this.chatChannels.load().then(() => {
          this.chatChannels.subscribeToChannels();

          // After loading channels, refresh metadata (kind 41) from all sources
          // including channel-specific relays, to pick up any metadata changes
          this.chatChannels.refreshChannelMetadata();
        });
      });
    });

    // Load participated channels for the current user
    this.chatChannels.loadParticipatedChannels();

    // Check route params for a channel ID (nevent-encoded or hex)
    this.route.params.subscribe(params => {
      const id = params['id'];
      if (id) {
        const decoded = this.decodeChannelParam(id);
        if (decoded) {
          this.selectChannelById(decoded.id, decoded.relays);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.layout.hideMobileNav.set(false);
    this.chatChannels.closeChannelSubscription();
    this.chatChannels.closeMessageSubscription();
    this.chatChannels.closeReactionSubscription();
    this.cleanupZapSubscription();

    if (this.scrollThrottleTimeout) {
      clearTimeout(this.scrollThrottleTimeout);
      this.scrollThrottleTimeout = null;
    }
  }

  /** Select a channel from the list */
  async selectChannel(channel: ChatChannel): Promise<void> {
    this.selectedChannelId.set(channel.id);
    this.showMobileList.set(false);
    this.replyingToMessage.set(null);
    this.newMessageText.set('');
    this.showChatDetails.set(false);
    this.showManagePanel.set(false);
    this.mediaPreviews.set([]);
    this.migrationResult.set('');

    // Update URL to reflect selected channel
    const nevent = this.encodeChannelNevent(channel);
    this.router.navigate(['/chats', nevent], { replaceUrl: false });

    // Load messages and subscribe
    await this.chatChannels.loadChannelMessages(channel.id);
    this.chatChannels.subscribeToChannelMessages(channel.id);

    // Subscribe to zap receipts for this channel
    this.subscribeToChannelZaps(channel.id);

    // Set up scroll listener
    setTimeout(() => this.setupScrollListener(), 100);
  }

  /** Select a channel by ID (from route), with optional relay hints from nevent */
  async selectChannelById(channelId: string, relayHints: string[] = []): Promise<void> {
    const channel = this.chatChannels.getChannel(channelId);
    if (channel) {
      await this.selectChannel(channel);
    } else {
      // Channel not yet loaded - try fetching from relay hints first
      this.selectedChannelId.set(channelId);
      this.showMobileList.set(false);
      this.migrationResult.set('');

      if (relayHints.length > 0) {
        await this.chatChannels.fetchChannelFromRelays(relayHints, channelId);
      }

      await this.chatChannels.loadChannelMessages(channelId);
      this.chatChannels.subscribeToChannelMessages(channelId);
      this.subscribeToChannelZaps(channelId);
      setTimeout(() => this.setupScrollListener(), 100);
    }
  }

  /** Back to channel list (mobile) */
  backToList(): void {
    this.showMobileList.set(true);
    this.selectedChannelId.set(null);
    this.chatChannels.closeMessageSubscription();
    this.cleanupZapSubscription();
    this.router.navigate(['/chats']);
  }

  /** Toggle search */
  toggleSearch(): void {
    this.showSearch.update(v => !v);
    if (!this.showSearch()) {
      this.channelSearchQuery.set('');
    }
  }

  /** Toggle show more channels */
  toggleShowMore(): void {
    this.showMoreChannels.update(v => !v);
  }

  /** Handle filter change from ListFilterMenuComponent */
  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
    this.showMoreChannels.set(false);

    // Update URL with list param or clear it
    if (filter !== 'following') {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { list: filter },
        queryParamsHandling: 'merge',
      });
    } else {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        queryParamsHandling: '',
      });
    }
  }

  /** Open create channel dialog */
  openCreateChannel(): void {
    const dialogRef = this.customDialog.open<CreateChannelDialogComponent, CreateChannelDialogResult>(CreateChannelDialogComponent, {
      title: 'Create Chat',
      width: '480px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
          relays: result.relays,
        };
        const createResult = await this.chatChannels.createChannel(metadata, result.tags);
        if (createResult.success && createResult.channelId) {
          this.snackBar.open('Chat created', 'OK', { duration: 3000 });
          await this.selectChannelById(createResult.channelId);
        } else {
          this.snackBar.open('Failed to create chat', 'OK', { duration: 3000 });
        }
      }
    });
  }

  /** Open edit channel dialog (only for channel creator) */
  openEditChannel(): void {
    const channel = this.selectedChannel();
    if (!channel || !this.isChannelCreator()) return;

    const dialogRef = this.customDialog.open<CreateChannelDialogComponent, CreateChannelDialogResult>(CreateChannelDialogComponent, {
      title: 'Edit Chat',
      width: '480px',
      maxWidth: '95vw',
      data: {
        name: channel.metadata.name,
        about: channel.metadata.about,
        picture: channel.metadata.picture,
        tags: channel.tags,
        relays: channel.metadata.relays,
        isEdit: true,
      },
    });

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
          relays: result.relays,
        };
        const success = await this.chatChannels.updateChannelMetadata(channel.id, metadata, result.tags);
        if (success) {
          this.snackBar.open('Chat updated', 'OK', { duration: 3000 });
        } else {
          this.snackBar.open('Failed to update chat', 'OK', { duration: 3000 });
        }
      }
    });
  }

  /** Send a message to the selected channel */
  async sendMessage(): Promise<void> {
    const channelId = this.selectedChannelId();
    const text = this.newMessageText().trim();
    if (!channelId || !text) return;

    this.isSending.set(true);
    try {
      const replyTo = this.replyingToMessage();
      const extraTags = this.pendingTags();
      const success = await this.chatChannels.sendMessage(channelId, text, replyTo?.id, extraTags.length ? extraTags : undefined);
      if (success) {
        this.newMessageText.set('');
        this.replyingToMessage.set(null);
        this.mediaPreviews.set([]);
        this.pendingTags.set([]);
        this.restoreMessageInputFocus();
        this.scrollToBottom();
      } else {
        this.snackBar.open('Failed to send message', 'OK', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[Chats] Send message failed', error);
      this.snackBar.open('Failed to send message', 'OK', { duration: 3000 });
    } finally {
      this.isSending.set(false);
    }
  }

  /** Handle keydown in message input */
  onMessageKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  /** Handle paste events – upload pasted images/videos */
  onMessagePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    const mediaFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
        mediaFiles.push(file);
      }
    }

    if (mediaFiles.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    void this.uploadMediaFiles(mediaFiles);
  }

  /** Set reply-to message */
  setReplyTo(message: ChannelMessage): void {
    this.replyingToMessage.set(message);
    // Focus the input
    setTimeout(() => this.messageInput?.nativeElement?.focus(), 50);
  }

  /** Clear reply-to */
  clearReply(): void {
    this.replyingToMessage.set(null);
  }

  /** Handle touch start on message bubble (long press detection) */
  onMessageTouchStart(event: TouchEvent, message: ChannelMessage, menuTrigger: MatMenuTrigger): void {
    this.onMessageTouchEnd();

    this.longPressTimeout = setTimeout(() => {
      event.preventDefault();
      this.haptics.triggerMedium();
      this.longPressedMessageId.set(message.id);
      menuTrigger.openMenu();
    }, this.LONG_PRESS_DURATION);
  }

  /** Handle touch end/move (cancel long press) */
  onMessageTouchEnd(): void {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
    setTimeout(() => {
      this.longPressedMessageId.set(null);
    }, 300);
  }

  /** Get the preview text of the message being replied to */
  getReplyPreviewText(message: ChannelMessage): string | null {
    if (!message.replyTo) return null;
    const messages = this.currentMessages();
    const repliedMessage = messages.find(m => m.id === message.replyTo);
    if (repliedMessage) {
      const text = repliedMessage.content.trim();
      return text.length > 120 ? text.substring(0, 120) + '...' : text;
    }
    return null;
  }

  /** Scroll to a specific message by ID and briefly highlight it */
  scrollToReply(messageId: string | undefined): void {
    if (!messageId) return;
    const wrapper = this.messagesWrapper?.nativeElement;
    if (!wrapper) return;

    const messageEl = wrapper.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
    if (messageEl) {
      messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      messageEl.classList.add('highlight-message');
      setTimeout(() => messageEl.classList.remove('highlight-message'), 1500);
    }
  }

  /** Hide a message */
  async hideMessage(message: ChannelMessage): Promise<void> {
    const success = await this.chatChannels.hideMessage(message.id);
    if (success) {
      this.snackBar.open('Message hidden', 'OK', { duration: 3000 });
    }
  }

  /** Mute a user */
  async muteUser(pubkey: string): Promise<void> {
    const success = await this.chatChannels.muteUser(pubkey);
    if (success) {
      this.snackBar.open('User muted', 'OK', { duration: 3000 });
    }
  }

  /** Add a reaction to a message */
  async addReaction(message: ChannelMessage, emoji: string): Promise<void> {
    const success = await this.chatChannels.addReaction(message, emoji);
    if (!success) {
      // Silently fail - user may have already reacted
    }
  }

  /** Get reactions array for a message */
  getReactionsArray(message: ChannelMessage): ChatReaction[] {
    return this.chatChannels.getReactionsArray(message);
  }

  /** Open zap dialog to zap the chat channel (kind 40 event) */
  async zapChat(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    // Fetch creator metadata for lightning address
    let metadata: Record<string, unknown> | undefined;
    try {
      const profile = await this.dataService.getProfile(channel.creator);
      if (profile?.data) {
        metadata = profile.data;
      }
    } catch {
      // Will be caught by the dialog
    }

    if (!metadata) {
      this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
      return;
    }

    const chatName = channel.metadata.name || 'chat';

    const { ZapDialogComponent } = await import('../../components/zap-dialog/zap-dialog.component');
    type ZapDialogData = import('../../components/zap-dialog/zap-dialog.component').ZapDialogData;

    const dialogData: ZapDialogData = {
      recipientPubkey: channel.creator,
      recipientMetadata: metadata,
      recipientName:
        (typeof metadata['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata['display_name'] === 'string' ? metadata['display_name'] : undefined),
      eventId: channel.id,
      eventKind: 40,
      initialMessage: `Zap for ${chatName} chat`,
      customRelays: channel.metadata.relays,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.amount) {
        this.haptics.triggerZapBuzz();
        this.zapSound.playZapSound(result.amount);
        this.showZapCelebration.set({ amount: result.amount, senderPubkey: this.currentPubkey() || '' });
        setTimeout(() => this.showZapCelebration.set(null), 2000);
      }
    });
  }

  /** Open zap dialog to zap an individual chat message */
  async zapMessage(message: ChannelMessage): Promise<void> {
    // Fetch message author metadata for lightning address
    let metadata: Record<string, unknown> | undefined;
    try {
      const profile = await this.dataService.getProfile(message.pubkey);
      if (profile?.data) {
        metadata = profile.data;
      }
    } catch {
      // Will be caught by the dialog
    }

    if (!metadata) {
      this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
      return;
    }

    const { ZapDialogComponent } = await import('../../components/zap-dialog/zap-dialog.component');
    type ZapDialogData = import('../../components/zap-dialog/zap-dialog.component').ZapDialogData;

    const dialogData: ZapDialogData = {
      recipientPubkey: message.pubkey,
      recipientMetadata: metadata,
      recipientName:
        (typeof metadata['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata['display_name'] === 'string' ? metadata['display_name'] : undefined),
      eventId: message.id,
      eventKind: 42,
      eventContent: message.content.length > 100 ? message.content.substring(0, 100) + '...' : message.content,
      customRelays: this.selectedChannel()?.metadata.relays,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.amount) {
        this.haptics.triggerZapBuzz();
        this.zapSound.playZapSound(result.amount);
        this.showZapCelebration.set({ amount: result.amount, senderPubkey: this.currentPubkey() || '' });
        setTimeout(() => this.showZapCelebration.set(null), 2000);
      }
    });
  }

  /** Subscribe to zap receipts for a channel */
  private subscribeToChannelZaps(channelId: string): void {
    this.cleanupZapSubscription();
    this.channelZaps.set([]);
    this.seenZapIds.clear();

    // Load existing zaps
    this.zapService.getZapsForEvent(channelId, 50).then(receipts => {
      const entries: ChatZapEntry[] = [];
      for (const receipt of receipts) {
        const entry = this.parseZapToEntry(receipt, channelId);
        if (entry && !this.seenZapIds.has(receipt.id)) {
          this.seenZapIds.add(receipt.id);
          entries.push(entry);
        }
      }
      if (entries.length > 0) {
        this.channelZaps.set(entries);
      }
    });

    // Subscribe to new zaps in real-time
    this.zapUnsubscribe = this.zapService.subscribeToEventZaps(channelId, (zapReceipt: NostrEvent) => {
      if (this.seenZapIds.has(zapReceipt.id)) return;
      this.seenZapIds.add(zapReceipt.id);

      const entry = this.parseZapToEntry(zapReceipt, channelId);
      if (entry) {
        this.channelZaps.update(zaps => [...zaps, entry]);

        // Trigger celebration animation and sound for all viewers
        this.haptics.triggerZapBuzz();
        this.zapSound.playZapSound(entry.amount);
        this.showZapCelebration.set({ amount: entry.amount, senderPubkey: entry.senderPubkey });
        setTimeout(() => this.showZapCelebration.set(null), 2000);

        // Auto-scroll to show the new zap
        this.scrollToBottomIfNotScrolledUp();
      }
    });
  }

  /** Parse a zap receipt event into a ChatZapEntry, validating it targets the expected channel */
  private parseZapToEntry(receipt: NostrEvent, expectedChannelId: string): ChatZapEntry | null {
    const parsed = this.zapService.parseZapReceipt(receipt);
    if (!parsed.zapRequest || !parsed.amount) return null;

    // Verify the zap request's e tag actually targets this channel.
    // Relays may return zap receipts that match on any e tag, so a zap
    // intended for a different channel can leak into this one.
    const zapRequestETag = parsed.zapRequest.tags.find(t => t[0] === 'e');
    if (zapRequestETag?.[1] !== expectedChannelId) {
      return null;
    }

    return {
      id: receipt.id,
      senderPubkey: parsed.zapRequest.pubkey,
      amount: parsed.amount,
      comment: parsed.comment,
      createdAt: receipt.created_at,
    };
  }

  /** Clean up the current zap subscription */
  private cleanupZapSubscription(): void {
    if (this.zapUnsubscribe) {
      this.zapUnsubscribe();
      this.zapUnsubscribe = null;
    }
  }

  /** Delete a message (NIP-09 retraction, own messages only) */
  async deleteMessage(message: ChannelMessage): Promise<void> {
    const confirmed = await this.deleteEventService.confirmDeletion({
      event: message.event,
      title: 'Delete message',
      entityLabel: 'message',
      confirmText: 'Delete',
    });
    if (confirmed) {
      const success = await this.chatChannels.deleteMessage(message, confirmed.referenceMode);
      if (success) {
        this.snackBar.open('Message deleted', 'OK', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to delete message', 'OK', { duration: 3000 });
      }
    }
  }

  /** Check if a user is muted */
  isUserMuted(pubkey: string): boolean {
    return this.chatChannels.isUserMuted(pubkey);
  }

  /** Unmute a user (from manage panel) */
  unmuteUser(pubkey: string): void {
    this.chatChannels.unmuteUser(pubkey);
    this.snackBar.open('User unmuted', 'OK', { duration: 3000 });
  }

  /** Unhide a message (from manage panel) */
  unhideMessage(messageId: string): void {
    this.chatChannels.unhideMessage(messageId);
    this.snackBar.open('Message unhidden', 'OK', { duration: 3000 });
  }

  /** Determine if a message starts a new visual group (different author from previous) */
  isGroupStart(index: number): boolean {
    if (index === 0) return true;
    const timeline = this.currentTimeline();
    const current = timeline[index];
    const previous = timeline[index - 1];
    // Metadata updates always break grouping
    if (current.type !== 'message' || previous.type !== 'message') return true;
    return current.data.pubkey !== previous.data.pubkey;
  }

  private imageUrlRegex = /(https?:\/\/[^\s##]+\.(jpe?g|png|gif|webp|avif)(\?[^\s##]*)?)/gi;

  getMessageImageUrls(message: ChannelMessage): string[] {
    if (!message.content) return [];
    this.imageUrlRegex.lastIndex = 0;
    const urls: string[] = [];
    let match;
    while ((match = this.imageUrlRegex.exec(message.content)) !== null) {
      urls.push(match[0]);
    }
    return [...new Set(urls)];
  }

  async openSaveToGifsDialog(message: ChannelMessage): Promise<void> {
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

  /** Copy a message's raw event data to clipboard */
  async copyMessageData(message: ChannelMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(message.event, null, 2));
      this.snackBar.open('Message data copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy message data', 'OK', { duration: 3000 });
    }
  }

  /** Scroll to bottom */
  scrollToLatestMessage(): void {
    this.scrollToBottom();
  }

  private restoreMessageInputFocus(): void {
    requestAnimationFrame(() => {
      this.messageInput?.nativeElement?.focus({ preventScroll: true });
    });
  }

  /** Copy channel event data to clipboard */
  async copyChannelData(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    const eventData = {
      id: channel.id,
      kind: 40,
      pubkey: channel.creator,
      created_at: channel.createdAt,
      content: JSON.stringify({
        name: channel.metadata.name,
        about: channel.metadata.about,
        picture: channel.metadata.picture,
        relays: channel.metadata.relays ?? [],
      }),
      tags: channel.tags.map(t => ['t', t]),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(eventData, null, 2));
      this.snackBar.open('Chat data copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy chat data', 'OK', { duration: 3000 });
    }
  }

  /** Copy channel metadata (kind 41) event data to clipboard */
  async copyChannelMetadata(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel || channel.updatedAt <= channel.createdAt) return;

    const eventData: Record<string, unknown> = {
      kind: 41,
      pubkey: channel.creator,
      created_at: channel.updatedAt,
      content: JSON.stringify({
        name: channel.metadata.name,
        about: channel.metadata.about,
        picture: channel.metadata.picture,
        relays: channel.metadata.relays ?? [],
      }),
      tags: [
        ['e', channel.id, '', 'root'],
        ...channel.tags.map(t => ['t', t]),
      ],
    };

    if (channel.metadataEventId) {
      eventData['id'] = channel.metadataEventId;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(eventData, null, 2));
      this.snackBar.open('Chat metadata copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy chat metadata', 'OK', { duration: 3000 });
    }
  }

  /** Copy the nevent-encoded channel ID to clipboard */
  async copyChannelId(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    const nevent = this.encodeChannelNevent(channel);

    try {
      await navigator.clipboard.writeText(nevent);
      this.snackBar.open('Chat ID copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy chat ID', 'OK', { duration: 3000 });
    }
  }

  /** Share the channel using the app's sharing dialog */
  async shareChannel(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    const nevent = this.encodeChannelNevent(channel);
    const url = `https://nostria.app/chats/${nevent}`;
    const chatName = channel.metadata.name || 'Chat';

    const dialogData: ShareArticleDialogData = {
      title: chatName,
      summary: channel.metadata.about || undefined,
      image: channel.metadata.picture || undefined,
      url,
      eventId: channel.id,
      pubkey: channel.creator,
      kind: 40,
      encodedId: nevent,
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: '',
      showCloseButton: false,
      data: dialogData,
    });
  }

  /** Copy the shareable channel link to clipboard */
  async copyChannelLink(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    const nevent = this.encodeChannelNevent(channel);
    const url = `https://nostria.app/chats/${nevent}`;

    try {
      await navigator.clipboard.writeText(url);
      this.snackBar.open('Chat link copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy chat link', 'OK', { duration: 3000 });
    }
  }

  /** Open file dialog for uploading media */
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

  /** Open media library chooser dialog */
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
        encryptedSelectionBehavior: 'keep-encrypted',
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

  /** Open music chooser dialog */
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

  /** Open GIF picker dialog */
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

  /** Handle media file selection from file input */
  onMediaFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.uploadMediaFiles([input.files[0]]);
    }
    input.value = '';
  }

  /** Remove a specific media preview by index */
  removeMediaPreview(index: number): void {
    const preview = this.mediaPreviews()[index];
    if (preview) {
      const currentText = this.newMessageText();
      const newText = currentText
        .split('\n')
        .filter(line => line.trim() !== preview.url)
        .join('\n');
      this.newMessageText.set(newText);
    }
    this.mediaPreviews.update(previews => previews.filter((_, i) => i !== index));
  }

  /** Record an audio clip and attach it to the message */
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
          this.isUploading.set(true);
          this.uploadStatus.set('Uploading audio clip...');

          const file = new File([result.blob], 'voice-message.mp4', { type: result.blob.type });
          const uploadResult = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());

          if (uploadResult.status === 'success' && uploadResult.item) {
            this.insertMediaUrl(uploadResult.item.url, uploadResult.item.type);

            // Add imeta tag with waveform and duration for audio player rendering
            const imetaTag = ['imeta', `url ${uploadResult.item.url}`, `m ${uploadResult.item.type}`];
            if (result.waveform?.length) {
              imetaTag.push(`waveform ${result.waveform.join(' ')}`);
            }
            if (result.duration) {
              imetaTag.push(`duration ${result.duration}`);
            }
            this.pendingTags.update(tags => [...tags, imetaTag]);
          } else {
            this.snackBar.open('Failed to upload audio clip', 'Dismiss', { duration: 5000 });
          }
        } catch {
          this.snackBar.open('Failed to upload audio clip', 'Dismiss', { duration: 5000 });
        } finally {
          this.isUploading.set(false);
          this.uploadStatus.set('');
        }
      }
    });
  }

  /** Record a video clip and attach it to the message */
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
          this.isUploading.set(true);
          this.uploadStatus.set('Uploading video clip...');

          const preparedFile = await this.mediaProcessing.prepareFileForUpload(result.file, result.uploadSettings);
          if (preparedFile.warningMessage) {
            this.snackBar.open(preparedFile.warningMessage, 'Dismiss', { duration: 5000 });
          }

          const uploadResult = await this.mediaService.uploadFile(
            preparedFile.file,
            preparedFile.uploadOriginal,
            this.mediaService.mediaServers()
          );

          if (uploadResult.status === 'success' && uploadResult.item) {
            this.insertMediaUrl(uploadResult.item.url, uploadResult.item.type);
          } else {
            this.snackBar.open('Failed to upload video clip', 'Dismiss', { duration: 5000 });
          }
        } catch {
          this.snackBar.open('Failed to upload video clip', 'Dismiss', { duration: 5000 });
        } finally {
          this.isUploading.set(false);
          this.uploadStatus.set('');
        }
      }
    });
  }

  /** Toggle chat details panel */
  toggleChatDetails(): void {
    this.showManagePanel.set(false);
    this.showChatDetails.update(v => !v);
  }

  /** Close chat details panel */
  closeChatDetails(): void {
    this.showChatDetails.set(false);
  }

  /** Toggle manage channel panel */
  toggleManagePanel(): void {
    this.showChatDetails.set(false);
    this.showManagePanel.update(v => !v);
  }

  /** Close manage channel panel */
  closeManagePanel(): void {
    this.showManagePanel.set(false);
  }

  /** Get channel initials for avatar placeholder */
  getChannelInitials(channel: ChatChannel): string {
    const name = channel.metadata.name || '?';
    return name.charAt(0).toUpperCase();
  }

  /** Check if a channel is pinned */
  isChannelPinned(channelId: string): boolean {
    return this.publicChatsListService.isChannelInList(channelId);
  }

  /** Check if the currently selected channel is pinned */
  isSelectedChannelPinned(): boolean {
    const channel = this.selectedChannel();
    if (!channel) return false;
    return this.publicChatsListService.isChannelInList(channel.id);
  }

  /** Pin the currently selected channel */
  async pinChannel(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;
    await this.publicChatsListService.addChannel(channel.id);
    this.snackBar.open('Chat pinned', 'Close', { duration: 3000 });
  }

  /** Unpin the currently selected channel */
  async unpinChannel(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;
    await this.publicChatsListService.removeChannel(channel.id);
    this.snackBar.open('Chat unpinned', 'Close', { duration: 3000 });
  }

  /** Refresh messages for the selected channel without using the cached since value */
  async refreshChannel(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;
    await this.chatChannels.refreshChannelMessages(channel.id);
    this.snackBar.open('Messages refreshed', 'Close', { duration: 3000 });
  }

  /** Migrate all channel messages to the channel's current relay list */
  async migrateChannel(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;
    this.migrationResult.set('');
    try {
      const result = await this.chatChannels.migrateChannelMessages(channel.id);
      this.migrationResult.set(`Found ${result.found} messages, published ${result.published}.`);
      this.snackBar.open('Migration complete', 'Close', { duration: 5000 });
    } catch {
      this.snackBar.open('Migration failed', 'Close', { duration: 5000 });
    }
  }

  /** Open a larger preview of a channel avatar image */
  openChannelAvatarPreview(imageUrl: string, channelName: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: stripImageProxy(imageUrl),
        mediaType: 'image',
        mediaTitle: `${channelName} Avatar`,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  // --- Private helpers ---

  /** Encode a ChatChannel to a NIP-19 nevent string, including relay hints from the latest metadata */
  private encodeChannelNevent(channel: ChatChannel): string {
    const metadataRelays = channel.metadata.relays ?? [];
    const relays = metadataRelays.length > 0
      ? metadataRelays
      : this.accountRelay.getRelayUrls();

    return nip19.neventEncode({
      id: channel.id,
      author: channel.creator,
      kind: 40,
      relays,
    });
  }

  /** Decode a route param (nevent or hex ID) into a channel hex ID and relay hints */
  private decodeChannelParam(param: string): { id: string; relays: string[] } | null {
    try {
      if (param.startsWith('nevent')) {
        const decoded = nip19.decode(param);
        if (decoded.type === 'nevent') {
          return {
            id: decoded.data.id,
            relays: decoded.data.relays ?? [],
          };
        }
      }
      // Fall back to treating as hex ID
      if (/^[0-9a-f]{64}$/i.test(param)) {
        return { id: param, relays: [] };
      }
      // Try decoding as note ID
      if (param.startsWith('note')) {
        const decoded = nip19.decode(param);
        if (decoded.type === 'note') {
          return { id: decoded.data, relays: [] };
        }
      }
    } catch {
      this.logger.warn('[Chats] Failed to decode channel param:', param);
    }
    return null;
  }

  private async uploadMediaFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.isUploading.set(true);

    try {
      await this.mediaService.load();

      for (let index = 0; index < files.length; index++) {
        this.uploadStatus.set(files.length > 1 ? `Uploading ${index + 1}/${files.length}...` : 'Uploading...');
        await this.uploadMediaFile(files[index]);
      }
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  private async uploadMediaFile(file: File): Promise<void> {
    try {
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
      this.logger.error('[Chats] Failed to upload media file', err);
      this.snackBar.open('Failed to upload media', 'Dismiss', { duration: 5000 });
    }
  }

  private insertMediaUrl(url: string, mimeType: string): void {
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    this.newMessageText.set(currentText + separator + url);

    if (mimeType.startsWith('image/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'image' }]);
    } else if (mimeType.startsWith('video/')) {
      this.mediaPreviews.update(previews => [...previews, { url, type: 'video' }]);
    }

    this.messageInput?.nativeElement?.focus();
  }

  private insertMusicReference(naddr: string, title: string, musicType: 'track' | 'playlist'): void {
    const nostrUrl = 'nostr:' + naddr;
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    this.newMessageText.set(currentText + separator + nostrUrl);

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
    this.newMessageText.set(currentText + separator + insertionText);

    this.messageInput?.nativeElement?.focus();
    this.snackBar.open(
      unique.length === 1 ? 'Reference inserted' : `${unique.length} references inserted`,
      'Close',
      { duration: 2500 },
    );
  }

  private insertGifUrl(url: string): void {
    const currentText = this.newMessageText();
    const separator = currentText && !currentText.endsWith('\n') && currentText.length > 0 ? '\n' : '';
    this.newMessageText.set(currentText + separator + url);

    // Add preview (GIFs are images)
    this.mediaPreviews.update(previews => [...previews, { url, type: 'image' as const }]);

    this.messageInput?.nativeElement?.focus();
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

  private scrollToBottom(): void {
    this.userScrolledUp = false;
    this.showScrollToLatestButton.set(false);
    setTimeout(() => {
      if (this.messagesWrapper?.nativeElement) {
        const element = this.messagesWrapper.nativeElement;
        element.scrollTop = element.scrollHeight;
        this.lastScrollHeight = element.scrollHeight;
      }
    }, 100);
  }

  private scrollToBottomIfNotScrolledUp(): void {
    if (this.userScrolledUp) return;
    this.showScrollToLatestButton.set(false);
    setTimeout(() => {
      if (this.messagesWrapper?.nativeElement) {
        const element = this.messagesWrapper.nativeElement;
        element.scrollTop = element.scrollHeight;
        this.lastScrollHeight = element.scrollHeight;
      }
    }, 50);
  }

  private setupScrollListener(): void {
    const scrollElement = this.messagesWrapper?.nativeElement;
    if (!scrollElement) return;

    scrollElement.removeEventListener('scroll', this.scrollHandler);
    scrollElement.addEventListener('scroll', this.scrollHandler);
  }

  private scrollHandler = () => {
    if (this.scrollThrottleTimeout) return;

    this.scrollThrottleTimeout = setTimeout(() => {
      this.scrollThrottleTimeout = null;

      const scrollElement = this.messagesWrapper?.nativeElement;
      if (!scrollElement) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const distFromBottom = scrollHeight - (scrollTop + clientHeight);
      this.userScrolledUp = distFromBottom > 150;
      this.showScrollToLatestButton.set(distFromBottom > 600);
    }, 100);
  };

  /** Open image preview dialog for shared images */
  async openImagePreview(index: number, event?: MouseEvent): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const images = this.sharedImages();
    if (images.length === 0) return;

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: images.map(url => ({
          url,
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

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  onSettingsDialogClosed(result: { saved: boolean } | null): void {
    this.showSettingsDialog.set(false);
  }
}
