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
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
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
import { ConcordService } from '../../services/concord.service';
import { ConcordAdminService } from '../../services/concord/concord-admin.service';
import { ConcordInviteService } from '../../services/concord/concord-invite.service';
import { ConcordListsService } from '../../services/concord/concord-lists.service';
import { ConcordMediaService } from '../../services/concord/concord-media.service';
import { ConcordRekeyService } from '../../services/concord/concord-rekey.service';
import { ConcordVoiceService } from '../../services/concord/concord-voice.service';
import {
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

interface MessageCluster {
  key: string;
  pubkey: string;
  timestamp: number;
  messages: CordMessage[];
}

type MobilePane = 'communities' | 'channels' | 'content';
type ChannelView = 'chat' | 'members' | 'settings';

@Component({
  selector: 'app-encrypted',
  imports: [
    FormsModule,
    DatePipe,
    MatBadgeModule,
    MatButtonModule,
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

  readonly layout = inject(LayoutService);
  readonly concord = inject(ConcordService);
  readonly admin = inject(ConcordAdminService);
  readonly invites = inject(ConcordInviteService);
  readonly lists = inject(ConcordListsService);
  readonly media = inject(ConcordMediaService);
  readonly rekey = inject(ConcordRekeyService);
  readonly voice = inject(ConcordVoiceService);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

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
  readonly inviteResult = signal<string | null>(null);
  readonly directInvitePubkey = signal('');
  readonly busy = signal(false);
  readonly brokerInput = signal('');
  readonly refounding = signal(false);
  readonly showPins = signal(false);

  readonly permissionCatalogue = CORD_PERMISSIONS;

  /** Bumped after service mutations so derived views re-evaluate. */
  private readonly revision = signal(0);

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

  readonly clusters = computed<MessageCluster[]>(() => {
    const clusters: MessageCluster[] = [];

    for (const message of this.messages()) {
      const last = clusters.at(-1);
      const sameAuthor = last?.pubkey === message.pubkey;
      const within =
        !!last && message.timestamp - (last.messages.at(-1)?.timestamp ?? 0) < GROUPING_WINDOW_MS;

      if (last && sameAuthor && within && message.kind !== 1111) {
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
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.communityId.set(params.get('communityId'));
      this.channelId.set(params.get('channelId'));
    });
  }

  ngOnDestroy(): void {
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

    const sent = await this.concord.sendMessage(community, channel, content, { replyTo });

    if (!sent) {
      this.messageText.set(content);
      this.replyingTo.set(replyTo ?? null);
      this.snackBar.open('Could not send that message', 'Dismiss', { duration: 5000 });
    } else {
      this.revision.update(value => value + 1);
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
    return id ? this.messages().find(message => message.id === id) : undefined;
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
    this.brokerInput.set(this.concord.voiceBroker());
    this.setView('settings');
  }

  async saveSettings(): Promise<void> {
    const community = this.activeCommunity();
    const state = this.control();
    if (!community || !state || this.busy()) return;

    this.busy.set(true);

    try {
      await this.admin.updateMetadata(community, state, {
        ...(state.metadata ?? { name: this.settingsName() }),
        name: this.settingsName().trim(),
        description: this.settingsDescription().trim(),
        message_expiration: this.settingsTimer() || 0,
      });

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

      await this.concord.loadCommunity(community.communityId, true);
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

      await this.concord.loadCommunity(community.communityId, true);
      this.revision.update(value => value + 1);
    } catch (error) {
      this.snackBar.open(describe(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  /** Jump to a pinned message when it is in the loaded timeline. */
  scrollToPin(id: string): void {
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
  attachmentsFor(message: CordMessage): { src: string; alt: string; video: boolean }[] {
    this.media.revision();
    const sourceUrls: string[] = [];

    const tags = message.rumor.tags;
    const out: { src: string; alt: string; video: boolean }[] = [];
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

      out.push({ src, alt: raw.alt ?? 'attachment', video: isVideo });
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
    const urls = [...(message.editedContent || message.content).matchAll(/https?:\/\/\S+/g)]
      .map(match => match[0].replace(/[),.]+$/, ''))
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
      return;
    }

    if (!this.concord.getCommunity(communityId)) {
      this.snackBar.open('You do not hold keys for that community', 'Dismiss', { duration: 5000 });
      void this.router.navigate(['/c']);
      return;
    }

    await this.concord.loadCommunity(communityId);
    this.revision.update(value => value + 1);

    if (!channelId) {
      this.concord.closeSubscriptions();
      this.mobilePane.set('channels');

      // Drop straight into the first readable channel, the way Discord does.
      const first = this.concord.getChannels(communityId)[0];
      if (first) {
        void this.router.navigate(['/c', communityId, first.channelId], { replaceUrl: true });
      }
      return;
    }

    this.mobilePane.set('content');

    try {
      await this.concord.openChannel(communityId, channelId);
    } catch (error) {
      this.logger.error('[Encrypted] Failed to open channel', error);
    }

    this.revision.update(value => value + 1);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
