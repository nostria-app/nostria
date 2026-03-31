export type MediaUploadMode = 'original' | 'local' | 'server';

export interface MediaUploadSettings {
  mode: MediaUploadMode;
  compressionStrength: number;
}

export interface MediaUploadModeOption {
  value: MediaUploadMode;
  label: string;
  description: string;
}

export type MediaOptimizationOptionValue = 'original' | 'balanced' | 'maximum';

export interface MediaOptimizationOption {
  value: MediaOptimizationOptionValue;
  label: string;
  description: string;
  mode: MediaUploadMode;
  compressionStrength: number;
}

export interface MediaUploadDialogResult {
  files: File[];
  uploadSettings: MediaUploadSettings;
  uploadOriginal: boolean;
  servers: string[];
}

export interface VideoRecordDialogResult {
  file: File;
  uploadSettings: MediaUploadSettings;
  uploadOriginal: boolean;
}

export const MEDIA_UPLOAD_MODE_OPTIONS: readonly MediaUploadModeOption[] = [
  {
    value: 'original',
    label: 'Upload Original',
    description: 'Skip all compression and upload the file as-is.',
  },
  {
    value: 'local',
    label: 'Local Compression',
    description: 'Compress images and videos in the browser before uploading.',
  },
  {
    value: 'server',
    label: 'Server Compression',
    description: 'Upload the source file and let the media server optimize it.',
  },
] as const;

export const DEFAULT_MEDIA_COMPRESSION_STRENGTH = 50;
export const MAXIMUM_MEDIA_OPTIMIZATION_THRESHOLD = 80;
export const MAXIMUM_MEDIA_COMPRESSION_STRENGTH = 100;

export const MEDIA_OPTIMIZATION_OPTIONS: readonly MediaOptimizationOption[] = [
  {
    value: 'original',
    label: 'Original',
    description: 'Keep the original quality and upload the file as-is.',
    mode: 'original',
    compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Recommended for most photos and videos with a good balance of quality and file size.',
    mode: 'local',
    compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  },
  {
    value: 'maximum',
    label: 'Maximum',
    description: 'Make the file as small as possible, with the most noticeable quality reduction.',
    mode: 'local',
    compressionStrength: MAXIMUM_MEDIA_COMPRESSION_STRENGTH,
  },
] as const;

export const DEFAULT_MEDIA_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
};

export const DEFAULT_DM_MEDIA_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
};

export const DEFAULT_VIDEO_CLIP_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
};

export function normalizeCompressionStrength(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_MEDIA_COMPRESSION_STRENGTH;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function shouldUploadOriginal(mode: MediaUploadMode): boolean {
  return mode !== 'server';
}

export function usesLocalCompression(mode: MediaUploadMode): boolean {
  return mode === 'local';
}

export function getMediaOptimizationOption(
  mode: MediaUploadMode,
  compressionStrength: number,
): MediaOptimizationOptionValue {
  if (mode === 'original') {
    return 'original';
  }

  return normalizeCompressionStrength(compressionStrength) >= MAXIMUM_MEDIA_OPTIMIZATION_THRESHOLD
    ? 'maximum'
    : 'balanced';
}

export function getMediaOptimizationLabel(
  mode: MediaUploadMode,
  compressionStrength: number,
): string {
  return MEDIA_OPTIMIZATION_OPTIONS.find(option =>
    option.value === getMediaOptimizationOption(mode, compressionStrength)
  )?.label ?? MEDIA_OPTIMIZATION_OPTIONS[1].label;
}

export function getMediaOptimizationDescription(
  mode: MediaUploadMode,
  compressionStrength: number,
): string {
  return MEDIA_OPTIMIZATION_OPTIONS.find(option =>
    option.value === getMediaOptimizationOption(mode, compressionStrength)
  )?.description ?? MEDIA_OPTIMIZATION_OPTIONS[1].description;
}

export function getMediaUploadSettingsForOptimization(
  optimization: MediaOptimizationOptionValue,
): MediaUploadSettings {
  const option = MEDIA_OPTIMIZATION_OPTIONS.find(candidate => candidate.value === optimization)
    ?? MEDIA_OPTIMIZATION_OPTIONS[1];

  return {
    mode: option.mode,
    compressionStrength: option.compressionStrength,
  };
}

export function getCompressionStrengthLabel(strength: number): string {
  const normalized = normalizeCompressionStrength(strength);

  if (normalized >= 80) {
    return 'Maximum';
  }

  if (normalized >= 60) {
    return 'High';
  }

  if (normalized >= 40) {
    return 'Balanced';
  }

  if (normalized >= 20) {
    return 'Light';
  }

  return 'Minimal';
}

export function getCompressionStrengthDescription(strength: number): string {
  const normalized = normalizeCompressionStrength(strength);

  if (normalized >= 80) {
    return 'Smallest files with the most visible quality reduction.';
  }

  if (normalized >= 60) {
    return 'Strong size reduction for faster uploads and smaller encrypted payloads.';
  }

  if (normalized >= 40) {
    return 'Balanced quality and file size for most photos and videos.';
  }

  if (normalized >= 20) {
    return 'Mostly preserves quality while still trimming file size.';
  }

  return 'Closest to the original quality with only mild compression.';
}

export function getMediaUploadModeDescription(mode: MediaUploadMode): string {
  return MEDIA_UPLOAD_MODE_OPTIONS.find(option => option.value === mode)?.description
    ?? MEDIA_UPLOAD_MODE_OPTIONS[0].description;
}
