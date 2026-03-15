import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingClientTagsComponent } from './sections/client-tags.component';
import { SettingExternalLinksComponent } from './sections/external-links.component';
import { SettingMediaComponent } from './sections/media.component';
import { SettingMusicStatusComponent } from './sections/music-status.component';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';

const REACTION_EMOJI_OPTIONS = ['❤️', '👍', '🔥', '😂', '🎉', '👏', '🤙', '⚡'];

@Component({
  selector: 'app-feed-content-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    SettingClientTagsComponent,
    SettingExternalLinksComponent,
    SettingMediaComponent,
    SettingMusicStatusComponent,
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

      <div class="setting-section">
        <h2 i18n="@@settings.reactions.title">Reactions</h2>
        <p class="setting-description" i18n="@@settings.reactions.default-emoji.description">
          Choose the emoji sent when you single-tap the reaction button. Long-press opens the full emoji picker.
        </p>
        <div class="default-reaction-picker">
          @for (emoji of reactionEmojiOptions; track emoji) {
            <button
              class="reaction-option"
              type="button"
              [class.selected]="localSettings.defaultReactionEmoji() === emoji"
              (click)="setDefaultReactionEmoji(emoji)">
              {{ emoji }}
            </button>
          }
        </div>
      </div>

      <div class="setting-section">
        <h2 i18n="@@settings.action-buttons.title">Action Buttons</h2>
        <p class="setting-description" i18n="@@settings.action-buttons.description">
          Choose how the action buttons (Like, Reply, Share, etc.) are displayed below posts and replies. You can also right-click or long-press the expand button on any post to cycle through modes.
        </p>

        <div class="display-mode-section">
          <h3 i18n="@@settings.action-buttons.posts">Posts</h3>
          <div class="display-mode-options">
            @for (mode of displayModes; track mode.value) {
              <button class="display-mode-option" type="button" [class.selected]="postsDisplayMode() === mode.value" (click)="setPostsDisplayMode(mode.value)">
                <div class="display-mode-preview" [class.mode-labels-only]="mode.value === 'labels-only'" [class.mode-icons-only]="mode.value === 'icons-only'" [class.mode-icons-and-labels]="mode.value === 'icons-and-labels'">
                  <div class="preview-action">
                    <mat-icon class="preview-icon">favorite_border</mat-icon>
                    <span class="preview-count">3</span>
                    <span class="preview-text">Like</span>
                  </div>
                </div>
                <span class="display-mode-label">{{ mode.label }}</span>
              </button>
            }
          </div>
        </div>

        <div class="display-mode-section">
          <h3 i18n="@@settings.action-buttons.replies">Replies</h3>
          <div class="display-mode-options">
            @for (mode of displayModes; track mode.value) {
              <button class="display-mode-option" type="button" [class.selected]="repliesDisplayMode() === mode.value" (click)="setRepliesDisplayMode(mode.value)">
                <div class="display-mode-preview" [class.mode-labels-only]="mode.value === 'labels-only'" [class.mode-icons-only]="mode.value === 'icons-only'" [class.mode-icons-and-labels]="mode.value === 'icons-and-labels'">
                  <div class="preview-action">
                    <mat-icon class="preview-icon">favorite_border</mat-icon>
                    <span class="preview-count">3</span>
                    <span class="preview-text">Like</span>
                  </div>
                </div>
                <span class="display-mode-label">{{ mode.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>

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

    h2,
    h3 {
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

    .default-reaction-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .reaction-option,
    .display-mode-option {
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      border-radius: var(--mat-sys-corner-medium);
      cursor: pointer;
    }

    .reaction-option {
      min-width: 48px;
      min-height: 48px;
      padding: 8px 12px;
      font-size: 1.25rem;
    }

    .selected {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    .display-mode-section {
      margin-bottom: 24px;
    }

    .display-mode-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }

    .display-mode-option {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      text-align: left;
    }

    .display-mode-preview {
      display: flex;
      align-items: center;
      min-height: 40px;
    }

    .preview-action {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);
    }

    .preview-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .mode-icons-only .preview-text,
    .mode-labels-only .preview-icon,
    .mode-labels-only .preview-count {
      display: none;
    }

    .display-mode-label {
      font-size: 0.875rem;
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
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly router = inject(Router);

  readonly reactionEmojiOptions = REACTION_EMOJI_OPTIONS;
  readonly displayModes = [
    { value: 'icons-and-labels', label: 'Icons & Labels' },
    { value: 'icons-only', label: 'Icons Only' },
    { value: 'labels-only', label: 'Labels Only' },
  ];

  readonly postsDisplayMode = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return 'icons-and-labels';
    }

    return this.accountLocalState.getActionsDisplayMode(pubkey);
  });

  readonly repliesDisplayMode = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return 'labels-only';
    }

    return this.accountLocalState.getActionsDisplayModeReplies(pubkey);
  });

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

  setDefaultReactionEmoji(emoji: string): void {
    this.localSettings.setDefaultReactionEmoji(emoji);
  }

  setPostsDisplayMode(mode: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    this.accountLocalState.setActionsDisplayMode(pubkey, mode);
  }

  setRepliesDisplayMode(mode: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    this.accountLocalState.setActionsDisplayModeReplies(pubkey, mode);
  }

  openAdvancedPostingSettings(): void {
    void this.router.navigate(['/settings/advanced-posting']);
  }
}
