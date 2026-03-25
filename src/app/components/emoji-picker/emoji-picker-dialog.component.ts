import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { EmojiPickerComponent } from './emoji-picker.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';

export interface EmojiPickerDialogData {
  mode?: 'reaction' | 'content';
  activeTab?: 'emoji' | 'gifs';
}

@Component({
  selector: 'app-emoji-picker-dialog',
  imports: [EmojiPickerComponent],
  template: `
    <div dialog-content class="emoji-dialog-content">
      <app-emoji-picker
        [mode]="data.mode ?? 'content'"
        [initialTab]="data.activeTab ?? 'emoji'"
        (emojiSelected)="onEmojiSelected($event)"
        (gifSelected)="onGifSelected($event)">
      </app-emoji-picker>
    </div>
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
  dialogRef = inject(CustomDialogRef) as CustomDialogRef<EmojiPickerDialogComponent, string>;
  data: EmojiPickerDialogData = {};

  onEmojiSelected(emoji: string): void {
    this.dialogRef.close(emoji);
  }

  onGifSelected(url: string): void {
    this.dialogRef.close(url);
  }
}
