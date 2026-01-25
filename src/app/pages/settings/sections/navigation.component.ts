import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { SettingHomeDestinationComponent } from './home-destination.component';

@Component({
  selector: 'app-setting-navigation',
  imports: [MatSlideToggleModule, SettingHomeDestinationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.navigation.title">Navigation</h2>

      <div class="setting-item">
        <span i18n="@@settings.navigation.start-last-page">Start on Last Page</span>
        <mat-slide-toggle [checked]="localSettings.startOnLastRoute()" (change)="toggleStartOnLastRoute()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.navigation.start-last-page.description">When opening the app, restore the last page you were viewing.</p>

      <div class="setting-item">
        <span i18n="@@settings.navigation.start-feeds-last-event">Start Feeds on Last Event</span>
        <mat-slide-toggle [checked]="localSettings.startFeedsOnLastEvent()" (change)="toggleStartFeedsOnLastEvent()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.navigation.start-feeds-last-event.description">Show previously loaded events first when opening feeds, with new posts appearing via a button. Prevents the feed from jumping to the latest events on reload.</p>

      <div class="setting-item">
        <span i18n="@@settings.navigation.show-thread-lines">Show Thread Lines</span>
        <mat-slide-toggle [checked]="localSettings.showThreadLines()" (change)="toggleShowThreadLines()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.navigation.show-thread-lines.description">Display vertical lines on the left side of threaded replies to indicate nesting depth.</p>

      <div class="setting-item">
        <span i18n="@@settings.navigation.open-threads-expanded">Open Threads Expanded</span>
        <mat-slide-toggle [checked]="localSettings.openThreadsExpanded()" (change)="toggleOpenThreadsExpanded()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.navigation.open-threads-expanded.description">When viewing a thread, show all replies expanded by default. Disable for a cleaner initial view with collapsed replies.</p>
    </div>

    <app-setting-home-destination />
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
export class SettingNavigationComponent {
  readonly localSettings = inject(LocalSettingsService);

  toggleStartOnLastRoute(): void {
    this.localSettings.setStartOnLastRoute(!this.localSettings.startOnLastRoute());
  }

  toggleStartFeedsOnLastEvent(): void {
    this.localSettings.setStartFeedsOnLastEvent(!this.localSettings.startFeedsOnLastEvent());
  }

  toggleShowThreadLines(): void {
    this.localSettings.setShowThreadLines(!this.localSettings.showThreadLines());
  }

  toggleOpenThreadsExpanded(): void {
    this.localSettings.setOpenThreadsExpanded(!this.localSettings.openThreadsExpanded());
  }
}
