import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { AccountService } from '../../api/services/account.service';
import { UtilitiesService } from '../../services/utilities.service';

interface ChatMessage {
  event: Event;
  pubkey: string;
  content: string;
  created_at: number;
  replyTo?: string;
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
    UserProfileComponent,
    ProfileDisplayNameComponent,
  ],
  templateUrl: './live-chat.component.html',
  styleUrl: './live-chat.component.scss',
})
export class LiveChatComponent {
  private relayPool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountService = inject(AccountService);
  private utilities = inject(UtilitiesService);

  // Input: The live event data (kind 30311 or 30313)
  liveEvent = input<Event | undefined>(undefined);

  // Chat messages
  messages = signal<ChatMessage[]>([]);

  // Message input
  messageInput = signal('');

  // View mode: 'chat' or 'participants'
  viewMode = signal<'chat' | 'participants'>('chat');

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
      if (!address) return;

      this.subscribeToChatMessages(address);
    });
  }

  private async subscribeToChatMessages(eventAddress: string): Promise<void> {
    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('No relays available for chat messages');
      return;
    }

    // Query for kind 1311 chat messages
    const filter = {
      kinds: [1311],
      '#a': [eventAddress],
      limit: 100,
    };

    try {
      const events = await this.relayPool.query(relayUrls, filter, 5000);

      const chatMessages: ChatMessage[] = events
        .map(event => {
          // Find reply-to event ID from 'e' tag
          const replyTag = event.tags.find(tag => tag[0] === 'e');

          return {
            event: event,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
            replyTo: replyTag?.[1],
          };
        })
        .sort((a, b) => a.created_at - b.created_at); // Oldest first

      this.messages.set(chatMessages);
    } catch (error) {
      console.error('Error querying chat messages:', error);
    }
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

      // Create the chat message event
      const chatEvent: Partial<Event> = {
        kind: 1311,
        tags: [
          ['a', address, relayHint, 'root'],
        ],
        content: message,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Sign and publish (this would need to be implemented through AccountService)
      // For now, we'll just clear the input
      this.messageInput.set('');

      console.log('Would publish chat message:', chatEvent);
      // await this.accountService.publishEvent(chatEvent);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  toggleView(mode: 'chat' | 'participants'): void {
    this.viewMode.set(mode);
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
