import { Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { RssParserService } from '../../../services/rss-parser.service';
import { PlaylistTrack } from '../../../interfaces';

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
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './create-playlist-dialog.component.html',
  styleUrl: './create-playlist-dialog.component.scss',
})
export class CreatePlaylistDialogComponent {
  private dialogRef = inject(MatDialogRef<CreatePlaylistDialogComponent>);
  private data = inject(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private rssParser = inject(RssParserService);

  playlistForm: FormGroup;
  importedTracks: PlaylistTrack[] = [];
  isParsingRss = signal(false);

  constructor() {
    this.playlistForm = this.fb.group({
      id: [this.data?.id || '', [Validators.required, Validators.minLength(1)]],
      title: [this.data?.title || '', [Validators.required, Validators.minLength(1)]],
      description: [this.data?.description || ''],
      rssUrl: [''],
    });
  }

  async fetchRss() {
    const url = this.playlistForm.get('rssUrl')?.value;
    if (!url) return;

    this.isParsingRss.set(true);
    try {
      const feed = await this.rssParser.parse(url);

      this.playlistForm.patchValue({
        title: feed.title,
        description: feed.description
      });

      // If ID is empty, generate one based on title or random
      if (!this.playlistForm.get('id')?.value) {
        if (feed.title) {
          const slug = feed.title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');
          this.playlistForm.patchValue({ id: slug });
        } else {
          this.generateRandomId();
        }
      } this.importedTracks = feed.items.map(item => ({
        url: item.mediaUrl,
        title: item.title,
        artist: feed.author || feed.title,
        duration: item.duration,
        image: item.image
      }));

    } catch (error) {
      console.error('Failed to parse RSS', error);
      // TODO: Show error to user
    } finally {
      this.isParsingRss.set(false);
    }
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
      const result = {
        ...this.playlistForm.value,
        tracks: this.importedTracks
      };
      this.dialogRef.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}