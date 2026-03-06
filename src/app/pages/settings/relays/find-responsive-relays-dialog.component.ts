import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Event, SimplePool } from 'nostr-tools';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { RelayMonitorProfileComponent } from './relay-monitor-profile.component';

const NIP66_RELAY_DISCOVERY_KIND = 30166;
const RELAY_DISCOVERY_LOOKBACK_SECONDS = 60 * 60 * 24 * 14;
const RELAY_DISCOVERY_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface FindResponsiveRelaysDialogData {
  relayUrls: string[];
  existingRelayUrls: string[];
}

export interface RelayRecommendation {
  url: string;
  createdAt: number;
  ageSeconds: number;
  openRtt: number | null;
  readRtt: number | null;
  writeRtt: number | null;
  avgRtt: number | null;
  hasRttData: boolean;
  isFresh: boolean;
  isAlreadyAdded: boolean;
  quality: 'good' | 'fair' | 'poor';
  protocol: {
    monitorPubkey: string;
    networkTypes: string[];
    relayTypes: string[];
    supportedNips: string[];
    requirements: string[];
    rejectedRequirements: string[];
    acceptedKinds: string[];
    rejectedKinds: string[];
    topics: string[];
    geohashes: string[];
    hasNip11Content: boolean;
  };
}

export interface FindResponsiveRelaysDialogResult {
  selectedUrls: string[];
}

@Component({
  selector: 'app-find-responsive-relays-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    RelayMonitorProfileComponent,
  ],
  templateUrl: './find-responsive-relays-dialog.component.html',
  styleUrl: './find-responsive-relays-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindResponsiveRelaysDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<FindResponsiveRelaysDialogComponent, FindResponsiveRelaysDialogResult>);

  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);

  // Populated by CustomDialogService via config.data
  data: FindResponsiveRelaysDialogData = {
    relayUrls: [],
    existingRelayUrls: [],
  };

  private pool: SimplePool | null = null;

  loading = signal(false);
  error = signal<string | null>(null);
  lastUpdatedAt = signal<number | null>(null);

  recommendations = signal<RelayRecommendation[]>([]);
  selectedUrls = signal<Set<string>>(new Set());
  expandedUrls = signal<Set<string>>(new Set());
  localLatencyChecking = signal<Set<string>>(new Set());
  localLatencyMs = signal<Map<string, number>>(new Map());
  localLatencyError = signal<Map<string, string>>(new Map());

  suggestedRelays = computed(() => this.recommendations().filter((relay) => !relay.isAlreadyAdded));
  alreadyAddedCount = computed(() => this.recommendations().filter((relay) => relay.isAlreadyAdded).length);

  ngOnInit(): void {
    void this.findRelays();
  }

  ngOnDestroy(): void {
    this.closePool();
  }

  async findRelays(): Promise<void> {
    if (this.loading()) {
      return;
    }

    const queryRelays = this.normalizeRelayList(this.data.relayUrls);
    if (queryRelays.length === 0) {
      this.error.set('No discovery relays available to query. Add a discovery relay and try again.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.selectedUrls.set(new Set());
    this.expandedUrls.set(new Set());
    this.localLatencyChecking.set(new Set());
    this.localLatencyMs.set(new Map());
    this.localLatencyError.set(new Map());

    try {
      this.closePool();
      this.pool = new SimplePool({ enablePing: true, enableReconnect: true });

      const nowSeconds = Math.floor(Date.now() / 1000);
      const since = nowSeconds - RELAY_DISCOVERY_LOOKBACK_SECONDS;

      const events = await this.pool.querySync(
        queryRelays,
        {
          kinds: [NIP66_RELAY_DISCOVERY_KIND],
          since,
          limit: 1200,
        },
        { maxWait: 7000 }
      );

      const existingSet = new Set(this.normalizeRelayList(this.data.existingRelayUrls));
      const recommendations = this.buildRecommendations(events, existingSet, nowSeconds);

      this.recommendations.set(recommendations);
      this.lastUpdatedAt.set(Date.now());
    } catch (error) {
      this.logger.error('Failed to query NIP-66 relay recommendations', error);
      this.error.set('Failed to load relay recommendations. Please try again.');
      this.recommendations.set([]);
    } finally {
      this.closePool();
      this.loading.set(false);
    }
  }

  toggleSelection(url: string): void {
    const recommendation = this.recommendations().find((candidate) => candidate.url === url);
    if (!recommendation || recommendation.isAlreadyAdded) {
      return;
    }

    this.selectedUrls.update((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  addTopRelays(limit = 3): void {
    const topUrls = this.suggestedRelays()
      .slice(0, limit)
      .map((relay) => relay.url);

    this.dialogRef.close({ selectedUrls: topUrls });
  }

  confirmSelection(): void {
    this.dialogRef.close({
      selectedUrls: Array.from(this.selectedUrls()),
    });
  }

  hasSelected(url: string): boolean {
    return this.selectedUrls().has(url);
  }

  toggleExpanded(url: string): void {
    this.expandedUrls.update((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  isExpanded(url: string): boolean {
    return this.expandedUrls().has(url);
  }

  getQualityLabel(relay: RelayRecommendation): string {
    if (relay.quality === 'good') {
      return 'Good';
    }

    if (relay.quality === 'fair') {
      return 'Okay';
    }

    return 'Weak';
  }

  getQualityClass(relay: RelayRecommendation): string {
    if (relay.quality === 'good') {
      return 'quality-good';
    }

    if (relay.quality === 'fair') {
      return 'quality-fair';
    }

    return 'quality-poor';
  }

  formatRelayUrl(url: string): string {
    return url.replace(/^wss:\/\//, '').replace(/^ws:\/\//, '');
  }

  formatLatency(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return '--';
    }

    return `${value} ms`;
  }

  formatAge(ageSeconds: number): string {
    if (ageSeconds < 60) {
      return `${ageSeconds}s ago`;
    }

    if (ageSeconds < 60 * 60) {
      return `${Math.floor(ageSeconds / 60)}m ago`;
    }

    if (ageSeconds < 60 * 60 * 24) {
      return `${Math.floor(ageSeconds / (60 * 60))}h ago`;
    }

    return `${Math.floor(ageSeconds / (60 * 60 * 24))}d ago`;
  }

  async checkLocalLatency(url: string): Promise<void> {
    const checkingSet = this.localLatencyChecking();
    if (checkingSet.has(url)) {
      return;
    }

    this.localLatencyChecking.update((current) => new Set(current).add(url));
    this.localLatencyError.update((current) => {
      const next = new Map(current);
      next.delete(url);
      return next;
    });

    try {
      const latency = await this.measureLocalRelayLatency(url);
      this.localLatencyMs.update((current) => {
        const next = new Map(current);
        next.set(url, latency);
        return next;
      });
    } catch {
      this.localLatencyError.update((current) => {
        const next = new Map(current);
        next.set(url, 'Unable to connect from your network');
        return next;
      });
    } finally {
      this.localLatencyChecking.update((current) => {
        const next = new Set(current);
        next.delete(url);
        return next;
      });
    }
  }

  isCheckingLocalLatency(url: string): boolean {
    return this.localLatencyChecking().has(url);
  }

  getLocalLatency(url: string): number | null {
    return this.localLatencyMs().get(url) ?? null;
  }

  getLocalLatencyError(url: string): string | null {
    return this.localLatencyError().get(url) ?? null;
  }

  private buildRecommendations(
    events: Event[],
    existingSet: Set<string>,
    nowSeconds: number
  ): RelayRecommendation[] {
    const latestByRelay = new Map<string, RelayRecommendation>();

    for (const event of events) {
      const relayUrl = this.getTagValue(event.tags, 'd');
      if (!relayUrl) {
        continue;
      }

      const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);
      if (!normalizedUrl.startsWith('wss://') && !normalizedUrl.startsWith('ws://')) {
        continue;
      }

      const openRtt = this.getTagNumber(event.tags, 'rtt-open');
      const readRtt = this.getTagNumber(event.tags, 'rtt-read');
      const writeRtt = this.getTagNumber(event.tags, 'rtt-write');
      const rtts = [openRtt, readRtt, writeRtt].filter((value): value is number => value !== null);

      const avgRtt = rtts.length > 0
        ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length)
        : null;
      const ageSeconds = Math.max(0, nowSeconds - event.created_at);

      const recommendation: RelayRecommendation = {
        url: normalizedUrl,
        createdAt: event.created_at,
        ageSeconds,
        openRtt,
        readRtt,
        writeRtt,
        avgRtt,
        hasRttData: rtts.length > 0,
        isFresh: ageSeconds <= RELAY_DISCOVERY_MAX_AGE_SECONDS,
        isAlreadyAdded: existingSet.has(normalizedUrl),
        quality: this.getQuality(avgRtt, rtts.length > 0, ageSeconds <= RELAY_DISCOVERY_MAX_AGE_SECONDS),
        protocol: {
          monitorPubkey: event.pubkey,
          networkTypes: this.getTagValues(event.tags, 'n'),
          relayTypes: this.getTagValues(event.tags, 'T'),
          supportedNips: this.getTagValues(event.tags, 'N').sort((a, b) => Number(a) - Number(b)),
          requirements: this.getTagValues(event.tags, 'R').filter((value) => !value.startsWith('!')),
          rejectedRequirements: this.getTagValues(event.tags, 'R')
            .filter((value) => value.startsWith('!'))
            .map((value) => value.slice(1)),
          acceptedKinds: this.getTagValues(event.tags, 'k').filter((value) => !value.startsWith('!')),
          rejectedKinds: this.getTagValues(event.tags, 'k')
            .filter((value) => value.startsWith('!'))
            .map((value) => value.slice(1)),
          topics: this.getTagValues(event.tags, 't'),
          geohashes: this.getTagValues(event.tags, 'g'),
          hasNip11Content: event.content.trim().startsWith('{') && event.content.trim().endsWith('}'),
        },
      };

      const existing = latestByRelay.get(normalizedUrl);
      if (!existing || recommendation.createdAt > existing.createdAt) {
        latestByRelay.set(normalizedUrl, recommendation);
      }
    }

    return Array.from(latestByRelay.values()).sort((a, b) => {
      if (a.isAlreadyAdded !== b.isAlreadyAdded) {
        return a.isAlreadyAdded ? 1 : -1;
      }

      if (a.isFresh !== b.isFresh) {
        return a.isFresh ? -1 : 1;
      }

      if (a.hasRttData !== b.hasRttData) {
        return a.hasRttData ? -1 : 1;
      }

      if ((a.avgRtt ?? Number.MAX_SAFE_INTEGER) !== (b.avgRtt ?? Number.MAX_SAFE_INTEGER)) {
        return (a.avgRtt ?? Number.MAX_SAFE_INTEGER) - (b.avgRtt ?? Number.MAX_SAFE_INTEGER);
      }

      return b.createdAt - a.createdAt;
    });
  }

  private getTagValue(tags: string[][], tagName: string): string | null {
    const tag = tags.find((entry) => entry[0] === tagName && typeof entry[1] === 'string' && entry[1].trim().length > 0);
    return tag?.[1]?.trim() || null;
  }

  private getTagValues(tags: string[][], tagName: string): string[] {
    const values = tags
      .filter((entry) => entry[0] === tagName && typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map((entry) => entry[1].trim());

    return this.utilities.unique(values);
  }

  private getTagNumber(tags: string[][], tagName: string): number | null {
    const value = this.getTagValue(tags, tagName);
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  private normalizeRelayList(urls: string[]): string[] {
    const normalized = urls
      .map((url) => this.utilities.normalizeRelayUrl(url))
      .filter((url) => url.startsWith('wss://') || url.startsWith('ws://'));

    return this.utilities.unique(normalized);
  }

  private async measureLocalRelayLatency(url: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let socket: WebSocket | null = null;
      let settled = false;
      const startedAt = performance.now();

      const finish = (resolver: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolver();
      };

      const timeoutHandle = setTimeout(() => {
        finish(() => {
          socket?.close();
          reject(new Error('timeout'));
        });
      }, 5000);

      try {
        socket = new WebSocket(url);

        socket.onopen = () => {
          const latency = Math.round(performance.now() - startedAt);
          finish(() => {
            clearTimeout(timeoutHandle);
            socket?.close();
            resolve(latency);
          });
        };

        socket.onerror = () => {
          finish(() => {
            clearTimeout(timeoutHandle);
            socket?.close();
            reject(new Error('connection_error'));
          });
        };
      } catch {
        finish(() => {
          clearTimeout(timeoutHandle);
          socket?.close();
          reject(new Error('invalid_url'));
        });
      }
    });
  }

  private getQuality(avgRtt: number | null, hasRttData: boolean, isFresh: boolean): 'good' | 'fair' | 'poor' {
    if (!hasRttData) {
      return isFresh ? 'fair' : 'poor';
    }

    if (!isFresh || avgRtt === null) {
      return 'poor';
    }

    if (avgRtt <= 120) {
      return 'good';
    }

    if (avgRtt <= 350) {
      return 'fair';
    }

    return 'poor';
  }

  private closePool(): void {
    if (!this.pool) {
      return;
    }

    try {
      this.pool.close(this.normalizeRelayList(this.data.relayUrls));
    } catch {
      // Ignore close errors from partially connected relay pools.
    }

    this.pool = null;
  }
}
