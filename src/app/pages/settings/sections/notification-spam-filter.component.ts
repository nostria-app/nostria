import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LocalSettingsService, MaxTaggedAccountsFilter } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-notification-spam-filter',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.notification-spam-filter.title">Notification Spam Filter</h2>
      <p i18n="@@settings.notification-spam-filter.description">
        Filter out notifications from events that tag too many accounts. Spammers often mass-tag users to get attention.
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.notification-spam-filter.label">Maximum tagged accounts</mat-label>
        <mat-select [ngModel]="localSettings.maxTaggedAccountsFilter()" (selectionChange)="setFilter($event.value)">
          <mat-option value="none" i18n="@@settings.notification-spam-filter.none">No limit (allow all)</mat-option>
          <mat-option [value]="10" i18n="@@settings.notification-spam-filter.10">10 accounts</mat-option>
          <mat-option [value]="50" i18n="@@settings.notification-spam-filter.50">50 accounts</mat-option>
          <mat-option [value]="100" i18n="@@settings.notification-spam-filter.100">100 accounts</mat-option>
          <mat-option [value]="200" i18n="@@settings.notification-spam-filter.200">200 accounts</mat-option>
        </mat-select>
      </mat-form-field>
      <p class="filter-description">
        @switch (localSettings.maxTaggedAccountsFilter()) {
          @case ('none') {
            <ng-container i18n="@@settings.notification-spam-filter.none.description">
              All notifications will be shown regardless of how many accounts are tagged in the event.
            </ng-container>
          }
          @default {
            <ng-container i18n="@@settings.notification-spam-filter.active.description">
              Events tagging more than {{ localSettings.maxTaggedAccountsFilter() }} accounts will not generate notifications.
            </ng-container>
          }
        }
      </p>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
    .full-width {
      width: 100%;
    }
    h2 {
      margin-top: 0;
    }
    .filter-description {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
    }
  `]
})
export class SettingNotificationSpamFilterComponent {
  readonly localSettings = inject(LocalSettingsService);

  setFilter(value: MaxTaggedAccountsFilter): void {
    this.localSettings.setMaxTaggedAccountsFilter(value);
  }
}
