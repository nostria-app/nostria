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
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'nostria-ignored-relay-audit-v1';
  private readonly excludedAuditDomains = new Set<string>(['nwc.primal.net']);

  private readonly entriesMap = signal<Map<string, IgnoredRelayAuditEntry>>(new Map());

  constructor() {
    this.loadFromStorage();
  }

  recordIgnoredRelayUsage(pubkey: string, ignoredDomains: string[], relayUrls: string[]): void {
    if (!pubkey || typeof pubkey !== 'string') {
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
        ignoredDomains: this.mergeUnique(existing.ignoredDomains, filteredDomains),
        relayUrls: this.mergeUnique(existing.relayUrls, relayUrls),
        lastSeen: now,
        observationCount: existing.observationCount + 1,
      }
      : {
        pubkey,
        ignoredDomains: this.mergeUnique([], filteredDomains),
        relayUrls: this.mergeUnique([], relayUrls),
        firstSeen: now,
        lastSeen: now,
        observationCount: 1,
      };

    const updatedEntries = new Map(currentEntries);
    updatedEntries.set(pubkey, nextEntry);
    this.entriesMap.set(updatedEntries);
    this.saveToStorage();
  }

  getSnapshot(): IgnoredRelayAuditSnapshot {
    const entries = Array.from(this.entriesMap().values())
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
          ignoredDomains: this.filterAuditDomains(Array.isArray(entry.ignoredDomains) ? entry.ignoredDomains : []),
          relayUrls: this.mergeUnique([], Array.isArray(entry.relayUrls) ? entry.relayUrls : []),
          firstSeen: typeof entry.firstSeen === 'number' ? entry.firstSeen : Date.now(),
          lastSeen: typeof entry.lastSeen === 'number' ? entry.lastSeen : Date.now(),
          observationCount: typeof entry.observationCount === 'number' && entry.observationCount > 0
            ? entry.observationCount
            : 1,
        });
      }

      this.entriesMap.set(restored);
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
