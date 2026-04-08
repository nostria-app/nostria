import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EmojiPickerComponent } from './emoji-picker.component';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

export interface EmojiPickerDialogData {
  title?: string;
  mode?: 'reaction' | 'content';
  activeTab?: 'emoji' | 'gifs';
  allowPreferredReactionShortcut?: boolean;
}

@Component({
  selector: 'app-emoji-picker-dialog',
  imports: [MaterialCustomDialogComponent, EmojiPickerComponent],
  template: `
    <app-material-custom-dialog
      [title]="resolvedTitle()"
      [icon]="resolvedIcon()"
      [showDefaultActions]="false">
      <div dialog-content class="emoji-dialog-content">
        <app-emoji-picker
          [mode]="data.mode ?? 'content'"
          [initialTab]="data.activeTab ?? 'emoji'"
          [allowPreferredReactionShortcut]="data.allowPreferredReactionShortcut ?? false"
          (emojiSelected)="onEmojiSelected($event)"
          (gifSelected)="onGifSelected($event)">
        </app-emoji-picker>
      </div>
    </app-material-custom-dialog>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .emoji-dialog-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EmojiPickerDialogComponent, string>, { optional: true });
  readonly data = inject<EmojiPickerDialogData | null>(MAT_DIALOG_DATA, { optional: true }) ?? {};
  readonly resolvedTitle = computed(() => this.data.title ?? (this.data.activeTab === 'gifs' ? 'GIFs' : this.data.mode === 'reaction' ? 'React' : 'Emoji'));
  readonly resolvedIcon = computed(() => this.data.activeTab === 'gifs' ? 'gif_box' : 'sentiment_satisfied');

  onEmojiSelected(emoji: string): void {
    this.dialogRef?.close(emoji);
  }

  onGifSelected(url: string): void {
    this.dialogRef?.close(url);
  }
}
