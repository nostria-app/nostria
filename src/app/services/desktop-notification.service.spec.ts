import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { AccountStateService } from './account-state.service';
import { DesktopNotification, DesktopNotificationService } from './desktop-notification.service';
import { DEFAULT_DESKTOP_NOTIFICATIONS, LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';

describe('DesktopNotificationService', () => {
  const now = 1_800_000_000_000;
  const pubkey = signal('recipient');
  const mutedAccounts = signal<string[]>([]);
  const settings = signal({ desktopNotifications: { ...DEFAULT_DESKTOP_NOTIFICATIONS } });
  const ipc = vi.fn<(command: string, args?: unknown) => unknown>();
  let service: DesktopNotificationService;
  const notification: DesktopNotification = {
    id: 'message-1', category: 'messages', title: 'New message', body: 'Private message content',
    timestamp: now, recipientPubkey: 'recipient', authorPubkey: 'sender',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal('isTauri', true);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    pubkey.set('recipient');
    mutedAccounts.set([]);
    settings.set({ desktopNotifications: { ...DEFAULT_DESKTOP_NOTIFICATIONS, enabled: true } });
    ipc.mockReset().mockImplementation(command =>
      command === 'plugin:notification|is_permission_granted' ? true : undefined);
    mockIPC(ipc);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AccountStateService, useValue: { pubkey, mutedAccounts } satisfies Pick<AccountStateService, 'pubkey' | 'mutedAccounts'> },
        { provide: LocalSettingsService, useValue: { settings } },
        { provide: LoggerService, useValue: { warn: vi.fn() } satisfies Pick<LoggerService, 'warn'> },
      ],
    });
    service = TestBed.inject(DesktopNotificationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    clearMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function sentOptions(): unknown[] {
    return ipc.mock.calls.filter(([command]) => command === 'plugin:notification|notify')
      .map(([, args]) => args);
  }

  it('delivers once across concurrent duplicate events and hides previews by default', async () => {
    await Promise.all([service.notify(notification), service.notify(notification)]);
    await service.notify(notification);
    expect(sentOptions()).toEqual([{ options: {
      title: 'Nostria', body: 'You have new activity in Nostria.',
    } }]);
  });

  it('includes bounded content only when previews are enabled', async () => {
    settings.update(value => ({ desktopNotifications: { ...value.desktopNotifications, showPreview: true } }));
    await service.notify({ ...notification, body: 'a'.repeat(1000) });
    expect(sentOptions()).toEqual([{ options: { title: 'New message', body: 'a'.repeat(240) } }]);
  });

  it('does not request permission automatically or deliver when permission is denied', async () => {
    ipc.mockResolvedValue(false);
    await service.notify(notification);
    expect(service.permission()).toBe('denied');
    expect(ipc.mock.calls.map(([command]) => command)).toEqual(['plugin:notification|is_permission_granted']);
  });

  it('filters old, future, muted, self-authored and other-account activity', async () => {
    await service.notify({ ...notification, timestamp: now - 1 });
    await service.notify({ ...notification, timestamp: now + 1 });
    await service.notify({ ...notification, recipientPubkey: 'other' });
    await service.notify({ ...notification, authorPubkey: 'recipient' });
    mutedAccounts.set(['sender']);
    await service.notify(notification);
    expect(ipc).not.toHaveBeenCalled();
  });

  it('rechecks the account after async permission lookup', async () => {
    ipc.mockImplementation(() => { pubkey.set('other'); return true; });
    await service.notify(notification);
    expect(sentOptions()).toEqual([]);
  });

  it('respects disabled categories, the master switch, and foreground suppression', async () => {
    await service.notify({ ...notification, category: 'reactions' });
    settings.set({ desktopNotifications: { ...DEFAULT_DESKTOP_NOTIFICATIONS } });
    await service.notify(notification);
    settings.set({ desktopNotifications: { ...DEFAULT_DESKTOP_NOTIFICATIONS, enabled: true } });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await service.notify(notification);
    expect(ipc).not.toHaveBeenCalled();
    settings.update(value => ({ desktopNotifications: { ...value.desktopNotifications, whenFocused: true } }));
    await service.notify(notification);
    expect(sentOptions()).toHaveLength(1);
  });

  it('reports native send failures for tests without claiming delivery', async () => {
    ipc.mockImplementation(command => {
      if (command === 'plugin:notification|notify') throw new Error('Native failure');
      return true;
    });
    expect(await service.sendTest()).toBe(false);
    await expect(service.notify(notification)).resolves.toBeUndefined();
  });

  it('does not use native delivery in a browser or during SSR', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: AccountStateService, useValue: { pubkey, mutedAccounts } },
        { provide: LocalSettingsService, useValue: { settings } },
        { provide: LoggerService, useValue: { warn: vi.fn() } },
      ],
    });
    service = TestBed.inject(DesktopNotificationService);
    await service.refreshPermission();
    await service.notify(notification);
    expect(service.permission()).toBe('unsupported');
    expect(ipc).not.toHaveBeenCalled();
  });
});
