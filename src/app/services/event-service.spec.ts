import { Event, kinds } from 'nostr-tools';
import { type NostrRecord } from '../interfaces';
import { type EventInteractions, EventService } from './event';

function createEventServicePrototype(): EventService {
  return Object.create(EventService.prototype) as EventService;
}

function setPrivateField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function createRecord(event: Partial<Event> & Pick<Event, 'id' | 'pubkey' | 'kind'>): NostrRecord {
  return {
    event: {
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      sig: 'test-sig',
      tags: [],
      ...event,
    },
    data: null,
  };
}

type LoadEventInteractionsWithLimits = (
  eventId: string,
  pubkey: string,
  repostKind: number,
  skipReplies: boolean,
  limit: number,
  invalidateCache: boolean,
) => Promise<EventInteractions>;

describe('EventService getEventTags', () => {
  let service: EventService;

  beforeEach(() => {
    service = createEventServicePrototype();
  });

  describe('getEventTags', () => {
    it('should extract relay hints from marked e tags', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', 'wss://relay1.example.com', 'root', 'root-author-pubkey'],
          ['e', 'reply-event-id', 'wss://relay2.example.com', 'reply', 'reply-author-pubkey'],
          ['p', 'mention-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('root-event-id');
      expect(result.replyId).toBe('reply-event-id');
      expect(result.author).toBe('root-author-pubkey');
      expect(result.rootRelays).toEqual(['wss://relay1.example.com']);
      expect(result.replyRelays).toEqual(['wss://relay2.example.com']);
      expect(result.pTags).toEqual(['mention-pubkey']);
    });

    it('should extract relay hints from positional e tags', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', 'wss://relay1.example.com'],
          ['e', 'reply-event-id', 'wss://relay2.example.com'],
          ['p', 'mention-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('root-event-id');
      expect(result.replyId).toBe('reply-event-id');
      expect(result.rootRelays).toEqual(['wss://relay1.example.com']);
      expect(result.replyRelays).toEqual(['wss://relay2.example.com']);
      expect(result.pTags).toEqual(['mention-pubkey']);
    });

    it('should handle single e tag with relay hint', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'parent-event-id', 'wss://relay.example.com', '', 'parent-author'],
          ['p', 'mention-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('parent-event-id');
      expect(result.replyId).toBe('parent-event-id');
      expect(result.author).toBe('parent-author');
      expect(result.rootRelays).toEqual(['wss://relay.example.com']);
      expect(result.replyRelays).toEqual(['wss://relay.example.com']);
      expect(result.pTags).toEqual(['mention-pubkey']);
    });

    it('should handle empty relay URLs gracefully', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', '', 'root'],
          ['e', 'reply-event-id', '   ', 'reply'],
          ['p', 'mention-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('root-event-id');
      expect(result.replyId).toBe('reply-event-id');
      expect(result.rootRelays).toEqual([]);
      expect(result.replyRelays).toEqual([]);
      expect(result.pTags).toEqual(['mention-pubkey']);
    });

    it('should handle events with no e tags', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Original post',
        sig: 'test-sig',
        tags: [['p', 'mention-pubkey']],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBeNull();
      expect(result.replyId).toBeNull();
      expect(result.author).toBeNull();
      expect(result.rootRelays).toEqual([]);
      expect(result.replyRelays).toEqual([]);
      expect(result.pTags).toEqual(['mention-pubkey']);
    });
    it('should extract replyAuthor from marked reply e-tag', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', 'wss://relay1.example.com', 'root', 'root-author-pubkey'],
          ['e', 'reply-event-id', 'wss://relay2.example.com', 'reply', 'reply-author-pubkey'],
          ['p', 'mention-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.author).toBe('root-author-pubkey');
      expect(result.replyAuthor).toBe('reply-author-pubkey');
    });

    it('should extract relay hints from p-tags', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', 'wss://relay1.example.com', 'root', 'root-author-pubkey'],
          ['e', 'reply-event-id', 'wss://relay2.example.com', 'reply', 'reply-author-pubkey'],
          ['p', 'user1-pubkey', 'wss://user1-relay.example.com'],
          ['p', 'user2-pubkey', 'wss://user2-relay.example.com'],
          ['p', 'user1-pubkey', 'wss://user1-second-relay.example.com'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.pTags).toEqual(['user1-pubkey', 'user2-pubkey', 'user1-pubkey']);
      expect(result.pTagRelays.get('user1-pubkey')).toEqual([
        'wss://user1-relay.example.com',
        'wss://user1-second-relay.example.com',
      ]);
      expect(result.pTagRelays.get('user2-pubkey')).toEqual(['wss://user2-relay.example.com']);
    });

    it('should handle p-tags without relay hints', () => {
      const mockEvent: Event = {
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Test reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', '', 'root'],
          ['p', 'user1-pubkey'],
          ['p', 'user2-pubkey', ''],
          ['p', 'user3-pubkey', '   '],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.pTags).toEqual(['user1-pubkey', 'user2-pubkey', 'user3-pubkey']);
      expect(result.pTagRelays.size).toBe(0);
    });

    it('should handle single unmarked e-tag (simple reply format)', () => {
      // This tests the deprecated/simple reply format where a reply only has
      // a single e-tag without root/reply markers pointing to the parent event
      const mockEvent: Event = {
        id: 'reply-event-id',
        pubkey: 'replier-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'A simple reply',
        sig: 'test-sig',
        tags: [
          ['e', 'parent-event-id'],
          ['p', 'parent-author-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      // Single unmarked e-tag should be treated as both root and reply
      expect(result.rootId).toBe('parent-event-id');
      expect(result.replyId).toBe('parent-event-id');
      expect(result.pTags).toEqual(['parent-author-pubkey']);
    });

    it('should preserve nested reply linkage when reply marker exists without root marker but additional e-tags are present', () => {
      // Some clients send inherited thread tags as unmarked e-tags,
      // then only mark the direct parent as reply.
      // We must keep replyId so the event nests one level deeper.
      const mockEvent: Event = {
        id: 'child-reply-id',
        pubkey: 'child-author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Nested reply',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', '', ''],
          ['e', 'parent-reply-id', '', 'reply', 'parent-author-pubkey'],
          ['p', 'parent-author-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('root-event-id');
      expect(result.replyId).toBe('parent-reply-id');
      expect(result.replyAuthor).toBe('parent-author-pubkey');
    });

    it('should infer replyId from last non-root e-tag when root marker exists without reply marker', () => {
      // Some clients include root marker and inherited unmarked thread tags,
      // but omit the explicit reply marker for the direct parent.
      const mockEvent: Event = {
        id: 'child-reply-id',
        pubkey: 'child-author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        content: 'Nested reply without explicit reply marker',
        sig: 'test-sig',
        tags: [
          ['e', 'root-event-id', '', 'root', 'root-author-pubkey'],
          ['e', 'intermediate-reply-id', '', '', 'intermediate-author-pubkey'],
          ['p', 'intermediate-author-pubkey'],
        ],
      };

      const result = service.getEventTags(mockEvent);

      expect(result.rootId).toBe('root-event-id');
      expect(result.replyId).toBe('intermediate-reply-id');
      expect(result.replyAuthor).toBe('intermediate-author-pubkey');
    });
  });
});

describe('EventService limited interaction loading', () => {
  let service: EventService;
  let resolvedRecords: NostrRecord[];
  let getEventsByKindsAndEventTagCalls: unknown[][];

  beforeEach(() => {
    service = createEventServicePrototype();
    resolvedRecords = [];
    getEventsByKindsAndEventTagCalls = [];
    const userDataService = {
      getEventsByKindsAndEventTag: (...args: unknown[]) => {
        getEventsByKindsAndEventTagCalls.push(args);
        return Promise.resolve(resolvedRecords);
      },
    };

    setPrivateField(service, 'userDataService', userDataService);
    setPrivateField(service, 'logger', {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
    });
    setPrivateField(service, 'VALID_REPORT_TYPES', new Set(['spam', 'other']));
  });

  it('should use one widened combined query for timeline interaction loading', async () => {
    resolvedRecords = [
      createRecord({
        id: 'reaction-1',
        pubkey: 'alice',
        kind: kinds.Reaction,
        content: '+',
      }),
      createRecord({
        id: 'repost-1',
        pubkey: 'bob',
        kind: kinds.Repost,
      }),
      createRecord({
        id: 'reply-1',
        pubkey: 'carol',
        kind: kinds.ShortTextNote,
        content: 'reply',
        tags: [['e', 'target-event-id', '', 'reply']],
      }),
      createRecord({
        id: 'report-1',
        pubkey: 'dave',
        kind: kinds.Report,
        tags: [['e', 'target-event-id', 'spam']],
      }),
    ];

    const loadWithLimits = (
      service as unknown as { loadEventInteractionsWithLimits: LoadEventInteractionsWithLimits }
    ).loadEventInteractionsWithLimits.bind(service);

    const result = await loadWithLimits(
      'target-event-id',
      'target-pubkey',
      kinds.Repost,
      false,
      11,
      false,
    );

    expect(getEventsByKindsAndEventTagCalls.length).toBe(1);
    const [calledPubkey, calledKinds, calledEventId, calledOptions] = getEventsByKindsAndEventTagCalls.at(-1) as [
      string,
      number[],
      string,
      {
        limit?: number;
        includeAccountRelays?: boolean;
        cache?: boolean;
        save?: boolean;
        invalidateCache?: boolean;
      },
    ];

    expect(calledPubkey).toBe('target-pubkey');
    expect(calledKinds).toEqual([
      kinds.Reaction,
      kinds.Repost,
      kinds.Report,
      kinds.ShortTextNote,
      1111,
      1244,
    ]);
    expect(calledEventId).toBe('target-event-id');
    expect(calledOptions.limit).toBe(44);
    expect(calledOptions.includeAccountRelays).toBe(true);
    expect(calledOptions.cache).toBe(true);
    expect(calledOptions.save).toBe(true);
    expect(calledOptions.invalidateCache).toBe(false);
    expect(result.reactions.events.map((record) => record.event.id)).toEqual(['reaction-1']);
    expect(result.reposts.map((record) => record.event.id)).toEqual(['repost-1']);
    expect(result.replyCount).toBe(1);
    expect(result.replyEvents.map((event) => event.id)).toEqual(['reply-1']);
    expect(result.reports.events.map((record) => record.event.id)).toEqual(['report-1']);
  });

  it('should keep verification flags active when a widened combined query saturates', async () => {
    resolvedRecords =
      Array.from({ length: 8 }, (_, index) => createRecord({
        id: `reaction-${index}`,
        pubkey: `pubkey-${index}`,
        kind: kinds.Reaction,
        content: '+',
      }))
      ;

    const loadWithLimits = (
      service as unknown as { loadEventInteractionsWithLimits: LoadEventInteractionsWithLimits }
    ).loadEventInteractionsWithLimits.bind(service);

    const result = await loadWithLimits(
      'target-event-id',
      'target-pubkey',
      kinds.Repost,
      false,
      2,
      false,
    );

    expect(result.hasMoreReactions).toBe(true);
    expect(result.hasMoreReposts).toBe(true);
    expect(result.hasMoreReplies).toBe(true);
  });

  it('should count nested descendants when the target event is the thread root', async () => {
    resolvedRecords = [
      createRecord({
        id: 'direct-reply',
        pubkey: 'alice',
        kind: kinds.ShortTextNote,
        content: 'direct reply',
        tags: [['e', 'target-event-id', '', 'reply']],
      }),
      createRecord({
        id: 'nested-reply',
        pubkey: 'bob',
        kind: kinds.ShortTextNote,
        content: 'nested reply',
        tags: [
          ['e', 'target-event-id', '', 'root'],
          ['e', 'child-event-id', '', 'reply'],
        ],
      }),
    ];

    const loadWithLimits = (
      service as unknown as { loadEventInteractionsWithLimits: LoadEventInteractionsWithLimits }
    ).loadEventInteractionsWithLimits.bind(service);

    const result = await loadWithLimits(
      'target-event-id',
      'target-pubkey',
      kinds.Repost,
      false,
      11,
      false,
    );

    expect(result.replyCount).toBe(2);
    expect(result.replyEvents.map((event) => event.id)).toEqual(['direct-reply', 'nested-reply']);
  });
});

describe('EventService interaction cache duration', () => {
  let service: EventService;

  beforeEach(() => {
    service = createEventServicePrototype();
  });

  it('should keep full-detail interaction cache on the default ttl', () => {
    const emptyInteractions: EventInteractions = {
      reactions: { events: [], data: new Map() },
      reposts: [],
      reports: { events: [], data: new Map() },
      replyCount: 0,
      replyEvents: [],
      quotes: [],
    };

    const cacheDuration = (
      service as unknown as { getInteractionCacheDuration: (limit: number | undefined, result: EventInteractions) => number | undefined }
    ).getInteractionCacheDuration(undefined, emptyInteractions);

    expect(cacheDuration).toBeUndefined();
  });

  it('should short-cache empty timeline interaction results', () => {
    const emptyInteractions: EventInteractions = {
      reactions: { events: [], data: new Map() },
      reposts: [],
      reports: { events: [], data: new Map() },
      replyCount: 0,
      replyEvents: [],
      quotes: [],
    };

    const cacheDuration = (
      service as unknown as { getInteractionCacheDuration: (limit: number | undefined, result: EventInteractions) => number | undefined }
    ).getInteractionCacheDuration(11, emptyInteractions);

    expect(cacheDuration).toBe(5000);
  });

  it('should use a shorter ttl for non-empty timeline interaction results', () => {
    const nonEmptyInteractions: EventInteractions = {
      reactions: {
        events: [createRecord({ id: 'reaction-1', pubkey: 'alice', kind: kinds.Reaction, content: '+' })],
        data: new Map([['+', 1]]),
      },
      reposts: [],
      reports: { events: [], data: new Map() },
      replyCount: 0,
      replyEvents: [],
      quotes: [],
    };

    const cacheDuration = (
      service as unknown as { getInteractionCacheDuration: (limit: number | undefined, result: EventInteractions) => number | undefined }
    ).getInteractionCacheDuration(11, nonEmptyInteractions);

    expect(cacheDuration).toBe(30000);
  });
});
