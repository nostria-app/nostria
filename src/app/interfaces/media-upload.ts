export type MediaUploadMode = 'original' | 'local' | 'server';
export type VideoOptimizationProfile = 'default' | 'screen' | 'slides' | 'action';

export interface VideoOptimizationProfileOption {
  value: VideoOptimizationProfile;
  label: string;
  badgeLabel: string;
  description: string;
}

export interface FileUploadSettingOverride {
  file: File;
  uploadSettings: MediaUploadSettings;
}

export interface MediaUploadSettings {
  mode: MediaUploadMode;
  compressionStrength: number;
  videoOptimizationProfile?: VideoOptimizationProfile;
}

export interface MediaUploadModeOption {
  value: MediaUploadMode;
  label: string;
  description: string;
}

export type MediaOptimizationOptionValue = 'original' | 'minimal' | 'balanced' | 'optimized';

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
  fileUploadSettings?: FileUploadSettingOverride[];
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

export const VIDEO_OPTIMIZATION_PROFILE_OPTIONS: readonly VideoOptimizationProfileOption[] = [
  {
    value: 'default',
    label: 'Regular Video',
    badgeLabel: 'Video',
    description: 'General camera footage and mixed-motion clips.',
  },
  {
    value: 'screen',
    label: 'Screen Recording',
    badgeLabel: 'Screen',
    description: 'App demos, code walkthroughs, tutorials, and UI captures.',
  },
  {
    value: 'slides',
    label: 'Slides and Text',
    badgeLabel: 'Slides',
    description: 'Presentations, terminals, static scenes, or videos where text clarity matters most.',
  },
  {
    value: 'action',
    label: 'High Motion',
    badgeLabel: 'Motion',
    description: 'Gameplay, camera pans, sports, handheld footage, and fast movement.',
  },
] as const;

export const MINIMAL_MEDIA_COMPRESSION_STRENGTH = 5;
export const BALANCED_MEDIA_COMPRESSION_STRENGTH = 35;
export const OPTIMIZED_MEDIA_COMPRESSION_STRENGTH = 65;
export const DEFAULT_MEDIA_COMPRESSION_STRENGTH = BALANCED_MEDIA_COMPRESSION_STRENGTH;
export const BALANCED_MEDIA_OPTIMIZATION_THRESHOLD = 30;
export const OPTIMIZED_MEDIA_OPTIMIZATION_THRESHOLD = 58;

export const MEDIA_OPTIMIZATION_OPTIONS: readonly MediaOptimizationOption[] = [
  {
    value: 'original',
    label: 'Original',
    description: 'Keep the original quality and upload the file as-is.',
    mode: 'original',
    compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  },
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'Very light optimization for oversized photos and videos when you want to preserve more detail.',
    mode: 'local',
    compressionStrength: MINIMAL_MEDIA_COMPRESSION_STRENGTH,
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Recommended default with a gentler quality reduction than before and solid size savings.',
    mode: 'local',
    compressionStrength: BALANCED_MEDIA_COMPRESSION_STRENGTH,
  },
  {
    value: 'optimized',
    label: 'Optimized',
    description: 'Stronger local optimization for smaller uploads without pushing quality as hard as the old Maximum preset.',
    mode: 'local',
    compressionStrength: OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
  },
] as const;

export const DEFAULT_MEDIA_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  videoOptimizationProfile: 'default',
};

export const DEFAULT_DM_MEDIA_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  videoOptimizationProfile: 'default',
};

export const DEFAULT_VIDEO_CLIP_UPLOAD_SETTINGS: MediaUploadSettings = {
  mode: 'local',
  compressionStrength: DEFAULT_MEDIA_COMPRESSION_STRENGTH,
  videoOptimizationProfile: 'default',
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

  const normalized = normalizeCompressionStrength(compressionStrength);

  if (normalized >= OPTIMIZED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'optimized';
  }

  if (normalized >= BALANCED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'balanced';
  }

  return 'minimal';
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
  videoOptimizationProfile: VideoOptimizationProfile = 'default',
): string {
  const baseDescription = MEDIA_OPTIMIZATION_OPTIONS.find(option =>
    option.value === getMediaOptimizationOption(mode, compressionStrength)
  )?.description ?? MEDIA_OPTIMIZATION_OPTIONS[1].description;

  if (mode === 'local' && videoOptimizationProfile !== 'default') {
    switch (videoOptimizationProfile) {
      case 'screen':
        return `${baseDescription} Screen recording tuning is enabled for videos.`;
      case 'slides':
        return `${baseDescription} Slides and text tuning is enabled for videos.`;
      case 'action':
        return `${baseDescription} High-motion tuning is enabled for videos.`;
    }
  }

  return baseDescription;
}

export function getMediaUploadSettingsForOptimization(
  optimization: MediaOptimizationOptionValue,
): MediaUploadSettings {
  const option = MEDIA_OPTIMIZATION_OPTIONS.find(candidate => candidate.value === optimization)
    ?? MEDIA_OPTIMIZATION_OPTIONS[1];

  return {
    mode: option.mode,
    compressionStrength: option.compressionStrength,
    videoOptimizationProfile: 'default',
  };
}

export function getVideoOptimizationProfileDescription(profile: VideoOptimizationProfile): string {
  return VIDEO_OPTIMIZATION_PROFILE_OPTIONS.find(option => option.value === profile)?.description
    ?? VIDEO_OPTIMIZATION_PROFILE_OPTIONS[0].description;
}

export function getVideoOptimizationProfileLabel(profile: VideoOptimizationProfile): string {
  return VIDEO_OPTIMIZATION_PROFILE_OPTIONS.find(option => option.value === profile)?.label
    ?? VIDEO_OPTIMIZATION_PROFILE_OPTIONS[0].label;
}

export function getVideoOptimizationProfileBadgeLabel(profile: VideoOptimizationProfile): string {
  return VIDEO_OPTIMIZATION_PROFILE_OPTIONS.find(option => option.value === profile)?.badgeLabel
    ?? VIDEO_OPTIMIZATION_PROFILE_OPTIONS[0].badgeLabel;
}

export function getCompressionStrengthLabel(strength: number): string {
  const normalized = normalizeCompressionStrength(strength);

  if (normalized >= OPTIMIZED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'Optimized';
  }

  if (normalized >= BALANCED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'Balanced';
  }

  if (normalized > 0) {
    return 'Minimal';
  }

  return 'Original';
}

export function getCompressionStrengthDescription(strength: number): string {
  const normalized = normalizeCompressionStrength(strength);

  if (normalized >= OPTIMIZED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'Stronger optimization for smaller uploads with more visible softening than Balanced.';
  }

  if (normalized >= BALANCED_MEDIA_OPTIMIZATION_THRESHOLD) {
    return 'Balanced quality and file size with a gentler default than before.';
  }

  if (normalized > 0) {
    return 'Very light optimization that preserves more detail while still trimming oversized files.';
  }

  return 'Keep the original quality and upload the file as-is.';
}

export function getMediaUploadModeDescription(mode: MediaUploadMode): string {
  return MEDIA_UPLOAD_MODE_OPTIONS.find(option => option.value === mode)?.description
    ?? MEDIA_UPLOAD_MODE_OPTIONS[0].description;
}
