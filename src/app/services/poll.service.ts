import { Injectable, inject, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { LocalStorageService } from './local-storage.service';
import { ApplicationService } from './application.service';
import { NostrService } from './nostr.service';
import { PublishService } from './publish.service';
import { RelayPoolService } from './relays/relay-pool';
import { AccountRelayService } from './relays/account-relay';
import { SharedRelayService } from './relays/shared-relay';
import { OnInitialized, Poll, PollDraft, PollOption, PollResponse, PollResults } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class PollService implements OnInitialized {
  private localStorage = inject(LocalStorageService);
  private app = inject(ApplicationService);
  private nostrService = inject(NostrService);
  private publishService = inject(PublishService);
  private pool = inject(RelayPoolService);
  private accountRelay = inject(AccountRelayService);
  private sharedRelayEx = inject(SharedRelayService);

  // Storage keys
  private readonly POLLS_STORAGE_KEY = 'nostria-polls';
  private readonly DRAFTS_STORAGE_KEY = 'nostria-poll-drafts';

  // Signals for reactive state management
  private _polls = signal<Poll[]>([]);
  private _drafts = signal<PollDraft[]>([]);
  private _currentEditingPoll = signal<PollDraft | null>(null);

  // Response cache for performance
  private _responsesCache = new Map<string, { responses: PollResponse[], timestamp: number }>();
  private readonly CACHE_DURATION = 30000; // 30 seconds

  // Public readonly signals
  polls = this._polls.asReadonly();
  drafts = this._drafts.asReadonly();
  currentEditingPoll = this._currentEditingPoll.asReadonly();

  // Computed signals
  userPolls = computed(() => {
    const currentPubkey = this.getCurrentUserPubkey();
    return this._polls().filter(poll => poll.isLocal || poll.pubkey === currentPubkey);
  });

  hasUnsavedChanges = computed(() => {
    const currentDraft = this._currentEditingPoll();
    return currentDraft !== null;
  });

  constructor() {
    this.loadPollsFromStorage();
    this.loadDraftsFromStorage();
  }

  initialize(): void {
    this.loadPollsFromStorage();
    this.loadDraftsFromStorage();
  }

  /**
   * Fetch all polls from Nostr network for the current user
   * Uses RelayPoolService for efficient querying across relays
   */
  async fetchPollsFromNostr(pubkey: string): Promise<void> {
    try {
      const relayUrls = this.accountRelay.getRelayUrls();

      if (relayUrls.length === 0) {
        console.warn('No relay URLs available for fetching polls');
        return;
      }

      const filter = {
        kinds: [1068],
        authors: [pubkey],
      };

      const events = await this.pool.query(relayUrls, filter, 5000);

      const polls: Poll[] = events.map((event: Event) => this.parseNostrPollEvent(event));

      // Merge with existing local polls
      const existingPolls = this._polls();
      const mergedPolls = [...polls];

      existingPolls.forEach(existing => {
        if (existing.isLocal && !polls.find(p => p.id === existing.id)) {
          mergedPolls.push(existing);
        }
      });

      this._polls.set(mergedPolls);
      this.savePollsToStorage();
    } catch (error) {
      console.error('Failed to fetch polls from Nostr:', error);
      throw error;
    }
  }

  /**
   * Fetch polls for a specific pubkey (for feed)
   */
  async fetchPollsForPubkey(pubkey: string, relayUrls: string[]): Promise<Poll[]> {
    console.log(`[PollService] Fetching polls for ${pubkey.substring(0, 8)}... from ${relayUrls.length} relays`);
    console.log('[PollService] Relay URLs:', relayUrls);

    if (relayUrls.length === 0) {
      console.warn('[PollService] No relay URLs provided');
      return [];
    }

    const filter = {
      kinds: [1068],
      authors: [pubkey],
    };

    console.log('[PollService] Query filter:', filter);

    const events = await this.pool.query(relayUrls, filter, 5000);

    console.log(`[PollService] Received ${events.length} events from relays`);

    return events.map((event: Event) => this.parseNostrPollEvent(event));
  }

  /**
   * Fetch polls for multiple pubkeys using SharedRelayService (OPTIMIZED like FeedService!)
   * Uses outbox model with per-user relay discovery for maximum speed
   * This is the recommended method for loading feed polls
   */
  async fetchPollsForMultiplePubkeysOptimized(pubkeys: string[]): Promise<Poll[]> {
    if (pubkeys.length === 0) {
      return [];
    }

    const pollsPerUser = 10; // Similar to articles in feed (10 per user)
    const now = Math.floor(Date.now() / 1000);
    const daysBack = 90; // Look back 90 days for polls (like articles in feed)
    const timeCutoff = now - daysBack * 24 * 60 * 60;

    const allPolls: Poll[] = [];

    // Process users in parallel (exactly like FeedService does)
    const fetchPromises = pubkeys.map(async pubkey => {
      try {
        const events = await this.sharedRelayEx.getMany(
          pubkey,
          {
            authors: [pubkey],
            kinds: [1068], // Poll events
            limit: pollsPerUser,
            since: timeCutoff,
          },
          { timeout: 2500 } // Same timeout as FeedService
        );

        if (events.length > 0) {
          return events.map((event: Event) => this.parseNostrPollEvent(event));
        }
        return [];
      } catch {
        // Reduced logging to prevent console spam (like FeedService)
        return [];
      }
    });

    // Execute all fetches in parallel (like FeedService does)
    const results = await Promise.all(fetchPromises);

    // Flatten results
    results.forEach((polls: Poll[]) => {
      allPolls.push(...polls);
    });

    console.log(`[PollService] Loaded ${allPolls.length} polls from ${pubkeys.length} users`);

    return allPolls;
  }

  /**
   * Fetch polls for multiple pubkeys in a single query (LEGACY - slower than optimized method)
   * Used for feed loading
   * @deprecated Use fetchPollsForMultiplePubkeysOptimized instead for better performance
   */
  async fetchPollsForMultiplePubkeys(pubkeys: string[]): Promise<Poll[]> {
    const relayUrls = this.accountRelay.getRelayUrls();

    if (relayUrls.length === 0 || pubkeys.length === 0) {
      return [];
    }

    console.log(`[PollService] Fetching polls for ${pubkeys.length} users in one query from ${relayUrls.length} relays`);

    const filter = {
      kinds: [1068],
      authors: pubkeys, // Query all authors at once!
      limit: 50, // Limit to recent polls
    };

    const events = await this.pool.query(relayUrls, filter, 10000);

    console.log(`[PollService] Received ${events.length} poll events from relays`);

    return events.map((event: Event) => this.parseNostrPollEvent(event));
  }

  /**
   * Fetch responses for multiple polls in parallel (OPTIMIZED)
   * Much faster than fetching one by one
   */
  async fetchPollResponsesBatch(polls: Poll[]): Promise<Map<string, PollResponse[]>> {
    const responsesMap = new Map<string, PollResponse[]>();

    if (polls.length === 0) {
      return responsesMap;
    }

    // Fetch responses for all polls in parallel (no logging to reduce spam)
    const fetchPromises = polls.map(async poll => {
      try {
        const responses = await this.fetchPollResponses(poll.eventId || poll.id, poll.endsAt, false, poll.relays);
        return { pollId: poll.id, responses };
      } catch {
        return { pollId: poll.id, responses: [] };
      }
    });

    const results = await Promise.all(fetchPromises);

    // Build map
    results.forEach(({ pollId, responses }) => {
      responsesMap.set(pollId, responses);
    });

    console.log(`[PollService] Loaded responses for ${responsesMap.size} polls`);

    return responsesMap;
  }

  /**
   * Fetch responses for a specific poll from Nostr network
   * Uses RelayPoolService for efficient querying
   * Cached for performance
   */
  async fetchPollResponses(pollId: string, endsAt?: number, forceRefresh = false, relayUrls?: string[]): Promise<PollResponse[]> {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this._responsesCache.get(pollId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.responses;
      }
    }

    try {
      const queryRelayUrls = relayUrls && relayUrls.length > 0
        ? relayUrls
        : this.accountRelay.getRelayUrls();

      if (queryRelayUrls.length === 0) {
        return [];
      }

      const filter: {
        kinds: number[];
        '#e': string[];
        until?: number;
      } = {
        kinds: [1018],
        '#e': [pollId],
      };

      if (endsAt) {
        filter.until = endsAt;
      }

      // Reduced timeout from 5000 to 3000 for faster response loading
      const events = await this.pool.query(queryRelayUrls, filter, 3000);

      // One vote per pubkey - keep only the latest
      const responseMap = new Map<string, Event>();
      events.forEach((event: Event) => {
        const existing = responseMap.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          responseMap.set(event.pubkey, event);
        }
      });

      const responses: PollResponse[] = Array.from(responseMap.values()).map(event => {
        const responseIds = event.tags
          .filter(tag => tag[0] === 'response')
          .map(tag => tag[1]);

        return {
          id: event.id,
          pollId,
          responseIds: responseIds,
          pubkey: event.pubkey,
          created_at: event.created_at,
        };
      });

      // Cache the results
      this._responsesCache.set(pollId, {
        responses,
        timestamp: Date.now(),
      });

      return responses;
    } catch (error) {
      console.error('Failed to fetch poll responses:', error);
      return [];
    }
  }

  /**
   * Clear response cache for a specific poll
   */
  clearResponseCache(pollId: string): void {
    this._responsesCache.delete(pollId);
  }

  /**
   * Clear all response caches
   */
  clearAllResponseCaches(): void {
    this._responsesCache.clear();
  }

  /**
   * Calculate poll results from responses
   */
  calculateResults(poll: Poll, responses: PollResponse[]): PollResults {
    const optionCounts: Record<string, number> = {};
    const voters: string[] = [];
    const validOptionIds = new Set(poll.options.map(option => option.id));

    poll.options.forEach(option => {
      optionCounts[option.id] = 0;
    });

    responses.forEach(response => {
      if (!voters.includes(response.pubkey)) {
        voters.push(response.pubkey);
      }

      if (poll.pollType === 'singlechoice') {
        const selectedOptionId = response.responseIds.find(optionId => validOptionIds.has(optionId));
        if (selectedOptionId && optionCounts[selectedOptionId] !== undefined) {
          optionCounts[selectedOptionId]++;
        }
        return;
      }

      const selectedOptionIds = new Set<string>();
      response.responseIds.forEach(optionId => {
        if (validOptionIds.has(optionId)) {
          selectedOptionIds.add(optionId);
        }
      });

      selectedOptionIds.forEach(optionId => {
        if (optionCounts[optionId] !== undefined) {
          optionCounts[optionId]++;
        }
      });
    });

    return {
      totalVotes: voters.length,
      optionCounts,
      voters,
    };
  }

  private loadPollsFromStorage(): void {
    const stored = this.localStorage.getItem(this.POLLS_STORAGE_KEY);
    if (stored) {
      this._polls.set(JSON.parse(stored));
    }
  }

  private loadDraftsFromStorage(): void {
    const stored = this.localStorage.getItem(this.DRAFTS_STORAGE_KEY);
    if (stored) {
      this._drafts.set(JSON.parse(stored));
    }
  }

  private savePollsToStorage(): void {
    this.localStorage.setItem(this.POLLS_STORAGE_KEY, JSON.stringify(this._polls()));
  }

  private saveDraftsToStorage(): void {
    this.localStorage.setItem(this.DRAFTS_STORAGE_KEY, JSON.stringify(this._drafts()));
  }

  /**
   * Create a new poll draft
   */
  createPoll(content: string, options: PollOption[], pollType: 'singlechoice' | 'multiplechoice' = 'singlechoice', id?: string): PollDraft {
    const draft: PollDraft = {
      id: id || this.generateDraftId(),
      content,
      options,
      pollType,
      relays: [],
      isNewPoll: true,
    };

    this._currentEditingPoll.set(draft);
    this.saveDraft();
    return draft;
  }

  /**
   * Edit an existing poll
   */
  editPoll(poll: Poll): PollDraft {
    const draft: PollDraft = {
      id: poll.id,
      content: poll.content,
      options: [...poll.options],
      pollType: poll.pollType,
      relays: [...poll.relays],
      endsAt: poll.endsAt,
      isNewPoll: false,
    };

    this._currentEditingPoll.set(draft);
    return draft;
  }

  /**
   * Update the current editing poll
   */
  updateCurrentPoll(updates: Partial<PollDraft>): void {
    const current = this._currentEditingPoll();
    if (current) {
      this._currentEditingPoll.set({ ...current, ...updates });
    }
  }

  /**
   * Save current draft
   */
  saveDraft(): void {
    const draft = this._currentEditingPoll();
    if (!draft) return;

    const drafts = this._drafts();
    const existingIndex = drafts.findIndex(d => d.id === draft.id);

    if (existingIndex >= 0) {
      drafts[existingIndex] = draft;
    } else {
      drafts.push(draft);
    }

    this._drafts.set([...drafts]);
    this.saveDraftsToStorage();
  }

  /**
   * Publish poll to Nostr network using PublishService
   * Follows the same pattern as note publishing for consistency
   */
  async publishPoll(draft: PollDraft): Promise<Poll> {
    const currentUser = this.app.accountState.account();
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    const draftRelays = draft.relays.filter(relay => typeof relay === 'string' && relay.trim().length > 0);
    const publishRelayUrls = draftRelays.length > 0 ? draftRelays : this.accountRelay.getRelayUrls();

    // Build tags according to NIP-88
    const tags: string[][] = [
      ...draft.options.map(opt => ['option', opt.id, opt.label]),
      ...publishRelayUrls.map(relay => ['relay', relay]),
      ['polltype', draft.pollType],
    ];

    if (draft.endsAt) {
      tags.push(['endsAt', draft.endsAt.toString()]);
    }

    // Create unsigned event
    const event = {
      kind: 1068,
      content: draft.content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: currentUser.pubkey,
    };

    // Sign the event
    const signedEvent = await this.nostrService.signEvent(event);

    // Publish using PublishService with optimized relays (same as notes)
    const result = await this.publishService.publish(signedEvent, {
      useOptimizedRelays: true,
      relayUrls: publishRelayUrls,
    });

    if (!result.success) {
      throw new Error('Failed to publish poll to any relay');
    }

    // Extract relay URLs from publish result
    const publishedRelays = Array.from(result.relayResults.entries())
      .filter(([, relayResult]) => relayResult.success)
      .map(([relay]) => relay);

    // Create poll object
    const poll: Poll = {
      id: signedEvent.id,
      eventId: signedEvent.id,
      content: draft.content,
      options: draft.options,
      relays: publishedRelays,
      pollType: draft.pollType,
      endsAt: draft.endsAt,
      created_at: signedEvent.created_at,
      pubkey: signedEvent.pubkey,
      isLocal: false,
    };

    // Add to local polls list
    const polls = this._polls();
    polls.push(poll);
    this._polls.set([...polls]);
    this.savePollsToStorage();

    // Remove draft and clear editing state
    this.removeDraft(draft.id!);
    this._currentEditingPoll.set(null);

    return poll;
  }

  /**
   * Submit a response to a poll (NIP-88 kind:1018)
   * Uses PublishService for consistent publishing behavior
   */
  async submitPollResponse(pollId: string, optionIds: string[], relayUrls?: string[]): Promise<void> {
    const currentUser = this.app.accountState.account();
    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    // Build tags according to NIP-88
    const tags: string[][] = [
      ['e', pollId],
      ...optionIds.map(id => ['response', id]),
    ];

    // Create unsigned event
    const event = {
      kind: 1018,
      content: '',
      tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: currentUser.pubkey,
    };

    // Sign the event
    const signedEvent = await this.nostrService.signEvent(event);

    // Publish using PublishService with optimized relays
    const result = await this.publishService.publish(signedEvent, {
      useOptimizedRelays: true,
      relayUrls,
    });

    if (!result.success) {
      throw new Error('Failed to publish poll response to any relay');
    }
  }

  /**
   * Load a draft for editing
   */
  loadDraft(draftId: string): void {
    const draft = this._drafts().find(d => d.id === draftId);
    if (draft) {
      this._currentEditingPoll.set(draft);
    }
  }

  /**
   * Remove a draft
   */
  removeDraft(draftId: string): void {
    const drafts = this._drafts().filter(d => d.id !== draftId);
    this._drafts.set(drafts);
    this.saveDraftsToStorage();

    if (this._currentEditingPoll()?.id === draftId) {
      this._currentEditingPoll.set(null);
    }
  }

  /**
   * Cancel editing and clear current draft
   */
  cancelEditing(): void {
    this._currentEditingPoll.set(null);
  }

  /**
   * Delete a poll
   */
  deletePoll(pollId: string): void {
    const polls = this._polls().filter(p => p.id !== pollId);
    this._polls.set(polls);
    this.savePollsToStorage();
  }

  /**
   * Get a specific poll by ID
   */
  getPoll(pollId: string): Poll | undefined {
    return this._polls().find(p => p.id === pollId);
  }

  /**
   * Parse Nostr event (kind 1068) to Poll object
   */
  parseNostrPollEvent(event: Event): Poll {
    const options: PollOption[] = event.tags
      .filter(tag => tag[0] === 'option')
      .map(tag => ({
        id: tag[1],
        label: tag[2],
      }));

    const relays = event.tags
      .filter(tag => tag[0] === 'relay')
      .map(tag => tag[1]);

    const pollTypeTag = event.tags.find(tag => tag[0] === 'polltype');
    const pollType = (pollTypeTag?.[1] as 'singlechoice' | 'multiplechoice') || 'singlechoice';

    const endsAtTag = event.tags.find(tag => tag[0] === 'endsAt');
    const endsAt = endsAtTag ? parseInt(endsAtTag[1], 10) : undefined;

    return {
      id: event.id,
      eventId: event.id,
      content: event.content,
      options,
      relays,
      pollType,
      endsAt,
      created_at: event.created_at,
      pubkey: event.pubkey,
      isLocal: false,
    };
  }

  private generateDraftId(): string {
    return `draft-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private getCurrentUserPubkey(): string | null {
    return this.app.accountState.pubkey();
  }
}
