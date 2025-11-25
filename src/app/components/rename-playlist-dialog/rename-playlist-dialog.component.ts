import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Playlist } from '../../interfaces';

export interface RenamePlaylistDialogData {
  playlist: Playlist;
}

export interface RenamePlaylistDialogResult {
  name: string;
}

@Component({
  selector: 'app-rename-playlist-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './rename-playlist-dialog.component.html',
  styleUrl: './rename-playlist-dialog.component.scss',
})
export class RenamePlaylistDialogComponent {
  private dialogRef = inject(MatDialogRef<RenamePlaylistDialogComponent>);
  private data = inject<RenamePlaylistDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);

  renameForm: FormGroup;

  constructor() {
    this.renameForm = this.fb.group({
      name: [this.data.playlist.title, [Validators.required]],
    });
  }

  onSubmit(): void {
    if (this.renameForm.valid) {
      this.dialogRef.close({
        name: this.renameForm.value.name,
      } as RenamePlaylistDialogResult);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
