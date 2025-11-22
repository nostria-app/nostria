import { Component, computed, effect, inject, input, signal, ViewChild, ElementRef, AfterViewInit, ChangeDetectionStrategy, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { NostrService } from '../../services/nostr.service';
import { AccountStateService } from '../../services/account-state.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserDataService } from '../../services/user-data.service';
import { ZapService } from '../../services/zap.service';

interface ChatMessage {
  id: string;
  event: Event;
  pubkey: string;
  content: string;
  created_at: number;
  replyTo?: string;
  formattedTime: string;
  type: 'chat' | 'zap';
  zapAmount?: number;
  zapSender?: string;
}

@Component({
  selector: 'app-live-chat',
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatSlideToggleModule,
    UserProfileComponent,
    ProfileDisplayNameComponent,
  ],
  templateUrl: './live-chat.component.html',
  styleUrl: './live-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveChatComponent implements AfterViewInit, OnDestroy {
  private relayPool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private userDataService = inject(UserDataService);
  private zapService = inject(ZapService);

  @ViewChild('messagesContainer') messagesContainer?: ElementRef<HTMLDivElement>;

  // Input: The live event data (kind 30311 or 30313)
  liveEvent = input<Event | undefined>(undefined);

  // Chat visibility (output signal for parent to control)
  isVisible = signal(true);

  // Chat messages
  messages = signal<ChatMessage[]>([]);

  // Active relays for chat
  activeRelays = signal<string[]>([]);

  // Subscription management
  private chatSubscription: { close: () => void } | null = null;
  private messageIds = new Set<string>();

  // Message input
  messageInput = signal('');

  // View mode: 'chat' or 'participants' or 'settings'
  viewMode = signal<'chat' | 'participants' | 'settings'>('chat');

  // Settings
  showZaps = signal(true);

  // Computed participants from event
  participants = computed(() => {
    const event = this.liveEvent();
    if (!event) return [];

    const participantTags = event.tags.filter(tag => tag[0] === 'p');
    return participantTags.map(tag => ({
      pubkey: tag[1],
      role: tag[3] || 'Participant',
      relayUrl: tag[2],
    }));
  });

  // Computed event address for querying
  eventAddress = computed(() => {
    const event = this.liveEvent();
    if (!event) return null;

    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) return null;

    return `${event.kind}:${event.pubkey}:${dTag}`;
  });

  constructor() {
    // Subscribe to chat messages when event changes
    effect(() => {
      const address = this.eventAddress();
      if (!address) {
        // Close existing subscription if address becomes invalid
        if (this.chatSubscription) {
          this.chatSubscription.close();
          this.chatSubscription = null;
        }
        return;
      }

      untracked(() => {
        this.subscribeToChatMessages(address);
      });
    });
  }

  ngAfterViewInit(): void {
    // Initial scroll to bottom
    setTimeout(() => this.scrollToBottom(), 100);
  }

  ngOnDestroy(): void {
    if (this.chatSubscription) {
      this.chatSubscription.close();
    }
  }

  private scrollToBottom(): void {
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  private async subscribeToChatMessages(eventAddress: string): Promise<void> {
    // Close existing subscription if any
    if (this.chatSubscription) {
      this.chatSubscription.close();
      this.chatSubscription = null;
    }

    // Reset messages and message IDs for new subscription
    this.messages.set([]);
    this.messageIds.clear();
    this.activeRelays.set([]);

    // Get streamer pubkey from event
    const event = this.liveEvent();
    const streamerPubkey = event?.pubkey;

    let targetRelays: string[] = [];

    // Check for relays tag in the event
    const relaysTag = event?.tags.find(tag => tag[0] === 'relays');

    if (relaysTag && relaysTag.length > 1) {
      // Use relays specified in the event
      targetRelays = relaysTag.slice(1);
    } else if (streamerPubkey) {
      // Get streamer's relays
      targetRelays = await this.userDataService.getUserRelays(streamerPubkey);
    }

    // Check if we are still on the same event
    if (this.eventAddress() !== eventAddress) {
      return;
    }

    // If no streamer relays found, fallback to preferred relays
    if (targetRelays.length === 0) {
      targetRelays = this.utilities.preferredRelays;
    }

    const relayUrls = this.relaysService.getOptimalRelays(targetRelays);

    if (relayUrls.length === 0) {
      console.warn('[LiveChat] No relays available for chat messages');
      return;
    }

    this.activeRelays.set(relayUrls);

    console.log('[LiveChat] Subscribing to chat messages:', { eventAddress, relayCount: relayUrls.length });

    // Subscribe to kind 1311 chat messages and kind 9735 zaps
    const filter = {
      kinds: [1311, 9735],
      '#a': [eventAddress],
      limit: 1000,
    };

    this.chatSubscription = this.relayPool.subscribe(
      relayUrls,
      filter,
      (event: Event) => {
        // Handle incoming messages
        if (this.messageIds.has(event.id)) return;
        this.messageIds.add(event.id);

        let newMessage: ChatMessage | null = null;

        if (event.kind === 1311) {
          const replyTo = event.tags.find(tag => tag[0] === 'e' && tag[3] === 'reply')?.[1];

          newMessage = {
            id: event.id,
            event,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
            replyTo,
            formattedTime: new Date(event.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'chat'
          };
        } else if (event.kind === 9735) {
          // Parse zap receipt
          const { zapRequest, amount, comment } = this.zapService.parseZapReceipt(event);

          if (zapRequest && amount) {
            newMessage = {
              id: event.id,
              event,
              pubkey: event.pubkey, // This is the provider pubkey
              content: comment || zapRequest.content,
              created_at: event.created_at,
              formattedTime: new Date(event.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'zap',
              zapAmount: amount,
              zapSender: zapRequest.pubkey // This is the actual sender
            };
          }
        }

        if (newMessage) {
          this.messages.update(msgs => {
            const newMsgs = [...msgs, newMessage!].sort((a, b) => a.created_at - b.created_at);

            // Keep only last 500 messages to prevent memory issues
            if (newMsgs.length > 500) {
              return newMsgs.slice(newMsgs.length - 500);
            }

            return newMsgs;
          });

          // Scroll to bottom if user was already at bottom
          // For now, just scroll to bottom on new messages if it's not initial load
          // We might want to add "new messages" indicator later
          setTimeout(() => this.scrollToBottom(), 50);
        }
      }
    );
  }

  async sendMessage(): Promise<void> {
    const message = this.messageInput().trim();
    if (!message) return;

    const address = this.eventAddress();
    if (!address) return;

    const event = this.liveEvent();
    if (!event) return;

    try {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
      if (!dTag) return;

      // Get the relay hint from the event
      const relayTag = event.tags.find(tag => tag[0] === 'relays');
      const relayHint = relayTag && relayTag.length > 1 ? relayTag[1] : '';

      // Get current user's pubkey
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.snackBar.open('Please log in to send messages', 'Close', { duration: 3000 });
        this.messageInput.set(message);
        return;
      }

      // Create the chat message event
      const chatEvent = {
        kind: 1311,
        pubkey: pubkey,
        tags: [
          ['a', address, relayHint, 'root'],
          ['client', 'nostria'],
        ],
        content: message,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Clear input immediately for better UX
      this.messageInput.set('');

      // Sign and publish the event
      const result = await this.nostrService.signAndPublish(chatEvent);

      if (result.success) {
        // Note: We don't manually add the message here because the subscription
        // will pick it up automatically when it's published to relays
        console.log('[LiveChat] Message sent successfully');
      } else {
        // Restore the message if publish failed
        this.messageInput.set(message);
        this.snackBar.open('Failed to send message', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Restore the message on error
      this.messageInput.set(message);
      this.snackBar.open('Error sending message', 'Close', { duration: 3000 });
    }
  }

  toggleView(mode: string) {
    this.viewMode.set(mode as 'chat' | 'participants' | 'settings');
    if (mode === 'chat') {
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  toggleVisibility(): void {
    this.isVisible.update(v => !v);
  }

  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return 'just now';
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Format as time only
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
