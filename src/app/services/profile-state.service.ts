import { Injectable, signal, computed, effect, untracked } from '@angular/core';
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

  // Signal to force reload even with same pubkey
  private reloadTrigger = signal<number>(0);

  // Loading states
  isLoadingMoreNotes = signal<boolean>(false);
  hasMoreNotes = signal<boolean>(true);

  constructor() {
    effect(async () => {
      const currentPubkey = this.currentProfilePubkey();

      // Include reloadTrigger to ensure effect runs when we force reload
      this.reloadTrigger();

      if (currentPubkey) {
        untracked(async () => {
          await this.createRelay(currentPubkey);
          await this.loadUserData(currentPubkey);
        });
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

  // Force reload of profile data even if pubkey is the same
  forceReloadProfileData(pubkey: string): void {
    this.reset();
    this.currentProfilePubkey.set(pubkey);
    // Trigger the reload by incrementing the reload trigger
    this.reloadTrigger.update((val) => val + 1);
  }

  // Reload current profile data
  reloadCurrentProfile(): void {
    const currentPubkey = this.currentProfilePubkey();
    if (currentPubkey) {
      console.log('ProfileStateService: Reloading current profile data for', currentPubkey);
      this.forceReloadProfileData(currentPubkey);
    }
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
          const record = this.utilities.toRecord(event);
          // Check for duplicates before adding
          this.articles.update((articles) => {
            const exists = articles.some((a) => a.event.id === event.id);
            if (exists) {
              console.log('Duplicate article event prevented:', event.id);
              return articles;
            }
            console.log('Adding new article:', event.id);
            return [...articles, record];
          });
        } else if (event.kind === kinds.ShortTextNote) {
          const record = this.utilities.toRecord(event);
          if (this.utilities.isRootPost(event)) {
            // Check for duplicates before adding to notes
            this.notes.update((events) => {
              const exists = events.some((n) => n.event.id === event.id);
              if (exists) {
                console.log('Duplicate note event prevented:', event.id);
                return events;
              }
              console.log('Adding new note:', event.id);
              return [...events, record];
            });
          } else {
            // Check for duplicates before adding to replies
            this.replies.update((events) => {
              const exists = events.some((r) => r.event.id === event.id);
              if (exists) {
                console.log('Duplicate reply event prevented:', event.id);
                return events;
              }
              console.log('Adding new reply:', event.id);
              return [...events, record];
            });
          }
        } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
          const record = this.utilities.toRecord(event);
          // Check for duplicates before adding to reposts
          this.reposts.update((reposts) => {
            const exists = reposts.some((r) => r.event.id === event.id);
            if (exists) {
              console.log('Duplicate repost event prevented:', event.id);
              return reposts;
            }
            console.log('Adding new repost:', event.id);
            return [...reposts, record];
          });
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

            // Handle different event types
            if (event.kind === kinds.ShortTextNote) {
              // Check if this is a root post (not a reply)
              const isRootPost = !event.tags.some((tag) => tag[0] === 'e');

              if (isRootPost) {
                // Create a NostrRecord
                const record: NostrRecord = {
                  event: event,
                  data: event.content,
                };

                // Check if we already have this note to avoid duplicates
                const existingNotes = this.notes();
                const exists = existingNotes.some((n) => n.event.id === event.id);

                if (!exists) {
                  newNotes.push(record);
                }
              }
            } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
              // Handle reposts
              const record: NostrRecord = {
                event: event,
                data: event.content,
              };

              // Check if we already have this repost to avoid duplicates
              const existingReposts = this.reposts();
              const exists = existingReposts.some((r) => r.event.id === event.id);

              if (!exists) {
                // Add to reposts directly since loadMoreNotes is for notes, but we should handle reposts too
                this.reposts.update((existing) => [...existing, record]);
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
              // Add new notes to the existing ones with final deduplication check
              this.notes.update((existing) => {
                const filtered = newNotes.filter(
                  (newNote) =>
                    !existing.some((existingNote) => existingNote.event.id === newNote.event.id),
                );
                console.log(
                  `Adding ${filtered.length} new notes (${newNotes.length - filtered.length} duplicates filtered)`,
                );
                return [...existing, ...filtered];
              });
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
