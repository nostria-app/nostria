import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-setting-dark-mode',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.dark-mode">Dark Mode</span>
        <mat-slide-toggle [checked]="themeService.darkMode()" (change)="toggleDarkMode()">
        </mat-slide-toggle>
      </div>
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
    }
  `]
})
export class SettingDarkModeComponent {
  readonly themeService = inject(ThemeService);

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }
}
