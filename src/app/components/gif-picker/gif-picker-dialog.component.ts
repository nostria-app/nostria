import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { GifPickerComponent } from './gif-picker.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';

@Component({
  selector: 'app-gif-picker-dialog',
  imports: [GifPickerComponent],
  template: `
    <div dialog-content class="gif-dialog-content">
      <app-gif-picker (gifSelected)="onGifSelected($event)"></app-gif-picker>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .gif-dialog-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GifPickerDialogComponent {
  dialogRef = inject(CustomDialogRef) as CustomDialogRef<GifPickerDialogComponent, string>;

  onGifSelected(url: string): void {
    this.dialogRef.close(url);
  }
}
