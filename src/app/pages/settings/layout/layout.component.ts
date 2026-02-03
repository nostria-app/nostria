import { Component, inject, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { SettingMenuEditorComponent } from '../sections/menu-editor.component';
import { SettingTextSizeComponent } from '../sections/text-size.component';
import { SettingFontSelectorComponent } from '../sections/font-selector.component';
import { RightPanelService } from '../../../services/right-panel.service';

@Component({
  selector: 'app-layout-settings',
  imports: [
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SettingMenuEditorComponent,
    SettingTextSizeComponent,
    SettingFontSelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './layout.component.scss',
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.layout">Layout</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <div>
        <h2 i18n="@@settings.display.title">Display</h2>
        <app-setting-text-size></app-setting-text-size>
        <app-setting-font-selector></app-setting-font-selector>
      </div>

      <div>
        <h2 i18n="@@settings.navigation.title">Navigation</h2>

        <div class="setting-item">
          <span i18n="@@settings.navigation.start-last-page">Start on Last Page</span>
          <mat-slide-toggle [checked]="localSettings.startOnLastRoute()" (change)="toggleStartOnLastRoute()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.start-last-page.description">When opening the app,
          restore the last page you were viewing.</p>

        <div class="setting-item">
          <span i18n="@@settings.navigation.start-feeds-last-event">Start Feeds on Last Event</span>
          <mat-slide-toggle [checked]="localSettings.startFeedsOnLastEvent()" (change)="toggleStartFeedsOnLastEvent()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.start-feeds-last-event.description">Show previously
          loaded events first when opening feeds, with new posts appearing via
          a button. Prevents the feed from jumping to the latest events on reload.</p>

        <div class="setting-item">
          <span i18n="@@settings.navigation.show-thread-lines">Show Thread Lines</span>
          <mat-slide-toggle [checked]="localSettings.showThreadLines()" (change)="toggleShowThreadLines()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.show-thread-lines.description">Display vertical lines on
          the left side of threaded replies to indicate nesting depth.</p>

        <div class="setting-item">
          <span i18n="@@settings.navigation.open-threads-expanded">Open Threads Expanded</span>
          <mat-slide-toggle [checked]="localSettings.openThreadsExpanded()" (change)="toggleOpenThreadsExpanded()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.open-threads-expanded.description">When viewing a thread,
          show all replies expanded by default. Disable for a cleaner initial view with collapsed replies.</p>
      </div>

      <div>
        <app-setting-menu-editor></app-setting-menu-editor>
      </div>
    </div>
  `,
})
export class LayoutSettingsComponent implements OnInit, OnDestroy {
  readonly localSettings = inject(LocalSettingsService);
  private readonly rightPanel = inject(RightPanelService);

  ngOnInit(): void {
    // Parent settings component handles the page title
  }

  ngOnDestroy(): void {
    // No cleanup needed
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

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
