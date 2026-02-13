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

describe('ContentNotificationService', () => {
  let service: ContentNotificationService;
  let mockAccountState: {
    pubkey: ReturnType<typeof signal<string | undefined>>;
    mutedAccounts: ReturnType<typeof signal<string[]>>;
  };
  let mockAccountLocalState: jasmine.SpyObj<AccountLocalStateService>;
  let mockNotificationService: {
    notifications: ReturnType<typeof signal<unknown[]>>;
    addNotification: jasmine.Spy;
    persistNotificationToStorage: jasmine.Spy;
  };
  let mockAccountRelay: jasmine.SpyObj<AccountRelayService>;
  let mockDatabase: jasmine.SpyObj<DatabaseService>;
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

    mockAccountLocalState = jasmine.createSpyObj('AccountLocalStateService', [
      'getNotificationLastCheck',
      'setNotificationLastCheck',
    ]);
    mockAccountLocalState.getNotificationLastCheck.and.returnValue(0);

    mockNotificationService = {
      notifications: signal<unknown[]>([]),
      addNotification: jasmine.createSpy('addNotification'),
      persistNotificationToStorage: jasmine.createSpy('persistNotificationToStorage').and.returnValue(Promise.resolve()),
    };

    mockAccountRelay = jasmine.createSpyObj('AccountRelayService', ['getMany', 'get']);
    mockAccountRelay.getMany.and.returnValue(Promise.resolve([]));
    mockAccountRelay.get.and.returnValue(Promise.resolve(null));

    mockDatabase = jasmine.createSpyObj('DatabaseService', [
      'getNotification',
      'getEventById',
    ]);
    mockDatabase.getNotification.and.returnValue(Promise.resolve(undefined));
    mockDatabase.getEventById.and.returnValue(Promise.resolve(null));

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
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
            debug: jasmine.createSpy('debug'),
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
      mockAccountLocalState.getNotificationLastCheck.and.callFake((pubkey: string) => {
        if (pubkey === TEST_PUBKEY_A) return accountATimestamp;
        if (pubkey === TEST_PUBKEY_B) return 1700001000;
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
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);

      await service.initialize();

      // Trigger a check to set the rate limiter
      await service.checkForNewNotifications();

      // Switch account and call onAccountChanged
      mockAccountState.pubkey.set(TEST_PUBKEY_B);
      await service.onAccountChanged();

      // A subsequent check should NOT be rate-limited
      // (we verify by checking that getMany is called again)
      mockAccountRelay.getMany.calls.reset();
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
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(lastCheckTimestamp);

      await service.initialize();
      await service.checkForNewNotifications();

      // Verify that getMany was called with a `since` value less than the last check timestamp
      // The overlap buffer is 60 seconds, so since should be lastCheckTimestamp - 60
      const expectedSince = lastCheckTimestamp - 60;
      const getManyCall = mockAccountRelay.getMany.calls.first();
      expect(getManyCall.args[0].since).toBe(expectedSince);
    });

    it('should not apply overlap buffer for first-time users (since is 0)', async () => {
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(0);

      await service.initialize();
      await service.checkForNewNotifications();

      // For first-time users, since should be capped at 7 days back, not negative
      const getManyCall = mockAccountRelay.getMany.calls.first();
      expect(getManyCall.args[0].since).toBeGreaterThan(0);
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
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);
      // Make getMany return a delayed promise to simulate ongoing check
      let resolveGetMany: () => void;
      const delayedPromise = new Promise<never[]>((resolve) => {
        resolveGetMany = () => resolve([]);
      });
      mockAccountRelay.getMany.and.returnValue(delayedPromise);

      await service.initialize();

      // Start first check (it will hang)
      const firstCheck = service.checkForNewNotifications();

      // Second check should be skipped due to isChecking guard
      mockAccountRelay.getMany.calls.reset();
      await service.checkForNewNotifications();
      expect(mockAccountRelay.getMany).not.toHaveBeenCalled();

      // Resolve the first check
      resolveGetMany!();
      await firstCheck;
    });

    it('should immediately fetch notifications when timestamp is 0 (first-time or after cache clear)', async () => {
      // Simulate first-time user or after cache clear
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(0);

      await service.initialize();

      // Wait for the 1-second delay in the setTimeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify that getMany was called to fetch notifications
      expect(mockAccountRelay.getMany).toHaveBeenCalled();
    });

    it('should not immediately fetch notifications when timestamp is not 0', async () => {
      // Simulate returning user with existing timestamp
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);

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
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);
      await service.initialize();

      // Clear previous calls from initialization
      mockAccountRelay.getMany.calls.reset();

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
      (service as unknown as { lastCheckTime: number }).lastCheckTime = 0;

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

      const getManyCall = mockAccountRelay.getMany.calls.first();
      const now = Math.floor(Date.now() / 1000);
      const threeDaysAgo = now - (3 * 24 * 60 * 60);

      // The since timestamp should be approximately 3 days ago (within 5 seconds tolerance)
      expect(getManyCall.args[0].since).toBeGreaterThan(threeDaysAgo - 5);
      expect(getManyCall.args[0].since).toBeLessThan(threeDaysAgo + 5);
    });

    it('should not update lastCheckTimestamp', async () => {
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);
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
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);
      await service.initialize();

      service.resetLastCheckTimestamp();

      expect(service.lastCheckTimestamp()).toBe(0);
      expect(mockAccountLocalState.setNotificationLastCheck).toHaveBeenCalledWith(TEST_PUBKEY_A, 0);
    });
  });

  describe('checkForNewNotifications updates lastCheckTimestamp', () => {
    it('should update lastCheckTimestamp after successful check', async () => {
      mockAccountLocalState.getNotificationLastCheck.and.returnValue(1700000000);
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
});
