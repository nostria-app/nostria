/**
 * Test Data Constants
 *
 * Centralized test data for E2E tests: well-known npubs for profile viewing,
 * known nevent IDs for event viewing, relay URLs for connection testing,
 * and sample content for creation tests.
 *
 * IMPORTANT: These are real public Nostr identities used for read-only testing.
 * Tests should NEVER modify or publish data to these profiles.
 */

// ─── Well-Known Public Profiles ──────────────────────────────────────────────

/**
 * Well-known npubs for profile viewing tests.
 * These are prominent Nostr community members with established profiles.
 */
export const TEST_PROFILES = {
  /** Jack Dorsey — well-known profile with lots of content */
  jack: {
    npub: 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m',
    pubkeyHex: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
    displayName: 'jack',
  },

  /** fiatjaf — Nostr protocol creator */
  fiatjaf: {
    npub: 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6',
    pubkeyHex: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
    displayName: 'fiatjaf',
  },

  /** Hodlbod — well-known Nostr developer */
  hodlbod: {
    npub: 'npub1jlrs53pkdfjnts29kveljul2m0aw07nprq4d3wlryj3gwmgvf65xs40vgc',
    pubkeyHex: '97c70a44d8ee014e09929159564270a2fa1a2a23e1a98bb1c8a2739238e93c53',
    displayName: 'hodlbod',
  },
} as const;

/**
 * Default profile to use in tests when a specific one isn't needed.
 */
export const DEFAULT_TEST_PROFILE = TEST_PROFILES.fiatjaf;

// ─── Well-Known Events ───────────────────────────────────────────────────────

/**
 * Known nevent IDs for event viewing tests.
 * These reference real Nostr events that should be available on most relays.
 */
export const TEST_EVENTS = {
  /** A well-known kind 1 note (sample text note) */
  sampleNote: {
    // This is a placeholder — in production, replace with a known stable event
    nevent: '',
    description: 'Sample text note for rendering tests',
  },
} as const;

// ─── Relay URLs ──────────────────────────────────────────────────────────────

/**
 * Relay URLs for connection testing.
 * These are well-known public relays that should be reliably available.
 */
export const TEST_RELAYS = {
  /** Primary relays — generally reliable */
  primary: [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
  ],

  /** Secondary relays — for fallback testing */
  secondary: [
    'wss://nostr.wine',
    'wss://relay.nostr.bg',
    'wss://nostr-pub.wellorder.net',
  ],

  /** Invalid relay URLs for error handling tests */
  invalid: [
    'wss://invalid.relay.example.com',
    'wss://localhost:9999',
    'not-a-valid-url',
  ],
} as const;

/**
 * Default relay for single-relay tests.
 */
export const DEFAULT_TEST_RELAY = 'wss://relay.damus.io';

// ─── Sample Content ──────────────────────────────────────────────────────────

/**
 * Sample note content for creation tests.
 * Tests should use these to avoid publishing random content.
 */
export const SAMPLE_CONTENT = {
  /** Short text note */
  shortNote: 'Test note from Nostria E2E test suite',

  /** Note with mentions */
  noteWithMention: 'Hello nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6!',

  /** Note with URL */
  noteWithUrl: 'Check out https://nostria.app - a great Nostr client!',

  /** Note with hashtags */
  noteWithHashtags: 'Testing #nostria #nostr #e2e',

  /** Very long note for boundary testing */
  longNote: 'A'.repeat(5000),

  /** Note with special characters */
  specialChars: 'Test <script>alert("xss")</script> & "quotes" \'single\' `backtick`',

  /** Note with emoji */
  emojiNote: 'Testing with emoji: 🎉 🚀 ⚡ 🤙',

  /** Empty content (for validation testing) */
  empty: '',

  /** Content with line breaks */
  multiline: 'Line 1\nLine 2\nLine 3',
} as const;

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * Key application routes for testing.
 */
export const APP_ROUTES = {
  /** Public routes (no auth required) */
  public: {
    home: '/',
    discover: '/discover',
    articles: '/articles',
    music: '/music',
    streams: '/streams',
    search: '/search',
    login: '/login',
  },

  /** Authenticated routes (require login) */
  authenticated: {
    messages: '/messages',
    notifications: '/notifications',
    settings: '/settings',
    settingsDarkMode: '/settings/dark-mode',
    settingsGeneral: '/settings/general',
    profileEdit: '/profile-edit',
    relays: '/relays',
    accounts: '/accounts',
    people: '/people',
    collections: '/collections',
    wallet: '/wallet',
    feeds: '/f',
  },

  /** Profile route generator */
  profile: (npubOrHex: string) => `/p/${npubOrHex}`,

  /** Event route generator */
  event: (neventOrId: string) => `/e/${neventOrId}`,
} as const;

// ─── NIP-19 Test Entities ────────────────────────────────────────────────────

/**
 * NIP-19 encoded entities for deep link testing.
 */
export const NIP19_ENTITIES = {
  /** Valid npub */
  validNpub: TEST_PROFILES.fiatjaf.npub,

  /** Valid nprofile (npub with relay hints) */
  validNprofile: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34k2u3wvdhk6tcppemhxue69uhkummn9ekx7mp0qyg8wumn8ghj7mn0wd68yatjv9mxjerp',

  /** Malformed npub (for error testing) */
  malformedNpub: 'npub1invalidcharactershere',

  /** Malformed nevent */
  malformedNevent: 'nevent1notavalidevent',
} as const;

// ─── Viewport Sizes ──────────────────────────────────────────────────────────

/**
 * Standard viewport sizes for responsive testing.
 */
export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  smallDesktop: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
  ultrawide: { width: 1920, height: 1080 },
} as const;

// ─── Timeouts ────────────────────────────────────────────────────────────────

/**
 * Standard timeout values (in milliseconds) for test operations.
 */
export const TIMEOUTS = {
  /** Wait for Angular app to bootstrap */
  appReady: 30_000,
  /** Wait for page navigation */
  navigation: 15_000,
  /** Wait for relay connection */
  relayConnect: 10_000,
  /** Wait for content to load */
  contentLoad: 10_000,
  /** Wait for animation to complete */
  animation: 1000,
  /** Short stabilization pause */
  stabilize: 500,
} as const;

// ─── LocalStorage Keys ───────────────────────────────────────────────────────

/**
 * Known localStorage keys used by the app.
 */
export const STORAGE_KEYS = {
  account: 'nostria-account',
  accounts: 'nostria-accounts',
  theme: 'nostria-theme',
} as const;
