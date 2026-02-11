import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { EmojiPickerComponent } from './emoji-picker.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';

@Component({
  selector: 'app-emoji-picker-dialog',
  imports: [EmojiPickerComponent],
  template: `
    <div dialog-content class="emoji-dialog-content">
      <app-emoji-picker (emojiSelected)="onEmojiSelected($event)"></app-emoji-picker>
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

  onEmojiSelected(emoji: string): void {
    this.dialogRef.close(emoji);
  }
}
