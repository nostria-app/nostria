import { Component, computed, inject, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { SettingsService } from '../../../services/settings.service';
import { SettingMenuEditorComponent } from '../sections/menu-editor.component';
import { SettingTextSizeComponent } from '../sections/text-size.component';
import { SettingFontSelectorComponent } from '../sections/font-selector.component';
import { SettingHomeDestinationComponent } from '../sections/home-destination.component';
import { SettingDarkModeComponent } from '../sections/dark-mode.component';
import { RightPanelService } from '../../../services/right-panel.service';

const REACTION_EMOJI_OPTIONS = ['❤️', '👍', '🔥', '😂', '🎉', '👏', '🤙', '⚡'];

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
    SettingHomeDestinationComponent,
    SettingDarkModeComponent,
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
        <app-setting-dark-mode></app-setting-dark-mode>
        <app-setting-text-size></app-setting-text-size>
        <app-setting-font-selector></app-setting-font-selector>

        <div class="setting-item">
          <span i18n="@@settings.display.lock-screen-rotation">Lock Screen Rotation</span>
          <mat-slide-toggle [checked]="localSettings.lockScreenRotation()" (change)="toggleLockScreenRotation()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.display.lock-screen-rotation.description">Keep the app in portrait mode so it does not rotate when your device rotates. Applies only on devices and browsers that support orientation lock.</p>
      </div>

      <div>
        <h2 i18n="@@settings.reactions.title">Reactions</h2>

        <div class="setting-item">
          <span i18n="@@settings.reactions.default-emoji">Default Reaction Emoji</span>
        </div>
        <p class="setting-description" i18n="@@settings.reactions.default-emoji.description">Choose the emoji sent when you single-tap the reaction button. Long-press opens the full emoji picker.</p>
        <div class="default-reaction-picker">
          @for (emoji of reactionEmojiOptions; track emoji) {
          <button class="reaction-option" [class.selected]="localSettings.defaultReactionEmoji() === emoji"
            (click)="setDefaultReactionEmoji(emoji)" type="button">
            {{ emoji }}
          </button>
          }
        </div>
      </div>

      <div>
        <h2 i18n="@@settings.action-buttons.title">Action Buttons</h2>
        <p class="setting-description" i18n="@@settings.action-buttons.description">Choose how the action buttons (Like, Reply, Share, etc.) are displayed below posts and replies. You can also right-click or long-press the expand button on any post to cycle through modes.</p>

        <div class="display-mode-section">
          <h3 i18n="@@settings.action-buttons.posts">Posts</h3>
          <div class="display-mode-options">
            @for (mode of displayModes; track mode.value) {
            <button class="display-mode-option" [class.selected]="postsDisplayMode() === mode.value"
              (click)="setPostsDisplayMode(mode.value)" type="button">
              <div class="display-mode-preview" [class.mode-labels-only]="mode.value === 'labels-only'"
                [class.mode-icons-only]="mode.value === 'icons-only'"
                [class.mode-icons-and-labels]="mode.value === 'icons-and-labels'">
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
            <button class="display-mode-option" [class.selected]="repliesDisplayMode() === mode.value"
              (click)="setRepliesDisplayMode(mode.value)" type="button">
              <div class="display-mode-preview" [class.mode-labels-only]="mode.value === 'labels-only'"
                [class.mode-icons-only]="mode.value === 'icons-only'"
                [class.mode-icons-and-labels]="mode.value === 'icons-and-labels'">
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

        <div class="setting-item">
          <span i18n="@@settings.layout.right-sidebar">Show Right Sidebar</span>
          <mat-slide-toggle [checked]="settings.settings().rightSidebarEnabled === true"
            (change)="toggleRightSidebar()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description" i18n="@@settings.layout.right-sidebar.description">Show the desktop right sidebar with Favorites and Runes. This syncs with your account settings across devices.</p>

        <app-setting-home-destination />
      </div>

      <div>
        <app-setting-menu-editor></app-setting-menu-editor>
      </div>
    </div>
  `,
})
export class LayoutSettingsComponent implements OnInit, OnDestroy {
  readonly localSettings = inject(LocalSettingsService);
  readonly settings = inject(SettingsService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  readonly reactionEmojiOptions = REACTION_EMOJI_OPTIONS;

  readonly displayModes = [
    { value: 'icons-and-labels', label: 'Icons & Labels' },
    { value: 'icons-only', label: 'Icons Only' },
    { value: 'labels-only', label: 'Labels Only' },
  ];

  postsDisplayMode = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return 'icons-and-labels';
    return this.accountLocalState.getActionsDisplayMode(pubkey);
  });

  repliesDisplayMode = computed(() => {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return 'labels-only';
    return this.accountLocalState.getActionsDisplayModeReplies(pubkey);
  });

  ngOnInit(): void {
    // Parent settings component handles the page title
  }

  ngOnDestroy(): void {
    // No cleanup needed
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  setDefaultReactionEmoji(emoji: string): void {
    this.localSettings.setDefaultReactionEmoji(emoji);
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

  toggleLockScreenRotation(): void {
    this.localSettings.setLockScreenRotation(!this.localSettings.lockScreenRotation());
  }

  toggleRightSidebar(): void {
    const currentValue = this.settings.settings().rightSidebarEnabled === true;
    void this.settings.updateSettings({ rightSidebarEnabled: !currentValue });
  }

  setPostsDisplayMode(mode: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;
    this.accountLocalState.setActionsDisplayMode(pubkey, mode);
  }

  setRepliesDisplayMode(mode: string): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;
    this.accountLocalState.setActionsDisplayModeReplies(pubkey, mode);
  }
}
