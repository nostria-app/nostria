import { Component, computed, inject, OnDestroy, signal, ViewChild } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import {
  DEFAULT_MEDIA_UPLOAD_SETTINGS,
  getMediaOptimizationDescription,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  getVideoOptimizationProfileBadgeLabel,
  VIDEO_OPTIMIZATION_PROFILE_OPTIONS,
  MEDIA_OPTIMIZATION_OPTIONS,
  normalizeCompressionStrength,
  type MediaOptimizationOptionValue,
  MediaUploadDialogResult,
  MediaUploadMode,
  shouldUploadOriginal,
  type MediaUploadSettings,
  type VideoOptimizationProfile,
} from '../../../interfaces/media-upload';

interface SelectedFileEntry {
  id: string;
  file: File;
  previewUrl: string | null;
  isImage: boolean;
  isVideo: boolean;
  videoThumbnailUrl: string | null;
  videoOptimizationProfile?: VideoOptimizationProfile;
}

@Component({
  selector: 'app-media-upload-dialog',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatMenuModule,
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
  private pendingVideoProfileMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly VIDEO_PROFILE_MENU_HOLD_DELAY = 450;

  selectedFiles = signal<SelectedFileEntry[]>([]);
  hasFiles = computed(() => this.selectedFiles().length > 0);
  hasImageOrVideo = computed(() => this.selectedFiles().some(f => f.isImage || f.isVideo));
  hasVideo = computed(() => this.selectedFiles().some(f => f.isVideo));
  isDragging = signal<boolean>(false);
  isUploading = signal<boolean>(false);
  readonly optimizationOptions = MEDIA_OPTIMIZATION_OPTIONS;
  uploadMode = signal<MediaUploadMode>(DEFAULT_MEDIA_UPLOAD_SETTINGS.mode);
  compressionStrength = signal<number>(DEFAULT_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  videoOptimizationProfile = signal<VideoOptimizationProfile>(DEFAULT_MEDIA_UPLOAD_SETTINGS.videoOptimizationProfile ?? 'default');
  usesLocalCompression = computed(() => this.uploadMode() === 'local');
  readonly videoOptimizationProfileOptions = VIDEO_OPTIMIZATION_PROFILE_OPTIONS;
  videoProfileMenuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  videoProfileMenuFileId = signal<string | null>(null);
  selectedOptimization = computed(() => getMediaOptimizationOption(this.uploadMode(), this.compressionStrength()));
  selectedOptimizationDescription = computed(() =>
    getMediaOptimizationDescription(this.uploadMode(), this.compressionStrength(), this.videoOptimizationProfile())
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
    this.clearPendingVideoProfileMenuOpen();
    this.releaseEntryUrls(this.selectedFiles());
  }

  onUploadModeChange(mode: MediaUploadMode): void {
    this.uploadMode.set(mode);
  }

  onCompressionStrengthChange(value: number): void {
    this.compressionStrength.set(normalizeCompressionStrength(value));
  }

  resetCompressionStrength(): void {
    this.compressionStrength.set(DEFAULT_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  }

  onOptimizationChange(optimization: MediaOptimizationOptionValue): void {
    const settings = {
      ...getMediaUploadSettingsForOptimization(optimization),
      videoOptimizationProfile: this.videoOptimizationProfile(),
    };
    this.uploadMode.set(settings.mode);
    this.compressionStrength.set(settings.compressionStrength);
    this.videoOptimizationProfile.set(settings.videoOptimizationProfile ?? 'default');
  }

  private getCurrentUploadSettings() {
    return {
      mode: this.uploadMode(),
      compressionStrength: this.compressionStrength(),
      videoOptimizationProfile: this.videoOptimizationProfile(),
    };
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
        id: crypto.randomUUID(),
        file,
        previewUrl: null,
        isImage: file.type.startsWith('image/'),
        isVideo: file.type.startsWith('video/'),
        videoThumbnailUrl: null,
        videoOptimizationProfile: file.type.startsWith('video/') ? this.videoOptimizationProfile() : undefined,
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
        uploadSettings: this.getUploadSettingsForEntry(entry),
        contextLabel: 'Media upload',
      },
    });
  }

  onFileThumbnailPointerDown(entry: SelectedFileEntry, event: PointerEvent): void {
    if (event.button !== 0 || !entry.isVideo) {
      return;
    }

    this.clearPendingVideoProfileMenuOpen();
    const anchor = this.getContextMenuAnchor(event.currentTarget as HTMLElement | null, event.clientX, event.clientY);
    this.pendingVideoProfileMenuTimeout = setTimeout(() => {
      this.pendingVideoProfileMenuTimeout = null;
      this.openVideoOptimizationMenu(entry, anchor.x, anchor.y);
    }, this.VIDEO_PROFILE_MENU_HOLD_DELAY);
  }

  onFileThumbnailPointerUp(): void {
    this.clearPendingVideoProfileMenuOpen();
  }

  onFileThumbnailContextMenu(entry: SelectedFileEntry, event: MouseEvent): void {
    if (!entry.isVideo) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.clearPendingVideoProfileMenuOpen();
    this.openVideoOptimizationMenu(entry, event.clientX, event.clientY);
  }

  onFileThumbnailKeyDown(entry: SelectedFileEntry, event: KeyboardEvent): void {
    if (!entry.isVideo) {
      return;
    }

    const shouldOpenMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!shouldOpenMenu) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const anchor = this.getContextMenuAnchor(event.currentTarget as HTMLElement | null, 0, 0);
    this.openVideoOptimizationMenu(entry, anchor.x, anchor.y);
  }

  isSelectedVideoOptimizationProfile(profile: VideoOptimizationProfile): boolean {
    const entry = this.getVideoProfileMenuEntry();
    if (!entry) {
      return false;
    }

    return this.getVideoOptimizationProfileForEntry(entry) === profile;
  }

  onVideoOptimizationProfileSelected(profile: VideoOptimizationProfile): void {
    const entry = this.getVideoProfileMenuEntry();
    if (!entry) {
      return;
    }

    this.selectedFiles.update(files => files.map(file => file.id === entry.id
      ? { ...file, videoOptimizationProfile: profile }
      : file));
    this.closeVideoOptimizationMenu();
  }

  onVideoOptimizationMenuClosed(): void {
    this.clearPendingVideoProfileMenuOpen();
    this.videoProfileMenuFileId.set(null);
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
        uploadSettings: this.getCurrentUploadSettings(),
        fileUploadSettings: this.selectedFiles().map(entry => ({
          file: entry.file,
          uploadSettings: this.getUploadSettingsForEntry(entry),
        })),
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

  getVideoOptimizationProfileBadgeLabelForEntry(entry: SelectedFileEntry): string {
    return getVideoOptimizationProfileBadgeLabel(this.getVideoOptimizationProfileForEntry(entry));
  }

  getVideoOptimizationProfileLabelForEntry(entry: SelectedFileEntry): string {
    return this.videoOptimizationProfileOptions.find(option => option.value === this.getVideoOptimizationProfileForEntry(entry))?.label
      ?? this.videoOptimizationProfileOptions[0].label;
  }

  private getUploadSettingsForEntry(entry: SelectedFileEntry): MediaUploadSettings {
    return {
      ...this.getCurrentUploadSettings(),
      videoOptimizationProfile: entry.isVideo
        ? this.getVideoOptimizationProfileForEntry(entry)
        : this.videoOptimizationProfile(),
    };
  }

  private getVideoOptimizationProfileForEntry(entry: SelectedFileEntry): VideoOptimizationProfile {
    return entry.videoOptimizationProfile ?? this.videoOptimizationProfile();
  }

  private getVideoProfileMenuEntry(): SelectedFileEntry | undefined {
    const fileId = this.videoProfileMenuFileId();
    if (!fileId) {
      return undefined;
    }

    return this.selectedFiles().find(entry => entry.id === fileId);
  }

  private getContextMenuAnchor(element: HTMLElement | null, clientX: number, clientY: number): { x: number; y: number } {
    if (clientX > 0 || clientY > 0) {
      return { x: clientX, y: clientY };
    }

    const rect = element?.getBoundingClientRect();
    if (!rect) {
      return { x: 24, y: 24 };
    }

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private getClampedVideoProfileMenuPosition(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') {
      return { x, y };
    }

    return {
      x: Math.max(8, Math.min(x, window.innerWidth - 280)),
      y: Math.max(8, Math.min(y, window.innerHeight - 260)),
    };
  }

  private openVideoOptimizationMenu(entry: SelectedFileEntry, x: number, y: number): void {
    this.videoProfileMenuFileId.set(entry.id);
    this.videoProfileMenuPosition.set(this.getClampedVideoProfileMenuPosition(x, y));
    requestAnimationFrame(() => {
      this.videoProfileMenuTrigger?.openMenu();
      setTimeout(() => this.videoProfileMenuTrigger?.updatePosition(), 0);
    });
  }

  private closeVideoOptimizationMenu(): void {
    this.videoProfileMenuTrigger?.closeMenu();
    this.videoProfileMenuFileId.set(null);
  }

  private clearPendingVideoProfileMenuOpen(): void {
    if (this.pendingVideoProfileMenuTimeout !== null) {
      clearTimeout(this.pendingVideoProfileMenuTimeout);
      this.pendingVideoProfileMenuTimeout = null;
    }
  }

  @ViewChild('videoProfileMenuTrigger', { read: MatMenuTrigger }) videoProfileMenuTrigger?: MatMenuTrigger;

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
