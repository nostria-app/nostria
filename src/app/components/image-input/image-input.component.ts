import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { MediaService } from '../../services/media.service';

/**
 * Image URL field offering the three ways the rest of the app sets an image:
 * upload a file, paste a URL, or pick from the user's media library.
 *
 * The value is the resulting URL — uploads are performed immediately so the
 * caller only ever deals with a string.
 */
@Component({
  selector: 'app-image-input',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './image-input.component.html',
  styleUrl: './image-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageInputComponent {
  private readonly media = inject(MediaService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  /** The image URL. Two-way bindable. */
  readonly value = model<string>('');

  /** Field label, e.g. "Group icon". */
  readonly label = input<string>('Image');

  /** Shape of the preview thumbnail. */
  readonly shape = input<'square' | 'circle' | 'wide'>('square');

  readonly uploading = signal(false);
  readonly showUrlInput = signal(false);

  readonly hasMediaServers = () => this.media.mediaServers().length > 0;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Reset so picking the same file twice still fires a change event.
    input.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please choose an image file', 'Close', { duration: 4000 });
      return;
    }

    void this.upload(file);
  }

  private async upload(file: File): Promise<void> {
    if (!this.requireMediaServer()) return;

    this.uploading.set(true);

    try {
      const result = await this.media.uploadFile(file, false, []);

      if (result.status === 'success' || result.status === 'duplicate') {
        const url = result.item?.url ?? '';
        if (url) {
          this.value.set(url);
          this.showUrlInput.set(false);
        }
      } else {
        this.snackBar.open(result.message || 'Upload failed', 'Close', { duration: 5000 });
      }
    } catch {
      this.snackBar.open('Failed to upload the image', 'Close', { duration: 4000 });
    } finally {
      this.uploading.set(false);
    }
  }

  async openMediaLibrary(): Promise<void> {
    if (!this.requireMediaServer()) return;

    const { MediaChooserDialogComponent } = await import(
      '../media-chooser-dialog/media-chooser-dialog.component'
    );
    type MediaChooserResult = import(
      '../media-chooser-dialog/media-chooser-dialog.component'
    ).MediaChooserResult;

    const dialogRef = this.dialog.open(MediaChooserDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'media-chooser-dialog-panel'],
      width: '700px',
      maxWidth: '95vw',
      data: { multiple: false, mediaType: 'images' },
    });

    dialogRef.afterClosed().subscribe((result: MediaChooserResult | undefined) => {
      const selected = result?.items?.[0];
      if (!selected) return;

      this.value.set(selected.url);
      this.showUrlInput.set(false);
    });
  }

  clear(): void {
    this.value.set('');
    this.showUrlInput.set(false);
  }

  private requireMediaServer(): boolean {
    if (this.hasMediaServers()) return true;

    this.snackBar
      .open('You need to configure a media server first', 'Configure', { duration: 5000 })
      .onAction()
      .subscribe(() => {
        void this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      });

    return false;
  }
}
