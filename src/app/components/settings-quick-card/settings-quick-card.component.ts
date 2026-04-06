import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { ApplicationService } from '../../services/application.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { TextScaleService, DEFAULT_TEXT_SCALE, TEXT_SCALE_OPTIONS } from '../../services/text-scale.service';
import { ThemeService } from '../../services/theme.service';
import { SUPPORTED_LOCALE_LABELS } from '../../utils/supported-locales';

@Component({
  selector: 'app-settings-quick-card',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSliderModule,
  ],
  templateUrl: './settings-quick-card.component.html',
  styleUrl: './settings-quick-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsQuickCardComponent {
  readonly fullscreen = input(false);
  readonly closeRequested = output<void>();
  readonly openSettingsRequested = output<void>();

  readonly localSettings = inject(LocalSettingsService);
  readonly themeService = inject(ThemeService);
  readonly textScaleService = inject(TextScaleService);

  private readonly app = inject(ApplicationService);

  readonly minScale = TEXT_SCALE_OPTIONS[0];
  readonly maxScale = TEXT_SCALE_OPTIONS[TEXT_SCALE_OPTIONS.length - 1];
  readonly defaultScale = DEFAULT_TEXT_SCALE;

  readonly scalePercentage = computed(() => Math.round(this.textScaleService.textScale() * 100));
  readonly previewFontSize = computed(() => `${1.3 * this.textScaleService.textScale()}rem`);
  readonly isMinScale = computed(() => this.textScaleService.textScale() <= this.minScale);
  readonly isMaxScale = computed(() => this.textScaleService.textScale() >= this.maxScale);

  readonly languageOptions = SUPPORTED_LOCALE_LABELS;

  setTheme(darkMode: boolean): void {
    if (this.themeService.darkMode() === darkMode) {
      return;
    }

    this.themeService.toggleDarkMode();
  }

  setLanguage(languageCode: string): void {
    if (this.localSettings.locale() === languageCode) {
      return;
    }

    this.localSettings.setLocaleImmediate(languageCode);
    this.closeRequested.emit();

    if (this.app.isBrowser()) {
      window.location.reload();
    }
  }

  onScaleChange(value: number): void {
    this.textScaleService.setTextScale(value);
  }

  increaseScale(): void {
    this.textScaleService.increaseTextScale();
  }

  decreaseScale(): void {
    this.textScaleService.decreaseTextScale();
  }

  resetScale(): void {
    this.textScaleService.resetTextScale();
  }

  openSettings(): void {
    this.openSettingsRequested.emit();
  }

  close(): void {
    this.closeRequested.emit();
  }

  formatScaleLabel(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}
