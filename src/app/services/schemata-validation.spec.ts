/**
 * Nostr event schema validation tests.
 *
 * Validates that events nostria creates conform to the Nostr protocol spec
 * using JSON Schemas from @nostrability/schemata and the validation pattern
 * from @nostrwatch/schemata-js-ajv.
 *
 * Run standalone: npx tsx src/app/services/schemata-validation.spec.ts
 *
 * @see https://github.com/nostrability/schemata
 * @see https://github.com/sandwichfarm/nostr-watch/tree/next/libraries/schemata-js-ajv
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import { createRequire } from 'node:module';

// Load schemata via createRequire to avoid ESM JSON import issues on Node 22+
const require = createRequire(import.meta.url);
const NostrSchemata: Record<string, unknown> = require('@nostrability/schemata');

// -- validateNote implementation (mirrors @nostrwatch/schemata-js-ajv) --------

interface SchemaValidatorResult {
  valid: boolean;
  errors: any[];
  warnings: any[];
}

function stripNestedSchemaIds(value: any): void {
  if (!value || typeof value !== 'object') return;
  const seen = new WeakSet();
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node) && depth > 0 && typeof node.$id === 'string') {
      delete node.$id;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(node).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0);
}

function stripErrorMessages(value: any): void {
  if (!value || typeof value !== 'object') return;
  const seen = new WeakSet();
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node) && typeof node.errorMessage !== 'undefined') {
      delete node.errorMessage;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item));
      return;
    }
    Object.values(node).forEach((child) => visit(child));
  };
  visit(value);
}

function stripNestedDraftSchemas(value: any): void {
  if (!value || typeof value !== 'object') return;
  const seen = new WeakSet();
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node) && depth > 0 && typeof node.$schema === 'string') {
      delete node.$schema;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(node).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0);
}

function validate(schema: any, data: any): SchemaValidatorResult {
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajvErrors(ajv);
  const clonedSchema = JSON.parse(JSON.stringify(schema));
  stripNestedSchemaIds(clonedSchema);
  stripErrorMessages(clonedSchema);
  stripNestedDraftSchemas(clonedSchema);

  const check = ajv.compile(clonedSchema);
  const valid = check(data);

  return {
    valid: !!valid,
    errors: valid ? [] : (check.errors ?? []),
    warnings: [],
  };
}

function validateNote(event: any): SchemaValidatorResult {
  const { kind } = event;
  const schemaKey = `kind${kind}Schema`;
  const schema = NostrSchemata[schemaKey];
  if (!schema) {
    return {
      valid: false,
      errors: [{ message: `No schema found for kind ${kind}` }],
      warnings: [],
    };
  }
  return validate(schema, event);
}

// -- Test helpers -------------------------------------------------------------

function mockEvent(kind: number, content: string, tags: string[][]): any {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    kind,
    content,
    tags,
    sig: 'e'.repeat(64) + 'f'.repeat(64),
  };
}

// -- Tests --------------------------------------------------------------------

describe('Schemata event validation', () => {

  // NIP-01 core
  it('kind 0 — profile metadata', () => {
    const event = mockEvent(0, JSON.stringify({ name: 'Alice', about: 'Test' }), []);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 0 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 1 — short text note', () => {
    const event = mockEvent(1, 'Hello nostr', []);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-02
  it('kind 3 — contact list', () => {
    const event = mockEvent(3, '{"wss://relay.example.com":{"read":true,"write":true}}', [
      ['p', 'c'.repeat(64), 'alice'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 3 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-09
  it('kind 5 — event deletion', () => {
    const event = mockEvent(5, '', [
      ['e', 'c'.repeat(64)],
      ['k', '1'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 5 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-18
  it('kind 6 — repost', () => {
    const inner = JSON.stringify({
      id: 'd'.repeat(64),
      pubkey: 'c'.repeat(64),
      created_at: 1700000000,
      kind: 1,
      content: 'Original',
      tags: [],
      sig: 'f'.repeat(128),
    });
    const event = mockEvent(6, inner, [
      ['e', 'd'.repeat(64), 'wss://relay.example.com'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 6 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-25
  it('kind 7 — reaction', () => {
    const event = mockEvent(7, '+', [
      ['e', 'c'.repeat(64)],
      ['p', 'd'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 7 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-18
  it('kind 16 — generic repost', () => {
    const event = mockEvent(16, '', [
      ['e', 'c'.repeat(64), 'wss://relay.example.com'],
      ['k', '30023'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 16 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-68 media events
  it('kind 20 — picture', () => {
    const event = mockEvent(20, 'A beautiful sunset', [
      ['title', 'My Photo'],
      ['imeta', 'url https://example.com/photo.jpg', 'm image/jpeg', 'dim 1920x1080'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 20 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 21 — video', () => {
    const event = mockEvent(21, 'A short video description', [
      ['title', 'My Video'],
      ['imeta', 'url https://example.com/video.mp4', 'm video/mp4', 'dim 1920x1080'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 21 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 22 — short video', () => {
    const event = mockEvent(22, 'A vertical video', [
      ['title', 'My Short'],
      ['imeta', 'url https://example.com/short.mp4', 'm video/mp4', 'dim 1080x1920'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 22 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-88 polls
  it('kind 1018 — poll response', () => {
    const event = mockEvent(1018, '', [
      ['response', 'opt1'],
      ['e', 'c'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1018 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 1068 — poll', () => {
    const event = mockEvent(1068, 'What do you think?', [
      ['option', 'opt1', 'Yes'],
      ['option', 'opt2', 'No'],
      ['relay', 'wss://relay.example.com'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1068 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-22
  it('kind 1111 — comment', () => {
    const event = mockEvent(1111, 'Great post!', [
      ['e', 'c'.repeat(64)],
      ['p', 'd'.repeat(64)],
      ['K', '1'],
      ['k', '1111'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1111 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-A0
  it('kind 1222 — voice message', () => {
    const event = mockEvent(1222, 'https://blossom.example.com/audio.mp4', [
      ['imeta', 'url https://blossom.example.com/audio.mp4', 'duration 8'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1222 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 1244 — voice message reply', () => {
    const event = mockEvent(1244, 'https://blossom.example.com/reply.mp4', [
      ['e', 'c'.repeat(64)],
      ['p', 'd'.repeat(64)],
      ['K', '1222'],
      ['k', '1244'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1244 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-53
  it('kind 1311 — live chat message', () => {
    const event = mockEvent(1311, 'Hello live stream!', [
      ['a', '30311:' + 'b'.repeat(64) + ':stream-id'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 1311 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-57
  it('kind 9734 — zap request', () => {
    const event = mockEvent(9734, '', [
      ['p', 'c'.repeat(64)],
      ['relays', 'wss://relay.example.com'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 9734 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-51
  it('kind 10000 — mute list', () => {
    const event = mockEvent(10000, '', [
      ['p', 'c'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 10000 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 10001 — pinned notes', () => {
    const event = mockEvent(10001, '', [
      ['e', 'c'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 10001 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-65
  it('kind 10002 — relay list', () => {
    const event = mockEvent(10002, '', [
      ['r', 'wss://relay.damus.io', 'read'],
      ['r', 'wss://relay.nostr.band', 'write'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 10002 failed: ${JSON.stringify(result.errors)}`);
  });

  // Blossom BUD-03
  it('kind 10063 — media server list', () => {
    const event = mockEvent(10063, '', [
      ['server', 'https://blossom.example.com'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 10063 failed: ${JSON.stringify(result.errors)}`);
  });

  // Blossom BUD-11
  it('kind 24242 — blossom auth', () => {
    const event = mockEvent(24242, 'Upload Blob', [
      ['t', 'upload'],
      ['expiration', '1808858680'],
      ['x', 'c'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 24242 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-98
  it('kind 27235 — HTTP auth', () => {
    const event = mockEvent(27235, '', [
      ['u', 'https://api.example.com/upload'],
      ['method', 'POST'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 27235 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-51
  it('kind 30003 — bookmarks', () => {
    const event = mockEvent(30003, '', [
      ['d', 'bookmarks'],
      ['r', 'https://example.com/article'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 30003 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-58
  it('kind 30008 — badge award', () => {
    const event = mockEvent(30008, '', [
      ['d', 'profile_badges'],
      ['a', '30009:' + 'b'.repeat(64) + ':nostr-og'],
      ['e', 'd'.repeat(64), 'wss://relay.example.com'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 30008 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-23
  it('kind 30023 — long-form article', () => {
    const event = mockEvent(30023, '# My Article\n\nContent here.', [
      ['d', 'my-article-slug'],
      ['title', 'My Article'],
      ['published_at', '1700000000'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 30023 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-53
  it('kind 30311 — live event', () => {
    const event = mockEvent(30311, '', [
      ['d', 'stream-id'],
      ['title', 'My Live Stream'],
      ['streaming', 'https://stream.example.com/live'],
      ['status', 'live'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 30311 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-52 calendar
  it('kind 31922 — date-based calendar event', () => {
    const event = mockEvent(31922, 'All-day conference opening.', [
      ['d', 'event-31922-1'],
      ['title', 'Conference Day'],
      ['start', '2025-12-03'],
      ['end', '2025-12-04'],
      ['location', 'Main Hall'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 31922 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 31923 — time-based calendar event', () => {
    const event = mockEvent(31923, 'Talks and workshops.', [
      ['d', 'event-31923-1'],
      ['title', 'Workshops'],
      ['start', '1764720000'],
      ['end', '1764752400'],
      ['start_tzid', 'America/Denver'],
      ['location', 'Room A'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 31923 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 31924 — calendar', () => {
    const event = mockEvent(31924, '', [
      ['d', 'my-calendar'],
      ['title', 'My Calendar'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 31924 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 31925 — calendar RSVP', () => {
    const event = mockEvent(31925, '', [
      ['d', 'c'.repeat(64)],
      ['a', '31923:' + 'b'.repeat(64) + ':event-id'],
      ['status', 'accepted'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 31925 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-71
  it('kind 34235 — addressable video', () => {
    const event = mockEvent(34235, 'A documentary about nature', [
      ['d', 'video-1'],
      ['title', 'My Documentary'],
      ['imeta', 'url https://example.com/doc.mp4', 'm video/mp4', 'dim 1920x1080'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 34235 failed: ${JSON.stringify(result.errors)}`);
  });

  it('kind 34236 — addressable short video', () => {
    const event = mockEvent(34236, 'A short reel', [
      ['d', 'short-1'],
      ['title', 'My Reel'],
      ['imeta', 'url https://example.com/reel.mp4', 'm video/mp4', 'dim 1080x1920'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 34236 failed: ${JSON.stringify(result.errors)}`);
  });

  // NIP-51
  it('kind 39089 — follow set', () => {
    const event = mockEvent(39089, '', [
      ['d', 'my-follow-set'],
      ['p', 'c'.repeat(64)],
      ['p', 'd'.repeat(64)],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, true, `kind 39089 failed: ${JSON.stringify(result.errors)}`);
  });

  // -- Negative tests: invalid events should fail ---
  it('should reject kind with no schema (kind 999)', () => {
    const event = mockEvent(999, 'hello', []);
    const result = validateNote(event);
    assert.equal(result.valid, false);
  });

  it('should reject event with missing required fields', () => {
    const event = { kind: 1, content: 'hello' };
    const result = validateNote(event);
    assert.equal(result.valid, false);
  });

  it('should reject kind 1222 with non-URL content', () => {
    const event = mockEvent(1222, 'not a url', []);
    const result = validateNote(event);
    assert.equal(result.valid, false);
  });

  it('should reject kind 24242 missing expiration tag', () => {
    const event = mockEvent(24242, 'Upload', [
      ['t', 'upload'],
    ]);
    const result = validateNote(event);
    assert.equal(result.valid, false);
  });
});
