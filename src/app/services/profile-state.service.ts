import { Injectable, signal, computed, effect, untracked } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { inject } from '@angular/core';
import { UserRelayService } from './relays/user-relay';
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
  relay: UserRelayService | null = null;

  // Current profile pubkey
  currentProfileKey = signal<string>('');

  // The "currentProfileKey" can sometimes be "npub" value, this returns parsed hex value.
  pubkey = computed(() => {
    const currentPubkey = this.currentProfileKey();
    return currentPubkey.startsWith('npub')
      ? this.utilities.getPubkeyFromNpub(currentPubkey)
      : currentPubkey;
  });

  // Signal to force reload even with same pubkey
  private reloadTrigger = signal<number>(0);

  // Loading states
  isLoadingMoreNotes = signal<boolean>(false);
  hasMoreNotes = signal<boolean>(true);

  // Loading states for articles
  isLoadingMoreArticles = signal<boolean>(false);
  hasMoreArticles = signal<boolean>(true);

  constructor() {
    effect(async () => {
      const pubkey = this.pubkey();

      // Include reloadTrigger to ensure effect runs when we force reload
      this.reloadTrigger();

      if (pubkey) {
        untracked(async () => {
          await this.createRelay(pubkey);
          await this.loadUserData(pubkey);
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
    this.currentProfileKey.set(pubkey);
  }

  // Force reload of profile data even if pubkey is the same
  forceReloadProfileData(pubkey: string): void {
    this.reset();
    this.currentProfileKey.set(pubkey);
    // Trigger the reload by incrementing the reload trigger
    this.reloadTrigger.update(val => val + 1);
  }

  // Reload current profile data
  reloadCurrentProfile(): void {
    const currentPubkey = this.pubkey();
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
    this.hasMoreArticles.set(true);
  }

  // Computed signals for sorted data
  sortedNotes = computed(() =>
    [...this.notes(), ...this.reposts()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  // Timeline combines notes, reposts, and replies
  sortedTimeline = computed(() =>
    [...this.notes(), ...this.reposts(), ...this.replies()].sort(
      (a, b) => b.event.created_at - a.event.created_at
    )
  );

  sortedReplies = computed(() =>
    [...this.replies()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedArticles = computed(() =>
    [...this.articles()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedMedia = computed(() =>
    [...this.media()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  async loadUserData(pubkey: string) {
    debugger;
    // if (!this.relay || this.relay.relayUrls.length === 0) {
    //   return;
    // }

    // Subscribe to contacts separately since they need special handling (only 1 per user, potentially older)
    // Try user-specific relays first
    const event = await this.relay?.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    if (event && event.kind === kinds.Contacts) {
      const followingList = this.utilities.getPTagsValuesFromEvent(event);
      console.log('Following list extracted:', followingList);
      this.followingList.set(followingList);
    }

    // Also try to get contacts from global/discovery relays as fallback
    // This is needed because contacts might be on different relays than recent content
    setTimeout(async () => {
      // Check if we still don't have a following list after initial attempt
      if (this.followingList().length === 0) {
        console.log('No contacts found on user relays, trying discovery relays as fallback');
        try {
          // Use the discovery relay service to search for contacts event
          const discoveryRelay = this.relay;
          if (discoveryRelay) {
            // Try to get contacts event by searching author + kind
            const contactsEvents = await discoveryRelay.getEventsByPubkeyAndKind(pubkey, kinds.Contacts);
            if (contactsEvents && contactsEvents.length > 0) {
              const contactsEvent = contactsEvents[0]; // Get the most recent one
              const followingList = this.utilities.getPTagsValuesFromEvent(contactsEvent);
              console.log('Following list found via discovery search:', followingList);
              this.followingList.set(followingList);
            }
          }
        } catch (error) {
          console.log('Fallback contacts search failed:', error);
        }
      }
    }, 2000); // Wait 2 seconds before trying fallback

    // Subscribe to content events (notes, articles, reposts)
    const events = await this.relay?.query(pubkey, {
      kinds: [kinds.ShortTextNote, kinds.LongFormArticle, kinds.Repost, kinds.GenericRepost],
      authors: [pubkey],
      limit: 20,
    });

    for (const event of events || []) {
      console.log('Initial content event received', event);
      if (event.kind === kinds.LongFormArticle) {
        const record = this.utilities.toRecord(event);
        // Check for duplicates before adding
        this.articles.update(articles => {
          const exists = articles.some(a => a.event.id === event.id);
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
          this.notes.update(events => {
            const exists = events.some(n => n.event.id === event.id);
            if (exists) {
              console.log('Duplicate note event prevented:', event.id);
              return events;
            }
            console.log('Adding new note:', event.id);
            return [...events, record];
          });
        } else {
          // Check for duplicates before adding to replies
          this.replies.update(events => {
            const exists = events.some(r => r.event.id === event.id);
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
        this.reposts.update(reposts => {
          const exists = reposts.some(r => r.event.id === event.id);
          if (exists) {
            console.log('Duplicate repost event prevented:', event.id);
            return reposts;
          }
          console.log('Adding new repost:', event.id);
          return [...reposts, record];
        });
      } else if (event.kind === 20 || event.kind === 21 || event.kind === 22) {
        // Handle media events (20 = Picture, 21 = Video, 22 = Unknown/Other media)
        const record = this.utilities.toRecord(event);
        // Check for duplicates before adding to media
        this.media.update(media => {
          const exists = media.some(m => m.event.id === event.id);
          if (exists) {
            console.log('Duplicate media event prevented:', event.id);
            return media;
          }
          console.log('Adding new media:', event.id);
          return [...media, record];
        });
      }
    }

    // this.relay?.subscribeEose(
    //   pubkey,
    //   {
    //     kinds: [kinds.ShortTextNote, kinds.LongFormArticle, kinds.Repost, kinds.GenericRepost],
    //     authors: [pubkey],
    //     limit: 20,
    //   },
    //   (event: Event) => {
    //     console.log('Content event received', event);

    //     if (event.kind === kinds.LongFormArticle) {
    //       const record = this.utilities.toRecord(event);
    //       // Check for duplicates before adding
    //       this.articles.update(articles => {
    //         const exists = articles.some(a => a.event.id === event.id);
    //         if (exists) {
    //           console.log('Duplicate article event prevented:', event.id);
    //           return articles;
    //         }
    //         console.log('Adding new article:', event.id);
    //         return [...articles, record];
    //       });
    //     } else if (event.kind === kinds.ShortTextNote) {
    //       const record = this.utilities.toRecord(event);
    //       if (this.utilities.isRootPost(event)) {
    //         // Check for duplicates before adding to notes
    //         this.notes.update(events => {
    //           const exists = events.some(n => n.event.id === event.id);
    //           if (exists) {
    //             console.log('Duplicate note event prevented:', event.id);
    //             return events;
    //           }
    //           console.log('Adding new note:', event.id);
    //           return [...events, record];
    //         });
    //       } else {
    //         // Check for duplicates before adding to replies
    //         this.replies.update(events => {
    //           const exists = events.some(r => r.event.id === event.id);
    //           if (exists) {
    //             console.log('Duplicate reply event prevented:', event.id);
    //             return events;
    //           }
    //           console.log('Adding new reply:', event.id);
    //           return [...events, record];
    //         });
    //       }
    //     } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
    //       const record = this.utilities.toRecord(event);
    //       // Check for duplicates before adding to reposts
    //       this.reposts.update(reposts => {
    //         const exists = reposts.some(r => r.event.id === event.id);
    //         if (exists) {
    //           console.log('Duplicate repost event prevented:', event.id);
    //           return reposts;
    //         }
    //         console.log('Adding new repost:', event.id);
    //         return [...reposts, record];
    //       });
    //     } else if (event.kind === 20 || event.kind === 21 || event.kind === 22) {
    //       // Handle media events (20 = Picture, 21 = Video, 22 = Unknown/Other media)
    //       const record = this.utilities.toRecord(event);
    //       // Check for duplicates before adding to media
    //       this.media.update(media => {
    //         const exists = media.some(m => m.event.id === event.id);
    //         if (exists) {
    //           console.log('Duplicate media event prevented:', event.id);
    //           return media;
    //         }
    //         console.log('Adding new media:', event.id);
    //         return [...media, record];
    //       });
    //     }
    //   },
    //   () => {
    //     console.log('Subscription closed');
    //   }
    // );
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
    const pubkey = this.pubkey();

    try {
      const currentNotes = this.notes();
      const oldestTimestamp =
        beforeTimestamp ||
        (currentNotes.length > 0
          ? Math.min(...currentNotes.map(n => n.event.created_at)) - 1
          : Math.floor(Date.now() / 1000));

      this.logger.debug(`Loading more notes for ${pubkey}, before timestamp: ${oldestTimestamp}`);

      return new Promise<NostrRecord[]>(resolve => {
        const newNotes: NostrRecord[] = [];
        const newReplies: NostrRecord[] = [];

        this.relay?.query(pubkey, {
          kinds: [kinds.ShortTextNote, kinds.Repost, kinds.GenericRepost],
          authors: [pubkey],
          until: oldestTimestamp,
          limit: 15,
        });

        this.relay!.subscribeEose(
          pubkey,
          {
            kinds: [kinds.ShortTextNote, kinds.Repost, kinds.GenericRepost],
            authors: [pubkey],
            until: oldestTimestamp,
            limit: 15, // Increased limit to get more timeline content
          },
          (event: Event) => {
            // Handle different event types
            if (event.kind === kinds.ShortTextNote) {
              // Create a NostrRecord
              const record: NostrRecord = {
                event: event,
                data: event.content,
              };

              // Check if this is a root post (not a reply)
              const isRootPost = this.utilities.isRootPost(event);

              if (isRootPost) {
                // Check if we already have this note to avoid duplicates
                const existingNotes = this.notes();
                const exists = existingNotes.some(n => n.event.id === event.id);

                if (!exists) {
                  newNotes.push(record);
                }
              } else {
                // This is a reply
                // Check if we already have this reply to avoid duplicates
                const existingReplies = this.replies();
                const exists = existingReplies.some(r => r.event.id === event.id);

                if (!exists) {
                  newReplies.push(record);
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
              const exists = existingReposts.some(r => r.event.id === event.id);

              if (!exists) {
                // Add to reposts directly since loadMoreNotes is for notes, but we should handle reposts too
                this.reposts.update(existing => [...existing, record]);
              }
            }
          },
          () => {
            // EOSE callback - subscription finished
            this.logger.debug(
              `Loaded ${newNotes.length} more notes and ${newReplies.length} more replies`
            );

            // Track if we added any new content
            let addedAnyContent = false;

            // Add new notes to the existing ones with final deduplication check
            if (newNotes.length > 0) {
              this.notes.update(existing => {
                const filtered = newNotes.filter(
                  newNote =>
                    !existing.some(existingNote => existingNote.event.id === newNote.event.id)
                );
                console.log(
                  `Adding ${filtered.length} new notes (${newNotes.length - filtered.length} duplicates filtered)`
                );

                if (filtered.length > 0) {
                  addedAnyContent = true;
                }

                return [...existing, ...filtered];
              });
            }

            // Add new replies to the existing ones with final deduplication check
            if (newReplies.length > 0) {
              this.replies.update(existing => {
                const filtered = newReplies.filter(
                  newReply =>
                    !existing.some(existingReply => existingReply.event.id === newReply.event.id)
                );
                console.log(
                  `Adding ${filtered.length} new replies (${newReplies.length - filtered.length} duplicates filtered)`
                );

                if (filtered.length > 0) {
                  addedAnyContent = true;
                }

                return [...existing, ...filtered];
              });
            }

            // Only keep hasMoreNotes true if we actually added new content
            if (!addedAnyContent) {
              this.hasMoreNotes.set(false);
            } else {
              this.hasMoreNotes.set(true);
            }

            this.isLoadingMoreNotes.set(false);
            resolve([...newNotes, ...newReplies]);
          }
        );
      });
    } catch (error) {
      this.logger.error('Failed to load more notes:', error);
      this.isLoadingMoreNotes.set(false);
      return [];
    }
  }

  /**
   * Load more articles for the current profile
   * @param beforeTimestamp - Load articles before this timestamp
   */
  async loadMoreArticles(beforeTimestamp?: number): Promise<NostrRecord[]> {
    if (this.isLoadingMoreArticles() || !this.hasMoreArticles() || !this.relay) {
      return [];
    }

    this.isLoadingMoreArticles.set(true);
    const pubkey = this.pubkey();

    try {
      const currentArticles = this.articles();
      const oldestTimestamp =
        beforeTimestamp ||
        (currentArticles.length > 0
          ? Math.min(...currentArticles.map(a => a.event.created_at)) - 1
          : Math.floor(Date.now() / 1000));

      this.logger.debug(
        `Loading more articles for ${pubkey}, before timestamp: ${oldestTimestamp}`
      );

      return new Promise<NostrRecord[]>(resolve => {
        const newArticles: NostrRecord[] = [];

        this.relay!.subscribeEose(
          pubkey,
          {
            kinds: [kinds.LongFormArticle],
            authors: [pubkey],
            until: oldestTimestamp,
            limit: 10, // Load 10 more articles at a time
          },
          (event: Event) => {
            if (event.kind === kinds.LongFormArticle) {
              // Create a NostrRecord
              const record: NostrRecord = {
                event: event,
                data: event.content,
              };

              // Check if we already have this article to avoid duplicates
              const existingArticles = this.articles();
              const exists = existingArticles.some(a => a.event.id === event.id);

              if (!exists) {
                newArticles.push(record);
              }
            }
          },
          () => {
            // EOSE callback - subscription finished
            this.logger.debug(`Loaded ${newArticles.length} more articles`);

            // Track if we added any new content
            let addedAnyContent = false;

            // Add new articles to the existing ones with final deduplication check
            if (newArticles.length > 0) {
              this.articles.update(existing => {
                const filtered = newArticles.filter(
                  newArticle =>
                    !existing.some(
                      existingArticle => existingArticle.event.id === newArticle.event.id
                    )
                );
                console.log(
                  `Adding ${filtered.length} new articles (${newArticles.length - filtered.length} duplicates filtered)`
                );

                if (filtered.length > 0) {
                  addedAnyContent = true;
                }

                return [...existing, ...filtered];
              });
            }

            // Only keep hasMoreArticles true if we actually added new content
            if (!addedAnyContent) {
              this.hasMoreArticles.set(false);
            } else {
              this.hasMoreArticles.set(true);
            }

            this.isLoadingMoreArticles.set(false);
            resolve(newArticles);
          }
        );
      });
    } catch (error) {
      this.logger.error('Failed to load more articles:', error);
      this.isLoadingMoreArticles.set(false);
      return [];
    }
  }
}
