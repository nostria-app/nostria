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
import { SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import {
  ChatChannelsService,
  ChatChannel,
  ChannelMessage,
  ChannelMetadata,
} from '../../services/chat-channels.service';
import { ApplicationService } from '../../services/application.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { TrustService } from '../../services/trust.service';
import { ListFilterMenuComponent, ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import {
  CreateChannelDialogComponent,
  CreateChannelDialogResult,
} from './create-channel-dialog/create-channel-dialog.component';

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
    MatSnackBarModule,
    MatDividerModule,
    RouterModule,
    UserProfileComponent,
    AgoPipe,
    SlicePipe,
    ListFilterMenuComponent,
  ],
  templateUrl: './chats.component.html',
  styleUrl: './chats.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatsComponent implements OnInit, OnDestroy {
  private readonly chatChannels = inject(ChatChannelsService);
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

  /** People list filter state */
  readonly selectedListFilter = signal<string>('following');

  /** URL query param for list filter */
  readonly urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);

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

    return filtered;
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

  /** Current user pubkey */
  readonly currentPubkey = computed(() => this.accountState.pubkey());

  /** Whether current user is the creator of the selected channel */
  readonly isChannelCreator = computed(() => {
    const channel = this.selectedChannel();
    const pubkey = this.currentPubkey();
    return !!channel && !!pubkey && channel.creator === pubkey;
  });

  @ViewChild('messagesWrapper', { static: false })
  messagesWrapper?: ElementRef<HTMLDivElement>;

  @ViewChild('messageInput', { static: false })
  messageInput?: ElementRef<HTMLTextAreaElement>;

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
    // Load cached channels first for instant display, then fetch from relays
    this.chatChannels.loadChannelsFromCache().then(() => {
      this.chatChannels.load().then(() => {
        this.chatChannels.subscribeToChannels();
      });
    });

    // Check route params for a channel ID
    this.route.firstChild?.params.subscribe(params => {
      const id = params['id'];
      if (id) {
        this.selectChannelById(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.layout.hideMobileNav.set(false);
    this.chatChannels.closeChannelSubscription();
    this.chatChannels.closeMessageSubscription();

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

    // Load messages and subscribe
    await this.chatChannels.loadChannelMessages(channel.id);
    this.chatChannels.subscribeToChannelMessages(channel.id);

    // Set up scroll listener
    setTimeout(() => this.setupScrollListener(), 100);
  }

  /** Select a channel by ID (from route) */
  async selectChannelById(channelId: string): Promise<void> {
    const channel = this.chatChannels.getChannel(channelId);
    if (channel) {
      await this.selectChannel(channel);
    } else {
      // Channel not yet loaded - try loading messages anyway
      this.selectedChannelId.set(channelId);
      this.showMobileList.set(false);
      await this.chatChannels.loadChannelMessages(channelId);
      this.chatChannels.subscribeToChannelMessages(channelId);
      setTimeout(() => this.setupScrollListener(), 100);
    }
  }

  /** Back to channel list (mobile) */
  backToList(): void {
    this.showMobileList.set(true);
    this.selectedChannelId.set(null);
    this.chatChannels.closeMessageSubscription();
  }

  /** Toggle search */
  toggleSearch(): void {
    this.showSearch.update(v => !v);
    if (!this.showSearch()) {
      this.channelSearchQuery.set('');
    }
  }

  /** Handle filter change from ListFilterMenuComponent */
  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);

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
    const dialogRef = this.dialog.open(CreateChannelDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed().subscribe(async (result: CreateChannelDialogResult | undefined) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
        };
        const createResult = await this.chatChannels.createChannel(metadata);
        if (createResult.success && createResult.channelId) {
          this.snackBar.open('Channel created', 'OK', { duration: 3000 });
          await this.selectChannelById(createResult.channelId);
        } else {
          this.snackBar.open('Failed to create channel', 'OK', { duration: 3000 });
        }
      }
    });
  }

  /** Open edit channel dialog (only for channel creator) */
  openEditChannel(): void {
    const channel = this.selectedChannel();
    if (!channel || !this.isChannelCreator()) return;

    const dialogRef = this.dialog.open(CreateChannelDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: {
        name: channel.metadata.name,
        about: channel.metadata.about,
        picture: channel.metadata.picture,
        isEdit: true,
      },
    });

    dialogRef.afterClosed().subscribe(async (result: CreateChannelDialogResult | undefined) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
        };
        const success = await this.chatChannels.updateChannelMetadata(channel.id, metadata);
        if (success) {
          this.snackBar.open('Channel updated', 'OK', { duration: 3000 });
        } else {
          this.snackBar.open('Failed to update channel', 'OK', { duration: 3000 });
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
      const success = await this.chatChannels.sendMessage(channelId, text, replyTo?.id);
      if (success) {
        this.newMessageText.set('');
        this.replyingToMessage.set(null);
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

  /** Check if a user is muted */
  isUserMuted(pubkey: string): boolean {
    return this.chatChannels.isUserMuted(pubkey);
  }

  /** Scroll to bottom */
  scrollToLatestMessage(): void {
    this.scrollToBottom();
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
      this.snackBar.open('Channel data copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy channel data', 'OK', { duration: 3000 });
    }
  }

  /** Get channel initials for avatar placeholder */
  getChannelInitials(channel: ChatChannel): string {
    const name = channel.metadata.name || '?';
    return name.charAt(0).toUpperCase();
  }

  // --- Private helpers ---

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
}
