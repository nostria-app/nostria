/**
 * Test Authentication Helper
 *
 * Provides utilities for creating authenticated NostrUser objects
 * from nsec1 strings or hex private keys for E2E testing.
 */
import { getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Minimal NostrUser shape matching the app's NostrUser interface.
 * Defined here to avoid importing Angular-dependent code in E2E tests.
 */
export interface TestNostrUser {
  pubkey: string;
  privkey: string;
  source: 'nsec';
  hasActivated: boolean;
  lastUsed: number;
  isEncrypted: boolean;
}

/**
 * Helper class for creating authenticated test users from Nostr keys.
 *
 * Accepts either an nsec1-encoded private key or a raw 64-character hex
 * private key, derives the public key, and builds a NostrUser object
 * suitable for injecting into the app during E2E tests.
 *
 * @example
 * ```ts
 * const helper = new TestAuthHelper('nsec1...');
 * const user = helper.buildNostrUser();
 * ```
 */
export class TestAuthHelper {
  private readonly privkeyHex: string;
  private readonly pubkeyHex: string;

  /**
   * @param key - An nsec1-encoded private key or a 64-character hex private key
   * @throws Error if the key format is invalid
   */
  constructor(key: string) {
    this.privkeyHex = TestAuthHelper.parsePrivateKey(key);
    this.pubkeyHex = getPublicKey(hexToBytes(this.privkeyHex));
  }

  /**
   * Parse a private key from either nsec1 bech32 or hex format.
   * @returns The private key as a 64-character hex string
   */
  private static parsePrivateKey(key: string): string {
    if (key.startsWith('nsec1')) {
      const decoded = nip19.decode(key);
      if (decoded.type !== 'nsec') {
        throw new Error(`Expected nsec type, got ${decoded.type}`);
      }
      return bytesToHex(decoded.data);
    }

    if (/^[0-9a-f]{64}$/i.test(key)) {
      return key.toLowerCase();
    }

    throw new Error(
      'Invalid key format. Provide an nsec1-encoded string or a 64-character hex private key.'
    );
  }

  /** The hex-encoded public key derived from the private key. */
  get pubkey(): string {
    return this.pubkeyHex;
  }

  /** The hex-encoded private key. */
  get privkey(): string {
    return this.privkeyHex;
  }

  /** The nsec1-encoded private key. */
  get nsec(): string {
    return nip19.nsecEncode(hexToBytes(this.privkeyHex));
  }

  /** The npub1-encoded public key. */
  get npub(): string {
    return nip19.npubEncode(this.pubkeyHex);
  }

  /**
   * Build a NostrUser object ready for injection into the app.
   *
   * @returns A valid NostrUser with source 'nsec', plaintext hex privkey,
   *          hasActivated true, isEncrypted false, and lastUsed set to now.
   */
  buildNostrUser(): TestNostrUser {
    return {
      pubkey: this.pubkeyHex,
      privkey: this.privkeyHex,
      source: 'nsec',
      hasActivated: true,
      lastUsed: Date.now(),
      isEncrypted: false,
    };
  }
}
