import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DesktopNotificationService } from '../../../services/desktop-notification.service';
import { DesktopNotificationSettings } from '../../../services/local-settings.service';

@Component({
  selector: 'app-desktop-notification-settings',
  imports: [MatButtonModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:focus)': 'refreshPermission()' },
  template: `
    <section>
      <h2 i18n="@@notifications.desktop.title">Native notifications</h2>
      <p i18n="@@notifications.desktop.description">
        Receive notifications directly from your relays without a push server or device registration.
        Keep Nostria running and connected. Desktop notifications work while minimized; quitting the
        app or putting your computer to sleep stops delivery. Mobile systems may pause the app in the background.
      </p>
      <p i18n="@@notifications.desktop.timing">Messages arrive through live subscriptions. Social activity is checked every minute on desktop.</p>
      <p class="status" role="status">{{ permissionLabel() }}</p>
      @if (notifications.permission() === 'denied') {
        <p i18n="@@notifications.desktop.blocked">Allow Nostria notifications in your operating system settings, then check permission again.</p>
      }
      <div class="actions">
        @if (notifications.permission() !== 'granted') {
          <button mat-flat-button [disabled]="busy()" (click)="enable()" i18n="@@notifications.desktop.allow">Allow notifications</button>
        }
        <button mat-button [disabled]="busy()" (click)="refreshPermission()" i18n="@@notifications.desktop.check">Check permission</button>
        <button mat-button [disabled]="busy() || notifications.permission() !== 'granted'" (click)="test()" i18n="@@notifications.desktop.test">Send test notification</button>
      </div>
      @if (feedback()) {
        <p role="status">{{ feedback() }}</p>
      }
      <p i18n="@@notifications.desktop.troubleshooting">If the test does not appear, check Do Not Disturb and Nostria notification settings in your operating system. On Windows, test the installed app.</p>
      <mat-slide-toggle [checked]="notifications.preferences().enabled"
        [disabled]="busy() || (notifications.permission() !== 'granted' && !notifications.preferences().enabled)"
        (change)="update('enabled', $event.checked)" i18n="@@notifications.desktop.enabled">Enable native notifications on this device</mat-slide-toggle>
      <div class="preferences">
        @for (category of categories; track category.key) {
          <mat-slide-toggle [checked]="notifications.preferences()[category.key]"
            [disabled]="!notifications.preferences().enabled"
            (change)="update(category.key, $event.checked)">{{ category.label }}</mat-slide-toggle>
        }
      </div>
      <p i18n="@@notifications.desktop.local-only">These preferences apply to this device. Your in-app notification list and browser push preferences are managed separately.</p>
    </section>
  `,
  styles: `
    section {
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 16px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      border: 1px solid var(--mat-sys-outline-variant);
    }
    h2 { margin-top: 0; }
    p { color: var(--mat-sys-on-surface-variant); line-height: 1.5; }
    .status { color: var(--mat-sys-on-surface); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .preferences { display: grid; gap: 16px; margin-top: 24px; }
  `,
})
export class DesktopNotificationSettingsComponent {
  readonly notifications = inject(DesktopNotificationService);
  readonly busy = signal(false);
  readonly feedback = signal('');
  readonly categories: { key: keyof DesktopNotificationSettings; label: string }[] = [
    { key: 'messages', label: $localize`:@@notifications.desktop.messages:Direct messages` },
    { key: 'mentions', label: $localize`:@@notifications.desktop.mentions:Mentions` },
    { key: 'replies', label: $localize`:@@notifications.desktop.replies:Replies` },
    { key: 'zaps', label: $localize`:@@notifications.desktop.zaps:Zaps` },
    { key: 'reposts', label: $localize`:@@notifications.desktop.reposts:Reposts` },
    { key: 'reactions', label: $localize`:@@notifications.desktop.reactions:Reactions` },
    { key: 'showPreview', label: $localize`:@@notifications.desktop.previews:Show message and activity previews` },
    { key: 'whenFocused', label: $localize`:@@notifications.desktop.focused:Notify while using Nostria` },
  ];
  readonly permissionLabel = computed(() => {
    switch (this.notifications.permission()) {
      case 'granted': return $localize`:@@notifications.desktop.granted:Notification permission granted`;
      case 'denied': return $localize`:@@notifications.desktop.denied:Notifications blocked`;
      case 'unsupported': return $localize`:@@notifications.desktop.unsupported:Notifications unavailable`;
      case 'error': return $localize`:@@notifications.desktop.error:Could not check notification permission`;
      default: return $localize`:@@notifications.desktop.default:Notification permission needed`;
    }
  });

  constructor() {
    void this.refreshPermission();
  }

  update(key: keyof DesktopNotificationSettings, value: boolean): void {
    this.notifications.updatePreferences({ [key]: value });
  }

  async refreshPermission(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.notifications.refreshPermission();
    this.busy.set(false);
  }

  async enable(): Promise<void> {
    this.busy.set(true);
    if (await this.notifications.requestPermission()) {
      this.notifications.updatePreferences({ enabled: true });
    }
    this.busy.set(false);
  }

  async test(): Promise<void> {
    this.busy.set(true);
    this.feedback.set(await this.notifications.sendTest()
      ? $localize`:@@notifications.desktop.test-sent:Test submitted to your operating system.`
      : $localize`:@@notifications.desktop.test-failed:Could not send the test notification. Check permission and try again.`);
    this.busy.set(false);
  }
}
