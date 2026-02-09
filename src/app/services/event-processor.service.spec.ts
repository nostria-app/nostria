import { TestBed } from '@angular/core/testing';
import { EventProcessorService } from './event-processor.service';
import { ReportingService } from './reporting.service';
import { DeletionFilterService } from './deletion-filter.service';
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
  let mockReportingService: jasmine.SpyObj<ReportingService>;
  let mockDeletionFilter: jasmine.SpyObj<DeletionFilterService>;
  let mockUtilities: jasmine.SpyObj<UtilitiesService>;
  let mockDataService: jasmine.SpyObj<DataService>;
  let mockLogger: jasmine.SpyObj<LoggerService>;

  beforeEach(() => {
    mockReportingService = jasmine.createSpyObj('ReportingService', [
      'mutedPubkeys',
      'mutedEvents',
      'mutedHashtags',
      'mutedWords',
      'isProfileBlockedByMutedWord',
    ]);
    mockDeletionFilter = jasmine.createSpyObj('DeletionFilterService', ['isDeleted']);
    mockUtilities = jasmine.createSpyObj('UtilitiesService', ['isEventExpired']);
    mockDataService = jasmine.createSpyObj('DataService', ['getCachedProfile']);
    mockLogger = jasmine.createSpyObj('LoggerService', ['debug', 'info', 'warn', 'error']);

    // Default return values
    mockReportingService.mutedPubkeys.and.returnValue([]);
    mockReportingService.mutedEvents.and.returnValue([]);
    mockReportingService.mutedHashtags.and.returnValue([]);
    mockReportingService.mutedWords.and.returnValue([]);
    mockDeletionFilter.isDeleted.and.returnValue(false);
    mockUtilities.isEventExpired.and.returnValue(false);
    mockDataService.getCachedProfile.and.returnValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        EventProcessorService,
        { provide: ReportingService, useValue: mockReportingService },
        { provide: DeletionFilterService, useValue: mockDeletionFilter },
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
      expect(result.accepted).toBeTrue();
    });

    it('should reject events containing muted words in content', () => {
      mockReportingService.mutedWords.and.returnValue(['GM', 'GN']);
      const event = createMockEvent({ content: 'GM everyone! Have a great day!' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_word');
    });

    it('should reject events containing case-insensitive muted words', () => {
      mockReportingService.mutedWords.and.returnValue(['gm']);
      const event = createMockEvent({ content: 'GM ☀️' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_word');
    });

    it('should not reject events where muted word is a substring', () => {
      mockReportingService.mutedWords.and.returnValue(['gm']);
      const event = createMockEvent({ content: 'I love programming' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeTrue();
    });

    it('should reject events from muted pubkeys', () => {
      mockReportingService.mutedPubkeys.and.returnValue(['muted-pubkey']);
      const event = createMockEvent({ pubkey: 'muted-pubkey' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_user');
    });

    it('should reject muted events by id', () => {
      mockReportingService.mutedEvents.and.returnValue(['muted-event-id']);
      const event = createMockEvent({ id: 'muted-event-id' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_event');
    });

    it('should reject events with muted hashtags', () => {
      mockReportingService.mutedHashtags.and.returnValue(['bitcoin']);
      const event = createMockEvent({
        tags: [['t', 'Bitcoin']],
      });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_hashtag');
    });

    it('should reject events with GN muted word', () => {
      mockReportingService.mutedWords.and.returnValue(['GN']);
      const event = createMockEvent({ content: 'GN everyone, sweet dreams! 🌙' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_word');
    });

    it('should not reject events where muted word GN appears inside other words', () => {
      mockReportingService.mutedWords.and.returnValue(['GN']);
      const event = createMockEvent({ content: 'Great design patterns!' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeTrue();
    });

    it('should reject expired events', () => {
      mockUtilities.isEventExpired.and.returnValue(true);
      const event = createMockEvent();
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('expired');
    });

    it('should reject deleted events', () => {
      mockDeletionFilter.isDeleted.and.returnValue(true);
      const event = createMockEvent();
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('deleted');
    });

    it('should skip mute check when skipMuteCheck is true', () => {
      mockReportingService.mutedWords.and.returnValue(['GM']);
      const event = createMockEvent({ content: 'GM everyone!' });
      const result = service.processEvent(event, { skipMuteCheck: true });
      expect(result.accepted).toBeTrue();
    });
  });

  describe('filterEvents', () => {
    it('should filter out events with muted words from a batch', () => {
      mockReportingService.mutedWords.and.returnValue(['GM', 'GN']);
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
      mockReportingService.mutedPubkeys.and.returnValue(['bad-actor']);
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
      mockReportingService.mutedWords.and.returnValue(['GM']);
      const event = createMockEvent({ content: 'GM everyone!' });
      expect(service.shouldAcceptEvent(event)).toBeFalse();
    });

    it('should return true for clean events', () => {
      const event = createMockEvent({ content: 'Hello world' });
      expect(service.shouldAcceptEvent(event)).toBeTrue();
    });

    it('should return false for muted user events', () => {
      mockReportingService.mutedPubkeys.and.returnValue(['muted-user']);
      const event = createMockEvent({ pubkey: 'muted-user' });
      expect(service.shouldAcceptEvent(event)).toBeFalse();
    });

    it('should work with skipStats option', () => {
      mockReportingService.mutedWords.and.returnValue(['GM']);
      const event = createMockEvent({ content: 'GM!' });
      expect(service.shouldAcceptEvent(event, { skipStats: true })).toBeFalse();
    });
  });

  describe('muted words edge cases', () => {
    it('should handle muted word with punctuation around it', () => {
      mockReportingService.mutedWords.and.returnValue(['GM']);
      const event = createMockEvent({ content: '(GM)' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
    });

    it('should handle multiple muted words where one matches', () => {
      mockReportingService.mutedWords.and.returnValue(['spam', 'GM', 'scam']);
      const event = createMockEvent({ content: 'Just saying GM to everyone' });
      const result = service.processEvent(event);
      expect(result.accepted).toBeFalse();
      expect(result.reason).toBe('muted_word');
    });

    it('should not false-positive on nostr URIs containing muted word letters', () => {
      mockReportingService.mutedWords.and.returnValue(['gm']);
      const event = createMockEvent({
        content: 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8',
      });
      const result = service.processEvent(event);
      expect(result.accepted).toBeTrue();
    });
  });
});
