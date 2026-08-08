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
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { nip19 } from 'nostr-tools';

import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../../components/message-content/message-content.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { Nip29GroupsListService } from '../../services/nip29-groups-list.service';
import { Nip29LivekitService } from '../../services/nip29-livekit.service';
import { Nip29Service, SUGGESTED_NIP29_SERVERS } from '../../services/nip29.service';
import {
  NIP29_KIND_CHAT,
  NIP29_KIND_THREAD,
  Nip29Group,
  Nip29GroupNode,
  Nip29Message,
  Nip29Server,
} from '../../interfaces/nip29';

/** Consecutive messages from the same author within this window are grouped. */
const GROUPING_WINDOW_SECONDS = 5 * 60;

/** A run of consecutive messages by the same author, Discord-style. */
interface MessageCluster {
  key: string;
  pubkey: string;
  createdAt: number;
  messages: Nip29Message[];
}

/** Which pane is visible on narrow screens. */
type MobilePane = 'servers' | 'channels' | 'content';

/** Which content view is active for the open group. */
type ChannelView = 'chat' | 'threads' | 'members' | 'voice';

/** Remembers the last view used per group, so returning feels continuous. */
const VIEW_STORAGE_KEY = 'nostria-nip29-last-view-v1';
/** Remembers the last group opened, so the section resumes where you left it. */
const LAST_GROUP_STORAGE_KEY = 'nostria-nip29-last-group-v1';

@Component({
  selector: 'app-servers',
  imports: [
    FormsModule,
    DatePipe,
    NgTemplateOutlet,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatCheckboxModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    MessageContentComponent,
    AgoPipe,
  ],
  templateUrl: './servers.component.html',
  styleUrl: './servers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServersComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);

  readonly layout = inject(LayoutService);
  readonly nip29 = inject(Nip29Service);
  readonly voice = inject(Nip29LivekitService);
  readonly groupsList = inject(Nip29GroupsListService);

  private readonly messageScroller = viewChild<ElementRef<HTMLElement>>('messageScroller');

  readonly suggestedServers = SUGGESTED_NIP29_SERVERS;

  // -- Route state ------------------------------------------------------------
  readonly serverSlug = signal<string | null>(null);
  readonly groupId = signal<string | null>(null);

  // -- UI state ---------------------------------------------------------------
  readonly mobilePane = signal<MobilePane>('servers');
  readonly view = signal<ChannelView>('chat');
  readonly showAddServer = signal(false);
  readonly newServerUrl = signal('');
  readonly collapsedCategories = signal<Set<string>>(new Set());

  /** Relay whose full group catalogue is being browsed in the add panel. */
  readonly browsingRelay = signal<string | null>(null);
  readonly browseFilter = signal('');

  /** Right-hand member list, Discord style. Independent of the Members view. */
  readonly showMemberRail = signal(true);

  // -- Admin state ------------------------------------------------------------
  readonly showCreateGroup = signal(false);
  readonly showGroupSettings = signal(false);
  readonly showAdvanced = signal(false);
  readonly newGroupId = signal('');
  readonly newGroupName = signal('');
  readonly newGroupAbout = signal('');
  readonly newGroupPicture = signal('');
  readonly newGroupBanner = signal('');
  readonly newGroupPrivate = signal(false);
  readonly newGroupRestricted = signal(false);
  readonly newGroupHidden = signal(false);
  readonly newGroupClosed = signal(false);
  readonly newGroupLivekit = signal(false);
  readonly newGroupRelay = signal('');
  readonly addMemberPubkey = signal('');
  readonly addMemberRoles = signal('');
  readonly inviteResult = signal<string | null>(null);
  readonly busy = signal(false);

  /**
   * Group identifiers become the `d` tag of the relay's kind:39000 and appear
   * in URLs, so keep them to a conservative character set.
   */
  readonly groupIdError = computed<string | null>(() => {
    const id = this.newGroupId().trim();
    if (!id) return null;

    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      return 'Use only letters, numbers, dots, dashes and underscores.';
    }

    if (id.length > 64) return 'Keep the identifier under 64 characters.';

    const relay = this.newGroupRelay();
    if (relay && this.nip29.getGroup(relay, id)) {
      return 'A group with this identifier already exists on this relay.';
    }

    return null;
  });

  // -- Composer state ---------------------------------------------------------
  readonly messageText = signal('');
  readonly replyingTo = signal<Nip29Message | null>(null);
  readonly inviteCode = signal('');
  readonly joining = signal(false);

  // -- Thread state -----------------------------------------------------------
  readonly activeThread = signal<Nip29Message | null>(null);
  readonly threadReplyText = signal('');
  readonly composingThread = signal(false);
  readonly newThreadSubject = signal('');
  readonly newThreadBody = signal('');

  /** Bumped whenever service state changes so computed views re-evaluate. */
  private readonly revision = signal(0);

  readonly pubkey = computed(() => this.accountState.pubkey());

  /** Primary rail entities: the groups the user has joined. */
  readonly joinedGroups = computed<Nip29Group[]>(() => {
    this.revision();
    return this.nip29.joinedGroups();
  });

  readonly servers = computed<Nip29Server[]>(() => this.nip29.serverRail());

  readonly activeServer = computed<Nip29Server | undefined>(() => {
    const slug = this.serverSlug();
    return slug ? this.nip29.getServerBySlug(slug) : undefined;
  });

  /**
   * Subgroups of the open group. NIP-29 groups can nest, so a group may still
   * act as a category containing further channels.
   */
  readonly subGroups = computed<Nip29GroupNode[]>(() => {
    this.revision();
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return [];

    return this.nip29
      .buildTree(server.url)
      .filter(node => node.group.id === group.id)
      .flatMap(node => node.children);
  });

  isJoined(group: Nip29Group): boolean {
    return this.groupsList.isSaved(group.relay, group.id);
  }

  readonly activeGroup = computed<Nip29Group | undefined>(() => {
    this.revision();
    const server = this.activeServer();
    const id = this.groupId();
    return server && id ? this.nip29.getGroup(server.url, id) : undefined;
  });

  readonly details = computed(() => {
    this.revision();
    const server = this.activeServer();
    const id = this.groupId();
    return server && id ? this.nip29.getDetails(server.url, id) : undefined;
  });

  readonly membership = computed(() => {
    this.revision();
    const server = this.activeServer();
    const id = this.groupId();
    return server && id ? this.nip29.getMembership(server.url, id) : 'unknown';
  });

  readonly isMember = computed(() => this.membership() === 'member');

  readonly isAdmin = computed(() => {
    const server = this.activeServer();
    const id = this.groupId();
    return !!server && !!id && this.nip29.isAdmin(server.url, id, this.pubkey());
  });

  readonly isSaved = computed(() => {
    const server = this.activeServer();
    const id = this.groupId();
    return !!server && !!id && this.groupsList.isSaved(server.url, id);
  });

  /** Group supports chat messages (kind 9). */
  readonly supportsChat = computed(() => this.supportsKind(NIP29_KIND_CHAT));

  /** Group supports threads (kind 11). */
  readonly supportsThreads = computed(() => this.supportsKind(NIP29_KIND_THREAD));

  readonly supportsVoice = computed(() => this.activeGroup()?.hasLivekit === true);

  readonly messages = computed<Nip29Message[]>(() => {
    this.revision();
    const server = this.activeServer();
    const id = this.groupId();
    return server && id ? this.nip29.getMessages(server.url, id) : [];
  });

  readonly threads = computed<Nip29Message[]>(() => {
    this.revision();
    const server = this.activeServer();
    const id = this.groupId();
    return server && id ? this.nip29.getThreads(server.url, id) : [];
  });

  readonly threadReplies = computed<Nip29Message[]>(() => {
    this.revision();
    const thread = this.activeThread();
    return thread ? this.nip29.getThreadReplies(thread.id) : [];
  });

  /** Messages grouped into Discord-style clusters. */
  readonly clusters = computed<MessageCluster[]>(() => {
    const clusters: MessageCluster[] = [];

    for (const message of this.messages()) {
      const last = clusters.at(-1);
      const sameAuthor = last?.pubkey === message.pubkey;
      const withinWindow =
        !!last && message.createdAt - (last.messages.at(-1)?.createdAt ?? 0) < GROUPING_WINDOW_SECONDS;

      if (last && sameAuthor && withinWindow && !message.replyTo) {
        last.messages.push(message);
      } else {
        clusters.push({
          key: message.id,
          pubkey: message.pubkey,
          createdAt: message.createdAt,
          messages: [message],
        });
      }
    }

    return clusters;
  });

  readonly members = computed<string[]>(() => this.details()?.members ?? []);

  readonly admins = computed(() => this.details()?.admins ?? []);

  readonly adminPubkeys = computed(() => new Set(this.admins().map(admin => admin.pubkey)));

  /** Members that are not admins, so the list can be split like Discord roles. */
  readonly regularMembers = computed(() => {
    const adminSet = this.adminPubkeys();
    return this.members().filter(pubkey => !adminSet.has(pubkey));
  });

  /** Every public group across all known relays, for the discover view. */
  readonly discoverGroups = computed<Nip29Group[]>(() => {
    this.revision();
    const filter = this.browseFilter().trim().toLowerCase();
    const relay = this.browsingRelay();

    const relays = relay ? [relay] : this.servers().map(server => server.url);
    const groups = relays.flatMap(url => this.nip29.getGroups(url)).filter(group => !group.isHidden);

    const matched = filter
      ? groups.filter(
          group =>
            group.name.toLowerCase().includes(filter) ||
            group.id.toLowerCase().includes(filter) ||
            (group.about ?? '').toLowerCase().includes(filter)
        )
      : groups;

    return matched.sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Pinned messages surfaced at the top of the chat. */
  readonly pinnedMessages = computed<Nip29Message[]>(() => {
    const pinned = this.details()?.pinned ?? [];
    if (pinned.length === 0) return [];

    const ids = new Set(pinned);
    return this.messages().filter(message => ids.has(message.id));
  });

  /** Roles the relay advertises for this group (kind:39003). */
  readonly availableRoles = computed(() => this.details()?.roles ?? []);

  readonly voiceParticipants = computed(() => this.voice.participants());

  readonly canPost = computed(() => {
    const group = this.activeGroup();
    if (!group) return false;
    if (!this.pubkey()) return false;
    return !group.isRestricted || this.isMember();
  });

  constructor() {
    // Keep the URL, the loaded data and the mobile pane in sync.
    effect(() => {
      const slug = this.serverSlug();
      const id = this.groupId();

      untracked(() => {
        void this.syncRouteState(slug, id);
      });
    });

    // Auto-scroll the chat to the newest message.
    effect(() => {
      const count = this.messages().length;
      const view = this.view();

      untracked(() => {
        if (view !== 'chat' || count === 0) return;
        queueMicrotask(() => this.scrollToBottom());
      });
    });
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.serverSlug.set(params.get('slug'));
      this.groupId.set(params.get('groupId'));
    });

    this.route.queryParamMap.subscribe(params => {
      const invite = params.get('invite');
      if (invite) this.inviteCode.set(invite);
    });
  }

  ngOnDestroy(): void {
    this.nip29.closeSubscriptions();
    void this.voice.leave();
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Open a joined group. The view it was last left on is restored, so moving
   * between groups resumes each conversation where it was.
   */
  selectGroup(group: Nip29Group): void {
    this.activeThread.set(null);
    this.replyingTo.set(null);
    this.showAddServer.set(false);
    this.mobilePane.set('content');

    const slug = this.nip29.serverSlug(group.relay);
    void this.router.navigate([...this.basePath(), slug, group.id]);
  }

  /** Open the browse panel scoped to one relay's group catalogue. */
  async browseServer(server: Nip29Server): Promise<void> {
    this.showAddServer.set(true);
    this.showCreateGroup.set(false);
    this.browsingRelay.set(server.url);
    this.mobilePane.set('content');

    await this.nip29.loadGroups(server.url);
    this.revision.update(value => value + 1);
  }

  /**
   * The route prefix currently in use. Deep links opened through the short
   * `/g/<relay>/<group>` form keep that form while navigating, and links opened
   * from the Chats menu stay under `/chats/servers`.
   */
  private basePath(): string[] {
    const url = this.router.url;
    return url === '/g' || url.startsWith('/g/') ? ['/g'] : ['/chats/servers'];
  }

  backToServers(): void {
    this.mobilePane.set('servers');
  }

  backToChannels(): void {
    this.mobilePane.set('channels');
  }

  toggleCategory(groupId: string): void {
    this.collapsedCategories.update(collapsed => {
      const next = new Set(collapsed);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  isCollapsed(groupId: string): boolean {
    return this.collapsedCategories().has(groupId);
  }

  setView(view: ChannelView): void {
    this.view.set(view);
    this.mobilePane.set('content');
    this.rememberView(view);

    if (view === 'threads') {
      void this.refreshThreads();
    }
  }

  /** Persist the active view so re-opening this group returns to it. */
  private rememberView(view: ChannelView): void {
    const server = this.activeServer();
    const id = this.groupId();
    if (!server || !id) return;

    const stored = this.readStore<Record<string, ChannelView>>(VIEW_STORAGE_KEY, {});
    stored[this.nip29.groupKey(server.url, id)] = view;
    this.writeStore(VIEW_STORAGE_KEY, stored);
  }

  private recallView(relayUrl: string, groupId: string): ChannelView | null {
    const stored = this.readStore<Record<string, ChannelView>>(VIEW_STORAGE_KEY, {});
    return stored[this.nip29.groupKey(relayUrl, groupId)] ?? null;
  }

  /** Remember the last group opened so the section resumes on return. */
  private rememberGroupLocation(slug: string, groupId: string): void {
    this.writeStore(LAST_GROUP_STORAGE_KEY, { slug, groupId });
  }

  private recallGroupLocation(): { slug: string; groupId: string } | null {
    return this.readStore<{ slug: string; groupId: string } | null>(
      LAST_GROUP_STORAGE_KEY,
      null
    );
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
      // Storage is best-effort; losing the last view is not worth an error.
    }
  }

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  /**
   * Accepts a relay URL or a NIP-29 `naddr` group reference (optionally with an
   * `?invite=` suffix) and navigates to the resulting server or channel.
   */
  async addServer(): Promise<void> {
    const raw = this.newServerUrl().trim();
    if (!raw) return;

    if (raw.toLowerCase().startsWith('naddr')) {
      this.openGroupReference(raw);
      return;
    }

    const url = raw.startsWith('wss://') || raw.startsWith('ws://') ? raw : `wss://${raw}`;
    const normalized = this.nip29.addServer(url);

    if (!normalized) {
      this.snackBar.open('That does not look like a valid relay address', 'Dismiss', {
        duration: 4000,
      });
      return;
    }

    this.newServerUrl.set('');

    // Stay in the discover panel and show what this relay hosts.
    const server = this.nip29.getServer(normalized);
    if (server) await this.browseServer(server);
  }

  removeServer(server: Nip29Server): void {
    this.nip29.removeServer(server.url);

    if (this.activeServer()?.url === server.url) {
      void this.router.navigate(this.basePath());
    }
  }

  async refreshServer(): Promise<void> {
    const server = this.activeServer();
    if (!server) return;

    await this.nip29.loadGroups(server.url, true);
    await this.nip29.loadServerInfo(server.url, true);
    this.revision.update(value => value + 1);
  }

  /** Resolve a `naddr1...` group reference and navigate to it. */
  private openGroupReference(reference: string): void {
    const [identifier, query] = reference.split('?');
    const invite = new URLSearchParams(query ?? '').get('invite');

    try {
      const decoded = nip19.decode(identifier.trim());
      if (decoded.type !== 'naddr') throw new Error('Not a group reference');

      const pointer = decoded.data;
      const relay = pointer.relays?.[0];

      if (!relay) throw new Error('The group reference has no relay hint');

      const normalized = this.nip29.addServer(relay);
      if (!normalized) throw new Error('The group reference has an invalid relay hint');

      const server = this.nip29.getServer(normalized);
      if (!server) throw new Error('Could not add the relay');

      this.newServerUrl.set('');
      this.showAddServer.set(false);
      this.mobilePane.set('content');

      void this.router.navigate([...this.basePath(), server.slug, pointer.identifier], {
        queryParams: invite ? { invite } : {},
      });
    } catch (error) {
      this.snackBar.open(
        error instanceof Error ? error.message : 'Could not read that group reference',
        'Dismiss',
        { duration: 5000 }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  async join(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group || this.joining()) return;

    this.joining.set(true);

    try {
      const error = await this.nip29.joinGroup(
        server.url,
        group.id,
        this.inviteCode().trim() || undefined
      );

      if (error) {
        this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
      } else {
        this.snackBar.open(`Joined ${group.name}`, undefined, { duration: 3000 });
        this.revision.update(value => value + 1);
        await this.nip29.loadGroupDetails(server.url, group.id, true);
        this.revision.update(value => value + 1);
      }
    } finally {
      this.joining.set(false);
    }
  }

  async leave(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const confirmed = await this.confirm(
      `Leave ${group.name}?`,
      'You can request to join again later, unless the group is closed.',
      'Leave'
    );

    if (!confirmed) return;

    const error = await this.nip29.leaveGroup(server.url, group.id);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.snackBar.open(`Left ${group.name}`, undefined, { duration: 3000 });
      this.revision.update(value => value + 1);
    }
  }

  async toggleSaved(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    if (this.isSaved()) {
      await this.groupsList.removeGroup(server.url, group.id);
    } else {
      // Saving a channel pins its relay to the server rail.
      this.nip29.addServer(server.url);
      await this.groupsList.addGroup(server.url, group.id, group.name);
    }
  }

  /**
   * Copy the short, shareable channel URL: `/g/<relay-host>/<group-id>`.
   * Other NIP-29 clients use the same shape, so the link is recognisable.
   */
  copyChannelLink(): void {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const path = `/g/${server.slug}/${group.id}`;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;

    this.layout.copyToClipboard(`${origin}${path}`, 'channel link');
  }

  /** Copy a shareable `naddr` reference to the active channel. */
  async shareChannel(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    if (!server.selfPubkey) {
      this.snackBar.open(
        'This relay does not publish its own public key, so a shareable link cannot be built.',
        'Dismiss',
        { duration: 6000 }
      );
      return;
    }

    const naddr = nip19.naddrEncode({
      identifier: group.id,
      pubkey: server.selfPubkey,
      kind: 39000,
      relays: [server.url],
    });

    await this.layout.copyToClipboard(naddr, 'group reference');
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  setReply(message: Nip29Message): void {
    this.replyingTo.set(message);
  }

  cancelReply(): void {
    this.replyingTo.set(null);
  }

  async sendMessage(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    const content = this.messageText().trim();

    if (!server || !group || !content || this.nip29.sending()) return;

    const reply = this.replyingTo() ?? undefined;
    this.messageText.set('');
    this.replyingTo.set(null);

    const sent = await this.nip29.sendMessage(server.url, group.id, content, reply);

    if (!sent) {
      // Restore the draft so nothing is lost when the relay rejects the event.
      this.messageText.set(content);
      this.replyingTo.set(reply ?? null);
      this.snackBar.open('The relay rejected your message', 'Dismiss', { duration: 5000 });
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  async loadOlder(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    await this.nip29.loadOlderMessages(server.url, group.id);
    this.revision.update(value => value + 1);
  }

  hasMoreHistory(): boolean {
    const server = this.activeServer();
    const group = this.activeGroup();
    return !!server && !!group && this.nip29.hasMoreHistory(server.url, group.id);
  }

  /** The message a reply points at, when it is already loaded. */
  findMessage(id: string | undefined): Nip29Message | undefined {
    if (!id) return undefined;
    return this.messages().find(message => message.id === id);
  }

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------

  async openThread(thread: Nip29Message): Promise<void> {
    const server = this.activeServer();
    if (!server) return;

    this.activeThread.set(thread);
    await this.nip29.loadThreadReplies(server.url, thread.id);
    this.revision.update(value => value + 1);
  }

  closeThread(): void {
    this.activeThread.set(null);
    this.threadReplyText.set('');
  }

  startThread(): void {
    this.composingThread.set(true);
  }

  cancelThread(): void {
    this.composingThread.set(false);
    this.newThreadSubject.set('');
    this.newThreadBody.set('');
  }

  async createThread(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    const body = this.newThreadBody().trim();

    if (!server || !group || !body) return;

    const created = await this.nip29.createThread(
      server.url,
      group.id,
      this.newThreadSubject(),
      body
    );

    if (created) {
      this.cancelThread();
      await this.refreshThreads();
    } else {
      this.snackBar.open('The relay rejected the new thread', 'Dismiss', { duration: 5000 });
    }
  }

  async sendThreadReply(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    const thread = this.activeThread();
    const content = this.threadReplyText().trim();

    if (!server || !group || !thread || !content) return;

    this.threadReplyText.set('');
    const sent = await this.nip29.replyToThread(server.url, group.id, thread, content);

    if (sent) {
      await this.nip29.loadThreadReplies(server.url, thread.id);
      this.revision.update(value => value + 1);
    } else {
      this.threadReplyText.set(content);
      this.snackBar.open('The relay rejected your reply', 'Dismiss', { duration: 5000 });
    }
  }

  private async refreshThreads(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    this.revision.update(value => value + 1);
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /** Load the catalogue of every known relay so all public groups are listed. */
  async loadDiscover(): Promise<void> {
    this.browsingRelay.set(null);
    this.showAddServer.set(true);
    this.mobilePane.set('content');

    // Sequential rather than parallel: one relay at a time keeps the request
    // queue shallow when the user has many servers.
    for (const server of this.servers()) {
      await this.nip29.loadGroups(server.url);
      this.revision.update(value => value + 1);
    }
  }

  relayNameFor(group: Nip29Group): string {
    return this.nip29.getServer(group.relay)?.name ?? group.relay;
  }

  // ---------------------------------------------------------------------------
  // Group management
  // ---------------------------------------------------------------------------

  openCreateGroup(): void {
    this.showCreateGroup.set(true);
    this.showAddServer.set(false);
    this.mobilePane.set('content');
    this.newGroupRelay.set(this.activeServer()?.url ?? this.servers()[0]?.url ?? '');
  }

  cancelCreateGroup(): void {
    this.showCreateGroup.set(false);
    this.showAdvanced.set(false);
    this.newGroupId.set('');
    this.newGroupName.set('');
    this.newGroupAbout.set('');
    this.newGroupPicture.set('');
    this.newGroupBanner.set('');
    this.newGroupPrivate.set(false);
    this.newGroupRestricted.set(false);
    this.newGroupHidden.set(false);
    this.newGroupClosed.set(false);
    this.newGroupLivekit.set(false);
  }

  async createGroup(): Promise<void> {
    const relay = this.newGroupRelay().trim();
    const name = this.newGroupName().trim();

    if (!relay || !name || this.busy() || this.groupIdError()) return;

    this.busy.set(true);

    try {
      const { groupId, error } = await this.nip29.createGroup(relay, {
        id: this.newGroupId().trim() || undefined,
        name,
        about: this.newGroupAbout(),
        picture: this.newGroupPicture(),
        banner: this.newGroupBanner(),
        isPrivate: this.newGroupPrivate(),
        isRestricted: this.newGroupRestricted(),
        isHidden: this.newGroupHidden(),
        isClosed: this.newGroupClosed(),
        hasLivekit: this.newGroupLivekit(),
      });

      if (error) {
        this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
        if (!groupId) return;
      }

      if (groupId) {
        await this.groupsList.addGroup(relay, groupId, name);
        this.cancelCreateGroup();
        this.revision.update(value => value + 1);

        void this.router.navigate([
          ...this.basePath(),
          this.nip29.serverSlug(relay),
          groupId,
        ]);
      }
    } finally {
      this.busy.set(false);
    }
  }

  openGroupSettings(): void {
    const group = this.activeGroup();
    if (!group) return;

    this.newGroupId.set(group.id);
    this.newGroupName.set(group.name);
    this.newGroupAbout.set(group.about ?? '');
    this.newGroupPicture.set(group.picture ?? '');
    this.newGroupBanner.set(group.banner ?? '');
    this.newGroupPrivate.set(group.isPrivate);
    this.newGroupRestricted.set(group.isRestricted);
    this.newGroupHidden.set(group.isHidden);
    this.newGroupClosed.set(group.isClosed);
    this.newGroupLivekit.set(group.hasLivekit);
    this.showGroupSettings.set(true);
    this.setView('members');
  }

  async saveGroupSettings(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group || this.busy()) return;

    this.busy.set(true);

    try {
      const error = await this.nip29.updateGroupMetadata(server.url, group.id, {
        name: this.newGroupName(),
        about: this.newGroupAbout(),
        picture: this.newGroupPicture(),
        banner: this.newGroupBanner(),
        isPrivate: this.newGroupPrivate(),
        isRestricted: this.newGroupRestricted(),
        isHidden: this.newGroupHidden(),
        isClosed: this.newGroupClosed(),
        hasLivekit: this.newGroupLivekit(),
        supportedKinds: group.supportedKinds,
        parent: group.parent ?? null,
        children: group.children,
      });

      if (error) {
        this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
      } else {
        this.snackBar.open('Group updated', undefined, { duration: 3000 });
        this.showGroupSettings.set(false);
        this.revision.update(value => value + 1);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async deleteGroup(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const confirmed = await this.confirm(
      `Delete ${group.name}?`,
      'The relay will remove the group. Sub-groups become root groups. This cannot be undone.',
      'Delete'
    );

    if (!confirmed) return;

    const error = await this.nip29.deleteGroup(server.url, group.id);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.snackBar.open('Group deleted', undefined, { duration: 3000 });
      void this.router.navigate(this.basePath());
    }
  }

  // ---------------------------------------------------------------------------
  // Moderation
  // ---------------------------------------------------------------------------

  async addMember(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    const input = this.addMemberPubkey().trim();

    if (!server || !group || !input || this.busy()) return;

    const pubkey = this.toHexPubkey(input);
    if (!pubkey) {
      this.snackBar.open('That is not a valid npub or hex public key', 'Dismiss', {
        duration: 5000,
      });
      return;
    }

    this.busy.set(true);

    try {
      const roles = this.addMemberRoles()
        .split(',')
        .map(role => role.trim())
        .filter(Boolean);

      const error = await this.nip29.putUser(server.url, group.id, pubkey, roles);

      if (error) {
        this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
      } else {
        this.addMemberPubkey.set('');
        this.addMemberRoles.set('');
        this.revision.update(value => value + 1);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async removeMember(pubkey: string): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const confirmed = await this.confirm(
      'Remove this member?',
      'They will lose access to the group until they are added again.',
      'Remove'
    );

    if (!confirmed) return;

    const error = await this.nip29.removeUser(server.url, group.id, pubkey);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.revision.update(value => value + 1);
    }
  }

  async setRole(pubkey: string, role: string): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const current = this.rolesFor(pubkey);
    const roles = current.includes(role)
      ? current.filter(entry => entry !== role)
      : [...current, role];

    const error = await this.nip29.putUser(server.url, group.id, pubkey, roles);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.revision.update(value => value + 1);
    }
  }

  /** Delete a message. Available to admins and to the message author. */
  canDelete(message: Nip29Message): boolean {
    return this.isAdmin() || message.pubkey === this.pubkey();
  }

  async deleteMessage(message: Nip29Message): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const confirmed = await this.confirm(
      'Delete this message?',
      'The relay will remove it for everyone in the group.',
      'Delete'
    );

    if (!confirmed) return;

    const error = await this.nip29.deleteGroupEvent(server.url, group.id, message.id);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.revision.update(value => value + 1);
    }
  }

  isPinned(message: Nip29Message): boolean {
    return (this.details()?.pinned ?? []).includes(message.id);
  }

  async togglePin(message: Nip29Message): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const error = await this.nip29.togglePin(server.url, group.id, message.id);

    if (error) {
      this.snackBar.open(this.humanizeRelayError(error), 'Dismiss', { duration: 6000 });
    } else {
      this.revision.update(value => value + 1);
    }
  }

  async generateInvite(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    const { code, error } = await this.nip29.createInvite(server.url, group.id);

    if (error || !code) {
      this.snackBar.open(this.humanizeRelayError(error ?? 'Failed'), 'Dismiss', {
        duration: 6000,
      });
      return;
    }

    this.inviteResult.set(code);
  }

  /** Copy a shareable invite link that carries the code. */
  copyInvite(): void {
    const code = this.inviteResult();
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!code || !server || !group) return;

    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const link = `${origin}/g/${server.slug}/${group.id}?invite=${encodeURIComponent(code)}`;

    this.layout.copyToClipboard(link, 'invite link');
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

  private async confirm(title: string, message: string, confirmText: string): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title,
        message,
        confirmText,
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } satisfies ConfirmDialogData,
    });

    return !!(await firstValueFrom(dialogRef.afterClosed()));
  }

  // ---------------------------------------------------------------------------
  // Voice
  // ---------------------------------------------------------------------------

  async joinVoice(): Promise<void> {
    const server = this.activeServer();
    const group = this.activeGroup();
    if (!server || !group) return;

    await this.voice.join(server.url, group.id);

    const error = this.voice.error();
    if (error) {
      this.snackBar.open(error, 'Dismiss', { duration: 6000 });
    }
  }

  async leaveVoice(): Promise<void> {
    await this.voice.leave();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Initials shown when a server or group has no picture. */
  initials(name: string): string {
    return name
      .split(/[\s.\-_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  channelIcon(group: Nip29Group): string {
    if (group.hasLivekit && this.supportedKindsOf(group).length === 0) return 'volume_up';
    if (group.isPrivate) return 'lock';
    return 'tag';
  }

  isActiveChannel(group: Nip29Group): boolean {
    return this.groupId() === group.id;
  }

  rolesFor(pubkey: string): string[] {
    return this.admins().find(admin => admin.pubkey === pubkey)?.roles ?? [];
  }

  trackMessage(_index: number, message: Nip29Message): string {
    return message.id;
  }

  private supportsKind(kind: number): boolean {
    const group = this.activeGroup();
    if (!group) return false;
    if (!group.supportedKinds) return true;
    return group.supportedKinds.includes(kind);
  }

  private supportedKindsOf(group: Nip29Group): number[] {
    return group.supportedKinds ?? [NIP29_KIND_CHAT, NIP29_KIND_THREAD];
  }

  /** Turn a raw relay rejection message into something readable. */
  private humanizeRelayError(error: string): string {
    if (error.startsWith('duplicate:')) return 'You are already a member of this group.';
    if (error.startsWith('restricted:')) return `The relay refused the request: ${error.slice(11).trim()}`;
    if (error.includes('auth-required')) return 'This relay requires you to authenticate first.';
    return error;
  }

  private scrollToBottom(): void {
    const element = this.messageScroller()?.nativeElement;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
  }

  /**
   * Load exactly what the current route needs, nothing more. Group lists and
   * group state come from cache whenever they are still fresh.
   */
  private async syncRouteState(slug: string | null, groupId: string | null): Promise<void> {
    if (!slug) {
      this.nip29.closeSubscriptions();

      // Resume where the user left off instead of showing an empty shell.
      const last = this.recallGroupLocation();
      if (last) {
        void this.router.navigate([...this.basePath(), last.slug, last.groupId], {
          replaceUrl: true,
        });
        return;
      }

      this.mobilePane.set('servers');
      return;
    }

    let server = this.nip29.getServerBySlug(slug);

    if (!server) {
      // Deep link to a relay that is not in the rail yet. It stays unpinned
      // until the user joins or saves a channel on it.
      const normalized = this.nip29.addServer(this.nip29.slugToRelayUrl(slug), false);
      server = normalized ? this.nip29.getServer(normalized) : undefined;
    }

    if (!server) {
      this.snackBar.open('Unknown server', 'Dismiss', { duration: 4000 });
      return;
    }

    void this.nip29.loadServerInfo(server.url);
    await this.nip29.loadGroups(server.url);
    this.revision.update(value => value + 1);

    if (!groupId) {
      this.nip29.closeSubscriptions();
      this.browsingRelay.set(server.url);
      this.showAddServer.set(true);
      this.mobilePane.set('channels');
      return;
    }

    this.mobilePane.set('content');
    this.showAddServer.set(false);
    this.rememberGroupLocation(slug, groupId);

    try {
      await Promise.all([
        this.nip29.loadGroupDetails(server.url, groupId),
        this.nip29.loadMembership(server.url, groupId),
        this.nip29.openGroup(server.url, groupId),
      ]);
    } catch (error) {
      this.logger.error('[Servers] Failed to open channel', error);
    }

    this.revision.update(value => value + 1);
    this.view.set(this.resolveInitialView(server.url, groupId));
  }

  /**
   * Restore the last view used for this group, falling back to the first one
   * the group actually supports.
   */
  private resolveInitialView(relayUrl: string, groupId: string): ChannelView {
    const remembered = this.recallView(relayUrl, groupId);
    if (remembered && this.isViewAvailable(remembered)) return remembered;

    if (this.supportsChat()) return 'chat';
    if (this.supportsThreads()) return 'threads';
    if (this.supportsVoice()) return 'voice';
    return 'members';
  }

  private isViewAvailable(view: ChannelView): boolean {
    switch (view) {
      case 'chat':
        return this.supportsChat();
      case 'threads':
        return this.supportsThreads();
      case 'voice':
        return this.supportsVoice();
      case 'members':
        return true;
    }
  }
}
