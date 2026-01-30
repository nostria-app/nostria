import { signal, computed, effect, untracked, Injector, runInInjectionContext } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { UserRelayService } from './relays/user-relay';
import { kinds, Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';
import { TimelineFilterOptions, DEFAULT_TIMELINE_FILTER } from '../interfaces/timeline-filter';

/**
 * ProfileState holds all state for a single profile view.
 * Unlike the legacy singleton service, this class is instantiated per-profile,
 * ensuring data isolation when multiple profiles are open in different panes.
 */
export class ProfileState {
  private readonly logger: LoggerService;
  private readonly userRelayService: UserRelayService;
  private readonly utilities: UtilitiesService;
  private readonly database: DatabaseService;

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);
  // Track the timestamp of the contacts event to prevent older data from overwriting newer
  private followingListTimestamp = signal<number>(0);

  // Signal to store the current profile's relay list (kind 10002)
  relayList = signal<string[]>([]);
  // Track the timestamp of the relay list event
  private relayListTimestamp = signal<number>(0);

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

  // Signal to indicate when cached events have been loaded from database
  // This allows UI components to wait for cached data before loading from relays
  cachedEventsLoaded = signal<boolean>(false);

  // Track the oldest timestamp from relay-loaded events for pagination
  // This is separate from cached events to ensure proper infinite scroll
  private oldestRelayTimestamp = signal<number | null>(null);

  // Track consecutive empty/small batches to determine when we've truly reached the end
  // This prevents false "reached end" when relay returns partial results
  private consecutiveSmallBatches = signal<number>(0);
  private readonly MAX_CONSECUTIVE_SMALL_BATCHES = 3;

  // Loading states for articles
  isLoadingMoreArticles = signal<boolean>(false);
  hasMoreArticles = signal<boolean>(true);

  // Loading states for media
  isLoadingMoreMedia = signal<boolean>(false);
  hasMoreMedia = signal<boolean>(true);

  // Display limit for media - only render this many items initially
  private readonly INITIAL_MEDIA_DISPLAY_LIMIT = 12;
  private readonly MEDIA_DISPLAY_INCREMENT = 12;
  mediaDisplayLimit = signal<number>(this.INITIAL_MEDIA_DISPLAY_LIMIT);

  // Timeline filter options
  timelineFilter = signal<TimelineFilterOptions>({ ...DEFAULT_TIMELINE_FILTER });

  // Display limit for virtualized rendering - only render this many items initially
  // This prevents browser sluggishness when many events are loaded
  private readonly INITIAL_DISPLAY_LIMIT = 10;
  private readonly DISPLAY_INCREMENT = 10;
  displayLimit = signal<number>(this.INITIAL_DISPLAY_LIMIT);

  // Effect cleanup function
  private effectCleanup?: () => void;

  constructor(
    private readonly injector: Injector,
    logger: LoggerService,
    userRelayService: UserRelayService,
    utilities: UtilitiesService,
    database: DatabaseService
  ) {
    this.logger = logger;
    this.userRelayService = userRelayService;
    this.utilities = utilities;
    this.database = database;

    // Create effect in injection context
    runInInjectionContext(this.injector, () => {
      const effectRef = effect(async () => {
        const pubkey = this.pubkey();

        // Include reloadTrigger to ensure effect runs when we force reload
        this.reloadTrigger();

        if (pubkey) {
          untracked(async () => {
            // Set loading pubkey immediately to track this request
            this.currentlyLoadingPubkey.set(pubkey);
            this.isInitiallyLoading.set(true);
            this.cachedEventsLoaded.set(false);

            // FIRST: Load cached events from database for INSTANT display
            // This is done before ensureRelaysForPubkey to give immediate UI feedback
            await this.loadCachedEvents(pubkey);

            // Mark cached events as loaded so UI components can proceed
            // Even if cache was empty, we've checked and the UI can now show content or loading state
            if (this.currentlyLoadingPubkey() === pubkey) {
              this.cachedEventsLoaded.set(true);
              this.logger.debug(`Cached events loaded for ${pubkey}, UI can now display content`);
            }

            // THEN: Ensure relays are available for this user
            await this.ensureRelaysForPubkey(pubkey);

            // FINALLY: Load fresh data from relays (will update only if newer)
            await this.loadUserData(pubkey);
          });
        }
      });

      // Store cleanup function
      this.effectCleanup = () => effectRef.destroy();
    });
  }

  /**
   * Destroy the ProfileState instance and clean up resources
   */
  destroy(): void {
    if (this.effectCleanup) {
      this.effectCleanup();
    }
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
      console.log('ProfileState: Reloading current profile data for', currentPubkey);
      this.forceReloadProfileData(currentPubkey);
    }
  }

  reset() {
    // Reset the loading tracker first to immediately invalidate any in-flight requests
    this.currentlyLoadingPubkey.set('');
    this.isInitiallyLoading.set(false);
    this.cachedEventsLoaded.set(false);
    this.followingList.set([]);
    this.followingListTimestamp.set(0);
    this.relayList.set([]);
    this.relayListTimestamp.set(0);
    this.notes.set([]);
    this.reposts.set([]);
    this.replies.set([]);
    this.articles.set([]);
    this.oldestRelayTimestamp.set(null);
    this.consecutiveSmallBatches.set(0);
    this.media.set([]);
    this.audio.set([]);
    this.reactions.set([]);
    this.hasMoreNotes.set(true);
    this.hasMoreArticles.set(true);
    this.hasMoreMedia.set(true);
    // Reset display limits to initial values for new profile
    this.displayLimit.set(this.INITIAL_DISPLAY_LIMIT);
    this.mediaDisplayLimit.set(this.INITIAL_MEDIA_DISPLAY_LIMIT);
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

  // Displayed media - only shows items up to mediaDisplayLimit for performance
  displayedMedia = computed(() => {
    const sorted = this.sortedMedia();
    const limit = this.mediaDisplayLimit();
    return sorted.slice(0, limit);
  });

  // Check if there are more media items to display (beyond current mediaDisplayLimit)
  hasMoreMediaToDisplay = computed(() => {
    return this.sortedMedia().length > this.mediaDisplayLimit();
  });

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
   * Increase the media display limit to show more items in the media grid.
   * Call this when user scrolls near the bottom of the visible content.
   * Returns true if limit was increased, false if already at max.
   */
  increaseMediaDisplayLimit(): boolean {
    const currentLimit = this.mediaDisplayLimit();
    const totalItems = this.sortedMedia().length;

    // If we're already showing all items, no need to increase
    if (currentLimit >= totalItems) {
      return false;
    }

    // Increase the limit
    this.mediaDisplayLimit.update(limit => limit + this.MEDIA_DISPLAY_INCREMENT);
    this.logger.debug(`Increased media display limit to ${this.mediaDisplayLimit()}, total items: ${totalItems}`);
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
          // Only set if this is newer than what we already have (based on event timestamp)
          const currentTimestamp = this.followingListTimestamp();
          if (event.created_at > currentTimestamp) {
            const followingList = this.utilities.getPTagsValuesFromEvent(event);
            if (followingList.length > 0) {
              this.followingList.set(followingList);
              this.followingListTimestamp.set(event.created_at);
              this.logger.debug(`Loaded cached following list with ${followingList.length} entries (timestamp: ${event.created_at})`);
            }
          }
        } else if (event.kind === kinds.RelayList) {
          // Load cached relay list (kind 10002) for initial display
          // Only set if this is newer than what we already have
          const currentTimestamp = this.relayListTimestamp();
          if (event.created_at > currentTimestamp) {
            const relayUrls = this.utilities.getRelayUrls(event);
            if (relayUrls.length > 0) {
              this.relayList.set(relayUrls);
              this.relayListTimestamp.set(event.created_at);
              this.logger.debug(`Loaded cached relay list with ${relayUrls.length} relays (timestamp: ${event.created_at})`);
            }
          }
        }
      }

      this.logger.info(`Loaded cached events: notes=${this.notes().length}, replies=${this.replies().length}, reposts=${this.reposts().length}, articles=${this.articles().length}, media=${this.media().length}`);
      
      // Log the computed timeline to verify filtering is working
      const currentTimeline = this.sortedTimeline();
      this.logger.debug(`[loadCachedEvents] After loading cache: sortedTimeline=${currentTimeline.length}, filter=${JSON.stringify(this.timelineFilter())}`);
    } catch (error) {
      this.logger.error(`Error loading cached events for ${pubkey}:`, error);
      // Don't throw - continue with relay loading even if cache fails
    }
  }

  /**
   * Cache events to database for future quick loading.
   * This runs in the background and doesn't block the UI.
   * 
   * @param events - Array of events to cache
   */
  private async cacheEventsToDatabase(events: Event[]): Promise<void> {
    if (!events || events.length === 0) {
      return;
    }

    try {
      // Save all events in a batch operation
      await this.database.saveEvents(events);
      this.logger.debug(`Cached ${events.length} events to database`);
    } catch (error) {
      this.logger.error('Error caching events to database:', error);
      // Don't throw - caching failure shouldn't affect the user experience
    }
  }

  async loadUserData(pubkey: string) {
    // Note: currentlyLoadingPubkey, isInitiallyLoading, and loadCachedEvents 
    // are now handled in the constructor effect for faster initial display
    this.logger.info(`Loading fresh profile data from relays for: ${pubkey}`);
    this.logger.debug(`[loadUserData] Current state before loading: notes=${this.notes().length}, replies=${this.replies().length}, displayedTimeline=${this.sortedTimeline().length}`);

    // Check if profile was switched before we start
    if (this.currentlyLoadingPubkey() !== pubkey) {
      this.logger.info(`Profile switched before loadUserData. Stopping for: ${pubkey}`);
      this.isInitiallyLoading.set(false);
      return;
    }

    // PRIORITY 1: Load timeline events FIRST - this is what users want to see immediately
    // Build the kinds array based on filter options
    const currentFilter = this.timelineFilter();
    const kindsToQuery: number[] = [];

    // Always include notes for timeline
    kindsToQuery.push(kinds.ShortTextNote);

    // Add reposts if enabled
    if (currentFilter.showReposts) {
      kindsToQuery.push(kinds.Repost, kinds.GenericRepost);
    }

    // Add audio if enabled
    if (currentFilter.showAudio) {
      kindsToQuery.push(1222, 1244);
    }

    // Optionally add reactions if enabled
    if (currentFilter.showReactions) {
      kindsToQuery.push(kinds.Reaction); // Kind 7
    }

    this.logger.debug(`PRIORITY 1: Loading timeline events for ${pubkey}`);

    // Subscribe to content events (notes, reposts, and optionally reactions)
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
      if (event.kind === kinds.ShortTextNote) {
        const record = this.utilities.toRecord(event);
        if (this.utilities.isRootPost(event)) {
          // Check for duplicates before adding to notes
          this.notes.update(existingNotes => {
            const exists = existingNotes.some(n => n.event.id === event.id);
            if (!exists) {
              return [...existingNotes, record];
            }
            return existingNotes;
          });
        } else {
          // Check for duplicates before adding to replies
          this.replies.update(existingReplies => {
            const exists = existingReplies.some(r => r.event.id === event.id);
            if (!exists) {
              return [...existingReplies, record];
            }
            return existingReplies;
          });
        }
      } else if (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) {
        const record = this.utilities.toRecord(event);
        // Check for duplicates before adding to reposts
        this.reposts.update(reposts => {
          const exists = reposts.some(r => r.event.id === event.id);
          if (!exists) {
            return [...reposts, record];
          }
          return reposts;
        });
      } else if (event.kind === 1222 || event.kind === 1244) {
        // Handle audio events
        const record = this.utilities.toRecord(event);
        this.audio.update(audio => {
          const exists = audio.some(a => a.event.id === event.id);
          if (!exists) {
            return [...audio, record];
          }
          return audio;
        });
      } else if (event.kind === kinds.Reaction) {
        // Handle reaction events (Kind 7)
        const record = this.utilities.toRecord(event);
        this.reactions.update(reactions => {
          const exists = reactions.some(r => r.event.id === event.id);
          if (!exists) {
            return [...reactions, record];
          }
          return reactions;
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

      // Save events to database for future caching (do this in background)
      this.cacheEventsToDatabase(events).catch(err => {
        this.logger.error('Failed to cache timeline events:', err);
      });
    }

    // Timeline loaded - mark initial loading complete so UI can render
    this.isInitiallyLoading.set(false);
    this.logger.info(`PRIORITY 1 complete: Timeline loaded for ${pubkey}`);
    this.logger.debug(`[loadUserData] After timeline load: notes=${this.notes().length}, replies=${this.replies().length}, reposts=${this.reposts().length}, displayedTimeline=${this.sortedTimeline().length}, filter=${JSON.stringify(this.timelineFilter())}`);

    // PRIORITY 2: Load secondary data in background (non-blocking)
    // These are loaded after timeline so user sees content immediately
    this.loadSecondaryData(pubkey);
  }

  /**
   * Load secondary profile data (contacts, relay list, articles, media) in the background.
   * This is called after the timeline is loaded to avoid blocking the initial render.
   * Data is loaded sequentially to avoid overwhelming relays with too many subscriptions.
   */
  private async loadSecondaryData(pubkey: string): Promise<void> {
    // Check if we're still on the same profile
    if (this.currentlyLoadingPubkey() !== pubkey) {
      this.logger.debug(`Profile switched, skipping secondary data load for: ${pubkey}`);
      return;
    }

    this.logger.debug(`PRIORITY 2: Loading secondary data for ${pubkey}`);

    // 2a. Load contacts (following list) - important for profile header
    try {
      const contactsEvent = await this.userRelayService.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      
      if (this.currentlyLoadingPubkey() !== pubkey) return;

      if (contactsEvent && contactsEvent.kind === kinds.Contacts) {
        const currentTimestamp = this.followingListTimestamp();
        if (contactsEvent.created_at > currentTimestamp) {
          const followingList = this.utilities.getPTagsValuesFromEvent(contactsEvent);
          this.followingList.set(followingList);
          this.followingListTimestamp.set(contactsEvent.created_at);
          this.logger.debug(`Updated following list with ${followingList.length} entries`);
          this.database.saveReplaceableEvent(contactsEvent).catch(err => {
            this.logger.error('Failed to cache contacts event:', err);
          });
        }
      }
    } catch (err) {
      this.logger.error('Error loading contacts:', err);
    }

    // Small delay between queries to avoid relay rate limiting
    await this.delay(100);

    // 2b. Load relay list - needed for profile relays tab
    if (this.currentlyLoadingPubkey() !== pubkey) return;

    try {
      const relayListEvent = await this.userRelayService.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
      
      if (this.currentlyLoadingPubkey() !== pubkey) return;

      if (relayListEvent && relayListEvent.kind === kinds.RelayList) {
        const currentTimestamp = this.relayListTimestamp();
        if (relayListEvent.created_at > currentTimestamp) {
          const relayUrls = this.utilities.getRelayUrls(relayListEvent);
          this.relayList.set(relayUrls);
          this.relayListTimestamp.set(relayListEvent.created_at);
          this.logger.debug(`Updated relay list with ${relayUrls.length} relays`);
          this.database.saveReplaceableEvent(relayListEvent).catch(err => {
            this.logger.error('Failed to cache relay list event:', err);
          });
        }
      }
    } catch (err) {
      this.logger.error('Error loading relay list:', err);
    }

    // Small delay between queries
    await this.delay(100);

    // 2c. Load articles - for reads tab
    if (this.currentlyLoadingPubkey() !== pubkey) return;

    try {
      const articleEvents = await this.userRelayService.query(pubkey, {
        kinds: [kinds.LongFormArticle],
        authors: [pubkey],
        limit: 20,
      });

      if (this.currentlyLoadingPubkey() !== pubkey) return;

      for (const event of articleEvents || []) {
        if (event.kind === kinds.LongFormArticle) {
          const record = this.utilities.toRecord(event);
          this.articles.update(articles => {
            const exists = articles.some(a => a.event.id === event.id);
            if (!exists) {
              return [...articles, record];
            }
            return articles;
          });
        }
      }
      this.logger.debug(`Loaded ${articleEvents?.length || 0} articles`);
    } catch (err) {
      this.logger.error('Error loading articles:', err);
    }

    // Small delay between queries
    await this.delay(100);

    // 2d. Load media - for media tab
    if (this.currentlyLoadingPubkey() !== pubkey) return;
    
    this.loadInitialMedia(pubkey);

    // 2e. Fallback contacts search (deferred) - only if we don't have contacts yet
    if (this.followingList().length === 0) {
      this.logger.debug(`No contacts found, scheduling fallback search for ${pubkey}`);
      setTimeout(() => this.loadFallbackContacts(pubkey), 1500);
    }

    this.logger.info(`PRIORITY 2 complete: Secondary data loaded for ${pubkey}`);
  }

  /**
   * Try to load contacts from discovery relays as a fallback.
   * This is used when contacts aren't found on the user's preferred relays.
   */
  private async loadFallbackContacts(pubkey: string): Promise<void> {
    if (this.currentlyLoadingPubkey() !== pubkey) return;
    if (this.followingList().length > 0) return; // Already have contacts

    this.logger.debug(`Trying fallback contacts search for ${pubkey}`);

    try {
      const contactsEvents = await this.userRelayService.getEventsByPubkeyAndKind(pubkey, kinds.Contacts);

      if (this.currentlyLoadingPubkey() !== pubkey) return;

      if (contactsEvents && contactsEvents.length > 0) {
        const newestContactsEvent = contactsEvents.reduce((newest, current) =>
          current.created_at > newest.created_at ? current : newest
        );
        const currentTimestamp = this.followingListTimestamp();
        if (newestContactsEvent.created_at > currentTimestamp) {
          const followingList = this.utilities.getPTagsValuesFromEvent(newestContactsEvent);
          this.followingList.set(followingList);
          this.followingListTimestamp.set(newestContactsEvent.created_at);
          this.logger.debug(`Fallback: Found ${followingList.length} contacts`);
          this.database.saveReplaceableEvent(newestContactsEvent).catch(err => {
            this.logger.error('Failed to cache fallback contacts event:', err);
          });
        }
      }
    } catch (error) {
      this.logger.debug('Fallback contacts search failed:', error);
    }
  }

  /**
   * Helper to add a delay between operations to avoid overwhelming relays.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    // CRITICAL: Capture the current timeline state BEFORE loading new events
    // This allows us to preserve the user's scroll position by adjusting displayLimit
    const timelineCountBefore = this.sortedTimeline().length;
    const displayLimitBefore = this.displayLimit();

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

        // Cache new events to database for future quick loading (in background)
        this.cacheEventsToDatabase(events).catch(err => {
          this.logger.error('Failed to cache loadMoreNotes events:', err);
        });
      }

      // CRITICAL FIX: Adjust displayLimit to preserve the user's scroll position
      // When new events are loaded and inserted into sortedTimeline (which is sorted by created_at desc),
      // events that were previously visible might get pushed beyond the displayLimit.
      // We need to increase the displayLimit by the number of new items that were inserted
      // BEFORE the user's current viewing position to keep the same events visible.
      if (addedAnyContent) {
        const timelineCountAfter = this.sortedTimeline().length;
        const newItemsCount = timelineCountAfter - timelineCountBefore;

        // If the user had scrolled past the initial limit and we added new items,
        // increase the limit to compensate for any items inserted before the current view
        if (newItemsCount > 0 && displayLimitBefore > this.INITIAL_DISPLAY_LIMIT) {
          // Increase displayLimit by the number of new items to maintain scroll position
          const newLimit = displayLimitBefore + newItemsCount;
          this.displayLimit.set(newLimit);
          this.logger.debug(`Adjusted displayLimit from ${displayLimitBefore} to ${newLimit} (added ${newItemsCount} items)`);
        }
      }

      // Determine if there are more notes to load using multiple criteria:
      // 1. If relay returned 0 events, we've reached the end
      // 2. If we added any new unique content, there might be more
      // 3. If we got a full batch but all were duplicates, keep trying (up to a limit)
      // 4. If relay returned fewer than limit multiple times in a row, we've reached the end

      if (eventsFromRelay === 0) {
        // Relay returned nothing - definitely at the end
        this.logger.info(`Reached end of notes for ${pubkey}: relay returned 0 events`);
        this.hasMoreNotes.set(false);
        this.consecutiveSmallBatches.set(0);
      } else if (addedAnyContent) {
        // We got new content - there might be more
        this.hasMoreNotes.set(true);
        this.consecutiveSmallBatches.set(0);
      } else if (eventsFromRelay < LOAD_LIMIT) {
        // Small batch with no new content - increment counter
        const newCount = this.consecutiveSmallBatches() + 1;
        this.consecutiveSmallBatches.set(newCount);
        
        if (newCount >= this.MAX_CONSECUTIVE_SMALL_BATCHES) {
          this.logger.info(`Reached end of notes for ${pubkey}: ${newCount} consecutive small batches with no new content`);
          this.hasMoreNotes.set(false);
        } else {
          // Keep trying - might be temporary relay issue or duplicates
          this.logger.debug(`Small batch ${newCount}/${this.MAX_CONSECUTIVE_SMALL_BATCHES} with no new content, continuing`);
          this.hasMoreNotes.set(true);
        }
      } else {
        // Full batch but all duplicates - might have more unique content further back
        // Increment counter since we're not making progress
        const newCount = this.consecutiveSmallBatches() + 1;
        this.consecutiveSmallBatches.set(newCount);
        
        if (newCount >= this.MAX_CONSECUTIVE_SMALL_BATCHES) {
          this.logger.info(`Reached end of notes for ${pubkey}: ${newCount} consecutive batches with no new content`);
          this.hasMoreNotes.set(false);
        } else {
          this.logger.debug(`Full batch ${newCount}/${this.MAX_CONSECUTIVE_SMALL_BATCHES} but all duplicates, continuing`);
          this.hasMoreNotes.set(true);
        }
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
