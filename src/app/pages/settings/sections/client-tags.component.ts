import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';

@Component({
  selector: 'app-setting-client-tags',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.client-tags.title">Client Tags</h2>

      <div class="setting-item">
        <span i18n="@@settings.client-tags.add">Add Client Tag</span>
        <mat-slide-toggle [checked]="localSettings.addClientTag()" (change)="toggleAddClientTag()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.client-tags.add.description">Add the Nostria client tag to events you publish</p>

      <div class="setting-item">
        <span i18n="@@settings.client-tags.show">Show Client Tag</span>
        <mat-slide-toggle [checked]="localSettings.showClientTag()" (change)="toggleShowClientTag()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.client-tags.show.description">Show what client that authors are using</p>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
    h2 {
      margin-top: 0;
    }
    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding: 12px 0;
    }
    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }
  `]
})
export class SettingClientTagsComponent {
  readonly localSettings = inject(LocalSettingsService);

  toggleAddClientTag(): void {
    this.localSettings.setAddClientTag(!this.localSettings.addClientTag());
  }

  toggleShowClientTag(): void {
    this.localSettings.setShowClientTag(!this.localSettings.showClientTag());
  }
}
