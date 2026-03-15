import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AccountStateService } from '../../services/account-state.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingActionButtonsComponent } from './sections/action-buttons.component';
import { SettingClientTagsComponent } from './sections/client-tags.component';
import { SettingExternalLinksComponent } from './sections/external-links.component';
import { SettingMediaComponent } from './sections/media.component';
import { SettingMusicStatusComponent } from './sections/music-status.component';
import { SettingReactionEmojiComponent } from './sections/reaction-emoji.component';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';
import { getSettingsSectionComponent } from './settings-section-components.map';

@Component({
  selector: 'app-feed-content-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    SettingActionButtonsComponent,
    SettingClientTagsComponent,
    SettingExternalLinksComponent,
    SettingMediaComponent,
    SettingMusicStatusComponent,
    SettingReactionEmojiComponent,
    SettingsLinkCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.content">Feed &amp; Content</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <div class="setting-section">
        <h2 i18n="@@settings.feed.behavior.title">Feed Behavior</h2>

        <div class="setting-item">
          <span i18n="@@settings.navigation.start-feeds-last-event">Start Feeds on Last Event</span>
          <mat-slide-toggle [checked]="localSettings.startFeedsOnLastEvent()" (change)="toggleStartFeedsOnLastEvent()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.start-feeds-last-event.description">
          Show previously loaded events first when opening feeds, with new posts appearing via a button. Prevents the feed from jumping to the latest events on reload.
        </p>

        <div class="setting-item">
          <span i18n="@@settings.navigation.show-thread-lines">Show Thread Lines</span>
          <mat-slide-toggle [checked]="localSettings.showThreadLines()" (change)="toggleShowThreadLines()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.show-thread-lines.description">
          Display vertical lines on the left side of threaded replies to indicate nesting depth.
        </p>

        <div class="setting-item">
          <span i18n="@@settings.navigation.open-threads-expanded">Open Threads Expanded</span>
          <mat-slide-toggle [checked]="localSettings.openThreadsExpanded()" (change)="toggleOpenThreadsExpanded()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.navigation.open-threads-expanded.description">
          When viewing a thread, show all replies expanded by default. Disable for a cleaner initial view with collapsed replies.
        </p>
      </div>

      <app-setting-reaction-emoji />
      <app-setting-action-buttons />

      <app-setting-client-tags />
      <app-setting-media />
      <app-setting-music-status />
      <app-setting-external-links />

      @if (accountState.account()) {
        <div class="setting-section section-actions">
          <h2 i18n="@@settings.advanced-posting.title">Advanced posting</h2>
          <p class="setting-description" i18n="@@settings.advanced-posting.description">
            Manage Post to X and Global Event Expiration in the advanced posting settings screen.
          </p>
          <div class="settings-link-list">
            <app-settings-link-card icon="share" i18n-title="@@settings.advanced-posting.post-to-x"
              title="Manage Post to X" i18n-description="@@settings.advanced-posting.post-to-x.description"
              description="Review dual-posting defaults and account connection status."
              (activated)="openAdvancedPostingSettings()" />
            <app-settings-link-card icon="timer" i18n-title="@@settings.advanced-posting.global-expiration"
              title="Manage Global Expiration"
              i18n-description="@@settings.advanced-posting.global-expiration.description"
              description="Choose how long newly created events should stay available by default."
              (activated)="openAdvancedPostingSettings()" />
          </div>
        </div>
      }
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
      gap: 16px;
      margin-bottom: 8px;
      padding: 12px 0;
    }

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }

    .section-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .settings-link-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `],
})
export class FeedContentSettingsComponent {
  readonly accountState = inject(AccountStateService);
  readonly localSettings = inject(LocalSettingsService);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
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

  async openAdvancedPostingSettings(): Promise<void> {
    const componentLoader = getSettingsSectionComponent('advanced-posting');
    if (!componentLoader) return;
    const component = await componentLoader();
    this.rightPanel.open({
      component,
      title: $localize`:@@settings.sections.advanced-posting:Advanced Posting`,
    });
  }
}
