import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';
import { MediaService } from './media.service';
import {
  MediaUploadSettings,
  normalizeCompressionStrength,
  shouldUploadOriginal,
} from '../interfaces/media-upload';

type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif';
type SupportedVideoCodec = 'avc' | 'vp8' | 'vp9' | 'av1' | 'hevc';
type SupportedAudioCodec = 'aac' | 'opus' | 'mp3' | 'vorbis';

type MediabunnyModule = typeof import('mediabunny');

export interface MediaProcessingProgress {
  message: string;
  progress?: number;
}

export interface PreparedUploadFile {
  file: File;
  uploadOriginal: boolean;
  wasProcessed: boolean;
  warningMessage?: string;
}

export interface CompressionPreviewResult {
  originalFile: File;
  compressedFile?: File;
  willUploadCompressedFile: boolean;
  warningMessage?: string;
}

interface VideoConversionPlan {
  extension: string;
  format: InstanceType<MediabunnyModule['Mp4OutputFormat']> | InstanceType<MediabunnyModule['WebMOutputFormat']>;
  videoCodec: SupportedVideoCodec;
  audioCodec?: SupportedAudioCodec;
  width: number;
  height: number;
  videoBitrate: number;
  audioBitrate: number;
}

interface CompressionCandidateResult {
  file?: File;
  failureReason?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MediaProcessingService {
  private readonly logger = inject(LoggerService);
  private readonly mediaService = inject(MediaService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private mediabunnyPromise: Promise<MediabunnyModule> | null = null;
  private aacEncoderRegistered = false;

  async prepareFileForUpload(
    file: File,
    settings: MediaUploadSettings,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<PreparedUploadFile> {
    const uploadOriginal = shouldUploadOriginal(settings.mode);

    if (!this.isBrowser || settings.mode !== 'local') {
      return {
        file,
        uploadOriginal,
        wasProcessed: false,
      };
    }

    const mimeType = this.mediaService.getFileMimeType(file);

    try {
      if (this.isProcessableImage(mimeType)) {
        return await this.prepareCompressedImage(file, settings, uploadOriginal, onProgress);
      }

      if (mimeType.startsWith('video/')) {
        return await this.prepareCompressedVideo(file, settings, uploadOriginal, onProgress);
      }

      return {
        file,
        uploadOriginal,
        wasProcessed: false,
      };
    } catch (error) {
      this.logger.warn('Local media compression failed, falling back to original upload', error);

      return {
        file,
        uploadOriginal,
        wasProcessed: false,
        warningMessage: `Local optimization was not available for ${file.name}. Uploading the original file instead.`,
      };
    }
  }

  async createCompressionPreview(
    file: File,
    settings: MediaUploadSettings,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<CompressionPreviewResult> {
    if (!this.isBrowser) {
      return {
        originalFile: file,
        willUploadCompressedFile: false,
        warningMessage: 'Optimization preview is only available in the browser.',
      };
    }

    if (settings.mode !== 'local') {
      return {
        originalFile: file,
        willUploadCompressedFile: false,
        warningMessage: 'Choose Minimal, Balanced, or Optimized to preview how the media will look after optimization.',
      };
    }

    const mimeType = this.mediaService.getFileMimeType(file);

    try {
      if (this.isProcessableImage(mimeType)) {
        const candidate = await this.createCompressedImageCandidate(file, settings, onProgress);
        return this.mapCompressionPreviewCandidate(file, candidate);
      }

      if (mimeType.startsWith('video/')) {
        const candidate = await this.createCompressedVideoCandidate(file, settings, onProgress);
        return this.mapCompressionPreviewCandidate(file, candidate);
      }

      return {
        originalFile: file,
        willUploadCompressedFile: false,
        warningMessage: 'Optimization preview is currently available for images and videos only.',
      };
    } catch (error) {
      this.logger.warn('Failed to generate compression preview', error);
      return {
        originalFile: file,
        willUploadCompressedFile: false,
        warningMessage: `Could not generate an optimization preview for ${file.name}.`,
      };
    }
  }

  private isProcessableImage(mimeType: string): mimeType is SupportedImageMimeType {
    return mimeType === 'image/jpeg'
      || mimeType === 'image/png'
      || mimeType === 'image/webp'
      || mimeType === 'image/heic'
      || mimeType === 'image/heif';
  }

  private async prepareCompressedImage(
    file: File,
    settings: MediaUploadSettings,
    uploadOriginal: boolean,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<PreparedUploadFile> {
    const candidate = await this.createCompressedImageCandidate(file, settings, onProgress);

    if (!candidate.file) {
      return {
        file,
        uploadOriginal,
        wasProcessed: false,
        warningMessage: candidate.failureReason ?? `Local optimization was not available for ${file.name}. Uploading the original file instead.`,
      };
    }

    if (candidate.file.size >= file.size) {
      return {
        file,
        uploadOriginal,
        wasProcessed: false,
        warningMessage: `Local optimization did not reduce ${file.name}, so the original file will be uploaded.`,
      };
    }

    return {
      file: candidate.file,
      uploadOriginal,
      wasProcessed: true,
    };
  }

  private async createCompressedImageCandidate(
    file: File,
    settings: MediaUploadSettings,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<CompressionCandidateResult> {
    onProgress?.({ message: `Optimizing ${file.name}...`, progress: 0.1 });

    const imageSource = await this.loadImageSource(file);

    try {
      const maxDimension = this.getImageMaxDimension(settings.compressionStrength);
      const dimensions = this.scaleDimensions(imageSource.width, imageSource.height, maxDimension);
      const outputMimeType = this.getImageOutputMimeType(file.type);
      const quality = this.getImageQuality(settings.compressionStrength);
      const canvas = this.createCanvas(dimensions.width, dimensions.height);
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Failed to get canvas context for image compression.');
      }

      context.drawImage(imageSource.source, 0, 0, dimensions.width, dimensions.height);
      onProgress?.({ message: `Finalizing ${file.name}...`, progress: 0.75 });

      const blob = await this.canvasToBlob(canvas, outputMimeType, quality);

      onProgress?.({ message: `Optimized ${file.name}`, progress: 1 });

      return {
        file: this.createOutputFile(file, blob, outputMimeType),
      };
    } finally {
      imageSource.dispose();
    }
  }

  private async prepareCompressedVideo(
    file: File,
    settings: MediaUploadSettings,
    uploadOriginal: boolean,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<PreparedUploadFile> {
    const candidate = await this.createCompressedVideoCandidate(file, settings, onProgress);

    if (!candidate.file) {
      return {
        file,
        uploadOriginal,
        wasProcessed: false,
        warningMessage: candidate.failureReason ?? `Local optimization was not available for ${file.name}. Uploading the original file instead.`,
      };
    }

    if (candidate.file.size >= file.size) {
      return {
        file,
        uploadOriginal,
        wasProcessed: false,
        warningMessage: `Local optimization did not reduce ${file.name}, so the original file will be uploaded.`,
      };
    }

    return {
      file: candidate.file,
      uploadOriginal,
      wasProcessed: true,
    };
  }

  private async createCompressedVideoCandidate(
    file: File,
    settings: MediaUploadSettings,
    onProgress?: (progress: MediaProcessingProgress) => void,
  ): Promise<CompressionCandidateResult> {
    onProgress?.({ message: `Preparing ${file.name} for optimization...`, progress: 0.05 });

    const mediabunny = await this.loadMediabunny();
    const input = new mediabunny.Input({
      source: new mediabunny.BlobSource(file),
      formats: mediabunny.ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return {
          failureReason: `No video track was found in ${file.name}.`,
        };
      }

      const audioTrack = await input.getPrimaryAudioTrack();
      const plan = await this.buildVideoPlan(mediabunny, videoTrack.displayWidth, videoTrack.displayHeight, !!audioTrack, settings.compressionStrength);

      if (!plan) {
        return {
          failureReason: `This browser cannot locally compress ${file.name}.`,
        };
      }

      const output = new mediabunny.Output({
        format: plan.format,
        target: new mediabunny.BufferTarget(),
      });

      const conversion = await mediabunny.Conversion.init({
        input,
        output,
        video: {
          width: plan.width,
          height: plan.height,
          fit: 'contain',
          codec: plan.videoCodec,
          bitrate: plan.videoBitrate,
          forceTranscode: true,
        },
        audio: audioTrack
          ? {
            codec: plan.audioCodec,
            bitrate: plan.audioBitrate,
            numberOfChannels: 2,
            sampleRate: 48000,
            forceTranscode: true,
          }
          : { discard: true },
        tags: {},
      });

      if (!conversion.isValid) {
        return {
          failureReason: `Local compression could not encode ${file.name}.`,
        };
      }

      conversion.onProgress = progress => {
        onProgress?.({
          message: `Optimizing ${file.name}...`,
          progress,
        });
      };

      await conversion.execute();

      const buffer = output.target.buffer;
      if (!buffer) {
        throw new Error('Video conversion completed without producing an output buffer.');
      }

      const mimeType = (await output.getMimeType()).split(';', 1)[0] || plan.format.mimeType;
      const blob = new Blob([buffer], { type: mimeType });

      if (audioTrack) {
        const preservesAudio = await this.outputHasAudioTrack(mediabunny, blob);
        if (!preservesAudio) {
          return {
            failureReason: `Local compression would remove audio from ${file.name}, so the original file will be uploaded.`,
          };
        }
      }

      onProgress?.({ message: `Optimized ${file.name}`, progress: 1 });

      return {
        file: this.createOutputFile(file, blob, mimeType, plan.extension),
      };
    } finally {
      input.dispose();
    }
  }

  private mapCompressionPreviewCandidate(
    originalFile: File,
    candidate: CompressionCandidateResult,
  ): CompressionPreviewResult {
    if (!candidate.file) {
      return {
        originalFile,
        willUploadCompressedFile: false,
        warningMessage: candidate.failureReason ?? `Could not generate an optimization preview for ${originalFile.name}.`,
      };
    }

    const willUploadCompressedFile = candidate.file.size < originalFile.size;

    return {
      originalFile,
      compressedFile: candidate.file,
      willUploadCompressedFile,
      warningMessage: willUploadCompressedFile
        ? undefined
        : `The compressed preview for ${originalFile.name} is larger than the original, so upload will keep the original file.`,
    };
  }

  private async loadMediabunny(): Promise<MediabunnyModule> {
    if (!this.mediabunnyPromise) {
      this.mediabunnyPromise = import('mediabunny');
    }

    const mediabunny = await this.mediabunnyPromise;
    await this.ensureAacEncoder(mediabunny);
    return mediabunny;
  }

  private async ensureAacEncoder(mediabunny: MediabunnyModule): Promise<void> {
    if (this.aacEncoderRegistered) {
      return;
    }

    const hasNativeAac = await mediabunny.canEncodeAudio('aac', {
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 128000,
    });

    if (!hasNativeAac) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }

    this.aacEncoderRegistered = true;
  }

  private async buildVideoPlan(
    mediabunny: MediabunnyModule,
    originalWidth: number,
    originalHeight: number,
    hasAudio: boolean,
    compressionStrength: number,
  ): Promise<VideoConversionPlan | null> {
    const maxDimension = this.getVideoMaxDimension(compressionStrength);
    const scaled = this.scaleDimensions(originalWidth, originalHeight, maxDimension);
    const videoBitrate = this.getVideoBitrate(scaled.width, scaled.height, compressionStrength);
    const audioBitrate = this.getAudioBitrate(compressionStrength);

    const candidates: {
      extension: string;
      format: VideoConversionPlan['format'];
      videoCodecs: SupportedVideoCodec[];
      audioCodecs: SupportedAudioCodec[];
    }[] = [
      {
        extension: '.mp4',
        format: new mediabunny.Mp4OutputFormat({ fastStart: 'in-memory' }),
        videoCodecs: ['avc', 'vp9', 'av1', 'hevc'],
        audioCodecs: ['aac', 'opus', 'mp3'],
      },
      {
        extension: '.webm',
        format: new mediabunny.WebMOutputFormat(),
        videoCodecs: ['vp9', 'vp8', 'av1'],
        audioCodecs: ['opus', 'vorbis'],
      },
    ];

    for (const candidate of candidates) {
      const videoCodec = await mediabunny.getFirstEncodableVideoCodec(candidate.videoCodecs, {
        width: scaled.width,
        height: scaled.height,
        bitrate: videoBitrate,
      }) as SupportedVideoCodec | null;

      if (!videoCodec) {
        continue;
      }

      let audioCodec: SupportedAudioCodec | undefined;
      if (hasAudio) {
        audioCodec = await mediabunny.getFirstEncodableAudioCodec(candidate.audioCodecs, {
          numberOfChannels: 2,
          sampleRate: 48000,
          bitrate: audioBitrate,
        }) as SupportedAudioCodec | null ?? undefined;

        if (!audioCodec) {
          continue;
        }
      }

      return {
        extension: candidate.extension,
        format: candidate.format,
        videoCodec,
        audioCodec,
        width: scaled.width,
        height: scaled.height,
        videoBitrate,
        audioBitrate,
      };
    }

    return null;
  }

  private async outputHasAudioTrack(mediabunny: MediabunnyModule, blob: Blob): Promise<boolean> {
    const input = new mediabunny.Input({
      source: new mediabunny.BlobSource(blob),
      formats: mediabunny.ALL_FORMATS,
    });

    try {
      return !!await input.getPrimaryAudioTrack();
    } catch (error) {
      this.logger.warn('Failed to verify audio track in locally compressed video output', error);
      return false;
    } finally {
      input.dispose();
    }
  }

  private getImageOutputMimeType(originalMimeType: string): 'image/jpeg' | 'image/webp' {
    if (originalMimeType === 'image/png' || originalMimeType === 'image/webp') {
      return 'image/webp';
    }

    return 'image/jpeg';
  }

  private getImageQuality(compressionStrength: number): number {
    const normalized = normalizeCompressionStrength(compressionStrength) / 100;
    return this.clamp(0.92 - normalized * 0.52, 0.35, 0.92);
  }

  private getImageMaxDimension(compressionStrength: number): number {
    const normalized = normalizeCompressionStrength(compressionStrength);

    if (normalized >= 80) {
      return 960;
    }

    if (normalized >= 60) {
      return 1280;
    }

    if (normalized >= 40) {
      return 1600;
    }

    if (normalized >= 20) {
      return 1920;
    }

    if (normalized >= 10) {
      return 2560;
    }

    return 3200;
  }

  private getVideoMaxDimension(compressionStrength: number): number {
    const normalized = normalizeCompressionStrength(compressionStrength);

    if (normalized >= 80) {
      return 720;
    }

    if (normalized >= 60) {
      return 960;
    }

    if (normalized >= 40) {
      return 1280;
    }

    if (normalized >= 20) {
      return 1600;
    }

    return 1920;
  }

  private getVideoBitrate(width: number, height: number, compressionStrength: number): number {
    const normalized = normalizeCompressionStrength(compressionStrength) / 100;
    const megaPixels = (width * height) / 1_000_000;
    const baseBitrate = 1_400_000 + megaPixels * 1_600_000;
    return Math.round(this.clamp(baseBitrate * (1.05 - normalized * 0.55), 600_000, 12_000_000));
  }

  private getAudioBitrate(compressionStrength: number): number {
    const normalized = normalizeCompressionStrength(compressionStrength) / 100;
    return Math.round(this.clamp(128000 - normalized * 56000, 64000, 128000));
  }

  private scaleDimensions(width: number, height: number, maxDimension: number): { width: number; height: number } {
    if (width <= maxDimension && height <= maxDimension) {
      return { width, height };
    }

    if (width >= height) {
      return {
        width: maxDimension,
        height: Math.max(1, Math.round((height / width) * maxDimension)),
      };
    }

    return {
      width: Math.max(1, Math.round((width / height) * maxDimension)),
      height: maxDimension,
    };
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    const canvas = new OffscreenCanvas(width, height);
    return canvas;
  }

  private async canvasToBlob(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    mimeType: string,
    quality: number,
  ): Promise<Blob> {
    if ('convertToBlob' in canvas) {
      return canvas.convertToBlob({ type: mimeType, quality });
    }

    return new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(blob => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Failed to convert canvas to blob.'));
      }, mimeType, quality);
    });
  }

  private async loadImageSource(file: File): Promise<{
    width: number;
    height: number;
    source: CanvasImageSource;
    dispose: () => void;
  }> {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        dispose: () => bitmap.close(),
      };
    }

    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Failed to load image for local compression.'));
      element.src = objectUrl;
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  }

  private createOutputFile(file: File, blob: Blob, mimeType: string, forcedExtension?: string): File {
    const extension = forcedExtension ?? this.getExtensionForMimeType(mimeType);
    const nextName = this.replaceExtension(file.name, extension);

    return new File([blob], nextName, {
      type: mimeType,
      lastModified: file.lastModified,
    });
  }

  private replaceExtension(fileName: string, extension: string): string {
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
    const lastDot = fileName.lastIndexOf('.');

    if (lastDot === -1) {
      return `${fileName}${normalizedExtension}`;
    }

    return `${fileName.slice(0, lastDot)}${normalizedExtension}`;
  }

  private getExtensionForMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/webp':
        return '.webp';
      case 'image/jpeg':
        return '.jpg';
      case 'video/mp4':
        return '.mp4';
      case 'video/webm':
        return '.webm';
      default:
        return '';
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
