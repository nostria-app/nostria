import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MediaService } from '../../../services/media.service';
import { MusicBookmarkPlaylist, MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { LoggerService } from '../../../services/logger.service';

export interface CreateMusicBookmarkPlaylistDialogData {
  trackPubkey?: string;
  trackDTag?: string;
  trackKind?: number;
}

@Component({
  selector: 'app-create-music-bookmark-playlist-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    ReactiveFormsModule,
  ],
  template: `
    <app-custom-dialog [title]="'Create Playlist'" [showCloseButton]="true" [disableClose]="true" [width]="'500px'"
      [maxWidth]="'95vw'" (closed)="onCancel()">
      <div dialog-content>
        @if (!hasMediaServers()) {
          <p class="warning">No media servers configured. You can still create a playlist without cover art.</p>
        }

        <p class="subtitle">Create a bookmark-set playlist for tracks you want to keep together.</p>

        <form [formGroup]="playlistForm" class="form">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Title</mat-label>
            <input matInput formControlName="title" autocomplete="off" placeholder="Late Night Mix" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Description</mat-label>
            <textarea matInput formControlName="description" rows="2" placeholder="Optional description"></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Cover image URL</mat-label>
            <input matInput formControlName="imageUrl" autocomplete="off" placeholder="https://..." />
          </mat-form-field>
        </form>
      </div>

      <div dialog-actions>
        <button mat-button type="button" (click)="onCancel()">Cancel</button>
        <button mat-flat-button type="button" (click)="onSubmit()" [disabled]="playlistForm.invalid || isCreating()">
          @if (isCreating()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            Create Playlist
          }
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`
    .subtitle,
    .warning {
      margin: 0 0 1rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .full-width {
      width: 100%;
    }
  `],
})
export class CreateMusicBookmarkPlaylistDialogComponent {
  data = input<CreateMusicBookmarkPlaylistDialogData>({});
  closed = output<{ playlist: MusicBookmarkPlaylist; trackAdded: boolean } | null>();

  private fb = inject(FormBuilder);
  private playlistService = inject(MusicBookmarkPlaylistService);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);
  isCreating = signal(false);

  playlistForm: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(1)]],
    description: [''],
    imageUrl: [''],
  });

  async onSubmit(): Promise<void> {
    if (this.playlistForm.invalid || this.isCreating()) {
      return;
    }

    this.isCreating.set(true);
    try {
      const value = this.playlistForm.value;
      const playlist = await this.playlistService.createPlaylist({
        title: value.title,
        description: value.description || undefined,
        image: value.imageUrl || undefined,
      });

      if (!playlist) {
        this.closed.emit(null);
        return;
      }

      const dialogData = this.data();
      let trackAdded = false;
      if (dialogData.trackPubkey && dialogData.trackDTag) {
        trackAdded = await this.playlistService.addTrackToPlaylist(
          playlist.id,
          dialogData.trackPubkey,
          dialogData.trackDTag,
          dialogData.trackKind,
        );
      }

      this.closed.emit({ playlist, trackAdded });
    } catch (error) {
      this.logger.error('[MusicBookmarkPlaylist] Failed to create playlist:', error);
      this.snackBar.open('Failed to create playlist', 'Close', { duration: 3000 });
      this.closed.emit(null);
    } finally {
      this.isCreating.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }
}
