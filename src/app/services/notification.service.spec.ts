import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountStateService } from './account-state.service';
import { ContentNotification, DatabaseService, NotificationType } from './database.service';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { PublishEventBus } from './publish-event-bus.service';
import { AccountRelayService } from './relays/account-relay';

describe('NotificationService event consolidation', () => {
  let service: NotificationService;
  const stored = new Map<string, Record<string, unknown>>();
  const database = {
    initialized: signal(true),
    getAllNotificationsForPubkey: vi.fn(async () => [...stored.values()]),
    saveNotification: vi.fn(async (notification: Record<string, unknown>) => {
      stored.set(notification['id'] as string, notification);
    }),
    deleteNotification: vi.fn(async (id: string) => { stored.delete(id); }),
  } satisfies Pick<DatabaseService,
    'initialized' | 'getAllNotificationsForPubkey' | 'saveNotification' | 'deleteNotification'>;

  function note(type: NotificationType, overrides: Partial<ContentNotification> = {}): ContentNotification {
    return {
      id: `content-${type}-note`,
      type,
      eventId: 'note',
      authorPubkey: 'author',
      recipientPubkey: 'recipient',
      title: type === NotificationType.REPLY ? 'Replied to a note mentioning you' : 'Mentioned you',
      message: 'Hello',
      timestamp: 1700000000000,
      read: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    stored.clear();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        NotificationService,
        PublishEventBus,
        { provide: DatabaseService, useValue: database },
        { provide: AccountStateService, useValue: {
          pubkey: signal('recipient'),
          mutedAccounts: signal<string[]>([]),
        } satisfies Pick<AccountStateService, 'pubkey' | 'mutedAccounts'> },
        { provide: LoggerService, useValue: {
          debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        } },
        { provide: AccountRelayService, useValue: {} },
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it.each([true, false])('shows one reply regardless of arrival order (reply first: %s)', (replyFirst) => {
    const reply = note(NotificationType.REPLY, {
      metadata: { replyEventId: 'note', repliedToEventId: 'parent' },
    });
    const mention = note(NotificationType.MENTION);
    for (const notification of replyFirst ? [reply, mention] : [mention, reply]) {
      service.addNotification(notification);
    }

    expect(service.notifications()).toEqual([reply]);
    expect(service.notifications().filter(n => !n.read)).toHaveLength(1);
  });

  it.each([NotificationType.MENTION, NotificationType.REPLY])('preserves an acknowledged event when %s is read', (readType) => {
    service.addNotification(note(NotificationType.MENTION, { read: readType === NotificationType.MENTION }));
    service.addNotification(note(NotificationType.REPLY, { read: readType === NotificationType.REPLY }));

    expect(service.notifications()).toEqual([expect.objectContaining({ type: NotificationType.REPLY, read: true })]);
  });

  it('keeps distinct source events, accounts, reactions and records without event IDs separate', () => {
    const notifications = [
      note(NotificationType.MENTION),
      note(NotificationType.REPLY, { id: 'other-note', eventId: 'other-note' }),
      note(NotificationType.REPLY, { id: 'other-account', recipientPubkey: 'other-recipient' }),
      note(NotificationType.REACTION, { id: 'reaction-1', metadata: { reactionEventId: 'reaction-1' } }),
      note(NotificationType.REACTION, { id: 'reaction-2', metadata: { reactionEventId: 'reaction-2' } }),
      note(NotificationType.MENTION, { id: 'missing-event-1', eventId: undefined }),
      note(NotificationType.REPLY, { id: 'missing-event-2', eventId: undefined }),
    ];
    notifications.forEach(notification => service.addNotification(notification));

    expect(service.notifications()).toHaveLength(notifications.length);
  });

  it('consolidates saved history and persists reading both entries across reloads', async () => {
    const reply = note(NotificationType.REPLY);
    const mention = note(NotificationType.MENTION);
    await service.persistNotificationToStorage(reply);
    await service.persistNotificationToStorage(mention);
    await service.loadNotifications();
    expect(service.notifications()).toEqual([reply]);

    service.markAsRead(reply.id);
    expect(service.notifications()[0].read).toBe(true);
    expect(database.saveNotification).toHaveBeenCalledWith(expect.objectContaining({ id: reply.id, read: true }));
    expect(database.saveNotification).toHaveBeenCalledWith(expect.objectContaining({ id: mention.id, read: true }));

    await service.loadNotifications();
    expect(service.notifications()).toEqual([{ ...reply, read: true }]);
  });

  it('dismisses every stored representation without removing another reply to the same parent', async () => {
    const reply = note(NotificationType.REPLY);
    const mention = note(NotificationType.MENTION);
    const other = note(NotificationType.REPLY, { id: 'other', eventId: 'other' });
    for (const notification of [reply, mention, other]) {
      await service.persistNotificationToStorage(notification);
    }
    await service.loadNotifications();

    service.removeNotification(reply.id);
    expect(database.deleteNotification).toHaveBeenCalledWith(reply.id);
    expect(database.deleteNotification).toHaveBeenCalledWith(mention.id);
    expect(service.notifications()).toEqual([other]);
    await service.loadNotifications();
    expect(service.notifications()).toEqual([other]);
  });

  it('keeps duplicate read state and dismissal intact beyond the history memory limit', async () => {
    const reply = note(NotificationType.REPLY);
    await service.persistNotificationToStorage(reply);
    await service.persistNotificationToStorage(note(NotificationType.MENTION, { read: true }));
    for (let index = 0; index < 251; index++) {
      await service.persistNotificationToStorage(note(NotificationType.MENTION, {
        id: `newer-${index}`,
        eventId: `newer-${index}`,
        timestamp: reply.timestamp + index + 1,
        read: true,
      }));
    }
    await service.loadNotifications();

    expect(service.notifications().find(n => n.id === reply.id)?.read).toBe(true);
    service.removeNotification(reply.id);
    await service.loadNotifications();
    expect(service.notifications().some(n => (n as ContentNotification).eventId === 'note')).toBe(false);
  });
});
