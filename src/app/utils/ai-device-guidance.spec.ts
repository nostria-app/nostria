import { describe, expect, it } from 'vitest';
import { buildAiDeviceGuidance, type AiDeviceSnapshot } from './ai-device-guidance';

function createSnapshot(overrides: Partial<AiDeviceSnapshot> = {}): AiDeviceSnapshot {
  return {
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    webGpuAvailable: true,
    saveDataEnabled: false,
    effectiveConnectionType: '4g',
    likelyConstrained: false,
    storageQuotaBytes: 32 * 1024 * 1024 * 1024,
    storageUsageBytes: 4 * 1024 * 1024 * 1024,
    ...overrides,
  };
}

describe('buildAiDeviceGuidance', () => {
  it('recommends cloud-first for low-memory devices without WebGPU', () => {
    const guidance = buildAiDeviceGuidance(createSnapshot({
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      webGpuAvailable: false,
      likelyConstrained: true,
    }));

    expect(guidance.mode).toBe('cloud-first');
    expect(guidance.summary).toContain('OpenAI or xAI API key');
  });

  it('recommends hybrid when WebGPU is missing on an otherwise decent device', () => {
    const guidance = buildAiDeviceGuidance(createSnapshot({
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      webGpuAvailable: false,
    }));

    expect(guidance.mode).toBe('hybrid');
    expect(guidance.reasons.some(reason => reason.includes('WebGPU is not available'))).toBe(true);
  });

  it('recommends full-local for higher-end devices', () => {
    const guidance = buildAiDeviceGuidance(createSnapshot({
      deviceMemoryGb: 16,
      hardwareConcurrency: 12,
      webGpuAvailable: true,
    }));

    expect(guidance.mode).toBe('full-local');
    expect(guidance.title).toContain('ready for local AI');
  });
});