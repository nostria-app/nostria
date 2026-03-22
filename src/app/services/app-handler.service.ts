import { Injectable, inject, signal } from '@angular/core';
import { Event, nip19 } from 'nostr-tools';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';

/**
 * Parsed NIP-89 handler info (kind 31990).
 */
export interface AppHandler {
  /** The handler event itself */
  event: Event;
  /** Pubkey of the application / handler author */
  pubkey: string;
  /** Display name (from content metadata or kind:0 if unavailable) */
  name: string;
  /** Optional picture URL */
  picture?: string;
  /** URL template for web, keyed by NIP-19 entity type (e.g. 'nevent', 'nprofile', 'naddr') */
  webUrls: Map<string, string>;
  /** Supported event kinds */
  supportedKinds: number[];
}

/**
 * NIP-89 Recommended Application Handlers service.
 *
 * Discovers applications that can handle unknown event kinds by querying
 * for kind:31989 (recommendations) and kind:31990 (handler info) events.
 *
 * See: https://github.com/nostr-protocol/nips/blob/master/89.md
 */
@Injectable({
  providedIn: 'root',
})
export class AppHandlerService {
  private relayPool = inject(RelayPoolService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);

  /** Cache of handlers by event kind, keyed by kind number */
  private handlerCache = new Map<number, { handlers: AppHandler[]; expiresAt: number }>();
  private inflightRequests = new Map<number, Promise<AppHandler[]>>();

  /** TTL for cached handler lookups */
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Loading state per kind, exposed as a signal map for UI reactivity.
   */
  loadingKinds = signal<Set<number>>(new Set());

  /**
   * Discover app handlers for a given event kind.
   *
   * Strategy:
   * 1. Check cache
   * 2. Query kind:31990 from discovery relays filtered by #k tag
   * 3. Parse handler info from content + tags
   *
   * Per NIP-89, we could also query kind:31989 from the user's follows
   * to get recommendations, but we simplify by querying kind:31990 directly
   * from quality discovery/indexer relays.
   */
  async getHandlersForKind(kind: number): Promise<AppHandler[]> {
    // Check cache
    const cached = this.handlerCache.get(kind);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.handlers;
    }

    // Deduplicate inflight requests
    const inflight = this.inflightRequests.get(kind);
    if (inflight) {
      return inflight;
    }

    const promise = this.fetchHandlers(kind);
    this.inflightRequests.set(kind, promise);

    try {
      const handlers = await promise;
      this.handlerCache.set(kind, {
        handlers,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
      return handlers;
    } finally {
      this.inflightRequests.delete(kind);
    }
  }

  /**
   * Build a URL for opening an event in an external app handler.
   *
   * Replaces the `<bech32>` placeholder in the handler's URL template
   * with the appropriate NIP-19 encoding for the event.
   *
   * Handles common placeholder variants found in the wild:
   *   `<bech32>`, `<bech-32>`, and their URL-encoded forms.
   */
  buildHandlerUrl(handler: AppHandler, event: Event): string | null {
    const isAddressable = event.kind >= 30000 && event.kind < 40000;

    // For addressable events, prefer naddr over nevent
    if (isAddressable) {
      const naddrUrl = handler.webUrls.get('naddr');
      if (naddrUrl) {
        try {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? '';
          const encoded = nip19.naddrEncode({
            kind: event.kind,
            pubkey: event.pubkey,
            identifier: dTag,
          });
          return this.replaceBech32Placeholder(naddrUrl, encoded);
        } catch {
          // Fall through to nevent
        }
      }
    }

    // Try nevent (most common for regular events)
    const neventUrl = handler.webUrls.get('nevent');
    if (neventUrl) {
      try {
        const encoded = nip19.neventEncode({
          id: event.id,
          author: event.pubkey,
          kind: event.kind,
        });
        return this.replaceBech32Placeholder(neventUrl, encoded);
      } catch {
        // Fall through to other URL types
      }
    }

    // Try note (bare note id)
    const noteUrl = handler.webUrls.get('note');
    if (noteUrl) {
      try {
        const encoded = nip19.noteEncode(event.id);
        return this.replaceBech32Placeholder(noteUrl, encoded);
      } catch {
        // Fall through
      }
    }

    // Try generic URL (no second value in the tag array)
    const genericUrl = handler.webUrls.get('');
    if (genericUrl) {
      try {
        let encoded: string;
        if (isAddressable) {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? '';
          encoded = nip19.naddrEncode({
            kind: event.kind,
            pubkey: event.pubkey,
            identifier: dTag,
          });
        } else {
          encoded = nip19.neventEncode({
            id: event.id,
            author: event.pubkey,
            kind: event.kind,
          });
        }
        return this.replaceBech32Placeholder(genericUrl, encoded);
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Replace `<bech32>` placeholder variants in a URL template.
   *
   * Handler events in the wild use inconsistent placeholder formats:
   *   - `<bech32>` (per NIP-89 spec)
   *   - `<bech-32>` (common variant with hyphen)
   *   - URL-encoded forms: `%3Cbech32%3E`, `%3Cbech-32%3E`
   */
  private replaceBech32Placeholder(urlTemplate: string, encoded: string): string {
    return urlTemplate
      .replace(/%3Cbech-?32%3E/gi, encoded)
      .replace(/<bech-?32>/gi, encoded);
  }

  private async fetchHandlers(kind: number): Promise<AppHandler[]> {
    this.loadingKinds.update(set => {
      const next = new Set(set);
      next.add(kind);
      return next;
    });

    try {
      const relayUrls = this.discoveryRelay.getRelayUrls();
      if (relayUrls.length === 0) {
        this.logger.debug('[AppHandlerService] No discovery relays available');
        return [];
      }

      // Query kind:31990 events that handle this kind, limited to avoid spam
      const events = await this.relayPool.query(
        relayUrls,
        {
          kinds: [31990],
          '#k': [kind.toString()],
          limit: 20,
        },
        8000,
      );

      this.logger.debug(`[AppHandlerService] Found ${events.length} handler events for kind ${kind}`);

      const handlers: AppHandler[] = [];
      for (const event of events) {
        const handler = this.parseHandlerEvent(event);
        if (handler) {
          handlers.push(handler);
        }
      }

      // Deduplicate by pubkey (keep newest per pubkey)
      const byPubkey = new Map<string, AppHandler>();
      for (const h of handlers) {
        const existing = byPubkey.get(h.pubkey);
        if (!existing || h.event.created_at > existing.event.created_at) {
          byPubkey.set(h.pubkey, h);
        }
      }

      // Sort: prefer handlers from follows, then by recency
      const followingList = this.accountState.followingList();
      const followSet = new Set(followingList);

      return Array.from(byPubkey.values()).sort((a, b) => {
        const aFollow = followSet.has(a.pubkey) ? 1 : 0;
        const bFollow = followSet.has(b.pubkey) ? 1 : 0;
        if (aFollow !== bFollow) return bFollow - aFollow;
        return b.event.created_at - a.event.created_at;
      });
    } catch (error) {
      this.logger.warn(`[AppHandlerService] Failed to fetch handlers for kind ${kind}:`, error);
      return [];
    } finally {
      this.loadingKinds.update(set => {
        const next = new Set(set);
        next.delete(kind);
        return next;
      });
    }
  }

  private parseHandlerEvent(event: Event): AppHandler | null {
    // Extract web URLs from tags
    const webUrls = new Map<string, string>();
    for (const tag of event.tags) {
      if (tag[0] === 'web' && tag[1]) {
        // tag[2] is the NIP-19 entity type (e.g. 'nevent', 'nprofile', 'naddr')
        // If absent, it's a generic handler
        const entityType = tag[2] ?? '';
        webUrls.set(entityType, tag[1]);
      }
    }

    // Must have at least one web URL to be useful
    if (webUrls.size === 0) {
      return null;
    }

    // Extract supported kinds from k tags
    const supportedKinds = event.tags
      .filter(t => t[0] === 'k' && t[1])
      .map(t => parseInt(t[1], 10))
      .filter(k => !isNaN(k));

    // Parse optional metadata from content (kind:0-style JSON)
    let name = '';
    let picture: string | undefined;

    if (event.content) {
      try {
        const meta = JSON.parse(event.content);
        name = meta.name || meta.display_name || '';
        picture = meta.picture || meta.image || undefined;
      } catch {
        // Content is not JSON metadata, that's fine per spec
      }
    }

    // Fall back to pubkey-based display if no name
    if (!name) {
      try {
        const npub = nip19.npubEncode(event.pubkey);
        name = npub.slice(0, 12) + '...';
      } catch {
        name = event.pubkey.slice(0, 8) + '...';
      }
    }

    return {
      event,
      pubkey: event.pubkey,
      name,
      picture,
      webUrls,
      supportedKinds,
    };
  }
}
