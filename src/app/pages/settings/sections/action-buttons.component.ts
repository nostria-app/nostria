import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { AccountStateService } from '../../../services/account-state.service';

@Component({
  selector: 'app-setting-action-buttons',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.action-buttons.title">Action Buttons</span>
      </div>
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

    .setting-description {
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0;
      margin-bottom: 16px;
    }

    h3 {
      margin-top: 0;
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
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      border-radius: var(--mat-sys-corner-medium);
      cursor: pointer;
    }

    .selected {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
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
  `]
})
export class SettingActionButtonsComponent {
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountState = inject(AccountStateService);

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
