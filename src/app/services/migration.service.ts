import { Injectable, inject, signal, computed } from '@angular/core';
import { Event, SimplePool, Filter } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { UtilitiesService } from './utilities.service';

export interface MigrationProgress {
  status: 'idle' | 'connecting' | 'fetching' | 'publishing' | 'completed' | 'error';
  currentRelay: string;
  currentKind: number | null;
  totalKinds: number;
  completedKinds: number;
  eventsFetched: number;
  eventsPublished: number;
  eventsFailed: number;
  errorMessage: string | null;
}

export interface MigrationResult {
  sourceRelay: string;
  eventsFetched: number;
  eventsPublished: number;
  eventsFailed: number;
  kindsProcessed: number[];
  errors: string[];
}

// Event kinds to migrate - organized by priority
export const BASIC_EVENT_KINDS = [
  1,      // Short text notes
  6,      // Reposts
  7,      // Reactions
  30023,  // Long-form articles
  30024,  // Draft long-form articles
];

export const EXTENDED_EVENT_KINDS = [
  16,     // Generic repost
  1111,   // Comments (NIP-22)
  9802,   // Highlights
  1063,   // File metadata
  20,     // Picture-first notes
  21,     // Video-first notes
  22,     // Audio-first notes
];

export const DEEP_EVENT_KINDS = [
  // Calendar events (NIP-52)
  31922,  // Date-based calendar event
  31923,  // Time-based calendar event
  31924,  // Calendar
  31925,  // Calendar event RSVP
  // Lists (NIP-51)
  10000,  // Mute list
  10001,  // Pin list
  30000,  // Follow sets
  30001,  // Generic lists
  30003,  // Bookmark sets
  // Badges (NIP-58)
  30008,  // Profile badges
  30009,  // Badge definition
  8,      // Badge award
  // Other
  1984,   // Reports
  9735,   // Zap receipts
  30078,  // Application-specific data
];

@Injectable({
  providedIn: 'root',
})
export class MigrationService {
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly utilities = inject(UtilitiesService);

  // Migration state
  private migrationPool: SimplePool | null = null;
  
  // Progress tracking
  progress = signal<MigrationProgress>({
    status: 'idle',
    currentRelay: '',
    currentKind: null,
    totalKinds: 0,
    completedKinds: 0,
    eventsFetched: 0,
    eventsPublished: 0,
    eventsFailed: 0,
    errorMessage: null,
  });

  // Computed signals for UI
  isRunning = computed(() => {
    const status = this.progress().status;
    return status === 'connecting' || status === 'fetching' || status === 'publishing';
  });

  progressPercent = computed(() => {
    const p = this.progress();
    if (p.totalKinds === 0) return 0;
    return Math.round((p.completedKinds / p.totalKinds) * 100);
  });

  /**
   * Get event kinds based on migration depth
   */
  getEventKinds(depth: 'basic' | 'extended' | 'deep'): number[] {
    switch (depth) {
      case 'basic':
        return [...BASIC_EVENT_KINDS];
      case 'extended':
        return [...BASIC_EVENT_KINDS, ...EXTENDED_EVENT_KINDS];
      case 'deep':
        return [...BASIC_EVENT_KINDS, ...EXTENDED_EVENT_KINDS, ...DEEP_EVENT_KINDS];
      default:
        return [...BASIC_EVENT_KINDS];
    }
  }

  /**
   * Migrate events from a source relay to the user's account relays
   */
  async migrateFromRelay(
    sourceRelayUrl: string,
    depth: 'basic' | 'extended' | 'deep' = 'basic'
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      sourceRelay: sourceRelayUrl,
      eventsFetched: 0,
      eventsPublished: 0,
      eventsFailed: 0,
      kindsProcessed: [],
      errors: [],
    };

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      result.errors.push('No active account');
      this.updateProgress({ status: 'error', errorMessage: 'No active account' });
      return result;
    }

    const targetRelays = this.accountRelay.getRelayUrls();
    if (targetRelays.length === 0) {
      result.errors.push('No account relays configured');
      this.updateProgress({ status: 'error', errorMessage: 'No account relays configured' });
      return result;
    }

    // Normalize the source relay URL
    const normalizedSourceUrl = this.utilities.normalizeRelayUrl(sourceRelayUrl);
    
    // Get the event kinds to migrate
    const eventKinds = this.getEventKinds(depth);

    this.logger.info('Starting migration', {
      sourceRelay: normalizedSourceUrl,
      targetRelays,
      depth,
      eventKinds,
    });

    // Reset progress
    this.updateProgress({
      status: 'connecting',
      currentRelay: normalizedSourceUrl,
      currentKind: null,
      totalKinds: eventKinds.length,
      completedKinds: 0,
      eventsFetched: 0,
      eventsPublished: 0,
      eventsFailed: 0,
      errorMessage: null,
    });

    try {
      // Create a dedicated pool for migration
      this.migrationPool = new SimplePool();

      // Process each event kind
      for (let i = 0; i < eventKinds.length; i++) {
        const kind = eventKinds[i];
        
        this.updateProgress({
          status: 'fetching',
          currentKind: kind,
          completedKinds: i,
        });

        this.logger.debug(`Fetching events of kind ${kind} from ${normalizedSourceUrl}`);

        try {
          // Fetch events of this kind from the source relay
          const events = await this.fetchEventsFromRelay(
            normalizedSourceUrl,
            pubkey,
            kind
          );

          result.eventsFetched += events.length;
          this.updateProgress({ eventsFetched: result.eventsFetched });

          if (events.length > 0) {
            this.logger.info(`Found ${events.length} events of kind ${kind}`);

            // Publish events to target relays
            this.updateProgress({ status: 'publishing' });

            for (const event of events) {
              try {
                await this.publishEventToRelays(event, targetRelays);
                result.eventsPublished++;
                this.updateProgress({ eventsPublished: result.eventsPublished });
              } catch (err) {
                result.eventsFailed++;
                this.updateProgress({ eventsFailed: result.eventsFailed });
                const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                this.logger.warn(`Failed to publish event ${event.id}`, err);
                if (!result.errors.includes(errorMsg)) {
                  result.errors.push(errorMsg);
                }
              }
            }

            result.kindsProcessed.push(kind);
          }
        } catch (err) {
          const errorMsg = `Failed to fetch kind ${kind}: ${err instanceof Error ? err.message : 'Unknown error'}`;
          this.logger.error(errorMsg, err);
          result.errors.push(errorMsg);
        }
      }

      this.updateProgress({
        status: 'completed',
        completedKinds: eventKinds.length,
        currentKind: null,
      });

      this.logger.info('Migration completed', result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(errorMsg);
      this.updateProgress({
        status: 'error',
        errorMessage: errorMsg,
      });
      this.logger.error('Migration failed', err);
    } finally {
      // Clean up the migration pool
      if (this.migrationPool) {
        try {
          this.migrationPool.close([normalizedSourceUrl]);
      } catch {
        // Ignore close errors
      }
        this.migrationPool = null;
      }
    }

    return result;
  }

  /**
   * Migrate from multiple relays
   */
  async migrateFromRelays(
    sourceRelayUrls: string[],
    depth: 'basic' | 'extended' | 'deep' = 'basic'
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const relayUrl of sourceRelayUrls) {
      const result = await this.migrateFromRelay(relayUrl, depth);
      results.push(result);
    }

    return results;
  }

  /**
   * Fetch events from a relay
   */
  private async fetchEventsFromRelay(
    relayUrl: string,
    pubkey: string,
    kind: number
  ): Promise<Event[]> {
    if (!this.migrationPool) {
      throw new Error('Migration pool not initialized');
    }

    const filter: Filter = {
      authors: [pubkey],
      kinds: [kind],
      limit: 500, // Fetch in batches
    };

    return new Promise<Event[]>((resolve, reject) => {
      const events: Event[] = [];
      const timeout = setTimeout(() => {
        resolve(events); // Return whatever we have after timeout
      }, 15000); // 15 second timeout per kind

      try {
        this.migrationPool!.subscribeMany(
          [relayUrl],
          filter,
          {
            onevent: (event) => {
              // Check if event has expired according to NIP-40
              if (!this.utilities.isEventExpired(event)) {
                events.push(event);
              }
            },
            oneose: () => {
              clearTimeout(timeout);
              resolve(events);
            },
            onclose: (reasons) => {
              clearTimeout(timeout);
              // If closed before EOSE, return what we have
              if (reasons && reasons.length > 0 && !reasons.includes('closed by caller')) {
                this.logger.warn(`Subscription closed: ${reasons.join(', ')}`);
              }
              resolve(events);
            },
          }
        );
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Publish an event to target relays
   */
  private async publishEventToRelays(event: Event, relayUrls: string[]): Promise<void> {
    const results = await this.accountRelay.publishToRelay(event, relayUrls);
    
    if (!results || results.length === 0) {
      throw new Error('No publish results returned');
    }

    // Wait for at least one successful publish
    const settled = await Promise.allSettled(results);
    const successful = settled.filter(r => r.status === 'fulfilled');
    
    if (successful.length === 0) {
      const errors = settled
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason?.message || 'Unknown error');
      throw new Error(`All relays failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Update progress state
   */
  private updateProgress(partial: Partial<MigrationProgress>): void {
    this.progress.update(current => ({ ...current, ...partial }));
  }

  /**
   * Cancel ongoing migration
   */
  cancel(): void {
    if (this.migrationPool) {
      try {
        this.migrationPool.close([]);
      } catch {
        // Ignore
      }
      this.migrationPool = null;
    }
    this.updateProgress({
      status: 'idle',
      errorMessage: 'Migration cancelled',
    });
  }

  /**
   * Reset the migration state
   */
  reset(): void {
    this.cancel();
    this.progress.set({
      status: 'idle',
      currentRelay: '',
      currentKind: null,
      totalKinds: 0,
      completedKinds: 0,
      eventsFetched: 0,
      eventsPublished: 0,
      eventsFailed: 0,
      errorMessage: null,
    });
  }
}
