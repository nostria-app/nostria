import { describe, expect, it } from 'vitest';
import {
  BALANCED_MEDIA_COMPRESSION_STRENGTH,
  getCompressionStrengthLabel,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  MINIMAL_MEDIA_COMPRESSION_STRENGTH,
  OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
} from './media-upload';

describe('media-upload presets', () => {
  it('maps optimization presets to the tuned compression strengths', () => {
    expect(getMediaUploadSettingsForOptimization('minimal')).toEqual({
      mode: 'local',
      compressionStrength: MINIMAL_MEDIA_COMPRESSION_STRENGTH,
    });

    expect(getMediaUploadSettingsForOptimization('balanced')).toEqual({
      mode: 'local',
      compressionStrength: BALANCED_MEDIA_COMPRESSION_STRENGTH,
    });

    expect(getMediaUploadSettingsForOptimization('optimized')).toEqual({
      mode: 'local',
      compressionStrength: OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
    });
  });

  it('classifies existing local compression strengths into the new preset buckets', () => {
    expect(getMediaOptimizationOption('original', 35)).toBe('original');
    expect(getMediaOptimizationOption('local', 10)).toBe('minimal');
    expect(getMediaOptimizationOption('local', 35)).toBe('balanced');
    expect(getMediaOptimizationOption('local', 50)).toBe('balanced');
    expect(getMediaOptimizationOption('local', 65)).toBe('optimized');
  });

  it('uses the new user-facing compression labels', () => {
    expect(getCompressionStrengthLabel(0)).toBe('Original');
    expect(getCompressionStrengthLabel(10)).toBe('Minimal');
    expect(getCompressionStrengthLabel(35)).toBe('Balanced');
    expect(getCompressionStrengthLabel(65)).toBe('Optimized');
  });
});