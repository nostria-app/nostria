/**
 * Standardized Nostr tag definitions.
 * Each property corresponds to a tag key and contains the same value as the key for ease of use.
 */
export const standardizedTag = {
  /** coordinates to an event (relay URL) - NIP-01 */
  a: 'a',

  /** root address (relay URL) - NIP-22 */
  A: 'A',

  /** identifier - NIP-01 */
  d: 'd',

  /** event id (hex) (relay URL, marker, pubkey (hex)) - NIP-01, NIP-10 */
  e: 'e',

  /** root event id (relay URL) - NIP-22 */
  E: 'E',

  /** currency code - NIP-69 */
  f: 'f',

  /** geohash - NIP-52 */
  g: 'g',

  /** group id - NIP-29 */
  h: 'h',

  /** external identity (proof, url hint) - NIP-35, NIP-39, NIP-73 */
  i: 'i',

  /** root external identity - NIP-22 */
  I: 'I',

  /** kind - NIP-18, NIP-25, NIP-72, NIP-73 */
  k: 'k',

  /** root scope - NIP-22 */
  K: 'K',

  /** label, label namespace, language name - NIP-32, NIP-C0 */
  l: 'l',

  /** label namespace - NIP-32 */
  L: 'L',

  /** MIME type - NIP-94 */
  m: 'm',

  /** pubkey (hex) (relay URL, petname) - NIP-01, NIP-02, NIP-22 */
  p: 'p',

  /** pubkey (hex) - NIP-22, NIP-57 */
  P: 'P',

  /** event id (hex) (relay URL, pubkey (hex)) - NIP-18 */
  q: 'q',

  /** a reference (URL, etc) - NIP-24, NIP-25
   *  relay url (marker) - NIP-65 */
  r: 'r',

  /** status - NIP-69 */
  s: 's',

  /** hashtag - NIP-24, NIP-34, NIP-35 */
  t: 't',

  /** url - NIP-61, NIP-98 */
  u: 'u',

  /** hash - NIP-35, NIP-56 */
  x: 'x',

  /** platform - NIP-69 */
  y: 'y',

  /** order number - NIP-69 */
  z: 'z',

  /** - NIP-70 */
  '-': '-',

  /** summary - NIP-31 */
  alt: 'alt',

  /** millisatoshis, stringified - NIP-57 */
  amount: 'amount',

  /** bolt11 invoice - NIP-57 */
  bolt11: 'bolt11',

  /** challenge string - NIP-42 */
  challenge: 'challenge',

  /** name, address (relay URL) - NIP-89 */
  client: 'client',

  /** git clone URL - NIP-34 */
  clone: 'clone',

  /** reason - NIP-36 */
  'content-warning': 'content-warning',

  /** pubkey, conditions, delegation token - NIP-26 */
  delegation: 'delegation',

  /** Required dependency - NIP-C0 */
  dep: 'dep',

  /** description - NIP-34, NIP-57, NIP-58, NIP-C0 */
  description: 'description',

  /** shortcode, image URL - NIP-30 */
  emoji: 'emoji',

  /** - NIP-90 */
  encrypted: 'encrypted',

  /** File extension - NIP-C0 */
  extension: 'extension',

  /** unix timestamp (string) - NIP-40 */
  expiration: 'expiration',

  /** full path (string) - NIP-35 */
  file: 'file',

  /** event id (hex) (relay URL) - NIP-75 */
  goal: 'goal',

  /** image URL (dimensions in pixels) - NIP-23, NIP-52, NIP-58 */
  image: 'image',

  /** inline metadata - NIP-92 */
  imeta: 'imeta',

  /** License of the shared content - NIP-C0 */
  license: 'license',

  /** bech32 encoded lnurl - NIP-57 */
  lnurl: 'lnurl',

  /** location string - NIP-52, NIP-99 */
  location: 'location',

  /** name - NIP-34, NIP-58, NIP-72, NIP-C0 */
  name: 'name',

  /** random (difficulty) - NIP-13 */
  nonce: 'nonce',

  /** hash of bolt11 invoice - NIP-57 */
  preimage: 'preimage',

  /** price (currency, frequency) - NIP-99 */
  price: 'price',

  /** external ID (protocol) - NIP-48 */
  proxy: 'proxy',

  /** unix timestamp (string) - NIP-23 */
  published_at: 'published_at',

  /** relay url - NIP-42, NIP-17 */
  relay: 'relay',

  /** relay list - NIP-57 */
  relays: 'relays',

  /** Reference to the origin repository - NIP-C0 */
  repo: 'repo',

  /** Runtime or environment specification - NIP-C0 */
  runtime: 'runtime',

  /** file storage server url - NIP-96 */
  server: 'server',

  /** subject - NIP-14, NIP-17, NIP-34 */
  subject: 'subject',

  /** summary - NIP-23, NIP-52 */
  summary: 'summary',

  /** badge thumbnail (dimensions in pixels) - NIP-58 */
  thumb: 'thumb',

  /** article title - NIP-23 */
  title: 'title',

  /** torrent tracker URL - NIP-35 */
  tracker: 'tracker',

  /** webpage URL - NIP-34 */
  web: 'web',

  /** pubkey (hex), relay URL (weight) - NIP-57 */
  zap: 'zap',

  /** https://github.com/nostria-app/nips/blob/master/51.md */
  word: 'word',
} as const;

/**
 * Type definition for standardized Nostr tags.
 * This allows TypeScript to provide autocompletion and type checking when using tag keys.
 */
export type StandardizedTagType = typeof standardizedTag;

/**
 * Type representing all possible tag keys in the Nostr protocol.
 */
export type NostrTagKey = keyof StandardizedTagType;
