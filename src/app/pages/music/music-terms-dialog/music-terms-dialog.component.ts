import { Component, ChangeDetectionStrategy, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MusicTermsContentComponent } from '../music-terms-content/music-terms-content.component';

@Component({
  selector: 'app-music-terms-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CustomDialogComponent, MusicTermsContentComponent, MatButtonModule],
  template: `
    <app-custom-dialog
      [title]="'Music Terms of Service'"
      [showCloseButton]="true"
      [disableClose]="false"
      [width]="'650px'"
      [maxWidth]="'90vw'"
      (closed)="handleClose()">
      
      <div dialog-content class="terms-dialog-content">
        <app-music-terms-content />
      </div>
      
      <div dialog-actions style="display: flex; justify-content: flex-end;">
        <button mat-flat-button (click)="handleClose()">
          Close
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`
    .terms-dialog-content {
      max-height: 60vh;
      overflow-y: auto;
    }
  `],
})
export class MusicTermsDialogComponent {
  closed = output<void>();

  handleClose(): void {
    this.closed.emit();
  }
}
