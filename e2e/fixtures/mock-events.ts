/**
 * Mock Nostr Events
 *
 * Sample Nostr events with valid structure for injecting into the app's state
 * when needed. All events use a test keypair and have valid IDs/signatures
 * (or placeholders that can be signed at runtime).
 *
 * Event kinds follow NIP-01 and related NIPs:
 * - Kind 0: Profile metadata (NIP-01)
 * - Kind 1: Short text note (NIP-01)
 * - Kind 3: Contact list (NIP-02)
 * - Kind 4: Encrypted DM (NIP-04, deprecated)
 * - Kind 7: Reaction (NIP-25)
 * - Kind 30023: Long-form article (NIP-23)
 * - Kind 1063: File metadata (NIP-94)
 * - Kind 30311: Live stream (NIP-53)
 *
 * IMPORTANT: All timestamps are in SECONDS (Nostr convention), not milliseconds.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a placeholder hex string of the given length */
function placeholderHex(length: number): string {
  return '0'.repeat(length);
}

/** Get current timestamp in seconds (Nostr convention) */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A test pubkey (placeholder — replace with actual test keypair pubkey at runtime) */
const TEST_PUBKEY = placeholderHex(64);

// ─── Mock Events ─────────────────────────────────────────────────────────────

/**
 * Kind 0 — Profile metadata
 *
 * Content is a JSON string with profile information.
 */
export function createMockProfileEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 0,
    tags: [],
    content: JSON.stringify({
      name: 'Test User',
      display_name: 'Test User Display',
      about: 'A test user for E2E testing',
      picture: 'https://robohash.org/test-user.png',
      banner: 'https://picsum.photos/1200/400',
      nip05: 'test@nostria.app',
      lud16: 'test@getalby.com',
      website: 'https://nostria.app',
    }),
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 1 — Short text note
 */
export function createMockNoteEvent(
  content = 'Hello from Nostria E2E tests!',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 1,
    tags: [],
    content,
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 1 — Reply to another note
 */
export function createMockReplyEvent(
  replyToId: string,
  replyToPubkey: string,
  content = 'This is a reply',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 1,
    tags: [
      ['e', replyToId, '', 'reply'],
      ['p', replyToPubkey],
    ],
    content,
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 3 — Contact list
 *
 * Tags contain followed pubkeys.
 */
export function createMockContactListEvent(
  followedPubkeys: string[],
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 3,
    tags: followedPubkeys.map(pk => ['p', pk, '', '']),
    content: JSON.stringify({
      'wss://relay.damus.io': { read: true, write: true },
      'wss://nos.lol': { read: true, write: true },
      'wss://relay.nostr.band': { read: true, write: false },
    }),
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 4 — Encrypted Direct Message (NIP-04, deprecated)
 *
 * Content would normally be encrypted; we use plaintext for testing.
 */
export function createMockDMEvent(
  recipientPubkey: string,
  content = 'Hello, this is a test DM',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 4,
    tags: [['p', recipientPubkey]],
    content, // In real usage, this would be NIP-04 encrypted
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 7 — Reaction
 */
export function createMockReactionEvent(
  reactToId: string,
  reactToPubkey: string,
  reaction = '+',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 7,
    tags: [
      ['e', reactToId],
      ['p', reactToPubkey],
    ],
    content: reaction,
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 6 — Repost
 */
export function createMockRepostEvent(
  repostedEvent: NostrEvent,
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 6,
    tags: [
      ['e', repostedEvent.id, ''],
      ['p', repostedEvent.pubkey],
    ],
    content: JSON.stringify(repostedEvent),
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 30023 — Long-form article (NIP-23)
 */
export function createMockArticleEvent(
  title = 'Test Article',
  content = '# Test Article\n\nThis is a test article for E2E testing.\n\n## Section 1\n\nSome content here.',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  const dTag = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 30023,
    tags: [
      ['d', dTag],
      ['title', title],
      ['summary', 'A test article summary'],
      ['published_at', String(nowSeconds())],
      ['t', 'test'],
      ['t', 'nostr'],
    ],
    content,
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 1063 — File metadata (NIP-94)
 */
export function createMockFileMetadataEvent(
  url = 'https://example.com/test-image.jpg',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 1063,
    tags: [
      ['url', url],
      ['m', 'image/jpeg'],
      ['x', placeholderHex(64)],
      ['size', '102400'],
      ['dim', '1920x1080'],
      ['alt', 'Test image for E2E testing'],
    ],
    content: 'Test file upload',
    sig: placeholderHex(128),
    ...overrides,
  };
}

/**
 * Kind 30311 — Live stream (NIP-53)
 */
export function createMockLiveStreamEvent(
  title = 'Test Live Stream',
  overrides?: Partial<NostrEvent>
): NostrEvent {
  const dTag = `stream-${nowSeconds()}`;
  return {
    id: placeholderHex(64),
    pubkey: TEST_PUBKEY,
    created_at: nowSeconds(),
    kind: 30311,
    tags: [
      ['d', dTag],
      ['title', title],
      ['summary', 'A test live stream'],
      ['streaming', 'https://stream.example.com/live.m3u8'],
      ['status', 'live'],
      ['starts', String(nowSeconds() - 3600)],
      ['t', 'test'],
    ],
    content: '',
    sig: placeholderHex(128),
    ...overrides,
  };
}

// ─── Pre-built Event Collections ─────────────────────────────────────────────

/**
 * A complete set of mock events for a test user's profile.
 * Useful for populating a test scenario with realistic data.
 */
export function createMockUserData(pubkey: string) {
  return {
    profile: createMockProfileEvent({ pubkey }),
    notes: [
      createMockNoteEvent('First test note', { pubkey, created_at: nowSeconds() - 3600 }),
      createMockNoteEvent('Second test note with #nostr', { pubkey, created_at: nowSeconds() - 1800 }),
      createMockNoteEvent('Latest test note', { pubkey, created_at: nowSeconds() }),
    ],
    contacts: createMockContactListEvent(
      [
        '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // jack
        '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d', // fiatjaf
      ],
      { pubkey }
    ),
  };
}

/**
 * A thread of notes (original + replies) for thread rendering tests.
 */
export function createMockThread(depth = 3) {
  const events: NostrEvent[] = [];
  const rootPubkey = placeholderHex(64);

  // Root note
  const root = createMockNoteEvent('This is the root note of a test thread', {
    id: '1'.repeat(64),
    pubkey: rootPubkey,
    created_at: nowSeconds() - depth * 60,
  });
  events.push(root);

  // Replies
  let parentId = root.id;
  for (let i = 1; i < depth; i++) {
    const reply = createMockReplyEvent(
      parentId,
      rootPubkey,
      `Reply level ${i} in the test thread`,
      {
        id: String(i + 1).repeat(64).substring(0, 64),
        created_at: nowSeconds() - (depth - i) * 60,
      }
    );
    events.push(reply);
    parentId = reply.id;
  }

  return events;
}
