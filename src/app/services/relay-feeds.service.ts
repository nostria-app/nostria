import { Injectable, inject, signal } from '@angular/core';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { AccountStateService } from './account-state.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';

/**
 * Kind 10012: Relay feeds - stores browsable relay feeds
 * Tags:
 * - "relay" (relay URLs) - direct relay references
 * - "a" (kind:30002 relay set) - references to relay sets
 * 
 * Kind 30002: Relay set - stores a set of relays
 * Tags:
 * - "relay" (relay URLs) - relay URLs in the set
 * - "d" (identifier) - unique identifier for the set
 */
const RELAY_FEEDS_KIND = 10012;
const RELAY_SET_KIND = 30002;

const DEFAULT_RELAYS: string[] = [
  'trending.relays.land',
  'nostrelites.org',
  'wot.nostr.net',
  'wotr.relatr.xyz',
  'primus.nostr1.com',
  'nostr.land',
  'nos.lol',
  'nostr.wine',
  'news.utxo.one',
  '140.f7z.io',
  'pyramid.fiatjaf.com',
  'relay.damus.io',
  'relay.primal.net',
  'nostr21.com',
  'ribo.eu.nostria.app',
  'ribo.us.nostria.app',
];

export interface RelaySet {
  identifier: string; // d-tag
  name: string;
  description?: string;
  relays: string[];
  eventId: string;
  created_at: number;
}

@Injectable({
  providedIn: 'root',
})
export class RelayFeedsService {
  private logger = inject(LoggerService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private publishService = inject(PublishService);
  private accountRelay = inject(AccountRelayService);

  // Current relay feeds (direct relay URLs)
  relayFeeds = signal<string[]>([]);

  // Whether the relay feeds have been loaded from kind 10012
  isLoaded = signal(false);

  /**
   * Get relay feeds for the current user
   * Returns default relays if no kind 10012 event exists
   */
  async getRelayFeeds(pubkey: string): Promise<string[]> {
    try {
      // Try to get from database first
      const event = await this.database.getEventByPubkeyAndKind(pubkey, RELAY_FEEDS_KIND);

      if (event) {
        this.logger.debug('Found kind 10012 relay feeds event');
        const relays = event.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => this.normalizeRelayUrl(tag[1]));

        this.relayFeeds.set(relays);
        this.isLoaded.set(true);
        return relays;
      }

      // If no event exists, try to query from relays
      const relayEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, RELAY_FEEDS_KIND);

      if (relayEvent) {
        this.logger.debug('Found kind 10012 relay feeds event from relays');
        await this.database.saveEvent(relayEvent);

        const relays = relayEvent.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => this.normalizeRelayUrl(tag[1]));

        this.relayFeeds.set(relays);
        this.isLoaded.set(true);
        return relays;
      }

      // No event found, return defaults
      this.logger.debug('No kind 10012 relay feeds event found, using defaults');
      this.relayFeeds.set([...DEFAULT_RELAYS]);
      this.isLoaded.set(true);
      return [...DEFAULT_RELAYS];
    } catch (error) {
      this.logger.error('Error loading relay feeds:', error);
      this.relayFeeds.set([...DEFAULT_RELAYS]);
      this.isLoaded.set(true);
      return [...DEFAULT_RELAYS];
    }
  }

  /**
   * Save relay feeds to kind 10012 event and publish
   */
  async saveRelayFeeds(relays: string[]): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Normalize all relay URLs
      const normalizedRelays = relays.map(r => this.normalizeRelayUrl(r));

      // Create tags for kind 10012
      const tags: string[][] = normalizedRelays.map(relay => ['relay', relay]);

      // Create the event
      const event = this.nostrService.createEvent(RELAY_FEEDS_KIND, '', tags);

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(event);

      // Save to database immediately
      await this.database.saveEvent(signedEvent);

      // Update signal
      this.relayFeeds.set(normalizedRelays);

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to all account relays
      });

      this.logger.debug('Relay feeds published:', {
        success: result.success,
        relayCount: normalizedRelays.length,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving relay feeds:', error);
      return false;
    }
  }

  /**
   * Add a relay to the feeds
   */
  async addRelay(relayUrl: string): Promise<boolean> {
    const normalized = this.normalizeRelayUrl(relayUrl);
    const current = this.relayFeeds();

    if (current.includes(normalized)) {
      this.logger.debug('Relay already in feeds:', normalized);
      return true;
    }

    const updated = [...current, normalized];
    return this.saveRelayFeeds(updated);
  }

  /**
   * Remove a relay from the feeds
   */
  async removeRelay(relayUrl: string): Promise<boolean> {
    const normalized = this.normalizeRelayUrl(relayUrl);
    const current = this.relayFeeds();
    const updated = current.filter(r => r !== normalized);

    if (updated.length === current.length) {
      this.logger.debug('Relay not found in feeds:', normalized);
      return true;
    }

    return this.saveRelayFeeds(updated);
  }

  /**
   * Reset to default relays
   */
  async resetToDefaults(): Promise<boolean> {
    return this.saveRelayFeeds([...DEFAULT_RELAYS]);
  }

  /**
   * Get relay sets for the current user (kind 30002)
   */
  async getRelaySets(pubkey: string): Promise<RelaySet[]> {
    try {
      // Query for all kind 30002 events
      const events = await this.accountRelay.getEventsByPubkeyAndKind(pubkey, RELAY_SET_KIND);

      const sets: RelaySet[] = [];

      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
        if (!dTag) continue;

        const name = event.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')?.[1] || dTag;
        const description = event.tags.find(tag => tag[0] === 'description')?.[1];
        const relays = event.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => this.normalizeRelayUrl(tag[1]));

        sets.push({
          identifier: dTag,
          name,
          description,
          relays,
          eventId: event.id,
          created_at: event.created_at,
        });
      }

      return sets;
    } catch (error) {
      this.logger.error('Error loading relay sets:', error);
      return [];
    }
  }

  /**
   * Create or update a relay set (kind 30002)
   */
  async saveRelaySet(identifier: string, name: string, relays: string[], description?: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Normalize all relay URLs
      const normalizedRelays = relays.map(r => this.normalizeRelayUrl(r));

      // Create tags for kind 30002
      const tags: string[][] = [
        ['d', identifier],
        ['title', name],
      ];

      if (description) {
        tags.push(['description', description]);
      }

      // Add relay tags
      tags.push(...normalizedRelays.map(relay => ['relay', relay]));

      // Create the event
      const event = this.nostrService.createEvent(RELAY_SET_KIND, '', tags);

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(event);

      // Save to database
      await this.database.saveEvent(signedEvent);

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      this.logger.debug('Relay set published:', {
        success: result.success,
        identifier,
        relayCount: normalizedRelays.length,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error saving relay set:', error);
      return false;
    }
  }

  /**
   * Delete a relay set (kind 30002) by publishing a deletion event
   */
  async deleteRelaySet(identifier: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('No authenticated user');
      return false;
    }

    try {
      // Create a deletion event (kind 5) targeting the relay set
      const tags: string[][] = [
        ['a', `${RELAY_SET_KIND}:${pubkey}:${identifier}`],
      ];

      const event = this.nostrService.createEvent(kinds.EventDeletion, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveEvent(signedEvent);

      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      this.logger.debug('Relay set deletion published:', {
        success: result.success,
        identifier,
      });

      return result.success;
    } catch (error) {
      this.logger.error('Error deleting relay set:', error);
      return false;
    }
  }

  /**
   * Normalize relay URL (ensure wss:// protocol and no trailing slash)
   */
  private normalizeRelayUrl(url: string): string {
    let normalized = url.trim();

    // Add wss:// if missing
    if (!normalized.startsWith('wss://') && !normalized.startsWith('ws://')) {
      normalized = `wss://${normalized}`;
    }

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    return normalized;
  }

  /**
   * Get default relays
   */
  getDefaultRelays(): string[] {
    return [...DEFAULT_RELAYS];
  }
}
