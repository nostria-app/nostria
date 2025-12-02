import { Injectable, inject, signal } from '@angular/core';
import { Event, EventTemplate, VerifiedEvent } from 'nostr-tools';
import { LoggerService } from '../logger.service';
import { DatabaseService } from '../database.service';
import { UtilitiesService } from '../utilities.service';
import { ObservedRelayStats } from '../database.service';

/** Type for the onauth callback used by nostr-tools SimplePool operations */
export type AuthCallback = (evt: EventTemplate) => Promise<VerifiedEvent>;

/** Type for the signing function that signs auth events */
export type AuthSignFunction = (evt: EventTemplate) => Promise<Event>;

/**
 * Service to handle NIP-42 relay authentication.
 * 
 * This service manages the authentication state of relays that require authentication
 * and provides the `onauth` callback for nostr-tools SimplePool operations.
 */
@Injectable({
  providedIn: 'root',
})
export class RelayAuthService {
  private readonly logger = inject(LoggerService);
  private readonly database = inject(DatabaseService);
  private readonly utilities = inject(UtilitiesService);

  // Track relays that have failed authentication - we won't retry these automatically
  private readonly failedAuthRelays = signal<Set<string>>(new Set());

  // Track relays that require authentication
  private readonly authRequiredRelays = signal<Set<string>>(new Set());

  // Signing function - will be set by NostrService to avoid circular dependency
  // Note: Event type is used since that's what NostrService.signEvent returns
  // nostr-tools internally uses VerifiedEvent but Event is compatible
  private signAuthEventFn: AuthSignFunction | null = null;

  /**
   * Set the signing function for auth events.
   * This should be called by NostrService during initialization.
   */
  setSignFunction(signFn: AuthSignFunction): void {
    this.signAuthEventFn = signFn;
    this.logger.debug('[RelayAuthService] Sign function set');
  }

  /**
   * Check if we have a signing function available
   */
  canSign(): boolean {
    return this.signAuthEventFn !== null;
  }

  /**
   * Get the `onauth` callback to use with nostr-tools SimplePool operations.
   * Returns undefined if signing is not available (e.g., preview account).
   */
  getAuthCallback(): AuthCallback | undefined {
    if (!this.signAuthEventFn) {
      this.logger.debug('[RelayAuthService] No sign function available, auth callback will be undefined');
      return undefined;
    }

    return async (authEventTemplate: EventTemplate): Promise<VerifiedEvent> => {
      // Extract relay URL from the auth event template
      const relayTag = authEventTemplate.tags.find(t => t[0] === 'relay');
      const relayUrl = relayTag ? relayTag[1] : 'unknown';
      const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);

      this.logger.info(`[RelayAuthService] Authentication requested by relay: ${normalizedUrl}`);

      // Mark this relay as requiring authentication
      this.authRequiredRelays.update(relays => {
        const newSet = new Set(relays);
        newSet.add(normalizedUrl);
        return newSet;
      });

      // Check if we've already failed auth for this relay
      if (this.failedAuthRelays().has(normalizedUrl)) {
        const error = `Authentication previously failed for relay: ${normalizedUrl}. Reset required.`;
        this.logger.warn(`[RelayAuthService] ${error}`);
        throw new Error(error);
      }

      try {
        // Sign the auth event
        const signedEvent = await this.signAuthEventFn!(authEventTemplate);

        this.logger.info(`[RelayAuthService] Successfully signed auth event for relay: ${normalizedUrl}`);

        // Update storage to track successful authentication
        await this.updateRelayAuthStatus(normalizedUrl, {
          authenticationRequired: true,
          authenticationFailed: false,
          lastAuthAttempt: this.utilities.currentDate(),
          authFailureReason: undefined,
        });

        // Cast to VerifiedEvent - nostr-tools expects this type but our signed events are compatible
        return signedEvent as VerifiedEvent;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`[RelayAuthService] Failed to sign auth event for relay: ${normalizedUrl}`, error);

        // Mark this relay as having failed auth
        this.failedAuthRelays.update(relays => {
          const newSet = new Set(relays);
          newSet.add(normalizedUrl);
          return newSet;
        });

        // Update storage with failure info
        await this.updateRelayAuthStatus(normalizedUrl, {
          authenticationRequired: true,
          authenticationFailed: true,
          lastAuthAttempt: this.utilities.currentDate(),
          authFailureReason: errorMessage,
        });

        throw error;
      }
    };
  }

  /**
   * Mark a relay as having failed authentication.
   * This is called when the relay rejects our auth attempt.
   */
  async markAuthFailed(relayUrl: string, reason: string): Promise<void> {
    const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);

    this.logger.warn(`[RelayAuthService] Marking relay as auth failed: ${normalizedUrl} - Reason: ${reason}`);

    this.failedAuthRelays.update(relays => {
      const newSet = new Set(relays);
      newSet.add(normalizedUrl);
      return newSet;
    });

    await this.updateRelayAuthStatus(normalizedUrl, {
      authenticationRequired: true,
      authenticationFailed: true,
      lastAuthAttempt: this.utilities.currentDate(),
      authFailureReason: reason,
    });
  }

  /**
   * Reset the authentication failure status for a relay.
   * This allows the relay to be tried again.
   */
  async resetAuthFailure(relayUrl: string): Promise<void> {
    const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);

    this.logger.info(`[RelayAuthService] Resetting auth failure for relay: ${normalizedUrl}`);

    this.failedAuthRelays.update(relays => {
      const newSet = new Set(relays);
      newSet.delete(normalizedUrl);
      return newSet;
    });

    await this.updateRelayAuthStatus(normalizedUrl, {
      authenticationFailed: false,
      authFailureReason: undefined,
    });
  }

  /**
   * Check if a relay has failed authentication
   */
  hasAuthFailed(relayUrl: string): boolean {
    const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);
    return this.failedAuthRelays().has(normalizedUrl);
  }

  /**
   * Check if a relay requires authentication
   */
  requiresAuth(relayUrl: string): boolean {
    const normalizedUrl = this.utilities.normalizeRelayUrl(relayUrl);
    return this.authRequiredRelays().has(normalizedUrl);
  }

  /**
   * Get all relays that have failed authentication
   */
  getFailedAuthRelays(): string[] {
    return Array.from(this.failedAuthRelays());
  }

  /**
   * Get all relays that require authentication
   */
  getAuthRequiredRelays(): string[] {
    return Array.from(this.authRequiredRelays());
  }

  /**
   * Filter out relays that have failed authentication from a list
   */
  filterAuthFailedRelays(relayUrls: string[]): string[] {
    return relayUrls.filter(url => {
      const normalizedUrl = this.utilities.normalizeRelayUrl(url);
      return !this.failedAuthRelays().has(normalizedUrl);
    });
  }

  /**
   * Update relay authentication status in storage
   */
  private async updateRelayAuthStatus(
    relayUrl: string,
    authStatus: Partial<Pick<ObservedRelayStats, 'authenticationFailed' | 'authenticationRequired' | 'lastAuthAttempt' | 'authFailureReason'>>
  ): Promise<void> {
    if (!this.database.initialized()) {
      this.logger.debug('[RelayAuthService] Database not initialized, skipping auth status update');
      return;
    }

    try {
      const existingRaw = await this.database.getObservedRelay(relayUrl);
      const existing = existingRaw as ObservedRelayStats | undefined;
      const now = this.utilities.currentDate();

      const updatedStats: ObservedRelayStats = {
        url: relayUrl,
        isConnected: existing?.isConnected ?? false,
        isOffline: existing?.isOffline ?? false,
        eventsReceived: existing?.eventsReceived ?? 0,
        lastConnectionRetry: existing?.lastConnectionRetry ?? 0,
        lastSuccessfulConnection: existing?.lastSuccessfulConnection ?? 0,
        connectionAttempts: existing?.connectionAttempts ?? 0,
        firstObserved: existing?.firstObserved ?? now,
        lastUpdated: now,
        nip11: existing?.nip11,
        // Authentication fields
        authenticationRequired: authStatus.authenticationRequired ?? existing?.authenticationRequired,
        authenticationFailed: authStatus.authenticationFailed ?? existing?.authenticationFailed,
        lastAuthAttempt: authStatus.lastAuthAttempt ?? existing?.lastAuthAttempt,
        authFailureReason: authStatus.authFailureReason ?? existing?.authFailureReason,
      };

      await this.database.saveObservedRelay(updatedStats as unknown as Record<string, unknown>);
      this.logger.debug(`[RelayAuthService] Updated auth status for relay: ${relayUrl}`);
    } catch (error) {
      this.logger.error(`[RelayAuthService] Failed to update auth status for relay: ${relayUrl}`, error);
    }
  }

  /**
   * Load authentication state from storage for all observed relays.
   * This should be called during initialization.
   */
  async loadAuthStateFromStorage(): Promise<void> {
    if (!this.database.initialized()) {
      this.logger.debug('[RelayAuthService] Database not initialized, skipping auth state load');
      return;
    }

    try {
      const observedRelaysRaw = await this.database.getAllObservedRelays();
      const observedRelays = observedRelaysRaw as unknown as ObservedRelayStats[];

      const failedRelays = new Set<string>();
      const authRequiredRelays = new Set<string>();

      for (const relay of observedRelays) {
        if (relay.authenticationFailed) {
          failedRelays.add(relay.url);
        }
        if (relay.authenticationRequired) {
          authRequiredRelays.add(relay.url);
        }
      }

      this.failedAuthRelays.set(failedRelays);
      this.authRequiredRelays.set(authRequiredRelays);

      this.logger.info(`[RelayAuthService] Loaded auth state: ${failedRelays.size} failed, ${authRequiredRelays.size} require auth`);
    } catch (error) {
      this.logger.error('[RelayAuthService] Failed to load auth state from storage', error);
    }
  }
}
