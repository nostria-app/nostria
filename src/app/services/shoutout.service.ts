import { Injectable, inject, signal, effect, computed, untracked } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { DataService } from './data.service';
import { FavoritesService } from './favorites.service';
import { NostrRecord } from '../interfaces';
import { UtilitiesService } from './utilities.service';

/**
 * NIP-A4 Public Message (kind 24)
 * A simple plaintext message to one or more Nostr users.
 * Messages MUST be sent to the NIP-65 inbox relays of each receiver and the outbox relay of the sender.
 */
export const SHOUTOUT_KIND = 24;

export interface Shoutout {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  receivers: string[];
  profile?: NostrRecord;
  event: Event;
}

@Injectable({
  providedIn: 'root',
})
export class ShoutoutService {
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly nostrService = inject(NostrService);
  private readonly logger = inject(LoggerService);
  private readonly data = inject(DataService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly utilities = inject(UtilitiesService);

  // Signal to store received shoutouts
  private readonly _shoutouts = signal<Shoutout[]>([]);
  readonly shoutouts = this._shoutouts.asReadonly();

  // Signal to track loading state
  readonly isLoading = signal(false);

  // Signal to track subscription
  private subscription: { close: () => void } | { unsubscribe: () => void } | null = null;

  // Computed: shoutouts from favorites only
  readonly shoutoutsFromFavorites = computed(() => {
    const favorites = this.favoritesService.favorites();
    return this._shoutouts().filter(s => favorites.includes(s.pubkey));
  });

  // Computed: count of unread shoutouts (shoutouts in the last hour)
  readonly recentShoutoutsCount = computed(() => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    return this._shoutouts().filter(s => s.created_at > oneHourAgo).length;
  });

  constructor() {
    // Subscribe to shoutouts when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        untracked(() => {
          this.startSubscription(pubkey);
        });
      } else {
        this.stopSubscription();
      }
    });
  }

  /**
   * Start subscription to receive kind 24 events
   */
  private startSubscription(pubkey: string): void {
    // Close existing subscription if any
    this.stopSubscription();

    this.isLoading.set(true);
    this._shoutouts.set([]);

    // Subscribe to kind 24 events where we are tagged
    const filter = {
      kinds: [SHOUTOUT_KIND],
      '#p': [pubkey],
      limit: 100,
    };

    const onEvent = (event: Event) => {
      this.processShoutoutEvent(event);
    };

    const onEose = () => {
      this.isLoading.set(false);
      this.logger.info(`[ShoutoutService] Loaded ${this._shoutouts().length} shoutouts`);
    };

    this.subscription = this.accountRelay.subscribe(filter, onEvent, onEose);
  }

  /**
   * Stop the current subscription
   */
  private stopSubscription(): void {
    if (this.subscription) {
      if ('close' in this.subscription && this.subscription.close) {
        this.subscription.close();
      } else if ('unsubscribe' in this.subscription && this.subscription.unsubscribe) {
        this.subscription.unsubscribe();
      }
      this.subscription = null;
    }
    this._shoutouts.set([]);
  }

  /**
   * Process a received shoutout event
   */
  private async processShoutoutEvent(event: Event): Promise<void> {
    // Validate event kind
    if (event.kind !== SHOUTOUT_KIND) {
      return;
    }

    // Extract receivers from p tags
    const receivers = event.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => tag[1])
      .filter(pubkey => pubkey && this.utilities.isValidPubkey(pubkey));

    // Create shoutout object
    const shoutout: Shoutout = {
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      created_at: event.created_at,
      receivers,
      event,
    };

    // Check if already exists
    const existing = this._shoutouts().find(s => s.id === event.id);
    if (existing) {
      return;
    }

    // Add to list (sorted by created_at descending)
    this._shoutouts.update(shoutouts => {
      const updated = [...shoutouts, shoutout];
      return updated.sort((a, b) => b.created_at - a.created_at);
    });

    // Fetch profile in background
    this.fetchProfileForShoutout(shoutout);
  }

  /**
   * Fetch profile for a shoutout sender
   */
  private async fetchProfileForShoutout(shoutout: Shoutout): Promise<void> {
    try {
      const profile = await this.data.getProfile(shoutout.pubkey);
      if (profile) {
        this._shoutouts.update(shoutouts =>
          shoutouts.map(s =>
            s.id === shoutout.id ? { ...s, profile } : s
          )
        );
      }
    } catch {
      this.logger.debug(`[ShoutoutService] Failed to fetch profile for ${shoutout.pubkey}`);
    }
  }

  /**
   * Send a shoutout to one or more users
   * @param content The message content
   * @param receivers Array of pubkeys to send to (if empty, sends a general shoutout)
   * @param expiration Optional expiration timestamp
   */
  async sendShoutout(
    content: string,
    receivers: string[] = [],
    expiration?: number
  ): Promise<{ success: boolean; event?: Event }> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[ShoutoutService] Cannot send shoutout: not authenticated');
      return { success: false };
    }

    if (!content.trim()) {
      this.logger.error('[ShoutoutService] Cannot send shoutout: empty content');
      return { success: false };
    }

    // Build tags
    const tags: string[][] = [];

    // Add p tags for receivers
    for (const receiver of receivers) {
      if (this.utilities.isValidPubkey(receiver)) {
        tags.push(['p', receiver]);
      }
    }

    // Add expiration tag (NIP-40) - default to 24 hours if not specified
    if (expiration) {
      tags.push(['expiration', String(expiration)]);
    } else {
      // Default expiration: 24 hours from now
      const defaultExpiration = Math.floor(Date.now() / 1000) + 86400;
      tags.push(['expiration', String(defaultExpiration)]);
    }

    // Create the event
    const event: UnsignedEvent = {
      kind: SHOUTOUT_KIND,
      content: content.trim(),
      created_at: Math.floor(Date.now() / 1000),
      tags,
      pubkey,
    };

    try {
      const result = await this.nostrService.signAndPublish(event);
      if (result.success) {
        this.logger.info('[ShoutoutService] Shoutout sent successfully');
      }
      return result;
    } catch (error) {
      this.logger.error('[ShoutoutService] Failed to send shoutout', error);
      return { success: false };
    }
  }

  /**
   * Reply to a shoutout (still a kind 24, with p tags for the original sender and all receivers)
   */
  async replyToShoutout(
    originalShoutout: Shoutout,
    content: string
  ): Promise<{ success: boolean; event?: Event }> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return { success: false };
    }

    // Include original sender and all receivers (except ourselves)
    const receivers = [originalShoutout.pubkey, ...originalShoutout.receivers]
      .filter(p => p !== pubkey && this.utilities.isValidPubkey(p));

    // Remove duplicates
    const uniqueReceivers = [...new Set(receivers)];

    return this.sendShoutout(content, uniqueReceivers);
  }

  /**
   * Refresh shoutouts by restarting subscription
   */
  refresh(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.startSubscription(pubkey);
    }
  }

  /**
   * Clear all shoutouts
   */
  clear(): void {
    this._shoutouts.set([]);
  }
}
