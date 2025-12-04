import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { PlaylistService } from '../../../services/playlist.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { PlaylistTrack } from '../../../interfaces';
import { AddTrackDialogComponent } from './add-track-dialog/add-track-dialog.component';
import { EditTrackDialogComponent, EditTrackDialogData, EditTrackDialogResult } from './edit-track-dialog/edit-track-dialog.component';

@Component({
  selector: 'app-playlist-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DragDropModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
    MatListModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './playlist-editor.component.html',
  styleUrl: './playlist-editor.component.scss',
})
export class PlaylistEditorComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private playlistService = inject(PlaylistService);
  private mediaPlayer = inject(MediaPlayerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  playlistForm!: FormGroup;
  newTag = signal('');

  currentPlaylist = this.playlistService.currentEditingPlaylist;

  tracks = computed(() => this.currentPlaylist()?.tracks || []);
  totalDuration = computed(() => this.calculateTotalDuration(this.tracks()));

  ngOnInit(): void {
    const playlistId = this.route.snapshot.paramMap.get('id');

    if (!playlistId) {
      this.router.navigate(['/playlists']);
      return;
    }

    // Check if we already have a playlist being edited
    if (!this.currentPlaylist()) {
      // Try to load from existing playlists or drafts
      const existingPlaylist = this.playlistService.getPlaylist(playlistId);
      if (existingPlaylist) {
        this.playlistService.editPlaylist(existingPlaylist);
      } else {
        // Try loading as draft
        this.playlistService.loadDraft(playlistId);
      }
    }

    this.initializeForm();
  }

  private initializeForm(): void {
    const playlist = this.currentPlaylist();

    this.playlistForm = this.fb.group({
      id: [
        playlist?.id || '',
        [
          Validators.required,
          Validators.minLength(1),
          this.uniqueIdValidator.bind(this)
        ]
      ],
      title: [playlist?.title || '', [Validators.required, Validators.minLength(1)]],
      description: [playlist?.description || ''],
    });

    // Subscribe to form changes and update playlist
    this.playlistForm.valueChanges.subscribe(value => {
      if (this.playlistForm.valid) {
        this.playlistService.updateCurrentPlaylist({
          id: value.id,
          title: value.title,
          description: value.description,
        });
      }
    });
  }

  // Custom validator to check for unique playlist ID
  private uniqueIdValidator(control: FormGroup): Record<string, boolean> | null {
    if (!control.value) return null;

    const currentPlaylist = this.currentPlaylist();
    const isUnique = this.playlistService.isPlaylistIdUnique(
      control.value,
      currentPlaylist?.isNewPlaylist ? undefined : currentPlaylist?.id
    );

    return isUnique ? null : { duplicateId: true };
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

  addTrack(): void {
    const dialogRef = this.dialog.open(AddTrackDialogComponent, {
      width: '500px',
      data: {},
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const track: PlaylistTrack = {
          url: result.url,
          title: result.title,
          artist: result.artist,
          duration: result.duration,
        };
        this.playlistService.addTrackToCurrentPlaylist(track);
      }
    });
  }

  removeTrack(index: number): void {
    this.playlistService.removeTrackFromCurrentPlaylist(index);
  }

  editTrack(track: PlaylistTrack, index: number): void {
    const dialogRef = this.dialog.open(EditTrackDialogComponent, {
      width: '500px',
      data: {
        url: track.url,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        index,
      } as EditTrackDialogData,
    });

    dialogRef.afterClosed().subscribe((result: EditTrackDialogResult) => {
      if (result) {
        const updatedTrack: PlaylistTrack = {
          url: result.url,
          title: result.title,
          artist: result.artist,
          duration: result.duration,
        };
        this.playlistService.updateTrackInCurrentPlaylist(result.index, updatedTrack);
      }
    });
  }

  onTrackDrop(event: CdkDragDrop<PlaylistTrack[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.playlistService.reorderTracksInCurrentPlaylist(
        event.previousIndex,
        event.currentIndex
      );
    }
  }

  addTag(): void {
    const tagValue = this.newTag().trim().toLowerCase();
    if (!tagValue) return;

    const playlist = this.currentPlaylist();
    if (!playlist) return;

    const currentTags = playlist.tags || [];
    if (!currentTags.includes(tagValue)) {
      this.playlistService.updateCurrentPlaylist({
        tags: [...currentTags, tagValue],
      });
    }

    this.newTag.set('');
  }

  removeTag(tag: string): void {
    const playlist = this.currentPlaylist();
    if (!playlist) return;

    const currentTags = playlist.tags || [];
    this.playlistService.updateCurrentPlaylist({
      tags: currentTags.filter(t => t !== tag),
    });
  }

  saveDraft(): void {
    this.playlistService.saveDraft();
    this.snackBar.open('Draft saved!', 'Close', { duration: 2000 });
  }

  savePlaylist(): void {
    if (!this.playlistForm.valid) {
      this.snackBar.open('Please fix form errors before saving', 'Close', { duration: 3000 });
      return;
    }

    try {
      this.playlistService.savePlaylist();
      this.snackBar.open('Playlist saved!', 'Close', { duration: 2000 });
      this.router.navigate(['/playlists']);
    } catch {
      this.snackBar.open('Failed to save playlist', 'Close', { duration: 3000 });
    }
  }

  async publishPlaylist(): Promise<void> {
    if (!this.playlistForm.valid) {
      this.snackBar.open('Please fix form errors before publishing', 'Close', { duration: 3000 });
      return;
    }

    try {
      const result = await this.playlistService.saveAndPublishPlaylist();
      if (result) {
        this.snackBar.open('Playlist published to Nostr!', 'Close', { duration: 3000 });
        this.router.navigate(['/playlists']);
      } else {
        this.snackBar.open('Failed to publish playlist to Nostr', 'Close', { duration: 3000 });
      }
    } catch {
      this.snackBar.open('Failed to publish playlist', 'Close', { duration: 3000 });
    }
  }

  cancel(): void {
    this.playlistService.cancelEditing();
    this.router.navigate(['/playlists']);
  }

  playTrack(index: number): void {
    const tracks = this.tracks();
    if (tracks.length === 0) return;

    // Convert tracks to MediaItems and play from selected index
    const mediaItems = tracks.map((track, i) => ({
      source: track.url,
      title: track.title || `Track ${i + 1}`,
      artist: track.artist || 'Unknown Artist',
      artwork: '/icons/icon-192x192.png',
      type: this.getMediaType(track.url),
    }));

    // Clear queue and play from selected track
    this.mediaPlayer.clearQueue();

    // Add all tracks starting from the selected one
    for (let i = index; i < mediaItems.length; i++) {
      if (i === index) {
        this.mediaPlayer.play(mediaItems[i]);
      } else {
        this.mediaPlayer.enque(mediaItems[i]);
      }
    }
  }

  playAllTracks(): void {
    this.playTrack(0);
  }

  private calculateTotalDuration(tracks: PlaylistTrack[]): string {
    let totalSeconds = 0;
    let hasValidDurations = false;

    for (const track of tracks) {
      if (track.duration) {
        const seconds = this.parseDurationToSeconds(track.duration);
        if (seconds > 0) {
          totalSeconds += seconds;
          hasValidDurations = true;
        }
      }
    }

    return hasValidDurations ? this.formatDuration(totalSeconds) : '0:00';
  }

  private parseDurationToSeconds(duration: string): number {
    if (duration.includes(':')) {
      const parts = duration.split(':').map(p => parseInt(p, 10));
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }
    return parseInt(duration, 10) || 0;
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  private getMediaType(url: string): 'Music' | 'Podcast' | 'YouTube' | 'Video' {
    if (!url) return 'Music';

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'YouTube';
    }

    const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
    const lowercaseUrl = url.toLowerCase();
    if (videoExtensions.some(ext => lowercaseUrl.includes(ext))) {
      return 'Video';
    }

    return 'Music';
  }
}