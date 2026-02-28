import type { Mock, MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { ContentNotificationService } from './content-notification.service';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { AccountRelayService } from './relays/account-relay';
import { AccountLocalStateService } from './account-local-state.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { LocalSettingsService } from './local-settings.service';
import { kinds } from 'nostr-tools';

describe('ContentNotificationService', () => {
  let service: ContentNotificationService;
  let mockAccountState: {
    pubkey: ReturnType<typeof signal<string | undefined>>;
    mutedAccounts: ReturnType<typeof signal<string[]>>;
  };
  let mockAccountLocalState: MockedObject<AccountLocalStateService>;
  let mockNotificationService: {
    notifications: ReturnType<typeof signal<unknown[]>>;
    addNotification: Mock;
    persistNotificationToStorage: Mock;
  };
  let mockAccountRelay: MockedObject<AccountRelayService>;
  let mockDatabase: MockedObject<DatabaseService>;
  let mockLocalSettings: {
    maxTaggedAccountsFilter: ReturnType<typeof signal<number | 'none'>>;
  };

  const TEST_PUBKEY_A = 'aaaa'.repeat(16);
  const TEST_PUBKEY_B = 'bbbb'.repeat(16);

  beforeEach(() => {
    mockAccountState = {
      pubkey: signal<string | undefined>(TEST_PUBKEY_A),
      mutedAccounts: signal<string[]>([]),
    };

    mockAccountLocalState = {
      getNotificationLastCheck: vi.fn().mockName("AccountLocalStateService.getNotificationLastCheck"),
      setNotificationLastCheck: vi.fn().mockName("AccountLocalStateService.setNotificationLastCheck"),
      hasProcessedFollowerNotification: vi.fn().mockName("AccountLocalStateService.hasProcessedFollowerNotification"),
      markFollowerNotificationProcessed: vi.fn().mockName("AccountLocalStateService.markFollowerNotificationProcessed"),
      clearFollowerNotificationsProcessed: vi.fn().mockName("AccountLocalStateService.clearFollowerNotificationsProcessed")
    } as unknown as MockedObject<AccountLocalStateService>;
    mockAccountLocalState.getNotificationLastCheck.mockReturnValue(0);
    mockAccountLocalState.hasProcessedFollowerNotification.mockReturnValue(false);

    mockNotificationService = {
      notifications: signal<unknown[]>([]),
      addNotification: vi.fn(),
      persistNotificationToStorage: vi.fn().mockReturnValue(Promise.resolve()),
    };

    mockAccountRelay = {
      getMany: vi.fn().mockName("AccountRelayService.getMany"),
      get: vi.fn().mockName("AccountRelayService.get")
    } as unknown as MockedObject<AccountRelayService>;
    mockAccountRelay.getMany.mockReturnValue(Promise.resolve([]));
    mockAccountRelay.get.mockReturnValue(Promise.resolve(null));

    mockDatabase = {
      getNotification: vi.fn().mockName("DatabaseService.getNotification"),
      getEventById: vi.fn().mockName("DatabaseService.getEventById")
    } as unknown as MockedObject<DatabaseService>;
    mockDatabase.getNotification.mockReturnValue(Promise.resolve(undefined));
    mockDatabase.getEventById.mockReturnValue(Promise.resolve(null));

    mockLocalSettings = {
      maxTaggedAccountsFilter: signal<number | 'none'>('none'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ContentNotificationService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: LoggerService,
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: AccountRelayService, useValue: mockAccountRelay },
        { provide: AccountLocalStateService, useValue: mockAccountLocalState },
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: DatabaseService, useValue: mockDatabase },
        { provide: LocalSettingsService, useValue: mockLocalSettings },
      ],
    });

    service = TestBed.inject(ContentNotificationService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('onAccountChanged', () => {
    it('should reload lastCheckTimestamp for the new account', async () => {
      const accountATimestamp = 1700000000;
      mockAccountLocalState.getNotificationLastCheck.mockImplementation((pubkey: string) => {
        if (pubkey === TEST_PUBKEY_A)
          return accountATimestamp;
        if (pubkey === TEST_PUBKEY_B)
          return 1700001000;
        return 0;
      });

      // Initialize with account A
      await service.initialize();
      expect(service.lastCheckTimestamp()).toBe(accountATimestamp);

      // Switch to account B
      mockAccountState.pubkey.set(TEST_PUBKEY_B);
      await service.onAccountChanged();

      expect(service.lastCheckTimestamp()).toBe(1700001000);
      expect(mockAccountLocalState.getNotificationLastCheck).toHaveBeenCalledWith(TEST_PUBKEY_B);
    });

    it('should reset the rate limiter so immediate check is not blocked', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      await service.initialize();

      // Trigger a check to set the rate limiter
      await service.checkForNewNotifications();

      // Switch account and call onAccountChanged
      mockAccountState.pubkey.set(TEST_PUBKEY_B);
      await service.onAccountChanged();

      // A subsequent check should NOT be rate-limited
      // (we verify by checking that getMany is called again)
      mockAccountRelay.getMany.mockClear();
      await service.checkForNewNotifications();

      // getMany should have been called (6 parallel queries)
      expect(mockAccountRelay.getMany).toHaveBeenCalled();
    });

    it('should handle missing pubkey gracefully', async () => {
      mockAccountState.pubkey.set(undefined);
      await service.onAccountChanged();
      // Should not throw
      expect(service.lastCheckTimestamp()).toBe(0);
    });
  });

  describe('overlap buffer', () => {
    it('should apply overlap buffer when fetching notifications for returning users', async () => {
      const lastCheckTimestamp = 1700000000;
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(lastCheckTimestamp);

      await service.initialize();
      await service.checkForNewNotifications();

      // Verify that getMany was called with a `since` value less than the last check timestamp
      // The overlap buffer is 60 seconds, so since should be lastCheckTimestamp - 60
      const expectedSince = lastCheckTimestamp - 60;
      const firstCall = vi.mocked(mockAccountRelay.getMany).mock.calls[0];
      expect(firstCall).toBeDefined();
      const [filter] = firstCall!;
      expect(filter.since).toBe(expectedSince);
    });

    it('should not apply overlap buffer for first-time users (since is 0)', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(0);

      await service.initialize();
      await service.checkForNewNotifications();

      // For first-time users, since should be capped at 7 days back, not negative
      const firstCall = vi.mocked(mockAccountRelay.getMany).mock.calls[0];
      expect(firstCall).toBeDefined();
      const [filter] = firstCall!;
      expect(filter.since).toBeGreaterThan(0);
    });
  });

  describe('polling lifecycle', () => {
    it('should start polling on initialize', async () => {
      await service.initialize();
      expect(service.initialized()).toBe(true);
    });

    it('should stop polling on destroy', async () => {
      await service.initialize();
      service.ngOnDestroy();
      // No error should occur
      expect(service).toBeTruthy();
    });

    it('should not check when no authenticated user', async () => {
      mockAccountState.pubkey.set(undefined);
      await service.initialize();
      await service.checkForNewNotifications();
      expect(mockAccountRelay.getMany).not.toHaveBeenCalled();
    });

    it('should skip concurrent checks with isChecking guard', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      // Make getMany return a delayed promise to simulate ongoing check
      let resolveGetMany: () => void;
      const delayedPromise = new Promise<never[]>((resolve) => {
        resolveGetMany = () => resolve([]);
      });
      mockAccountRelay.getMany.mockReturnValue(delayedPromise);

      await service.initialize();

      // Start first check (it will hang)
      const firstCheck = service.checkForNewNotifications();

      // Second check should be skipped due to isChecking guard
      mockAccountRelay.getMany.mockClear();
      await service.checkForNewNotifications();
      expect(mockAccountRelay.getMany).not.toHaveBeenCalled();

      // Resolve the first check
      resolveGetMany!();
      await firstCheck;
    });

    it('should immediately fetch notifications when timestamp is 0 (first-time or after cache clear)', async () => {
      // Simulate first-time user or after cache clear
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(0);

      await service.initialize();

      // Wait for the 1-second delay in the setTimeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify that getMany was called to fetch notifications
      expect(mockAccountRelay.getMany).toHaveBeenCalled();
    });

    it('should not immediately fetch notifications when timestamp is not 0', async () => {
      // Simulate returning user with existing timestamp
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      await service.initialize();

      // Wait for a short time
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify that getMany was not called automatically on initialize
      // (it would only be called by periodic polling or manual refresh)
      expect(mockAccountRelay.getMany).not.toHaveBeenCalled();
    });
  });

  describe('visibility change handling', () => {
    it('should check for notifications when app becomes visible', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      await service.initialize();

      // Clear previous calls from initialization
      mockAccountRelay.getMany.mockClear();

      // Simulate app hidden
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      // Simulate app visible (with enough time passed to bypass rate limiter)
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });

      // Reset the rate limiter by waiting
      await new Promise(resolve => setTimeout(resolve, 50));
      // Manually reset lastCheckTime to bypass rate limit in test
      (service as unknown as {
        lastCheckTime: number;
      }).lastCheckTime = 0;

      document.dispatchEvent(new Event('visibilitychange'));

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockAccountRelay.getMany).toHaveBeenCalled();

      // Restore document.hidden
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('refreshRecentNotifications', () => {
    it('should look back the specified number of days', async () => {
      await service.initialize();
      await service.refreshRecentNotifications(3);

      const firstCall = vi.mocked(mockAccountRelay.getMany).mock.calls[0];
      const now = Math.floor(Date.now() / 1000);
      const threeDaysAgo = now - (3 * 24 * 60 * 60);

      // The since timestamp should be approximately 3 days ago (within 5 seconds tolerance)
      expect(firstCall).toBeDefined();
      const [filter] = firstCall!;
      expect(filter.since).toBeGreaterThan(threeDaysAgo - 5);
      expect(filter.since).toBeLessThan(threeDaysAgo + 5);
    });

    it('should not update lastCheckTimestamp', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      await service.initialize();

      const timestampBefore = service.lastCheckTimestamp();
      await service.refreshRecentNotifications();
      const timestampAfter = service.lastCheckTimestamp();

      // lastCheckTimestamp should not change after refresh
      expect(timestampAfter).toBe(timestampBefore);
    });
  });

  describe('resetLastCheckTimestamp', () => {
    it('should reset timestamp to 0', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      await service.initialize();

      service.resetLastCheckTimestamp();

      expect(service.lastCheckTimestamp()).toBe(0);
      expect(mockAccountLocalState.setNotificationLastCheck).toHaveBeenCalledWith(TEST_PUBKEY_A, 0);
      expect(mockAccountLocalState.clearFollowerNotificationsProcessed).toHaveBeenCalledWith(TEST_PUBKEY_A);
    });
  });

  describe('follower processing', () => {
    it('should create follower notification when user is tagged but not last p-tag', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      const now = Math.floor(Date.now() / 1000);
      const followerEvent = {
        id: 'follow-1',
        pubkey: TEST_PUBKEY_B,
        kind: kinds.Contacts,
        created_at: now,
        content: '',
        tags: [
          ['p', TEST_PUBKEY_A],
          ['p', 'cccc'.repeat(16)],
        ],
      };

      mockAccountRelay.getMany.mockImplementation(async <T>(filter: {
        kinds?: number[];
      }) => {
        if (filter.kinds?.includes(kinds.Contacts)) {
          return [followerEvent] as unknown as T[];
        }
        return [] as T[];
      });

      await service.initialize();
      await service.checkForNewNotifications();

      expect(mockNotificationService.addNotification).toHaveBeenCalled();
      expect(mockAccountLocalState.markFollowerNotificationProcessed)
        .toHaveBeenCalledWith(TEST_PUBKEY_A, TEST_PUBKEY_B, now);
    });

    it('should skip follower notification when already processed for this follower', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      mockAccountLocalState.hasProcessedFollowerNotification.mockImplementation((recipient: string, follower: string) => {
        return recipient === TEST_PUBKEY_A && follower === TEST_PUBKEY_B;
      });

      const now = Math.floor(Date.now() / 1000);
      const followerEvent = {
        id: 'follow-2',
        pubkey: TEST_PUBKEY_B,
        kind: kinds.Contacts,
        created_at: now,
        content: '',
        tags: [['p', TEST_PUBKEY_A]],
      };

      mockAccountRelay.getMany.mockImplementation(async <T>(filter: {
        kinds?: number[];
      }) => {
        if (filter.kinds?.includes(kinds.Contacts)) {
          return [followerEvent] as unknown as T[];
        }
        return [] as T[];
      });

      await service.initialize();
      await service.checkForNewNotifications();

      expect(mockNotificationService.addNotification).not.toHaveBeenCalled();
      expect(mockAccountLocalState.markFollowerNotificationProcessed).not.toHaveBeenCalled();
    });
  });

  describe('checkForNewNotifications updates lastCheckTimestamp', () => {
    it('should update lastCheckTimestamp after successful check', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);
      await service.initialize();

      const beforeCheck = Math.floor(Date.now() / 1000);
      await service.checkForNewNotifications();
      const afterCheck = Math.floor(Date.now() / 1000);

      // The lastCheckTimestamp should be updated to approximately now
      expect(service.lastCheckTimestamp()).toBeGreaterThanOrEqual(beforeCheck);
      expect(service.lastCheckTimestamp()).toBeLessThanOrEqual(afterCheck);
      expect(mockAccountLocalState.setNotificationLastCheck).toHaveBeenCalled();
    });
  });

  describe('reaction fallback message', () => {
    it('should create "mentioning you" reaction notification when reacted note mentions the current account', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      const now = Math.floor(Date.now() / 1000);
      const reactionEvent = {
        id: 'reaction-1',
        pubkey: TEST_PUBKEY_B,
        kind: kinds.Reaction,
        created_at: now,
        content: '+',
        tags: [
          ['e', 'target-note-1'],
          ['p', TEST_PUBKEY_A],
        ],
      };

      mockAccountRelay.getMany.mockImplementation(async <T>(filter: {
        kinds?: number[];
      }) => {
        if (filter.kinds?.includes(kinds.Reaction)) {
          return [reactionEvent] as unknown as T[];
        }
        return [] as T[];
      });

      mockDatabase.getEventById.mockImplementation((eventId: string) => {
        if (eventId === 'target-note-1') {
          return Promise.resolve({
            id: 'target-note-1',
            pubkey: 'cccc'.repeat(16),
            content: '',
            tags: [['p', TEST_PUBKEY_A]],
            kind: kinds.ShortTextNote,
            created_at: now - 100,
            sig: '',
          });
        }
        return Promise.resolve(null);
      });

      await service.initialize();
      await service.checkForNewNotifications();

      expect(mockNotificationService.addNotification).toHaveBeenCalled();
      const lastCall = vi.mocked(mockNotificationService.addNotification).mock.lastCall;
      expect(lastCall).toBeDefined();
      const [notification] = lastCall!;
      const typedNotification = notification as {
        message?: string;
      };
      expect(typedNotification.message).toBe('Reacted to a note mentioning you');
    });

    it('should ignore reaction when reacted note is neither authored by nor mentioning the current account', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      const now = Math.floor(Date.now() / 1000);
      const reactionEvent = {
        id: 'reaction-3',
        pubkey: TEST_PUBKEY_B,
        kind: kinds.Reaction,
        created_at: now,
        content: '+',
        tags: [
          ['e', 'target-note-3'],
          ['p', TEST_PUBKEY_A],
        ],
      };

      mockAccountRelay.getMany.mockImplementation(async <T>(filter: {
        kinds?: number[];
      }) => {
        if (filter.kinds?.includes(kinds.Reaction)) {
          return [reactionEvent] as unknown as T[];
        }
        return [] as T[];
      });

      mockDatabase.getEventById.mockImplementation((eventId: string) => {
        if (eventId === 'target-note-3') {
          return Promise.resolve({
            id: 'target-note-3',
            pubkey: 'dddd'.repeat(16),
            content: 'Parent note content',
            tags: [],
            kind: kinds.ShortTextNote,
            created_at: now - 100,
            sig: '',
          });
        }
        return Promise.resolve(null);
      });

      await service.initialize();
      await service.checkForNewNotifications();

      expect(mockNotificationService.addNotification).not.toHaveBeenCalled();
    });

    it('should keep "your note" when reacting to a note authored by the current account', async () => {
      mockAccountLocalState.getNotificationLastCheck.mockReturnValue(1700000000);

      const now = Math.floor(Date.now() / 1000);
      const reactionEvent = {
        id: 'reaction-2',
        pubkey: TEST_PUBKEY_B,
        kind: kinds.Reaction,
        created_at: now,
        content: '+',
        tags: [
          ['e', 'target-note-2'],
          ['p', TEST_PUBKEY_A],
        ],
      };

      mockAccountRelay.getMany.mockImplementation(async <T>(filter: {
        kinds?: number[];
      }) => {
        if (filter.kinds?.includes(kinds.Reaction)) {
          return [reactionEvent] as unknown as T[];
        }
        return [] as T[];
      });

      mockDatabase.getEventById.mockImplementation((eventId: string) => {
        if (eventId === 'target-note-2') {
          return Promise.resolve({
            id: 'target-note-2',
            pubkey: TEST_PUBKEY_A,
            content: '',
            tags: [],
            kind: kinds.ShortTextNote,
            created_at: now - 100,
            sig: '',
          });
        }
        return Promise.resolve(null);
      });

      await service.initialize();
      await service.checkForNewNotifications();

      expect(mockNotificationService.addNotification).toHaveBeenCalled();
      const lastCall = vi.mocked(mockNotificationService.addNotification).mock.lastCall;
      expect(lastCall).toBeDefined();
      const [notification] = lastCall!;
      const typedNotification = notification as {
        message?: string;
      };
      expect(typedNotification.message).toBe('Reacted to your note');
    });
  });
});
