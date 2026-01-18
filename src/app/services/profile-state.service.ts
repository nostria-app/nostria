import { Injectable, signal, computed, effect, untracked } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { inject } from '@angular/core';
import { UserRelayService } from './relays/user-relay';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';
import { TimelineFilterOptions, DEFAULT_TIMELINE_FILTER } from '../interfaces/timeline-filter';

@Injectable({
  providedIn: 'root',
})
export class ProfileStateService {
  private readonly logger = inject(LoggerService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly utilities = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);
  notes = signal<NostrRecord[]>([]);
  reposts = signal<NostrRecord[]>([]);
  replies = signal<NostrRecord[]>([]);
  articles = signal<NostrRecord[]>([]);
  media = signal<NostrRecord[]>([]);
  audio = signal<NostrRecord[]>([]);
  reactions = signal<NostrRecord[]>([]);

  // Current profile pubkey
  currentProfileKey = signal<string>('');

  // The "currentProfileKey" can sometimes be "npub" value, this returns parsed hex value.
  pubkey = computed(() => {
    const currentPubkey = this.currentProfileKey();
    return currentPubkey.startsWith('npub')
      ? this.utilities.getPubkeyFromNpub(currentPubkey)
      : currentPubkey;
  });

  // Signal to track which panel the profile is rendered in
  // Set by the profile component based on route outlet
  isInRightPanel = signal<boolean>(false);

  // Signal to force reload even with same pubkey
  private reloadTrigger = signal<number>(0);

  // Track the currently loading pubkey to prevent race conditions
  private currentlyLoadingPubkey = signal<string>('');

  // Loading states
  isInitiallyLoading = signal<boolean>(false);
  isLoadingMoreNotes = signal<boolean>(false);
  hasMoreNotes = signal<boolean>(true);

  // Track the oldest timestamp from relay-loaded events for pagination
  // This is separate from cached events to ensure proper infinite scroll
  private oldestRelayTimestamp = signal<number | null>(null);

  // Loading states for articles
  isLoadingMoreArticles = signal<boolean>(false);
  hasMoreArticles = signal<boolean>(true);

  // Loading states for media
  isLoadingMoreMedia = signal<boolean>(false);
  hasMoreMedia = signal<boolean>(true);

  // Timeline filter options
  timelineFilter = signal<TimelineFilterOptions>({ ...DEFAULT_TIMELINE_FILTER });

  // Display limit for virtualized rendering - only render this many items initially
  // This prevents browser sluggishness when many events are loaded
  private readonly INITIAL_DISPLAY_LIMIT = 10;
  private readonly DISPLAY_INCREMENT = 10;
  displayLimit = signal<number>(this.INITIAL_DISPLAY_LIMIT);

  constructor() {
    effect(async () => {
      const pubkey = this.pubkey();

      // Include reloadTrigger to ensure effect runs when we force reload
      this.reloadTrigger();

      if (pubkey) {
        untracked(async () => {
          await this.ensureRelaysForPubkey(pubkey);
          await this.loadUserData(pubkey);
        });
      }
    });
  }

  async ensureRelaysForPubkey(pubkey: string) {
    try {
      await this.userRelayService.ensureRelaysForPubkey(pubkey);
    } catch (err) {
      console.error('Failed to ensure relays for pubkey:', err);
      this.logger.error('Failed to ensure relays for pubkey:', err);
    }
  }

  setCurrentProfilePubkey(pubkey: string): void {
    this.reset();
    this.currentProfileKey.set(pubkey);
    // Reset the loading tracker to prevent race conditions
    this.currentlyLoadingPubkey.set('');
  }

  // Force reload of profile data even if pubkey is the same
  forceReloadProfileData(pubkey: string): void {
    this.reset();
    this.currentProfileKey.set(pubkey);
    // Reset the loading tracker to prevent race conditions
    this.currentlyLoadingPubkey.set('');
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
    // Reset the loading tracker first to immediately invalidate any in-flight requests
    this.currentlyLoadingPubkey.set('');
    this.isInitiallyLoading.set(false);
    this.followingList.set([]);
    this.notes.set([]);
    this.reposts.set([]);
    this.replies.set([]);
    this.articles.set([]);
    this.oldestRelayTimestamp.set(null);
    this.media.set([]);
    this.audio.set([]);
    this.reactions.set([]);
    this.hasMoreNotes.set(true);
    this.hasMoreArticles.set(true);
    this.hasMoreMedia.set(true);
    // Reset display limit to initial value for new profile
    this.displayLimit.set(this.INITIAL_DISPLAY_LIMIT);
  }

  // Computed signals for sorted data
  sortedNotes = computed(() =>
    [...this.notes(), ...this.reposts()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  // Timeline combines notes, reposts, and replies with filtering
  sortedTimeline = computed(() => {
    const filter = this.timelineFilter();
    const items: NostrRecord[] = [];

    // Add notes (root posts) if enabled
    if (filter.showNotes) {
      items.push(...this.notes());
    }

    // Add reposts if enabled
    if (filter.showReposts) {
      items.push(...this.reposts());
    }

    // Add replies if enabled
    if (filter.showReplies) {
      items.push(...this.replies());
    }

    // Add audio if enabled
    if (filter.showAudio) {
      items.push(...this.audio());
    }

    // Add video if enabled
    if (filter.showVideo) {
      // Filter media for video kinds
      const videoEvents = this.media().filter(
        m =>
          m.event.kind === 21 ||
          m.event.kind === 22 ||
          m.event.kind === 34235 ||
          m.event.kind === 34236
      );
      items.push(...videoEvents);
    }

    // Add reactions if enabled
    if (filter.showReactions) {
      items.push(...this.reactions());
    }

    // Sort by created_at timestamp descending (newest first)
    return items.sort((a, b) => b.event.created_at - a.event.created_at);
  });

  // Displayed timeline - only shows items up to displayLimit for performance
  // This prevents browser sluggishness when many events are loaded into memory
  displayedTimeline = computed(() => {
    const timeline = this.sortedTimeline();
    const limit = this.displayLimit();
    return timeline.slice(0, limit);
  });

  // Check if there are more items to display (beyond current displayLimit)
  hasMoreToDisplay = computed(() => {
    return this.sortedTimeline().length > this.displayLimit();
  });

  sortedReplies = computed(() =>
    [...this.replies()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedArticles = computed(() =>
    [...this.articles()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedMedia = computed(() =>
    [...this.media()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  // Update timeline filter options
  updateTimelineFilter(filter: Partial<TimelineFilterOptions>): void {
    this.timelineFilter.update(current => ({ ...current, ...filter }));
    // Reset display limit when filter changes
    this.displayLimit.set(this.INITIAL_DISPLAY_LIMIT);

    // Reload data with new filter to ensure we have the content for enabled filters
    const pubkey = this.pubkey();
    if (pubkey) {
      this.loadUserData(pubkey);
    }
  }

  // Reset timeline filter to defaults
  resetTimelineFilter(): void {
    this.timelineFilter.set({ ...DEFAULT_TIMELINE_FILTER });
    this.displayLimit.set(this.INITIAL_DISPLAY_LIMIT);
  }

  /**
   * Increase the display limit to show more items in the timeline.
   * Call this when user scrolls near the bottom of the visible content.
   * Returns true if limit was increased, false if already at max.
   */
  increaseDisplayLimit(): boolean {
    const currentLimit = this.displayLimit();
    const totalItems = this.sortedTimeline().length;

    // If we're already showing all items, no need to increase
    if (currentLimit >= totalItems) {
      return false;
    }

    // Increase the limit
    this.displayLimit.update(limit => limit + this.DISPLAY_INCREMENT);
    this.logger.debug(`Increased display limit to ${this.displayLimit()}, total items: ${totalItems}`);
    return true;
  }

  /**
   * Check if we need to load more events from relays.
   * This is needed when the display limit approaches the total loaded items
   * and there might be more events available from relays.
   * 
   * Special handling for filtered views (e.g., "notes only"):
   * When user has filtered to show only original posts (not replies),
   * we may need to fetch more events because many events in the relay
   * could be replies that don't match the filter.
   */
  shouldLoadMoreFromRelay(): boolean {
    const displayLimit = this.displayLimit();
    const totalFiltered = this.sortedTimeline().length;
    const hasMore = this.hasMoreNotes();

    // Calculate buffer based on filter settings
    // If filtering heavily (e.g., notes only), use a larger buffer
    const filter = this.timelineFilter();
    const isHeavilyFiltered = filter.showNotes && !filter.showReplies && !filter.showReposts;
    const buffer = isHeavilyFiltered ? 10 : 5;

    // Load more when we're within buffer items of the end and there might be more
    return hasMore && (displayLimit + buffer >= totalFiltered);
  }

  /**
   * Check if the filtered timeline has too few items and we should load more.
   * This handles the case where user has a restrictive filter (e.g., "notes only")
   * but most loaded events are replies.
   * 
   * @returns true if we should auto-load more events
   */
  hasInsufficientFilteredContent(): boolean {
    const displayLimit = this.displayLimit();
    const filteredCount = this.sortedTimeline().length;
    const hasMore = this.hasMoreNotes();
    const isLoading = this.isLoadingMoreNotes();

    // If we don't have enough filtered content to fill the display limit
    // and there might be more events available, we should load more
    return hasMore && !isLoading && filteredCount < displayLimit;
  }

  /**
   * Load cached events from database for immediate display.
   * This provides a better user experience by showing content instantly while fresh data loads.
   * 
   * @param pubkey - The hex public key of the profile to load cached events for
   * @returns Promise that resolves when cached events are loaded (or if loading fails gracefully)
   * 
   * Note: If no cached events exist, this method returns early without error.
   * Any errors during loading are caught and logged, allowing relay loading to proceed.
   */
  private async loadCachedEvents(pubkey: string): Promise<void> {
    try {
      this.logger.info(`Loading cached events from database for: ${pubkey}`);

      // Get all cached events by pubkey from storage
      const cachedEvents = await this.database.getEventsByPubkey(pubkey);

      if (!cachedEvents || cachedEvents.length === 0) {
        this.logger.debug(`No cached events found for: ${pubkey}`);
        return;
      }

      this.logger.info(`Found ${cachedEvents.length} cached events for: ${pubkey}`);

      // Process cached events and populate the signals
      for (const event of cachedEvents) {
        // Check if we're still loading this profile
        if (this.currentlyLoadingPubkey() !== pubkey) {
          this.logger.debug(`Profile switched during cached events load. Stopping for: ${pubkey}`);
          return;
        }

        if (event.kind === kinds.LongFormArticle) {
          const record = this.utilities.toRecord(event);
          this.articles.update(articles => {
            const exists = articles.some(a => a.event.id === event.id);
            if (!exists) {
              return [...articles, record];
            }
            return articles;
          });
        } else if (event.kind === kinds.ShortTextNote) {
          const record = this.utilities.toRecord(event);
          if (this.utilities.isRootPost(event)) {
            this.notes.update(notes => {
              const exists = notes.some(n => n.event.id === event.id);
              if (!exists) {
                return [...notes, record];
              }
              return notes;
            });
          } else {
            this.replies.update(replies => {
              const exists = replies.some(r => r.event.id === event.id);
              if (!exists) {
                return [...replies, record];
              }
              return replies;
            });
          }
        } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
          const record = this.utilities.toRecord(event);
          this.reposts.update(reposts => {
            const exists = reposts.some(r => r.event.id === event.id);
            if (!exists) {
              return [...reposts, record];
            }
            return reposts;
          });
        } else if (event.kind === 20 || event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
          const record = this.utilities.toRecord(event);
          this.media.update(media => {
            const exists = media.some(m => m.event.id === event.id);
            if (!exists) {
              return [...media, record];
            }
            return media;
          });
        } else if (event.kind === 1222 || event.kind === 1244) {
          const record = this.utilities.toRecord(event);
          this.audio.update(audio => {
            const exists = audio.some(a => a.event.id === event.id);
            if (!exists) {
              return [...audio, record];
            }
            return audio;
          });
        } else if (event.kind === kinds.Reaction) {
          const record = this.utilities.toRecord(event);
          this.reactions.update(reactions => {
            const exists = reactions.some(r => r.event.id === event.id);
            if (!exists) {
              return [...reactions, record];
            }
            return reactions;
          });
        } else if (event.kind === kinds.Contacts) {
          // Load cached contacts/following list for initial display.
          // Only set if following list is empty - fresh data from relays will update it later.
          const followingList = this.utilities.getPTagsValuesFromEvent(event);
          if (followingList.length > 0 && this.followingList().length === 0) {
            this.followingList.set(followingList);
          }
        }
      }

      this.logger.info(`Loaded cached events: notes=${this.notes().length}, articles=${this.articles().length}, media=${this.media().length}`);
    } catch (error) {
      this.logger.error(`Error loading cached events for ${pubkey}:`, error);
      // Don't throw - continue with relay loading even if cache fails
    }
  }

  async loadUserData(pubkey: string) {
    // Set the currently loading pubkey to track this request
    this.currentlyLoadingPubkey.set(pubkey);
    this.isInitiallyLoading.set(true);
    this.logger.info(`Starting to load profile data for: ${pubkey}`);

    // First, load cached events from database for immediate display
    await this.loadCachedEvents(pubkey);

    // Check if profile was switched during cache loading
    if (this.currentlyLoadingPubkey() !== pubkey) {
      this.logger.info(`Profile switched during cache load. Stopping for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

    // Subscribe to contacts separately since they need special handling (only 1 per user, potentially older)
    // Try user-specific relays first
    const event = await this.userRelayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

    // Check if we're still loading this profile (user didn't switch to another profile)
    if (this.currentlyLoadingPubkey() !== pubkey) {
      this.logger.info(`Profile switched during contacts load. Discarding results for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

    // Double-check against the current pubkey
    if (this.pubkey() !== pubkey) {
      this.logger.info(`Current profile changed during contacts load. Discarding results for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

    if (event && event.kind === kinds.Contacts) {
      const followingList = this.utilities.getPTagsValuesFromEvent(event);
      this.followingList.set(followingList);
    }

    // Also try to get contacts from global/discovery relays as fallback
    // This is needed because contacts might be on different relays than recent content
    setTimeout(async () => {
      // Check if we're still on the same profile
      if (this.currentlyLoadingPubkey() !== pubkey) {
        this.logger.info(`Profile switched before fallback contacts load. Skipping for: ${pubkey}`);
        return;
      }

      // Double-check against the current pubkey
      if (this.pubkey() !== pubkey) {
        this.logger.info(`Current profile changed before fallback contacts load. Skipping for: ${pubkey}`);
        return;
      }

      // Check if we still don't have a following list after initial attempt
      if (this.followingList().length === 0) {
        console.log('No contacts found on user relays, trying discovery relays as fallback');
        try {
          // Try to get contacts event by searching author + kind
          const contactsEvents = await this.userRelayService.getEventsByPubkeyAndKind(pubkey, kinds.Contacts);

          // Verify we're still on the same profile after async operation
          if (this.currentlyLoadingPubkey() !== pubkey) {
            this.logger.info(`Profile switched during fallback contacts load. Discarding results for: ${pubkey}`);
            return;
          }

          // Double-check against the current pubkey
          if (this.pubkey() !== pubkey) {
            this.logger.info(`Current profile changed during fallback contacts load. Discarding results for: ${pubkey}`);
            return;
          }

          if (contactsEvents && contactsEvents.length > 0) {
            const contactsEvent = contactsEvents[0]; // Get the most recent one
            const followingList = this.utilities.getPTagsValuesFromEvent(contactsEvent);
            console.log('Following list found via discovery search:', followingList);
            this.followingList.set(followingList);
          }
        } catch (error) {
          console.log('Fallback contacts search failed:', error);
        }
      }
    }, 2000); // Wait 2 seconds before trying fallback

    // Build the kinds array based on filter options
    const currentFilter = this.timelineFilter();
    const kindsToQuery: number[] = [];

    // Always query for articles and pictures (for media tab)
    kindsToQuery.push(kinds.LongFormArticle, 20);

    // Add notes/replies if either is enabled
    if (currentFilter.showNotes || currentFilter.showReplies) {
      kindsToQuery.push(kinds.ShortTextNote);
    }

    // Add reposts if enabled
    if (currentFilter.showReposts) {
      kindsToQuery.push(kinds.Repost, kinds.GenericRepost);
    }

    // Add audio if enabled
    if (currentFilter.showAudio) {
      kindsToQuery.push(1222, 1244);
    }

    // Add video if enabled
    if (currentFilter.showVideo) {
      kindsToQuery.push(21, 22, 34235, 34236);
    }

    // Optionally add reactions if enabled
    if (currentFilter.showReactions) {
      kindsToQuery.push(kinds.Reaction); // Kind 7
    }

    // Subscribe to content events (notes, articles, reposts, media, and optionally reactions/highlights)
    const events = await this.userRelayService.query(pubkey, {
      kinds: kindsToQuery,
      authors: [pubkey],
      limit: 50, // Increased limit for better initial load
    });

    // Critical check: verify we're still loading data for this pubkey
    if (this.currentlyLoadingPubkey() !== pubkey) {
      this.logger.info(`Profile switched during events query. Discarding ${events?.length || 0} results for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

    // Double-check against the current pubkey
    if (this.pubkey() !== pubkey) {
      this.logger.info(`Current profile changed during events query. Discarding ${events?.length || 0} results for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

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
      } else if (event.kind === 20 || event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
        // Handle media events (20 = Picture, 21 = Video, 22 = Short Video, 34235 = Addressable Video, 34236 = Addressable Short Video)
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
      } else if (event.kind === 1222 || event.kind === 1244) {
        // Handle audio events
        const record = this.utilities.toRecord(event);
        this.audio.update(audio => {
          const exists = audio.some(a => a.event.id === event.id);
          if (exists) {
            console.log('Duplicate audio event prevented:', event.id);
            return audio;
          }
          console.log('Adding new audio:', event.id);
          return [...audio, record];
        });
      } else if (event.kind === kinds.Reaction) {
        // Handle reaction events (Kind 7)
        const record = this.utilities.toRecord(event);
        this.reactions.update(reactions => {
          const exists = reactions.some(r => r.event.id === event.id);
          if (exists) {
            console.log('Duplicate reaction event prevented:', event.id);
            return reactions;
          }
          console.log('Adding new reaction:', event.id);
          return [...reactions, record];
        });
      }
    }

    // Update the oldest relay timestamp for pagination
    // This ensures we paginate from where the relay query left off, not from cached events
    if (events && events.length > 0) {
      const oldestFromRelay = Math.min(...events.map(e => e.created_at));
      const currentOldest = this.oldestRelayTimestamp();
      // Only update if this is older than what we have (or if we don't have a timestamp yet)
      if (currentOldest === null || oldestFromRelay < currentOldest) {
        this.oldestRelayTimestamp.set(oldestFromRelay);
        this.logger.debug(`Initial load oldest timestamp from relay: ${oldestFromRelay}`);
      }
    }

    // Load additional media items separately to ensure we have enough for the media tab
    // This runs in parallel with the main query to optimize loading time
    this.loadInitialMedia(pubkey);

    // Initial load complete - set loading to false
    this.isInitiallyLoading.set(false);
    this.logger.info(`Initial profile data load completed for: ${pubkey}`);

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
   * @param beforeTimestamp - Load notes before this timestamp (optional, uses tracked relay timestamp by default)
   */
  async loadMoreNotes(beforeTimestamp?: number): Promise<NostrRecord[]> {
    if (this.isLoadingMoreNotes() || !this.hasMoreNotes()) {
      return [];
    }

    this.isLoadingMoreNotes.set(true);
    const pubkey = this.pubkey();

    // Use a larger limit to fetch more events at once for better pagination
    const LOAD_LIMIT = 50;

    try {
      // Use the tracked relay timestamp for pagination, falling back to provided timestamp or current time
      // This ensures we don't skip events by using cached event timestamps
      const trackedTimestamp = this.oldestRelayTimestamp();
      const oldestTimestamp = trackedTimestamp !== null
        ? trackedTimestamp - 1
        : (beforeTimestamp || Math.floor(Date.now() / 1000));

      this.logger.debug(`Loading more notes for ${pubkey}, before timestamp: ${oldestTimestamp} (tracked: ${trackedTimestamp}), limit: ${LOAD_LIMIT}`);

      const newNotes: NostrRecord[] = [];
      const newReplies: NostrRecord[] = [];
      const newReposts: NostrRecord[] = [];
      const newReactions: NostrRecord[] = [];
      const newAudio: NostrRecord[] = [];
      const newMedia: NostrRecord[] = [];

      // Build the kinds array based on filter options
      const currentFilter = this.timelineFilter();
      const kindsToQuery: number[] = [];

      if (currentFilter.showNotes || currentFilter.showReplies) {
        kindsToQuery.push(kinds.ShortTextNote);
      }

      if (currentFilter.showReposts) {
        kindsToQuery.push(kinds.Repost, kinds.GenericRepost);
      }

      if (currentFilter.showAudio) {
        kindsToQuery.push(1222, 1244);
      }

      if (currentFilter.showVideo) {
        kindsToQuery.push(21, 22, 34235, 34236);
      }

      // Optionally add reactions if enabled
      if (currentFilter.showReactions) {
        kindsToQuery.push(kinds.Reaction);
      }

      // Query events using the async method
      const events = await this.userRelayService.query(pubkey, {
        kinds: kindsToQuery,
        authors: [pubkey],
        until: oldestTimestamp,
        limit: LOAD_LIMIT,
      });

      // Track the total number of events returned by relay
      const eventsFromRelay = events?.length || 0;
      this.logger.debug(`Received ${eventsFromRelay} events from relay (requested limit: ${LOAD_LIMIT})`);

      // Check if profile was switched during the query
      if (this.currentlyLoadingPubkey() !== pubkey) {
        this.logger.info(`Profile switched during loadMoreNotes. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Double-check against the current pubkey to ensure we're still on the same profile
      if (this.pubkey() !== pubkey) {
        this.logger.info(`Current profile changed during loadMoreNotes. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Process all returned events
      for (const event of events || []) {
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
            newReposts.push(record);
          }
        } else if (event.kind === kinds.Reaction) {
          // Handle reactions
          const record: NostrRecord = {
            event: event,
            data: event.content,
          };

          // Check if we already have this reaction to avoid duplicates
          const existingReactions = this.reactions();
          const exists = existingReactions.some(r => r.event.id === event.id);

          if (!exists) {
            newReactions.push(record);
          }
        } else if (event.kind === 1222 || event.kind === 1244) {
          // Handle audio
          const record: NostrRecord = {
            event: event,
            data: event.content,
          };

          const existingAudio = this.audio();
          const exists = existingAudio.some(a => a.event.id === event.id);

          if (!exists) {
            newAudio.push(record);
          }
        } else if (
          event.kind === 21 ||
          event.kind === 22 ||
          event.kind === 34235 ||
          event.kind === 34236
        ) {
          // Handle video (media)
          const record: NostrRecord = {
            event: event,
            data: event.content,
          };

          const existingMedia = this.media();
          const exists = existingMedia.some(m => m.event.id === event.id);

          if (!exists) {
            newMedia.push(record);
          }
        }
      }

      this.logger.debug(
        `Loaded ${newNotes.length} more notes, ${newReplies.length} more replies, ${newReposts.length} more reposts, ${newReactions.length} more reactions, ${newAudio.length} more audio, ${newMedia.length} more video`
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

      // Add new reposts to the existing ones with final deduplication check
      if (newReposts.length > 0) {
        this.reposts.update(existing => {
          const filtered = newReposts.filter(
            newRepost =>
              !existing.some(existingRepost => existingRepost.event.id === newRepost.event.id)
          );
          console.log(
            `Adding ${filtered.length} new reposts (${newReposts.length - filtered.length} duplicates filtered)`
          );

          if (filtered.length > 0) {
            addedAnyContent = true;
          }

          return [...existing, ...filtered];
        });
      }

      // Add new reactions to the existing ones with final deduplication check
      if (newReactions.length > 0) {
        this.reactions.update(existing => {
          const filtered = newReactions.filter(
            newReaction =>
              !existing.some(existingReaction => existingReaction.event.id === newReaction.event.id)
          );
          console.log(
            `Adding ${filtered.length} new reactions (${newReactions.length - filtered.length} duplicates filtered)`
          );

          if (filtered.length > 0) {
            addedAnyContent = true;
          }

          return [...existing, ...filtered];
        });
      }

      // Add new audio to the existing ones with final deduplication check
      if (newAudio.length > 0) {
        this.audio.update(existing => {
          const filtered = newAudio.filter(
            newItem => !existing.some(existingItem => existingItem.event.id === newItem.event.id)
          );
          console.log(
            `Adding ${filtered.length} new audio (${newAudio.length - filtered.length} duplicates filtered)`
          );

          if (filtered.length > 0) {
            addedAnyContent = true;
          }

          return [...existing, ...filtered];
        });
      }

      // Add new media (video) to the existing ones with final deduplication check
      if (newMedia.length > 0) {
        this.media.update(existing => {
          const filtered = newMedia.filter(
            newItem => !existing.some(existingItem => existingItem.event.id === newItem.event.id)
          );
          console.log(
            `Adding ${filtered.length} new media (${newMedia.length - filtered.length} duplicates filtered)`
          );

          if (filtered.length > 0) {
            addedAnyContent = true;
          }

          return [...existing, ...filtered];
        });
      }

      // Update the oldest relay timestamp for the next pagination
      // Only update if the new oldest is actually older than what we have
      // This prevents the timestamp from moving forward when loading gap-filling events
      if (events && events.length > 0) {
        const oldestFromBatch = Math.min(...events.map(e => e.created_at));
        const currentOldest = this.oldestRelayTimestamp();
        if (currentOldest === null || oldestFromBatch < currentOldest) {
          this.oldestRelayTimestamp.set(oldestFromBatch);
          this.logger.debug(`Updated oldest relay timestamp to: ${oldestFromBatch}`);
        } else {
          this.logger.debug(`Batch oldest ${oldestFromBatch} is not older than current ${currentOldest}, keeping current`);
        }
      }

      // Determine if there are more notes to load
      // - If relay returned fewer events than we requested, we've reached the end
      // - If relay returned 0 events, we've reached the end  
      // - Otherwise, there might be more events to load
      const reachedEnd = eventsFromRelay === 0 || eventsFromRelay < LOAD_LIMIT;

      if (reachedEnd) {
        this.logger.info(`Reached end of notes for ${pubkey}: received ${eventsFromRelay} events (limit was ${LOAD_LIMIT})`);
        this.hasMoreNotes.set(false);
      } else {
        // Relay returned a full page, there might be more events
        this.hasMoreNotes.set(true);
      }

      this.isLoadingMoreNotes.set(false);
      return [
        ...newNotes,
        ...newReplies,
        ...newReposts,
        ...newReactions,
        ...newAudio,
        ...newMedia,
      ];
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
    if (this.isLoadingMoreArticles() || !this.hasMoreArticles()) {
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

      const newArticles: NostrRecord[] = [];

      // Query events using the async method
      const events = await this.userRelayService.query(pubkey, {
        kinds: [kinds.LongFormArticle],
        authors: [pubkey],
        until: oldestTimestamp,
        limit: 10, // Load 10 more articles at a time
      });

      // Check if profile was switched during the query
      if (this.currentlyLoadingPubkey() !== pubkey) {
        this.logger.info(`Profile switched during loadMoreArticles. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Double-check against the current pubkey to ensure we're still on the same profile
      if (this.pubkey() !== pubkey) {
        this.logger.info(`Current profile changed during loadMoreArticles. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Process all returned events
      for (const event of events || []) {
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
      }

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
      return newArticles;
    } catch (error) {
      this.logger.error('Failed to load more articles:', error);
      this.isLoadingMoreArticles.set(false);
      return [];
    }
  }

  /**
   * Load initial media events separately to ensure sufficient content for media tab
   * @param pubkey The user's public key
   */
  private async loadInitialMedia(pubkey: string): Promise<void> {
    try {
      this.logger.debug(`Loading initial media for ${pubkey}`);

      // Query media events with a higher limit
      const mediaEvents = await this.userRelayService.query(pubkey, {
        kinds: [20, 21, 22, 34235, 34236], // Picture (20), Video (21), Short Video (22), Addressable Video (34235), Addressable Short Video (34236)
        authors: [pubkey],
        limit: 30, // Load 30 media items initially
      });

      // Check if profile was switched during the query
      if (this.currentlyLoadingPubkey() !== pubkey || this.pubkey() !== pubkey) {
        this.logger.info(`Profile switched during loadInitialMedia. Discarding ${mediaEvents?.length || 0} results for: ${pubkey}`);
        return;
      }

      // Process all returned events
      for (const event of mediaEvents || []) {
        if (event.kind === 20 || event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
          const record: NostrRecord = {
            event: event,
            data: event.content,
          };

          // Add to media with duplicate check
          this.media.update(existing => {
            const exists = existing.some(m => m.event.id === event.id);
            if (!exists) {
              return [...existing, record];
            }
            return existing;
          });
        }
      }

      this.logger.debug(`Loaded ${mediaEvents?.length || 0} initial media items`);
    } catch (error) {
      this.logger.error('Failed to load initial media:', error);
    }
  }

  /**
   * Load more media events (kinds 20, 21, 22, 34235, 34236) for the profile
   * @param beforeTimestamp Optional timestamp to load events before. If not provided, uses the oldest media event timestamp
   * @returns Array of newly loaded media records
   */
  async loadMoreMedia(beforeTimestamp?: number): Promise<NostrRecord[]> {
    if (this.isLoadingMoreMedia() || !this.hasMoreMedia()) {
      return [];
    }

    this.isLoadingMoreMedia.set(true);
    const pubkey = this.pubkey();

    try {
      const currentMedia = this.media();
      const oldestTimestamp =
        beforeTimestamp ||
        (currentMedia.length > 0
          ? Math.min(...currentMedia.map(m => m.event.created_at)) - 1
          : Math.floor(Date.now() / 1000));

      this.logger.debug(
        `Loading more media for ${pubkey}, before timestamp: ${oldestTimestamp}`
      );

      const newMedia: NostrRecord[] = [];

      // Query events using the async method
      const events = await this.userRelayService.query(pubkey, {
        kinds: [20, 21, 22, 34235, 34236], // Picture (20), Video (21), Short Video (22), Addressable Video (34235), Addressable Short Video (34236)
        authors: [pubkey],
        until: oldestTimestamp,
        limit: 30, // Load 30 more media items at a time for smoother scrolling
      });

      // Check if profile was switched during the query
      if (this.currentlyLoadingPubkey() !== pubkey) {
        this.logger.info(`Profile switched during loadMoreMedia. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Double-check against the current pubkey to ensure we're still on the same profile
      if (this.pubkey() !== pubkey) {
        this.logger.info(`Current profile changed during loadMoreMedia. Discarding ${events?.length || 0} results for: ${pubkey}`);
        return [];
      }

      // Process all returned events
      for (const event of events || []) {
        if (event.kind === 20 || event.kind === 21 || event.kind === 22 || event.kind === 34235 || event.kind === 34236) {
          // Create a NostrRecord
          const record: NostrRecord = {
            event: event,
            data: event.content,
          };

          // Check if we already have this media item to avoid duplicates
          const existingMedia = this.media();
          const exists = existingMedia.some(m => m.event.id === event.id);

          if (!exists) {
            newMedia.push(record);
          }
        }
      }

      this.logger.debug(`Loaded ${newMedia.length} more media items`);

      // Track if we added any new content
      let addedAnyContent = false;

      // Add new media to the existing ones with final deduplication check
      if (newMedia.length > 0) {
        this.media.update(existing => {
          const filtered = newMedia.filter(
            newMediaItem =>
              !existing.some(
                existingMediaItem => existingMediaItem.event.id === newMediaItem.event.id
              )
          );
          console.log(
            `Adding ${filtered.length} new media items (${newMedia.length - filtered.length} duplicates filtered)`
          );

          if (filtered.length > 0) {
            addedAnyContent = true;
          }

          return [...existing, ...filtered];
        });
      }

      // Only keep hasMoreMedia true if we actually added new content
      if (!addedAnyContent) {
        this.hasMoreMedia.set(false);
      } else {
        this.hasMoreMedia.set(true);
      }

      this.isLoadingMoreMedia.set(false);
      return newMedia;
    } catch (error) {
      this.logger.error('Failed to load more media:', error);
      this.isLoadingMoreMedia.set(false);
      return [];
    }
  }
}
