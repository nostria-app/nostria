import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { EncryptionService } from './encryption.service';
import { NostrService } from './nostr.service';
import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools';

/**
 * Represents a single NIP-85 Trusted Service Provider declaration.
 * Each entry maps a specific assertion kind + metric tag to a provider pubkey and relay URL.
 *
 * Tag format in kind 10040 event: ["30382:rank", "<provider_pubkey>", "<relay_url>"]
 */
export interface TrustProvider {
  /** The assertion kind and metric tag combined, e.g. "30382:rank" */
  kindTag: string;
  /** Provider's pubkey */
  pubkey: string;
  /** Relay URL where the provider publishes results */
  relayUrl: string;
}

/** Known NIP-85 service providers for easy preset selection */
export interface KnownProvider {
  name: string;
  description: string;
  pubkey: string;
  relayUrl: string;
  /** Supported kind:tag combinations */
  supportedMetrics: string[];
  /** URL for activation / more info */
  activationUrl?: string;
}

/** The kind number for Trusted Service Provider declarations (NIP-85) */
export const TRUST_PROVIDER_LIST_KIND = 10040;

/**
 * Known NIP-85 service providers.
 * Users can add these as presets or configure custom providers.
 */
export const KNOWN_PROVIDERS: KnownProvider[] = [
  {
    name: 'Brainstorm',
    description: 'Calculates reputation scores based on your social connections',
    pubkey: '3d842afecd5e293f28b6627933704a3fb8ce153aa91d790ab11f6a752d44a42d',
    relayUrl: 'wss://nip85.brainstorm.world',
    supportedMetrics: [
      '30382:rank',
      '30382:followers',
      '30382:post_cnt',
      '30382:zap_amt_recd',
      '30382:zap_amt_sent',
      '30382:first_created_at',
      '30382:reply_cnt',
      '30382:reactions_cnt',
      '30382:zap_cnt_recd',
      '30382:zap_cnt_sent',
    ],
    activationUrl: 'https://straycat.brainstorm.social/',
  },
];

/**
 * Service for managing NIP-85 kind 10040 Trusted Service Provider declarations.
 *
 * This service handles:
 * - Loading the user's kind 10040 event (public tags + NIP-44 encrypted content)
 * - Parsing provider declarations from both public and private sections
 * - Publishing updated kind 10040 events when the user modifies their provider list
 * - Resolving which provider/relay to query for a given assertion kind + metric
 */
@Injectable({
  providedIn: 'root',
})
export class TrustProviderService {
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private database = inject(DatabaseService);
  private encryption = inject(EncryptionService);
  private nostrService = inject(NostrService);

  /** Public provider declarations (visible in event tags) */
  readonly publicProviders = signal<TrustProvider[]>([]);

  /** Private provider declarations (NIP-44 encrypted in event content) */
  readonly privateProviders = signal<TrustProvider[]>([]);

  /** All providers combined (public + private) */
  readonly allProviders = computed(() => [...this.publicProviders(), ...this.privateProviders()]);

  /** Whether the provider list has been loaded from the relay/database */
  readonly loaded = signal(false);

  /** Whether a publish operation is in progress */
  readonly isPublishing = signal(false);

  /** Whether a kind 10040 event exists for this account (regardless of parsing) */
  readonly hasEvent = signal(false);

  /** Whether any providers are configured (public or private) */
  readonly hasProviders = computed(() => this.allProviders().length > 0);

  /** Whether Brainstorm is configured for 30382:rank (by relay URL match) */
  readonly hasBrainstormRank = computed(() => {
    const brainstormRelay = 'wss://nip85.brainstorm.world';
    return this.allProviders().some(
      p => p.relayUrl === brainstormRelay && p.kindTag === '30382:rank'
    );
  });

  /** The raw kind 10040 event, if found */
  private currentEvent: NostrEvent | null = null;

  /** Track the current account pubkey to detect account switches */
  private currentAccountPubkey: string | null = null;

  constructor() {
    this.logger.info('TrustProviderService initialized');

    // Clear and reload when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey !== this.currentAccountPubkey) {
        this.currentAccountPubkey = pubkey;
        this.clear();
        if (pubkey) {
          this.loadProviders(pubkey);
        }
      }
    });
  }

  /**
   * Load the user's kind 10040 event and parse providers.
   * Called on login when the metadata subscription receives the event,
   * or manually from the trust settings page.
   */
  async loadProviders(pubkey?: string): Promise<void> {
    const userPubkey = pubkey || this.accountState.pubkey();
    if (!userPubkey) {
      this.logger.warn('Cannot load trust providers: no active account');
      return;
    }

    try {
      // Try database first, then relay
      const event = await this.database.getEventByPubkeyAndKind(userPubkey, TRUST_PROVIDER_LIST_KIND);
      if (event) {
        await this.parseProviderEvent(event);
        this.logger.info('Loaded trust providers from database', {
          publicCount: this.publicProviders().length,
          privateCount: this.privateProviders().length,
        });
      } else {
        this.logger.debug('No kind 10040 event found for user');
        this.publicProviders.set([]);
        this.privateProviders.set([]);
      }
    } catch (error) {
      this.logger.error('Failed to load trust providers', error);
    } finally {
      this.loaded.set(true);
    }
  }

  /**
   * Load providers from an already-fetched event (e.g., from the metadata subscription).
   */
  async loadFromEvent(event: NostrEvent): Promise<void> {
    this.currentEvent = event;

    // Save to database for future local access
    try {
      await this.database.saveEvent(event);
    } catch (error) {
      this.logger.warn('Failed to save kind 10040 event to database', error);
    }

    await this.parseProviderEvent(event);
    this.loaded.set(true);

    this.logger.info('Loaded trust providers from event', {
      publicCount: this.publicProviders().length,
      privateCount: this.privateProviders().length,
    });
  }

  /**
   * Parse a kind 10040 event into public and private provider lists.
   */
  private async parseProviderEvent(event: NostrEvent): Promise<void> {
    this.currentEvent = event;
    this.hasEvent.set(true);

    // Parse public providers from tags
    const publicProviders = this.parseProviderTags(event.tags);
    this.publicProviders.set(publicProviders);

    // Parse private providers from encrypted content
    if (event.content && event.content.trim() !== '') {
      try {
        const decrypted = await this.encryption.decryptNip44(
          event.content,
          event.pubkey /* self-decryption */,
        );
        const privateTags: string[][] = JSON.parse(decrypted);
        const privateProviders = this.parseProviderTags(privateTags);
        this.privateProviders.set(privateProviders);
      } catch (error) {
        this.logger.error('Failed to decrypt private trust providers', error);
        this.privateProviders.set([]);
      }
    } else {
      this.privateProviders.set([]);
    }
  }

  /**
   * Parse provider tags from tag array.
   * Each tag is in the format: ["30382:rank", "<pubkey>", "<relay_url>"]
   */
  parseProviderTags(tags: string[][]): TrustProvider[] {
    const providers: TrustProvider[] = [];

    for (const tag of tags) {
      // Must have at least 3 elements and the first element must contain a colon (kind:metric format)
      if (tag.length >= 3 && tag[0].includes(':')) {
        const kindTag = tag[0];
        const pubkey = tag[1];
        const relayUrl = tag[2];

        // Validate the kind:tag format (e.g., "30382:rank")
        const [kindStr] = kindTag.split(':');
        const kindNum = parseInt(kindStr, 10);
        if (!isNaN(kindNum) && pubkey && relayUrl) {
          providers.push({ kindTag, pubkey, relayUrl });
        }
      }
    }

    return providers;
  }

  /**
   * Get providers for a specific assertion kind and metric tag.
   * Returns all configured providers for the given kind:tag combination.
   *
   * @param assertionKind The assertion event kind (e.g., 30382)
   * @param metricTag The metric tag name (e.g., "rank")
   * @returns Array of providers, or empty if none configured
   */
  getProvidersForMetric(assertionKind: number, metricTag: string): TrustProvider[] {
    const kindTag = `${assertionKind}:${metricTag}`;
    return this.allProviders().filter(p => p.kindTag === kindTag);
  }

  /**
   * Get all unique relay URLs configured for a specific assertion kind.
   * Useful when you want to query all configured relays for a given kind
   * regardless of the specific metric.
   *
   * @param assertionKind The assertion event kind (e.g., 30382)
   * @returns Array of unique relay URLs
   */
  getRelayUrlsForKind(assertionKind: number): string[] {
    const prefix = `${assertionKind}:`;
    const relayUrls = new Set<string>();
    for (const provider of this.allProviders()) {
      if (provider.kindTag.startsWith(prefix)) {
        relayUrls.add(provider.relayUrl);
      }
    }
    return [...relayUrls];
  }

  /**
   * Get unique relay URLs and author pubkeys for a specific assertion kind.
   * The author pubkeys are the providers that publish kind 30382 events,
   * so queries should filter by these authors to only get trusted results.
   *
   * @param assertionKind The assertion event kind (e.g., 30382)
   * @returns Object with unique relay URLs and author pubkeys
   */
  getProviderConfigForKind(assertionKind: number): { relayUrls: string[]; authors: string[] } {
    const prefix = `${assertionKind}:`;
    const relayUrls = new Set<string>();
    const authors = new Set<string>();
    for (const provider of this.allProviders()) {
      if (provider.kindTag.startsWith(prefix)) {
        relayUrls.add(provider.relayUrl);
        authors.add(provider.pubkey);
      }
    }
    return { relayUrls: [...relayUrls], authors: [...authors] };
  }

  /**
   * Add a provider to the public or private list.
   * Does NOT automatically publish — call publishProviders() after making changes.
   */
  addProvider(provider: TrustProvider, isPrivate: boolean): void {
    if (isPrivate) {
      this.privateProviders.update(list => [...list, provider]);
    } else {
      this.publicProviders.update(list => [...list, provider]);
    }
  }

  /**
   * Remove a provider by kindTag and pubkey from both public and private lists.
   * Does NOT automatically publish — call publishProviders() after making changes.
   */
  removeProvider(kindTag: string, pubkey: string): void {
    this.publicProviders.update(list =>
      list.filter(p => !(p.kindTag === kindTag && p.pubkey === pubkey))
    );
    this.privateProviders.update(list =>
      list.filter(p => !(p.kindTag === kindTag && p.pubkey === pubkey))
    );
  }

  /**
   * Add all supported metrics from a known provider preset.
   * Does NOT automatically publish — call publishProviders() after making changes.
   */
  addKnownProvider(knownProvider: KnownProvider, isPrivate: boolean): void {
    for (const metric of knownProvider.supportedMetrics) {
      const existing = this.allProviders().find(
        p => p.kindTag === metric && p.pubkey === knownProvider.pubkey
      );
      if (!existing) {
        this.addProvider(
          {
            kindTag: metric,
            pubkey: knownProvider.pubkey,
            relayUrl: knownProvider.relayUrl,
          },
          isPrivate,
        );
      }
    }
  }

  /**
   * Remove all metrics from a known provider.
   * Matches by relay URL since provider pubkeys can vary per algorithm.
   * Does NOT automatically publish — call publishProviders() after making changes.
   */
  removeKnownProvider(knownProvider: KnownProvider): void {
    this.publicProviders.update(list =>
      list.filter(p => p.relayUrl !== knownProvider.relayUrl)
    );
    this.privateProviders.update(list =>
      list.filter(p => p.relayUrl !== knownProvider.relayUrl)
    );
  }

  /**
   * Check if a known provider is currently configured.
   * Matches by relay URL since provider pubkeys can vary per algorithm.
   */
  isKnownProviderConfigured(knownProvider: KnownProvider): boolean {
    return this.allProviders().some(p => p.relayUrl === knownProvider.relayUrl);
  }

  /**
   * Check if a known provider is configured as private.
   * Matches by relay URL since provider pubkeys can vary per algorithm.
   */
  isKnownProviderPrivate(knownProvider: KnownProvider): boolean {
    return this.privateProviders().some(p => p.relayUrl === knownProvider.relayUrl);
  }

  /**
   * Publish the current provider configuration as a kind 10040 event.
   * Public providers go in the event tags, private providers are NIP-44 encrypted in content.
   */
  async publishProviders(): Promise<{ success: boolean; error?: string }> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return { success: false, error: 'No active account' };
    }

    this.isPublishing.set(true);

    try {
      // Build public tags
      const tags: string[][] = this.publicProviders().map(p => [p.kindTag, p.pubkey, p.relayUrl]);

      // Build encrypted content for private providers
      let content = '';
      const privProviders = this.privateProviders();
      if (privProviders.length > 0) {
        const privateTags = privProviders.map(p => [p.kindTag, p.pubkey, p.relayUrl]);
        const jsonContent = JSON.stringify(privateTags);
        content = await this.encryption.encryptNip44(jsonContent, pubkey /* self-encryption */);
      }

      const event: UnsignedEvent = this.nostrService.createEvent(
        TRUST_PROVIDER_LIST_KIND,
        content,
        tags,
      );

      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.logger.info('Published kind 10040 trust provider list', {
          publicCount: this.publicProviders().length,
          privateCount: privProviders.length,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to publish trust provider list', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    } finally {
      this.isPublishing.set(false);
    }
  }

  /**
   * Clear all provider state (e.g., on logout).
   */
  clear(): void {
    this.publicProviders.set([]);
    this.privateProviders.set([]);
    this.loaded.set(false);
    this.hasEvent.set(false);
    this.currentEvent = null;
  }
}
