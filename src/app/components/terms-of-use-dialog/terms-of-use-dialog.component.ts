import { Component, inject } from '@angular/core';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-terms-of-use-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule
],
  templateUrl: './terms-of-use-dialog.component.html',
  styleUrl: './terms-of-use-dialog.component.scss'
})
export class TermsOfUseDialogComponent {
  private dialogRef = inject(MatDialogRef<TermsOfUseDialogComponent>);

  closeDialog(): void {
    this.dialogRef.close();
  }
}
