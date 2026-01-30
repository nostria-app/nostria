import { inject, Injectable, signal, computed } from '@angular/core';
import { Event, kinds, Filter } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { DatabaseService } from './database.service';
import { AccountRelayService } from './relays/account-relay';

/**
 * Represents a parsed deletion reference from a kind 5 event.
 * 
 * For regular events (e-tag): Only eventId is set.
 * For addressable events (a-tag): kind, pubkey, and dTag are set.
 */
export interface DeletionReference {
  /** Event ID for 'e' tag deletions */
  eventId?: string;
  /** For 'a' tag (addressable event) deletions */
  kind?: number;
  /** For 'a' tag (addressable event) deletions */
  pubkey?: string;
  /** For 'a' tag (addressable event) deletions */
  dTag?: string;
  /** Timestamp of the deletion event - used to ignore events created after deletion was reverted */
  deletedAt: number;
}

/**
 * Service that manages deletion events (NIP-09) for the current user.
 * 
 * On account load:
 * 1. Loads deletion events (kind 5) from local database
 * 2. Subscribes to deletion events from relays
 * 3. Maintains a filter list of deleted event IDs and addressable event identifiers
 * 
 * This filter list is used to filter out incoming events that the user has deleted.
 */
@Injectable({
  providedIn: 'root',
})
export class DeletionFilterService {
  private readonly logger = inject(LoggerService);
  private readonly database = inject(DatabaseService);
  private readonly accountRelay = inject(AccountRelayService);

  // Deletion references indexed by event ID (for 'e' tag deletions)
  private readonly _deletedEventIds = signal<Map<string, DeletionReference>>(new Map());

  // Deletion references indexed by addressable identifier "kind:pubkey:dTag" (for 'a' tag deletions)
  private readonly _deletedAddressableEvents = signal<Map<string, DeletionReference>>(new Map());

  // Signal to track loading state
  private readonly _loading = signal(false);

  // Signal to track if initial load is complete
  private readonly _initialized = signal(false);

  // Current account pubkey
  private currentPubkey: string | null = null;

  // Subscription cleanup - stores the subscription object with close() or unsubscribe() method
  private subscription: { close?: () => void; unsubscribe?: () => void } | null = null;

  // Public readonly signals
  readonly loading = this._loading.asReadonly();
  readonly initialized = this._initialized.asReadonly();

  // Computed count of total deletions
  readonly deletionCount = computed(() =>
    this._deletedEventIds().size + this._deletedAddressableEvents().size
  );

  /**
   * Load deletion events for the given pubkey.
   * First loads from local database, then subscribes to relay updates.
   */
  async load(pubkey: string): Promise<void> {
    if (this._loading()) {
      this.logger.warn('[DeletionFilter] Already loading, skipping');
      return;
    }

    this.currentPubkey = pubkey;
    this._loading.set(true);
    this._initialized.set(false);

    try {
      // Clear previous state
      this._deletedEventIds.set(new Map());
      this._deletedAddressableEvents.set(new Map());

      // Cancel any existing subscription
      this.cancelSubscription();

      // Load from local database first
      await this.loadFromDatabase(pubkey);

      this.logger.info(`[DeletionFilter] Loaded ${this.deletionCount()} deletion references from database`);

      // Subscribe to relay for new deletions
      this.subscribeToRelays(pubkey);

      this._initialized.set(true);
    } catch (error) {
      this.logger.error('[DeletionFilter] Error loading deletion events:', error);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Clear all deletion references and cancel subscriptions.
   */
  clear(): void {
    this.cancelSubscription();
    this._deletedEventIds.set(new Map());
    this._deletedAddressableEvents.set(new Map());
    this._initialized.set(false);
    this.currentPubkey = null;
    this.logger.debug('[DeletionFilter] Cleared');
  }

  /**
   * Check if an event has been deleted by the user.
   * 
   * @param event The event to check
   * @returns true if the event has been deleted, false otherwise
   */
  isDeleted(event: Event): boolean {
    // Only check deletions for events authored by the current user
    if (event.pubkey !== this.currentPubkey) {
      return false;
    }

    // Check by event ID
    const deletionById = this._deletedEventIds().get(event.id);
    if (deletionById) {
      // Event was deleted - but only if the deletion happened after the event was created
      // This handles the case where a deletion request exists but user recreated the event
      if (event.created_at <= deletionById.deletedAt) {
        return true;
      }
    }

    // Check by addressable identifier for replaceable events
    if (this.isAddressableEvent(event.kind)) {
      const dTag = this.extractDTag(event);
      if (dTag !== null) {
        const identifier = `${event.kind}:${event.pubkey}:${dTag}`;
        const deletionByAddress = this._deletedAddressableEvents().get(identifier);
        if (deletionByAddress) {
          // Event was deleted - but only if the deletion happened after the event was created
          if (event.created_at <= deletionByAddress.deletedAt) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if an event ID has been deleted.
   * Use this when you only have the event ID.
   * 
   * @param eventId The event ID to check
   * @returns true if the event ID was deleted, false otherwise
   */
  isEventIdDeleted(eventId: string): boolean {
    return this._deletedEventIds().has(eventId);
  }

  /**
   * Check if an addressable event has been deleted.
   * 
   * @param kind The event kind
   * @param pubkey The event pubkey
   * @param dTag The d-tag value
   * @param createdAt Optional timestamp to check if the event was created before the deletion
   * @returns true if the addressable event was deleted, false otherwise
   */
  isAddressableDeleted(kind: number, pubkey: string, dTag: string, createdAt?: number): boolean {
    if (pubkey !== this.currentPubkey) {
      return false;
    }

    const identifier = `${kind}:${pubkey}:${dTag}`;
    const deletion = this._deletedAddressableEvents().get(identifier);

    if (!deletion) {
      return false;
    }

    // If createdAt is provided, check if the event was created before the deletion
    if (createdAt !== undefined) {
      return createdAt <= deletion.deletedAt;
    }

    return true;
  }

  /**
   * Process a deletion event and add its references to the filter.
   */
  processDeletionEvent(event: Event): void {
    if (event.kind !== kinds.EventDeletion) {
      return;
    }

    // Only process deletions from the current user
    if (event.pubkey !== this.currentPubkey) {
      return;
    }

    const references = this.parseDeletionEvent(event);

    if (references.length === 0) {
      return;
    }

    // Update signal maps
    this._deletedEventIds.update(map => {
      const newMap = new Map(map);
      for (const ref of references) {
        if (ref.eventId) {
          // Only update if this deletion is newer
          const existing = newMap.get(ref.eventId);
          if (!existing || ref.deletedAt > existing.deletedAt) {
            newMap.set(ref.eventId, ref);
          }
        }
      }
      return newMap;
    });

    this._deletedAddressableEvents.update(map => {
      const newMap = new Map(map);
      for (const ref of references) {
        if (ref.kind !== undefined && ref.pubkey && ref.dTag !== undefined) {
          const identifier = `${ref.kind}:${ref.pubkey}:${ref.dTag}`;
          // Only update if this deletion is newer
          const existing = newMap.get(identifier);
          if (!existing || ref.deletedAt > existing.deletedAt) {
            newMap.set(identifier, ref);
          }
        }
      }
      return newMap;
    });

    this.logger.debug(`[DeletionFilter] Processed deletion event ${event.id}, total: ${this.deletionCount()}`);
  }

  /**
   * Parse a deletion event and extract all deletion references.
   */
  private parseDeletionEvent(event: Event): DeletionReference[] {
    const references: DeletionReference[] = [];

    // Get k-tags for kind information
    const kTags = new Map<string, number>();
    for (const tag of event.tags) {
      if (tag[0] === 'k' && tag[1]) {
        const kind = parseInt(tag[1], 10);
        if (!isNaN(kind)) {
          // Store the first k-tag found - this is the default kind for e-tags
          if (!kTags.has('default')) {
            kTags.set('default', kind);
          }
          // Also store by kind number for quick lookup
          kTags.set(tag[1], kind);
        }
      }
    }

    // Process e-tags (regular event deletions)
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) {
        references.push({
          eventId: tag[1],
          deletedAt: event.created_at,
        });
      }
    }

    // Process a-tags (addressable event deletions)
    // Format: ["a", "<kind>:<pubkey>:<d-identifier>"]
    for (const tag of event.tags) {
      if (tag[0] === 'a' && tag[1]) {
        const parts = tag[1].split(':');
        if (parts.length >= 3) {
          const kind = parseInt(parts[0], 10);
          const pubkey = parts[1];
          const dTag = parts.slice(2).join(':'); // d-tag might contain colons

          if (!isNaN(kind) && pubkey) {
            references.push({
              kind,
              pubkey,
              dTag,
              deletedAt: event.created_at,
            });
          }
        }
      }
    }

    return references;
  }

  /**
   * Load deletion events from the local database.
   */
  private async loadFromDatabase(pubkey: string): Promise<void> {
    try {
      await this.database.init();

      // Get all deletion events for this user
      const deletionEvents = await this.database.getEventsByPubkeyAndKind(pubkey, kinds.EventDeletion);

      for (const event of deletionEvents) {
        this.processDeletionEvent(event);
      }

      this.logger.debug(`[DeletionFilter] Loaded ${deletionEvents.length} deletion events from database`);
    } catch (error) {
      this.logger.error('[DeletionFilter] Error loading from database:', error);
    }
  }

  /**
   * Subscribe to deletion events from relays.
   */
  private subscribeToRelays(pubkey: string): void {
    if (!this.accountRelay.isInitialized()) {
      this.logger.warn('[DeletionFilter] Account relay not initialized, skipping subscription');
      return;
    }

    const filter: Filter = {
      kinds: [kinds.EventDeletion],
      authors: [pubkey],
    };

    const onEvent = (event: Event) => {
      this.processDeletionEvent(event);

      // Save to database for future loads
      this.database.saveEvent(event).catch(err => {
        this.logger.error('[DeletionFilter] Error saving deletion event to database:', err);
      });
    };

    const onEose = () => {
      this.logger.debug('[DeletionFilter] EOSE received for deletion events subscription');
    };

    try {
      this.subscription = this.accountRelay.subscribe(filter, onEvent, onEose);
      this.logger.debug('[DeletionFilter] Subscribed to deletion events');
    } catch (error) {
      this.logger.error('[DeletionFilter] Error subscribing to deletion events:', error);
    }
  }

  /**
   * Cancel the active relay subscription.
   */
  private cancelSubscription(): void {
    if (this.subscription) {
      try {
        // Handle both close() and unsubscribe() methods
        if (this.subscription.close) {
          this.subscription.close();
        } else if (this.subscription.unsubscribe) {
          this.subscription.unsubscribe();
        }
      } catch (error) {
        this.logger.debug('[DeletionFilter] Error canceling subscription:', error);
      }
      this.subscription = null;
    }
  }

  /**
   * Check if a kind is an addressable (replaceable) event kind.
   * Addressable events: 30000-39999 (parameterized replaceable)
   * Also includes 0, 3, 10000-19999 (replaceable)
   */
  private isAddressableEvent(kind: number): boolean {
    // Parameterized replaceable events (have d-tag)
    if (kind >= 30000 && kind <= 39999) {
      return true;
    }
    // Regular replaceable events (no d-tag, but use empty string)
    if (kind === 0 || kind === 3 || (kind >= 10000 && kind <= 19999)) {
      return true;
    }
    return false;
  }

  /**
   * Extract the d-tag value from an event.
   */
  private extractDTag(event: Event): string | null {
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag && dTag.length > 1 ? dTag[1] : '';
  }
}
