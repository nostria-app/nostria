import { Component, inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { PlaylistService } from '../../services/playlist.service';
import { Playlist, MediaItem } from '../../interfaces';

export interface SelectPlaylistDialogData {
  mediaItems: MediaItem[];
}

export interface SelectPlaylistDialogResult {
  playlistId?: string;
  createNew?: boolean;
  newPlaylistName?: string;
}

@Component({
  selector: 'app-select-playlist-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatListModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  templateUrl: './select-playlist-dialog.component.html',
  styleUrl: './select-playlist-dialog.component.scss',
})
export class SelectPlaylistDialogComponent {
  private dialogRef = inject(MatDialogRef<SelectPlaylistDialogComponent>);
  private data = inject<SelectPlaylistDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private playlistService = inject(PlaylistService);

  playlists = this.playlistService.userPlaylists;
  showNewPlaylistForm = false;
  newPlaylistForm: FormGroup;

  constructor() {
    this.newPlaylistForm = this.fb.group({
      name: ['', [Validators.required]],
    });
  }

  selectPlaylist(playlist: Playlist): void {
    this.dialogRef.close({
      playlistId: playlist.id,
    } as SelectPlaylistDialogResult);
  }

  toggleNewPlaylistForm(): void {
    this.showNewPlaylistForm = !this.showNewPlaylistForm;
  }

  createNewPlaylist(): void {
    if (this.newPlaylistForm.valid) {
      this.dialogRef.close({
        createNew: true,
        newPlaylistName: this.newPlaylistForm.value.name,
      } as SelectPlaylistDialogResult);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  get mediaCount(): number {
    return this.data.mediaItems.length;
  }
}
