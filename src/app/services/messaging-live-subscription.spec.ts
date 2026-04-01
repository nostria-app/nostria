import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { kinds } from 'nostr-tools';

import { MessagingService } from './messaging.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { EncryptionPermissionService } from './encryption-permission.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { SettingsService } from './settings.service';

describe('MessagingService live subscriptions', () => {
  let service: MessagingService;
  let subscribeMock: ReturnType<typeof vi.fn>;

  const pubkey = signal('my-pubkey');
  const account = signal({ pubkey: 'my-pubkey', source: 'preview' as const });

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const accountLocalState = {
    getUnreadMessagesCount: vi.fn().mockReturnValue(0),
    setUnreadMessagesCount: vi.fn(),
    getMessagesLastCheck: vi.fn().mockReturnValue(0),
    setMessagesLastCheck: vi.fn(),
  };

  const database = {
    getEventByPubkeyAndKind: vi.fn().mockResolvedValue(null),
    getDirectMessage: vi.fn().mockResolvedValue(null),
    init: vi.fn().mockResolvedValue(undefined),
    messageExists: vi.fn().mockResolvedValue(false),
    saveDirectMessage: vi.fn().mockResolvedValue(undefined),
  };

  const settingsService = {
    settings: signal({ messageNotificationSoundsEnabled: true }),
  };

  beforeEach(async () => {
    subscribeMock = vi.fn().mockImplementation(() => ({ close: vi.fn() }));

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MessagingService,
        { provide: NostrService, useValue: {} },
        { provide: LoggerService, useValue: logger },
        {
          provide: AccountStateService,
          useValue: {
            pubkey,
            account,
          },
        },
        {
          provide: UtilitiesService,
          useValue: {
            currentDate: vi.fn().mockReturnValue(2_000_000),
            getPTagsValuesFromEvent: (event: { tags?: string[][] }) =>
              (event.tags || []).filter(tag => tag[0] === 'p').map(tag => tag[1]),
          },
        },
        { provide: EncryptionService, useValue: {} },
        {
          provide: EncryptionPermissionService,
          useValue: {
            needsPermission: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: AccountRelayService,
          useValue: {
            getRelayUrls: vi.fn().mockReturnValue(['wss://account-relay']),
            waitUntilInitialized: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: DatabaseService, useValue: database },
        { provide: AccountLocalStateService, useValue: accountLocalState },
        {
          provide: RelayPoolService,
          useValue: {
            subscribe: subscribeMock,
          },
        },
        {
          provide: DiscoveryRelayService,
          useValue: {
            getRelayUrls: vi.fn().mockReturnValue(['wss://discovery-relay']),
          },
        },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compileComponents();

    service = TestBed.inject(MessagingService);
    vi.clearAllMocks();
  });

  it('processes live gift-wrapped DMs instead of skipping them as already known', async () => {
    const callbacks: Array<(event: unknown) => Promise<void> | void> = [];
    subscribeMock.mockImplementation((_relays: unknown, _filter: unknown, callback: (event: unknown) => Promise<void> | void) => {
      callbacks.push(callback);
      return { close: vi.fn() };
    });

    const unwrapMessageSpy = vi.spyOn(service as any, 'unwrapMessageInternal');
    unwrapMessageSpy.mockResolvedValue({
      id: 'inner-message-id',
      pubkey: 'peer-pubkey',
      created_at: 1_700_000_000,
      content: 'hello from peer',
      tags: [['p', 'my-pubkey']],
    });

    await service.subscribeToIncomingMessages();

    expect(callbacks.length).toBe(2);

    await callbacks[0]({
      id: 'gift-wrap-id',
      kind: kinds.GiftWrap,
      pubkey: 'ephemeral-pubkey',
      created_at: 1_700_000_100,
      content: 'encrypted',
      tags: [['p', 'my-pubkey']],
    });

    const messages = service.getChatMessages('peer-pubkey');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('inner-message-id');
    expect(messages[0].content).toBe('hello from peer');
    expect(messages[0].encryptionType).toBe('nip44');
  });

  it('clears stale pending state when the same message arrives from relays', () => {
    service.addMessageToChat('peer-pubkey', {
      id: 'same-message-id',
      pubkey: 'my-pubkey',
      created_at: 1_700_000_000,
      content: 'hello',
      isOutgoing: true,
      tags: [['p', 'peer-pubkey']],
      pending: true,
      received: false,
      failed: false,
      encryptionType: 'nip44',
    });

    service.addMessageToChat('peer-pubkey', {
      id: 'same-message-id',
      pubkey: 'my-pubkey',
      created_at: 1_700_000_000,
      content: 'hello',
      isOutgoing: true,
      tags: [['p', 'peer-pubkey']],
      pending: false,
      received: true,
      failed: false,
      encryptionType: 'nip44',
    });

    const [message] = service.getChatMessages('peer-pubkey');
    expect(message.pending).toBe(false);
    expect(message.received).toBe(true);
    expect(message.failed).toBe(false);
  });

  it('does not restore unread state when a replayed DM is already marked read in storage', async () => {
    const callbacks: Array<(event: unknown) => Promise<void> | void> = [];
    subscribeMock.mockImplementation((_relays: unknown, _filter: unknown, callback: (event: unknown) => Promise<void> | void) => {
      callbacks.push(callback);
      return { close: vi.fn() };
    });

    database.getDirectMessage.mockResolvedValue({
      id: 'my-pubkey::peer-pubkey::inner-message-id',
      accountPubkey: 'my-pubkey',
      chatId: 'peer-pubkey',
      messageId: 'inner-message-id',
      pubkey: 'peer-pubkey',
      created_at: 1_700_000_000,
      content: 'hello again',
      isOutgoing: false,
      tags: [['p', 'my-pubkey']],
      encryptionType: 'nip44',
      read: true,
      received: true,
    });

    vi.spyOn(service as any, 'unwrapMessageInternal').mockResolvedValue({
      id: 'inner-message-id',
      pubkey: 'peer-pubkey',
      created_at: 1_700_000_000,
      content: 'hello again',
      tags: [['p', 'my-pubkey']],
    });

    await service.subscribeToIncomingMessages();
    await callbacks[0]({
      id: 'gift-wrap-id-2',
      kind: kinds.GiftWrap,
      pubkey: 'ephemeral-pubkey',
      created_at: 1_700_000_100,
      content: 'encrypted',
      tags: [['p', 'my-pubkey']],
    });

    const chat = service.getChat('peer-pubkey');
    const [message] = service.getChatMessages('peer-pubkey');

    expect(chat?.unreadCount).toBe(0);
    expect(message.read).toBe(true);
  });

  it('normalizes structured legacy DM payloads into plain text', () => {
    service.addMessageToChat('peer-pubkey', {
      id: 'structured-message-id',
      pubkey: 'peer-pubkey',
      created_at: 1_700_000_200,
      content: '{"c":"nip04","type":100,"msg":"Rendered text","name":"{\"user\":\"sondreb\",\"content\":\"Quoted content\"}"}',
      isOutgoing: false,
      tags: [['p', 'my-pubkey']],
      pending: false,
      received: true,
      failed: false,
      encryptionType: 'nip04',
    });

    const [message] = service.getChatMessages('peer-pubkey');
    expect(message.content).toBe('Rendered text');
    expect(message.quotedReplyContent).toBe('Quoted content');
    expect(message.quotedReplyAuthor).toBe('sondreb');
  });

  it('plays notification sounds only for unread incoming messages from the last hour', () => {
    const playNotificationSoundSpy = vi.spyOn(service as any, 'playNotificationSound').mockImplementation(() => undefined);

    service.addMessageToChat('peer-pubkey', {
      id: 'old-message-id',
      pubkey: 'peer-pubkey',
      created_at: 2_000_000 - 3_601,
      content: 'old backlog message',
      isOutgoing: false,
      tags: [['p', 'my-pubkey']],
      pending: false,
      received: true,
      failed: false,
      encryptionType: 'nip44',
    });

    service.addMessageToChat('peer-pubkey', {
      id: 'recent-message-id',
      pubkey: 'peer-pubkey',
      created_at: 2_000_000 - 3_600,
      content: 'recent message',
      isOutgoing: false,
      tags: [['p', 'my-pubkey']],
      pending: false,
      received: true,
      failed: false,
      encryptionType: 'nip44',
    });

    expect(playNotificationSoundSpy).toHaveBeenCalledTimes(1);
  });
});