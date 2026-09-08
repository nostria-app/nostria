import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';
import { DesktopNotificationService } from '../../../services/desktop-notification.service';
import { DEFAULT_DESKTOP_NOTIFICATIONS } from '../../../services/local-settings.service';
import { DesktopNotificationSettingsComponent } from './desktop-notification-settings.component';

describe('Desktop notification settings', () => {
  const permission = signal<NotificationPermission>('default');
  const preferences = signal({ ...DEFAULT_DESKTOP_NOTIFICATIONS });
  const notifications = {
    permission,
    preferences,
    refreshPermission: vi.fn().mockResolvedValue(undefined),
    requestPermission: vi.fn(async () => { permission.set('granted'); return true; }),
    updatePreferences: vi.fn<DesktopNotificationService['updatePreferences']>(updates => {
      preferences.update(current => ({ ...current, ...updates }));
    }),
    sendTest: vi.fn().mockResolvedValue(true),
  } satisfies Pick<DesktopNotificationService,
    'permission' | 'preferences' | 'refreshPermission' | 'requestPermission' | 'updatePreferences' | 'sendTest'>;

  afterEach(() => {
    document.body.classList.remove('dark');
    TestBed.resetTestingModule();
  });

  it('updates permission and device preferences through the UI', async () => {
    TestBed.configureTestingModule({
      imports: [DesktopNotificationSettingsComponent],
      providers: [provideZonelessChangeDetection(), { provide: DesktopNotificationService, useValue: notifications }],
    });
    const fixture = TestBed.createComponent(DesktopNotificationSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await page.getByRole('button', { name: 'Allow notifications', exact: true }).click();
    await expect.element(page.getByText('Notification permission granted', { exact: true })).toBeVisible();
    expect(preferences().enabled).toBe(true);
    await page.getByRole('switch', { name: 'Show message and activity previews' }).click();
    expect(preferences().showPreview).toBe(true);
    await page.getByRole('button', { name: 'Send test notification' }).click();
    await expect.element(page.getByText('Test submitted to your operating system.')).toBeVisible();
    await page.viewport(720, 1100);
    await page.screenshot({ path: '../../../../../test-results/desktop-notifications-light.png' });
    document.body.classList.add('dark');
    await page.screenshot({ path: '../../../../../test-results/desktop-notifications-dark.png' });
  });
});
