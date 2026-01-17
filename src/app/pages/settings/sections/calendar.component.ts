import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LocalSettingsService, CalendarType, TimeFormat } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-calendar',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.calendar.title">Calendar System</h2>
      <p i18n="@@settings.calendar.description">Choose your preferred calendar system for displaying dates</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.calendar.label">Calendar</mat-label>
        <mat-select [ngModel]="localSettings.calendarType()" (selectionChange)="setCalendarType($event.value)">
          <mat-option value="gregorian" i18n="@@settings.calendar.gregorian">Gregorian Calendar</mat-option>
          <mat-option value="chronia" i18n="@@settings.calendar.chronia">Chronia Calendar</mat-option>
          <mat-option value="ethiopian" i18n="@@settings.calendar.ethiopian">Ethiopian Calendar</mat-option>
        </mat-select>
      </mat-form-field>
      <p class="calendar-description">
        @switch (localSettings.calendarType()) {
          @case ('gregorian') {
            <ng-container i18n="@@settings.calendar.gregorian.description">The standard civil calendar used worldwide with 12 months of varying lengths.</ng-container>
          }
          @case ('chronia') {
            <ng-container i18n="@@settings.calendar.chronia.description">A modern simplified calendar with 13 months of 28 days each, plus Solstice Day. Year 0 begins December 22, 2015.</ng-container>
          }
          @case ('ethiopian') {
            <ng-container i18n="@@settings.calendar.ethiopian.description">The traditional Ethiopian calendar with 13 months: 12 months of 30 days and Pagume (5-6 days). Approximately 7-8 years behind Gregorian.</ng-container>
          }
        }
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.time-format.label">Time Format</mat-label>
        <mat-select [ngModel]="localSettings.timeFormat()" (selectionChange)="setTimeFormat($event.value)">
          <mat-option value="24h" i18n="@@settings.time-format.24h">24-hour (14:30)</mat-option>
          <mat-option value="12h" i18n="@@settings.time-format.12h">12-hour (2:30 PM)</mat-option>
        </mat-select>
      </mat-form-field>
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
    .calendar-description {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
    }
  `]
})
export class SettingCalendarComponent {
  readonly localSettings = inject(LocalSettingsService);

  setCalendarType(calendarType: CalendarType): void {
    this.localSettings.setCalendarType(calendarType);
  }

  setTimeFormat(timeFormat: TimeFormat): void {
    this.localSettings.setTimeFormat(timeFormat);
  }
}
