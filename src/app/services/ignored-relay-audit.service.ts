import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

export interface IgnoredRelayAuditEntry {
  pubkey: string;
  ignoredDomains: string[];
  relayUrls: string[];
  firstSeen: number;
  lastSeen: number;
  observationCount: number;
}

export interface IgnoredRelayAuditSnapshot {
  totalUsers: number;
  totalObservations: number;
  affectedDomains: string[];
  entries: IgnoredRelayAuditEntry[];
}

@Injectable({
  providedIn: 'root',
})
export class IgnoredRelayAuditService {
  private readonly maxAuditEntries = 250;
  private readonly maxIgnoredDomainsPerEntry = 8;
  private readonly maxRelayUrlsPerEntry = 12;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'nostria-ignored-relay-audit-v1';
  private readonly accountsStorageKey = 'nostria-accounts';
  private readonly excludedAuditDomains = new Set<string>(['nwc.primal.net']);

  private readonly entriesMap = signal<Map<string, IgnoredRelayAuditEntry>>(new Map());

  constructor() {
    this.loadFromStorage();
  }

  /** Returns the set of pubkeys belonging to the current user's own accounts. */
  private getOwnAccountPubkeys(): Set<string> {
    if (!isPlatformBrowser(this.platformId)) {
      return new Set();
    }
    try {
      const raw = localStorage.getItem(this.accountsStorageKey);
      if (!raw) return new Set();
      const accounts = JSON.parse(raw);
      if (!Array.isArray(accounts)) return new Set();
      return new Set(accounts.map((a: { pubkey?: string }) => a.pubkey).filter((p): p is string => !!p));
    } catch {
      return new Set();
    }
  }

  recordIgnoredRelayUsage(pubkey: string, ignoredDomains: string[], relayUrls: string[]): void {
    if (!pubkey || typeof pubkey !== 'string') {
      return;
    }

    // Skip tracking for the current user's own accounts
    if (this.getOwnAccountPubkeys().has(pubkey)) {
      return;
    }

    const filteredDomains = this.filterAuditDomains(ignoredDomains);
    if (filteredDomains.length === 0) {
      return;
    }

    const now = Date.now();
    const currentEntries = this.entriesMap();
    const existing = currentEntries.get(pubkey);

    const nextEntry: IgnoredRelayAuditEntry = existing
      ? {
        ...existing,
        ignoredDomains: this.limitList(this.mergeUnique(existing.ignoredDomains, filteredDomains), this.maxIgnoredDomainsPerEntry),
        relayUrls: this.limitList(this.mergeUnique(existing.relayUrls, relayUrls), this.maxRelayUrlsPerEntry),
        lastSeen: now,
        observationCount: existing.observationCount + 1,
      }
      : {
        pubkey,
        ignoredDomains: this.limitList(this.mergeUnique([], filteredDomains), this.maxIgnoredDomainsPerEntry),
        relayUrls: this.limitList(this.mergeUnique([], relayUrls), this.maxRelayUrlsPerEntry),
        firstSeen: now,
        lastSeen: now,
        observationCount: 1,
      };

    const updatedEntries = new Map(currentEntries);
    updatedEntries.set(pubkey, nextEntry);
    this.entriesMap.set(this.trimEntries(updatedEntries));
    this.saveToStorage();
  }

  getSnapshot(): IgnoredRelayAuditSnapshot {
    const ownPubkeys = this.getOwnAccountPubkeys();
    const entries = Array.from(this.entriesMap().values())
      .filter((entry) => !ownPubkeys.has(entry.pubkey))
      .sort((a, b) => b.lastSeen - a.lastSeen);

    const affectedDomains = [...new Set(entries.flatMap((entry) => entry.ignoredDomains))]
      .sort((a, b) => a.localeCompare(b));

    const totalObservations = entries.reduce((sum, entry) => sum + entry.observationCount, 0);

    return {
      totalUsers: entries.length,
      totalObservations,
      affectedDomains,
      entries,
    };
  }

  reset(): void {
    this.entriesMap.set(new Map());

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    localStorage.removeItem(this.storageKey);
  }

  isExcludedAuditDomain(domain: string): boolean {
    return this.excludedAuditDomains.has(domain.toLowerCase());
  }

  private filterAuditDomains(domains: string[]): string[] {
    return this.mergeUnique([], domains)
      .map((domain) => domain.toLowerCase())
      .filter((domain) => !this.isExcludedAuditDomain(domain));
  }

  private mergeUnique(existing: string[], incoming: string[]): string[] {
    const merged = new Set<string>();

    for (const value of existing) {
      const trimmed = value?.trim();
      if (trimmed) {
        merged.add(trimmed);
      }
    }

    for (const value of incoming) {
      const trimmed = value?.trim();
      if (trimmed) {
        merged.add(trimmed);
      }
    }

    return Array.from(merged.values());
  }

  private limitList(values: string[], maxItems: number): string[] {
    return values.length > maxItems ? values.slice(0, maxItems) : values;
  }

  private trimEntries(entries: Map<string, IgnoredRelayAuditEntry>): Map<string, IgnoredRelayAuditEntry> {
    if (entries.size <= this.maxAuditEntries) {
      return entries;
    }

    const nextEntries = new Map(entries);
    const sortedByLastSeen = Array.from(nextEntries.values()).sort((left, right) => right.lastSeen - left.lastSeen);
    const allowedPubkeys = new Set(sortedByLastSeen.slice(0, this.maxAuditEntries).map(entry => entry.pubkey));

    for (const pubkey of nextEntries.keys()) {
      if (!allowedPubkeys.has(pubkey)) {
        nextEntries.delete(pubkey);
      }
    }

    return nextEntries;
  }

  private loadFromStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as IgnoredRelayAuditEntry[];
      if (!Array.isArray(parsed)) {
        return;
      }

      const restored = new Map<string, IgnoredRelayAuditEntry>();
      for (const entry of parsed) {
        if (!entry?.pubkey) {
          continue;
        }

        restored.set(entry.pubkey, {
          pubkey: entry.pubkey,
          ignoredDomains: this.limitList(this.filterAuditDomains(Array.isArray(entry.ignoredDomains) ? entry.ignoredDomains : []), this.maxIgnoredDomainsPerEntry),
          relayUrls: this.limitList(this.mergeUnique([], Array.isArray(entry.relayUrls) ? entry.relayUrls : []), this.maxRelayUrlsPerEntry),
          firstSeen: typeof entry.firstSeen === 'number' ? entry.firstSeen : Date.now(),
          lastSeen: typeof entry.lastSeen === 'number' ? entry.lastSeen : Date.now(),
          observationCount: typeof entry.observationCount === 'number' && entry.observationCount > 0
            ? entry.observationCount
            : 1,
        });
      }

      this.entriesMap.set(this.trimEntries(restored));
    } catch {
      this.entriesMap.set(new Map());
    }
  }

  private saveToStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      const payload = JSON.stringify(Array.from(this.entriesMap().values()));
      localStorage.setItem(this.storageKey, payload);
    } catch {
      // Ignore storage errors (quota/privacy mode)
    }
  }
}
