import { Component, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TextScaleService, TEXT_SCALE_OPTIONS, DEFAULT_TEXT_SCALE } from '../../../services/text-scale.service';

@Component({
  selector: 'app-setting-text-size',
  imports: [MatSliderModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.display.text-size">Text Size</span>
        <div class="text-size-controls">
          <span class="text-preview" [style.font-size]="previewFontSize()">Aa</span>
          <span class="scale-label">{{ scalePercentage() }}%</span>
        </div>
      </div>
      <div class="slider-row">
        <button mat-icon-button
                (click)="decreaseScale()"
                [disabled]="isMinScale()"
                aria-label="Decrease text size"
                i18n-aria-label="@@settings.display.text-size.decrease">
          <mat-icon>text_decrease</mat-icon>
        </button>
        <mat-slider
          [min]="minScale"
          [max]="maxScale"
          [step]="0.05"
          [discrete]="true"
          [displayWith]="formatLabel"
          class="text-scale-slider">
          <input matSliderThumb
                 [value]="textScaleService.textScale()"
                 (valueChange)="onScaleChange($event)" />
        </mat-slider>
        <button mat-icon-button
                (click)="increaseScale()"
                [disabled]="isMaxScale()"
                aria-label="Increase text size"
                i18n-aria-label="@@settings.display.text-size.increase">
          <mat-icon>text_increase</mat-icon>
        </button>
      </div>
      <p class="setting-description" i18n="@@settings.display.text-size.description">
        Adjust the text size for better readability. This setting works together with your device's text size settings.
      </p>
      @if (textScaleService.textScale() !== defaultScale) {
        <button mat-button (click)="resetScale()" class="reset-button">
          <mat-icon>restart_alt</mat-icon>
          <span i18n="@@settings.display.text-size.reset">Reset to Default</span>
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
      margin-bottom: 8px;
    }

    .text-size-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .text-preview {
      font-family: var(--nostria-font-family);
      min-width: 40px;
      text-align: center;
      color: var(--mat-sys-primary);
      transition: font-size 0.2s ease;
    }

    .scale-label {
      min-width: 45px;
      text-align: right;
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 16px;
    }

    .text-scale-slider {
      flex: 1;
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
export class SettingTextSizeComponent {
  readonly textScaleService = inject(TextScaleService);

  readonly minScale = TEXT_SCALE_OPTIONS[0];
  readonly maxScale = TEXT_SCALE_OPTIONS[TEXT_SCALE_OPTIONS.length - 1];
  readonly defaultScale = DEFAULT_TEXT_SCALE;

  /** Compute the percentage display value */
  readonly scalePercentage = computed(() => Math.round(this.textScaleService.textScale() * 100));

  /** Compute the preview font size */
  readonly previewFontSize = computed(() => `${1.5 * this.textScaleService.textScale()}rem`);

  /** Check if at minimum scale */
  readonly isMinScale = computed(() => this.textScaleService.textScale() <= this.minScale);

  /** Check if at maximum scale */
  readonly isMaxScale = computed(() => this.textScaleService.textScale() >= this.maxScale);

  /** Format label for slider tooltip */
  formatLabel(value: number): string {
    return `${Math.round(value * 100)}%`;
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
}
