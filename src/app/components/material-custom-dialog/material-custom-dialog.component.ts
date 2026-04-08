import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

const DEFAULT_DIALOG_ICON = 'responsive_layout';
const DEFAULT_PRIMARY_ACTION_TEXT = 'Looks good';
const DEFAULT_SECONDARY_ACTION_TEXT = 'Close';

export interface MaterialCustomDialogDetail {
  icon: string;
  title: string;
  description: string;
}

export interface MaterialCustomDialogData {
  title: string;
  message: string;
  icon?: string;
  primaryActionText?: string;
  secondaryActionText?: string;
  details?: MaterialCustomDialogDetail[];
}

@Component({
  selector: 'app-material-custom-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './material-custom-dialog.component.html',
  styleUrl: './material-custom-dialog.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialCustomDialogComponent {
  private dialogRef = inject(MatDialogRef<MaterialCustomDialogComponent, boolean>);
  data: MaterialCustomDialogData = inject(MAT_DIALOG_DATA);
  defaultIcon = DEFAULT_DIALOG_ICON;
  defaultPrimaryActionText = DEFAULT_PRIMARY_ACTION_TEXT;
  defaultSecondaryActionText = DEFAULT_SECONDARY_ACTION_TEXT;

  close(result = false): void {
    this.dialogRef.close(result);
  }
}