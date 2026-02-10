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
    <div dialog-content>
      <app-emoji-picker (emojiSelected)="onEmojiSelected($event)"></app-emoji-picker>
    </div>
  `,
  styles: [`
    :host {
      display: block;
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
