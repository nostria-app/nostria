import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, ElementRef, ViewChild, HostListener, DestroyRef, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MessagingService } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { ApplicationService } from '../../services/application.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { SettingsService } from '../../services/settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DataService } from '../../services/data.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { StartChatDialogComponent, StartChatDialogResult } from '../start-chat-dialog/start-chat-dialog.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../message-content/message-content.component';
import { AgoPipe } from '../../pipes/ago.pipe';

type WidgetState = 'compact' | 'collapsed' | 'list' | 'chat';

@Component({
  selector: 'app-chat-widget',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
    MessageContentComponent,
    AgoPipe,
  ],
  templateUrl: './chat-widget.component.html',
  styleUrl: './chat-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.display]': 'visible() ? "block" : "none"',
    '[style.pointer-events]': 'visible() ? "auto" : "none"',
    '[style.transform]': 'visible() ? widgetTransform() : null',
    '[attr.aria-hidden]': 'visible() ? null : "true"',
  },
})
export class ChatWidgetComponent {
  private router = inject(Router);
  messaging = inject(MessagingService);
  private layout = inject(LayoutService);
  private app = inject(ApplicationService);
  private localSettings = inject(LocalSettingsService);
  private settings = inject(SettingsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private data = inject(DataService);
  private userRelayService = inject(UserRelayService);
  private customDialog = inject(CustomDialogService);
  private hostEl = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);

  /** Tracks whether the current route should suppress the floating widget */
  private isWidgetHiddenRoute = signal(false);

  @ViewChild('chatMessagesContainer') chatMessagesContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('widgetMessageInput') widgetMessageInput?: ElementRef<HTMLTextAreaElement>;

  state = signal<WidgetState>('compact');
  private compactRestoreState = signal<Exclude<WidgetState, 'compact'>>('collapsed');
  activeChatId = signal<string | null>(null);
  activeChatIsGroup = signal(false);
  newMessageText = signal('');
  isSending = signal(false);
  private suppressDraftPersistence = false;

  // Drag state — dragOffset is the user's chosen position;
  // clampAdjustment is a temporary shift applied only while expanded
  // so the panel stays on-screen without permanently altering the drag position.
  dragOffset = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  private clampAdjustment = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  isDragging = false;
  private dragStarted = false;
  private dragStartPos = { x: 0, y: 0 };
  private dragStartOffset = { x: 0, y: 0 };
  private readonly DRAG_THRESHOLD = 5;

  /** Combined transform: drag offset + clamp adjustment */
  widgetTransform = computed(() => {
    const offset = this.dragOffset();
    const clamp = this.clampAdjustment();
    const x = offset.x + clamp.x;
    const y = offset.y + clamp.y;
    if (x === 0 && y === 0) return '';
    return `translate(${x}px, ${y}px)`;
  });

  /** Show widget only on desktop when authenticated, enabled, and not on chat-heavy routes */
  visible = computed(() => {
    return !this.layout.isHandset()
      && this.app.authenticated()
      && this.localSettings.settings().chatWidgetEnabled !== false
      && !this.isWidgetHiddenRoute();
  });

  /** Top 3 recent chat pubkeys for the collapsed pill avatars (following only) */
  recentAvatarPubkeys = computed(() => {
    return this.chatList()
      .filter(c => !c.chat.isGroup && c.chat.pubkey)
      .slice(0, 3)
      .map(c => c.chat.pubkey);
  });

  /** Chat list for the expanded view — only following contacts and group chats with followed participants */
  chatList = computed(() => {
    const followingSet = new Set(this.accountState.followingList());
    const myPubkey = this.accountState.pubkey();

    return this.messaging.sortedChats()
      .filter(item => {
        if (item.chat.isGroup && item.chat.participants) {
          return item.chat.participants.some(p => p !== myPubkey && followingSet.has(p));
        }
        return followingSet.has(item.chat.pubkey);
      })
      .slice(0, 20);
  });

  unreadCount = computed(() => this.messaging.unreadBadgeCount());

  /** The active chat object */
  activeChat = computed(() => {
    const chatId = this.activeChatId();
    if (!chatId) return null;
    return this.messaging.getChat(chatId);
  });

  /** Display name for the active 1-on-1 chat */
  activeChatDisplayName = computed(() => {
    const chatId = this.activeChatId();
    if (!chatId || this.activeChatIsGroup()) return '';
    return this.getParticipantName(chatId);
  });

  /** Messages for the active chat */
  activeChatMessages = computed(() => {
    const chatId = this.activeChatId();
    if (!chatId) return [];
    return this.messaging.getChatMessages(chatId);
  });

  private chatsLoaded = false;

  constructor() {
    // Hide the widget on dedicated messaging pages so it cannot overlap their composers.
    this.isWidgetHiddenRoute.set(this.shouldHideOnRoute(this.router.url));
    this.router.events.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isWidgetHiddenRoute.set(this.shouldHideOnRoute(event.urlAfterRedirects));
      }
    });

    // Eagerly load chats from storage when the widget is enabled
    // so the chat list is populated without visiting the Messages page first.
    effect(() => {
      if (this.visible() && !this.chatsLoaded && this.messaging.sortedChats().length === 0) {
        this.chatsLoaded = true;
        // Load from storage in background - don't block rendering
        this.messaging.loadChats();
      }
    });

    // Auto-scroll to bottom when entering a chat or when new messages arrive
    effect(() => {
      const msgs = this.activeChatMessages();
      if (msgs.length > 0 && this.state() === 'chat') {
        setTimeout(() => this.scrollChatToBottom(), 0);
      }
    });

    effect(() => {
      const chatId = this.activeChatId();
      const draftText = this.newMessageText();
      const accountPubkey = this.accountState.pubkey();

      if (!chatId || !accountPubkey || this.suppressDraftPersistence) {
        return;
      }

      untracked(() => {
        this.accountLocalState.setChatDraft(accountPubkey, chatId, draftText);
      });
    });
  }

  private shouldHideOnRoute(url: string): boolean {
    return url.startsWith('/messages') || url.startsWith('/chats');
  }

  toggleOpen() {
    this.state.set('list');
    this.clampToViewport();
  }

  close() {
    this.collapseToCompact();
    this.clampAdjustment.set({ x: 0, y: 0 });
  }

  collapseToCompact(): void {
    const currentState = this.state();
    if (currentState === 'compact') {
      return;
    }

    this.compactRestoreState.set(currentState);
    this.state.set('compact');
    this.clampAdjustment.set({ x: 0, y: 0 });
  }

  openChatFromLauncher(event: Event, pubkey: string): void {
    event.stopPropagation();
    if (this.wasDragged()) {
      return;
    }

    this.openChat(pubkey, false);
  }

  toggleLauncherMode(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.wasDragged()) {
      return;
    }

    if (this.state() === 'compact') {
      this.compactRestoreState.set('collapsed');
      this.state.set('collapsed');
      return;
    }

    if (this.state() === 'collapsed') {
      this.collapseToCompact();
    }
  }

  expandFromCompact(): void {
    if (this.state() !== 'compact') {
      return;
    }

    this.state.set('list');
    this.compactRestoreState.set('collapsed');
    this.clampToViewport();
  }

  restoreCollapsedLauncher(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (this.state() !== 'compact' || this.wasDragged()) {
      return;
    }

    this.compactRestoreState.set('collapsed');
    this.state.set('collapsed');
  }

  openFullMessages() {
    const chatId = this.activeChatId();
    if (chatId) {
      this.persistDraftForActiveChat();
      this.router.navigate(['/messages'], { queryParams: { chat: chatId } });
    } else {
      this.router.navigate(['/messages']);
    }
    this.close();
  }

  openChat(chatId: string, isGroup: boolean) {
    this.activeChatId.set(chatId);
    this.activeChatIsGroup.set(isGroup);
    this.state.set('chat');
    this.restoreDraftForChat(chatId);
    this.messaging.markChatAsRead(chatId);
    this.clampToViewport();
    setTimeout(() => {
      this.scrollChatToBottom();
      this.widgetMessageInput?.nativeElement?.focus();
    }, 50);
  }

  backToList() {
    this.state.set('list');
    this.activeChatId.set(null);
    this.activeChatIsGroup.set(false);
    this.restoreDraftForChat(null);
    this.clampToViewport();
  }

  startNewChat() {
    const dialogRef = this.customDialog.open<StartChatDialogComponent, StartChatDialogResult | undefined>(
      StartChatDialogComponent,
      {
        title: 'New Conversation',
        width: 'min(500px, calc(100vw - 24px))',
        maxWidth: 'calc(100vw - 24px)',
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        const chatResult = result as StartChatDialogResult;
        if (chatResult.isGroup && chatResult.participants) {
          // Group chat creation - redirect to full messages page
          this.router.navigate(['/messages'], { queryParams: { newChat: true } });
          this.close();
        } else if (chatResult.pubkey) {
          this.openChat(chatResult.pubkey, false);
        }
      }
    });
  }

  disableWidget() {
    this.localSettings.updateSettings({ chatWidgetEnabled: false });
    this.close();
  }

  getGroupDisplayName(chat: any): string {
    if (chat.subject) return chat.subject;
    const myPubkey = this.accountState.pubkey();
    const others = (chat.participants || []).filter((p: string) => p !== myPubkey);
    if (others.length === 0) return 'Group';
    const names = others.map((p: string) => this.getParticipantName(p));
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }

  getParticipantName(pubkey: string): string {
    const profile = this.data.getCachedProfile(pubkey);
    if (profile?.data) {
      return profile.data.display_name || profile.data.name || pubkey.slice(0, 8) + '...';
    }
    return pubkey.slice(0, 8) + '...';
  }

  getChatPreviewText(lastMessage: any): string {
    if (!lastMessage) return '';
    if (lastMessage.eventKind === 'reaction') {
      const content = lastMessage.reactionContent || lastMessage.content;
      if (!content || content === '+') return 'Reacted \u2764\uFE0F';
      return `Reacted ${content}`;
    }
    return lastMessage.content || '';
  }

  formatMessageTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async sendMessage(): Promise<void> {
    const text = this.newMessageText().trim();
    const chatId = this.activeChatId();
    const chat = this.activeChat();
    if (!text || !chatId || !chat || this.isSending()) return;

    this.isSending.set(true);
    this.newMessageText.set('');

    try {
      if (chat.isGroup && chat.participants) {
        // Group messages not supported from the widget - open full messages
        this.openFullMessages();
        return;
      }

      // Ensure relay discovery for the recipient
      await Promise.all([
        this.userRelayService.ensureRelaysForPubkey(chat.pubkey),
        this.userRelayService.ensureDmRelaysForPubkey(chat.pubkey),
      ]);

      await this.messaging.sendDirectMessage(text, chat.pubkey);
      const accountPubkey = this.accountState.pubkey();
      if (accountPubkey) {
        this.accountLocalState.setChatDraft(accountPubkey, chatId, '');
      }
      setTimeout(() => this.scrollChatToBottom(), 100);
    } catch (e) {
      // Restore text on failure
      this.newMessageText.set(text);
    } finally {
      this.isSending.set(false);
      this.widgetMessageInput?.nativeElement?.focus();
    }
  }

  onMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // ── Drag handling ──────────────────────────────────────────────────────

  onDragStart(event: MouseEvent, skipButtonCheck = false) {
    // Only left mouse button
    if (event.button !== 0) return;
    // Don't initiate drag from interactive elements inside panel headers
    if (!skipButtonCheck) {
      const target = event.target as HTMLElement;
      if (target.closest('button, a, input, textarea')) return;
    }

    if (this.state() !== 'collapsed') {
      this.absorbClampAdjustmentIntoDragOffset();
    }

    this.isDragging = true;
    this.dragStarted = false;
    this.dragStartPos = { x: event.clientX, y: event.clientY };
    this.dragStartOffset = { ...this.dragOffset() };
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onDragMove(event: MouseEvent) {
    if (!this.isDragging) return;

    const dx = event.clientX - this.dragStartPos.x;
    const dy = event.clientY - this.dragStartPos.y;

    if (!this.dragStarted) {
      if (Math.abs(dx) < this.DRAG_THRESHOLD && Math.abs(dy) < this.DRAG_THRESHOLD) return;
      this.dragStarted = true;
    }

    let newX = this.dragStartOffset.x + dx;
    let newY = this.dragStartOffset.y + dy;

    // Clamp to viewport so the widget can't be dragged off-screen
    const el = this.hostEl.nativeElement.querySelector('.chat-widget') as HTMLElement;
    if (el) {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Current offset already applied in rect, so compute how much further we can go
      const currentOffset = this.dragOffset();
      const deltaX = newX - currentOffset.x;
      const deltaY = newY - currentOffset.y;

      if (rect.left + deltaX < 0) newX -= (rect.left + deltaX);
      if (rect.top + deltaY < 0) newY -= (rect.top + deltaY);
      if (rect.right + deltaX > vw) newX -= (rect.right + deltaX - vw);
      if (rect.bottom + deltaY > vh) newY -= (rect.bottom + deltaY - vh);
    }

    this.dragOffset.set({ x: newX, y: newY });
  }

  @HostListener('document:mouseup')
  onDragEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    // dragStarted stays true briefly to suppress the click
    if (this.dragStarted) {
      // Re-clamp when dragging while expanded
      if (this.state() !== 'collapsed') {
        this.clampToViewport();
      }
      setTimeout(() => { this.dragStarted = false; }, 0);
    }
  }

  /** Returns true if a drag just finished (used to suppress click) */
  wasDragged(): boolean {
    return this.dragStarted;
  }

  /**
   * Compute a temporary clamp adjustment so the expanded panel stays within the viewport.
   * This does NOT modify dragOffset — the user's chosen position is preserved,
   * so collapsing restores the widget to where it was dragged.
   */
  private clampToViewport(): void {
    // Reset any previous adjustment before measuring
    this.clampAdjustment.set({ x: 0, y: 0 });

    const el = this.hostEl.nativeElement.querySelector('.chat-widget') as HTMLElement;
    if (!el) return;

    // Use requestAnimationFrame to let the DOM update first (e.g. after state change)
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let ax = 0;
      let ay = 0;

      if (rect.left < 0) ax -= rect.left;
      if (rect.top < 0) ay -= rect.top;
      if (rect.right > vw) ax -= (rect.right - vw);
      if (rect.bottom > vh) ay -= (rect.bottom - vh);

      if (ax !== 0 || ay !== 0) {
        this.clampAdjustment.set({ x: ax, y: ay });
      }
    });
  }

  private absorbClampAdjustmentIntoDragOffset(): void {
    const clamp = this.clampAdjustment();
    if (clamp.x === 0 && clamp.y === 0) return;

    this.dragOffset.update(offset => ({
      x: offset.x + clamp.x,
      y: offset.y + clamp.y,
    }));
    this.clampAdjustment.set({ x: 0, y: 0 });
  }

  private scrollChatToBottom() {
    const el = this.chatMessagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  preventButtonFocusSteal(event: Event): void {
    event.preventDefault();
  }

  private restoreDraftForChat(chatId: string | null): void {
    const accountPubkey = this.accountState.pubkey();
    const draftText = chatId && accountPubkey ? this.accountLocalState.getChatDraft(accountPubkey, chatId) : '';

    this.suppressDraftPersistence = true;
    this.newMessageText.set(draftText);
    this.suppressDraftPersistence = false;
  }

  private persistDraftForActiveChat(): void {
    const chatId = this.activeChatId();
    const accountPubkey = this.accountState.pubkey();
    if (!chatId || !accountPubkey) {
      return;
    }

    this.accountLocalState.setChatDraft(accountPubkey, chatId, this.newMessageText());
  }
}
