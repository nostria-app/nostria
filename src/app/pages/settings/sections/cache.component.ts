import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EmojiSetService } from '../../../services/emoji-set.service';

@Component({
  selector: 'app-setting-cache',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.cache.title">Cache Management</h2>

      <div class="danger-action">
        <div>
          <h3 i18n="@@settings.cache.emoji.title">Clear Emoji Cache</h3>
          <p i18n="@@settings.cache.emoji.description">Clear cached emoji sets from the database. This will force the app to reload emoji sets on next use.</p>
        </div>
        <button mat-stroked-button (click)="clearEmojiCache()" i18n="@@settings.cache.emoji.button">Clear Emoji Cache</button>
      </div>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
    h2 {
      margin-top: 0;
    }
    h3 {
      margin: 0 0 8px 0;
    }
    .danger-action {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .danger-action > div {
      flex: 1;
    }
    .danger-action p {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
  `]
})
export class SettingCacheComponent {
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly snackBar = inject(MatSnackBar);

  clearEmojiCache(): void {
    this.emojiSetService.clearAllCaches();
    this.snackBar.open('Emoji cache cleared', 'Close', { duration: 3000 });
  }
}
