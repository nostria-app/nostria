import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EventProcessorService } from './event-processor.service';
import { ReportingService } from './reporting.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { Event } from 'nostr-tools';

/**
 * Create a mock Nostr event for testing.
 */
function createMockEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'test-event-id',
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: 'Hello world',
    sig: 'test-sig',
    ...overrides,
  };
}

describe('EventProcessorService', () => {
  let service: EventProcessorService;
  const mutedPubkeysSignal = signal<string[]>([]);
  const mutedEventsSignal = signal<string[]>([]);
  const mutedHashtagsSignal = signal<string[]>([]);
  const mutedWordsSignal = signal<string[]>([]);

  let mockReportingService: Pick<ReportingService, 'mutedPubkeys' | 'mutedEvents' | 'mutedHashtags' | 'mutedWords' | 'isProfileBlockedByMutedWord'>;
  let mockUtilities: Pick<UtilitiesService, 'isEventExpired'>;
  let mockDataService: Pick<DataService, 'getCachedProfile'>;
  let mockLogger: Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'>;

  beforeEach(() => {
    mockReportingService = {
      mutedPubkeys: mutedPubkeysSignal,
      mutedEvents: mutedEventsSignal,
      mutedHashtags: mutedHashtagsSignal,
      mutedWords: mutedWordsSignal,
      isProfileBlockedByMutedWord: vi.fn().mockName("ReportingService.isProfileBlockedByMutedWord")
    };
    mockUtilities = {
      isEventExpired: vi.fn().mockName("UtilitiesService.isEventExpired")
    } as unknown as Pick<UtilitiesService, 'isEventExpired'>;
    mockDataService = {
      getCachedProfile: vi.fn().mockName("DataService.getCachedProfile")
    } as unknown as Pick<DataService, 'getCachedProfile'>;
    mockLogger = {
      debug: vi.fn().mockName("LoggerService.debug"),
      info: vi.fn().mockName("LoggerService.info"),
      warn: vi.fn().mockName("LoggerService.warn"),
      error: vi.fn().mockName("LoggerService.error")
    };

    // Default return values
    mutedPubkeysSignal.set([]);
    mutedEventsSignal.set([]);
    mutedHashtagsSignal.set([]);
    mutedWordsSignal.set([]);
    vi.mocked(mockUtilities.isEventExpired).mockReturnValue(false);
    vi.mocked(mockDataService.getCachedProfile).mockReturnValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        EventProcessorService,
        { provide: ReportingService, useValue: mockReportingService },
        { provide: UtilitiesService, useValue: mockUtilities },
        { provide: DataService, useValue: mockDataService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    });

    service = TestBed.inject(EventProcessorService);
  });

  describe('processEvent', () => {
    it('should accept events with no muted words', () => {
      const event = createMockEvent({ content: 'Hello world' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(true);
    });

    it('should reject events containing muted words in content', () => {
      mutedWordsSignal.set(['GM', 'GN']);
      const event = createMockEvent({ content: 'GM everyone! Have a great day!' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_word');
    });

    it('should reject events containing case-insensitive muted words', () => {
      mutedWordsSignal.set(['gm']);
      const event = createMockEvent({ content: 'GM ☀️' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_word');
    });

    it('should not reject events where muted word is a substring', () => {
      mutedWordsSignal.set(['gm']);
      const event = createMockEvent({ content: 'I love programming' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(true);
    });

    it('should reject events from muted pubkeys', () => {
      mutedPubkeysSignal.set(['muted-pubkey']);
      const event = createMockEvent({ pubkey: 'muted-pubkey' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_user');
    });

    it('should reject muted events by id', () => {
      mutedEventsSignal.set(['muted-event-id']);
      const event = createMockEvent({ id: 'muted-event-id' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_event');
    });

    it('should reject events with muted hashtags', () => {
      mutedHashtagsSignal.set(['bitcoin']);
      const event = createMockEvent({
        tags: [['t', 'Bitcoin']],
      });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_hashtag');
    });

    it('should reject events with GN muted word', () => {
      mutedWordsSignal.set(['GN']);
      const event = createMockEvent({ content: 'GN everyone, sweet dreams! 🌙' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_word');
    });

    it('should not reject events where muted word GN appears inside other words', () => {
      mutedWordsSignal.set(['GN']);
      const event = createMockEvent({ content: 'Great design patterns!' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(true);
    });

    it('should reject expired events', () => {
      vi.mocked(mockUtilities.isEventExpired).mockReturnValue(true);
      const event = createMockEvent();
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('should skip mute check when skipMuteCheck is true', () => {
      mutedWordsSignal.set(['GM']);
      const event = createMockEvent({ content: 'GM everyone!' });
      const result = service.processEvent(event, { skipMuteCheck: true });
      expect(result.accepted).toBe(true);
    });
  });

  describe('filterEvents', () => {
    it('should filter out events with muted words from a batch', () => {
      mutedWordsSignal.set(['GM', 'GN']);
      const events = [
        createMockEvent({ id: '1', content: 'Hello world' }),
        createMockEvent({ id: '2', content: 'GM everyone!' }),
        createMockEvent({ id: '3', content: 'Great post about tech' }),
        createMockEvent({ id: '4', content: 'GN friends' }),
        createMockEvent({ id: '5', content: 'Another normal post' }),
      ];

      const filtered = service.filterEvents(events);
      expect(filtered.length).toBe(3);
      expect(filtered.map(e => e.id)).toEqual(['1', '3', '5']);
    });

    it('should return all events when no muted words are set', () => {
      const events = [
        createMockEvent({ id: '1', content: 'GM everyone!' }),
        createMockEvent({ id: '2', content: 'GN friends' }),
      ];

      const filtered = service.filterEvents(events);
      expect(filtered.length).toBe(2);
    });

    it('should filter out events from muted users in a batch', () => {
      mutedPubkeysSignal.set(['bad-actor']);
      const events = [
        createMockEvent({ id: '1', pubkey: 'good-user', content: 'Hello' }),
        createMockEvent({ id: '2', pubkey: 'bad-actor', content: 'Spam' }),
        createMockEvent({ id: '3', pubkey: 'good-user', content: 'World' }),
      ];

      const filtered = service.filterEvents(events);
      expect(filtered.length).toBe(2);
      expect(filtered.map(e => e.id)).toEqual(['1', '3']);
    });
  });

  describe('shouldAcceptEvent', () => {
    it('should return false for events with muted words', () => {
      mutedWordsSignal.set(['GM']);
      const event = createMockEvent({ content: 'GM everyone!' });
      expect(service.shouldAcceptEvent(event)).toBe(false);
    });

    it('should return true for clean events', () => {
      const event = createMockEvent({ content: 'Hello world' });
      expect(service.shouldAcceptEvent(event)).toBe(true);
    });

    it('should return false for muted user events', () => {
      mutedPubkeysSignal.set(['muted-user']);
      const event = createMockEvent({ pubkey: 'muted-user' });
      expect(service.shouldAcceptEvent(event)).toBe(false);
    });

    it('should work with skipStats option', () => {
      mutedWordsSignal.set(['GM']);
      const event = createMockEvent({ content: 'GM!' });
      expect(service.shouldAcceptEvent(event, { skipStats: true })).toBe(false);
    });
  });

  describe('muted words edge cases', () => {
    it('should handle muted word with punctuation around it', () => {
      mutedWordsSignal.set(['GM']);
      const event = createMockEvent({ content: '(GM)' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
    });

    it('should handle multiple muted words where one matches', () => {
      mutedWordsSignal.set(['spam', 'GM', 'scam']);
      const event = createMockEvent({ content: 'Just saying GM to everyone' });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('muted_word');
    });

    it('should not false-positive on nostr URIs containing muted word letters', () => {
      mutedWordsSignal.set(['gm']);
      const event = createMockEvent({
        content: 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8',
      });
      const result = service.processEvent(event);
      expect(result.accepted).toBe(true);
    });
  });
});
