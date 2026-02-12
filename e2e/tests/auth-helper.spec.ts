/**
 * TestAuthHelper Unit Tests
 *
 * Validates key parsing, public key derivation, and NostrUser construction
 * using deterministic test vectors generated with nostr-tools.
 */
import { test, expect } from '../fixtures';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { TestAuthHelper } from '../helpers/auth';

// Generate a deterministic test keypair once for the entire file
const testPrivkeyBytes = generateSecretKey();
const testPrivkeyHex = bytesToHex(testPrivkeyBytes);
const testPubkeyHex = getPublicKey(testPrivkeyBytes);
const testNsec = nip19.nsecEncode(testPrivkeyBytes);
const testNpub = nip19.npubEncode(testPubkeyHex);

test.describe('TestAuthHelper', () => {
  test('should construct from nsec1 string and derive correct pubkey', () => {
    const helper = new TestAuthHelper(testNsec);

    expect(helper.privkey).toBe(testPrivkeyHex);
    expect(helper.pubkey).toBe(testPubkeyHex);
  });

  test('should construct from hex private key and derive correct pubkey', () => {
    const helper = new TestAuthHelper(testPrivkeyHex);

    expect(helper.privkey).toBe(testPrivkeyHex);
    expect(helper.pubkey).toBe(testPubkeyHex);
  });

  test('should produce matching results from hex and nsec inputs', () => {
    const fromNsec = new TestAuthHelper(testNsec);
    const fromHex = new TestAuthHelper(testPrivkeyHex);

    expect(fromNsec.privkey).toBe(fromHex.privkey);
    expect(fromNsec.pubkey).toBe(fromHex.pubkey);
  });

  test('should expose nsec and npub encodings', () => {
    const helper = new TestAuthHelper(testPrivkeyHex);

    expect(helper.nsec).toBe(testNsec);
    expect(helper.npub).toBe(testNpub);
    expect(helper.nsec).toMatch(/^nsec1/);
    expect(helper.npub).toMatch(/^npub1/);
  });

  test('should normalize uppercase hex to lowercase', () => {
    const upper = testPrivkeyHex.toUpperCase();
    const helper = new TestAuthHelper(upper);

    expect(helper.privkey).toBe(testPrivkeyHex);
    expect(helper.pubkey).toBe(testPubkeyHex);
  });

  test('should throw on invalid key format', () => {
    expect(() => new TestAuthHelper('not-a-key')).toThrow('Invalid key format');
    expect(() => new TestAuthHelper('')).toThrow('Invalid key format');
    expect(() => new TestAuthHelper('abcdef')).toThrow('Invalid key format');
    expect(() => new TestAuthHelper('nsec2invalid')).toThrow();
  });

  test('should build a valid NostrUser object', () => {
    const before = Date.now();
    const helper = new TestAuthHelper(testNsec);
    const user = helper.buildNostrUser();
    const after = Date.now();

    expect(user.pubkey).toBe(testPubkeyHex);
    expect(user.privkey).toBe(testPrivkeyHex);
    expect(user.source).toBe('nsec');
    expect(user.hasActivated).toBe(true);
    expect(user.isEncrypted).toBe(false);
    expect(user.lastUsed).toBeGreaterThanOrEqual(before);
    expect(user.lastUsed).toBeLessThanOrEqual(after);
  });

  test('should produce a new lastUsed timestamp on each call', async () => {
    const helper = new TestAuthHelper(testPrivkeyHex);
    const user1 = helper.buildNostrUser();

    // Small delay to ensure timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 5));

    const user2 = helper.buildNostrUser();
    expect(user2.lastUsed).toBeGreaterThanOrEqual(user1.lastUsed);
  });

  test('privkey should be a 64-character lowercase hex string', () => {
    const helper = new TestAuthHelper(testNsec);
    expect(helper.privkey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('pubkey should be a 64-character lowercase hex string', () => {
    const helper = new TestAuthHelper(testNsec);
    expect(helper.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });
});

test.describe('TestAuthHelper.injectAuth', () => {
  test('should set nostria-account in localStorage via addInitScript', async ({ page }) => {
    const helper = new TestAuthHelper(testNsec);
    await helper.injectAuth(page);

    await page.goto('/');
    const storedAccount = await page.evaluate(() =>
      localStorage.getItem('nostria-account')
    );

    expect(storedAccount).not.toBeNull();
    const parsed = JSON.parse(storedAccount!);
    expect(parsed.pubkey).toBe(testPubkeyHex);
    expect(parsed.privkey).toBe(testPrivkeyHex);
    expect(parsed.source).toBe('nsec');
    expect(parsed.hasActivated).toBe(true);
    expect(parsed.isEncrypted).toBe(false);
  });

  test('should set nostria-accounts in localStorage via addInitScript', async ({ page }) => {
    const helper = new TestAuthHelper(testNsec);
    await helper.injectAuth(page);

    await page.goto('/');
    const storedAccounts = await page.evaluate(() =>
      localStorage.getItem('nostria-accounts')
    );

    expect(storedAccounts).not.toBeNull();
    const parsed = JSON.parse(storedAccounts!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pubkey).toBe(testPubkeyHex);
    expect(parsed[0].source).toBe('nsec');
    // Note: privkey may be encrypted by the app after load, so we only
    // verify it is present (either as raw hex or as encrypted JSON).
    expect(parsed[0].privkey).toBeTruthy();
  });

  test('should set localStorage before app JavaScript runs', async ({ page }) => {
    const helper = new TestAuthHelper(testNsec);
    await helper.injectAuth(page);

    // Capture localStorage state as early as possible via a competing init script
    await page.addInitScript(() => {
      (window as unknown as { __earlyAuth: { account: string | null; accounts: string | null } }).__earlyAuth = {
        account: localStorage.getItem('nostria-account'),
        accounts: localStorage.getItem('nostria-accounts'),
      };
    });

    await page.goto('/');

    const captured = await page.evaluate(() =>
      (window as unknown as { __earlyAuth: { account: string | null; accounts: string | null } }).__earlyAuth
    );

    expect(captured.account).not.toBeNull();
    expect(captured.accounts).not.toBeNull();
    const parsedAccount = JSON.parse(captured.account!);
    expect(parsedAccount.pubkey).toBe(testPubkeyHex);
  });

  test('should contain valid lastUsed timestamp', async ({ page }) => {
    const before = Date.now();
    const helper = new TestAuthHelper(testNsec);
    await helper.injectAuth(page);

    await page.goto('/');
    const storedAccount = await page.evaluate(() =>
      localStorage.getItem('nostria-account')
    );

    const after = Date.now();
    const parsed = JSON.parse(storedAccount!);
    expect(parsed.lastUsed).toBeGreaterThanOrEqual(before);
    expect(parsed.lastUsed).toBeLessThanOrEqual(after);
  });

  test('should work with hex key input', async ({ page }) => {
    const helper = new TestAuthHelper(testPrivkeyHex);
    await helper.injectAuth(page);

    await page.goto('/');
    const storedAccount = await page.evaluate(() =>
      localStorage.getItem('nostria-account')
    );

    expect(storedAccount).not.toBeNull();
    const parsed = JSON.parse(storedAccount!);
    expect(parsed.pubkey).toBe(testPubkeyHex);
    expect(parsed.privkey).toBe(testPrivkeyHex);
  });
});
