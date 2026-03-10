import { Injectable, inject, signal, NgZone } from '@angular/core';
import { SimplePool, Event, Filter, kinds, nip19 } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { RelaysService } from './relays/relays';

/** Response item from the Angor mainnet indexer REST API */
interface IndexerProject {
  founderKey: string;
  nostrEventId: string;
  projectIdentifier: string;
  createdOnBlock: number;
  trxId: string;
}

/** Parsed content of a kind 3030 Angor project event */
export interface AngorProjectDetails {
  founderKey: string;
  founderRecoveryKey: string;
  projectIdentifier: string;
  nostrPubKey: string;
  startDate: number;
  endDate: number;
  penaltyDays: number;
  expiryDate: number;
  targetAmount: number;
  stages: { amountToRelease: number; releaseDate: number }[];
  projectSeeders: { threshold: number; secretHashes: string[] }[];
}

/** Kind 0 metadata for a project's Nostr identity */
export interface AngorProjectMetadata {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}

/** Combined Angor project — indexer data + Nostr event data + fetched metadata */
export interface AngorProject {
  eventId: string;
  pubkey: string;
  nostrPubKey: string;
  metadataPubkey?: string;
  projectIdentifier: string;
  targetAmount: number;
  startDate: number;
  endDate: number;
  createdAt: number;
  metadata?: AngorProjectMetadata;
}

@Injectable({
  providedIn: 'root',
})
export class AngorService {
  private logger = inject(LoggerService);
  private zone = inject(NgZone);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private relaysService = inject(RelaysService);

  /**
   * Angor mainnet indexer endpoints — tried in order until one succeeds.
   */
  private readonly INDEXERS = [
    'https://mempool.angor.io/',
    'https://fulcrum.angor.online/',
    'https://electrs.angor.online/',
    'https://explorer.angor.io/',
  ];

  /**
   * Angor metadata relay-set constants (NIP-65 relay set: kind 30002).
   */
  private readonly RELAY_SET_KIND = kinds.Relaysets;
  private readonly ANGOR_RELAY_SET_D_TAG = 'angor';

  /**
   * Default relays for Angor project + metadata discovery.
   * relay.angor.io stays first to make it the primary metadata source.
   */
  readonly ANGOR_DEFAULT_RELAYS = ['wss://relay.angor.io', 'wss://relay2.angor.io'];

  readonly ANGOR_PROJECT_KIND = 3030;
  private readonly DEFAULT_BATCH_SIZE = 20;

  private pool: SimplePool | null = null;

  /** Cache the newest kind 0 metadata per pubkey to avoid refetching. */
  private readonly metadataCache = new Map<string, { createdAt: number; metadata: AngorProjectMetadata }>();

  /** Reactive signal */
  readonly angorProjects = signal<AngorProject[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(true);
  readonly error = signal<string | null>(null);

  private projectsLoaded = false;
  private currentLimit = 0;
  private lastIndexerCount = 0;

  private getPool(): SimplePool {
    if (!this.pool) {
      this.pool = new SimplePool();
    }
    return this.pool;
  }

  /**
   * Load Angor projects.
   */
  async loadAngorProjects(limit = this.DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.loading() || this.loadingMore()) return;

    const nextLimit = Math.max(limit, this.currentLimit || this.DEFAULT_BATCH_SIZE);
    const isLoadMore = this.projectsLoaded && nextLimit > this.currentLimit;
    if (this.projectsLoaded && !isLoadMore) return;
    if (isLoadMore && !this.hasMore()) return;

    if (isLoadMore) {
      this.loadingMore.set(true);
    } else {
      this.loading.set(true);
    }
    this.error.set(null);

    try {
      //project list 

      const indexedProjects = await this.fetchIndexerProjects(nextLimit);
      if (indexedProjects.length === 0) {
        this.hasMore.set(false);
        return;
      }

      const pool = this.getPool();
      const targetRelays = await this.resolveAngorRelays();
      const eventIds = indexedProjects.map(p => p.nostrEventId).filter(Boolean);

      // maxWait prevents the query from hanging if a relay is slow
      const kind3030Events = await pool.querySync(
        targetRelays,
        { kinds: [this.ANGOR_PROJECT_KIND], ids: eventIds },
        { maxWait: 8000 },
      );

      this.logger.info('AngorService: fetched', kind3030Events.length, 'kind 3030 events');

      const projectMap = new Map<string, AngorProject>();

      for (const event of kind3030Events) {
        let details: AngorProjectDetails;
        try {
          details = JSON.parse(event.content) as AngorProjectDetails;
        } catch {
          continue;
        }
        if (!details.projectIdentifier || !details.nostrPubKey) continue;

        const metadataPubkey = this.normalizePubkey(details.nostrPubKey) || this.normalizePubkey(event.pubkey);

        const existing = projectMap.get(details.projectIdentifier);
        if (existing && existing.createdAt >= event.created_at) continue;

        projectMap.set(details.projectIdentifier, {
          eventId: event.id,
          pubkey: event.pubkey,
          nostrPubKey: details.nostrPubKey,
          metadataPubkey: metadataPubkey || undefined,
          projectIdentifier: details.projectIdentifier,
          targetAmount: details.targetAmount ?? 0,
          startDate: details.startDate ?? 0,
          endDate: details.endDate ?? 0,
          createdAt: event.created_at,
        });
      }

      // Fallback: projects whose kind 3030 events aren't on the relay yet.
      for (const indexed of indexedProjects) {
        if (!projectMap.has(indexed.projectIdentifier)) {
          const fallbackPubkey = this.normalizePubkey(indexed.founderKey);

          projectMap.set(indexed.projectIdentifier, {
            eventId: indexed.nostrEventId,
            pubkey: indexed.founderKey,
            nostrPubKey: indexed.founderKey,
            metadataPubkey: fallbackPubkey || undefined,
            projectIdentifier: indexed.projectIdentifier,
            targetAmount: 0,
            startDate: 0,
            endDate: 0,
            createdAt: 0,
          });
        }
      }

      const projects = this.applyCachedMetadata(Array.from(projectMap.values()));
      projects.sort((a, b) => b.createdAt - a.createdAt);

      const previousIndexerCount = this.lastIndexerCount;
      this.lastIndexerCount = indexedProjects.length;
      this.currentLimit = nextLimit;

      // If increasing limit doesn't return more rows, we've reached the end.
      if (indexedProjects.length < nextLimit || (isLoadMore && indexedProjects.length <= previousIndexerCount)) {
        this.hasMore.set(false);
      } else {
        this.hasMore.set(true);
      }

      // Publish basic project data immediately 
      this.zone.run(() => this.angorProjects.set(projects));
      this.projectsLoaded = true;

      // metadata runs in background, updates signal when done
      void this.fetchMetadata(projects, pool, targetRelays);
    } catch (err) {
      this.logger.error('AngorService: failed to load projects', err);
      this.zone.run(() => this.error.set('Failed to load Angor projects'));
    } finally {
      this.zone.run(() => {
        this.loading.set(false);
        this.loadingMore.set(false);
      });
    }
  }

  /** Load the next page worth of Angor projects by increasing the API limit. */
  async loadMoreAngorProjects(batchSize = this.DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.loading() || this.loadingMore() || !this.hasMore()) return;

    const nextLimit = (this.currentLimit || batchSize) + batchSize;
    await this.loadAngorProjects(nextLimit);
  }


  private async fetchMetadata(projects: AngorProject[], pool: SimplePool, relays: string[]): Promise<void> {
    const metadataPubkeys = [
      ...new Set(
        projects
          .map(p => p.metadataPubkey || this.normalizePubkey(p.nostrPubKey))
          .filter((pubkey): pubkey is string => !!pubkey),
      ),
    ];
    if (metadataPubkeys.length === 0) return;

    const uncachedPubkeys = metadataPubkeys.filter(pubkey => !this.metadataCache.has(pubkey));
    if (uncachedPubkeys.length === 0) {
      this.applyMetadataFromCache();
      return;
    }

    this.logger.info(
      'AngorService: fetching kind 0 metadata for',
      uncachedPubkeys.length,
      'pubkeys from',
      relays.length,
      'relays'
    );

    try {
      const metaEvents: Event[] = [];

      // Split author filters into chunks to keep queries efficient as the list grows.
      const chunkSize = 80;
      for (let i = 0; i < uncachedPubkeys.length; i += chunkSize) {
        const authors = uncachedPubkeys.slice(i, i + chunkSize);
        const filter: Filter = { kinds: [0], authors };
        const chunkEvents = await pool.querySync(relays, filter, { maxWait: 6000 });
        metaEvents.push(...chunkEvents);
      }

      this.logger.info('AngorService: received', metaEvents.length, 'metadata events');

      if (metaEvents.length === 0) {
        this.applyMetadataFromCache();
        return;
      }

      // Keep only the newest kind 0 per pubkey
      const metaMap = new Map<string, { event: Event; metadata: AngorProjectMetadata }>();
      for (const event of metaEvents) {
        let metadata: AngorProjectMetadata;
        try {
          metadata = JSON.parse(event.content) as AngorProjectMetadata;
        } catch {
          continue;
        }
        const normalizedPubkey = this.normalizePubkey(event.pubkey) || event.pubkey;
        const existing = metaMap.get(normalizedPubkey);
        if (!existing || event.created_at > existing.event.created_at) {
          metaMap.set(normalizedPubkey, { event, metadata });
        }
      }

      for (const [pubkey, entry] of metaMap.entries()) {
        this.metadataCache.set(pubkey, {
          createdAt: entry.event.created_at,
          metadata: entry.metadata,
        });
      }

      this.applyMetadataFromCache();
      this.logger.info('AngorService: applied metadata cache entries for', metaMap.size, 'pubkeys');
    } catch (err) {
      this.logger.warn('AngorService: metadata fetch failed', err);
    }
  }

  private applyCachedMetadata(projects: AngorProject[]): AngorProject[] {
    return projects.map(project => {
      const metadataPubkey = project.metadataPubkey || this.normalizePubkey(project.nostrPubKey);
      if (!metadataPubkey) return project;

      const cached = this.metadataCache.get(metadataPubkey);
      if (!cached) return project;

      return {
        ...project,
        metadata: cached.metadata,
      };
    });
  }

  private applyMetadataFromCache(): void {
    this.zone.run(() => {
      this.angorProjects.update(list => this.applyCachedMetadata(list));
    });
  }

  private async resolveAngorRelays(): Promise<string[]> {
    const defaultRelays = this.ANGOR_DEFAULT_RELAYS;
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return defaultRelays;
    }

    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        this.RELAY_SET_KIND,
        this.ANGOR_RELAY_SET_D_TAG,
      );

      let relayEvent = cachedEvent;
      const accountRelays = this.accountRelay.getRelayUrls();
      const queryRelays = this.relaysService.getOptimalRelays(accountRelays);

      if (queryRelays.length > 0) {
        const latest = await this.getLatestRelaySetFromRelays(queryRelays, pubkey);
        if (latest && (!relayEvent || latest.created_at > relayEvent.created_at)) {
          relayEvent = latest;
          const dTag = latest.tags.find(tag => tag[0] === 'd')?.[1];
          await this.database.saveEvent({ ...latest, dTag });
        }
      }

      const customRelays = relayEvent
        ? relayEvent.tags
          .filter(tag => tag[0] === 'relay' && !!tag[1])
          .map(tag => tag[1])
        : [];

      const merged = [...new Set([defaultRelays[0], ...customRelays, ...defaultRelays])];
      return merged.filter(Boolean);
    } catch (err) {
      this.logger.warn('AngorService: failed to resolve Angor relay set, using defaults', err);
      return defaultRelays;
    }
  }

  private async getLatestRelaySetFromRelays(relayUrls: string[], pubkey: string): Promise<Event | null> {
    const pool = this.getPool();
    const filter: Filter = {
      kinds: [this.RELAY_SET_KIND],
      authors: [pubkey],
      '#d': [this.ANGOR_RELAY_SET_D_TAG],
      limit: 1,
    };

    try {
      const events = await pool.querySync(relayUrls, filter, { maxWait: 3000 });
      if (!events.length) return null;

      return events.sort((a, b) => b.created_at - a.created_at)[0];
    } catch {
      return null;
    }
  }

  private normalizePubkey(pubkey: string | undefined | null): string | null {
    if (!pubkey) return null;

    if (/^[0-9a-f]{64}$/i.test(pubkey)) {
      return pubkey.toLowerCase();
    }

    try {
      const decoded = nip19.decode(pubkey);
      if (decoded.type === 'npub' && typeof decoded.data === 'string') {
        return decoded.data.toLowerCase();
      }
      if (decoded.type === 'nprofile' && decoded.data && typeof decoded.data.pubkey === 'string') {
        return decoded.data.pubkey.toLowerCase();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Try each indexer in order, returning the first successful response.
   */
  private async fetchIndexerProjects(limit: number): Promise<IndexerProject[]> {
    const errors: string[] = [];

    for (const base of this.INDEXERS) {
      const url = `${base}api/query/Angor/projects?limit=${limit}`;
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          this.logger.info('AngorService: loaded', data.length, 'projects from', base);
          return data as IndexerProject[];
        }
        throw new Error('Unexpected response shape');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`AngorService: indexer ${base} failed —`, msg);
        errors.push(`${base}: ${msg}`);
      }
    }

    throw new Error(`All indexers failed:\n${errors.join('\n')}`);
  }

  /** Reset state so the next call to loadAngorProjects() re-fetches everything. */
  clearCache(): void {
    this.projectsLoaded = false;
    this.currentLimit = 0;
    this.lastIndexerCount = 0;
    this.loadingMore.set(false);
    this.hasMore.set(true);
    this.zone.run(() => this.angorProjects.set([]));
  }
}
