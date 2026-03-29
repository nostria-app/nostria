import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { MediaUploadSettings, getCompressionStrengthLabel } from '../../interfaces/media-upload';
import { CompressionPreviewResult, MediaProcessingService } from '../../services/media-processing.service';

export interface CompressionPreviewDialogData {
  file: File;
  uploadSettings: MediaUploadSettings;
  contextLabel?: string;
}

@Component({
  selector: 'app-compression-preview-dialog',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './compression-preview-dialog.component.html',
  styleUrl: './compression-preview-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompressionPreviewDialogComponent implements OnInit, OnDestroy {
  readonly dialogRef = inject(CustomDialogRef<CompressionPreviewDialogComponent, void>, { optional: true });
  readonly mediaProcessing = inject(MediaProcessingService);

  data!: CompressionPreviewDialogData;

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly previewResult = signal<CompressionPreviewResult | null>(null);
  readonly originalObjectUrl = signal<string | null>(null);
  readonly compressedObjectUrl = signal<string | null>(null);
  readonly progressMessage = signal<string>('');

  readonly isImage = computed(() => this.data?.file.type.startsWith('image/') ?? false);
  readonly isVideo = computed(() => this.data?.file.type.startsWith('video/') ?? false);
  readonly compressionStrengthLabel = computed(() => getCompressionStrengthLabel(this.data?.uploadSettings.compressionStrength ?? 0));
  readonly summaryLabel = computed(() => {
    const result = this.previewResult();
    if (!result?.compressedFile) {
      return 'Compression preview is unavailable for this file.';
    }

    const sizeDifference = result.originalFile.size - result.compressedFile.size;
    const percentDifference = result.originalFile.size > 0
      ? Math.abs(sizeDifference) / result.originalFile.size
      : 0;

    if (sizeDifference > 0) {
      return `${Math.round(percentDifference * 100)}% smaller than the original.`;
    }

    if (sizeDifference < 0) {
      return `${Math.round(percentDifference * 100)}% larger than the original.`;
    }

    return 'Same file size as the original.';
  });

  async ngOnInit(): Promise<void> {
    if (!this.data?.file) {
      this.errorMessage.set('No file was provided for the compression preview.');
      this.isLoading.set(false);
      return;
    }

    this.originalObjectUrl.set(URL.createObjectURL(this.data.file));

    try {
      const result = await this.mediaProcessing.createCompressionPreview(
        this.data.file,
        this.data.uploadSettings,
        progress => {
          this.progressMessage.set(progress.message);
        },
      );

      this.previewResult.set(result);

      if (result.compressedFile) {
        this.compressedObjectUrl.set(URL.createObjectURL(result.compressedFile));
      }

      if (!result.compressedFile && result.warningMessage) {
        this.errorMessage.set(result.warningMessage);
      }
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not generate the compression preview.');
    } finally {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.revokeObjectUrl(this.originalObjectUrl());
    this.revokeObjectUrl(this.compressedObjectUrl());
  }

  close(): void {
    this.dialogRef?.close();
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private revokeObjectUrl(objectUrl: string | null): void {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}