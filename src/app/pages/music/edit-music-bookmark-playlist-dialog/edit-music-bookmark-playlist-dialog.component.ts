import { Component, computed, effect, inject, input, output, signal, untracked, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MediaService } from '../../../services/media.service';
import { MusicBookmarkPlaylist, MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { LoggerService } from '../../../services/logger.service';

export interface EditMusicBookmarkPlaylistDialogData {
  playlist: MusicBookmarkPlaylist;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-edit-music-bookmark-playlist-dialog',
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
    <app-custom-dialog [title]="'Edit Playlist'" [showCloseButton]="true" [disableClose]="true" [width]="'500px'"
      [maxWidth]="'95vw'" (closed)="onCancel()">
      <div dialog-content>
        @if (!hasMediaServers()) {
          <div class="media-server-warning">
            <div class="warning-content">
              <mat-icon>warning</mat-icon>
              <span>You need to configure a media server to upload cover images</span>
            </div>
            <button mat-flat-button type="button" (click)="navigateToMediaSettings()">Configure Media Server</button>
          </div>
        }

        <form [formGroup]="playlistForm" class="playlist-form">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Title</mat-label>
            <input matInput formControlName="title" placeholder="Late Night Mix" autocomplete="off" required />
            @if (playlistForm.get('title')?.hasError('required')) {
              <mat-error>Title is required</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Description</mat-label>
            <textarea matInput formControlName="description" placeholder="What's this playlist about?" rows="2"
              autocomplete="off"></textarea>
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
                <input matInput formControlName="imageUrl" placeholder="Paste image URL" autocomplete="off"
                  (blur)="onImageUrlChange()" (keyup.enter)="onImageUrlChange()" />
              </mat-form-field>
            </div>
          </div>
        </form>
      </div>

      <div dialog-actions>
        <button mat-button type="button" (click)="onCancel()">Cancel</button>
        <button mat-flat-button type="button" (click)="onSubmit()" [disabled]="playlistForm.invalid || isSaving()">
          @if (isSaving()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            Save Changes
          }
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`
    .playlist-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .full-width {
      width: 100%;
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

    .cover-preview.has-image {
      background-size: cover;
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
export class EditMusicBookmarkPlaylistDialogComponent {
  data = input.required<EditMusicBookmarkPlaylistDialogData>();
  closed = output<{ updated: boolean; playlist?: MusicBookmarkPlaylist } | null>();

  private fb = inject(FormBuilder);
  private playlistService = inject(MusicBookmarkPlaylistService);
  private mediaService = inject(MediaService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);
  isSaving = signal(false);
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
  private initialized = false;

  playlistForm: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(1)]],
    description: [''],
    imageUrl: [''],
  });

  constructor() {
    effect(() => {
      const current = this.data();
      if (!current || this.initialized) {
        return;
      }

      this.initialized = true;
      untracked(() => {
        this.playlistForm.patchValue({
          title: current.playlist.title,
          description: current.playlist.description || '',
          imageUrl: current.playlist.image || '',
        });

        if (current.playlist.image) {
          this.coverImage.set(current.playlist.image);
          this.previousCoverImage.set(current.playlist.image);
        }

        const gradient = current.playlist.event ? this.utilities.getMusicGradient(current.playlist.event) : null;
        if (gradient) {
          this.currentGradient.set(gradient);
        }
      });
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
    if (this.playlistForm.invalid || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    try {
      const formValue = this.playlistForm.value;
      const updated = await this.playlistService.updatePlaylist(this.data().playlist.id, {
        title: formValue.title,
        description: formValue.description || undefined,
        image: formValue.imageUrl || undefined,
        gradient: formValue.imageUrl ? null : this.currentGradient(),
      });

      if (updated) {
        this.snackBar.open('Playlist updated!', 'Close', { duration: 2000 });
        this.closed.emit({ updated: true, playlist: updated });
      } else {
        this.snackBar.open('Failed to update playlist', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to update bookmark playlist:', error);
      this.snackBar.open('Failed to update playlist', 'Close', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  navigateToMediaSettings(): void {
    this.onCancel();
    void this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }
}
