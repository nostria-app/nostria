import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-setting-right-sidebar',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.layout.right-sidebar">Show Right Sidebar</span>
        <mat-slide-toggle [checked]="settings.settings().rightSidebarEnabled === true" (change)="toggleRightSidebar()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.layout.right-sidebar.description">
        Show the desktop right sidebar with Favorites and Runes. This syncs with your account settings across devices.
      </p>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 12px 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class SettingRightSidebarComponent {
  readonly settings = inject(SettingsService);

  toggleRightSidebar(): void {
    const currentValue = this.settings.settings().rightSidebarEnabled === true;
    void this.settings.updateSettings({ rightSidebarEnabled: !currentValue });
  }
}
