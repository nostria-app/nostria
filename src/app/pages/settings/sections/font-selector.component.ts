import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { FontService, FONT_OPTIONS, DEFAULT_FONT, FontOption } from '../../../services/font.service';

@Component({
  selector: 'app-setting-font-selector',
  imports: [MatButtonModule, MatIconModule, MatRadioModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.display.font">Font</span>
        <span class="font-preview" [style.font-family]="fontService.fontConfig().fontFamily">Aa</span>
      </div>
      <div class="font-options">
        <mat-radio-group [value]="fontService.font()" (change)="onFontChange($event.value)">
          @for (option of fontOptions; track option.id) {
            <mat-radio-button [value]="option.id" class="font-option">
              <span class="font-label" [style.font-family]="option.fontFamily">{{ option.label }}</span>
            </mat-radio-button>
          }
        </mat-radio-group>
      </div>
      <p class="setting-description" i18n="@@settings.display.font.description">
        Choose your preferred font for the app. Roboto works best with Angular Material components.
      </p>
      @if (fontService.font() !== defaultFont) {
        <button mat-button (click)="resetFont()" class="reset-button">
          <mat-icon>restart_alt</mat-icon>
          <span i18n="@@settings.display.font.reset">Reset to Default</span>
        </button>
      }
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
      margin-bottom: 16px;
    }

    .font-preview {
      font-size: 1.5rem;
      min-width: 40px;
      text-align: center;
      color: var(--mat-sys-primary);
      transition: font-family 0.2s ease;
    }

    .font-options {
      margin-bottom: 16px;
    }

    mat-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .font-option {
      display: block;
    }

    .font-label {
      font-size: 1rem;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }

    .reset-button {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .reset-button mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `]
})
export class SettingFontSelectorComponent {
  readonly fontService = inject(FontService);
  readonly fontOptions = FONT_OPTIONS;
  readonly defaultFont = DEFAULT_FONT;

  onFontChange(fontId: FontOption): void {
    this.fontService.setFont(fontId);
  }

  resetFont(): void {
    this.fontService.resetFont();
  }
}
