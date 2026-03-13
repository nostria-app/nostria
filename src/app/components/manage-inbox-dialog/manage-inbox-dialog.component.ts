import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CustomDialogRef } from '../../services/custom-dialog.service';

export interface ManageInboxDialogData {
  purgeCandidatesCount: number;
  deadLetterCount: number;
}

export interface ManageInboxDialogResult {
  purgeUnknownProfiles: boolean;
  clearDeadLetterList: boolean;
}

@Component({
  selector: 'app-manage-inbox-dialog',
  imports: [MatButtonModule, MatCheckboxModule],
  templateUrl: './manage-inbox-dialog.component.html',
  styleUrl: './manage-inbox-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageInboxDialogComponent {
  dialogRef?: CustomDialogRef<ManageInboxDialogComponent, ManageInboxDialogResult>;
  data: ManageInboxDialogData = { purgeCandidatesCount: 0, deadLetterCount: 0 };

  purgeUnknownProfiles = signal(false);
  clearDeadLetterList = signal(false);

  close(): void {
    this.dialogRef?.close({
      purgeUnknownProfiles: false,
      clearDeadLetterList: false,
    });
  }

  run(): void {
    this.dialogRef?.close({
      purgeUnknownProfiles: this.purgeUnknownProfiles(),
      clearDeadLetterList: this.clearDeadLetterList(),
    });
  }
}
