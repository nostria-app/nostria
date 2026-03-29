import { Injectable, inject } from '@angular/core';
import { type NostrRecord } from '../interfaces';
import { DataService } from './data.service';
import { DatabaseService } from './database.service';
import { RelayPoolService } from './relays/relay-pool';
import { UserRelayService } from './relays/user-relay';

export interface ReferencedEventLookupOptions {
  relayHints?: string[];
  authorPubkey?: string;
  forceRefresh?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ReferencedEventService {
  private data = inject(DataService);
  private database = inject(DatabaseService);
  private relayPool = inject(RelayPoolService);
  private userRelayService = inject(UserRelayService);

  private readonly PRIMARY_LOOKUP_TIMEOUT_MS = 3500;
  private readonly SECONDARY_LOOKUP_TIMEOUT_MS = 5000;

  async getReferencedEvent(
    eventId: string,
    options: ReferencedEventLookupOptions = {},
  ): Promise<NostrRecord | null> {
    const cachedEvent = await this.getCachedEvent(eventId);
    if (cachedEvent) {
      return cachedEvent;
    }

    const primaryResult = await this.getFirstResolvedRecord([
      this.fetchFromRelayHints(eventId, options.relayHints, this.PRIMARY_LOOKUP_TIMEOUT_MS),
      this.fetchFromAccountRelays(eventId, this.PRIMARY_LOOKUP_TIMEOUT_MS),
      this.fetchFromAuthorRelays(
        eventId,
        options.authorPubkey,
        this.PRIMARY_LOOKUP_TIMEOUT_MS,
        options.forceRefresh,
      ),
    ]);

    if (primaryResult) {
      return primaryResult;
    }

    return this.getFirstResolvedRecord([
      this.fetchFromRelayHints(eventId, options.relayHints, this.SECONDARY_LOOKUP_TIMEOUT_MS),
      this.fetchFromAuthorRelays(eventId, options.authorPubkey, this.SECONDARY_LOOKUP_TIMEOUT_MS, true),
      this.fetchFromGlobalRelays(eventId, this.SECONDARY_LOOKUP_TIMEOUT_MS),
    ]);
  }

  private async getCachedEvent(eventId: string): Promise<NostrRecord | null> {
    try {
      const cachedEvent = await this.database.getEventById(eventId);
      return cachedEvent ? this.data.toRecord(cachedEvent) : null;
    } catch {
      return null;
    }
  }

  private async fetchFromRelayHints(
    eventId: string,
    relayHints: string[] | undefined,
    timeoutMs: number,
  ): Promise<NostrRecord | null> {
    if (!relayHints || relayHints.length === 0) {
      return null;
    }

    return this.withTimeout(
      this.relayPool.getEventById(relayHints, eventId, timeoutMs)
        .then((event) => (event ? this.data.toRecord(event) : null))
        .catch(() => null),
      timeoutMs,
    );
  }

  private async fetchFromAccountRelays(eventId: string, timeoutMs: number): Promise<NostrRecord | null> {
    return this.withTimeout(
      this.data.getEventById(eventId, { save: true }).catch(() => null),
      timeoutMs,
    );
  }

  private async fetchFromAuthorRelays(
    eventId: string,
    authorPubkey: string | undefined,
    timeoutMs: number,
    bypassCache = false,
  ): Promise<NostrRecord | null> {
    if (!authorPubkey) {
      return null;
    }

    return this.withTimeout(
      this.userRelayService.getEventById(authorPubkey, eventId, { bypassCache })
        .then((event) => (event ? this.data.toRecord(event) : null))
        .catch(() => null),
      timeoutMs,
    );
  }

  private async fetchFromGlobalRelays(eventId: string, timeoutMs: number): Promise<NostrRecord | null> {
    return this.withTimeout(
      this.data.getEventById(eventId, { save: true }, true).catch(() => null),
      timeoutMs,
    );
  }

  private async getFirstResolvedRecord(
    lookups: Promise<NostrRecord | null>[],
  ): Promise<NostrRecord | null> {
    if (lookups.length === 0) {
      return null;
    }

    return new Promise((resolve) => {
      let pendingCount = lookups.length;
      let resolved = false;

      const settleIfFinished = (): void => {
        pendingCount--;
        if (!resolved && pendingCount === 0) {
          resolve(null);
        }
      };

      for (const lookup of lookups) {
        lookup
          .then((result) => {
            if (resolved) {
              return;
            }

            if (result) {
              resolved = true;
              resolve(result);
              return;
            }

            settleIfFinished();
          })
          .catch(() => {
            if (resolved) {
              return;
            }

            settleIfFinished();
          });
      }
    });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return Promise.race<T | null>([
      promise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }
}