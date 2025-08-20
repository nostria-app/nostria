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
          [
            'e',
            'root-event-id',
            'wss://relay1.example.com',
            'root',
            'root-author-pubkey',
          ],
          [
            'e',
            'reply-event-id',
            'wss://relay2.example.com',
            'reply',
            'reply-author-pubkey',
          ],
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
          [
            'e',
            'parent-event-id',
            'wss://relay.example.com',
            '',
            'parent-author',
          ],
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
  });
});
