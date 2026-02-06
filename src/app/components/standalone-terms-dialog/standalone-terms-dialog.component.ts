import { Component, output } from '@angular/core';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';
import { TermsOfUseDialogContentComponent } from '../terms-of-use-dialog/terms-of-use-dialog.component';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-standalone-terms-dialog',
  imports: [CustomDialogComponent, TermsOfUseDialogContentComponent, MatButtonModule],
  template: `
    <app-custom-dialog
      [title]="'Terms of Use'"
      [showCloseButton]="true"
      [disableClose]="false"
      [width]="'600px'"
      [maxWidth]="'90vw'"
      (closed)="handleClose()">
      
      <div dialog-content>
        <app-terms-of-use-dialog-content />
      </div>
      
      <div dialog-actions style="display: flex; justify-content: flex-end;">
        <button mat-flat-button (click)="handleClose()">
          Close
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: []
})
export class StandaloneTermsDialogComponent {
  closed = output<void>();

  handleClose(): void {
    this.closed.emit();
  }
}
