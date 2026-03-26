import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MessagingService } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { ApplicationService } from '../../services/application.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { UserRelayService } from '../../services/relays/user-relay';
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
  private accountState = inject(AccountStateService);
  private data = inject(DataService);
  private userRelayService = inject(UserRelayService);

  @ViewChild('chatMessagesContainer') chatMessagesContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('widgetMessageInput') widgetMessageInput?: ElementRef<HTMLTextAreaElement>;

  state = signal<WidgetState>('collapsed');
  activeChatId = signal<string | null>(null);
  activeChatIsGroup = signal(false);
  newMessageText = signal('');
  isSending = signal(false);

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

  /** The active chat object */
  activeChat = computed(() => {
    const chatId = this.activeChatId();
    if (!chatId) return null;
    return this.messaging.getChat(chatId);
  });

  /** Messages for the active chat */
  activeChatMessages = computed(() => {
    const chatId = this.activeChatId();
    if (!chatId) return [];
    return this.messaging.getChatMessages(chatId);
  });

  constructor() {
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
  }

  close() {
    this.state.set('collapsed');
    this.activeChatId.set(null);
    this.activeChatIsGroup.set(false);
    this.newMessageText.set('');
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
  }

  startNewChat() {
    this.router.navigate(['/messages'], { queryParams: { newChat: true } });
    this.close();
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

  private scrollChatToBottom() {
    const el = this.chatMessagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
