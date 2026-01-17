import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingsService, PlaceholderAlgorithm } from '../../../services/settings.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';

@Component({
  selector: 'app-setting-media',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.media.title">Media</h2>
      <p class="setting-description" i18n="@@settings.media.description">Control how media content is displayed based on your following status</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.media.display-mode">Media Display Mode</mat-label>
        <mat-select [ngModel]="settings.settings().mediaPrivacy || 'show-always'"
          (selectionChange)="setMediaPrivacy($event.value)">
          <mat-option value="show-always" i18n="@@settings.media.show-always">Always Show Media</mat-option>
          <mat-option value="blur-non-following" i18n="@@settings.media.blur-non-following">Blur Media from Non-Following</mat-option>
          <mat-option value="blur-always" i18n="@@settings.media.blur-always">Always Blur Media</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.media.placeholder-algorithm">Placeholder Algorithm</mat-label>
        <mat-select [ngModel]="settings.settings().placeholderAlgorithm || 'blurhash'"
          (selectionChange)="setPlaceholderAlgorithm($event.value)">
          <mat-option value="blurhash" i18n="@@settings.media.placeholder.blurhash">Blurhash (Legacy)</mat-option>
          <mat-option value="thumbhash" i18n="@@settings.media.placeholder.thumbhash">Thumbhash</mat-option>
          <mat-option value="both" i18n="@@settings.media.placeholder.both">Both</mat-option>
        </mat-select>
      </mat-form-field>

      <div class="setting-item">
        <span i18n="@@settings.media.auto-play">Auto-Play Short Form Videos</span>
        <mat-slide-toggle [checked]="settings.settings().autoPlayShortForm ?? true" (change)="toggleAutoPlayShortForm()">
        </mat-slide-toggle>
      </div>

      <div class="setting-item">
        <span i18n="@@settings.media.repeat">Repeat Short Form Videos</span>
        <mat-slide-toggle [checked]="settings.settings().repeatShortForm ?? true" (change)="toggleRepeatShortForm()">
        </mat-slide-toggle>
      </div>
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
    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 0;
    }
    .setting-description {
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class SettingMediaComponent {
  readonly settings = inject(SettingsService);
  private readonly imagePlaceholder = inject(ImagePlaceholderService);

  setMediaPrivacy(value: 'blur-non-following' | 'blur-always' | 'show-always'): void {
    this.settings.updateSettings({ mediaPrivacy: value });
  }

  setPlaceholderAlgorithm(value: PlaceholderAlgorithm): void {
    this.settings.updateSettings({ placeholderAlgorithm: value });
    this.imagePlaceholder.clearCache();
  }

  toggleAutoPlayShortForm(): void {
    const currentValue = this.settings.settings()?.autoPlayShortForm ?? true;
    this.settings.updateSettings({ autoPlayShortForm: !currentValue });
  }

  toggleRepeatShortForm(): void {
    const currentValue = this.settings.settings()?.repeatShortForm ?? true;
    this.settings.updateSettings({ repeatShortForm: !currentValue });
  }
}
