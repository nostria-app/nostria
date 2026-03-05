import { Injectable, inject, signal, NgZone } from '@angular/core';
import { SimplePool, Event } from 'nostr-tools';
import { LoggerService } from './logger.service';

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
   * Angor-specific relays.
   */
  readonly ANGOR_RELAYS = ['wss://relay.angor.io', 'wss://relay2.angor.io'];

  readonly ANGOR_PROJECT_KIND = 3030;

  private pool: SimplePool | null = null;

  /** Reactive signal */
  readonly angorProjects = signal<AngorProject[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private projectsLoaded = false;

  private getPool(): SimplePool {
    if (!this.pool) {
      this.pool = new SimplePool();
    }
    return this.pool;
  }

  /**
   * Load Angor projects.
   */
  async loadAngorProjects(limit = 20): Promise<void> {
    if (this.loading() || this.projectsLoaded) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      //project list 

      const indexedProjects = await this.fetchIndexerProjects(limit);
      if (indexedProjects.length === 0) return;

      const pool = this.getPool();
      const eventIds = indexedProjects.map(p => p.nostrEventId).filter(Boolean);

      // maxWait prevents the query from hanging if a relay is slow
      const kind3030Events = await pool.querySync(
        this.ANGOR_RELAYS,
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

        const existing = projectMap.get(details.projectIdentifier);
        if (existing && existing.createdAt >= event.created_at) continue;

        projectMap.set(details.projectIdentifier, {
          eventId: event.id,
          pubkey: event.pubkey,
          nostrPubKey: details.nostrPubKey,
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
          projectMap.set(indexed.projectIdentifier, {
            eventId: indexed.nostrEventId,
            pubkey: indexed.founderKey,
            nostrPubKey: indexed.founderKey,
            projectIdentifier: indexed.projectIdentifier,
            targetAmount: 0,
            startDate: 0,
            endDate: 0,
            createdAt: 0,
          });
        }
      }

      const projects = Array.from(projectMap.values());
      projects.sort((a, b) => b.createdAt - a.createdAt);

      // Publish basic project data immediately 
      this.zone.run(() => this.angorProjects.set(projects));
      this.projectsLoaded = true;

      // metadata runs in background, updates signal when done
      this.fetchMetadata(projects, pool);
    } catch (err) {
      this.logger.error('AngorService: failed to load projects', err);
      this.zone.run(() => this.error.set('Failed to load Angor projects'));
    } finally {
      this.zone.run(() => this.loading.set(false));
    }
  }


  private async fetchMetadata(projects: AngorProject[], pool: SimplePool): Promise<void> {
    const nostrPubKeys = [...new Set(projects.map(p => p.nostrPubKey).filter(Boolean))];
    if (nostrPubKeys.length === 0) return;

    this.logger.info('AngorService: fetching kind 0 metadata for', nostrPubKeys.length, 'pubkeys');

    try {
      // Query only Angor relays that is where project kind 0 metadata lives.
      const metaEvents = await pool.querySync(
        this.ANGOR_RELAYS,
        { kinds: [0], authors: nostrPubKeys },
        { maxWait: 8000 },
      );

      this.logger.info('AngorService: received', metaEvents.length, 'metadata events');

      if (metaEvents.length === 0) return;

      // Keep only the newest kind 0 per pubkey
      const metaMap = new Map<string, { event: Event; metadata: AngorProjectMetadata }>();
      for (const event of metaEvents) {
        let metadata: AngorProjectMetadata;
        try {
          metadata = JSON.parse(event.content) as AngorProjectMetadata;
        } catch {
          continue;
        }
        const existing = metaMap.get(event.pubkey);
        if (!existing || event.created_at > existing.event.created_at) {
          metaMap.set(event.pubkey, { event, metadata });
        }
      }

      // Apply metadata and update the signal inside Angular's zone
      this.zone.run(() => {
        this.angorProjects.update(list =>
          list.map(p => {
            const entry = metaMap.get(p.nostrPubKey);
            return entry ? { ...p, metadata: entry.metadata } : p;
          })
        );
        this.logger.info('AngorService: applied metadata to', metaMap.size, 'projects');
      });
    } catch (err) {
      this.logger.warn('AngorService: metadata fetch failed', err);
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
    this.zone.run(() => this.angorProjects.set([]));
  }
}
