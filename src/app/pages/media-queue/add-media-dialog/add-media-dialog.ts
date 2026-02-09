import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

export interface AddMediaDialogData {
  url: string;
  playImmediately: boolean;
}

@Component({
  selector: 'add-media-dialog',
  templateUrl: 'add-media-dialog.html',
  styleUrls: ['add-media-dialog.css'],
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatDialogModule,
    MatSlideToggleModule,
  ],
})
export class AddMediaDialog {
  private dialogRef = inject(MatDialogRef<AddMediaDialog>);
  data: AddMediaDialogData = inject<AddMediaDialogData>(MAT_DIALOG_DATA);

  constructor() {
    // Default to true if not specified
    if (this.data.playImmediately === undefined) {
      this.data.playImmediately = true;
    }
  }

  onNoClick(): void {
    this.data.url = '';
    this.dialogRef.close();
  }
}
