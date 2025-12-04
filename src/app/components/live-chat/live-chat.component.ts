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
import { ReactionService } from '../../services/reaction.service';
import { MatMenuModule } from '@angular/material/menu';

interface ChatReaction {
  content: string; // emoji or + or -
  count: number;
  pubkeys: string[]; // who reacted
  userReacted: boolean; // current user reacted with this
}

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
  reactions?: Map<string, ChatReaction>; // emoji -> reaction info
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
    MatMenuModule,
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
  private reactionService = inject(ReactionService);

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
  private reactionSubscription: { close: () => void } | null = null;
  private messageIds = new Set<string>();
  private reactionIds = new Set<string>();

  // Quick reactions for the picker
  readonly quickReactions = ['👍', '❤️', '😂', '🔥', '🎉', '👏'];

  // Message input
  messageInput = signal('');

  // Reply state
  replyingTo = signal<ChatMessage | null>(null);

  // View mode: 'chat' or 'participants' or 'settings'
  viewMode = signal<'chat' | 'participants' | 'settings'>('chat');

  // Settings
  showZaps = signal(true);
  showScrollToBottom = signal(false);

  // Pagination state
  private oldestMessageTimestamp: number | null = null;
  isLoadingOlderMessages = signal(false);
  hasMoreMessages = signal(true);
  // Load 30 messages initially to reduce render time and improve performance
  private readonly INITIAL_LIMIT = 30;
  // Load 30 more messages at a time when scrolling up for smooth pagination
  private readonly LOAD_MORE_LIMIT = 30;
  // Scroll threshold in pixels to trigger loading older messages
  private readonly SCROLL_THRESHOLD = 200;

  // Store bound scroll handler for proper cleanup
  private boundScrollHandler?: () => void;

  // Computed participants from event (hosts/co-hosts from p tags)
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

  // Computed active participants (people who have chatted or zapped)
  activeParticipants = computed(() => {
    const msgs = this.messages();
    const participantMap = new Map<string, { pubkey: string; chatCount: number; zapCount: number; totalZapAmount: number }>();

    for (const msg of msgs) {
      // Get the actual sender pubkey (for zaps, use zapSender)
      const senderPubkey = msg.type === 'zap' && msg.zapSender ? msg.zapSender : msg.pubkey;

      if (!participantMap.has(senderPubkey)) {
        participantMap.set(senderPubkey, {
          pubkey: senderPubkey,
          chatCount: 0,
          zapCount: 0,
          totalZapAmount: 0,
        });
      }

      const participant = participantMap.get(senderPubkey)!;
      if (msg.type === 'chat') {
        participant.chatCount++;
      } else if (msg.type === 'zap') {
        participant.zapCount++;
        participant.totalZapAmount += msg.zapAmount || 0;
      }
    }

    // Convert to array and sort by total activity (zaps weighted more)
    return Array.from(participantMap.values())
      .sort((a, b) => (b.totalZapAmount + b.chatCount) - (a.totalZapAmount + a.chatCount));
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
    if (this.reactionSubscription) {
      this.reactionSubscription.close();
    }
  } scrollToBottom(): void {
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
      this.showScrollToBottom.set(false);
    }
  }

  onScroll(): void {
    if (!this.messagesContainer) return;

    const container = this.messagesContainer.nativeElement;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Check if user scrolled near the top to load older messages
    if (scrollTop < this.SCROLL_THRESHOLD && !this.isLoadingOlderMessages() && this.hasMoreMessages()) {
      this.loadOlderMessages();
    }

    // Check if user is near bottom to toggle "Go to end" button
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
    this.showScrollToBottom.set(!isNearBottom);
  } private async subscribeToChatMessages(eventAddress: string): Promise<void> {
    // Close existing subscriptions if any
    if (this.chatSubscription) {
      this.chatSubscription.close();
      this.chatSubscription = null;
    }
    if (this.reactionSubscription) {
      this.reactionSubscription.close();
      this.reactionSubscription = null;
    }

    // Reset messages and message IDs for new subscription
    this.messages.set([]);
    this.messageIds.clear();
    this.reactionIds.clear();
    this.activeRelays.set([]);
    this.oldestMessageTimestamp = null;
    this.hasMoreMessages.set(true);

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
      limit: this.INITIAL_LIMIT,
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

          console.log('[LiveChat] Received zap event:');
          console.log(JSON.stringify(event, null, 2));

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

            // Track oldest message timestamp
            if (newMsgs.length > 0) {
              this.oldestMessageTimestamp = newMsgs[0].created_at;
            }

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

    // Subscribe to reactions (kind 7) for chat messages
    this.subscribeToReactions(relayUrls);
  }

  private subscribeToReactions(relayUrls: string[]): void {
    // Subscribe to kind 7 reactions that reference kind 1311 events
    const reactionFilter = {
      kinds: [7],
      '#k': ['1311'], // Filter for reactions to kind 1311 (chat messages)
    };

    this.reactionSubscription = this.relayPool.subscribe(
      relayUrls,
      reactionFilter,
      (event: Event) => {
        this.handleReactionEvent(event);
      }
    );
  }

  private handleReactionEvent(event: Event): void {
    // Skip if already processed
    if (this.reactionIds.has(event.id)) return;
    this.reactionIds.add(event.id);

    // Get the event ID this reaction is for
    const targetEventId = event.tags.find(tag => tag[0] === 'e')?.[1];
    if (!targetEventId) return;

    const reactionContent = event.content || '+';
    const reactorPubkey = event.pubkey;
    const currentUserPubkey = this.accountState.pubkey();

    // Update the message with this reaction
    this.messages.update(msgs => {
      return msgs.map(msg => {
        if (msg.event.id !== targetEventId) return msg;

        // Initialize reactions map if needed
        const reactions = new Map(msg.reactions || []);

        // Get or create reaction entry
        const existingReaction = reactions.get(reactionContent);
        if (existingReaction) {
          // Only add if this user hasn't already reacted with this emoji
          if (!existingReaction.pubkeys.includes(reactorPubkey)) {
            existingReaction.count++;
            existingReaction.pubkeys.push(reactorPubkey);
            if (reactorPubkey === currentUserPubkey) {
              existingReaction.userReacted = true;
            }
          }
        } else {
          reactions.set(reactionContent, {
            content: reactionContent,
            count: 1,
            pubkeys: [reactorPubkey],
            userReacted: reactorPubkey === currentUserPubkey
          });
        }

        return { ...msg, reactions };
      });
    });
  }

  async addReaction(message: ChatMessage, emoji: string): Promise<void> {
    const currentUserPubkey = this.accountState.pubkey();
    if (!currentUserPubkey) {
      this.snackBar.open('Please log in to react', 'Close', { duration: 3000 });
      return;
    }

    // Check if user already reacted with this emoji (check current state)
    const currentMessage = this.messages().find(m => m.event.id === message.event.id);
    const existingReaction = currentMessage?.reactions?.get(emoji);
    if (existingReaction?.pubkeys.includes(currentUserPubkey)) {
      // Already reacted, could implement remove reaction here
      return;
    }

    try {
      const success = await this.reactionService.addReaction(emoji, message.event);
      if (success) {
        // Optimistically update UI - but check again to prevent duplicates
        this.messages.update(msgs => {
          return msgs.map(msg => {
            if (msg.event.id !== message.event.id) return msg;

            const reactions = new Map(msg.reactions || []);
            const existing = reactions.get(emoji);

            // Check if user already in the list (could have been added by subscription)
            if (existing) {
              if (existing.pubkeys.includes(currentUserPubkey)) {
                // Already added, don't duplicate
                return msg;
              }
              existing.count++;
              existing.pubkeys.push(currentUserPubkey);
              existing.userReacted = true;
            } else {
              reactions.set(emoji, {
                content: emoji,
                count: 1,
                pubkeys: [currentUserPubkey],
                userReacted: true
              });
            }

            return { ...msg, reactions };
          });
        });
      }
    } catch (error) {
      console.error('[LiveChat] Error adding reaction:', error);
      this.snackBar.open('Failed to add reaction', 'Close', { duration: 3000 });
    }
  }

  getReactionsArray(message: ChatMessage): ChatReaction[] {
    if (!message.reactions) return [];
    return Array.from(message.reactions.values());
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

      // Build tags array
      const tags: string[][] = [
        ['a', address, relayHint, 'root'],
        ['client', 'nostria'],
      ];

      // Add reply tag if replying to a message
      const replyMessage = this.replyingTo();
      if (replyMessage) {
        tags.push(['e', replyMessage.event.id, '', 'reply']);
        tags.push(['p', replyMessage.pubkey]);
      }

      // Create the chat message event
      const chatEvent = {
        kind: 1311,
        pubkey: pubkey,
        tags,
        content: message,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Clear input and reply state immediately for better UX
      this.messageInput.set('');
      this.replyingTo.set(null);

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

  replyTo(message: ChatMessage): void {
    this.replyingTo.set(message);
  }

  cancelReply(): void {
    this.replyingTo.set(null);
  }

  getReplyMessage(replyToId: string): ChatMessage | undefined {
    return this.messages().find(m => m.event.id === replyToId);
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

  private async loadOlderMessages(): Promise<void> {
    // Don't load if already loading or no more messages
    if (this.isLoadingOlderMessages() || !this.hasMoreMessages()) {
      return;
    }

    // Don't load if we don't have an oldest timestamp yet
    if (this.oldestMessageTimestamp === null) {
      return;
    }

    const address = this.eventAddress();
    if (!address) return;

    const relayUrls = this.activeRelays();
    if (relayUrls.length === 0) {
      return;
    }

    this.isLoadingOlderMessages.set(true);

    console.log('[LiveChat] Loading older messages before:', this.oldestMessageTimestamp);

    // Save current scroll position to restore it later
    const container = this.messagesContainer?.nativeElement;
    const previousScrollHeight = container?.scrollHeight || 0;

    try {
      // Create a filter for older messages
      const filter = {
        kinds: [1311, 9735],
        '#a': [address],
        until: this.oldestMessageTimestamp - 1, // Get messages before the oldest one we have
        limit: this.LOAD_MORE_LIMIT,
      };

      // Use a one-time subscription to fetch older messages
      const olderMessages: ChatMessage[] = [];

      await new Promise<void>((resolve) => {
        const sub = this.relayPool.subscribe(
          relayUrls,
          filter,
          (event: Event) => {
            // Skip if we already have this message
            if (this.messageIds.has(event.id)) return;

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
                  pubkey: event.pubkey,
                  content: comment || zapRequest.content,
                  created_at: event.created_at,
                  formattedTime: new Date(event.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  type: 'zap',
                  zapAmount: amount,
                  zapSender: zapRequest.pubkey
                };
              }
            }

            if (newMessage) {
              olderMessages.push(newMessage);
              this.messageIds.add(event.id);
            }
          }
        );

        // Wait for messages to arrive (2 second timeout for relay responses)
        // This is a reasonable timeout as Nostr relays typically respond within 1-2 seconds
        setTimeout(() => {
          console.log('[LiveChat] Received', olderMessages.length, 'older messages');

          // Close the subscription
          sub.close();
          resolve();
        }, 2000);
      });

      if (olderMessages.length === 0) {
        // No more messages to load
        this.hasMoreMessages.set(false);
      } else {
        // Add older messages to the beginning
        this.messages.update(msgs => {
          const newMsgs = [...olderMessages, ...msgs].sort((a, b) => a.created_at - b.created_at);

          // Update oldest timestamp
          if (newMsgs.length > 0) {
            this.oldestMessageTimestamp = newMsgs[0].created_at;
          }

          // Keep only last 500 messages to prevent memory issues
          if (newMsgs.length > 500) {
            return newMsgs.slice(newMsgs.length - 500);
          }

          return newMsgs;
        });

        // Restore scroll position
        if (container) {
          setTimeout(() => {
            const newScrollHeight = container.scrollHeight;
            const scrollDiff = newScrollHeight - previousScrollHeight;
            container.scrollTop = scrollDiff;
          }, 50);
        }

        // If we received fewer messages than the limit, we've reached the end
        if (olderMessages.length < this.LOAD_MORE_LIMIT) {
          this.hasMoreMessages.set(false);
        }
      }
    } catch (error) {
      console.error('[LiveChat] Error loading older messages:', error);
    } finally {
      this.isLoadingOlderMessages.set(false);
    }
  }
}
