import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LocalSettingsService } from '../../../services/local-settings.service';

const REACTION_EMOJI_OPTIONS = ['❤️', '👍', '🔥', '😂', '🎉', '👏', '🤙', '⚡'];

@Component({
  selector: 'app-setting-reaction-emoji',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <div class="setting-item">
        <span i18n="@@settings.reactions.default-emoji">Default Reaction Emoji</span>
      </div>
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

    .default-reaction-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .reaction-option {
      min-width: 48px;
      min-height: 48px;
      padding: 8px 12px;
      font-size: 1.25rem;
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
  `]
})
export class SettingReactionEmojiComponent {
  readonly localSettings = inject(LocalSettingsService);
  readonly reactionEmojiOptions = REACTION_EMOJI_OPTIONS;

  setDefaultReactionEmoji(emoji: string): void {
    this.localSettings.setDefaultReactionEmoji(emoji);
  }
}
