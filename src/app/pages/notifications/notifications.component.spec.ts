import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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
import { NotificationType, Notification, ContentNotification } from '../../services/database.service';

describe('NotificationsComponent', () => {
  let component: NotificationsComponent;
  let fixture: ComponentFixture<NotificationsComponent>;
  let mockNotificationService: {
    notifications: ReturnType<typeof signal<Notification[]>>;
    markAsRead: jasmine.Spy;
    clearNotifications: jasmine.Spy;
    removeNotification: jasmine.Spy;
  };

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
    mockNotificationService = {
      notifications: signal<Notification[]>([]),
      markAsRead: jasmine.createSpy('markAsRead'),
      clearNotifications: jasmine.createSpy('clearNotifications'),
      removeNotification: jasmine.createSpy('removeNotification'),
    };

    const mockAccountRelay = {};
    const mockLocalStorage = {
      getItem: jasmine.createSpy('getItem').and.returnValue(null),
      setItem: jasmine.createSpy('setItem'),
    };
    const mockContentNotificationService = {
      refreshRecentNotifications: jasmine.createSpy('refreshRecentNotifications').and.returnValue(Promise.resolve()),
      checkForOlderNotifications: jasmine.createSpy('checkForOlderNotifications').and.returnValue(Promise.resolve()),
    };
    const mockAccountState = {
      pubkey: signal('test-pubkey'),
      mutedAccounts: signal<string[]>([]),
    };
    const mockAccountLocalState = {
      setNotificationLastCheck: jasmine.createSpy('setNotificationLastCheck'),
    };
    const mockDataService = {
      batchLoadProfiles: jasmine.createSpy('batchLoadProfiles').and.returnValue(Promise.resolve(new Map())),
      getCachedProfile: jasmine.createSpy('getCachedProfile').and.returnValue(null),
    };
    const mockLayout = {
      openProfile: jasmine.createSpy('openProfile'),
      openGenericEvent: jasmine.createSpy('openGenericEvent'),
      openArticle: jasmine.createSpy('openArticle'),
      openZapDetail: jasmine.createSpy('openZapDetail'),
    };
    const mockLogger = {
      info: jasmine.createSpy('info'),
      debug: jasmine.createSpy('debug'),
      warn: jasmine.createSpy('warn'),
      error: jasmine.createSpy('error'),
    };
    const mockTwoColumnLayout = {
      setSplitView: jasmine.createSpy('setSplitView'),
    };
    const mockTrustService = {
      isEnabled: () => false,
      fetchMetricsBatch: jasmine.createSpy('fetchMetricsBatch').and.returnValue(Promise.resolve(new Map())),
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

  describe('mark all as read button', () => {
    it('should show mark all as read button in the header when notifications exist', async () => {
      mockNotificationService.notifications.set([createMockNotification()]);
      fixture.detectChanges();
      await fixture.whenStable();

      const headerButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'));
      const markAllButton = headerButtons.find(
        btn => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all'
      );
      expect(markAllButton).toBeTruthy();
    });

    it('should not show mark all as read button when there are no notifications', async () => {
      mockNotificationService.notifications.set([]);
      fixture.detectChanges();
      await fixture.whenStable();

      const headerButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'));
      const markAllButton = headerButtons.find(
        btn => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all'
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

      const headerButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.panel-header button[mat-icon-button]'));
      const markAllButton = headerButtons.find(
        btn => btn.querySelector('mat-icon')?.textContent?.trim() === 'done_all'
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
        (item: Element) => item.querySelector('mat-icon')?.textContent?.trim() === 'done_all'
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

      expect(component.getFormattedNotificationTitle(reactionNotification)).toBe('reacted to your note');
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
});
