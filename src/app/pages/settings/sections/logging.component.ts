import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LoggerService, LogLevel } from '../../../services/logger.service';

@Component({
  selector: 'app-setting-logging',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.logging">Logging</h2>
      <p i18n="@@settings.logging.description">Configure application logging levels</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.logging.log-level">Log Level</mat-label>
        <mat-select [ngModel]="logger.logLevel" (selectionChange)="setLogLevel($event.value)">
          <mat-option value="debug" i18n="@@settings.logging.debug">Debug</mat-option>
          <mat-option value="info" i18n="@@settings.logging.info">Info</mat-option>
          <mat-option value="warn" i18n="@@settings.logging.warn">Warning</mat-option>
          <mat-option value="error" i18n="@@settings.logging.error">Error</mat-option>
          <mat-option value="none" i18n="@@settings.logging.none">None</mat-option>
        </mat-select>
      </mat-form-field>
      <p>
        @switch (logger.logLevel) {
          @case ('debug') {
            <ng-container i18n="@@settings.logging.debug.description">Shows all log messages including detailed debug information.</ng-container>
          }
          @case ('info') {
            <ng-container i18n="@@settings.logging.info.description">Shows informational messages, warnings and errors.</ng-container>
          }
          @case ('warn') {
            <ng-container i18n="@@settings.logging.warn.description">Shows only warnings and errors.</ng-container>
          }
          @case ('error') {
            <ng-container i18n="@@settings.logging.error.description">Shows only error messages.</ng-container>
          }
          @case ('none') {
            <ng-container i18n="@@settings.logging.none.description">Disables all logging output.</ng-container>
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
  `]
})
export class SettingLoggingComponent {
  readonly logger = inject(LoggerService);

  setLogLevel(level: LogLevel): void {
    this.logger.setLogLevel(level);
  }
}
