import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { MediaUploadSettings, getMediaOptimizationLabel } from '../../interfaces/media-upload';
import { CompressionPreviewResult, MediaProcessingService } from '../../services/media-processing.service';

export interface CompressionPreviewDialogData {
  file: File;
  uploadSettings: MediaUploadSettings;
  contextLabel?: string;
  previewResult?: CompressionPreviewResult;
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
  private readonly dialog = inject(MatDialog);

  data!: CompressionPreviewDialogData;

  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly previewResult = signal<CompressionPreviewResult | null>(null);
  readonly originalObjectUrl = signal<string | null>(null);
  readonly compressedObjectUrl = signal<string | null>(null);
  readonly progressMessage = signal<string>('');

  readonly isImage = computed(() => this.data?.file.type.startsWith('image/') ?? false);
  readonly isVideo = computed(() => this.data?.file.type.startsWith('video/') ?? false);
  readonly optimizationLabel = computed(() =>
    getMediaOptimizationLabel(
      this.data?.uploadSettings.mode ?? 'local',
      this.data?.uploadSettings.compressionStrength ?? 0,
    )
  );
  readonly previewOptimizedSize = computed(() => {
    const result = this.previewResult();
    return result?.compressedFile?.size ?? result?.optimizedSize ?? null;
  });
  readonly summaryLabel = computed(() => {
    const result = this.previewResult();
    const optimizedSize = this.previewOptimizedSize();

    if (!result || optimizedSize === null) {
      return 'Compression preview is unavailable for this file.';
    }

    const sizeDifference = result.originalFile.size - optimizedSize;
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
  readonly optimizedSizeLabel = computed(() => {
    const optimizedSize = this.previewOptimizedSize();
    return optimizedSize !== null ? this.formatFileSize(optimizedSize) : null;
  });
  readonly sizeChangeLabel = computed(() => {
    const result = this.previewResult();
    const optimizedSize = this.previewOptimizedSize();

    if (!result || optimizedSize === null || result.originalFile.size <= 0) {
      return null;
    }

    const sizeDifference = optimizedSize - result.originalFile.size;
    const percentDifference = Math.round((Math.abs(sizeDifference) / result.originalFile.size) * 100);

    if (sizeDifference < 0) {
      return `-${percentDifference}%`;
    }

    if (sizeDifference > 0) {
      return `+${percentDifference}%`;
    }

    return '0%';
  });
  readonly sizeChangeTone = computed<'decrease' | 'increase' | 'neutral'>(() => {
    const result = this.previewResult();
    const optimizedSize = this.previewOptimizedSize();

    if (!result || optimizedSize === null || result.originalFile.size <= 0) {
      return 'neutral';
    }

    const sizeDifference = optimizedSize - result.originalFile.size;

    if (sizeDifference < 0) {
      return 'decrease';
    }

    if (sizeDifference > 0) {
      return 'increase';
    }

    return 'neutral';
  });
  readonly previewStatusTone = computed<'neutral' | 'success' | 'warning'>(() => {
    const result = this.previewResult();
    if (!result || this.previewOptimizedSize() === null) {
      return 'neutral';
    }

    return result.willUploadCompressedFile ? 'success' : 'warning';
  });

  async ngOnInit(): Promise<void> {
    if (!this.data?.file) {
      this.errorMessage.set('No file was provided for the optimization preview.');
      this.isLoading.set(false);
      return;
    }

    if (this.data.previewResult) {
      this.previewResult.set(this.data.previewResult);
      this.originalObjectUrl.set(URL.createObjectURL(this.data.previewResult.originalFile));

      if (this.data.previewResult.compressedFile) {
        this.compressedObjectUrl.set(URL.createObjectURL(this.data.previewResult.compressedFile));
      }

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
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not generate the optimization preview.');
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

  async openLargeImagePreview(kind: 'original' | 'compressed'): Promise<void> {
    if (!this.isImage()) {
      return;
    }

    const originalUrl = this.originalObjectUrl();
    const compressedUrl = this.compressedObjectUrl();
    const previewUrl = kind === 'compressed' ? compressedUrl : originalUrl;

    if (!previewUrl || !originalUrl) {
      return;
    }

    const { MediaPreviewDialogComponent } = await import('../media-preview-dialog/media-preview.component');
    const mediaItems = [
      {
        url: originalUrl,
        type: 'image',
        title: 'Original',
      },
      ...(compressedUrl ? [{
        url: compressedUrl,
        type: 'image',
        title: 'Optimized',
      }] : []),
    ];

    const initialIndex = kind === 'compressed' && compressedUrl ? 1 : 0;

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems,
        initialIndex,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
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
