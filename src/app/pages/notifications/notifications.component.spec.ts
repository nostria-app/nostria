import '@angular/compiler';
import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { NotificationsComponent } from './notifications.component';
import { NotificationService } from '../../services/notification.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { LocalStorageService } from '../../services/local-storage.service';
import { ContentNotificationService } from '../../services/content-notification.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { TrustService } from '../../services/trust.service';
import {
  NotificationType,
  Notification,
  ContentNotification,
  RelayPublishingNotification,
} from '../../services/database.service';

describe('NotificationsComponent', () => {
  let component: NotificationsComponent;
  let fixture: ComponentFixture<NotificationsComponent>;
  let mockNotificationService: {
    notifications: ReturnType<typeof signal<Notification[]>>;
    markAsRead: Mock;
    clearNotifications: Mock;
    removeNotification: Mock;
    updateRelayPromiseStatus: Mock;
    retryFailedRelays: Mock;
  };
  let mockAccountRelay: {
    publishToRelay: Mock;
  };
  let mockContentNotificationService: {
    refreshRecentNotifications: Mock;
    checkForOlderNotifications: Mock;
    isCheckingNotifications: ReturnType<typeof signal<boolean>>;
    stopPolling: Mock;
    startPolling: Mock;
    markNotificationsCleared: Mock;
    markNotificationsReadWatermark: Mock;
  };
  let mockAccountLocalState: {
    setNotificationLastCheck: Mock;
    getNotificationClearedAt: Mock;
  };

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  function createMockNotification(overrides: Partial<Notification> = {}): Notification {
    return {
      id: 'test-id-1',
      type: NotificationType.MENTION,
      title: 'mentioned you',
      message: 'Hello world',
      timestamp: Date.now(),
      read: false,
      recipientPubkey: 'recipient-pubkey',
      ...overrides,
    } as Notification;
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    mockNotificationService = {
      notifications: signal<Notification[]>([]),
      markAsRead: vi.fn(),
      clearNotifications: vi.fn(),
      removeNotification: vi.fn(),
      updateRelayPromiseStatus: vi.fn().mockResolvedValue(undefined),
      retryFailedRelays: vi.fn().mockResolvedValue(undefined),
    };

    mockAccountRelay = {
      publishToRelay: vi.fn(),
    };
    const mockLocalStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };
    mockContentNotificationService = {
      refreshRecentNotifications: vi.fn().mockReturnValue(Promise.resolve()),
      checkForOlderNotifications: vi.fn().mockReturnValue(Promise.resolve()),
      isCheckingNotifications: signal(false),
      stopPolling: vi.fn(),
      startPolling: vi.fn(),
      markNotificationsCleared: vi.fn(),
      markNotificationsReadWatermark: vi.fn(),
    };
    const mockAccountState = {
      pubkey: signal('test-pubkey'),
      mutedAccounts: signal<string[]>([]),
      followingList: signal<string[]>([]),
    };
    mockAccountLocalState = {
      setNotificationLastCheck: vi.fn(),
      getNotificationClearedAt: vi.fn().mockReturnValue(0),
    };
    const mockDataService = {
      batchLoadProfiles: vi.fn().mockReturnValue(Promise.resolve(new Map())),
      getCachedProfile: vi.fn().mockReturnValue(null),
    };
    const mockLayout = {
      openProfile: vi.fn(),
      openGenericEvent: vi.fn(),
      openArticle: vi.fn(),
      openZapDetail: vi.fn(),
    };
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const mockTwoColumnLayout = {
      setSplitView: vi.fn(),
    };
    const mockTrustService = {
      isEnabled: vi.fn().mockReturnValue(false),
      fetchMetricsBatch: vi.fn().mockReturnValue(Promise.resolve(new Map())),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent, NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: AccountRelayService, useValue: mockAccountRelay },
        { provide: LocalStorageService, useValue: mockLocalStorage },
        { provide: ContentNotificationService, useValue: mockContentNotificationService },
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: AccountLocalStateService, useValue: mockAccountLocalState },
        { provide: DataService, useValue: mockDataService },
        { provide: LayoutService, useValue: mockLayout },
        { provide: LoggerService, useValue: mockLogger },
        { provide: TwoColumnLayoutService, useValue: mockTwoColumnLayout },
        { provide: TrustService, useValue: mockTrustService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('notifications view dropdown', () => {
    it('should show Notifications by default', () => {
      const titleText = fixture.nativeElement
        .querySelector('.panel-title-text')
        ?.textContent?.trim();

      expect(titleText).toBe('Notifications');
    });

    it('should update the title when switching to system notifications', async () => {
      component.setNotificationsView(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const titleText = fixture.nativeElement
        .querySelector('.panel-title-text')
        ?.textContent?.trim();
      expect(titleText).toBe('System Notifications');
    });
  });

  describe('mark all as read button', () => {
    it('should show mark all as read button in the header when notifications exist', async () => {
      mockNotificationService.notifications.set([createMockNotification()]);
      fixture.detectChanges();
      await fixture.whenStable();

      const headerButtons: HTMLButtonElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'),
      );
      const markAllButton = headerButtons.find(
        (btn) => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all',
      );
      expect(markAllButton).toBeTruthy();
    });

    it('should not show mark all as read button when there are no notifications', async () => {
      mockNotificationService.notifications.set([]);
      fixture.detectChanges();
      await fixture.whenStable();

      const headerButtons: HTMLButtonElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'),
      );
      const markAllButton = headerButtons.find(
        (btn) => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all',
      );
      expect(markAllButton).toBeFalsy();
    });

    it('should call markAllAsRead when the header button is clicked', async () => {
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', read: false }),
        createMockNotification({ id: 'n2', read: false }),
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      const headerButtons: HTMLButtonElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'),
      );
      const markAllButton = headerButtons.find(
        (btn) => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all',
      );
      expect(markAllButton).toBeTruthy();

      markAllButton!.click();
      fixture.detectChanges();

      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n1');
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n2');
    });

    it('should not have mark all as read inside the overflow menu', async () => {
      mockNotificationService.notifications.set([createMockNotification()]);
      fixture.detectChanges();
      await fixture.whenStable();

      // Check the mat-menu template content - look for mat-menu-item with done_all icon
      const menuItems = document.querySelectorAll('mat-menu button[mat-menu-item]');
      const markAllMenuItem = Array.from(menuItems).find(
        (item: Element) => item.querySelector('mat-icon')?.textContent?.trim() === 'done_all',
      );
      expect(markAllMenuItem).toBeFalsy();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', () => {
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', read: false }),
        createMockNotification({ id: 'n2', read: true }),
        createMockNotification({ id: 'n3', read: false }),
      ]);

      component.markAllAsRead();

      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n1');
      expect(mockNotificationService.markAsRead).not.toHaveBeenCalledWith('n2');
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n3');
    });

    it('should not call markAsRead when all notifications are already read', () => {
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', read: true }),
        createMockNotification({ id: 'n2', read: true }),
      ]);

      component.markAllAsRead();

      expect(mockNotificationService.markAsRead).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should set the notification read watermark when an unread content notification is read', () => {
      mockAccountLocalState.getNotificationClearedAt.mockReturnValue(1700001000);
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', type: NotificationType.MENTION, read: false }),
      ]);

      component.markAsRead('n1');

      expect(mockContentNotificationService.markNotificationsReadWatermark).toHaveBeenCalled();
      expect(component.clearedAtTimestamp()).toBe(1700001000);
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n1');
    });

    it('should not set the read watermark for an already read notification', () => {
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', type: NotificationType.MENTION, read: true }),
      ]);

      component.markAsRead('n1');

      expect(mockContentNotificationService.markNotificationsReadWatermark).not.toHaveBeenCalled();
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n1');
    });

    it('should not move an existing read watermark when another notification is read', () => {
      component.clearedAtTimestamp.set(1700001000);
      mockNotificationService.notifications.set([
        createMockNotification({ id: 'n1', type: NotificationType.MENTION, read: false }),
      ]);

      component.markAsRead('n1');

      expect(mockContentNotificationService.markNotificationsReadWatermark).not.toHaveBeenCalled();
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('n1');
    });
  });

  describe('newNotificationCount', () => {
    it('should only count unread notifications newer than the read watermark', () => {
      const watermark = 1700001000;
      component.clearedAtTimestamp.set(watermark);
      mockNotificationService.notifications.set([
        createMockNotification({
          id: 'old-unread',
          read: false,
          timestamp: (watermark - 60) * 1000,
        }),
        createMockNotification({
          id: 'new-unread',
          read: false,
          timestamp: (watermark + 60) * 1000,
        }),
        createMockNotification({
          id: 'new-read',
          read: true,
          timestamp: (watermark + 120) * 1000,
        }),
      ]);

      expect(component.newNotificationCount()).toBe(1);
    });
  });

  describe('getFormattedNotificationTitle', () => {
    it('should preserve reaction context text for custom emoji reactions', () => {
      const reactionNotification = createMockNotification({
        type: NotificationType.REACTION,
        title: 'Reacted :fist: to your note',
      }) as ContentNotification;

      reactionNotification.metadata = {
        reactionContent: ':fist:',
        customEmojiUrl: 'https://example.com/fist.png',
      };

      expect(component.getFormattedNotificationTitle(reactionNotification)).toBe(
        'reacted to your note',
      );
    });

    it('should still replace plus reactions with heart emoji', () => {
      const plusReaction = createMockNotification({
        type: NotificationType.REACTION,
        title: 'Reacted + to your note',
      });

      expect(component.getFormattedNotificationTitle(plusReaction)).toBe('reacted ❤️ to your note');
    });

    it('should split custom emoji reaction title for inline emoji rendering', () => {
      const reactionNotification = createMockNotification({
        type: NotificationType.REACTION,
        title: 'Reacted :fist: to your note',
      }) as ContentNotification;

      reactionNotification.metadata = {
        reactionContent: ':fist:',
        customEmojiUrl: 'https://example.com/fist.png',
      };

      expect(component.getCustomEmojiTitleSegments(reactionNotification)).toEqual({
        prefix: 'reacted',
        suffix: ' to your note',
      });
    });
  });

  describe('onRepublish', () => {
    it('marks relays as failed when republish promise rejects', async () => {
      const relayNotification: RelayPublishingNotification = {
        id: 'publish-1',
        type: NotificationType.RELAY_PUBLISHING,
        title: 'Publishing to relays',
        timestamp: Date.now(),
        read: false,
        event: {
          id: 'event-1',
          pubkey: 'f'.repeat(64),
          created_at: Math.floor(Date.now() / 1000),
          kind: 7,
          tags: [],
          content: '+',
          sig: 'a'.repeat(128),
        },
        relayPromises: [
          { relayUrl: 'wss://nostr.wine/', status: 'success' },
          { relayUrl: 'wss://relay.damus.io/', status: 'success' },
        ],
        complete: true,
      };

      mockNotificationService.notifications.set([relayNotification]);
      mockAccountRelay.publishToRelay
        .mockResolvedValueOnce([Promise.reject(new Error('restricted: sign up required'))])
        .mockResolvedValueOnce([Promise.resolve('ok')]);

      await component.onRepublish('publish-1');

      expect(mockNotificationService.updateRelayPromiseStatus).toHaveBeenCalledWith(
        'publish-1',
        'wss://nostr.wine/',
        'pending',
      );
      expect(mockNotificationService.updateRelayPromiseStatus).toHaveBeenCalledWith(
        'publish-1',
        'wss://relay.damus.io/',
        'pending',
      );
      expect(mockNotificationService.updateRelayPromiseStatus).toHaveBeenCalledWith(
        'publish-1',
        'wss://nostr.wine/',
        'failed',
        expect.any(Error),
      );
      expect(mockNotificationService.updateRelayPromiseStatus).toHaveBeenCalledWith(
        'publish-1',
        'wss://relay.damus.io/',
        'success',
      );
    });
  });

  describe('Web of Trust filtering', () => {
    function createContentNotification(authorPubkey: string, id: string): ContentNotification {
      return {
        ...createMockNotification({ id, type: NotificationType.MENTION }),
        authorPubkey,
      } as ContentNotification;
    }

    it('should keep followed authors when WoT score is missing', () => {
      const followedAuthor = 'followed-pubkey';
      const nonFollowedAuthor = 'not-followed-pubkey';
      const accountState = TestBed.inject(AccountStateService) as unknown as {
        followingList: ReturnType<typeof signal<string[]>>;
      };

      accountState.followingList.set([followedAuthor]);
      mockNotificationService.notifications.set([
        createContentNotification(followedAuthor, 'followed-1'),
        createContentNotification(nonFollowedAuthor, 'other-1'),
      ]);

      component.wotFilterLevel.set('low');
      (
        component as unknown as {
          authorTrustRanks: ReturnType<typeof signal<Map<string, number | null>>>;
        }
      ).authorTrustRanks.set(
        new Map([
          [followedAuthor, null],
          [nonFollowedAuthor, null],
        ]),
      );

      const filtered = component.contentNotifications();

      expect(filtered.map((n) => (n as ContentNotification).authorPubkey)).toEqual([
        followedAuthor,
      ]);
    });
  });

  describe('profile preloading', () => {
    function createContentNotification(authorPubkey: string, id: string): ContentNotification {
      return {
        ...createMockNotification({ id, type: NotificationType.MENTION }),
        authorPubkey,
      } as ContentNotification;
    }

    it('preloads only the initial virtual-scroll window instead of the whole history', async () => {
      const notifications = Array.from({ length: 120 }, (_, index) =>
        createContentNotification(`author-${index}`, `notification-${index}`),
      ).map((notification, index) => ({
        ...notification,
        timestamp: Date.now() + (120 - index),
      }) as ContentNotification);

      vi.mocked(TestBed.inject(DataService).batchLoadProfiles).mockClear();

      mockNotificationService.notifications.set(notifications);
      fixture.detectChanges();
      await fixture.whenStable();

      const calls = vi.mocked(TestBed.inject(DataService).batchLoadProfiles).mock.calls;
      const loadedPubkeys = calls[calls.length - 1]?.[0];
      expect(loadedPubkeys).toBeDefined();
      expect(loadedPubkeys!.length).toBeLessThanOrEqual(80);
      expect(loadedPubkeys).toContain('author-0');
      expect(loadedPubkeys).not.toContain('author-119');
    });

    it('preloads WoT ranks from a bounded raw window when WoT filtering is active', async () => {
      const trustService = TestBed.inject(TrustService) as unknown as {
        isEnabled: Mock;
        fetchMetricsBatch: Mock;
      };
      trustService.isEnabled.mockReturnValue(true);
      trustService.fetchMetricsBatch.mockClear();

      const notifications = Array.from({ length: 400 }, (_, index) =>
        createContentNotification(`author-${index}`, `notification-${index}`),
      ).map(
        (notification, index) =>
          ({
            ...notification,
            timestamp: Date.now() + (400 - index),
          }) as ContentNotification,
      );

      component.wotFilterLevel.set('low');
      mockNotificationService.notifications.set(notifications);
      fixture.detectChanges();
      await fixture.whenStable();

      const calls = trustService.fetchMetricsBatch.mock.calls;
      const loadedPubkeys = calls[calls.length - 1]?.[0] as string[] | undefined;
      expect(loadedPubkeys).toBeDefined();
      expect(loadedPubkeys!.length).toBeLessThanOrEqual(300);
      expect(loadedPubkeys).toContain('author-0');
      expect(loadedPubkeys).not.toContain('author-399');
    });
  });
});
