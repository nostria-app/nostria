/**
 * Test Authentication Helper
 *
 * Provides utilities for creating authenticated NostrUser objects
 * from nsec1 strings or hex private keys for E2E testing.
 */
import 'dotenv/config';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Page } from '@playwright/test';

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
   * Generate a fresh random keypair for testing.
   *
   * Uses `generateSecretKey()` and `getPublicKey()` from `nostr-tools/pure`
   * to create a cryptographically random keypair. Useful as a fallback when
   * no `.env` key (TEST_NSEC) is provided.
   *
   * @returns An object with `nsec` (bech32), `pubkey` (hex), and `privkeyHex` (hex)
   *
   * @example
   * ```ts
   * const keypair = TestAuthHelper.getTestKeypair();
   * const auth = new TestAuthHelper(keypair.nsec);
   * ```
   */
  static getTestKeypair(): { nsec: string; pubkey: string; privkeyHex: string } {
    const privkeyBytes = generateSecretKey();
    const privkeyHex = bytesToHex(privkeyBytes);
    const pubkey = getPublicKey(privkeyBytes);
    const nsec = nip19.nsecEncode(privkeyBytes);
    return { nsec, pubkey, privkeyHex };
  }

  /**
   * Resolve the test keypair from `TEST_NSEC` env var or auto-generate one.
   *
   * If `TEST_NSEC` is set, validates that it is a well-formed nsec1 key
   * and returns a `TestAuthHelper` built from it with `source: 'env'`.
   *
   * If `TEST_NSEC` is not set, generates a random throwaway keypair and
   * logs a warning that authenticated tests will use a random identity
   * with no relay history.
   *
   * @returns `{ auth, source }` where `source` is `'env'` or `'generated'`
   *
   * @example
   * ```ts
   * const { auth, source } = TestAuthHelper.fromEnvOrGenerate();
   * await auth.injectAuth(page);
   * ```
   */
  static fromEnvOrGenerate(): { auth: TestAuthHelper; source: 'env' | 'generated' } {
    const envNsec = process.env['TEST_NSEC'];

    if (envNsec) {
      if (!envNsec.startsWith('nsec1')) {
        throw new Error(
          `TEST_NSEC must be a valid nsec1-encoded private key, got: "${envNsec.slice(0, 10)}..."`
        );
      }

      // Validate the full key by attempting to decode it
      try {
        const decoded = nip19.decode(envNsec);
        if (decoded.type !== 'nsec') {
          throw new Error(`Expected nsec type, got ${decoded.type}`);
        }
      } catch (err) {
        throw new Error(
          `TEST_NSEC is not a valid nsec1 key: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      return { auth: new TestAuthHelper(envNsec), source: 'env' };
    }

    // No TEST_NSEC set — generate a throwaway keypair
    const keypair = TestAuthHelper.getTestKeypair();
    console.warn(
      '⚠ TEST_NSEC not set. Using auto-generated throwaway keypair. ' +
      'Authenticated tests will run with a random identity that has no relay history.'
    );
    return { auth: new TestAuthHelper(keypair.nsec), source: 'generated' };
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

  /**
   * Inject authentication into a Playwright page via `addInitScript`.
   *
   * Sets `localStorage['nostria-account']` and `localStorage['nostria-accounts']`
   * with the constructed NostrUser before the app loads. Must be called
   * before navigating to the app.
   *
   * @param page - The Playwright Page to inject auth into
   *
   * @example
   * ```ts
   * const auth = new TestAuthHelper(process.env.TEST_NSEC!);
   * await auth.injectAuth(page);
   * await page.goto('/');
   * ```
   */
  async injectAuth(page: Page): Promise<void> {
    const user = this.buildNostrUser();
    const userJson = JSON.stringify(user);
    const accountsJson = JSON.stringify([user]);

    await page.addInitScript(({ account, accounts }: { account: string; accounts: string }) => {
      localStorage.setItem('nostria-account', account);
      localStorage.setItem('nostria-accounts', accounts);
    }, { account: userJson, accounts: accountsJson });
  }

  /**
   * Clear authentication from a Playwright page by removing auth keys
   * from localStorage and reloading the page.
   *
   * Removes `nostria-account` and `nostria-accounts` from localStorage,
   * then reloads so the app re-initializes in an unauthenticated state.
   *
   * @param page - The Playwright Page to clear auth from
   *
   * @example
   * ```ts
   * const auth = new TestAuthHelper(process.env.TEST_NSEC!);
   * await auth.injectAuth(page);
   * await page.goto('/');
   * // ... run authenticated tests ...
   * await auth.clearAuth(page);
   * // Page is now unauthenticated
   * ```
   */
  async clearAuth(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        localStorage.removeItem('nostria-account');
        localStorage.removeItem('nostria-accounts');
      });
    } catch {
      // Ignore teardown failures on documents where localStorage is inaccessible
      // (for example cross-origin error pages in flaky network/mobile runs).
    }

    await page.reload().catch(() => undefined);
  }
}
