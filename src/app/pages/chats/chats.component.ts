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
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { MediaService } from '../../services/media.service';
import { HapticsService } from '../../services/haptics.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
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
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { stripImageProxy } from '../../utils/strip-image-proxy';
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
    ProfileDisplayNameComponent,
    MessageContentComponent,
    AgoPipe,
    DatePipe,
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
  private readonly customDialog = inject(CustomDialogService);
  readonly mediaService = inject(MediaService);
  private readonly haptics = inject(HapticsService);

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

  /** Whether a media file is currently uploading */
  readonly isUploading = signal<boolean>(false);

  /** Upload status text */
  readonly uploadStatus = signal<string>('');

  /** Media previews for the current message */
  readonly mediaPreviews = signal<{ url: string; type: 'image' | 'video' | 'music'; label?: string }[]>([]);

  /** People list filter state */
  readonly selectedListFilter = signal<string>('following');

  /** URL-based initial list filter */
  readonly urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);

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
    this.showChatDetails.set(false);
    this.mediaPreviews.set([]);

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
    const dialogRef = this.customDialog.open<CreateChannelDialogComponent, CreateChannelDialogResult>(CreateChannelDialogComponent, {
      title: 'Create Channel',
      width: '480px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
        };
        const createResult = await this.chatChannels.createChannel(metadata, result.tags);
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

    const dialogRef = this.customDialog.open<CreateChannelDialogComponent, CreateChannelDialogResult>(CreateChannelDialogComponent, {
      title: 'Edit Channel',
      width: '480px',
      maxWidth: '95vw',
      data: {
        name: channel.metadata.name,
        about: channel.metadata.about,
        picture: channel.metadata.picture,
        tags: channel.tags,
        isEdit: true,
      },
    });

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result) {
        const metadata: ChannelMetadata = {
          name: result.name,
          about: result.about,
          picture: result.picture,
        };
        const success = await this.chatChannels.updateChannelMetadata(channel.id, metadata, result.tags);
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
        this.mediaPreviews.set([]);
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

  /** Check if a user is muted */
  isUserMuted(pubkey: string): boolean {
    return this.chatChannels.isUserMuted(pubkey);
  }

  /** Determine if a message starts a new visual group (different author from previous) */
  isGroupStart(index: number): boolean {
    if (index === 0) return true;
    const messages = this.currentMessages();
    return messages[index].pubkey !== messages[index - 1].pubkey;
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
      this.snackBar.open('Channel metadata copied to clipboard', 'OK', { duration: 3000 });
    } catch {
      this.snackBar.open('Failed to copy channel metadata', 'OK', { duration: 3000 });
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
    const { GifPickerDialogComponent } = await import('../../components/gif-picker/gif-picker-dialog.component');
    const dialogRef = this.customDialog.open<typeof GifPickerDialogComponent.prototype, string>(GifPickerDialogComponent, {
      title: 'GIFs',
      width: '400px',
      panelClass: 'gif-picker-dialog',
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

  /** Toggle chat details panel */
  toggleChatDetails(): void {
    this.showChatDetails.update(v => !v);
  }

  /** Close chat details panel */
  closeChatDetails(): void {
    this.showChatDetails.set(false);
  }

  /** Get channel initials for avatar placeholder */
  getChannelInitials(channel: ChatChannel): string {
    const name = channel.metadata.name || '?';
    return name.charAt(0).toUpperCase();
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
}
