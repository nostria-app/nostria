import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, UnsignedEvent } from 'nostr-tools';
import { ReportingService } from './reporting.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { EncryptionService } from './encryption.service';
import { LoggerService } from './logger.service';
import { NostrService, NostrUser } from './nostr.service';
import { SettingsService } from './settings.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { PoolService } from './relays/pool.service';
import { UserRelaysService } from './relays/user-relays';
import { DatabaseService } from './database.service';
import { MessagingService } from './messaging.service';
import { applyMuteListChange, pickNewestMuteList } from '../utils/mute-list';

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

  describe('mute list merge', () => {
    it('keeps unknown public tags and private tags when one entry is added', () => {
      const merged = applyMuteListChange(
        [
          ['p', 'public-user'],
          ['client', 'amethyst', 'extra'],
        ],
        [
          ['p', 'private-user', 'wss://relay.example'],
          ['word', 'secret'],
        ],
        { action: 'add', type: 'word', value: 'spoiler' },
      );

      expect(merged.publicTags).toEqual([
        ['p', 'public-user'],
        ['client', 'amethyst', 'extra'],
        ['word', 'spoiler'],
      ]);
      expect(merged.privateTags).toEqual([
        ['p', 'private-user', 'wss://relay.example'],
        ['word', 'secret'],
      ]);
    });

    it('removes an entry from both the public and private copies', () => {
      const merged = applyMuteListChange(
        [['p', 'keep-user'], ['e', 'thread']],
        [['p', 'remove-user'], ['t', 'nostr']],
        { action: 'remove', type: 'p', value: 'remove-user' },
      );

      expect(merged.publicTags).toEqual([['p', 'keep-user'], ['e', 'thread']]);
      expect(merged.privateTags).toEqual([['t', 'nostr']]);
    });

    it('keeps the lowest event id when created_at matches', () => {
      const low = {
        id: '000',
        sig: 'low-sig',
        kind: 10000,
        created_at: 50,
        content: '',
        tags: [['p', 'low-id']],
        pubkey: 'account',
      };
      const high = { ...low, id: 'fff', tags: [['p', 'high-id']] };

      expect(pickNewestMuteList([high, low])?.id).toBe('000');
      expect(pickNewestMuteList([low, high])?.id).toBe('000');
    });
  });

  describe('mute list updates', () => {
    let service: ReportingService;
    let mockAccountStateService: Pick<AccountStateService, 'account' | 'muteList' | 'privateMuteTags' | 'updateMuteList'>;
    let mockAccountRelayService: Pick<AccountRelayService, 'relays' | 'getRelayUrls'>;
    let mockDatabaseService: Pick<DatabaseService, 'saveReplaceableEvent'>;
    let mockNostrService: Pick<NostrService, 'signEvent'>;
    let mockPublishService: Pick<PublishService, 'publish'>;
    let mockLoggerService: Pick<LoggerService, 'debug' | 'error' | 'info' | 'warn'>;
    let mockUserRelays: Pick<UserRelaysService, 'getUserRelays'>;
    let mockEncryption: Pick<EncryptionService, 'decryptNip44' | 'decryptNip04' | 'encryptNip44'>;
    let ensureRelay: ReturnType<typeof vi.fn>;
    let snackBar: { open: ReturnType<typeof vi.fn> };

    const accountPubkey = 'account-pubkey';
    const writeRelay = 'wss://write.example';
    const outboxRelay = 'wss://outbox.example';
    const deadRelay = 'wss://dead.example';

    interface RelaySubParams {
      onevent?: (event: Event) => void;
      oneose?: () => void;
      onclose?: (reason: string) => void;
    }

    const createMuteListEvent = (
      id: string,
      createdAt: number,
      tags: string[][],
      content = '',
    ): Event => ({
      id,
      sig: `${id}-sig`,
      kind: 10000,
      created_at: createdAt,
      content,
      tags,
      pubkey: accountPubkey,
    });

    const deliverRelays = (
      events: Event[] | Record<string, Event[]>,
      eose: boolean | Record<string, boolean> = true,
    ) => {
      ensureRelay.mockImplementation(async (url: string) => ({
        url,
        subscribe: (_filters: unknown, params: RelaySubParams) => {
          const relayEvents = Array.isArray(events) ? events : events[url] ?? [];
          for (const event of relayEvents) params.onevent?.(event);
          const reached = typeof eose === 'boolean' ? eose : eose[url] ?? true;
          if (reached) params.oneose?.();
          else params.onclose?.('timeout');
          return { close: vi.fn() };
        },
      }));
    };

    beforeEach(() => {
      ensureRelay = vi.fn(async (url: string) => ({
        url,
        subscribe: (_filters: unknown, params: RelaySubParams) => {
          params.oneose?.();
          return { close: vi.fn() };
        },
      }));
      snackBar = { open: vi.fn() };
      mockAccountStateService = {
        account: signal<NostrUser | null>({
          pubkey: accountPubkey,
          source: 'extension',
          hasActivated: true,
        }),
        muteList: signal<Event | undefined>(undefined),
        privateMuteTags: signal<string[][]>([]),
        updateMuteList: vi.fn(),
      };
      mockAccountRelayService = {
        relays: signal([{ url: writeRelay, read: true, write: true }]),
        getRelayUrls: vi.fn().mockReturnValue([writeRelay]),
      };
      mockUserRelays = {
        getUserRelays: vi.fn().mockResolvedValue([outboxRelay]),
      };
      mockEncryption = {
        decryptNip44: vi.fn().mockRejectedValue(new Error('not nip44')),
        decryptNip04: vi.fn().mockRejectedValue(new Error('not nip04')),
        encryptNip44: vi.fn().mockResolvedValue('re-encrypted'),
      };
      mockDatabaseService = {
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
          provideZonelessChangeDetection(),
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
          { provide: MessagingService, useValue: {} },
          { provide: UserRelaysService, useValue: mockUserRelays },
          { provide: PoolService, useValue: { pool: { ensureRelay } } },
          { provide: EncryptionService, useValue: mockEncryption },
          { provide: MatSnackBar, useValue: snackBar },
        ],
      });

      service = TestBed.inject(ReportingService);
    });

    it('should preserve the latest relay mute list when creating a fresh mute list event', async () => {
      const relayMuteList = createMuteListEvent('relay-event', 200, [['p', 'existing-user']]);
      deliverRelays([relayMuteList]);

      const signedEvent = await service.createFreshMuteListEvent('user', 'new-user');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        content: '',
        tags: [['p', 'existing-user'], ['p', 'new-user']],
      }));
      expect(mockDatabaseService.saveReplaceableEvent).toHaveBeenCalledWith(signedEvent);
      expect(mockAccountStateService.muteList()).toEqual(signedEvent);
    });

    it('should preserve other mute entries when unblocking a user', async () => {
      deliverRelays([createMuteListEvent('relay-event', 150, [
        ['p', 'keep-user'],
        ['p', 'remove-user'],
        ['e', 'muted-event'],
      ])]);

      const signedEvent = await service.createFreshMuteListWithoutUser('remove-user');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'keep-user'], ['e', 'muted-event']],
      }));
      expect(mockDatabaseService.saveReplaceableEvent).toHaveBeenCalledWith(signedEvent);
      expect(mockAccountStateService.muteList()).toEqual(signedEvent);
    });

    it('should prefer the newest mute list across write relays and outbox relays', async () => {
      const writeMuteList = createMuteListEvent('write-event', 150, [['p', 'write-user']]);
      const outboxMuteList = createMuteListEvent('outbox-event', 250, [['p', 'outbox-user']]);
      deliverRelays({
        [writeRelay]: [writeMuteList],
        [outboxRelay]: [outboxMuteList],
      });

      await service.createFreshMuteListEvent('user', 'new-user');

      expect(ensureRelay).toHaveBeenCalledWith(writeRelay);
      expect(ensureRelay).toHaveBeenCalledWith(outboxRelay);
      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'outbox-user'], ['p', 'new-user']],
      }));
    });

    it('should keep public tags, unknown tags, and private entries when adding one word', async () => {
      const privateTags = [
        ['p', 'private-user', 'wss://relay.example'],
        ['word', 'secret'],
      ];
      vi.mocked(mockEncryption.decryptNip44).mockResolvedValue(JSON.stringify(privateTags));
      deliverRelays([createMuteListEvent('relay-event', 300, [
        ['p', 'public-user'],
        ['word', 'spoiler'],
        ['t', 'nostr'],
        ['e', 'thread-id'],
        ['client', 'amethyst', 'extra'],
      ], 'nip44-ciphertext')]);

      await service.addWordToMuteListAndPublish('NewWord');

      expect(mockEncryption.encryptNip44).toHaveBeenCalledWith(JSON.stringify(privateTags), accountPubkey);
      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        content: 're-encrypted',
        tags: [
          ['p', 'public-user'],
          ['word', 'spoiler'],
          ['t', 'nostr'],
          ['e', 'thread-id'],
          ['client', 'amethyst', 'extra'],
          ['word', 'newword'],
        ],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        content: 're-encrypted',
        tags: expect.arrayContaining([['word', 'newword'], ['client', 'amethyst', 'extra']]),
      }));
    });

    it('should fall back to NIP-04 when NIP-44 decryption fails and still re-encrypt private entries', async () => {
      const privateTags = [['p', 'private-user']];
      vi.mocked(mockEncryption.decryptNip44).mockRejectedValue(new Error('nip44 failed'));
      vi.mocked(mockEncryption.decryptNip04).mockResolvedValue(JSON.stringify(privateTags));
      deliverRelays([createMuteListEvent('relay-event', 300, [['p', 'public-user']], 'nip04-ciphertext')]);

      await service.addTagToMuteListAndPublish('Nostr');

      expect(mockEncryption.decryptNip04).toHaveBeenCalled();
      expect(mockEncryption.encryptNip44).toHaveBeenCalledWith(JSON.stringify(privateTags), accountPubkey);
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        content: 're-encrypted',
        tags: [['p', 'public-user'], ['t', 'nostr']],
      }));
    });

    it('should hydrate the latest relay mute list before adding a muted tag', async () => {
      deliverRelays([createMuteListEvent('relay-event', 220, [['p', 'existing-user']])]);

      await service.addTagToMuteListAndPublish('Nostr');

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'existing-user'], ['t', 'nostr']],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'existing-user'], ['t', 'nostr']],
      }));
    });

    it('should hydrate the latest relay mute list before removing an item', async () => {
      deliverRelays([createMuteListEvent('relay-event', 180, [
        ['p', 'keep-user'],
        ['word', 'spoiler'],
        ['t', 'nostr'],
      ])]);

      await service.removeFromMuteListAndPublish({ type: 'word', value: 'spoiler' });

      expect(mockNostrService.signEvent).toHaveBeenCalledWith(expect.objectContaining({
        pubkey: accountPubkey,
        tags: [['p', 'keep-user'], ['t', 'nostr']],
      }));
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'keep-user'], ['t', 'nostr']],
      }));
    });

    it('should publish a new list when write and outbox relays confirm there is none', async () => {
      deliverRelays([]);

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        content: '',
        tags: [['word', 'spoiler']],
      }));
    });

    it('should not publish when fewer than two relays answer', async () => {
      mockAccountStateService.muteList.set(createMuteListEvent('cached-event', 900, [
        ['p', 'cached-user'],
        ['word', 'cached-word'],
      ]));
      deliverRelays(
        { [writeRelay]: [createMuteListEvent('partial-event', 100, [['p', 'only-partial']])] },
        { [writeRelay]: true, [outboxRelay]: false },
      );

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining(outboxRelay),
        expect.any(String),
        expect.any(Object),
      );
      expect(snackBar.open.mock.calls[0][0]).not.toContain(writeRelay);
      expect(mockAccountStateService.muteList()?.id).toBe('cached-event');
    });

    it('should publish the merged list when one relay is dead and the quorum is met', async () => {
      mockAccountRelayService.relays.set([
        { url: writeRelay, read: true, write: true },
        { url: deadRelay, read: true, write: true },
      ]);
      const older = createMuteListEvent('write-event', 100, [['p', 'old-user'], ['client', 'amethyst']]);
      const newer = createMuteListEvent('outbox-event', 400, [
        ['p', 'kept-user'],
        ['word', 'secret'],
        ['client', 'amethyst', 'extra'],
      ], 'ciphertext');
      vi.mocked(mockEncryption.decryptNip44).mockResolvedValue(JSON.stringify([
        ['p', 'private-user'],
      ]));
      deliverRelays(
        {
          [writeRelay]: [older],
          [outboxRelay]: [newer],
          [deadRelay]: [],
        },
        {
          [writeRelay]: true,
          [outboxRelay]: true,
          [deadRelay]: false,
        },
      );

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        content: 're-encrypted',
        tags: [
          ['p', 'kept-user'],
          ['word', 'secret'],
          ['client', 'amethyst', 'extra'],
          ['word', 'spoiler'],
        ],
      }));
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('should publish the merged list when the only relay answers', async () => {
      mockAccountRelayService.relays.set([{ url: writeRelay, read: true, write: true }]);
      vi.mocked(mockUserRelays.getUserRelays).mockResolvedValue([]);
      vi.mocked(mockEncryption.decryptNip44).mockResolvedValue(JSON.stringify([
        ['p', 'private-user'],
      ]));
      deliverRelays({
        [writeRelay]: [createMuteListEvent('only-event', 250, [
          ['p', 'kept-user'],
          ['client', 'amethyst'],
        ], 'ciphertext')],
      });

      await service.addWordToMuteListAndPublish('spoiler');

      expect(ensureRelay).toHaveBeenCalledTimes(1);
      expect(ensureRelay).toHaveBeenCalledWith(writeRelay);
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        content: 're-encrypted',
        tags: [
          ['p', 'kept-user'],
          ['client', 'amethyst'],
          ['word', 'spoiler'],
        ],
      }));
      expect(mockEncryption.encryptNip44).toHaveBeenCalledWith(
        JSON.stringify([['p', 'private-user']]),
        accountPubkey,
      );
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('should not publish when the only relay stays silent', async () => {
      mockAccountRelayService.relays.set([{ url: writeRelay, read: true, write: true }]);
      vi.mocked(mockUserRelays.getUserRelays).mockResolvedValue([]);
      deliverRelays({ [writeRelay]: [] }, { [writeRelay]: false });

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining(writeRelay),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should not publish when no write or outbox relays are configured', async () => {
      mockAccountRelayService.relays.set([]);
      vi.mocked(mockAccountRelayService.getRelayUrls).mockReturnValue([]);
      vi.mocked(mockUserRelays.getUserRelays).mockResolvedValue([]);

      await service.addWordToMuteListAndPublish('spoiler');

      expect(ensureRelay).not.toHaveBeenCalled();
      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('Couldn\'t load your mute list from relays'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should publish the lower event id when relays tie on created_at', async () => {
      const low = createMuteListEvent('aaa', 200, [['p', 'low-id'], ['client', 'amethyst']]);
      const high = createMuteListEvent('zzz', 200, [['p', 'high-id']]);
      deliverRelays({
        [writeRelay]: [high],
        [outboxRelay]: [low],
      });

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'low-id'], ['client', 'amethyst'], ['word', 'spoiler']],
      }));
    });

    it('should treat an event without EOSE as a relay answer', async () => {
      const fromEvent = createMuteListEvent('event-only', 320, [['p', 'from-event'], ['word', 'kept']]);
      deliverRelays(
        { [writeRelay]: [fromEvent], [outboxRelay]: [] },
        { [writeRelay]: false, [outboxRelay]: true },
      );

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'from-event'], ['word', 'kept'], ['word', 'spoiler']],
      }));
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('should count a relay listed as both write and outbox once', async () => {
      const casedWriteRelay = 'wss://Write.Example/';
      mockAccountRelayService.relays.set([{ url: casedWriteRelay, read: true, write: true }]);
      vi.mocked(mockUserRelays.getUserRelays).mockResolvedValue([writeRelay]);
      deliverRelays({
        [casedWriteRelay]: [createMuteListEvent('shared-event', 180, [['p', 'shared-user']])],
      });

      await service.addWordToMuteListAndPublish('spoiler');

      expect(ensureRelay).toHaveBeenCalledTimes(1);
      expect(ensureRelay).toHaveBeenCalledWith(casedWriteRelay);
      expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
        tags: [['p', 'shared-user'], ['word', 'spoiler']],
      }));
    });

    it('should drop a queued edit clicked before an account switch', async () => {
      let releaseFirst: () => void = () => {};
      let reads = 0;
      vi.mocked(mockUserRelays.getUserRelays).mockImplementation(() => {
        reads += 1;
        if (reads === 1) {
          return new Promise(resolve => {
            releaseFirst = () => resolve([outboxRelay]);
          });
        }
        return Promise.resolve([outboxRelay]);
      });
      deliverRelays([createMuteListEvent('base-event', 40, [['p', 'kept']])]);

      const first = service.addWordToMuteListAndPublish('alpha');
      const second = service.addWordToMuteListAndPublish('beta');
      for (let i = 0; i < 20 && reads < 1; i++) {
        await Promise.resolve();
      }
      expect(reads).toBe(1);

      mockAccountStateService.account.set({
        pubkey: 'account-b',
        source: 'extension',
        hasActivated: true,
      });
      releaseFirst();
      await Promise.all([first, second]);

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalled();
    });

    it('should let the next edit run when signing times out', async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        vi.mocked(mockNostrService.signEvent).mockImplementation((event) => {
          calls += 1;
          if (calls === 1) return new Promise(() => undefined);
          return Promise.resolve({ ...event, pubkey: accountPubkey, id: 'signed-2', sig: 'sig' });
        });
        deliverRelays([createMuteListEvent('base-event', 40, [['p', 'kept']])]);

        const first = service.addWordToMuteListAndPublish('alpha');
        const second = service.addWordToMuteListAndPublish('beta');
        await vi.advanceTimersByTimeAsync(15000);
        await Promise.all([first, second]);

        expect(mockPublishService.publish).toHaveBeenCalledTimes(1);
        expect(mockPublishService.publish).toHaveBeenCalledWith(expect.objectContaining({
          tags: [['p', 'kept'], ['word', 'beta']],
        }));
        expect(snackBar.open).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not publish when the account changes during the relay read', async () => {
      let releaseDiscovery: (relays: string[]) => void = () => {};
      let discoveryStarted = false;
      vi.mocked(mockUserRelays.getUserRelays).mockImplementation(() => {
        discoveryStarted = true;
        return new Promise(resolve => {
          releaseDiscovery = resolve;
        });
      });

      const pending = service.addWordToMuteListAndPublish('spoiler');
      for (let i = 0; i < 20 && !discoveryStarted; i++) {
        await Promise.resolve();
      }
      expect(discoveryStarted).toBe(true);

      mockAccountStateService.account.set({
        pubkey: 'other-account',
        source: 'extension',
        hasActivated: true,
      });
      releaseDiscovery([outboxRelay]);
      await pending;

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalled();
      expect(mockAccountStateService.muteList()).toBeUndefined();
    });

    it('should not publish when signing returns another account', async () => {
      deliverRelays([createMuteListEvent('relay-event', 200, [['p', 'kept-user']])]);
      vi.mocked(mockNostrService.signEvent).mockImplementation(async (event) => {
        mockAccountStateService.account.set({
          pubkey: 'other-account',
          source: 'extension',
          hasActivated: true,
        });
        return {
          ...event,
          pubkey: 'other-account',
          id: 'wrong-account',
          sig: 'sig',
        };
      });

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(mockDatabaseService.saveReplaceableEvent).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalled();
      expect(mockAccountStateService.muteList()).toBeUndefined();
    });

    it('should keep both entries when two mute edits run together', async () => {
      const base = createMuteListEvent('base-event', 100, [['p', 'kept']]);
      ensureRelay.mockImplementation(async (url: string) => ({
        url,
        subscribe: (_filters: unknown, params: RelaySubParams) => {
          params.onevent?.(base);
          params.oneose?.();
          return { close: vi.fn() };
        },
      }));
      let signCount = 0;
      vi.mocked(mockNostrService.signEvent).mockImplementation(async (event) => {
        signCount += 1;
        return { ...event, pubkey: accountPubkey, id: `signed-${signCount}`, sig: 'sig' };
      });

      await Promise.all([
        service.addWordToMuteListAndPublish('alpha'),
        service.addWordToMuteListAndPublish('beta'),
      ]);

      const published = vi.mocked(mockPublishService.publish).mock.calls.map(call => call[0]);
      expect(published).toHaveLength(2);
      expect(published[0].tags).toEqual([['p', 'kept'], ['word', 'alpha']]);
      expect(published[1].tags).toEqual([['p', 'kept'], ['word', 'alpha'], ['word', 'beta']]);
    });

    it('should not publish when outbox relay discovery fails', async () => {
      vi.mocked(mockUserRelays.getUserRelays).mockRejectedValue(new Error('discovery failed'));
      deliverRelays([createMuteListEvent('relay-event', 200, [['p', 'existing-user']])]);

      await service.muteUser('new-user');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalled();
    });

    it('should not publish when private mute list content cannot be decrypted', async () => {
      vi.mocked(mockEncryption.decryptNip44).mockRejectedValue(new Error('nip44 failed'));
      vi.mocked(mockEncryption.decryptNip04).mockRejectedValue(new Error('nip04 failed'));
      deliverRelays([createMuteListEvent('relay-event', 300, [['p', 'public-user']], 'ciphertext')]);

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
      expect(mockEncryption.encryptNip44).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalled();
    });

    it('should not publish when decrypted private content is not a tag list', async () => {
      vi.mocked(mockEncryption.decryptNip44).mockResolvedValue('not-json');
      deliverRelays([createMuteListEvent('relay-event', 300, [['p', 'public-user']], 'ciphertext')]);

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
    });

    it('should not publish when private entries cannot be re-encrypted', async () => {
      vi.mocked(mockEncryption.decryptNip44).mockResolvedValue(JSON.stringify([['p', 'private-user']]));
      vi.mocked(mockEncryption.encryptNip44).mockRejectedValue(new Error('encrypt failed'));
      deliverRelays([createMuteListEvent('relay-event', 300, [['p', 'public-user']], 'ciphertext')]);

      await service.addWordToMuteListAndPublish('spoiler');

      expect(mockNostrService.signEvent).not.toHaveBeenCalled();
      expect(mockPublishService.publish).not.toHaveBeenCalled();
    });
  });
});
