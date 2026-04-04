import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-terms-of-use-dialog-content',
  imports: [],
  templateUrl: './terms-of-use-dialog.component.html',
  styleUrl: './terms-of-use-dialog.component.scss',
})
export class TermsOfUseDialogContentComponent {
}
