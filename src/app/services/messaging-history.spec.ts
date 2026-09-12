import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Filter, kinds, NostrEvent } from 'nostr-tools';
import { MessagingService, computeDirectChatId } from './messaging.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { EncryptionPermissionService } from './encryption-permission.service';
import { AccountRelayService } from './relays/account-relay';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { DatabaseService } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { SettingsService } from './settings.service';
import { DesktopNotificationService } from './desktop-notification.service';

describe('MessagingService history', () => {
  const me = '1'.repeat(64);
  const peer = '2'.repeat(64);
  const other = '3'.repeat(64);
  const now = 2_000_000;
  const chatId = computeDirectChatId(peer, 'nip44');
  const pubkey = signal(me);
  const query = vi.fn<RelayPoolService['query']>();
  const autoDecrypt = vi.fn<EncryptionService['autoDecrypt']>();
  const saveDirectMessage = vi.fn<DatabaseService['saveDirectMessage']>().mockResolvedValue(undefined);
  const markChatAsRead = vi.fn<DatabaseService['markChatAsRead']>();
  let service: MessagingService;
  let relayEvents: Map<string, NostrEvent[]>;

  function event(id: string, created_at: number, sender = peer, recipient = me): NostrEvent {
    return { id, created_at, pubkey: sender, kind: kinds.EncryptedDirectMessage,
      tags: [['p', recipient]], content: id, sig: '' };
  }

  function wrap(id: string, timestamp: number, sender = peer, rumorKind = 14): NostrEvent {
    const rumor = { id, pubkey: sender, kind: rumorKind, created_at: timestamp + 100_000,
      tags: [['p', sender === me ? peer : me]], content: id };
    const seal = { id: `seal-${id}`, pubkey: sender, kind: 13, content: JSON.stringify(rumor) };
    return { ...event(`wrap-${id}`, timestamp), pubkey: '4'.repeat(64), kind: kinds.GiftWrap,
      content: JSON.stringify(seal) };
  }

  function serveEvents(urls: string[], filter: Filter): Promise<NostrEvent[]> {
    return Promise.resolve((relayEvents.get(urls[0]) ?? [])
      .filter(item => (!filter.kinds || filter.kinds.includes(item.kind)) &&
        (!filter.authors || filter.authors.includes(item.pubkey)) &&
        (!filter['#p'] || item.tags.some(tag => tag[0] === 'p' && filter['#p']!.includes(tag[1]))) &&
        (filter.until === undefined || item.created_at <= filter.until))
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      .slice(0, filter.limit));
  }

  function addChat(protocol: 'nip04' | 'nip44' = 'nip44'): string {
    const id = computeDirectChatId(peer, protocol);
    service.addChat({ id, pubkey: peer, unreadCount: 0, encryptionType: protocol, messages: new Map() });
    return id;
  }

  beforeEach(() => {
    pubkey.set(me);
    relayEvents = new Map();
    query.mockReset().mockImplementation(serveEvents);
    autoDecrypt.mockReset().mockImplementation(async content => ({ content, algorithm: 'nip44' }));
    saveDirectMessage.mockClear();
    markChatAsRead.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), MessagingService,
      { provide: NostrService, useValue: {} },
      { provide: AccountStateService, useValue: {
        pubkey, account: signal(null), canUseDirectMessages: () => false, canDecrypt: () => true,
      } },
      { provide: LoggerService, useValue: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { provide: UtilitiesService, useValue: {
        currentDate: () => now,
        getPTagsValuesFromEvent: (item: NostrEvent) => item.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]),
        normalizeRelayUrls: (urls: string[]) => urls,
      } },
      { provide: EncryptionService, useValue: {
        autoDecrypt, isContentEncrypted: () => true,
      } satisfies Pick<EncryptionService, 'autoDecrypt' | 'isContentEncrypted'> },
      { provide: EncryptionPermissionService, useValue: { needsPermission: () => false } },
      { provide: AccountRelayService, useValue: { getRelayUrls: () => ['wss://account'] } },
      { provide: RelayPoolService, useValue: { query } satisfies Pick<RelayPoolService, 'query'> },
      { provide: DiscoveryRelayService, useValue: {} },
      { provide: DatabaseService, useValue: {
        init: vi.fn().mockResolvedValue(undefined),
        getEventByPubkeyAndKind: vi.fn().mockResolvedValue({ tags: [['relay', 'wss://dm']] }),
        getDirectMessage: vi.fn().mockResolvedValue(null),
        messageExists: vi.fn().mockResolvedValue(false), saveDirectMessage, markChatAsRead,
      } },
      { provide: AccountLocalStateService, useValue: {
        getUnreadMessagesCount: () => 0, setUnreadMessagesCount: vi.fn(),
      } },
      { provide: SettingsService, useValue: { settings: signal({ messageNotificationSoundsEnabled: false }) } },
      { provide: DesktopNotificationService, useValue: { notify: vi.fn() } },
    ] });
    service = TestBed.inject(MessagingService);
    service.MESSAGE_SIZE = 2;
  });

  it('loads legacy messages in both directions across long gaps using peer filters', async () => {
    const legacyId = addChat('nip04');
    relayEvents.set('wss://account', [event('incoming', 100), event('outgoing', 50, me, peer),
      event('unrelated', 200, other)]);
    const result = await service.loadMoreMessages(legacyId);
    expect(result.messages.map(message => message.id)).toEqual(['outgoing', 'incoming']);
    expect(query.mock.calls.every(([, filter]) => filter.since === undefined)).toBe(true);
    expect(autoDecrypt).toHaveBeenCalledTimes(2);
  });

  it('decrypts gift wraps and retains other conversations and outgoing self-copies', async () => {
    addChat();
    relayEvents.set('wss://dm', [wrap('other-chat', 500, other), wrap('self-copy', 400, me), wrap('old', 100)]);
    await service.loadMoreMessages(chatId);
    await service.loadMoreMessages(chatId);
    expect(service.getChatMessages(chatId).map(message => message.id)).toEqual(['old', 'self-copy']);
    expect(service.getChatMessages(computeDirectChatId(other, 'nip44'))[0].id).toBe('other-chat');
    expect(query.mock.calls.every(([urls, filter, , options]) => urls.length === 1 &&
      filter.authors === undefined && filter['#p']?.[0] === me && options?.auth)).toBe(true);
    expect(autoDecrypt).toHaveBeenCalledTimes(6);
  });

  it('advances through duplicate pages using each relay own outer timestamps', async () => {
    addChat();
    relayEvents.set('wss://dm', [wrap('dm-new', 900), wrap('dm-old', 100)]);
    relayEvents.set('wss://account', [wrap('account-new', 800), wrap('account-middle', 700), wrap('account-old', 600)]);
    await service.loadMoreMessages(chatId);
    await service.loadMoreMessages(chatId);
    expect(service.getChatMessages(chatId).map(message => message.id)).toContain('account-old');
    const accountCursors = query.mock.calls.filter(([urls]) => urls[0] === 'wss://account').map(([, filter]) => filter.until);
    expect(accountCursors).toContain(700);
    expect(accountCursors).not.toContain(100);
    expect(autoDecrypt).toHaveBeenCalledTimes(10);
  });

  it('does not lose messages sharing a page boundary timestamp', async () => {
    addChat();
    relayEvents.set('wss://dm', Array.from({ length: 6 }, (_, index) => wrap(`tie-${index}`, 500)));
    for (let page = 0; page < 4; page++) await service.loadMoreMessages(chatId);
    expect(service.getChatMessages(chatId)).toHaveLength(6);
    expect(query.mock.calls.some(([, filter]) => (filter.limit ?? 0) > 2 && filter.until === 500)).toBe(true);
    expect(autoDecrypt).toHaveBeenCalledTimes(12);
  });

  it('keeps progressing when a bounded scan contains only unrelated conversations', async () => {
    addChat();
    relayEvents.set('wss://dm', [
      ...Array.from({ length: 10 }, (_, index) => wrap(`other-${index}`, 1000 - index * 10, other)),
      wrap('target', 100),
    ]);
    const first = await service.loadMoreMessages(chatId);
    expect(first.messages).toEqual([]);
    expect(first.canAutoLoad).toBe(true);
    for (let page = 0; page < 5; page++) await service.loadMoreMessages(chatId);
    expect(service.getChatMessages(chatId)[0].id).toBe('target');
    expect(service.getChatMessages(computeDirectChatId(other, 'nip44'))).toHaveLength(10);
  });

  it('allows retry after empty or rejected relay responses without advancing their cursors', async () => {
    addChat();
    query.mockRejectedValueOnce(new Error('offline'));
    expect((await service.loadMoreMessages(chatId)).canAutoLoad).toBe(false);
    relayEvents.set('wss://dm', [wrap('recovered', 500)]);
    expect((await service.loadMoreMessages(chatId)).messages[0].id).toBe('recovered');
    expect(query.mock.calls.filter(([urls]) => urls[0] === 'wss://dm').map(([, filter]) => filter.until)).toEqual([now, now]);
  });

  it.each(['User cancelled', 'User canceled', 'User rejected request', 'Permission denied', 'Signer timeout'])(
    'retries transient decryption failure: %s', async reason => {
      addChat();
      relayEvents.set('wss://dm', [wrap('retry-decrypt', 500)]);
      autoDecrypt.mockRejectedValueOnce(new Error(reason));
      expect((await service.loadMoreMessages(chatId)).messages).toEqual([]);
      expect((await service.loadMoreMessages(chatId)).messages[0].id).toBe('retry-decrypt');
    }
  );

  it('discovers older chats on DM relays even without local messages and permits retry', async () => {
    await service.loadMoreChats();
    expect(service.hasMoreChats()).toBe(false);
    relayEvents.set('wss://dm', [wrap('discovered', 100)]);
    await service.loadMoreChats();
    expect(service.getChatMessages(chatId)[0].id).toBe('discovered');
    expect(service.isLoadingMoreChats()).toBe(false);
  });

  it('discards pending history after a cache reset', async () => {
    addChat();
    let resolvePage!: (events: NostrEvent[]) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
    const loading = service.loadMoreMessages(chatId);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    service.clear();
    resolvePage([wrap('stale', 100)]);
    await loading;
    expect(service.getChatMessages(chatId)).toEqual([]);
    expect(autoDecrypt).not.toHaveBeenCalled();
  });

  it('clears loading state on reset and ignores completion of the previous scan', async () => {
    let resolvePage!: (events: NostrEvent[]) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
    const loading = service.loadMoreChats();
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    expect(service.isLoadingMoreChats()).toBe(true);
    service.reset();
    expect(service.isLoadingMoreChats()).toBe(false);
    resolvePage([]);
    await loading;
    expect(service.hasMoreChats()).toBe(true);
  });

  it('does not add a message to another account when decryption completes late', async () => {
    addChat();
    const wrapped = wrap('stale-decrypt', 500);
    relayEvents.set('wss://dm', [wrapped]);
    let finishDecrypt!: (value: Awaited<ReturnType<EncryptionService['autoDecrypt']>>) => void;
    autoDecrypt.mockImplementationOnce(() => new Promise(resolve => { finishDecrypt = resolve; }));
    const loading = service.loadMoreMessages(chatId);
    await vi.waitFor(() => expect(autoDecrypt).toHaveBeenCalled());
    pubkey.set(other);
    service.clear();
    finishDecrypt({ content: wrapped.content, algorithm: 'nip44' });
    await loading;
    expect(service.getChatMessages(chatId)).toEqual([]);
    expect(saveDirectMessage).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves arrivals during a pending read update (all chats: %s)', async all => {
    const addMessage = (id: string, sender = peer) => service.addMessageToChat(sender, {
      id, pubkey: sender, created_at: 100, content: id, tags: [['p', me]],
      isOutgoing: false, encryptionType: 'nip44', received: true,
    });
    addMessage('already-visible');
    let finishRead!: () => void;
    markChatAsRead.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const reading = all ? service.markAllChatsAsRead() : service.markChatAsRead(chatId);
    await vi.waitFor(() => expect(markChatAsRead).toHaveBeenCalled());
    addMessage('arrived-during-read');
    addMessage('another-chat', other);
    finishRead();
    await reading;
    expect(service.getChatMessages(chatId).map(message => message.id)).toEqual([
      'already-visible', 'arrived-during-read',
    ]);
    expect(service.getChat(chatId)?.unreadCount).toBe(1);
    expect(service.getChat(computeDirectChatId(other, 'nip44'))?.unreadCount).toBe(1);
    await vi.waitFor(() => expect(saveDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'already-visible', read: true })
    ));
  });
});
