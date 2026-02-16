import { Injectable, inject } from '@angular/core';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';

export interface Nip05VerificationResult {
  /** The parsed/display-friendly NIP-05 identifier (e.g. "@domain.com" or "user@domain.com") */
  value: string;
  /** Whether the NIP-05 resolved and the pubkey matched */
  valid: boolean;
  /** Human-readable status message */
  status: string;
}

interface CachedVerification {
  result: Nip05VerificationResult;
  timestamp: number;
  /** The raw nip05 value that was verified, to detect profile changes */
  nip05Raw: string;
}

const EMPTY_RESULT: Nip05VerificationResult = { value: '', valid: false, status: '' };

@Injectable({ providedIn: 'root' })
export class Nip05VerificationService {
  private readonly utilities = inject(UtilitiesService);
  private readonly logger = inject(LoggerService);

  /**
   * In-memory cache of verification results keyed by pubkey.
   * Results are cached for CACHE_TTL_MS and reused across components.
   */
  private readonly cache = new Map<string, CachedVerification>();

  /** Cache TTL: 30 minutes. Verification is relatively expensive (HTTP fetch). */
  private readonly CACHE_TTL_MS = 30 * 60 * 1000;

  /**
   * Get a cached verification result for a pubkey without triggering any network request.
   * Returns null if no cached result exists or the cache has expired.
   *
   * Use this in contexts where verification should NOT be triggered (e.g. thread lists).
   */
  getCached(pubkey: string): Nip05VerificationResult | null {
    const entry = this.cache.get(pubkey);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.CACHE_TTL_MS) {
      this.cache.delete(pubkey);
      return null;
    }

    return entry.result;
  }

  /**
   * Verify a NIP-05 identifier for a given pubkey. This performs an HTTP request
   * to the NIP-05 well-known URL and checks the returned pubkey.
   *
   * Results are cached. If a valid cached result exists for the same nip05 value,
   * the cached result is returned without a network request.
   *
   * Call this ONLY from:
   * - Profile page (when opened)
   * - Hover card (when shown)
   *
   * Do NOT call this from thread/list views where many profiles render at once.
   */
  async verify(pubkey: string, nip05Raw: string | undefined | null): Promise<Nip05VerificationResult> {
    if (!nip05Raw || typeof nip05Raw !== 'string') {
      return EMPTY_RESULT;
    }

    const value = this.utilities.parseNip05(nip05Raw);
    if (!value) return EMPTY_RESULT;

    // Check cache - return if still valid and for the same nip05 value
    const cached = this.cache.get(pubkey);
    if (cached && cached.nip05Raw === nip05Raw) {
      const age = Date.now() - cached.timestamp;
      if (age < this.CACHE_TTL_MS) {
        return cached.result;
      }
    }

    // Perform actual verification
    const result = await this.performVerification(pubkey, nip05Raw, value);

    // Cache the result
    this.cache.set(pubkey, {
      result,
      timestamp: Date.now(),
      nip05Raw,
    });

    return result;
  }

  /**
   * Force a fresh verification, bypassing the cache.
   * Useful when the user explicitly opens a profile page and we want the latest status.
   */
  async verifyFresh(pubkey: string, nip05Raw: string | undefined | null): Promise<Nip05VerificationResult> {
    if (!nip05Raw || typeof nip05Raw !== 'string') {
      return EMPTY_RESULT;
    }

    const value = this.utilities.parseNip05(nip05Raw);
    if (!value) return EMPTY_RESULT;

    const result = await this.performVerification(pubkey, nip05Raw, value);

    // Cache the result
    this.cache.set(pubkey, {
      result,
      timestamp: Date.now(),
      nip05Raw,
    });

    return result;
  }

  private async performVerification(
    pubkey: string,
    nip05Raw: string,
    parsedValue: string,
  ): Promise<Nip05VerificationResult> {
    if (!isNip05(nip05Raw)) {
      return { value: parsedValue, valid: false, status: 'Invalid NIP-05 format' };
    }

    try {
      const profile = await queryProfile(nip05Raw);

      if (profile) {
        if (profile.pubkey === pubkey) {
          return { value: parsedValue, valid: true, status: 'Verified valid' };
        } else {
          this.logger.warn('NIP-05 profile pubkey mismatch:', profile.pubkey, pubkey);
          return { value: parsedValue, valid: false, status: 'Pubkey mismatch' };
        }
      } else {
        return { value: parsedValue, valid: false, status: 'Profile not found' };
      }
    } catch (error) {
      this.logger.warn('Error verifying NIP-05:', nip05Raw, error);
      return { value: parsedValue, valid: false, status: 'Verification failed' };
    }
  }
}
