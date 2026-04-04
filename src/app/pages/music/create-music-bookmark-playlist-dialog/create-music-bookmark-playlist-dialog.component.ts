import { Component, computed, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-create-music-bookmark-playlist-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatDialogModule,
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
          <div class="media-server-warning">
            <div class="warning-content">
              <mat-icon>warning</mat-icon>
              <span>No media servers configured. You can still create a playlist with gradient art.</span>
            </div>
            <button mat-flat-button type="button" (click)="navigateToMediaSettings()">Configure Media Server</button>
          </div>
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

          <div class="cover-section" [class.drag-over]="isDraggingImage()" (dragenter)="onImageDragEnter($event)"
            (dragover)="onImageDragOver($event)" (dragleave)="onImageDragLeave($event)" (drop)="onImageDrop($event)">
            <span class="cover-label">Cover Image</span>
            @if (isDraggingImage()) {
              <div class="drag-overlay">
                <mat-icon>add_photo_alternate</mat-icon>
                <span>Drop image here</span>
              </div>
            }
            <div class="cover-row">
              <div class="cover-preview" [class.has-image]="!!coverImage()"
                [style.background-image]="coverImage() ? 'url(' + coverImage() + ')' : currentGradient()">
                @if (!coverImage()) {
                  <mat-icon class="cover-icon">playlist_play</mat-icon>
                }
              </div>
              <div class="cover-actions">
                <button mat-stroked-button type="button" (click)="uploadImage()" [disabled]="isUploading()">
                  @if (isUploading()) {
                    <mat-spinner diameter="18"></mat-spinner>
                  } @else {
                    <mat-icon>image</mat-icon>
                  }
                  <span>Upload Image</span>
                </button>
                <button mat-stroked-button type="button" (click)="randomizeGradient()">
                  <mat-icon>auto_awesome</mat-icon>
                  <span>Random</span>
                </button>
              </div>
            </div>
            <div class="url-row">
              <span class="or-divider">OR</span>
              <mat-form-field appearance="outline" class="full-width url-field">
                <input matInput formControlName="imageUrl" autocomplete="off" placeholder="https://..."
                  (blur)="onImageUrlChange()" (keyup.enter)="onImageUrlChange()" />
              </mat-form-field>
            </div>
          </div>
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
    .subtitle {
      margin: 0 0 1rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .media-server-warning {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
      padding: 0.875rem 1rem;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);
    }

    .warning-content {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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

    .cover-section {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-surface-container-low);
    }

    .cover-section.drag-over {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }

    .cover-label {
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .cover-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .cover-preview {
      width: 96px;
      height: 96px;
      min-width: 96px;
      border-radius: var(--mat-sys-corner-medium);
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .cover-icon {
      font-size: 2rem;
      width: 2rem;
      height: 2rem;
      color: white;
    }

    .cover-actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .url-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .or-divider {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .drag-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: color-mix(in srgb, var(--mat-sys-primary-container) 88%, transparent);
      border-radius: inherit;
      color: var(--mat-sys-on-primary-container);
      pointer-events: none;
    }

    @media (max-width: 600px) {
      .media-server-warning,
      .cover-row {
        flex-direction: column;
        align-items: stretch;
      }

      .cover-preview {
        width: 100%;
        max-width: 180px;
        height: 180px;
        min-width: 0;
      }
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
  private router = inject(Router);
  private dialog = inject(MatDialog);

  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);
  isCreating = signal(false);
  isUploading = signal(false);
  isDraggingImage = signal(false);
  coverImage = signal<string | null>(null);
  previousCoverImage = signal<string | null>(null);
  private dragEnterCounter = 0;

  private readonly gradients = [
    'linear-gradient(135deg, #e040fb 0%, #7c4dff 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)',
    'linear-gradient(135deg, #00d2d3 0%, #54a0ff 100%)',
    'linear-gradient(135deg, #5f27cd 0%, #00d2d3 100%)',
    'linear-gradient(135deg, #ff9ff3 0%, #feca57 100%)',
    'linear-gradient(135deg, #1dd1a1 0%, #00d2d3 100%)',
  ];

  currentGradient = signal(this.getRandomGradient());

  playlistForm: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(1)]],
    description: [''],
    imageUrl: [''],
  });

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
      if (file) {
        await this.handleImageFile(file);
      }
    };
    input.click();
  }

  onImageDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter++;
    this.isDraggingImage.set(true);
  }

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter--;
    if (this.dragEnterCounter <= 0) {
      this.dragEnterCounter = 0;
      this.isDraggingImage.set(false);
    }
  }

  async onImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter = 0;
    this.isDraggingImage.set(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please drop an image file', 'Close', { duration: 3000 });
      return;
    }

    await this.handleImageFile(file);
  }

  private async handleImageFile(file: File): Promise<void> {
    const oldImageUrl = this.previousCoverImage();
    this.isUploading.set(true);

    try {
      const servers = this.mediaService.mediaServers();
      if (servers.length === 0) {
        this.snackBar.open('No media servers available', 'Close', { duration: 3000 });
        return;
      }

      const result = await this.mediaService.uploadFile(file, false, servers);
      if (result.status === 'success' || result.status === 'duplicate') {
        const url = result.item?.url;
        if (url) {
          this.coverImage.set(url);
          this.previousCoverImage.set(url);
          this.playlistForm.patchValue({ imageUrl: url });
          this.snackBar.open('Cover image uploaded', 'Close', { duration: 2000 });
          if (oldImageUrl && oldImageUrl !== url) {
            this.promptDeleteFile('cover image', oldImageUrl);
          }
        }
      } else {
        this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to upload playlist image:', error);
      this.snackBar.open('Error uploading image', 'Close', { duration: 3000 });
    } finally {
      this.isUploading.set(false);
    }
  }

  onImageUrlChange(): void {
    const url = this.playlistForm.get('imageUrl')?.value?.trim();
    if (!url) {
      this.coverImage.set(null);
      return;
    }

    try {
      new URL(url);
      this.coverImage.set(url);
    } catch {
      this.snackBar.open('Please enter a valid image URL', 'Close', { duration: 3000 });
    }
  }

  private extractHashFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const filename = urlObj.pathname.split('/').pop() || '';
      const hashPart = filename.split('.')[0];
      return /^[a-fA-F0-9]{64}$/.test(hashPart) ? hashPart : null;
    } catch {
      return null;
    }
  }

  private promptDeleteFile(fileType: string, url: string): void {
    const hash = this.extractHashFromUrl(url);
    if (!hash) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete old ${fileType}?`,
        message: `You've uploaded a new ${fileType}. Delete the old one from the server?`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        confirmColor: 'warn',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (!confirmed) {
        return;
      }

      try {
        await this.mediaService.deleteFile(hash);
        this.snackBar.open(`Old ${fileType} deleted`, 'Close', { duration: 2000 });
      } catch (error) {
        this.logger.error(`Failed to delete old ${fileType}:`, error);
        this.snackBar.open(`Failed to delete old ${fileType}`, 'Close', { duration: 3000 });
      }
    });
  }

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
        image: value.imageUrl || null,
        gradient: value.imageUrl ? null : this.currentGradient(),
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

  navigateToMediaSettings(): void {
    this.onCancel();
    void this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }

  onCancel(): void {
    this.closed.emit(null);
  }
}
