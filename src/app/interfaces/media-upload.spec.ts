import { describe, expect, it } from 'vitest';
import {
  BALANCED_MEDIA_COMPRESSION_STRENGTH,
  getCompressionStrengthLabel,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  getVideoOptimizationProfileBadgeLabel,
  getVideoOptimizationProfileDescription,
  getVideoOptimizationProfileLabel,
  MINIMAL_MEDIA_COMPRESSION_STRENGTH,
  OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
} from './media-upload';

describe('media-upload presets', () => {
  it('maps optimization presets to the tuned compression strengths', () => {
    expect(getMediaUploadSettingsForOptimization('minimal')).toEqual({
      mode: 'local',
      compressionStrength: MINIMAL_MEDIA_COMPRESSION_STRENGTH,
      videoOptimizationProfile: 'default',
    });

    expect(getMediaUploadSettingsForOptimization('balanced')).toEqual({
      mode: 'local',
      compressionStrength: BALANCED_MEDIA_COMPRESSION_STRENGTH,
      videoOptimizationProfile: 'default',
    });

    expect(getMediaUploadSettingsForOptimization('optimized')).toEqual({
      mode: 'local',
      compressionStrength: OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
      videoOptimizationProfile: 'default',
    });
  });

  it('classifies existing local compression strengths into the new preset buckets', () => {
    expect(getMediaOptimizationOption('original', 35)).toBe('original');
    expect(getMediaOptimizationOption('local', 5)).toBe('minimal');
    expect(getMediaOptimizationOption('local', 35)).toBe('balanced');
    expect(getMediaOptimizationOption('local', 50)).toBe('balanced');
    expect(getMediaOptimizationOption('local', 65)).toBe('optimized');
  });

  it('uses the new user-facing compression labels', () => {
    expect(getCompressionStrengthLabel(0)).toBe('Original');
    expect(getCompressionStrengthLabel(5)).toBe('Minimal');
    expect(getCompressionStrengthLabel(35)).toBe('Balanced');
    expect(getCompressionStrengthLabel(65)).toBe('Optimized');
  });

  it('describes the screen recording video profile separately from the default profile', () => {
    expect(getVideoOptimizationProfileDescription('default')).toContain('camera footage');
    expect(getVideoOptimizationProfileDescription('screen')).toContain('code walkthroughs');
    expect(getVideoOptimizationProfileDescription('slides')).toContain('text clarity');
    expect(getVideoOptimizationProfileDescription('action')).toContain('fast movement');
  });

  it('exposes user-facing labels for video optimization profiles', () => {
    expect(getVideoOptimizationProfileLabel('default')).toBe('Regular Video');
    expect(getVideoOptimizationProfileLabel('screen')).toBe('Screen Recording');
    expect(getVideoOptimizationProfileLabel('slides')).toBe('Slides and Text');
    expect(getVideoOptimizationProfileLabel('action')).toBe('High Motion');
    expect(getVideoOptimizationProfileBadgeLabel('default')).toBe('Video');
    expect(getVideoOptimizationProfileBadgeLabel('screen')).toBe('Screen');
    expect(getVideoOptimizationProfileBadgeLabel('slides')).toBe('Slides');
    expect(getVideoOptimizationProfileBadgeLabel('action')).toBe('Motion');
  });
});