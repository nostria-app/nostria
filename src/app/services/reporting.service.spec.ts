import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Event, UnsignedEvent } from 'nostr-tools';
import { ReportingService } from './reporting.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { NostrService, NostrUser } from './nostr.service';
import { SettingsService } from './settings.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';

describe('ReportingService', () => {
  describe('stripNostrUrisAndUrls', () => {
    it('should strip nostr:npub URIs', () => {
      const content = 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8 world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Hello   world');
    });

    it('should strip nostr:nprofile URIs', () => {
      const content = 'Check nostr:nprofile1abc123def456ghi world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Check   world');
    });

    it('should strip nostr:nevent URIs', () => {
      const content = 'See nostr:nevent1qvzqqqqqqypzpa9hhag3wymekqxfcqqwsz3fplfj7yxnmpfnvmwn0qpc2k8f5ds9qy2hwumn8ghj7un9d3shjtnwdaehgu3wdp6j7qpq3atmkylmlmcqc3uemk63tp06y9wp0rc86kx4l89agpev5qdg9gusa5qfjk end';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('See   end');
    });

    it('should strip nostr:note URIs', () => {
      const content = 'Look at nostr:note1abc123 here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Look at   here');
    });

    it('should strip nostr:naddr URIs', () => {
      const content = 'Read nostr:naddr1abc123def please';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Read   please');
    });

    it('should strip HTTP URLs', () => {
      const content = 'Visit http://example.com/page here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Visit   here');
    });

    it('should strip HTTPS URLs', () => {
      const content = 'Visit https://nostria.app/e/something here';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Visit   here');
    });

    it('should strip multiple nostr URIs and URLs', () => {
      const content = 'Hello nostr:npub1abc123 and https://example.com world';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Hello   and   world');
    });

    it('should handle content with no URIs', () => {
      const content = 'Just a normal message';
      const result = ReportingService.stripNostrUrisAndUrls(content);
      expect(result).toBe('Just a normal message');
    });

    it('should handle empty content', () => {
      expect(ReportingService.stripNostrUrisAndUrls('')).toBe('');
    });
  });

  describe('wordMatchesMutedWord', () => {
    it('should match exact word (case insensitive)', () => {
      expect(ReportingService.wordMatchesMutedWord('GM everyone!', 'gm')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('gm everyone!', 'GM')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('Gm everyone!', 'gm')).toBe(true);
    });

    it('should match word at start of text', () => {
      expect(ReportingService.wordMatchesMutedWord('GM!', 'gm')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('GM to all', 'gm')).toBe(true);
    });

    it('should match word at end of text', () => {
      expect(ReportingService.wordMatchesMutedWord('Say GM', 'gm')).toBe(true);
    });

    it('should match word that is the entire text', () => {
      expect(ReportingService.wordMatchesMutedWord('GM', 'gm')).toBe(true);
    });

    it('should match word followed by punctuation', () => {
      expect(ReportingService.wordMatchesMutedWord('GM!', 'gm')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('GM.', 'gm')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('GM,', 'gm')).toBe(true);
    });

    it('should NOT match word as substring of another word', () => {
      expect(ReportingService.wordMatchesMutedWord('programming', 'gm')).toBe(false);
      expect(ReportingService.wordMatchesMutedWord('telegram', 'gm')).toBe(false);
      expect(ReportingService.wordMatchesMutedWord('enigma', 'gm')).toBe(false);
    });

    it('should NOT match word inside npub-like strings', () => {
      // After stripping, these wouldn't appear, but test the boundary matching itself
      expect(ReportingService.wordMatchesMutedWord('abc123gm456def', 'gm')).toBe(false);
    });

    it('should match multi-word muted phrases', () => {
      expect(ReportingService.wordMatchesMutedWord('good morning friends', 'good morning')).toBe(true);
    });

    it('should handle special regex characters in muted word', () => {
      expect(ReportingService.wordMatchesMutedWord('price is $100', '$100')).toBe(true);
      expect(ReportingService.wordMatchesMutedWord('test (hello) world', '(hello)')).toBe(true);
    });
  });

  describe('contentContainsMutedWord', () => {
    it('should return false for undefined content', () => {
      expect(ReportingService.contentContainsMutedWord(undefined, ['gm'])).toBe(false);
    });

    it('should return false for empty muted words', () => {
      expect(ReportingService.contentContainsMutedWord('GM everyone', [])).toBe(false);
    });

    it('should match GM in actual GM post', () => {
      expect(ReportingService.contentContainsMutedWord('GM ☀️', ['gm'])).toBe(true);
    });

    it('should match GM post with emoji and text', () => {
      expect(ReportingService.contentContainsMutedWord('GM everyone! Have a great day!', ['gm'])).toBe(true);
    });

    it('should NOT match GM inside nostr:npub URIs', () => {
      const content = 'Hello nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(false);
    });

    it('should NOT match GM inside nostr:nprofile URIs', () => {
      const content = 'Check nostr:nprofile1abcgmdef123';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(false);
    });

    it('should NOT match GM inside nostr:nevent URIs', () => {
      const content = 'See nostr:nevent1qvzqqqqqqypzpa9hhag3wymekqxfcqqwsz3fplfj7yxnmpfnvmwn0qpc2k8f5ds9qy2hwumn8ghj7un9d3shjtnwdaehgu3wdp6j7qpq3atmkylmlmcqc3uemk63tp06y9wp0rc86kx4l89agpev5qdg9gusa5qfjk';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(false);
    });

    it('should NOT match GM inside URLs', () => {
      const content = 'Check https://example.com/gmailhelp for info';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(false);
    });

    it('should match GM in content that also has npub references', () => {
      const content = 'GM nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(true);
    });

    it('should NOT match muted word as substring in regular text', () => {
      const content = 'I love programming and algorithms';
      expect(ReportingService.contentContainsMutedWord(content, ['gm'])).toBe(false);
    });

    it('should match multiple muted words', () => {
      const content = 'GM everyone! Have a blessed day!';
      expect(ReportingService.contentContainsMutedWord(content, ['hello', 'gm'])).toBe(true);
    });

    it('should not match when no muted words are in content', () => {
      const content = 'Hello everyone! Have a great day!';
      expect(ReportingService.contentContainsMutedWord(content, ['gm', 'spam'])).toBe(false);
    });
  });

  describe('fieldsContainMutedWord', () => {
    it('should return false for empty fields', () => {
      expect(ReportingService.fieldsContainMutedWord([], ['gm'])).toBe(false);
    });

    it('should return false for empty muted words', () => {
      expect(ReportingService.fieldsContainMutedWord(['test'], [])).toBe(false);
    });

    it('should match muted word in profile name', () => {
      expect(ReportingService.fieldsContainMutedWord(['spammer', 'GM Bot'], ['gm'])).toBe(true);
    });

    it('should NOT match muted word as substring in profile name', () => {
      expect(ReportingService.fieldsContainMutedWord(['programmer'], ['gm'])).toBe(false);
    });

    it('should match case-insensitively', () => {
      expect(ReportingService.fieldsContainMutedWord(['GM Master'], ['gm'])).toBe(true);
      expect(ReportingService.fieldsContainMutedWord(['gm lover'], ['GM'])).toBe(true);
    });

    it('should match muted domain substring inside a nip05 identifier', () => {
      const fields = ReportingService.collectProfileFieldsForMutedWordCheck({
        nip05: 'evshift_at_channels.im@momostr.pink',
      });

      expect(ReportingService.fieldsContainMutedWord(fields, ['channels.im'])).toBe(true);
    });

    it('should match muted domain substring inside a lud16 identifier', () => {
      const fields = ReportingService.collectProfileFieldsForMutedWordCheck({
        lud16: 'tips@channels.im',
      });

      expect(ReportingService.fieldsContainMutedWord(fields, ['channels.im'])).toBe(true);
    });

    it('should keep whole-word matching for profile names', () => {
      const fields = ReportingService.collectProfileFieldsForMutedWordCheck({
        name: 'programmer',
      });

      expect(ReportingService.fieldsContainMutedWord(fields, ['gm'])).toBe(false);
    });
  });

  describe('mute list updates', () => {
    let service: ReportingService;
    let mockAccountStateService: Pick<AccountStateService, 'account' | 'muteList' | 'updateMuteList'>;
    let mockAccountRelayService: Pick<AccountRelayService, 'getEventByPubkeyAndKind'>;
    let mockDatabaseService: Pick<DatabaseService, 'getEventByPubkeyAndKind' | 'saveReplaceableEvent'>;
    let mockNostrService: Pick<NostrService, 'signEvent'>;
    let mockPublishService: Pick<PublishService, 'publish'>;
    let mockLoggerService: Pick<LoggerService, 'debug' | 'error' | 'info' | 'warn'>;

    const accountPubkey = 'account-pubkey';

    const createMuteListEvent = (id: string, createdAt: number, tags: string[][]): Event => ({
      id,
      sig: `${id}-sig`,
      kind: 10000,
      created_at: createdAt,
      content: '',
      tags,
      pubkey: accountPubkey,
    });

    beforeEach(() => {
      mockAccountStateService = {
        account: signal<NostrUser | null>({
          pubkey: accountPubkey,
          source: 'extension',
          hasActivated: true,
        }),
        muteList: signal<Event | undefined>(undefined),
        updateMuteList: vi.fn(),
      };
      mockAccountRelayService = {
        getEventByPubkeyAndKind: vi.fn(),
      };
      mockDatabaseService = {
        getEventByPubkeyAndKind: vi.fn(),
        saveReplaceableEvent: vi.fn().mockResolvedValue(true),
      };
      mockNostrService = {
        signEvent: vi.fn(async (event: UnsignedEvent) => ({
          ...event,
          id: 'signed-event',
          sig: 'signed-sig',
        })),
      };
      mockPublishService = {
        publish: vi.fn(async (event: Event) => ({
          success: true,
          relayResults: new Map(),
          event,
        })),
      };
      mockLoggerService = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };

      TestBed.configureTestingModule({
        providers: [
          ReportingService,
          { provide: AccountStateService, useValue: mockAccountStateService },
          { provide: UtilitiesService, useValue: { createEvent: vi.fn() } },
          { provide: DataService, useValue: {} },
          { provide: LoggerService, useValue: mockLoggerService },
          { provide: NostrService, useValue: mockNostrService },
          { provide: SettingsService, useValue: {} },
          { provide: PublishService, useValue: mockPublishService },
          { provide: AccountRelayService, useValue: mockAccountRelayService },
          { provide: DatabaseService, useValue: mockDatabaseService },
        ],
      });

      service = TestBed.inject(ReportingService);
    });

    it('should preserve the latest relay mute list when creating a fresh mute list event', async () => {
      const relayMuteList = createMuteListEvent('relay-event', 200, [['p', 'existing-user']]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(relayMuteList);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(null);

      const signedEvent = await service.createFreshMuteListEvent('user', 'new-user');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'existing-user'], ['p', 'new-user']],
      }));
      expect(mockDatabaseService.saveReplaceableEvent).toHaveBeenCalledWith(signedEvent);
      expect(mockAccountStateService.muteList()).toEqual(signedEvent);
    });

    it('should preserve other mute entries when unblocking a user without local mute state', async () => {
      const storedMuteList = createMuteListEvent('stored-event', 150, [
        ['p', 'keep-user'],
        ['p', 'remove-user'],
        ['e', 'muted-event'],
      ]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(null);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(storedMuteList);

      const signedEvent = await service.createFreshMuteListWithoutUser('remove-user');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'keep-user'], ['e', 'muted-event']],
      }));
      expect(mockDatabaseService.saveReplaceableEvent).toHaveBeenCalledWith(signedEvent);
      expect(mockAccountStateService.muteList()).toEqual(signedEvent);
    });

    it('should prefer the newest mute list between relay and storage', async () => {
      const storedMuteList = createMuteListEvent('stored-event', 150, [['p', 'stored-user']]);
      const relayMuteList = createMuteListEvent('relay-event', 250, [['p', 'relay-user']]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(relayMuteList);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(storedMuteList);

      await service.createFreshMuteListEvent('user', 'new-user');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'relay-user'], ['p', 'new-user']],
      }));
    });

    it('should hydrate the latest relay mute list before adding a muted word', async () => {
      const relayMuteList = createMuteListEvent('relay-event', 220, [['p', 'existing-user']]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(relayMuteList);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(null);

      await service.addWordToMuteListAndPublish('Spoiler');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'existing-user'], ['word', 'spoiler']],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'existing-user'], ['word', 'spoiler']],
      }));
    });

    it('should hydrate the latest relay mute list before adding a muted tag', async () => {
      const relayMuteList = createMuteListEvent('relay-event', 220, [['p', 'existing-user']]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(relayMuteList);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(null);

      await service.addTagToMuteListAndPublish('Nostr');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'existing-user'], ['t', 'nostr']],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'existing-user'], ['t', 'nostr']],
      }));
    });

    it('should hydrate the latest stored mute list before removing an item', async () => {
      const storedMuteList = createMuteListEvent('stored-event', 180, [
        ['p', 'keep-user'],
        ['word', 'spoiler'],
        ['t', 'nostr'],
      ]);
      vi.mocked(mockAccountRelayService.getEventByPubkeyAndKind).mockResolvedValue(null);
      vi.mocked(mockDatabaseService.getEventByPubkeyAndKind).mockResolvedValue(storedMuteList);

      await service.removeFromMuteListAndPublish({ type: 'word', value: 'spoiler' });

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'keep-user'], ['t', 'nostr']],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'keep-user'], ['t', 'nostr']],
      }));
    });
  });
});
