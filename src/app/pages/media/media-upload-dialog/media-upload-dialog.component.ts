import { Component, computed, inject, OnDestroy, signal } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import {
  DEFAULT_MEDIA_UPLOAD_SETTINGS,
  getMediaOptimizationDescription,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  MEDIA_OPTIMIZATION_OPTIONS,
  type MediaOptimizationOptionValue,
  MediaUploadDialogResult,
  MediaUploadMode,
  shouldUploadOriginal,
} from '../../../interfaces/media-upload';

interface SelectedFileEntry {
  file: File;
  previewUrl: string | null;
  isImage: boolean;
  isVideo: boolean;
  videoThumbnailUrl: string | null;
}

@Component({
  selector: 'app-media-upload-dialog',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './media-upload-dialog.component.html',
  styleUrls: ['./media-upload-dialog.component.scss'],
})
export class MediaUploadDialogComponent implements OnDestroy {
  private dialogRef = inject(MatDialogRef<MediaUploadDialogComponent, MediaUploadDialogResult | undefined>);
  private mediaService = inject(MediaService);
  private readonly logger = inject(LoggerService);
  private readonly customDialog = inject(CustomDialogService);

  selectedFiles = signal<SelectedFileEntry[]>([]);
  hasFiles = computed(() => this.selectedFiles().length > 0);
  hasImageOrVideo = computed(() => this.selectedFiles().some(f => f.isImage || f.isVideo));
  isDragging = signal<boolean>(false);
  isUploading = signal<boolean>(false);
  readonly optimizationOptions = MEDIA_OPTIMIZATION_OPTIONS;
  uploadMode = signal<MediaUploadMode>(DEFAULT_MEDIA_UPLOAD_SETTINGS.mode);
  compressionStrength = signal<number>(DEFAULT_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  usesLocalCompression = computed(() => this.uploadMode() === 'local');
  selectedOptimization = computed(() => getMediaOptimizationOption(this.uploadMode(), this.compressionStrength()));
  selectedOptimizationDescription = computed(() =>
    getMediaOptimizationDescription(this.uploadMode(), this.compressionStrength())
  );

  // Add signals for servers
  availableServers = signal<string[]>([]);
  selectedServers = signal<string[]>([]);
  showServerSelection = signal<boolean>(false);

  constructor() {
    // Initialize available servers from the media service
    this.availableServers.set(this.mediaService.mediaServers());

    // Auto select all servers by default
    if (this.availableServers().length > 0) {
      this.selectedServers.set(this.availableServers());
      this.showServerSelection.set(true);
    }
  }

  ngOnDestroy(): void {
    this.releaseEntryUrls(this.selectedFiles());
  }

  onUploadModeChange(mode: MediaUploadMode): void {
    this.uploadMode.set(mode);
  }

  onCompressionStrengthChange(value: number): void {
    this.compressionStrength.set(normalizeCompressionStrength(value));
  }

  resetCompressionStrength(): void {
    this.compressionStrength.set(this.defaultCompressionStrength);
  onOptimizationChange(optimization: MediaOptimizationOptionValue): void {
    const settings = getMediaUploadSettingsForOptimization(optimization);
    this.uploadMode.set(settings.mode);
    this.compressionStrength.set(settings.compressionStrength);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(Array.from(input.files));
      input.value = '';
    }
  }

  addFiles(files: File[]): void {
    for (const file of files) {
      const entry: SelectedFileEntry = {
        file,
        previewUrl: null,
        isImage: file.type.startsWith('image/'),
        isVideo: file.type.startsWith('video/'),
        videoThumbnailUrl: null,
      };

      if (entry.isImage) {
        const reader = new FileReader();
        reader.onload = () => {
          this.selectedFiles.update(list =>
            list.map(e => e.file === file ? { ...e, previewUrl: reader.result as string } : e)
          );
        };
        reader.readAsDataURL(file);
      } else if (entry.isVideo) {
        this.extractVideoThumbnail(file);
      }

      this.selectedFiles.update(list => [...list, entry]);
    }
  }

  removeFile(index: number): void {
    this.selectedFiles.update(list => {
      const entry = list[index];
      if (entry) {
        this.releaseEntryUrls([entry]);
      }
      return list.filter((_, i) => i !== index);
    });
  }

  async openCompressionPreview(entry: SelectedFileEntry): Promise<void> {
    if (!this.usesLocalCompression() || (!entry.isImage && !entry.isVideo)) {
      return;
    }

    const { CompressionPreviewDialogComponent } = await import(
      '../../../components/compression-preview-dialog/compression-preview-dialog.component'
    );

    this.customDialog.open<typeof CompressionPreviewDialogComponent.prototype, void>(CompressionPreviewDialogComponent, {
      title: 'Optimization Preview',
      width: '980px',
      maxWidth: '96vw',
      showCloseButton: true,
      data: {
        file: entry.file,
        uploadSettings: {
          mode: this.uploadMode(),
          compressionStrength: this.compressionStrength(),
        },
        contextLabel: 'Media upload',
      },
    });
  }

  clearAllFiles(): void {
    this.releaseEntryUrls(this.selectedFiles());
    this.selectedFiles.set([]);
  }

  async extractVideoThumbnail(videoFile: File): Promise<void> {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const videoUrl = URL.createObjectURL(videoFile);
      video.src = videoUrl;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video'));
      });

      const seekTime = Math.min(1, video.duration * 0.1);
      video.currentTime = seekTime;

      await new Promise<void>(resolve => {
        video.onseeked = () => resolve();
      });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create thumbnail blob'));
          }
        }, 'image/jpeg', 0.9);
      });

      const thumbnailUrl = URL.createObjectURL(blob);
      const previousThumbnailUrl = this.selectedFiles().find(e => e.file === videoFile)?.videoThumbnailUrl ?? null;
      this.selectedFiles.update(list => list.map(e =>
        e.file === videoFile ? { ...e, videoThumbnailUrl: thumbnailUrl } : e
      ));
      this.releaseBlobUrl(previousThumbnailUrl);

      URL.revokeObjectURL(videoUrl);
    } catch (error) {
      this.logger.error('Failed to extract video thumbnail:', error);
    }
  }

  toggleServerSelection(server: string): void {
    this.selectedServers.update(servers => {
      if (servers.includes(server)) {
        return servers.filter(s => s !== server);
      } else {
        return [...servers, server];
      }
    });
  }

  isServerSelected(server: string): boolean {
    return this.selectedServers().includes(server);
  }

  onSubmit(): void {
    if (this.hasFiles()) {
      this.isUploading.set(true);
      this.dialogRef.close({
        files: this.selectedFiles().map(e => e.file),
        uploadSettings: {
          mode: this.uploadMode(),
          compressionStrength: this.compressionStrength(),
        },
        uploadOriginal: shouldUploadOriginal(this.uploadMode()),
        servers: this.selectedServers(),
      });
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  getFileTypeIcon(file: File): string {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'videocam';
    return 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  totalSize = computed(() => {
    return this.selectedFiles().reduce((sum, entry) => sum + entry.file.size, 0);
  });

  private releaseEntryUrls(entries: SelectedFileEntry[]): void {
    for (const entry of entries) {
      this.releaseBlobUrl(entry.previewUrl);
      this.releaseBlobUrl(entry.videoThumbnailUrl);
    }
  }

  private releaseBlobUrl(url: string | null): void {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  // Drag and drop handlers
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.addFiles(Array.from(files));
    }
  }
}
