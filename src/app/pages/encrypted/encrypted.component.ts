import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { nip19 } from 'nostr-tools';

import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { EmojiPickerComponent } from '../../components/emoji-picker/emoji-picker.component';
import { CustomDialogComponent } from '../../components/custom-dialog/custom-dialog.component';
import { ImageInputComponent } from '../../components/image-input/image-input.component';
import { MediaService } from '../../services/media.service';
import { MediaProcessingService, type PreparedUploadFile } from '../../services/media-processing.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import {
  DEFAULT_DM_MEDIA_UPLOAD_SETTINGS,
  getMediaOptimizationDescription,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  MEDIA_OPTIMIZATION_OPTIONS,
  type MediaOptimizationOptionValue,
  type MediaUploadMode,
  type MediaUploadSettings,
  VideoRecordDialogResult,
} from '../../interfaces/media-upload';
import { SocialPreviewComponent } from '../../components/social-preview/social-preview.component';
import { OpenGraphData, OpenGraphService } from '../../services/opengraph.service';
import { SettingsService } from '../../services/settings.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { DatabaseService } from '../../services/database.service';
import { FollowingService } from '../../services/following.service';
import { ConcordService } from '../../services/concord.service';
import { ConcordAdminService } from '../../services/concord/concord-admin.service';
import { ConcordInviteService } from '../../services/concord/concord-invite.service';
import { ConcordListsService } from '../../services/concord/concord-lists.service';
import { ConcordMediaService } from '../../services/concord/concord-media.service';
import { ConcordRekeyService } from '../../services/concord/concord-rekey.service';
import { ConcordVoiceService } from '../../services/concord/concord-voice.service';
import {
  CORD_KIND_REPLY,
  CORD_PERMISSIONS,
  CORD_DEFAULT_RELAYS,
  CordChannel,
  CordCommunity,
  CordInviteBundle,
  CordMessage,
  PERM_BAN,
  PERM_CREATE_INVITE,
  PERM_MANAGE_CHANNELS,
  PERM_MANAGE_METADATA,
  PERM_MANAGE_ROLES,
  PERM_PIN_MESSAGES,
} from '../../interfaces/concord';

/** Consecutive messages from one author within this window are grouped. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** Remembers where the user left off, so the section resumes on return. */
const LAST_LOCATION_STORAGE_KEY = 'nostria-concord-last-location-v1';

interface CordLastLocation {
  communityId: string | null;
  /** Last channel opened per community. */
  channels: Record<string, string>;
}

interface MessageCluster {
  key: string;
  pubkey: string;
  timestamp: number;
  messages: CordMessage[];
}

interface PendingCommunityAttachment {
  id: string;
  objectUrl: string;
  file: File;
  sourceFile: File;
  type: 'image' | 'video' | 'file';
  originalSize: number;
  processedSize: number;
}

type MobilePane = 'communities' | 'channels' | 'content';
type ChannelView = 'chat' | 'members' | 'settings';

@Component({
  selector: 'app-encrypted',
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    MatBadgeModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    MessageContentComponent,
    SocialPreviewComponent,
    EmojiPickerComponent,
    CustomDialogComponent,
    ImageInputComponent,
  ],
  templateUrl: './encrypted.component.html',
  styleUrl: './encrypted.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EncryptedComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly openGraph = inject(OpenGraphService);
  private readonly settings = inject(SettingsService);
  private readonly mediaService = inject(MediaService);
  private readonly mediaProcessing = inject(MediaProcessingService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly database = inject(DatabaseService);
  private readonly following = inject(FollowingService);

  readonly layout = inject(LayoutService);
  readonly concord = inject(ConcordService);
  readonly admin = inject(ConcordAdminService);
  readonly invites = inject(ConcordInviteService);
  readonly lists = inject(ConcordListsService);
  readonly media = inject(ConcordMediaService);
  readonly rekey = inject(ConcordRekeyService);
  readonly voice = inject(ConcordVoiceService);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composerInput');
  private readonly mediaFileInput = viewChild<ElementRef<HTMLInputElement>>('mediaFileInput');
  private readonly encryptedFileInput = viewChild<ElementRef<HTMLInputElement>>('encryptedFileInput');

  readonly communityId = signal<string | null>(null);
  readonly channelId = signal<string | null>(null);

  readonly mobilePane = signal<MobilePane>('communities');
  readonly view = signal<ChannelView>('chat');
  readonly showJoin = signal(false);
  readonly inviteLink = signal('');
  readonly joining = signal(false);
  readonly preview = signal<CordInviteBundle | null>(null);
  readonly messageText = signal('');
  readonly replyingTo = signal<CordMessage | null>(null);
  readonly showMemberRail = signal(true);

  /** Thread roots whose replies are currently unfolded. */
  private readonly expandedThreads = signal<ReadonlySet<string>>(new Set());

  // -- Admin state ----------------------------------------------------------
  readonly showCreate = signal(false);
  readonly newCommunityName = signal('');
  readonly newCommunityDescription = signal('');
  readonly newCommunityRelays = signal(CORD_DEFAULT_RELAYS.join('\n'));
  readonly newChannelName = signal('');
  readonly newChannelPrivate = signal(false);
  readonly settingsName = signal('');
  readonly settingsDescription = signal('');
  readonly settingsTimer = signal(0);
  readonly settingsIconUrl = signal('');
  readonly settingsBannerUrl = signal('');
  readonly settingsIconChanged = signal(false);
  readonly settingsBannerChanged = signal(false);
  readonly inviteResult = signal<string | null>(null);
  readonly directInvitePubkey = signal('');
  readonly directInviteProfiles = signal<string[]>([]);
  readonly busy = signal(false);
  readonly brokerInput = signal('');
  readonly refounding = signal(false);
  readonly showDissolveConfirmation = signal(false);
  readonly showPins = signal(false);
  readonly uploading = signal(false);
  readonly communityUploadStatus = signal('');
  readonly communityMediaUploadMode = signal<MediaUploadMode>(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.mode);
  readonly communityCompressionStrength = signal(DEFAULT_DM_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  readonly pendingCommunityAttachments = signal<PendingCommunityAttachment[]>([]);
  readonly optimizationOptions = MEDIA_OPTIMIZATION_OPTIONS;
  readonly hasPendingCommunityMedia = computed(() =>
    this.pendingCommunityAttachments().some(item => item.type === 'image' || item.type === 'video')
  );
  readonly selectedCommunityOptimization = computed(() =>
    getMediaOptimizationOption(this.communityMediaUploadMode(), this.communityCompressionStrength())
  );
  readonly communityOptimizationDescription = computed(() =>
    getMediaOptimizationDescription(this.communityMediaUploadMode(), this.communityCompressionStrength())
  );

  /** Tags staged by attachments, merged into the next message. */
  private readonly pendingTags = signal<string[][]>([]);

  readonly permissionCatalogue = CORD_PERMISSIONS;

  /** Bumped after service mutations so derived views re-evaluate. */
  private readonly revision = signal(0);

  /** Tracks account switches; undefined until the first read. */
  private lastAccount: string | null | undefined = undefined;

  readonly pubkey = computed(() => this.accountState.pubkey());

  readonly communities = computed<CordCommunity[]>(() => {
    this.revision();
    return [...this.concord.communities()].sort((a, b) =>
      (a.name ?? a.communityId).localeCompare(b.name ?? b.communityId)
    );
  });

  readonly activeCommunity = computed<CordCommunity | undefined>(() => {
    this.revision();
    const id = this.communityId();
    return id ? this.concord.getCommunity(id) : undefined;
  });

  readonly control = computed(() => {
    this.revision();
    const id = this.communityId();
    return id ? this.concord.getControl(id) : undefined;
  });

  /** The folded name always wins over the invite's preview copy. */
  readonly communityName = computed(() => {
    const community = this.activeCommunity();
    return this.control()?.metadata?.name || community?.name || 'Community';
  });

  readonly channels = computed<CordChannel[]>(() => {
    this.revision();
    const id = this.communityId();
    return id ? this.concord.getChannels(id) : [];
  });

  readonly activeChannel = computed<CordChannel | undefined>(() => {
    const id = this.channelId();
    return this.channels().find(channel => channel.channelId === id);
  });

  readonly messages = computed<CordMessage[]>(() => {
    this.revision();
    const community = this.communityId();
    const channel = this.channelId();
    return community && channel ? this.concord.getMessages(community, channel) : [];
  });

  readonly members = computed(() => {
    this.revision();
    const id = this.communityId();
    return id ? this.concord.getMembers(id) : [];
  });

  readonly isDissolved = computed(() => this.control()?.dissolved === true);

  private readonly messageIndex = computed(() => {
    const index = new Map<string, CordMessage>();
    for (const message of this.messages()) index.set(message.id, message);
    return index;
  });

  /**
   * Splits the timeline into top-level messages and the replies that hang off
   * them. Replies are flattened onto their thread root so a deep chain still
   * folds under the one message the timeline shows. A reply whose parent is
   * not in the loaded history stays top-level rather than disappearing.
   */
  private readonly threads = computed(() => {
    const index = this.messageIndex();
    const roots: CordMessage[] = [];
    const replies = new Map<string, CordMessage[]>();
    const rootOf = new Map<string, string>();

    for (const message of this.messages()) {
      const rootId = this.resolveRootId(message, index, rootOf);

      if (!rootId) {
        roots.push(message);
        continue;
      }

      rootOf.set(message.id, rootId);
      const bucket = replies.get(rootId);
      if (bucket) bucket.push(message);
      else replies.set(rootId, [message]);
    }

    return { roots, replies, rootOf };
  });

  readonly clusters = computed<MessageCluster[]>(() => {
    const clusters: MessageCluster[] = [];

    for (const message of this.threads().roots) {
      const last = clusters.at(-1);
      const sameAuthor = last?.pubkey === message.pubkey;
      const within =
        !!last && message.timestamp - (last.messages.at(-1)?.timestamp ?? 0) < GROUPING_WINDOW_MS;

      if (last && sameAuthor && within && message.kind !== CORD_KIND_REPLY) {
        last.messages.push(message);
      } else {
        clusters.push({
          key: message.id,
          pubkey: message.pubkey,
          timestamp: message.timestamp,
          messages: [message],
        });
      }
    }

    return clusters;
  });

  /** The thread root a reply belongs to, or undefined when it is top-level. */
  private resolveRootId(
    message: CordMessage,
    index: Map<string, CordMessage>,
    rootOf: Map<string, string>
  ): string | undefined {
    let current = message;

    for (let hop = 0; hop < 64; hop++) {
      const parentId = current.parent ?? current.threadRoot;
      if (!parentId) break;

      const known = rootOf.get(parentId);
      if (known) return known;

      const parent = index.get(parentId);
      if (!parent) break;

      current = parent;
    }

    return current.id === message.id ? undefined : current.id;
  }

  repliesFor(rootId: string): CordMessage[] {
    return this.threads().replies.get(rootId) ?? [];
  }

  replyCount(rootId: string): number {
    return this.repliesFor(rootId).length;
  }

  isThreadExpanded(rootId: string): boolean {
    return this.expandedThreads().has(rootId);
  }

  toggleThread(rootId: string): void {
    this.expandedThreads.update(current => {
      const next = new Set(current);
      if (!next.delete(rootId)) next.add(rootId);
      return next;
    });
  }

  private expandThread(rootId: string): void {
    this.expandedThreads.update(current => new Set(current).add(rootId));
  }

  /**
   * The quoted parent shown above a reply. It is skipped when the parent is
   * the thread root, because the reply already renders directly beneath it.
   */
  parentPreview(message: CordMessage, rootId: string): CordMessage | undefined {
    const parentId = message.parent;
    if (!parentId || parentId === rootId) return undefined;
    return this.messageIndex().get(parentId);
  }

  readonly canPin = computed(() => this.check(PERM_PIN_MESSAGES));

  /** Verified pins for the open channel, plus whether we could read the list. */
  readonly pinState = computed(() => {
    this.revision();
    const community = this.communityId();
    const channel = this.channelId();

    return community && channel
      ? this.concord.getPins(community, channel)
      : { pins: [], readable: true };
  });

  readonly pins = computed(() => this.pinState().pins);

  /**
   * True when the pin list is sealed under a key epoch we never held. It must
   * be shown as unavailable rather than empty, because replacing a list we
   * cannot read would silently drop every entry in it.
   */
  readonly pinsUnavailable = computed(() => !this.pinState().readable);

  readonly canPost = computed(() => !!this.pubkey() && !this.isDissolved());

  /** This member's standing, resolved against the owner-rooted roster. */
  readonly standing = computed(() => {
    this.revision();
    const id = this.communityId();
    return id ? this.concord.standing(id) : null;
  });

  readonly isOwner = computed(() => this.standing()?.isOwner === true);

  /** Staff hold the control_root and can therefore write Control editions. */
  readonly isStaff = computed(() => {
    this.revision();
    const id = this.communityId();
    return !!id && this.concord.isStaffHere(id);
  });

  readonly canManageChannels = computed(() => this.check(PERM_MANAGE_CHANNELS));
  readonly canManageMetadata = computed(() => this.check(PERM_MANAGE_METADATA));
  readonly canManageRoles = computed(() => this.check(PERM_MANAGE_ROLES));
  readonly canBan = computed(() => this.check(PERM_BAN));
  readonly canCreateInvite = computed(() => this.check(PERM_CREATE_INVITE));

  private check(bit: bigint): boolean {
    this.revision();
    const id = this.communityId();
    return !!id && this.concord.can(id, bit);
  }

  /** Whether a live invite link exists, which is what makes it Public. */
  readonly isPublicCommunity = computed(() => {
    this.revision();
    const id = this.communityId();
    return !!id && this.concord.isPublic(id);
  });

  readonly roles = computed(() => {
    this.revision();
    return [...(this.control()?.roles.values() ?? [])].sort((a, b) => a.position - b.position);
  });

  readonly bannedMembers = computed(() => {
    this.revision();
    return [...(this.control()?.banned ?? [])];
  });

  constructor() {
    // A community's keys belong to one identity, so switching accounts leaves
    // the open community entirely rather than showing a stale one.
    effect(() => {
      const pubkey = this.accountState.pubkey();

      untracked(() => {
        if (this.lastAccount === pubkey) return;

        const previous = this.lastAccount;
        this.lastAccount = pubkey;

        if (previous !== undefined) {
          this.replyingTo.set(null);
          this.showJoin.set(false);
          this.showCreate.set(false);
          this.revision.update(value => value + 1);

          if (this.communityId()) void this.router.navigate(['/c']);
        }
      });
    });

    effect(() => {
      const community = this.communityId();
      const channel = this.channelId();

      untracked(() => void this.syncRoute(community, channel));
    });

    effect(() => {
      const count = this.messages().length;
      untracked(() => {
        if (count > 0) queueMicrotask(() => this.scrollToBottom());
      });
    });

    // Hide the mobile nav while the composer is on screen, matching public chats.
    effect(() => {
      const viewingChat = this.mobilePane() === 'content';
      this.layout.hideMobileNav.set(this.layout.isHandset() && viewingChat);
    });
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.communityId.set(params.get('communityId'));
      this.channelId.set(params.get('channelId'));
    });

    void this.prefetchCommunityMetadata();
  }

  /**
   * Fold every held community's Control Plane in the background so the rail
   * shows names and icons before any community is opened. Loads are sequential
   * to keep the relay queries — and the shared loading flag — well behaved.
   */
  private async prefetchCommunityMetadata(): Promise<void> {
    for (const community of this.concord.communities()) {
      await this.concord.loadCommunity(community.communityId);
      this.revision.update(value => value + 1);
    }
  }

  ngOnDestroy(): void {
    this.layout.hideMobileNav.set(false);
    this.concord.closeSubscriptions();
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  selectCommunity(community: CordCommunity): void {
    this.showJoin.set(false);
    this.mobilePane.set('channels');
    void this.router.navigate(['/c', community.communityId]);
  }

  selectChannel(channel: CordChannel): void {
    const community = this.activeCommunity();
    if (!community) return;

    this.replyingTo.set(null);
    this.view.set('chat');
    this.mobilePane.set('content');
    void this.router.navigate(['/c', community.communityId, channel.channelId]);
  }

  backToCommunities(): void {
    this.mobilePane.set('communities');
  }

  backToChannels(): void {
    this.mobilePane.set('channels');
  }

  setView(view: ChannelView): void {
    this.view.set(view);
    this.mobilePane.set('content');
  }

  /** Pull memberships published by this member's other devices and clients. */
  async syncMemberships(): Promise<void> {
    await this.concord.syncMemberships();
    this.revision.update(value => value + 1);

    const count = this.communities().length;
    this.snackBar.open(
      count === 0
        ? 'No communities found in your synced list.'
        : `${count} communit${count === 1 ? 'y' : 'ies'} available.`,
      undefined,
      { duration: 4000 }
    );
  }

  // -------------------------------------------------------------------------
  // Joining
  // -------------------------------------------------------------------------

  openJoin(): void {
    this.showJoin.set(true);
    this.preview.set(null);
    this.mobilePane.set('content');
  }

  async previewInvite(): Promise<void> {
    const link = this.inviteLink().trim();
    if (!link || this.joining()) return;

    this.joining.set(true);

    try {
      const { bundle } = await this.concord.previewInvite(link);
      this.preview.set(bundle);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
      this.preview.set(null);
    } finally {
      this.joining.set(false);
    }
  }

  async acceptInvite(): Promise<void> {
    const link = this.inviteLink().trim();
    if (!link || this.joining()) return;

    this.joining.set(true);

    try {
      const communityId = await this.concord.joinFromInvite(link);

      this.inviteLink.set('');
      this.preview.set(null);
      this.showJoin.set(false);
      this.revision.update(value => value + 1);

      void this.router.navigate(['/c', communityId]);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.joining.set(false);
    }
  }

  async leave(): Promise<void> {
    const community = this.activeCommunity();
    if (!community) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Leave ${this.communityName()}?`,
        message:
          'Your keys for this community will be removed from this device. You will need a new invite to return.',
        confirmText: 'Leave',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } satisfies ConfirmDialogData,
    });

    if (!(await firstValueFrom(dialogRef.afterClosed()))) return;

    await this.concord.leaveCommunity(community.communityId);
    this.revision.update(value => value + 1);
    void this.router.navigate(['/c']);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  setReply(message: CordMessage): void {
    this.replyingTo.set(message);
  }

  cancelReply(): void {
    this.replyingTo.set(null);
  }

  async send(): Promise<void> {
    const community = this.communityId();
    const channel = this.channelId();
    const content = this.messageText().trim();

    if (!community || !channel || !content || this.concord.sending()) return;

    const replyTo = this.replyingTo() ?? undefined;
    this.messageText.set('');
    this.replyingTo.set(null);

    const extraTags = this.takePendingTags();
    const sent = await this.concord.sendMessage(community, channel, content, {
      replyTo,
      extraTags,
    });

    if (!sent) {
      this.messageText.set(content);
      this.replyingTo.set(replyTo ?? null);
      this.pendingTags.set(extraTags);
      this.snackBar.open('Could not send that message', 'Dismiss', { duration: 5000 });
    } else {
      this.revision.update(value => value + 1);

      // Unfold the thread so the author sees the reply they just sent.
      if (replyTo) {
        this.expandThread(this.threads().rootOf.get(replyTo.id) ?? replyTo.id);
      }
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  async react(message: CordMessage, emoji: string): Promise<void> {
    const community = this.communityId();
    const channel = this.channelId();
    if (!community || !channel) return;

    await this.concord.react(community, channel, message, emoji);
    this.revision.update(value => value + 1);
  }

  async openReactionPicker(message: CordMessage): Promise<void> {
    const { EmojiPickerDialogComponent } = await import(
      '../../components/emoji-picker/emoji-picker-dialog.component'
    );

    const dialogRef = this.dialog.open(EmojiPickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'desktop-reaction-picker-dialog-panel'],
      width: '400px',
      data: {
        title: 'React',
        mode: 'reaction',
        activeTab: 'emoji',
        allowPreferredReactionShortcut: true,
      },
    });

    dialogRef.afterClosed().subscribe((emoji: string | undefined) => {
      if (emoji) void this.react(message, emoji);
    });
  }

  canDelete(message: CordMessage): boolean {
    return message.pubkey === this.pubkey();
  }

  async deleteMessage(message: CordMessage): Promise<void> {
    const community = this.communityId();
    const channel = this.channelId();
    if (!community || !channel) return;

    await this.concord.deleteMessage(community, channel, message);
    this.revision.update(value => value + 1);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * A community's icon, decrypted from its Control Plane metadata pointer.
   *
   * Returns null until the blob resolves, so callers fall back to initials
   * rather than flashing a broken image.
   */
  communityIcon(community: CordCommunity): string | null {
    this.media.revision();

    const metadata = this.concord.getControl(community.communityId).metadata;
    return this.media.resolve(metadata?.icon);
  }

  /** The active community's banner, when it publishes one. */
  activeBanner(): string | null {
    this.media.revision();
    return this.media.resolve(this.control()?.metadata?.banner);
  }

  /** An invite preview's icon, carried in the bundle purely as a preview. */
  previewIcon(): string | null {
    this.media.revision();
    return this.media.resolve(this.preview()?.icon);
  }

  initials(name: string): string {
    return name
      .split(/[\s.\-_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  displayName(community: CordCommunity): string {
    return this.concord.getControl(community.communityId).metadata?.name || community.name || 'Community';
  }

  channelIcon(channel: CordChannel): string {
    return channel.private ? 'lock' : 'tag';
  }

  isActiveChannel(channel: CordChannel): boolean {
    return this.channelId() === channel.channelId;
  }

  findMessage(id: string | undefined): CordMessage | undefined {
    return id ? this.messageIndex().get(id) : undefined;
  }

  // -------------------------------------------------------------------------
  // Community creation and settings
  // -------------------------------------------------------------------------

  openCreate(): void {
    this.showCreate.set(true);
    this.showJoin.set(false);
    this.mobilePane.set('content');
  }

  cancelCreate(): void {
    this.showCreate.set(false);
    this.newCommunityName.set('');
    this.newCommunityDescription.set('');
  }

  async createCommunity(): Promise<void> {
    const name = this.newCommunityName().trim();
    const relays = this.newCommunityRelays()
      .split(/[\n,]/)
      .map(relay => relay.trim())
      .filter(Boolean);

    if (!name || relays.length === 0 || this.busy()) return;

    this.busy.set(true);

    try {
      const community = await this.admin.createCommunity({
        name,
        description: this.newCommunityDescription(),
        relays,
      });

      // Adopting it locally is what makes us a member; the Guestbook join is
      // courtesy, and the admin service already published it.
      await this.concord.adoptBundle({
        community_id: community.communityId,
        owner: community.owner,
        owner_salt: community.ownerSalt,
        community_root: community.communityRoot,
        root_epoch: community.rootEpoch,
        control_pk: community.controlPk,
        control_root: community.controlRoot,
        channels: [],
        relays: community.relays,
        name: community.name,
      });

      this.cancelCreate();
      this.revision.update(value => value + 1);

      void this.router.navigate(['/c', community.communityId]);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  openSettings(): void {
    const metadata = this.control()?.metadata;

    this.settingsName.set(metadata?.name ?? this.communityName());
    this.settingsDescription.set(metadata?.description ?? '');
    this.settingsTimer.set(metadata?.message_expiration ?? 0);
    this.settingsIconUrl.set(typeof metadata?.icon === 'string' ? metadata.icon : '');
    this.settingsBannerUrl.set(typeof metadata?.banner === 'string' ? metadata.banner : '');
    this.settingsIconChanged.set(false);
    this.settingsBannerChanged.set(false);
    this.brokerInput.set(this.concord.voiceBroker());
    this.setView('settings');
  }

  async saveSettings(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state || this.busy()) return;

    this.busy.set(true);

    try {
      const metadata = {
        ...(state.metadata ?? { name: this.settingsName() }),
        name: this.settingsName().trim(),
        description: this.settingsDescription().trim(),
        message_expiration: this.settingsTimer() || 0,
      };

      if (this.settingsIconChanged()) metadata.icon = this.settingsIconUrl() || undefined;
      if (this.settingsBannerChanged()) metadata.banner = this.settingsBannerUrl() || undefined;

      await this.admin.updateMetadata(community, state, metadata);

      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
      this.snackBar.open('Community updated', undefined, { duration: 3000 });
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  async createChannel(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    const name = this.newChannelName().trim();

    if (!community || !state || !name || this.busy()) return;

    this.busy.set(true);

    try {
      const { channelId, key } = await this.admin.createChannel(community, state, {
        name,
        private: this.newChannelPrivate(),
      });

      // A private channel mints its own key, which we must hold to read it.
      if (key) {
        await this.concord.adoptBundle({
          community_id: community.communityId,
          owner: community.owner,
          owner_salt: community.ownerSalt,
          community_root: community.communityRoot,
          root_epoch: community.rootEpoch,
          control_pk: community.controlPk,
          control_root: community.controlRoot,
          channels: [{ id: channelId, key, epoch: 1, name }],
          relays: community.relays,
          name: community.name,
        });
      }

      this.newChannelName.set('');
      this.newChannelPrivate.set(false);

      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async deleteChannel(channel: CordChannel): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete #${channel.name}?`,
        message:
          'Deletion is terminal: the channel id is never reused. Existing history stays readable to anyone who already holds the key.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } satisfies ConfirmDialogData,
    });

    if (!(await firstValueFrom(dialogRef.afterClosed()))) return;

    try {
      await this.admin.deleteChannel(community, state, channel.channelId);
      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    }
  }

  openDissolveConfirmation(): void {
    if (this.isOwner() && !this.isDissolved()) this.showDissolveConfirmation.set(true);
  }

  async dissolveCommunity(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state || !this.isOwner() || this.busy()) return;

    this.busy.set(true);

    try {
      await this.admin.dissolveCommunity(community, state);
      await this.concord.loadCommunity(community.communityId, true);
      this.showDissolveConfirmation.set(false);
      this.revision.update(value => value + 1);
      this.snackBar.open('Community dissolved. It is now read-only.', 'Dismiss', { duration: 6000 });
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  // -------------------------------------------------------------------------
  // Moderation
  // -------------------------------------------------------------------------

  async ban(target: string): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Ban this member?',
        message:
          'They are silenced immediately for every honest client. Cutting their read access also needs a Refounding, which rotates the community key.',
        confirmText: 'Ban',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } satisfies ConfirmDialogData,
    });

    if (!(await firstValueFrom(dialogRef.afterClosed()))) return;

    try {
      // Strip their roles first, so their rank is gone before anything else.
      await this.admin.revokeRoles(community, state, target).catch(() => undefined);
      await this.admin.ban(community, state, [target]);

      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);

      this.snackBar.open(
        'Member banned and silenced. Re-found the community to revoke their access.',
        'Dismiss',
        { duration: 8000 }
      );
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    }
  }

  async unban(target: string): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state) return;

    try {
      await this.admin.unban(community, state, target);
      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    }
  }

  async kick(target: string): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state) return;

    try {
      await this.admin.revokeRoles(community, state, target).catch(() => undefined);
      await this.admin.kick(community, state, target);

      this.snackBar.open('Kick sent. A compliant client will leave on its own.', undefined, {
        duration: 5000,
      });
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    }
  }

  // -------------------------------------------------------------------------
  // Invites
  // -------------------------------------------------------------------------

  async mintInvite(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state || this.busy()) return;

    this.busy.set(true);

    try {
      const { url } = await this.invites.mintLink({ community, state });

      this.inviteResult.set(url);
      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  copyInvite(): void {
    const url = this.inviteResult();
    if (url) this.layout.copyToClipboard(url, 'invite link');
  }

  async sendDirectInvite(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    const raw = this.directInvitePubkey().trim();

    if (!community || !state || !raw || this.busy()) return;

    const recipient = this.toHexPubkey(raw);
    if (!recipient) {
      this.snackBar.open('That is not a valid npub or hex key', 'Dismiss', { duration: 5000 });
      return;
    }

    this.busy.set(true);

    try {
      await this.invites.sendDirectInvite({ community, state, recipient });

      this.directInvitePubkey.set('');
      this.snackBar.open(
        'Invite sent privately. It cannot be revoked \u2014 they hold the keys now.',
        undefined,
        { duration: 7000 }
      );
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  async searchDirectInviteProfiles(query: string): Promise<void> {
    this.directInvitePubkey.set(query);
    const trimmed = query.trim();

    if (!trimmed || this.toHexPubkey(trimmed)) {
      this.directInviteProfiles.set([]);
      return;
    }

    const following = this.following
      .toNostrRecords(this.following.searchProfiles(trimmed))
      .map(profile => profile.event.pubkey);
    const cached = await this.database.searchCachedProfiles(trimmed);

    if (this.directInvitePubkey().trim() !== trimmed) return;
    this.directInviteProfiles.set([...new Set([...following, ...cached.map(profile => profile.pubkey)])].slice(0, 8));
  }

  selectDirectInviteProfile(pubkey: string): void {
    this.directInvitePubkey.set(pubkey);
    this.directInviteProfiles.set([]);
  }

  private toHexPubkey(value: string): string | null {
    const trimmed = value.trim();
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') return decoded.data;
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
    } catch {
      return null;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Composer attachments
  // -------------------------------------------------------------------------

  private hasMediaServers(): boolean {
    if (this.mediaService.mediaServers().length > 0) return true;

    this.snackBar
      .open('You need to configure a media server first', 'Configure', { duration: 5000 })
      .onAction()
      .subscribe(() => void this.router.navigate(['/collections/media']));

    return false;
  }

  /** Append text to the composer, keeping it on its own line. */
  private appendToComposer(value: string): void {
    const current = this.messageText();
    const separator = current && !current.endsWith('\n') ? '\n' : '';

    this.messageText.set(current + separator + value);
    this.composer()?.nativeElement.focus();
  }

  openFileDialog(): void {
    if (!this.hasMediaServers()) return;
    this.mediaFileInput()?.nativeElement.click();
  }

  openEncryptedFileDialog(): void {
    if (!this.hasMediaServers()) return;
    this.encryptedFileInput()?.nativeElement.click();
  }

  /** Stage selected media for encrypted upload and optional local optimization. */
  async onMediaFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';

    if (files.length === 0) return;

    await this.stageCommunityAttachments(files);
  }

  /**
   * Upload a file encrypted, so the media server never sees its contents.
   *
   * The message itself is already end-to-end encrypted, but its attachments
   * live on an ordinary host — so the bytes are sealed with a per-file AES-GCM
   * key and the key travels in the message's own tags.
   */
  async onEncryptedFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file) await this.stageCommunityAttachments([file]);
  }

  private async stageCommunityAttachments(files: File[]): Promise<void> {
    if (this.messageText().trim()) {
      this.snackBar.open('Send the current message before adding encrypted attachments.', 'Dismiss', { duration: 4000 });
      return;
    }

    if (this.pendingCommunityAttachments().length > 0) {
      this.snackBar.open('Send or cancel the staged attachments first.', 'Dismiss', { duration: 4000 });
      return;
    }

    this.uploading.set(true);

    try {
      const staged = await Promise.all(files.map((file, index) => this.prepareCommunityAttachment(file, index)));
      this.pendingCommunityAttachments.set(staged);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.communityUploadStatus.set('');
      this.uploading.set(false);
    }
  }

  async onCommunityOptimizationChange(value: MediaOptimizationOptionValue): Promise<void> {
    const settings = getMediaUploadSettingsForOptimization(value);
    this.communityMediaUploadMode.set(settings.mode);
    this.communityCompressionStrength.set(settings.compressionStrength);

    const current = this.pendingCommunityAttachments();
    if (current.length === 0) return;

    this.uploading.set(true);
    try {
      const refreshed = await Promise.all(current.map((item, index) => this.prepareCommunityAttachment(item.sourceFile, index)));
      for (const item of current) URL.revokeObjectURL(item.objectUrl);
      this.pendingCommunityAttachments.set(refreshed);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.communityUploadStatus.set('');
      this.uploading.set(false);
    }
  }

  removePendingCommunityAttachment(id: string): void {
    const attachment = this.pendingCommunityAttachments().find(item => item.id === id);
    if (attachment) URL.revokeObjectURL(attachment.objectUrl);
    this.pendingCommunityAttachments.update(items => items.filter(item => item.id !== id));
  }

  clearPendingCommunityAttachments(): void {
    for (const attachment of this.pendingCommunityAttachments()) URL.revokeObjectURL(attachment.objectUrl);
    this.pendingCommunityAttachments.set([]);
  }

  async sendPendingCommunityAttachments(): Promise<void> {
    const attachments = this.pendingCommunityAttachments();
    if (attachments.length === 0 || this.uploading() || this.concord.sending()) return;

    this.uploading.set(true);

    try {
      for (const attachment of attachments) {
        const sent = await this.uploadEncryptedFile(attachment.file, false);
        if (!sent) return;
      }
      await this.send();
      this.clearPendingCommunityAttachments();
    } finally {
      this.communityUploadStatus.set('');
      this.uploading.set(false);
    }
  }

  private async prepareCommunityAttachment(file: File, index: number): Promise<PendingCommunityAttachment> {
    const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/');
    const prepared: PreparedUploadFile = isMedia
      ? await this.mediaProcessing.prepareFileForUpload(file, this.communityUploadSettings(), progress => {
        const suffix = progress.progress === undefined ? '' : ` ${Math.round(progress.progress * 100)}%`;
        this.communityUploadStatus.set(`${progress.message}${suffix}`);
      })
      : { file, uploadOriginal: true, wasProcessed: false };

    return {
      id: `${Date.now()}-${index}-${file.name}`,
      objectUrl: URL.createObjectURL(prepared.file),
      file: prepared.file,
      sourceFile: file,
      type: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : 'file',
      originalSize: file.size,
      processedSize: prepared.file.size,
    };
  }

  private communityUploadSettings(): MediaUploadSettings {
    return {
      mode: this.communityMediaUploadMode(),
      compressionStrength: this.communityCompressionStrength(),
    };
  }

  private async uploadEncryptedFile(file: File, manageUploadState = true): Promise<boolean> {
    if (!this.hasMediaServers()) return false;

    if (manageUploadState) this.uploading.set(true);

    try {
      const sourceBytes = await this.mediaService.getFileBytes(file);
      const key = crypto.getRandomValues(new Uint8Array(32));
      const nonce = crypto.getRandomValues(new Uint8Array(12));

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(key),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
          cryptoKey,
          toArrayBuffer(new Uint8Array(sourceBytes))
        )
      );

      const buffer = new ArrayBuffer(encrypted.byteLength);
      new Uint8Array(buffer).set(encrypted);

      // Ciphertext is not media. An opaque name keeps MediaService on the
      // generic upload endpoint instead of asking a server to transcode it.
      const encryptedFile = new File([buffer], 'encrypted-attachment.bin', {
        type: 'application/octet-stream',
      });
      const result = await this.mediaService.uploadFile(encryptedFile, false, []);

      if (result.status !== 'success' && result.status !== 'duplicate') {
        throw new Error(result.message || 'Upload failed');
      }

      const url = result.item?.url;
      if (!url) throw new Error('The media server returned no URL');

      // The same tag shape the app's encrypted DMs use, so every renderer in
      // Nostria — and this page's own attachment resolver — can open it.
      this.pendingTags.update(tags => [
        ...tags,
        ['encryption-algorithm', 'aes-gcm'],
        ['decryption-key', toHexString(key)],
        ['decryption-nonce', toHexString(nonce)],
        ['file-type', file.type || 'application/octet-stream'],
        ['alt', file.name],
        ['size', String(file.size)],
      ]);

      this.appendToComposer(url);
      return true;
    } catch (error) {
      this.snackBar.open(describe(error), 'Close', { duration: 6000 });
      return false;
    } finally {
      if (manageUploadState) this.uploading.set(false);
    }
  }

  async openMediaChooser(): Promise<void> {
    if (!this.hasMediaServers()) return;

    const { MediaChooserDialogComponent } = await import(
      '../../components/media-chooser-dialog/media-chooser-dialog.component'
    );
    type MediaChooserResult = import(
      '../../components/media-chooser-dialog/media-chooser-dialog.component'
    ).MediaChooserResult;

    const dialogRef = this.dialog.open(MediaChooserDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'media-chooser-dialog-panel'],
      width: '700px',
      maxWidth: '95vw',
      data: { multiple: true, mediaType: 'all' },
    });

    dialogRef.afterClosed().subscribe((result: MediaChooserResult | undefined) => {
      for (const item of result?.items ?? []) {
        if (item.url) this.appendToComposer(item.url);
      }
    });
  }

  async openGifPicker(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import(
      '../../components/emoji-picker/emoji-picker-dialog.component'
    );

    const dialogRef = this.dialog.open(EmojiPickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'emoji-picker-dialog-panel'],
      width: '400px',
      // `mode` selects reaction vs content; the GIF tab is chosen by activeTab.
      data: { title: 'GIFs', mode: 'content', activeTab: 'gifs' },
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (result) this.appendToComposer(result);
    });
  }

  async openMusicChooser(): Promise<void> {
    const { MusicChooserDialogComponent } = await import(
      '../../components/music-chooser-dialog/music-chooser-dialog.component'
    );
    type MusicChooserResult = import(
      '../../components/music-chooser-dialog/music-chooser-dialog.component'
    ).MusicChooserResult;

    const dialogRef = this.customDialog.open<
      typeof MusicChooserDialogComponent.prototype,
      MusicChooserResult
    >(MusicChooserDialogComponent, {
      title: 'Choose Music',
      width: '500px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.naddr) this.appendToComposer('nostr:' + result.naddr);
    });
  }

  async openReferencePicker(): Promise<void> {
    const { ArticleReferencePickerDialogComponent } = await import(
      '../../components/article-reference-picker-dialog/article-reference-picker-dialog.component'
    );
    type ArticleReferencePickerResult = import(
      '../../components/article-reference-picker-dialog/article-reference-picker-dialog.component'
    ).ArticleReferencePickerResult;

    const dialogRef = this.dialog.open(ArticleReferencePickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'article-reference-picker-dialog-panel'],
      width: '760px',
      maxWidth: '96vw',
    });

    dialogRef.afterClosed().subscribe((result: ArticleReferencePickerResult | undefined) => {
      for (const reference of result?.references ?? []) {
        if (reference?.trim()) this.appendToComposer('nostr:' + reference.replace(/^nostr:/, ''));
      }
    });
  }

  async recordAudioClip(): Promise<void> {
    if (!this.hasMediaServers()) return;

    const { AudioRecordDialogComponent } = await import(
      '../../pages/media/audio-record-dialog/audio-record-dialog.component'
    );

    const dialogRef = this.dialog.open(AudioRecordDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    dialogRef
      .afterClosed()
      .subscribe(async (result: { blob?: Blob } | undefined) => {
        if (!result?.blob) return;

        const file = new File([result.blob], 'voice-message.mp4', {
          type: result.blob.type || 'audio/mp4',
        });

        await this.uploadEncryptedFile(file);
      });
  }

  async recordVideoClip(): Promise<void> {
    if (!this.hasMediaServers()) return;

    const { VideoRecordDialogComponent } = await import(
      '../../pages/media/video-record-dialog/video-record-dialog.component'
    );

    const dialogRef = this.customDialog.open<
      typeof VideoRecordDialogComponent.prototype,
      VideoRecordDialogResult | null
    >(VideoRecordDialogComponent, {
      title: 'Record Video Clip',
      width: '600px',
      maxWidth: '95vw',
    });

    dialogRef.afterClosed$.subscribe(async ({ result }) => {
      if (result?.file) await this.uploadEncryptedFile(result.file);
    });
  }

  /** Insert an emoji at the caret, matching the messages composer. */
  insertEmoji(emoji: string): void {
    const textarea = this.composer()?.nativeElement;

    if (!textarea) {
      this.messageText.update(current => current + emoji);
      return;
    }

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const current = this.messageText();

    this.messageText.set(current.slice(0, start) + emoji + current.slice(end));

    queueMicrotask(() => {
      textarea.focus();
      const caret = start + emoji.length;
      textarea.setSelectionRange(caret, caret);
    });
  }

  insertGifUrl(url: string): void {
    this.appendToComposer(url);
  }

  async openEmojiPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import(
      '../../components/emoji-picker/emoji-picker-dialog.component'
    );

    const dialogRef = this.dialog.open(EmojiPickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'emoji-picker-dialog-panel'],
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (!result) return;

      if (result.startsWith('http')) this.insertGifUrl(result);
      else this.insertEmoji(result);
    });
  }

  /** Tags staged by attachments, consumed when the message is sent. */
  takePendingTags(): string[][] {
    const tags = this.pendingTags();
    this.pendingTags.set([]);
    return tags;
  }

  // -------------------------------------------------------------------------
  // Pins (CORD-04 §7)
  // -------------------------------------------------------------------------

  isPinned(message: CordMessage): boolean {
    return this.pins().some(pin => pin.id === message.id);
  }

  async togglePin(message: CordMessage): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    const channel = this.activeChannel();
    if (!community || !state || !channel || this.busy()) return;

    if (this.pinsUnavailable()) {
      this.snackBar.open(
        'This channel\u2019s pins were sealed under a key you never held, so they cannot be changed here.',
        'Dismiss',
        { duration: 7000 }
      );
      return;
    }

    const pinned = this.isPinned(message);

    if (!pinned && this.pins().length >= this.admin.maxPins) {
      this.snackBar.open(`A channel can hold at most ${this.admin.maxPins} pins.`, 'Dismiss', {
        duration: 5000,
      });
      return;
    }

    if (!pinned && !message.seal) {
      this.snackBar.open('This message cannot be pinned: its proof is unavailable.', 'Dismiss', {
        duration: 5000,
      });
      return;
    }

    this.busy.set(true);

    try {
      const built = this.concord.buildPinList(community.communityId, channel.channelId, {
        pin: pinned ? undefined : message,
        unpin: pinned ? message.id : undefined,
      });

      if (!built || !built.readable) {
        throw new Error('The current pin list could not be read, so it must not be replaced');
      }

      await this.admin.setPins(community, state, channel.channelId, built.content, {
        couldRead: true,
      });

      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  /** Remove a pin by its verified rumor id, without needing the message. */
  async unpin(id: string): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    const channel = this.activeChannel();
    if (!community || !state || !channel || this.busy()) return;

    this.busy.set(true);

    try {
      const built = this.concord.buildPinList(community.communityId, channel.channelId, {
        unpin: id,
      });

      if (!built || !built.readable) {
        throw new Error('The current pin list could not be read, so it must not be replaced');
      }

      await this.admin.setPins(community, state, channel.channelId, built.content, {
        couldRead: true,
      });

      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  /** Jump to a pinned message when it is in the loaded timeline. */
  scrollToPin(id: string): void {
    const rootId = this.threads().rootOf.get(id);
    if (rootId && !this.isThreadExpanded(rootId)) {
      this.expandThread(rootId);
      setTimeout(() => this.scrollToElement(id));
      return;
    }

    this.scrollToElement(id);
  }

  private scrollToElement(id: string): void {
    const element = document.getElementById(`cord-msg-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('flash');
      setTimeout(() => element.classList.remove('flash'), 1200);
    } else {
      this.snackBar.open('That message is not in the loaded history.', undefined, {
        duration: 3000,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Voice (CORD-07)
  // -------------------------------------------------------------------------

  readonly inCall = computed(
    () => this.voice.isConnected() && this.voice.activeChannelId() === this.channelId()
  );

  saveBroker(): void {
    this.concord.setVoiceBroker(this.brokerInput());
    this.snackBar.open('Call broker saved', undefined, { duration: 3000 });
  }

  async joinCall(): Promise<void> {
    const community = this.activeCommunity();
    const channel = this.activeChannel();
    if (!community || !channel) return;

    const broker = this.concord.voiceBroker().trim();

    if (!broker) {
      this.snackBar.open(
        'Set a call broker in Settings first \u2014 Concord defines no default.',
        'Dismiss',
        { duration: 7000 }
      );
      return;
    }

    await this.voice.join(community, channel, broker);

    const error = this.voice.error();
    if (error) this.snackBar.open(error, 'Dismiss', { duration: 7000 });
  }

  async leaveCall(): Promise<void> {
    const community = this.activeCommunity();
    const channel = this.activeChannel();
    await this.voice.leave(community, channel);
  }

  // -------------------------------------------------------------------------
  // Refounding (CORD-06)
  // -------------------------------------------------------------------------

  /**
   * Rotate the community key so removed members lose read access.
   *
   * A Ban silences instantly and for free; this is the separate, heavier step
   * that actually revokes access, and it is why the ban flow only promises
   * silencing until this runs.
   */
  async refound(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state || this.refounding()) return;

    const survivors = this.members()
      .filter(member => !state.banned.has(member.pubkey))
      .map(member => ({
        pubkey: member.pubkey,
        staff: this.concord.isStaffHere(community.communityId) && member.pubkey === this.pubkey(),
      }));

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Re-found this community?',
        message:
          `The community key will be rotated and delivered to ${survivors.length} member(s). ` +
          'Anyone not on that list permanently loses access to everything published from now on. ' +
          'This cannot be undone.',
        confirmText: 'Re-found',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } satisfies ConfirmDialogData,
    });

    if (!(await firstValueFrom(dialogRef.afterClosed()))) return;

    this.refounding.set(true);

    try {
      const result = await this.rekey.refound({ community, state, survivors });

      // Adopt the new keys locally so this device follows its own rotation.
      await this.concord.adoptBundle({
        community_id: community.communityId,
        owner: community.owner,
        owner_salt: community.ownerSalt,
        community_root: result.newRoot,
        root_epoch: result.newEpoch,
        control_root: result.newControlRoot,
        channels: community.channelKeys,
        relays: community.relays,
        name: community.name,
      });

      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);

      this.snackBar.open(
        `Re-founded at epoch ${result.newEpoch}. Removed members can no longer read new messages.`,
        undefined,
        { duration: 8000 }
      );
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 8000 });
    } finally {
      this.refounding.set(false);
    }
  }

  /**
   * Group reactions by emoji, keeping the custom URL so shortcodes render as
   * images rather than as literal `:name:` text.
   */
  reactionSummary(message: CordMessage): { emoji: string; count: number; url?: string }[] {
    const counts = new Map<string, { count: number; url?: string }>();

    for (const reaction of message.reactions ?? []) {
      const existing = counts.get(reaction.emoji);
      counts.set(reaction.emoji, {
        count: (existing?.count ?? 0) + 1,
        url: existing?.url ?? reaction.url,
      });
    }

    return [...counts.entries()].map(([emoji, entry]) => ({
      emoji,
      count: entry.count,
      url: entry.url,
    }));
  }

  /**
   * Image and video attachments on a message.
   *
   * Clients disagree on how to describe these, so every shape seen in the wild
   * is accepted: NIP-92 `imeta` tags, Nostria's flat `decryption-key` tags, and
   * bare URLs in the content. Encrypted ones are decrypted before display,
   * because the URL by itself serves ciphertext.
   */
  attachmentsFor(message: CordMessage): { src: string; alt: string; video: boolean; encrypted: boolean }[] {
    this.media.revision();
    const sourceUrls: string[] = [];

    const tags = message.rumor.tags;
    const out: { src: string; alt: string; video: boolean; encrypted: boolean }[] = [];
    const seen = new Set<string>();

    const add = (raw: {
      url?: string;
      mime?: string;
      key?: string;
      nonce?: string;
      algorithm?: string;
      alt?: string;
    }) => {
      if (!raw.url || seen.has(raw.url)) return;
      seen.add(raw.url);
      sourceUrls.push(raw.url);

      const isVideo = (raw.mime ?? '').startsWith('video/');
      const isImage = (raw.mime ?? '').startsWith('image/');

      // With no declared mime, fall back to the extension.
      const looksLikeMedia =
        isImage || isVideo || /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov)(\?|$)/i.test(raw.url);

      if (!looksLikeMedia) return;

      const src = this.media.resolveAttachment({
        url: raw.url,
        key: raw.key,
        nonce: raw.nonce,
        algorithm: raw.algorithm,
      });

      // Still decrypting; it will appear once the blob resolves.
      if (!src) return;

      out.push({
        src,
        alt: raw.alt ?? 'attachment',
        video: isVideo,
        encrypted: Boolean(raw.key && raw.nonce),
      });
    };

    // NIP-92: one tag per file, "key value" pairs after the tag name.
    for (const tag of tags) {
      if (tag[0] !== 'imeta') continue;

      const fields: Record<string, string> = {};
      for (const pair of tag.slice(1)) {
        const index = pair.indexOf(' ');
        if (index > 0) fields[pair.slice(0, index)] = pair.slice(index + 1);
      }

      add({
        url: fields['url'],
        mime: fields['m'],
        // Different clients spell these differently; accept the variants.
        key: fields['decryption-key'] ?? fields['key'],
        nonce: fields['decryption-nonce'] ?? fields['nonce'] ?? fields['iv'],
        algorithm: fields['encryption-algorithm'] ?? fields['algo'],
        alt: fields['alt'],
      });
    }

    // Nostria's flat form: the content is the URL, the tags carry the key.
    const flatKey = tags.find(tag => tag[0] === 'decryption-key')?.[1];
    const flatNonce = tags.find(tag => tag[0] === 'decryption-nonce')?.[1];
    const flatType = tags.find(tag => tag[0] === 'file-type')?.[1];

    if (flatKey && flatNonce) {
      const url = (message.content || '').trim();
      if (/^https?:\/\/\S+$/.test(url)) {
        add({
          url,
          mime: flatType,
          key: flatKey,
          nonce: flatNonce,
          algorithm: tags.find(tag => tag[0] === 'encryption-algorithm')?.[1],
          alt: tags.find(tag => tag[0] === 'alt')?.[1],
        });
      }
    }

    // Plain media URLs in the text, for the unencrypted case.
    for (const match of (message.editedContent || message.content).matchAll(/https?:\/\/\S+/g)) {
      add({ url: match[0].replace(/[),.]+$/, '') });
    }

    this.attachmentSources.set(message.id, sourceUrls);
    return out;
  }

  /** Source URLs behind a message's attachments, for stripping from the text. */
  private readonly attachmentSources = new Map<string, string[]>();

  private attachmentUrls(message: CordMessage): string[] {
    return this.attachmentSources.get(message.id) ?? [];
  }

  /**
   * The message text with attachment URLs removed.
   *
   * The attachments are rendered separately above, so leaving their URLs in the
   * text makes the shared content component render each image a second time —
   * and for an encrypted one it renders a broken image, since that URL serves
   * ciphertext.
   */
  textFor(message: CordMessage): string {
    const raw = message.editedContent || message.content;
    const attachments = this.attachmentsFor(message);
    if (attachments.length === 0) return raw;

    const urls = new Set(this.attachmentUrls(message));
    let text = raw;

    for (const url of urls) {
      text = text.split(url).join('');
    }

    return text.trim();
  }

  /** Open an attachment in the app's media preview dialog. */
  openAttachment(src: string, alt: string): void {
    const mime = this.media.mimeFor(src);

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: src,
        mediaType: mime.startsWith('video/') ? 'video' : 'image',
        mediaTitle: alt || 'Attachment',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  /** Open Graph previews keyed by message id. */
  private readonly previews = signal<Record<string, OpenGraphData[]>>({});
  private readonly previewRequested = new Set<string>();

  /**
   * Rich link previews for a message, matching how the feed renders them.
   *
   * Fetched lazily on first render and cached per message, so a long channel
   * does not fan out into hundreds of metadata requests at once.
   */
  previewsFor(message: CordMessage): OpenGraphData[] {
    if (!this.settings.settings().socialSharingPreview) return [];

    const cached = this.previews()[message.id];
    if (cached) return cached;

    if (!this.previewRequested.has(message.id)) {
      this.previewRequested.add(message.id);
      void this.loadPreviews(message);
    }

    return [];
  }

  private async loadPreviews(message: CordMessage): Promise<void> {
    // Media URLs are rendered inline by the message content itself, so only
    // ordinary links get a card.
    const attachmentUrls = new Set(this.attachmentUrls(message));
    const urls = [...(message.editedContent || message.content).matchAll(/https?:\/\/\S+/g)]
      .map(match => match[0].replace(/[),.]+$/, ''))
      .filter(url => !attachmentUrls.has(url))
      .filter(url => !/\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|mp3|ogg|wav)(\?|$)/i.test(url))
      .slice(0, 3);

    if (urls.length === 0) return;

    try {
      const results = await this.openGraph.getMultipleOpenGraphData(urls);

      this.previews.update(current => ({
        ...current,
        [message.id]: results.map(result => ({ ...result, loading: false })),
      }));
    } catch (error) {
      this.logger.debug('[Concord] Could not load link previews', error);
    }
  }

  private scrollToBottom(): void {
    const element = this.scroller()?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }

  private async syncRoute(communityId: string | null, channelId: string | null): Promise<void> {
    if (!communityId) {
      this.concord.closeSubscriptions();
      this.mobilePane.set('communities');

      // Resume where the user left off instead of showing an empty shell.
      const last = this.recallLocation();
      if (last?.communityId && this.concord.getCommunity(last.communityId)) {
        void this.router.navigate(['/c', last.communityId], { replaceUrl: true });
      }
      return;
    }

    if (!this.concord.getCommunity(communityId)) {
      this.snackBar.open('You do not hold keys for that community', 'Dismiss', { duration: 5000 });
      void this.router.navigate(['/c']);
      return;
    }

    await this.concord.loadCommunity(communityId, true);
    this.revision.update(value => value + 1);

    if (!channelId) {
      this.concord.closeSubscriptions();
      this.mobilePane.set('channels');

      // Drop straight into the last channel used here, or the first readable
      // one, the way Discord does.
      const channels = this.concord.getChannels(communityId);
      const remembered = this.recallLocation()?.channels?.[communityId];
      const target = channels.find(channel => channel.channelId === remembered) ?? channels[0];

      if (target) {
        void this.router.navigate(['/c', communityId, target.channelId], { replaceUrl: true });
      }
      return;
    }

    this.mobilePane.set('content');
    this.rememberLocation(communityId, channelId);

    try {
      await this.concord.openChannel(communityId, channelId);
    } catch (error) {
      this.logger.error('[Encrypted] Failed to open channel', error);
    }

    this.revision.update(value => value + 1);
  }

  private rememberLocation(communityId: string, channelId: string): void {
    const stored = this.recallLocation() ?? { communityId: null, channels: {} };

    this.writeStore(LAST_LOCATION_STORAGE_KEY, {
      communityId,
      channels: { ...stored.channels, [communityId]: channelId },
    } satisfies CordLastLocation);
  }

  private recallLocation(): CordLastLocation | null {
    const stored = this.readStore<CordLastLocation | null>(LAST_LOCATION_STORAGE_KEY, null);
    return stored?.channels ? stored : null;
  }

  private readStore<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;

    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeStore(key: string, value: unknown): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is best-effort; losing the last location is not worth an error.
    }
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toHexString(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
