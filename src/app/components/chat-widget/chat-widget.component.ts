import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, ElementRef, ViewChild, HostListener } from '@angular/core';
import { Router } from '@angular/router';
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
import { DataService } from '../../services/data.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { StartChatDialogComponent, StartChatDialogResult } from '../start-chat-dialog/start-chat-dialog.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { MessageContentComponent } from '../message-content/message-content.component';
import { AgoPipe } from '../../pipes/ago.pipe';

type WidgetState = 'collapsed' | 'list' | 'chat';

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
})
export class ChatWidgetComponent {
  private router = inject(Router);
  messaging = inject(MessagingService);
  private layout = inject(LayoutService);
  private app = inject(ApplicationService);
  private localSettings = inject(LocalSettingsService);
  private settings = inject(SettingsService);
  private accountState = inject(AccountStateService);
  private data = inject(DataService);
  private userRelayService = inject(UserRelayService);
  private customDialog = inject(CustomDialogService);
  private hostEl = inject(ElementRef<HTMLElement>);

  @ViewChild('chatMessagesContainer') chatMessagesContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('widgetMessageInput') widgetMessageInput?: ElementRef<HTMLTextAreaElement>;

  state = signal<WidgetState>('collapsed');
  activeChatId = signal<string | null>(null);
  activeChatIsGroup = signal(false);
  newMessageText = signal('');
  isSending = signal(false);

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

  /** Combined transform: drag offset + clamp adjustment + sidebar shift */
  widgetTransform = computed(() => {
    const offset = this.dragOffset();
    const clamp = this.clampAdjustment();
    const sidebarShift = this.rightSidebarOpen() ? -68 : 0;
    const x = offset.x + clamp.x + sidebarShift;
    const y = offset.y + clamp.y;
    if (x === 0 && y === 0) return '';
    return `translate(${x}px, ${y}px)`;
  });

  /** Show widget only on desktop when authenticated and enabled */
  visible = computed(() => {
    return !this.layout.isHandset()
      && this.app.authenticated()
      && this.localSettings.settings().chatWidgetEnabled !== false;
  });

  /** Top 3 recent chat pubkeys for the collapsed pill avatars */
  recentAvatarPubkeys = computed(() => {
    return this.messaging.sortedChats()
      .filter(c => !c.chat.isGroup && c.chat.pubkey)
      .slice(0, 3)
      .map(c => c.chat.pubkey);
  });

  /** Chat list for the expanded view (includes groups) */
  chatList = computed(() => {
    return this.messaging.sortedChats().slice(0, 20);
  });

  unreadCount = computed(() => this.messaging.unreadBadgeCount());

  /** Whether the right sidebar is visible (shifts widget left) */
  rightSidebarOpen = computed(() => {
    return !this.layout.isHandset() && this.settings.settings().rightSidebarEnabled === true;
  });

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
  }

  toggleOpen() {
    this.state.update(s => s === 'collapsed' ? 'list' : 'collapsed');
    if (this.state() === 'list') {
      this.clampToViewport();
    } else {
      this.clampAdjustment.set({ x: 0, y: 0 });
    }
  }

  close() {
    this.state.set('collapsed');
    this.activeChatId.set(null);
    this.activeChatIsGroup.set(false);
    this.newMessageText.set('');
    this.clampAdjustment.set({ x: 0, y: 0 });
  }

  openFullMessages() {
    const chatId = this.activeChatId();
    if (chatId && !this.activeChatIsGroup()) {
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
    this.newMessageText.set('');
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
    this.newMessageText.set('');
    this.clampToViewport();
  }

  startNewChat() {
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

    this.dragOffset.set({
      x: this.dragStartOffset.x + dx,
      y: this.dragStartOffset.y + dy,
    });
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

  private scrollChatToBottom() {
    const el = this.chatMessagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
