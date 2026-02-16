import { Event } from 'nostr-tools';
import { EventService } from './event';

describe('EventService getEventTags', () => {
  let service: EventService;

  beforeEach(() => {
    // Create a minimal service instance for testing the getEventTags method
    service = new EventService();
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
