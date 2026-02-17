import { Injectable, inject } from '@angular/core';
import { LoggerService } from '../logger.service';
import { UtilitiesService } from '../utilities.service';

interface RelayBlockEntry {
  blockedUntil: number | null;
  reason: string;
  lastUpdated: number;
}

@Injectable({
  providedIn: 'root',
})
export class RelayBlockService {
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);

  private readonly blockedRelays = new Map<string, RelayBlockEntry>();

  isBlocked(relayUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(relayUrl);
    if (!normalizedUrl) {
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
    this.blockRelay(relayUrl, 60, reason);
  }

  blockConnectionFailure(relayUrl: string, reason: string): void {
    this.blockRelay(relayUrl, 600, reason);
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
      this.blockConnectionFailure(relayUrl, normalizedReason);
      return;
    }

    this.blockTransientFailure(relayUrl, normalizedReason);
  }

  private blockRelay(relayUrl: string, durationSeconds: number | null, reason: string): void {
    const normalizedUrl = this.normalizeUrl(relayUrl);
    if (!normalizedUrl) {
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

    this.logger.warn('[RelayBlockService] Blocking relay', {
      relay: normalizedUrl,
      reason,
      blockedUntil,
    });
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
    return normalized.includes('closed automatically on eose');
  }

  private normalizeUrl(relayUrl: string): string {
    return this.utilities.normalizeRelayUrl(relayUrl);
  }
}
