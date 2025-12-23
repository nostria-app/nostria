import { Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MusicPlaylistService, CreateMusicPlaylistData } from '../../../services/music-playlist.service';
import { MediaService } from '../../../services/media.service';

export interface CreateMusicPlaylistDialogData {
  // Optional track to add immediately after creation
  trackPubkey?: string;
  trackDTag?: string;
}

@Component({
  selector: 'app-create-music-playlist-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './create-music-playlist-dialog.component.html',
  styleUrl: './create-music-playlist-dialog.component.scss',
})
export class CreateMusicPlaylistDialogComponent {
  private dialogRef = inject(MatDialogRef<CreateMusicPlaylistDialogComponent>);
  private data = inject<CreateMusicPlaylistDialogData>(MAT_DIALOG_DATA);
  private fb = inject(FormBuilder);
  private musicPlaylistService = inject(MusicPlaylistService);
  private mediaService = inject(MediaService);

  playlistForm: FormGroup;
  isCreating = signal(false);
  isUploading = signal(false);
  coverImage = signal<string | null>(null);

  // Random gradients for default cover
  private gradients = [
    'linear-gradient(135deg, #e040fb 0%, #7c4dff 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)',
    'linear-gradient(135deg, #00d2d3 0%, #54a0ff 100%)',
    'linear-gradient(135deg, #5f27cd 0%, #00d2d3 100%)',
    'linear-gradient(135deg, #ff9ff3 0%, #feca57 100%)',
    'linear-gradient(135deg, #1dd1a1 0%, #00d2d3 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
    'linear-gradient(135deg, #c8d6e5 0%, #576574 100%)',
  ];

  currentGradient = signal(this.getRandomGradient());

  constructor() {
    this.playlistForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(1)]],
      description: [''],
      imageUrl: [''],
      isPublic: [true],
      isCollaborative: [false],
    });
  }

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  randomizeGradient(): void {
    this.currentGradient.set(this.getRandomGradient());
    this.coverImage.set(null);
    this.playlistForm.patchValue({ imageUrl: '' });
  }

  async uploadImage(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      this.isUploading.set(true);
      try {
        const servers = this.mediaService.mediaServers();
        if (servers.length === 0) {
          console.error('No media servers available');
          return;
        }
        const result = await this.mediaService.uploadFile(file, false, servers);
        if (result.status === 'success' || result.status === 'duplicate') {
          const url = result.item?.url;
          if (url) {
            this.coverImage.set(url);
            this.playlistForm.patchValue({ imageUrl: url });
          }
        }
      } catch (error) {
        console.error('Failed to upload image:', error);
      } finally {
        this.isUploading.set(false);
      }
    };

    input.click();
  }

  onImageUrlChange(): void {
    const url = this.playlistForm.get('imageUrl')?.value;
    if (url && this.isValidUrl(url)) {
      this.coverImage.set(url);
    } else if (!url) {
      this.coverImage.set(null);
    }
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.playlistForm.valid || this.isCreating()) return;

    this.isCreating.set(true);

    try {
      const formValue = this.playlistForm.value;

      const data: CreateMusicPlaylistData = {
        title: formValue.title,
        description: formValue.description || undefined,
        image: formValue.imageUrl || undefined,
        isPublic: formValue.isPublic,
        isCollaborative: formValue.isCollaborative,
      };

      const playlist = await this.musicPlaylistService.createPlaylist(data);

      if (playlist) {
        // If we have a track to add, add it to the new playlist
        if (this.data?.trackPubkey && this.data?.trackDTag) {
          await this.musicPlaylistService.addTrackToPlaylist(
            playlist.id,
            this.data.trackPubkey,
            this.data.trackDTag
          );
        }

        this.dialogRef.close({ playlist, trackAdded: !!this.data?.trackPubkey });
      } else {
        this.dialogRef.close(null);
      }
    } catch (error) {
      console.error('Failed to create playlist:', error);
      this.dialogRef.close(null);
    } finally {
      this.isCreating.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
