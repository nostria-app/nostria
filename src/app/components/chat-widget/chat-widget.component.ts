import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MessagingService } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { ApplicationService } from '../../services/application.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { AgoPipe } from '../../pipes/ago.pipe';

type WidgetState = 'collapsed' | 'list';

@Component({
  selector: 'app-chat-widget',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
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

  state = signal<WidgetState>('collapsed');

  /** Show widget only on desktop when authenticated */
  visible = computed(() => {
    return !this.layout.isHandset() && this.app.authenticated();
  });

  /** Top 3 recent chat pubkeys for the collapsed pill avatars */
  recentAvatarPubkeys = computed(() => {
    return this.messaging.sortedChats()
      .filter(c => !c.chat.isGroup && c.chat.pubkey)
      .slice(0, 3)
      .map(c => c.chat.pubkey);
  });

  /** Chat list for the expanded view */
  chatList = computed(() => {
    return this.messaging.sortedChats()
      .filter(c => !c.chat.isGroup && c.chat.pubkey)
      .slice(0, 20);
  });

  unreadCount = computed(() => this.messaging.unreadBadgeCount());

  toggleOpen() {
    this.state.update(s => s === 'collapsed' ? 'list' : 'collapsed');
  }

  close() {
    this.state.set('collapsed');
  }

  openFullMessages() {
    this.router.navigate(['/messages']);
    this.close();
  }

  openChat(pubkey: string) {
    this.router.navigate(['/messages'], { queryParams: { chat: pubkey } });
    this.close();
  }

  startNewChat() {
    this.router.navigate(['/messages'], { queryParams: { newChat: true } });
    this.close();
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
}
