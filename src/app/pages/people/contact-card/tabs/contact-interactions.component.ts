import { Component, inject, signal, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { UserDataService } from '../../../../services/user-data.service';
import { AccountStateService } from '../../../../services/account-state.service';
import { LoggerService } from '../../../../services/logger.service';
import { AgoPipe } from '../../../../pipes/ago.pipe';
import { Event, kinds } from 'nostr-tools';

type InteractionType = 'like-given' | 'like-received' | 'reply-given' | 'reply-received' | 'repost-given' | 'repost-received';

interface Interaction {
  type: InteractionType;
  event: Event;
  timestamp: number;
  description: string;
  icon: string;
  iconColor: string;
}

@Component({
  selector: 'app-contact-interactions',
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatListModule,
    MatProgressSpinnerModule,
    AgoPipe,
  ],
  templateUrl: './contact-interactions.component.html',
  styleUrl: './contact-interactions.component.scss',
})
export class ContactInteractionsComponent {
  pubkey = input.required<string>();

  private userData = inject(UserDataService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);

  interactions = signal<Interaction[]>([]);
  isLoading = signal<boolean>(true);

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();
      if (pubkey && pubkey !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.lastLoadedPubkey = pubkey;
        this.loadInteractions(pubkey);
      }
    });
  }

  private async loadInteractions(contactPubkey: string): Promise<void> {
    if (this.loadingInProgress) return;

    this.loadingInProgress = true;
    this.isLoading.set(true);
    try {
      const currentUserPubkey = this.accountState.pubkey();
      if (!currentUserPubkey) {
        this.isLoading.set(false);
        this.loadingInProgress = false;
        return;
      }

      const [ourInteractionsWithThem, theirInteractionsWithUs] = await Promise.all([
        this.getInteractionEvents(currentUserPubkey, contactPubkey),
        this.getInteractionEvents(contactPubkey, currentUserPubkey),
      ]);

      const allInteractions: Interaction[] = [];

      // Process our interactions with them
      for (const event of ourInteractionsWithThem) {
        const interaction = this.createInteraction(event, 'given');
        if (interaction) {
          allInteractions.push(interaction);
        }
      }

      // Process their interactions with us
      for (const event of theirInteractionsWithUs) {
        const interaction = this.createInteraction(event, 'received');
        if (interaction) {
          allInteractions.push(interaction);
        }
      }

      // Sort by timestamp (newest first)
      allInteractions.sort((a, b) => b.timestamp - a.timestamp);

      this.interactions.set(allInteractions);
    } catch (error) {
      this.logger.error('Error loading interactions:', error);
    } finally {
      this.isLoading.set(false);
      this.loadingInProgress = false;
    }
  }

  private async getInteractionEvents(authorPubkey: string, targetPubkey: string): Promise<Event[]> {
    try {
      // Get all events by the author for each kind separately
      const eventArrays = await Promise.all([
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Reaction, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.ShortTextNote, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Repost, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, 16, { cache: true, save: true }), // Generic repost
      ]);

      // Flatten and extract events from NostrRecord
      const authorEvents = eventArrays.flat().map(record => record.event);

      // Filter for interactions with the target user
      const interactions = authorEvents.filter((event: Event) => {
        // Check if the event references the target pubkey
        const pTags = event.tags.filter((t: string[]) => t[0] === 'p');
        return pTags.some((t: string[]) => t[1] === targetPubkey);
      });

      return interactions;
    } catch (error) {
      this.logger.error('Error getting interaction events:', error);
      return [];
    }
  }

  private createInteraction(event: Event, direction: 'given' | 'received'): Interaction | null {
    let type: InteractionType;
    let description: string;
    let icon: string;
    let iconColor: string;

    if (event.kind === kinds.Reaction) {
      type = direction === 'given' ? 'like-given' : 'like-received';
      description = direction === 'given' ? 'You liked their post' : 'They liked your post';
      icon = 'favorite';
      iconColor = 'var(--mat-sys-error)';
    } else if (event.kind === kinds.ShortTextNote) {
      type = direction === 'given' ? 'reply-given' : 'reply-received';
      description = direction === 'given' ? 'You replied to their post' : 'They replied to your post';
      icon = 'reply';
      iconColor = 'var(--mat-sys-primary)';
    } else if (event.kind === kinds.Repost || event.kind === 16) {
      type = direction === 'given' ? 'repost-given' : 'repost-received';
      description = direction === 'given' ? 'You reposted their post' : 'They reposted your post';
      icon = 'repeat';
      iconColor = 'var(--mat-sys-tertiary)';
    } else {
      return null;
    }

    return {
      type,
      event,
      timestamp: event.created_at,
      description,
      icon,
      iconColor,
    };
  }

  getInteractionContent(interaction: Interaction): string {
    const event = interaction.event;

    // For replies, show the content
    if (interaction.type === 'reply-given' || interaction.type === 'reply-received') {
      const content = event.content.trim();
      if (content.length > 100) {
        return content.substring(0, 100) + '...';
      }
      return content;
    }

    // For reactions, show the reaction emoji
    if (interaction.type === 'like-given' || interaction.type === 'like-received') {
      const content = event.content;
      // Convert + to thumbs up, - to thumbs down
      if (content === '+') return '👍';
      if (content === '-') return '👎';
      // Return the emoji content (handles both regular emojis and custom emoji shortcodes)
      return content || '👍';
    }

    return '';
  }

  getCustomEmojiUrl(interaction: Interaction): string | null {
    const event = interaction.event;
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1); // Remove colons
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);

    return emojiTag?.[2] || null;
  }

  navigateToEvent(interaction: Interaction): void {
    // Get the event ID being interacted with
    const eventTag = interaction.event.tags.find(t => t[0] === 'e');
    if (eventTag && eventTag[1]) {
      // Navigate to the original event
      window.open(`/e/${eventTag[1]}`, '_blank');
    }
  }
}
