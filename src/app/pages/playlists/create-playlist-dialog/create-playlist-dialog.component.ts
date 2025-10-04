import { Component, inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

export interface CreatePlaylistDialogData {
  title?: string;
  description?: string;
  id?: string;
}

@Component({
  selector: 'app-create-playlist-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTooltipModule,
    ReactiveFormsModule,
  ],
  templateUrl: './create-playlist-dialog.component.html',
  styleUrl: './create-playlist-dialog.component.scss',
})
export class CreatePlaylistDialogComponent {
  private dialogRef = inject(MatDialogRef<CreatePlaylistDialogComponent>);
  private data = inject(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);

  playlistForm: FormGroup;

  constructor() {
    this.playlistForm = this.fb.group({
      id: [this.data?.id || '', [Validators.required, Validators.minLength(1)]],
      title: [this.data?.title || '', [Validators.required, Validators.minLength(1)]],
      description: [this.data?.description || ''],
    });
  }

  generateRandomId(): void {
    const randomId = this.createRandomId();
    this.playlistForm.patchValue({ id: randomId });
  }

  private createRandomId(): string {
    // Generate a human-readable random ID
    const adjectives = ['awesome', 'cool', 'epic', 'great', 'amazing', 'fantastic', 'wonderful', 'brilliant', 'super', 'mega'];
    const nouns = ['beats', 'vibes', 'tunes', 'mix', 'songs', 'tracks', 'music', 'playlist', 'collection', 'sounds'];
    const numbers = Math.floor(Math.random() * 1000);

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adjective}-${noun}-${numbers}`;
  }

  onSubmit(): void {
    if (this.playlistForm.valid) {
      this.dialogRef.close(this.playlistForm.value);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}