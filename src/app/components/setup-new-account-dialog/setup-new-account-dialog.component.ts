import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CustomDialogRef } from '../../services/custom-dialog.service';

@Component({
  selector: 'app-setup-new-account-dialog',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './setup-new-account-dialog.component.html',
  styleUrl: './setup-new-account-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupNewAccountDialogComponent {
  private dialogRef = inject(CustomDialogRef<SetupNewAccountDialogComponent>);

  confirm(): void {
    this.dialogRef.close({
      confirmed: true,
    });
  }

  cancel(): void {
    this.dialogRef.close({
      confirmed: false,
    });
  }

  // Called by CustomDialogService when close button or backdrop is clicked
  onClose(): void {
    this.cancel();
  }
}
