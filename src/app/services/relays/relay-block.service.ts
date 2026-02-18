import { Injectable, inject } from '@angular/core';
import { LoggerService } from '../logger.service';
import { UtilitiesService } from '../utilities.service';

interface RelayBlockEntry {
  blockedUntil: number | null;
  reason: string;
  lastUpdated: number;
}

interface RelayFailureEntry {
  transientFailures: number;
  connectionFailures: number;
  firstFailureAt: number;
  lastFailureAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class RelayBlockService {
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);

  private readonly transientBlockDurationSeconds = 30;
  private readonly connectionBlockDurationSeconds = 180;
  private readonly failureWindowSeconds = 120;
  private readonly transientFailuresBeforeBlock = 3;
  private readonly connectionFailuresBeforeBlock = 2;

  private readonly neverBlockRelays = new Set<string>([
    'wss://relay.damus.io/',
    'wss://nos.lol/',
    'wss://relay.primal.net/',
    'wss://relay.snort.social/',
    'wss://relay.nostr.bg/',
    'wss://nostr.wine/',
  ]);

  private readonly blockedRelays = new Map<string, RelayBlockEntry>();
  private readonly relayFailures = new Map<string, RelayFailureEntry>();

  isBlocked(relayUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(relayUrl);
    if (!normalizedUrl) {
      return false;
    }

    if (this.isNeverBlockRelay(normalizedUrl)) {
      return false;
    }

    const entry = this.blockedRelays.get(normalizedUrl);
    if (!entry) {
      return false;
    }

    if (entry.blockedUntil === null) {
      return true;
    }

    if (entry.blockedUntil <= this.utilities.currentDate()) {
      this.blockedRelays.delete(normalizedUrl);
      return false;
    }

    return true;
  }

  filterBlockedRelays(relayUrls: string[]): string[] {
    return relayUrls.filter(url => {
      const normalizedUrl = this.normalizeUrl(url) || url;
      const entry = this.blockedRelays.get(normalizedUrl);
      const blocked = this.isBlocked(url);
      if (blocked) {
        this.logger.debug('[RelayBlockService] Skipping blocked relay', {
          relay: normalizedUrl,
          reason: entry?.reason,
          blockedUntil: entry?.blockedUntil ?? null,
        });
      }
      return !blocked;
    });
  }

  getBlockedRelays(): { url: string; reason: string; blockedUntil: number | null; remainingSeconds: number | null }[] {
    const now = this.utilities.currentDate();
    const blocked: { url: string; reason: string; blockedUntil: number | null; remainingSeconds: number | null }[] = [];

    this.blockedRelays.forEach((entry, url) => {
      if (entry.blockedUntil !== null && entry.blockedUntil <= now) {
        this.blockedRelays.delete(url);
        return;
      }

      const remainingSeconds = entry.blockedUntil === null ? null : Math.max(0, entry.blockedUntil - now);
      blocked.push({
        url,
        reason: entry.reason,
        blockedUntil: entry.blockedUntil,
        remainingSeconds,
      });
    });

    return blocked;
  }

  blockAuthRequired(relayUrl: string, reason = 'auth-required'): void {
    this.blockRelay(relayUrl, null, reason);
  }

  blockTransientFailure(relayUrl: string, reason: string): void {
    this.blockRelay(relayUrl, this.transientBlockDurationSeconds, reason);
  }

  blockConnectionFailure(relayUrl: string, reason: string): void {
    this.blockRelay(relayUrl, this.connectionBlockDurationSeconds, reason);
  }

  recordFailure(relayUrl: string, reason: string, autoAuthEnabled: boolean): void {
    const normalizedReason = reason.trim();
    if (!normalizedReason || this.isIgnorableReason(normalizedReason)) {
      return;
    }

    if (!autoAuthEnabled && this.isAuthRequiredReason(normalizedReason)) {
      this.blockAuthRequired(relayUrl, normalizedReason);
      return;
    }

    if (this.isConnectionFailureReason(normalizedReason)) {
      this.registerFailure(relayUrl, 'connection', normalizedReason);
      return;
    }

    this.registerFailure(relayUrl, 'transient', normalizedReason);
  }

  private blockRelay(relayUrl: string, durationSeconds: number | null, reason: string): void {
    const normalizedUrl = this.normalizeUrl(relayUrl);
    if (!normalizedUrl) {
      return;
    }

    if (this.isNeverBlockRelay(normalizedUrl)) {
      this.logger.debug('[RelayBlockService] Relay is allowlisted, skipping block', {
        relay: normalizedUrl,
        reason,
      });
      return;
    }

    const now = this.utilities.currentDate();
    const newBlockedUntil = durationSeconds === null ? null : now + durationSeconds;
    const existing = this.blockedRelays.get(normalizedUrl);

    let blockedUntil = newBlockedUntil;
    if (existing) {
      if (existing.blockedUntil === null || newBlockedUntil === null) {
        blockedUntil = null;
      } else {
        blockedUntil = Math.max(existing.blockedUntil, newBlockedUntil);
      }
    }

    this.blockedRelays.set(normalizedUrl, {
      blockedUntil,
      reason,
      lastUpdated: now,
    });
    this.relayFailures.delete(normalizedUrl);

    this.logger.warn('[RelayBlockService] Blocking relay', {
      relay: normalizedUrl,
      reason,
      blockedUntil,
    });
  }

  private registerFailure(relayUrl: string, failureType: 'transient' | 'connection', reason: string): void {
    const normalizedUrl = this.normalizeUrl(relayUrl);
    if (!normalizedUrl || this.isNeverBlockRelay(normalizedUrl)) {
      return;
    }

    const now = this.utilities.currentDate();
    const existing = this.relayFailures.get(normalizedUrl);

    let failureEntry: RelayFailureEntry;
    if (!existing || now - existing.lastFailureAt > this.failureWindowSeconds) {
      failureEntry = {
        transientFailures: 0,
        connectionFailures: 0,
        firstFailureAt: now,
        lastFailureAt: now,
      };
    } else {
      failureEntry = {
        ...existing,
        lastFailureAt: now,
      };
    }

    if (failureType === 'connection') {
      failureEntry.connectionFailures += 1;
    } else {
      failureEntry.transientFailures += 1;
    }

    this.relayFailures.set(normalizedUrl, failureEntry);

    const shouldBlock = failureType === 'connection'
      ? failureEntry.connectionFailures >= this.connectionFailuresBeforeBlock
      : failureEntry.transientFailures >= this.transientFailuresBeforeBlock;

    if (!shouldBlock) {
      this.logger.debug('[RelayBlockService] Failure recorded, not blocking yet', {
        relay: normalizedUrl,
        reason,
        failureType,
        transientFailures: failureEntry.transientFailures,
        connectionFailures: failureEntry.connectionFailures,
      });
      return;
    }

    if (failureType === 'connection') {
      this.blockConnectionFailure(normalizedUrl, reason);
      return;
    }

    this.blockTransientFailure(normalizedUrl, reason);
  }

  private isAuthRequiredReason(reason: string): boolean {
    const normalized = reason.toLowerCase();
    return normalized.startsWith('auth-required') ||
      normalized.includes('auth required') ||
      normalized.includes('restricted');
  }

  private isConnectionFailureReason(reason: string): boolean {
    const normalized = reason.toLowerCase();
    return normalized.includes('connection timed out') ||
      normalized.includes('relay connection timed out') ||
      normalized.includes('websocket error') ||
      normalized.includes('websocket closed') ||
      normalized.includes('relay connection closed') ||
      normalized.includes('relay connection errored') ||
      normalized.includes('failed to connect') ||
      normalized.includes('connection error') ||
      normalized.includes('network error');
  }

  private isIgnorableReason(reason: string): boolean {
    const normalized = reason.toLowerCase();
    return normalized.includes('closed automatically on eose') ||
      normalized.includes('closed by caller') ||
      normalized.includes('aborted by caller');
  }

  private isNeverBlockRelay(relayUrl: string): boolean {
    return this.neverBlockRelays.has(relayUrl);
  }

  private normalizeUrl(relayUrl: string): string {
    return this.utilities.normalizeRelayUrl(relayUrl);
  }
}
