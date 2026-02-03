import { inject, Injectable, signal, computed } from '@angular/core';
import { Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { DeletionFilterService } from './deletion-filter.service';
import { ReportingService } from './reporting.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';

/**
 * Result of event processing
 */
export interface EventProcessingResult {
  /** Whether the event should be accepted */
  accepted: boolean;
  /** Reason for rejection (if not accepted) */
  reason?: 'deleted' | 'muted_user' | 'muted_event' | 'muted_hashtag' | 'muted_word' | 'expired';
  /** The processed event (may be modified in future) */
  event: Event;
}

/**
 * Statistics about event processing
 */
export interface EventProcessingStats {
  total: number;
  accepted: number;
  rejected: {
    deleted: number;
    muted_user: number;
    muted_event: number;
    muted_hashtag: number;
    muted_word: number;
    expired: number;
  };
}

/**
 * Central service for processing all incoming Nostr events.
 * 
 * This service acts as a filter/processor for ALL events received from relays.
 * It applies various filters:
 * - Deletion filter (NIP-09): Filter out events the user has deleted
 * - Mute filter (NIP-51): Filter out events from muted users/events/hashtags/words
 * - Expiration filter (NIP-40): Filter out expired events
 * 
 * This service should be used by relay services to process events before
 * passing them to consumers.
 */
@Injectable({
  providedIn: 'root',
})
export class EventProcessorService {
  private readonly logger = inject(LoggerService);
  private readonly deletionFilter = inject(DeletionFilterService);
  private readonly reportingService = inject(ReportingService);
  private readonly utilities = inject(UtilitiesService);
  private readonly dataService = inject(DataService);

  // Statistics tracking
  private readonly _stats = signal<EventProcessingStats>({
    total: 0,
    accepted: 0,
    rejected: {
      deleted: 0,
      muted_user: 0,
      muted_event: 0,
      muted_hashtag: 0,
      muted_word: 0,
      expired: 0,
    },
  });

  // Public readonly statistics
  readonly stats = this._stats.asReadonly();

  // Computed for quick stats
  readonly totalProcessed = computed(() => this._stats().total);
  readonly totalRejected = computed(() => {
    const s = this._stats();
    return s.rejected.deleted + s.rejected.muted_user + s.rejected.muted_event +
      s.rejected.muted_hashtag + s.rejected.muted_word + s.rejected.expired;
  });

  /**
   * Process a single event through all filters.
   * 
   * @param event The event to process
   * @param options Processing options
   * @returns Processing result indicating whether to accept the event
   */
  processEvent(event: Event, options: {
    /** Skip deletion check (useful if checking own events) */
    skipDeletionCheck?: boolean;
    /** Skip mute check (useful for DMs or specific contexts) */
    skipMuteCheck?: boolean;
    /** Skip expiration check */
    skipExpirationCheck?: boolean;
  } = {}): EventProcessingResult {
    // Track total
    this.incrementStat('total');

    // 1. Check expiration (NIP-40)
    if (!options.skipExpirationCheck && this.utilities.isEventExpired(event)) {
      this.incrementStat('expired');
      return {
        accepted: false,
        reason: 'expired',
        event,
      };
    }

    // 2. Check if event was deleted by author (NIP-09)
    if (!options.skipDeletionCheck && this.deletionFilter.isDeleted(event)) {
      this.incrementStat('deleted');
      return {
        accepted: false,
        reason: 'deleted',
        event,
      };
    }

    // 3. Check mute list (NIP-51)
    if (!options.skipMuteCheck) {
      const muteResult = this.checkMuteFilters(event);
      if (muteResult) {
        this.incrementStat(muteResult);
        return {
          accepted: false,
          reason: muteResult,
          event,
        };
      }
    }

    // Event accepted
    this.incrementStat('accepted');
    return {
      accepted: true,
      event,
    };
  }

  /**
   * Process multiple events and return only accepted ones.
   * 
   * @param events Array of events to process
   * @param options Processing options
   * @returns Array of accepted events
   */
  filterEvents(events: Event[], options: {
    skipDeletionCheck?: boolean;
    skipMuteCheck?: boolean;
    skipExpirationCheck?: boolean;
  } = {}): Event[] {
    return events.filter(event => this.processEvent(event, options).accepted);
  }

  /**
   * Check if an event should be accepted (quick check without stats).
   * Use this for simple boolean checks where you don't need the reason.
   * 
   * @param event The event to check
   * @param options Processing options
   * @returns true if event should be accepted, false otherwise
   */
  shouldAcceptEvent(event: Event, options: {
    skipDeletionCheck?: boolean;
    skipMuteCheck?: boolean;
    skipExpirationCheck?: boolean;
    /** Don't update stats (for preview/checking without side effects) */
    skipStats?: boolean;
  } = {}): boolean {
    // Quick checks without stats
    if (!options.skipExpirationCheck && this.utilities.isEventExpired(event)) {
      return false;
    }

    if (!options.skipDeletionCheck && this.deletionFilter.isDeleted(event)) {
      return false;
    }

    if (!options.skipMuteCheck && this.checkMuteFilters(event)) {
      return false;
    }

    return true;
  }

  /**
   * Create an event handler wrapper that filters events before calling the original handler.
   * Use this to wrap subscription callbacks.
   * 
   * @param onEvent Original event handler
   * @param options Processing options
   * @returns Wrapped event handler that filters events
   */
  createFilteredEventHandler<T extends Event = Event>(
    onEvent: (event: T) => void,
    options: {
      skipDeletionCheck?: boolean;
      skipMuteCheck?: boolean;
      skipExpirationCheck?: boolean;
    } = {}
  ): (event: T) => void {
    return (event: T) => {
      const result = this.processEvent(event, options);
      if (result.accepted) {
        onEvent(event);
      } else {
        this.logger.debug(`[EventProcessor] Filtered out event ${event.id} (kind: ${event.kind}), reason: ${result.reason}`);
      }
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this._stats.set({
      total: 0,
      accepted: 0,
      rejected: {
        deleted: 0,
        muted_user: 0,
        muted_event: 0,
        muted_hashtag: 0,
        muted_word: 0,
        expired: 0,
      },
    });
  }

  /**
   * Check mute filters and return the reason if blocked.
   */
  private checkMuteFilters(event: Event): 'muted_user' | 'muted_event' | 'muted_hashtag' | 'muted_word' | null {
    // Check if user is muted
    if (this.reportingService.mutedPubkeys().includes(event.pubkey)) {
      return 'muted_user';
    }

    // Check if specific event is muted
    if (this.reportingService.mutedEvents().includes(event.id)) {
      return 'muted_event';
    }

    // Check for muted hashtags in event tags
    const eventHashtags = event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1]?.toLowerCase());

    const mutedHashtags = this.reportingService.mutedHashtags();
    if (eventHashtags.some(hashtag =>
      mutedHashtags.some(muted => muted.toLowerCase() === hashtag)
    )) {
      return 'muted_hashtag';
    }

    // Check for muted words in content
    const content = event.content?.toLowerCase() || '';
    const mutedWords = this.reportingService.mutedWords();
    if (mutedWords.some(word => content.includes(word.toLowerCase()))) {
      return 'muted_word';
    }

    // Check for muted words in the author's profile (name, display_name, nip05)
    // This uses cached profiles only to keep the check synchronous
    if (this.checkProfileForMutedWords(event.pubkey, mutedWords)) {
      return 'muted_word';
    }

    return null;
  }

  /**
   * Check if an author's profile contains any muted words.
   * Checks name, display_name, and nip05 fields.
   * Only checks cached profiles to keep the operation synchronous.
   * 
   * @param pubkey The author's pubkey
   * @param mutedWords Array of muted words to check against
   * @returns true if any muted word is found in the profile
   */
  private checkProfileForMutedWords(pubkey: string, mutedWords: string[]): boolean {
    if (mutedWords.length === 0) {
      return false;
    }

    // Get cached profile (synchronous, doesn't trigger async fetch)
    const profile = this.dataService.getCachedProfile(pubkey);
    if (!profile?.data) {
      return false;
    }

    const profileData = profile.data;
    
    // Build a combined string of profile fields to check
    const fieldsToCheck: string[] = [];
    
    if (profileData.name) {
      fieldsToCheck.push(profileData.name.toLowerCase());
    }
    if (profileData.display_name) {
      fieldsToCheck.push(profileData.display_name.toLowerCase());
    }
    if (profileData.nip05) {
      const nip05Data = profileData.nip05;
      const nip05Values = Array.isArray(nip05Data) ? nip05Data : [nip05Data];
      nip05Values.forEach(v => {
        if (v && typeof v === 'string') {
          fieldsToCheck.push(v.toLowerCase());
        }
      });
    }

    // Check if any muted word appears in any of the profile fields
    return mutedWords.some(word => {
      const lowerWord = word.toLowerCase();
      return fieldsToCheck.some(field => field.includes(lowerWord));
    });
  }

  /**
   * Increment a stat counter
   */
  private incrementStat(stat: 'total' | 'accepted' | 'deleted' | 'muted_user' | 'muted_event' | 'muted_hashtag' | 'muted_word' | 'expired'): void {
    this._stats.update(current => {
      const updated = { ...current };
      if (stat === 'total') {
        updated.total++;
      } else if (stat === 'accepted') {
        updated.accepted++;
      } else {
        updated.rejected = { ...updated.rejected };
        updated.rejected[stat]++;
      }
      return updated;
    });
  }
}
