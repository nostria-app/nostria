import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ThemePreference, ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-setting-dark-mode',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="theme-options" role="group" aria-label="Theme" i18n-aria-label="@@settings.dark-mode">
        @for (option of themeOptions; track option.value) {
        <button mat-button type="button" class="theme-option"
          [class.selected]="themeService.themePreference() === option.value"
          [attr.aria-pressed]="themeService.themePreference() === option.value"
          (click)="setThemePreference(option.value)">
          <span class="theme-option-icon-shell">
            <mat-icon>{{ option.icon }}</mat-icon>
          </span>
          <span class="theme-option-label">{{ option.label }}</span>
        </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .theme-options {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .theme-option {
      min-height: 88px;
      padding: 16px 14px;
      border-radius: 22px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-align: center;
      transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }

    .theme-option:hover {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-high);
      transform: translateY(-1px);
      box-shadow: var(--mat-sys-level1);
    }

    .theme-option.selected {
      border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary-container) 82%, var(--mat-sys-surface) 18%);
      color: var(--mat-sys-on-primary-container);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--mat-sys-primary) 45%, transparent);
    }

    .theme-option-icon-shell {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }

    .theme-option mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .theme-option-label {
      font-size: 0.98rem;
      line-height: 1.2;
    }

    @media (max-width: 640px) {
      .theme-options {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class SettingDarkModeComponent {
  readonly themeService = inject(ThemeService);
  readonly themeOptions = [
    {
      value: 'auto' as ThemePreference,
      icon: 'brightness_auto',
      label: $localize`:@@settings.theme.auto:Auto`,
    },
    {
      value: 'dark' as ThemePreference,
      icon: 'dark_mode',
      label: $localize`:@@settings.theme.dark:Dark`,
    },
    {
      value: 'light' as ThemePreference,
      icon: 'light_mode',
      label: $localize`:@@settings.theme.light:Light`,
    },
  ];

  setThemePreference(preference: ThemePreference): void {
    this.themeService.setThemePreference(preference);
  }
}
