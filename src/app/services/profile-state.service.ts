import { Injectable, signal, computed, effect } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { inject } from '@angular/core';
import { UserRelayServiceEx } from './relays/user-relay';
import { kinds, Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { UserRelayExFactoryService } from './user-relay-factory.service';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root',
})
export class ProfileStateService {
  private readonly logger = inject(LoggerService);
  private readonly relayFactory = inject(UserRelayExFactoryService);
  private readonly utilities = inject(UtilitiesService);

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);
  notes = signal<NostrRecord[]>([]);
  reposts = signal<NostrRecord[]>([]);
  replies = signal<NostrRecord[]>([]);
  articles = signal<NostrRecord[]>([]);
  media = signal<NostrRecord[]>([]);
  relay: UserRelayServiceEx | null = null;

  // Current profile pubkey
  currentProfilePubkey = signal<string>('');

  // Loading states
  isLoadingMoreNotes = signal<boolean>(false);
  hasMoreNotes = signal<boolean>(true);

  constructor() {
    effect(async () => {
      const currentPubkey = this.currentProfilePubkey();

      if (currentPubkey) {
        await this.createRelay(currentPubkey);
        await this.loadUserData(currentPubkey);
      }
    });
  }

  async createRelay(pubkey: string) {
    try {
      this.relay = await this.relayFactory.create(pubkey);
    } catch (err) {
      console.error('Failed to create UserRelay:', err);
      this.logger.error('Failed to create UserRelay:', err);
    }
  }

  setCurrentProfilePubkey(pubkey: string): void {
    this.reset();
    this.currentProfilePubkey.set(pubkey);
  }

  reset() {
    this.followingList.set([]);
    this.notes.set([]);
    this.reposts.set([]);
    this.replies.set([]);
    this.articles.set([]);
    this.media.set([]);
    this.hasMoreNotes.set(true);
  }

  // Computed signals for sorted data
  sortedNotes = computed(() =>
    [...this.notes(), ...this.reposts()].sort((a, b) => b.event.created_at - a.event.created_at),
  );

  sortedReplies = computed(() =>
    [...this.replies()].sort((a, b) => b.event.created_at - a.event.created_at),
  );

  sortedArticles = computed(() =>
    [...this.articles()].sort((a, b) => b.event.created_at - a.event.created_at),
  );

  async loadUserData(pubkey: string) {
    // if (!this.relay || this.relay.relayUrls.length === 0) {
    //   return;
    // }

    this.relay?.subscribeEose(
      [
        {
          kinds: [kinds.Contacts],
          authors: [pubkey],
          limit: 1,
        },
        {
          kinds: [kinds.ShortTextNote],
          authors: [pubkey],
          limit: 5,
        },
        {
          kinds: [kinds.LongFormArticle],
          authors: [pubkey],
          limit: 3,
        },
        {
          kinds: [10063], // BUD-03: User Server List
          authors: [pubkey],
          limit: 1,
        },
        {
          kinds: [kinds.Repost],
          authors: [pubkey],
          limit: 2,
        },
        {
          kinds: [kinds.GenericRepost],
          authors: [pubkey],
          limit: 2,
        },
      ],
      (event: Event) => {
        console.log('Event received', event);

        if (event.kind === kinds.Contacts) {
          const followingList = this.utilities.getPTagsValuesFromEvent(event);
          console.log(followingList);
          // this.followingList.set(followingList);
          this.followingList.set(followingList);
          // If this is the logged on user, also set the account state.
          // if (this.accountState.pubkey() === pubkey) {
          //   this.accountState.followingList.set(followingList);
          // }

          // this.storage.saveEvent(evt);

          // Now you can use 'this' here
          // For example: this.handleContacts(evt);
        } else if (event.kind === kinds.LongFormArticle) {
          this.articles.update((articles) => [...articles, this.utilities.toRecord(event)]);
        } else if (event.kind === kinds.ShortTextNote) {
          const record = this.utilities.toRecord(event);
          if (this.utilities.isRootPost(event)) {
            this.notes.update((events) => [...events, record]);
          } else {
            this.replies.update((events) => [...events, record]);
          }
        } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
          this.reposts.update((reposts) => [...reposts, this.utilities.toRecord(event)]);
        }
      },
      () => {
        console.log('Subscription closed');
      },
    );
  }

  /**
   * Load more notes for the current profile
   * @param beforeTimestamp - Load notes before this timestamp
   */
  async loadMoreNotes(beforeTimestamp?: number): Promise<NostrRecord[]> {
    if (this.isLoadingMoreNotes() || !this.hasMoreNotes() || !this.relay) {
      return [];
    }

    this.isLoadingMoreNotes.set(true);
    const pubkey = this.currentProfilePubkey();

    let foundAnything = false;

    try {
      const currentNotes = this.notes();
      const oldestTimestamp =
        beforeTimestamp ||
        (currentNotes.length > 0
          ? Math.min(...currentNotes.map((n) => n.event.created_at)) - 1
          : Math.floor(Date.now() / 1000));

      this.logger.debug(`Loading more notes for ${pubkey}, before timestamp: ${oldestTimestamp}`);

      return new Promise<NostrRecord[]>((resolve) => {
        const newNotes: NostrRecord[] = [];

        this.relay!.subscribeEose(
          [
            {
              kinds: [kinds.ShortTextNote],
              authors: [pubkey],
              until: oldestTimestamp,
              limit: 5,
            },
            {
              kinds: [kinds.Repost],
              authors: [pubkey],
              limit: 5,
            },
            {
              kinds: [kinds.GenericRepost],
              authors: [pubkey],
              limit: 5,
            },
          ],
          (event) => {
            foundAnything = true;

            // Check if this is a root post (not a reply)
            const isRootPost = !event.tags.some((tag) => tag[0] === 'e');

            if (isRootPost) {
              // Create a NostrRecord - assuming this structure based on existing code
              const record: NostrRecord = {
                event: event,
                data: event.content, // Adjust this based on your actual NostrRecord structure
              };

              // Check if we already have this note to avoid duplicates
              const existingNotes = this.notes();
              const exists = existingNotes.some((n) => n.event.id === event.id);

              if (!exists) {
                newNotes.push(record);
              }
            }
          },
          () => {
            // EOSE callback - subscription finished
            this.logger.debug(`Loaded ${newNotes.length} more notes`);

            // One relay might say there are no more events, but another might have some, so
            // they will set the flag back to true if we found any new notes.
            if (!foundAnything) {
              this.hasMoreNotes.set(false);
            } else {
              // Add new notes to the existing ones
              this.notes.update((existing) => [...existing, ...newNotes]);
              this.hasMoreNotes.set(true);
            }

            this.isLoadingMoreNotes.set(false);
            resolve(newNotes);
          },
        );
      });
    } catch (error) {
      this.logger.error('Failed to load more notes:', error);
      this.isLoadingMoreNotes.set(false);
      return [];
    }
  }
}
