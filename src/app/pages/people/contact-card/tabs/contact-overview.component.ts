import { Component, inject, signal, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NostrRecord } from '../../../../interfaces';
import { UserDataService } from '../../../../services/user-data.service';
import { AccountStateService } from '../../../../services/account-state.service';
import { LoggerService } from '../../../../services/logger.service';
import { Event, kinds } from 'nostr-tools';

interface ConnectionStats {
  firstInteraction: number | null;
  daysSinceFirstInteraction: number | null;
  totalInteractions: number;
  ourLikes: number;
  theirLikes: number;
  ourReplies: number;
  theirReplies: number;
  ourReposts: number;
  theirReposts: number;
  isFollowing: boolean;
  followsUs: boolean;
}

@Component({
  selector: 'app-contact-overview',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './contact-overview.component.html',
  styleUrl: './contact-overview.component.scss',
})
export class ContactOverviewComponent {
  pubkey = input.required<string>();
  metadata = input.required<NostrRecord>();

  private userData = inject(UserDataService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);

  stats = signal<ConnectionStats>({
    firstInteraction: null,
    daysSinceFirstInteraction: null,
    totalInteractions: 0,
    ourLikes: 0,
    theirLikes: 0,
    ourReplies: 0,
    theirReplies: 0,
    ourReposts: 0,
    theirReposts: 0,
    isFollowing: false,
    followsUs: false,
  });

  isLoading = signal<boolean>(true);

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();
      if (pubkey && pubkey !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.lastLoadedPubkey = pubkey;
        this.loadConnectionStats(pubkey);
      }
    });
  }

  private async loadConnectionStats(contactPubkey: string): Promise<void> {
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

      // Calculate statistics
      const ourLikes = ourInteractionsWithThem.filter(e => e.kind === kinds.Reaction).length;
      const theirLikes = theirInteractionsWithUs.filter(e => e.kind === kinds.Reaction).length;
      const ourReplies = ourInteractionsWithThem.filter(
        e => e.kind === kinds.ShortTextNote && e.tags.some(t => t[0] === 'e')
      ).length;
      const theirReplies = theirInteractionsWithUs.filter(
        e => e.kind === kinds.ShortTextNote && e.tags.some(t => t[0] === 'e')
      ).length;
      const ourReposts = ourInteractionsWithThem.filter(
        e => e.kind === kinds.Repost || e.kind === 16
      ).length;
      const theirReposts = theirInteractionsWithUs.filter(
        e => e.kind === kinds.Repost || e.kind === 16
      ).length;

      // Find first interaction
      const allInteractions = [...ourInteractionsWithThem, ...theirInteractionsWithUs];
      const sortedInteractions = allInteractions.sort((a, b) => a.created_at - b.created_at);
      const firstInteraction = sortedInteractions.length > 0 ? sortedInteractions[0].created_at : null;
      const daysSinceFirstInteraction = firstInteraction
        ? Math.floor((Date.now() / 1000 - firstInteraction) / 86400)
        : null;

      const totalInteractions = allInteractions.length;

      // Check following status
      const following = this.accountState.followingList();
      const isFollowing = following.includes(contactPubkey);

      // Check if they follow us
      let followsUs = false;
      try {
        const theirContactsRecord = await this.userData.getEventByPubkeyAndKind(
          contactPubkey,
          kinds.Contacts,
          { cache: true, save: true }
        );
        if (theirContactsRecord) {
          followsUs = theirContactsRecord.event.tags.some(
            (tag: string[]) => tag[0] === 'p' && tag[1] === currentUserPubkey
          );
        }
      } catch (error) {
        this.logger.warn('Could not check if contact follows us:', error);
      }

      this.stats.set({
        firstInteraction,
        daysSinceFirstInteraction,
        totalInteractions,
        ourLikes,
        theirLikes,
        ourReplies,
        theirReplies,
        ourReposts,
        theirReposts,
        isFollowing,
        followsUs,
      });
    } catch (error) {
      this.logger.error('Error loading connection stats:', error);
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

  getRelationshipStatus(): string {
    const stats = this.stats();
    if (stats.isFollowing && stats.followsUs) {
      return 'Mutual Connection';
    } else if (stats.isFollowing) {
      return 'Following';
    } else if (stats.followsUs) {
      return 'Follows You';
    }
    return 'No Connection';
  }

  getRelationshipIcon(): string {
    const stats = this.stats();
    if (stats.isFollowing && stats.followsUs) {
      return 'people';
    } else if (stats.isFollowing) {
      return 'person_add';
    } else if (stats.followsUs) {
      return 'person';
    }
    return 'person_outline';
  }
}
